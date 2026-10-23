import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const hex = (value: number | bigint) => `0x${value.toString(16)}`;
const hash = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const RPC = 'https://rpc.tanenbaum.io/';
const API = 'https://explorer.tanenbaum.io/api';
const AMOUNT = '1.25 TSYS';

// Read-only observations: no runtime, Redux, storage, clock or controller
// replacement. In particular, do not populate the saved route with a tx body.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, activeNetwork, accountTransactions, accounts } =
      state.vault;
    const saved = await chrome.storage.local.get('pali_navigation_state');
    return {
      activeAccount,
      address: accounts[activeAccount.type]?.[activeAccount.id]?.address,
      network: {
        kind: activeNetwork.kind,
        chainId: activeNetwork.chainId,
        url: activeNetwork.url,
        apiUrl: activeNetwork.apiUrl,
      },
      historyHashes: (
        accountTransactions?.[activeAccount.type]?.[activeAccount.id]
          ?.ethereum?.[activeNetwork.chainId] || []
      ).map((tx: { hash: string }) => tx.hash),
      // Navigation persistence has a public-field allowlist. Keep its exact
      // record to prove the ordinary restoration input, including absence of tx.
      savedNavigation: saved.pali_navigation_state,
      route: {
        pathname: location.hash,
        hash: history.state?.usr?.hash,
        hasTx: Object.prototype.hasOwnProperty.call(
          history.state?.usr || {},
          'tx'
        ),
      },
    };
  });

async function assertRendered(page: Page, expectedHash: string) {
  await expect(page.locator('#details-view-content')).toBeVisible();
  await expect(page.getByText(AMOUNT, { exact: true })).toBeVisible();
  const copy = page.getByRole('button', {
    name: `${en.buttons.copy}: ${en.send.transactionId}`,
    exact: true,
  });
  await expect(copy).toHaveCount(1);
  // The normal focusable tooltip reveals the full hash without a clipboard
  // shim or changing the displayed transaction.
  await copy.locator('..').focus();
  await expect(page.getByRole('tooltip')).toHaveText(expectedHash);
  await page.keyboard.press('Escape');
  await expect(
    page.getByText(en.transactions.transactionNotFoundOrPending, {
      exact: true,
    })
  ).toHaveCount(0);
}

