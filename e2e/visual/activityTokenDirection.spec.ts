import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, Interface, id } from 'ethers';
import fs from 'fs';
import path from 'path';

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

const TOKEN = `0x${'33'.repeat(20)}`;
const SPENDER = `0x${'44'.repeat(20)}`;
const OTHER = `0x${'55'.repeat(20)}`;
const BLOCK_HASH = `0x${'42'.repeat(32)}`;
const AMOUNT = '1000000';
const TIMESTAMP = 1700000000;

const publicHistoryState = (page: Page, hash: string) =>
  page.evaluate(async (transactionHash) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { id: accountId, type } = state.vault.activeAccount;
    const network = state.vault.activeNetwork;
    const rows =
      state.vault.accountTransactions?.[type]?.[accountId]?.ethereum?.[
        network.chainId
      ] || [];
    return {
      account: {
        id: accountId,
        type,
        address: state.vault.accounts[type][accountId].address,
      },
      network: {
        chainId: network.chainId,
        kind: network.kind,
        url: network.url,
      },
      rows: rows
        .filter((row: any) => row.hash?.toLowerCase() === transactionHash)
        .map((row: any) => ({
          hash: row.hash,
          from: row.from,
          to: row.to,
          value: row.value,
          input: row.input,
          chainId: row.chainId,
          historySource: row.historySource,
          tokenRecipient: row.tokenRecipient,
          tokenTransfer: row.tokenTransfer,
        })),
    };
  }, hash);

