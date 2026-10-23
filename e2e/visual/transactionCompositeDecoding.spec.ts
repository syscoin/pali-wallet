import { expect, test } from '@playwright/test';
import { getErc55Abi } from '@sidhujag/sysweb3-utils';
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

for (const mode of ['empty', 'singleton-zero'] as const) {
  test(`native contract history preserves ${mode} decoded array boundaries`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    const runtime = extensionEvidence();
    const testSourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(runtime.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const sender = fixture.evmAddresses[0];
    const recipient = `0x${'44'.repeat(20)}`;
    const contract = `0x${'33'.repeat(20)}`;
    const hash = `0x${(mode === 'empty' ? 'b1' : 'b2').repeat(32)}`;
    const blockHash = `0x${'42'.repeat(32)}`;
    const timestamp = Math.floor(Date.now() / 1000) - 600;
    const values: string[] = mode === 'empty' ? [] : ['0'];
    const expected = JSON.stringify(values);
    const contractAbi = new Interface(getErc55Abi());
    const input = contractAbi.encodeFunctionData('safeBatchTransferFrom', [
      sender,
      recipient,
      values,
      values,
      '0x',
    ]);
    expect(input.slice(0, 10)).toBe('0x2eb2c2d6');
    const abi = AbiCoder.defaultAbiCoder();
    // This is an ordinary outer transaction, not a token-transfer endpoint row.
    const history = {
      hash,
      from: sender,
      to: contract,
      input,
      value: '0',
      nonce: '0',
      blockNumber: '42',
      blockHash,
      timeStamp: String(timestamp),
      confirmations: '1',
      gas: '50000',
      gasUsed: '45000',
      gasPrice: '1000000000',
      isError: '0',
      // eslint-disable-next-line camelcase
      txreceipt_status: '1',
    };
    const transaction = {
      hash,
      from: sender,
      to: contract,
      input,
      value: '0x0',
      nonce: '0x0',
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
      logs: [
        {
          address: contract,
          topics: [
            id('TransferBatch(address,address,address,uint256[],uint256[])'),
            abi.encode(['address'], [sender]),
            abi.encode(['address'], [sender]),
            abi.encode(['address'], [recipient]),
          ],
          data: abi.encode(['uint256[]', 'uint256[]'], [values, values]),
          blockHash,
          blockNumber: '0x2a',
          transactionHash: hash,
          transactionIndex: '0x0',
          logIndex: '0x0',
          removed: false,
        },
      ],
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
    const explorerReads: Array<{
      action: string | null;
      address: string | null;
    }> = [];
    const rpcReads: Array<{ method: string; params: unknown[] }> = [];
    const attemptedWrites: string[] = [];
    const unexpectedReads: string[] = [];
    const observed: Array<{
      displayed: string;
      parameter: string;
      tooltip: string;
    }> = [];
    const evidencePath = info.outputPath('transaction-composite-evidence.json');
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'CompositeHistorySynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(`transaction-composite-${mode}`, {
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
          if (route.request().method() !== 'GET') return route.fallback();
          const url = new URL(route.request().url());
          const action = url.searchParams.get('action');
          const address = url.searchParams.get('address');
          explorerReads.push({ action, address });
          const result =
            action === 'txlist' &&
            address?.toLowerCase() === sender.toLowerCase()
              ? [history]
              : action === 'gettxinfo'
              ? null
              : [
                  'tokentx',
                  'tokennfttx',
                  'token1155tx',
                  'txlistinternal',
                  'pendingtxlist',
                ].includes(action || '')
              ? []
              : undefined;
          if (result === undefined) {
            unexpectedReads.push(`explorer:${action}`);
            return route.fallback();
          }
          const hasResult = Array.isArray(result) && result.length > 0;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: hasResult ? '1' : '0',
              message: hasResult ? 'OK' : 'No transactions found',
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
          attemptedWrites.push(
            ...calls.map((call: any) => call?.method || 'invalid')
          );
          return route.abort('blockedbyclient');
        }
        if (
          calls.some((call: any) => call.method === 'eth_getTransactionByHash')
        )
          await heldBody;
        const replies = calls.map((call: any) => {
          if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return undefined;
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
              result = '0x0';
              break;
            case 'eth_getTransactionCount':
              result = '0x1';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getCode':
              result =
                call.params[0]?.toLowerCase() === contract
                  ? '0x60006000fd'
                  : '0x';
              break;
            case 'eth_call': {
              const data = call.params[0]?.data || '';
              if (
                call.params[0]?.to?.toLowerCase() === contract &&
                data.startsWith(id('supportsInterface(bytes4)').slice(0, 10))
              ) {
                const [interfaceId] = abi.decode(
                  ['bytes4'],
                  `0x${data.slice(10)}`
                );
                result = abi.encode(['bool'], [interfaceId === '0xd9b67a26']);
              }
              break;
            }
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
                timestamp: `0x${timestamp.toString(16)}`,
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
          if (result === undefined) {
            unexpectedReads.push(`rpc:${call.method}`);
            return undefined;
          }
          rpcReads.push({ method: call.method, params: call.params });
          return { jsonrpc: '2.0', id: call.id, result };
        });
        if (!replies.every((reply) => reply !== undefined))
          return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      });
      const page = wallet.page;
      const step = (name: string, action: () => Promise<void>) =>
        wallet!.step(`${mode}: ${name}`, async (capture) => {
          try {
            await action();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        });
      await step('open native-zero outgoing Activity transaction', async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        const detail = page
          .locator('#activity-panel-list')
          .getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          });
        await expect(detail).toHaveCount(1);
        await detail.click();
        await expect(page).toHaveURL(/#\/home\/details/);
      });
      await step(
        'resolve matching RPC body and real decoded selector',
        async () => {
          releaseBody();
          for (const method of [
            'eth_getTransactionByHash',
            'eth_getTransactionReceipt',
          ]) {
            await expect
              .poll(() =>
                rpcReads.some(
                  (read) => read.method === method && read.params[0] === hash
                )
              )
              .toBe(true);
          }
          await page
            .getByText('Method', { exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByText(en.transactions.methodNames.safeBatchTransferFrom, {
              exact: true,
            })
          ).toBeVisible();
          await expect(
            page.getByText(en.transactions.decodedData, { exact: true })
          ).toBeVisible();
          const hashValue = page
            .getByText(en.send.transactionId, { exact: true })
            .locator('..')
            .locator('span p')
            .first();
          await expect(hashValue).toHaveText(`0x...${hash.slice(-4)}`);
        }
      );
      for (const parameter of ['ids', 'amounts']) {
        await step(
          `inspect exact ${parameter} array and full tooltip`,
          async () => {
            const decoded = page
              .getByText(en.transactions.decodedData, { exact: true })
              .locator('..');
            const row = decoded
              .locator('div.flex.items-center.justify-between')
              .filter({ hasText: new RegExp(`^${parameter}`) });
            await expect(row).toHaveCount(1);
            const value = row.locator('span.font-mono');
            await value.scrollIntoViewIfNeeded();
            await expect(value).toHaveText(expected);
            await page.mouse.move(0, 0);
            await expect(page.getByRole('tooltip')).toHaveCount(0);
            await value.hover();
            const tooltip = page.getByRole('tooltip');
            await expect(tooltip).toHaveCount(1);
            await expect(tooltip).toHaveText(expected);
            await expect(
              decoded.getByText(en.transactions.unlimited, { exact: true })
            ).toHaveCount(0);
            observed.push({
              parameter,
              displayed: await value.innerText(),
              tooltip: await tooltip.innerText(),
            });
          }
        );
      }
      expect(observed).toEqual(
        ['ids', 'amounts'].map((parameter) => ({
          parameter,
          displayed: expected,
          tooltip: expected,
        }))
      );
      expect(
        explorerReads.some(
          (read) =>
            read.action === 'txlist' &&
            read.address?.toLowerCase() === sender.toLowerCase()
        )
      ).toBe(true);
      expect(routes.deniedWrites).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      expect(unexpectedReads).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(testSourceSha256);
      status = 'passed';
    } finally {
      releaseBody();
      try {
        fs.writeFileSync(
          evidencePath,
          JSON.stringify(
            {
              mode,
              status,
              runtime,
              testSourceSha256,
              hash,
              sender,
              recipient,
              contract,
              input,
              selector: input.slice(0, 10),
              values,
              expected,
              observed,
              explorerReads,
              rpcReads,
              attemptedWrites,
              unexpectedReads,
              deniedWrites: routes?.deniedWrites ?? [],
              proxyDeniedMethods: server.blocked.slice(),
              syntheticHttpOnly: true,
              controllerOrStateInjection: false,
              signingOrBroadcast: false,
            },
            null,
            2
          )
        );
        await info.attach(`transaction-composite-${mode}-evidence`, {
          path: evidencePath,
          contentType: 'application/json',
        });
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server.close();
          } finally {
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    }
  });
}