for (const mode of ['fast explorer', 'stalled explorer'] as const) {
  test(`older transaction detail restoration uses ${
    mode === 'fast explorer'
      ? 'the healthy explorer response'
      : 'healthy RPC after the explorer deadline'
  }`, async ({}, info) => {
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
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const [sender, recipient] = fixture.evmAddresses;
    const timestamp = Math.floor(Date.now() / 1000);
    const rows = Array.from({ length: 60 }, (_, index) => ({
      hash: hash(10_000 + index),
      from: sender,
      to: recipient,
      value: index === 59 ? '1250000000000000000' : '10000000000000000',
      input: '0x',
      nonce: String(59 - index),
      blockNumber: String(100 - index),
      blockHash: hash(20_000 + 100 - index),
      timeStamp: String(timestamp - index * 12),
      timestamp: timestamp - index * 12,
      confirmations: String(index + 1),
      chainId: 5700,
      type: '0',
      gas: '21000',
      gasLimit: '21000',
      gasUsed: '21000',
      gasPrice: '1000000000',
      isError: '0',
      // eslint-disable-next-line camelcase -- Genuine explorer response field.
      txreceipt_status: '1',
    }));
    const older = rows[59];
    const firstWindow = rows.slice(0, 30).map((row) => row.hash);
    let phase = 'setup';
    let heldAt = 0;
    let heldArrivals = 0;
    let heldCompletions = 0;
    let release!: () => void;
    const heldResponse = new Promise<void>((resolve) => (release = resolve));
    const timeline: Array<Record<string, unknown>> = [];
    const attemptedWrites: string[] = [];
    const unexpectedReads: Array<Record<string, unknown>> = [];
    const pageErrors: string[] = [];
    const requestFailures: Array<{ method: string; url: string }> = [];
    const observations: Record<string, any> = {
      mode,
      runtime,
      sourceSha256,
      syntheticHttpOnly: true,
      replacementBoundaries: [],
      signingOrBroadcastRequested: false,
      expectedOlderHash: older.hash,
      expectedAmount: AMOUNT,
      milestones: {},
    };
    let wallet: PaliWallet | undefined;
    let page: Page | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'TransactionReadRecoverySynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(
        `transaction-read-${mode.replace(' ', '-')}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      const observe = (observed: Page) => {
        observed.on('pageerror', (error) => pageErrors.push(error.message));
      };
      wallet.context.pages().forEach(observe);
      wallet.context.on('page', observe);
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          requestFailures.push({
            method: request.method(),
            url: request.url(),
          });
      });
      wallet.context.on('request', (request) => {
        if (/\/sendtx(?:\/|$)/i.test(request.url()))
          attemptedWrites.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              attemptedWrites.push(call.method);
        } catch {
          // Ordinary read-only REST has no JSON request body.
        }
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      observations.workerIdentity = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (identity) => {
          observations.workerIdentity = identity;
        }
      );
      await wallet.context.route(`${API}**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const action = url.searchParams.get('action');
        const txhash = url.searchParams.get('txhash');
        const address = url.searchParams.get('address');
        const entry: Record<string, unknown> = {
          transport: 'explorer',
          phase,
          action,
          txhash,
          page: url.searchParams.get('page'),
          offset: url.searchParams.get('offset'),
          startedAt: Date.now(),
        };
        timeline.push(entry);
        if (request.method() !== 'GET') {
          attemptedWrites.push('non-GET-explorer');
          return route.abort('blockedbyclient');
        }
        let result: unknown;
        if (
          ['txlist', 'tokentx', 'pendingtxlist'].includes(action || '') &&
          address?.toLowerCase() === sender.toLowerCase()
        ) {
          const size = Number(url.searchParams.get('offset') || 60);
          const requestedPage = Number(url.searchParams.get('page') || 1);
          result =
            action === 'txlist'
              ? rows.slice((requestedPage - 1) * size, requestedPage * size)
              : [];
        } else if (action === 'gettxinfo') {
          result = rows.find((row) => row.hash === txhash);
        } else if (
          ['eth_block_number', 'eth_blockNumber'].includes(action || '')
        ) {
          result = '0x64';
        }
        if (result === undefined) {
          unexpectedReads.push({ transport: 'explorer', url: url.href });
          return route.abort('blockedbyclient');
        }
        entry.rows = Array.isArray(result) ? result.length : undefined;
        if (
          mode === 'stalled explorer' &&
          phase === 'restored-detail' &&
          action === 'gettxinfo' &&
          txhash === older.hash
        ) {
          heldAt ||= Date.now();
          heldArrivals += 1;
          entry.held = true;
          await heldResponse;
        }
        try {
          const empty = Array.isArray(result) && result.length === 0;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              status: empty ? '0' : '1',
              message: empty ? 'No transactions found' : 'OK',
              result,
            }),
          });
          entry.completedAt = Date.now();
        } finally {
          if (entry.held) heldCompletions += 1;
        }
      });
      await wallet.context.route(RPC, async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') return route.fallback();
        const body = request.postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        const replies = calls.map((call: any) => {
          if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return undefined;
          const { method, params } = call;
          const row = rows.find((item) => item.hash === params[0]);
          let result: unknown;
          switch (method) {
            case 'eth_chainId':
              result = '0x1644';
              break;
            case 'net_version':
              result = '5700';
              break;
            case 'eth_blockNumber':
              result = '0x64';
              break;
            case 'eth_getTransactionCount':
              if (
                fixture.evmAddresses.some(
                  (address) =>
                    address.toLowerCase() === String(params[0]).toLowerCase()
                )
              )
                result =
                  String(params[0]).toLowerCase() === sender.toLowerCase()
                    ? '0x3c'
                    : '0x0';
              break;
            case 'eth_getBalance':
              if (
                fixture.evmAddresses.some(
                  (address) =>
                    address.toLowerCase() === String(params[0]).toLowerCase()
                )
              )
                result = '0x0';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getCode':
              if (/^0x[0-9a-f]{40}$/i.test(String(params[0]))) result = '0x';
              break;
            case 'eth_getLogs':
              result = [];
              break;
            case 'eth_call':
              if (
                /^0x[0-9a-f]{40}$/i.test(String(params[0]?.to)) &&
                /^0x[0-9a-f]*$/i.test(String(params[0]?.data))
              )
                result = '0x';
              break;
            case 'eth_getTransactionByHash':
              if (row)
                result = {
                  hash: row.hash,
                  from: row.from,
                  to: row.to,
                  input: row.input,
                  value: hex(BigInt(row.value)),
                  nonce: hex(Number(row.nonce)),
                  gas: '0x5208',
                  gasPrice: '0x3b9aca00',
                  blockNumber: hex(Number(row.blockNumber)),
                  blockHash: row.blockHash,
                  transactionIndex: '0x0',
                  chainId: '0x1644',
                  type: '0x0',
                  r: `0x${'01'.repeat(32)}`,
                  s: `0x${'02'.repeat(32)}`,
                  v: '0x1b',
                };
              break;
            case 'eth_getTransactionReceipt':
              if (row)
                result = {
                  transactionHash: row.hash,
                  transactionIndex: '0x0',
                  blockHash: row.blockHash,
                  blockNumber: hex(Number(row.blockNumber)),
                  from: row.from,
                  to: row.to,
                  cumulativeGasUsed: '0x5208',
                  gasUsed: '0x5208',
                  effectiveGasPrice: '0x3b9aca00',
                  logs: [],
                  logsBloom: `0x${'00'.repeat(256)}`,
                  status: '0x1',
                  type: '0x0',
                  contractAddress: null,
                };
              break;
            case 'eth_getBlockByNumber': {
              const number = ['latest', 'pending'].includes(params[0])
                ? 100
                : /^0x[0-9a-f]+$/i.test(String(params[0]))
                ? Number(BigInt(params[0]))
                : -1;
              if (number === 0 || (number >= 41 && number <= 100))
                result = {
                  number: hex(number),
                  hash: hash(20_000 + number),
                  parentHash: hash(20_000 + Math.max(0, number - 1)),
                  nonce: '0x0000000000000000',
                  timestamp: hex(timestamp - (100 - number) * 12),
                  difficulty: '0x0',
                  gasLimit: '0x1c9c380',
                  gasUsed: '0x5208',
                  miner: `0x${'00'.repeat(20)}`,
                  extraData: '0x',
                  transactions: [],
                  baseFeePerGas: '0x3b9aca00',
                };
              break;
            }
          }
          timeline.push({
            transport: 'rpc',
            phase,
            method,
            params,
            startedAt: Date.now(),
            supported: result !== undefined,
          });
          return result === undefined
            ? undefined
            : { jsonrpc: '2.0', id: call.id, result };
        });
        if (replies.some((reply) => reply === undefined)) {
          unexpectedReads.push(
            ...calls.map((call: any) => ({
              transport: 'rpc',
              method: call?.method,
              params: call?.params,
            }))
          );
          return route.abort('blockedbyclient');
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      });
      page = wallet.page;
      const step = (name: string, action: () => Promise<void>) =>
        wallet!.step(name, async (capture) => {
          try {
            await action();
          } finally {
            if (page && !page.isClosed()) await capture(page);
          }
        });
      await step(
        'load real first window, then select an older paginated transaction',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page!.locator('#activity-btn').click();
          const buttons = page!
            .locator('#activity-panel-list')
            .getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            });
          await expect(buttons).toHaveCount(30);
          await expect
            .poll(async () => (await publicState(page!)).historyHashes)
            .toEqual(firstWindow);
          observations.firstWindow = await publicState(page!);
          expect(observations.firstWindow.historyHashes).not.toContain(
            older.hash
          );
          const more = page!.getByRole('button', {
            name: en.buttons.loadMore,
            exact: true,
          });
          await more.scrollIntoViewIfNeeded();
          await more.click();
          await expect(buttons).toHaveCount(60);
          expect(timeline).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                transport: 'explorer',
                action: 'txlist',
                page: '2',
                offset: '30',
                rows: 30,
              }),
            ])
          );
          observations.afterLoadMore = await publicState(page!);
          expect(observations.afterLoadMore.historyHashes).toEqual(firstWindow);
          expect(observations.afterLoadMore.historyHashes).not.toContain(
            older.hash
          );
          await buttons.last().click();
          await expect(page!).toHaveURL(/#\/home\/details/);
          await assertRendered(page!, older.hash);
          await expect
            .poll(
              async () =>
                (
                  await publicState(page!)
                ).savedNavigation?.state?.hash
            )
            .toBe(older.hash);
          observations.selected = await publicState(page!);
          expect(observations.selected.route.hash).toBe(older.hash);
          expect(observations.selected.savedNavigation.currentPath).toBe(
            '/home/details'
          );
          expect(
            observations.selected.savedNavigation.state
          ).not.toHaveProperty('tx');
          observations.milestones.setupHealthy = true;
        }
      );
      await step(
        'close the document and restore the hash-only public route from neutral entry',
        async () => {
          phase = 'restored-detail';
          await page!.close();
          page = await wallet!.context.newPage();
          await page.goto(wallet!.appUrl('#/'));
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect(page.locator('body.app-loaded')).toBeAttached();
          observations.restoredInput = await publicState(page);
          expect(observations.restoredInput.route.hash).toBe(older.hash);
          expect(observations.restoredInput.route.hasTx).toBe(false);
          expect(observations.restoredInput.historyHashes).toEqual(firstWindow);
          expect(observations.restoredInput.historyHashes).not.toContain(
            older.hash
          );
          expect(observations.restoredInput.address).toBe(sender);
          expect(observations.restoredInput.network).toMatchObject({
            kind: 'ethereum',
            chainId: 5700,
            url: new URL(RPC).origin,
            apiUrl: API,
          });
          if (mode === 'stalled explorer') {
            await expect.poll(() => heldArrivals).toBeGreaterThan(0);
            // Real elapsed time only. This does not alter the controller's 10s
            // timeout or the HTTP transport; the server gate remains held.
            await expect
              .poll(() => Date.now() - heldAt, { timeout: 15_000 })
              .toBeGreaterThanOrEqual(11_000);
            expect(heldCompletions).toBe(0);
          }
          const amount = page.getByText(AMOUNT, { exact: true });
          const unavailable = page.getByText(
            en.transactions.transactionNotFoundOrPending,
            { exact: true }
          );
          await expect
            .poll(
              async () =>
                (await amount.isVisible()) || (await unavailable.isVisible()),
              { timeout: 15_000 }
            )
            .toBe(true);
          const rpc = timeline.filter(
            (entry) => entry.phase === phase && entry.transport === 'rpc'
          );
          observations.restoredOutcome = {
            heldArrivals,
            heldCompletions,
            heldForMs: heldAt ? Date.now() - heldAt : 0,
            amountVisible: await amount.isVisible(),
            unavailableVisible: await unavailable.isVisible(),
            hashCopyCount: await page
              .getByRole('button', {
                name: `${en.buttons.copy}: ${en.send.transactionId}`,
                exact: true,
              })
              .count(),
            rpcMethods: rpc.map((entry) => entry.method),
            rpcTransactionReads: rpc.filter(
              (entry) =>
                entry.method === 'eth_getTransactionByHash' &&
                (entry.params as string[])[0] === older.hash
            ).length,
          };
          observations.milestones.reopenObserved = true;
          // Soft only at the proposed product boundary so the recovery and no-
          // mutation controls still complete on an unfixed build.
          expect
            .soft(
              observations.restoredOutcome,
              'restored older details remain available'
            )
            .toMatchObject({
              amountVisible: true,
              unavailableVisible: false,
              hashCopyCount: 1,
            });
          if (mode === 'stalled explorer')
            expect
              .soft(
                observations.restoredOutcome.rpcMethods,
                'canonical RPC fallback executes after explorer timeout'
              )
              .toEqual(
                expect.arrayContaining([
                  'eth_getTransactionByHash',
                  'eth_getTransactionReceipt',
                  'eth_blockNumber',
                  'eth_getBlockByNumber',
                ])
              );
          if (observations.restoredOutcome.amountVisible)
            await assertRendered(page, older.hash);
          observations.milestones.intendedAssertionsEvaluated = true;
        }
      );
      await step(
        'release the HTTP response, then reopen and return through ordinary Back',
        async () => {
          phase = 'healthy-reopen';
          release();
          if (heldArrivals)
            await expect.poll(() => heldCompletions).toBe(heldArrivals);
          await page!.close();
          page = await wallet!.context.newPage();
          await page.goto(wallet!.appUrl('#/'));
          await expect(page).toHaveURL(/#\/home\/details/);
          await assertRendered(page, older.hash);
          observations.recovered = await publicState(page);
          expect(observations.recovered.address).toBe(sender);
          expect(observations.recovered.route.hash).toBe(older.hash);
          expect(observations.recovered.route.hasTx).toBe(false);
          expect(observations.recovered.historyHashes).not.toContain(
            older.hash
          );
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?|$)/);
          observations.afterBack = await publicState(page);
          expect(observations.afterBack.address).toBe(sender);
          expect(observations.afterBack.activeAccount).toEqual(
            observations.firstWindow.activeAccount
          );
          observations.milestones.recoveryHealthy = true;
        }
      );
      expect(attemptedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      expect(unexpectedReads).toEqual([]);
      expect(pageErrors).toEqual([]);
      observations.milestones.safetyHealthy = true;
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      release();
      observations.status = status;
      observations.classification =
        status === 'passed'
          ? 'healthy'
          : observations.milestones.setupHealthy &&
            observations.milestones.reopenObserved &&
            observations.milestones.intendedAssertionsEvaluated &&
            observations.milestones.recoveryHealthy &&
            observations.milestones.safetyHealthy
          ? 'intended-product-boundary-failure'
          : 'incomplete-or-harness-failure';
      const evidence = info.outputPath('transaction-detail-read-recovery.json');
      try {
        fs.writeFileSync(
          evidence,
          JSON.stringify(
            {
              ...observations,
              timeline,
              attemptedWrites,
              unexpectedReads,
              pageErrors,
              requestFailures,
              baseFixtureReads: routes?.reads,
              baseFixtureDeniedWrites: routes?.deniedWrites,
              proxyDeniedConnections: server.blocked.length,
            },
            null,
            2
          )
        );
        await info.attach('transaction-detail-read-recovery', {
          path: evidence,
          contentType: 'application/json',
        });
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
