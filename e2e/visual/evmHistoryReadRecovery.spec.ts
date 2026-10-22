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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const publicHistory = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, activeNetwork, accounts, accountTransactions } =
      state.vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id];
    return {
      account: {
        id: activeAccount.id,
        type: activeAccount.type,
        address: account?.address,
      },
      network: {
        chainId: activeNetwork.chainId,
        kind: activeNetwork.kind,
        url: activeNetwork.url,
        apiUrl: activeNetwork.apiUrl,
      },
      transactions: (
        accountTransactions[activeAccount.type]?.[activeAccount.id]?.ethereum?.[
          activeNetwork.chainId
        ] || []
      ).map((transaction: any) => ({
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
        from: transaction.from,
        to: transaction.to,
      })),
    };
  });

test('initial EVM explorer failure recovers on the next ordinary alarm before failed-result cache expiry', async ({}, info) => {
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
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const owners = fixture.evmAddresses.map((address) => address.toLowerCase());
  const hash = `0x${'a7'.repeat(32)}`;
  const latestBlock = 100;
  const historicalBlock = 42;
  const transaction = {
    hash,
    from: `0x${'33'.repeat(20)}`,
    to: fixture.evmAddresses[1],
    value: '0',
    input: '0x',
    nonce: '7',
    blockNumber: String(historicalBlock),
    blockHash: `0x${'42'.repeat(32)}`,
    timeStamp: String(Math.floor(Date.now() / 1000) - 86400),
    confirmations: String(latestBlock - historicalBlock + 1),
    chainId: '5700',
    type: '2',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '1000000000',
    isError: '0',
    // eslint-disable-next-line camelcase -- Explorer wire field.
    txreceipt_status: '1',
  };
  type HistoryRead = {
    action: string;
    at: number;
    completedAt?: number;
    owner: number;
    phase: 'empty' | 'held-failure' | 'recovered';
    status?: number;
  };
  const historyReads: HistoryRead[] = [];
  const rpcReads: Array<{ at: number; method: string; params: unknown[] }> = [];
  const unexpected: string[] = [];
  const attemptedWrites: string[] = [];
  const pageErrors: string[] = [];
  const releases = new Set<() => void>();
  const observations: Record<string, unknown> = {};
  let recovered = false;
  let wallet: PaliWallet | undefined;
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const releaseHeld = () => {
    for (const release of releases) release();
    releases.clear();
  };
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'EvmHistoryRecoverySyntheticOnly!2026',
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('evm-history-read-recovery', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      const replies = calls.map((call: any) => {
        const method = String(call?.method || '');
        const params = call?.params;
        if (
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
            method
          )
        ) {
          attemptedWrites.push(method);
          return undefined;
        }
        if (call?.jsonrpc !== '2.0' || !Array.isArray(params)) {
          unexpected.push(`rpc-envelope:${method}`);
          return undefined;
        }
        let result: unknown;
        if (method === 'eth_chainId') result = '0x1644';
        else if (method === 'net_version') result = '5700';
        else if (method === 'eth_blockNumber') result = '0x64';
        else if (
          ['eth_getBalance', 'eth_getTransactionCount', 'eth_getCode'].includes(
            method
          ) &&
          owners.includes(String(params[0]).toLowerCase())
        )
          result = method === 'eth_getCode' ? '0x' : '0x0';
        else if (['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(method))
          result = '0x3b9aca00';
        else if (method === 'eth_getBlockByNumber') {
          const number =
            params[0] === 'latest' ? latestBlock : Number(params[0]);
          if (Number.isInteger(number) && number >= 0 && number <= latestBlock)
            result = {
              number: `0x${number.toString(16)}`,
              hash: `0x${number.toString(16).padStart(64, '0')}`,
              parentHash: `0x${Math.max(0, number - 1)
                .toString(16)
                .padStart(64, '0')}`,
              nonce: '0x0000000000000000',
              timestamp: '0x65500000',
              difficulty: '0x0',
              gasLimit: '0x1c9c380',
              gasUsed: '0x0',
              miner: `0x${'00'.repeat(20)}`,
              extraData: '0x',
              transactions: [],
              baseFeePerGas: '0x3b9aca00',
            };
        }
        if (result === undefined) {
          unexpected.push(`rpc:${method}:${JSON.stringify(params)}`);
          return undefined;
        }
        rpcReads.push({ at: Date.now(), method, params });
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.length || replies.some((reply) => reply === undefined))
        return route.abort('blockedbyclient');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    await wallet.context.route(
      'https://explorer.tanenbaum.io/api**',
      async (route) => {
        const url = new URL(route.request().url());
        const action = url.searchParams.get('action') || '';
        const owner = owners.indexOf(
          String(url.searchParams.get('address')).toLowerCase()
        );
        const accountAction = [
          'txlist',
          'tokentx',
          'pendingtxlist',
          'tokenlist',
        ].includes(action);
        if (
          route.request().method() !== 'GET' ||
          (accountAction && owner < 0) ||
          (!accountAction &&
            !['eth_block_number', 'eth_blockNumber'].includes(action))
        ) {
          unexpected.push(`explorer:${route.request().method()}:${url.href}`);
          return route.abort('blockedbyclient');
        }
        const required = action === 'txlist' || action === 'tokentx';
        const phase =
          owner !== 1 ? 'empty' : recovered ? 'recovered' : 'held-failure';
        const record: HistoryRead | undefined = required
          ? { action, at: Date.now(), owner, phase }
          : undefined;
        if (record) historyReads.push(record);
        if (record?.phase === 'held-failure')
          await new Promise<void>((resolve) => releases.add(resolve));
        const failed = record?.phase === 'held-failure';
        const result =
          action === 'eth_block_number' || action === 'eth_blockNumber'
            ? '0x64'
            : phase === 'recovered' && action === 'txlist'
            ? [transaction]
            : [];
        await route.fulfill({
          status: failed ? 500 : 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(
            failed
              ? { error: 'Synthetic initial explorer unavailable' }
              : {
                  status: '1',
                  message: 'OK',
                  result,
                }
          ),
        });
        if (record) {
          record.completedAt = Date.now();
          record.status = failed ? 500 : 200;
        }
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const step = (name: string, action: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        try {
          await action();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    await step(
      'healthy empty explorer history remains an ordinary empty account',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect(
          page.getByText(en.home.youHaveNoTxs, { exact: true })
        ).toBeVisible();
        expect(historyReads).toEqual(
          expect.arrayContaining(
            ['txlist', 'tokentx'].map((action) =>
              expect.objectContaining({ owner: 0, action, status: 200 })
            )
          )
        );
        const state = await publicHistory(page);
        expect(state.account).toEqual({
          id: 0,
          type: 'HDAccount',
          address: fixture.evmAddresses[0],
        });
        expect(state.transactions).toEqual([]);
        observations.healthyEmpty = state;
      }
    );
    const worker = wallet.context.serviceWorkers()[0];
    expect(worker).toBeTruthy();
    // These additive observers never reply, replace state, invoke a poll or
    // change clocks/alarms. Recovery must come from the existing listener.
    await worker.evaluate(() => {
      const audit = {
        alarms: [] as Array<{ at: number; scheduledTime: number }>,
        manualRefreshes: [] as number[],
        pollingStarts: [] as Array<{ at: number; url?: string }>,
      };
      (globalThis as any).__evmHistoryRecoveryAudit = audit;
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'check_for_updates')
          audit.alarms.push({
            at: Date.now(),
            scheduledTime: alarm.scheduledTime,
          });
      });
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message?.type === 'startPolling')
          audit.pollingStarts.push({ at: Date.now(), url: sender.url });
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          JSON.stringify(message.data?.methods) === JSON.stringify(['refresh'])
        )
          audit.manualRefreshes.push(Date.now());
      });
    });
    await step(
      'ordinary account creation starts an uncached initial history read',
      async () => {
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', {
            name: en.accountMenu.createNewAccount,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/account\/new$/);
        await page.locator('#create-btn').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect
          .poll(() =>
            ['txlist', 'tokentx'].every((action) =>
              historyReads.some(
                (read) =>
                  read.phase === 'held-failure' && read.action === action
              )
            )
          )
          .toBe(true);
        const state = await publicHistory(page);
        expect(state.account).toEqual({
          id: 1,
          type: 'HDAccount',
          address: fixture.evmAddresses[1],
        });
        expect(state.transactions).toEqual([]);
        expect(state.network).toEqual({
          chainId: 5700,
          kind: 'ethereum',
          url: 'https://rpc.tanenbaum.io',
          apiUrl: 'https://explorer.tanenbaum.io/api',
        });
        observations.beforeFailure = state;
      }
    );
    let scheduledTime = 0;
    await step(
      'native toolbar popup arms the existing one-minute ordinary alarm',
      async () => {
        const openedAt = Date.now();
        await worker.evaluate(() => chrome.action.openPopup());
        // Do not click, reload, navigate or resize the driver tab after this
        // point: that could close the genuine toolbar popup.
        await expect
          .poll(async () => {
            const value = await worker.evaluate(async () => ({
              contexts: await (chrome.runtime as any).getContexts({
                contextTypes: ['POPUP'],
              }),
              alarm: await chrome.alarms.get('check_for_updates'),
            }));
            const popup = value.contexts.some(
              (context: any) =>
                context.contextType === 'POPUP' &&
                context.documentUrl?.startsWith(
                  `chrome-extension://${wallet!.extensionId}/app.html`
                )
            );
            if (
              !popup ||
              value.alarm?.periodInMinutes !== 1 ||
              value.alarm.scheduledTime < openedAt + 45_000
            )
              return false;
            scheduledTime = value.alarm.scheduledTime;
            observations.naturalAlarm = { openedAt, ...value };
            return true;
          })
          .toBe(true);
      }
    );
    let lastFailureAt = 0;
    await step(
      'failed explorer feeds finish after arming without manufacturing success',
      async () => {
        const held = historyReads.filter(
          (read) => read.phase === 'held-failure'
        );
        const releaseAt = scheduledTime - 50_000;
        expect(
          releaseAt - Math.min(...held.map((read) => read.at))
        ).toBeLessThan(25_000);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, releaseAt - Date.now()))
        );
        releaseHeld();
        await expect
          .poll(() => held.every((read) => read.completedAt))
          .toBe(true);
        lastFailureAt = Math.max(...held.map((read) => read.completedAt!));
        expect(held.every((read) => read.status === 500)).toBe(true);
        expect(scheduledTime - lastFailureAt).toBeGreaterThan(5_000);
        expect(scheduledTime - lastFailureAt).toBeLessThan(60_000);
        recovered = true;
        const state = await publicHistory(page);
        expect(state.transactions).toEqual([]);
        expect(state.account.address).toBe(fixture.evmAddresses[1]);
        observations.failedReads = held;
        observations.afterFailure = state;
        expect(historyReads.some((read) => read.phase === 'recovered')).toBe(
          false
        );
      }
    );
    await step(
      'the next real alarm displays recovered old history inside the failed-result cache interval',
      async () => {
        // This is the real production alarm cadence, not a replaced timer or a
        // direct controller invocation. Its scheduled time was read above.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, scheduledTime - Date.now()))
        );
        await expect
          .poll(async () =>
            worker.evaluate(
              () => (globalThis as any).__evmHistoryRecoveryAudit.alarms.length
            )
          )
          .toBeGreaterThan(0);
        await expect
          .poll(() =>
            ['txlist', 'tokentx'].every((action) =>
              historyReads.some(
                (read) => read.phase === 'recovered' && read.action === action
              )
            )
          )
          .toBe(true);
        await expect
          .poll(async () => (await publicHistory(page)).transactions)
          .toEqual([
            {
              hash,
              blockNumber: historicalBlock,
              from: transaction.from,
              to: transaction.to,
            },
          ]);
        await expect(
          page.locator('#activity-panel-list').getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          })
        ).toHaveCount(1);
        await expect(
          page.getByText(en.home.youHaveNoTxs, { exact: true })
        ).toHaveCount(0);
        const audit = await worker.evaluate(
          () => (globalThis as any).__evmHistoryRecoveryAudit
        );
        const alarm = audit.alarms.find(
          (item: any) => item.scheduledTime === scheduledTime
        );
        expect(alarm).toBeTruthy();
        const reads = historyReads.filter((read) => read.phase === 'recovered');
        for (const action of ['txlist', 'tokentx']) {
          const read = reads.find((item) => item.action === action)!;
          expect(read).toBeTruthy();
          expect(read.owner).toBe(1);
          expect(read.at).toBeGreaterThanOrEqual(alarm.at);
          expect(read.at - lastFailureAt).toBeGreaterThan(5_000);
          expect(read.at - lastFailureAt).toBeLessThan(60_000);
        }
        expect(audit.manualRefreshes).toEqual([]);
        expect(
          audit.pollingStarts.some(
            (item: any) =>
              item.at >= (observations.naturalAlarm as any).openedAt &&
              item.url?.startsWith(
                `chrome-extension://${wallet!.extensionId}/app.html`
              )
          )
        ).toBe(true);
        const state = await publicHistory(page);
        expect(state.account).toEqual(
          (observations.beforeFailure as any).account
        );
        expect(state.network).toEqual(
          (observations.beforeFailure as any).network
        );
        expect(historicalBlock).toBeLessThan(latestBlock - 30);
        observations.recovered = { state, audit, reads };
      }
    );
    expect(rpcReads.some((read) => read.method === 'eth_getBalance')).toBe(
      true
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    releaseHeld();
    try {
      await info.attach('evm-history-read-recovery-observations', {
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            historyReads,
            rpcReads,
            observations,
            attemptedWrites,
            unexpected,
            pageErrors,
            fixtureReads: routes?.reads || [],
            fixtureDeniedWrites: routes?.deniedWrites || [],
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server?.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
