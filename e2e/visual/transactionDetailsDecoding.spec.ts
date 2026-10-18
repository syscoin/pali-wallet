import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, Interface, id } from 'ethers';
import fs from 'fs';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const mode of ['complete', 'sparse'] as const) {
  test(`received-token details decode ${mode} explorer history after the RPC body arrives`, async ({}, info) => {
    test.setTimeout(120_000);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(runtime.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const recipient = fixture.evmAddresses[0];
    const sender = `0x${'44'.repeat(20)}`;
    const contract = `0x${'33'.repeat(20)}`;
    const hash = `0x${(mode === 'complete' ? 'a1' : 'a2').repeat(32)}`;
    const blockHash = `0x${'42'.repeat(32)}`;
    const input = new Interface([
      'function transfer(address to,uint256 value)',
    ]).encodeFunctionData('transfer', [recipient, 7]);
    const abi = AbiCoder.defaultAbiCoder();
    const metadata = new Map([
      [
        id('name()').slice(0, 10),
        abi.encode(['string'], ['Synthetic Transfer Token']),
      ],
      [id('symbol()').slice(0, 10), abi.encode(['string'], ['TRANSFER'])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [0])],
      [id('balanceOf(address)').slice(0, 10), abi.encode(['uint256'], [7])],
      [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [7])],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    const event = {
      hash,
      from: sender,
      to: recipient,
      contractAddress: contract,
      value: '7',
      ...(mode === 'complete' ? { input } : {}),
      nonce: '1',
      blockNumber: '42',
      blockHash,
      timeStamp: String(Math.floor(Date.now() / 1000) - 600),
      confirmations: '1',
      tokenDecimal: '0',
      tokenSymbol: 'TRANSFER',
      tokenName: 'Synthetic Transfer Token',
      gas: '50000',
      gasUsed: '45000',
      gasPrice: '1000000000',
    };
    const transaction = {
      hash,
      from: sender,
      to: contract,
      input,
      value: '0x0',
      nonce: '0x1',
      gas: '0xc350',
      gasPrice: '0x3b9aca00',
      blockNumber: '0x2a',
      blockHash,
      transactionIndex: '0x0',
      chainId: '0x1644',
      type: '0x0',
      r: `0x${'01'.repeat(32)}`,
      s: `0x${'02'.repeat(32)}`,
      v: '0x1b',
    };
    const receipt = {
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash,
      blockNumber: '0x2a',
      from: sender,
      to: contract,
      cumulativeGasUsed: '0xafc8',
      gasUsed: '0xafc8',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      status: '0x1',
      type: '0x0',
      contractAddress: null,
    };
    let releaseBody!: () => void;
    const heldBody = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const explorerReads: unknown[] = [];
    const rpcReads: string[] = [];
    const attemptedWrites: string[] = [];
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'DecodedHistorySynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(`transaction-decoding-${mode}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api**',
        async (route) => {
          const url = new URL(route.request().url());
          const action = url.searchParams.get('action');
          const result =
            action === 'tokentx' &&
            url.searchParams.get('address')?.toLowerCase() ===
              recipient.toLowerCase()
              ? [event]
              : action === 'gettxinfo'
              ? null
              : [];
          explorerReads.push({
            action,
            txhash: url.searchParams.get('txhash'),
            result,
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: Array.isArray(result) && result.length ? '1' : '0',
              message:
                Array.isArray(result) && result.length
                  ? 'OK'
                  : 'No transactions found',
              result,
            }),
          });
        }
      );
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          attemptedWrites.push(...calls.map((call: any) => call.method));
          return route.abort('blockedbyclient');
        }
        if (
          calls.some((call: any) => call.method === 'eth_getTransactionByHash')
        )
          await heldBody;
        const replies = calls.map((call: any) => {
          let result: unknown;
          switch (call.method) {
            case 'eth_chainId':
              result = '0x1644';
              break;
            case 'net_version':
              result = '5700';
              break;
            case 'eth_blockNumber':
              result = '0x2a';
              break;
            case 'eth_getBalance':
            case 'eth_getTransactionCount':
              result = '0x0';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getCode':
              result =
                call.params[0].toLowerCase() === contract
                  ? '0x60006000fd'
                  : '0x';
              break;
            case 'eth_call':
              result =
                call.params[0].to?.toLowerCase() === contract
                  ? metadata.get(call.params[0].data.slice(0, 10))
                  : '0x';
              break;
            case 'eth_getLogs':
              result = [];
              break;
            case 'eth_getTransactionByHash':
              result = call.params[0] === hash ? transaction : null;
              break;
            case 'eth_getTransactionReceipt':
              result = call.params[0] === hash ? receipt : null;
              break;
            case 'eth_getBlockByNumber':
              result = {
                number: '0x2a',
                hash: blockHash,
                parentHash: `0x${'41'.repeat(32)}`,
                nonce: '0x0000000000000000',
                timestamp: `0x${Number(event.timeStamp).toString(16)}`,
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0xafc8',
                miner: `0x${'00'.repeat(20)}`,
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
              break;
          }
          return result === undefined
            ? undefined
            : { jsonrpc: '2.0', id: call.id, result };
        });
        if (!replies.every((reply) => reply !== undefined))
          return route.fallback();
        rpcReads.push(...calls.map((call: any) => call.method));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      });
      const page = wallet.page;
      const step = (name: string, action: () => Promise<void>) =>
        wallet!.step(name, async (capture) => {
          try {
            await action();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        });
      await step(
        `${mode}: open real received-token Activity history`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page.locator('#activity-btn').click();
          const details = page
            .locator('#activity-panel-list')
            .getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            });
          await expect(details).toHaveCount(1);
          await details.click();
          await expect(page).toHaveURL(/#\/home\/details/);
          if (mode === 'sparse')
            await expect(
              page.getByText(en.buttons.send, { exact: true })
            ).toBeVisible();
          else
            await expect(
              page.getByText(en.transactions.decodedData, { exact: true })
            ).toBeVisible();
        }
      );
      await step(
        `${mode}: render full RPC transfer input and decoded parameters`,
        async () => {
          releaseBody();
          await expect
            .poll(() => rpcReads.includes('eth_getTransactionReceipt'))
            .toBe(true);
          await expect(page.getByText('Input', { exact: true })).toBeAttached();
          await expect(
            page.getByText('Gas Used', { exact: true })
          ).toBeAttached();
          await page
            .getByText('Method', { exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByText(en.transactions.decodedData, { exact: true })
          ).toBeVisible({ timeout: 3000 });
          await expect(
            page.getByText('Transfer', { exact: true })
          ).toBeVisible();
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      status = 'passed';
    } finally {
      releaseBody();
      fs.writeFileSync(
        info.outputPath('transaction-decoding-evidence.json'),
        JSON.stringify(
          {
            mode,
            status,
            runtime,
            explorerReads,
            rpcReads,
            attemptedWrites,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            deniedWrites: routes?.deniedWrites,
            proxyDeniedConnections: server.blocked.length,
            syntheticHttpOnly: true,
            controllerOrStateInjection: false,
          },
          null,
          2
        )
      );
      await wallet?.dispose(status);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}