for (const direction of ['outgoing', 'incoming'] as const) {
  test(`delegated ${direction} token Activity preserves its direction through provider details and Back`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const original = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const owner = fixture.evmAddresses[0];
    const sender = direction === 'outgoing' ? owner : OTHER;
    const recipient = direction === 'outgoing' ? OTHER : owner;
    const expectedDirection = direction === 'outgoing' ? 'Sent' : 'Received';
    const sign = direction === 'outgoing' ? '-' : '+';
    const hash = `0x${(direction === 'outgoing' ? 'd1' : 'd2').repeat(32)}`;
    const input = new Interface([
      'function transferFrom(address from,address to,uint256 amount)',
    ]).encodeFunctionData('transferFrom', [sender, recipient, AMOUNT]);
    const abi = AbiCoder.defaultAbiCoder();
    // The history endpoint describes the transfer event, not its outer sender.
    const event = {
      hash,
      from: sender,
      to: recipient,
      contractAddress: TOKEN,
      value: AMOUNT,
      input: '0x',
      nonce: '7',
      blockNumber: '42',
      blockHash: BLOCK_HASH,
      timeStamp: String(TIMESTAMP),
      confirmations: '1',
      tokenDecimal: '6',
      tokenSymbol: 'TOK',
      tokenName: 'Synthetic Delegated Token',
      gas: '50000',
      gasUsed: '45000',
      gasPrice: '20000000000',
      isError: '0',
      // eslint-disable-next-line camelcase -- Explorer receipt wire field.
      txreceipt_status: '1',
    };
    const transaction = {
      hash,
      from: SPENDER,
      to: TOKEN,
      input,
      value: '0x0',
      nonce: '0x7',
      gas: '0xc350',
      gasPrice: '0x4a817c800',
      blockNumber: '0x2a',
      blockHash: BLOCK_HASH,
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
      blockHash: BLOCK_HASH,
      blockNumber: '0x2a',
      from: SPENDER,
      to: TOKEN,
      cumulativeGasUsed: '0xafc8',
      gasUsed: '0xafc8',
      effectiveGasPrice: '0x4a817c800',
      logs: [
        {
          address: TOKEN,
          topics: [
            id('Transfer(address,address,uint256)'),
            abi.encode(['address'], [sender]),
            abi.encode(['address'], [recipient]),
          ],
          data: abi.encode(['uint256'], [AMOUNT]),
          blockNumber: '0x2a',
          transactionHash: hash,
          transactionIndex: '0x0',
          blockHash: BLOCK_HASH,
          logIndex: '0x0',
          removed: false,
        },
      ],
      logsBloom: `0x${'00'.repeat(256)}`,
      status: '0x1',
      type: '0x0',
      contractAddress: null,
    };
    const metadata = new Map([
      [id('name()').slice(0, 10), abi.encode(['string'], [event.tokenName])],
      [id('symbol()').slice(0, 10), abi.encode(['string'], ['TOK'])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [6])],
      [
        id('balanceOf(address)').slice(0, 10),
        abi.encode(['uint256'], [AMOUNT]),
      ],
      [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [AMOUNT])],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    const explorerReads: Array<{
      action: string | null;
      address: string | null;
      rows: number;
      txhash: string | null;
    }> = [];
    const rpcReads: Array<{ method: string; params: unknown[] }> = [];
    const attemptedWrites: string[] = [];
    const unexpectedReads: string[] = [];
    const failedRequests: Array<{ method: string; url: string }> = [];
    const observations: Record<string, unknown> = {};
    let wallet: PaliWallet | undefined;
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'ActivityDirectionSynthetic!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: 'Syscoin NEVM Testnet',
      });
      wallet = await PaliWallet.launch(
        `activity-token-direction-${direction}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api**',
        async (route) => {
          const request = route.request();
          if (request.method() !== 'GET') {
            attemptedWrites.push('non-GET-explorer');
            return route.abort('blockedbyclient');
          }
          const url = new URL(request.url());
          const action = url.searchParams.get('action');
          const address = url.searchParams.get('address');
          let result: unknown;
          if (
            ['txlist', 'tokentx', 'pendingtxlist'].includes(action || '') &&
            address?.toLowerCase() === owner.toLowerCase()
          ) {
            result = action === 'tokentx' ? [event] : [];
          } else if (
            action === 'gettxinfo' &&
            url.searchParams.get('txhash') === hash
          ) {
            result = null;
          } else if (
            ['eth_block_number', 'eth_blockNumber'].includes(action || '')
          ) {
            result = '0x2a';
          } else {
            unexpectedReads.push(`explorer:${action}`);
            return route.fallback();
          }
          explorerReads.push({
            action,
            address,
            rows: Array.isArray(result) ? result.length : 0,
            txhash: url.searchParams.get('txhash'),
          });
          const hasResult = Array.isArray(result)
            ? result.length > 0
            : Boolean(result);
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
            case 'eth_getTransactionCount':
              result = '0x0';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x4a817c800';
              break;
            case 'eth_getCode':
              result =
                call.params[0]?.toLowerCase() === TOKEN ? '0x60006000fd' : '0x';
              break;
            case 'eth_call':
              result =
                call.params[0]?.to?.toLowerCase() === TOKEN
                  ? metadata.get(String(call.params[0]?.data).slice(0, 10))
                  : '0x';
              break;
            case 'eth_getLogs':
              result = [];
              break;
            case 'eth_getTransactionByHash':
              result =
                call.params[0]?.toLowerCase() === hash ? transaction : null;
              break;
            case 'eth_getTransactionReceipt':
              result = call.params[0]?.toLowerCase() === hash ? receipt : null;
              break;
            case 'eth_getBlockByNumber':
              result = {
                number: '0x2a',
                hash: BLOCK_HASH,
                parentHash: `0x${'41'.repeat(32)}`,
                nonce: '0x0000000000000000',
                timestamp: `0x${TIMESTAMP.toString(16)}`,
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0xafc8',
                miner: `0x${'00'.repeat(20)}`,
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
              break;
            default:
              unexpectedReads.push(`rpc:${call.method}`);
          }
          if (result === undefined) return undefined;
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
      const detailButton = page
        .locator('#activity-panel-list')
        .getByRole('button', {
          name: en.notifications.clickToView,
          exact: true,
        });
      const listRow = detailButton.locator(
        'xpath=ancestor::div[contains(@class,"border-b")][1]'
      );
      const listObservation = async () => {
        await expect(detailButton).toHaveCount(1);
        await expect(
          listRow.getByText(expectedDirection, { exact: true })
        ).toBeVisible();
        await expect(listRow).toContainText(
          new RegExp(`\\${sign}\\s*1\\.0 TOK`)
        );
        return {
          text: (await listRow.innerText()).replace(/\s+/g, ' ').trim(),
          state: await publicHistoryState(page, hash),
        };
      };
      let originalState: Awaited<ReturnType<typeof publicHistoryState>>;
      const field = (label: string) =>
        page
          .getByText(label, { exact: true })
          .locator('..')
          .locator('span p')
          .first();
      const fullField = async (label: string, value: string) => {
        const rendered = field(label);
        await rendered.scrollIntoViewIfNeeded();
        await expect(rendered).toHaveText(`0x...${value.slice(-4)}`);
        await rendered.hover();
        const disclosure = rendered.locator('..');
        await expect(disclosure).toHaveAttribute('aria-describedby', /\S/);
        const tooltipId = await disclosure.getAttribute('aria-describedby');
        const tooltip = page
          .locator(`[id="${tooltipId}"]`)
          .getByRole('tooltip');
        await expect(tooltip).toHaveText(value);
        const exact = await tooltip.innerText();
        await page.mouse.move(0, 0);
        await expect(tooltip).toBeHidden();
        return exact;
      };
      await wallet.step(
        `${direction}: load a real token-only Activity row`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page.locator('#activity-btn').click();
          const initial = await listObservation();
          originalState = initial.state;
          expect(originalState.account.address.toLowerCase()).toBe(
            owner.toLowerCase()
          );
          expect(originalState.network).toEqual({
            chainId: 5700,
            kind: 'ethereum',
            url: 'https://rpc.tanenbaum.io',
          });
          expect(originalState.rows).toHaveLength(1);
          expect(originalState.rows[0]).toMatchObject({
            hash,
            from: sender,
            to: TOKEN,
            value: AMOUNT,
            input: '0x',
            chainId: 5700,
            historySource: 'explorer-tokentx',
            tokenRecipient: recipient,
            tokenTransfer: {
              chainId: 5700,
              contractAddress: TOKEN,
              recipient,
              value: AMOUNT,
              decimals: '6',
              symbol: 'TOK',
            },
          });
          expect(
            explorerReads.some(
              (read) => read.action === 'tokentx' && read.rows === 1
            )
          ).toBe(true);
          expect(
            explorerReads
              .filter((read) => read.action === 'txlist')
              .every((read) => read.rows === 0)
          ).toBe(true);
          observations.list = initial;
        }
      );
      await wallet.step(
        `${direction}: retain token direction after provider enrichment`,
        async () => {
          await detailButton.click();
          await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
          await expect
            .poll(() =>
              rpcReads.some(
                (read) =>
                  read.method === 'eth_getTransactionReceipt' &&
                  read.params[0] === hash
              )
            )
            .toBe(true);
          // The provider-only gas field proves enrichment has rendered, not just started.
          await expect(field(en.send.gasLimit)).toHaveText('50,000');
          const details = page.locator('#details-view-content');
          await expect(
            details.getByText(expectedDirection, { exact: true })
          ).toBeVisible();
          await expect(
            details.getByText('1.0 TOK', { exact: true })
          ).toBeVisible();
          observations.header = {
            direction: await details
              .getByText(expectedDirection, { exact: true })
              .innerText(),
            amount: await details
              .getByText('1.0 TOK', { exact: true })
              .innerText(),
            state: await publicHistoryState(page, hash),
          };
        }
      );
      await wallet.step(
        `${direction}: preserve outer sender and exact token recipient`,
        async () => {
          observations.details = {
            from: await fullField('From', SPENDER),
            to: await fullField('To', recipient),
            hash: await fullField(en.send.transactionId, hash),
            input: await fullField('Input', input),
          };
          for (const [label, expected] of [
            ['Gas Price', '20.00 Gwei'],
            ['Gas Used', '45,000'],
            [en.send.gasLimit, '50,000'],
            ['Success', 'Success'],
          ]) {
            await expect(field(label)).toHaveText(expected);
          }
          observations.provider = {
            gasPrice: await field('Gas Price').innerText(),
            gasUsed: await field('Gas Used').innerText(),
            gasLimit: await field(en.send.gasLimit).innerText(),
            success: await field('Success').innerText(),
            state: await publicHistoryState(page, hash),
          };
        }
      );
      await wallet.step(
        `${direction}: restore the same token Activity row with Back`,
        async () => {
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home(?:\?|$)/);
          const returned = await listObservation();
          expect(returned.state).toEqual(originalState);
          observations.returned = returned;
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      expect(unexpectedReads).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      status = 'passed';
    } finally {
      try {
        await info.attach('activity-token-direction-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            direction,
            owner,
            sender,
            recipient,
            spender: SPENDER,
            token: TOKEN,
            hash,
            amount: AMOUNT,
            input,
            event,
            transaction,
            receipt,
            runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            wireSha256: createHash('sha256')
              .update(JSON.stringify({ event, transaction, receipt }))
              .digest('hex'),
            observations,
            explorerReads,
            rpcReads,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            attemptedWrites,
            unexpectedReads,
            failedRequests,
            proxyDeniedRequests: server?.blocked || [],
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            signingOrBroadcastRequested: false,
          }),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server?.close();
          } finally {
            Object.assign(E2E_CONFIG, original);
          }
        }
      }
    }
  });
}
