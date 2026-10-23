import { expect, test, type Locator, type Page } from '@playwright/test';
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
      historyStatus: state.vaultGlobal.transactionHistoryStatus,
    };
  });

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press('Tab');
    if (await control.evaluate((element) => element === document.activeElement))
      return;
  }
  await expect(control).toBeFocused();
};

const visibleBounds = async (page: Page, control: Locator) => {
  await control.scrollIntoViewIfNeeded();
  const geometry = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const points = [
      [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      [bounds.left + 2, bounds.top + 2],
      [bounds.right - 2, bounds.bottom - 2],
    ];
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      hits: points.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || Boolean(hit && element.contains(hit));
      }),
    };
  });
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.documentWidth).toBe(geometry.viewportWidth);
  expect(geometry.hits).toEqual([true, true, true]);
  return geometry;
};

test('configured EVM history explains failed reads and retries the same account from Activity', async ({}, info) => {
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
  const hash = '0x' + 'a8'.repeat(32);
  // Match installIsolatedVaultRoutes' unchanged synthetic current block.
  const transaction = {
    hash,
    from: '0x' + '33'.repeat(20),
    to: fixture.evmAddresses[1],
    value: '0',
    input: '0x',
    nonce: '7',
    blockNumber: '1',
    blockHash: '0x' + '12'.repeat(32),
    timeStamp: String(Math.floor(Date.now() / 1000) - 86400),
    confirmations: '1',
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
    phase: 'empty' | 'failed' | 'recovered';
    status?: number;
  };
  const historyReads: HistoryRead[] = [];
  const unexpected: string[] = [];
  const attemptedWrites: string[] = [];
  const pageErrors: string[] = [];
  const observations: Record<string, unknown> = {};
  let recovered = false;
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
      password: 'EvmHistoryFeedbackSyntheticOnly!2026',
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('evm-history-failure-feedback', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only exact explorer HTTP replies vary. The existing public RPC/Blockbook
    // fixtures, deny proxy, actual SDK/controller/store and clocks stay intact.
    await wallet.context.route(
      'https://explorer.tanenbaum.io/api**',
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
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
          request.method() !== 'GET' ||
          url.pathname !== '/api' ||
          (accountAction &&
            (owner < 0 || url.searchParams.get('module') !== 'account')) ||
          (!accountAction &&
            !['eth_block_number', 'eth_blockNumber'].includes(action))
        ) {
          if (request.method() !== 'GET')
            attemptedWrites.push(request.method() + ' ' + url.href);
          unexpected.push(request.method() + ' ' + url.href);
          return route.abort('blockedbyclient');
        }
        const required = action === 'txlist' || action === 'tokentx';
        const phase =
          owner !== 1 ? 'empty' : recovered ? 'recovered' : 'failed';
        const record: HistoryRead | undefined = required
          ? { action, at: Date.now(), owner, phase }
          : undefined;
        if (record) historyReads.push(record);
        const failed = required && phase === 'failed';
        const result =
          action === 'eth_block_number' || action === 'eth_blockNumber'
            ? '0x1'
            : phase === 'recovered' && action === 'txlist'
            ? [transaction]
            : [];
        await route.fulfill({
          status: failed ? 500 : 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(
            failed
              ? { error: 'Synthetic explorer history unavailable' }
              : { status: '1', message: 'OK', result }
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
    const empty = page.getByText(en.home.youHaveNoTxs, { exact: true });
    const error = page.getByText(en.send.unableToLoad, { exact: true });
    const retry = page.getByRole('button', {
      name: en.receive.retry,
      exact: true,
    });

    await step(
      'healthy configured empty history is still genuinely empty',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect
          .poll(() =>
            ['txlist', 'tokentx'].every((action) =>
              historyReads.some(
                (read) =>
                  read.owner === 0 &&
                  read.action === action &&
                  read.phase === 'empty' &&
                  read.status === 200 &&
                  read.completedAt !== undefined
              )
            )
          )
          .toBe(true);
        await expect(empty).toBeVisible();
        await expect(error).toHaveCount(0);
        await expect(retry).toHaveCount(0);
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
    // Additive, read-only request observation. It never replies, invokes the
    // controller, changes state/results or alters clocks/alarms.
    await worker.evaluate(() => {
      const audit = { retries: [] as Array<{ at: number; params: unknown[] }> };
      (globalThis as any).__evmHistoryFeedbackAudit = audit;
      chrome.runtime.onMessage.addListener((message) => {
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          JSON.stringify(message.data?.methods) ===
            JSON.stringify(['wallet', 'refreshTransactionHistory'])
        )
          audit.retries.push({
            at: Date.now(),
            params: message.data.params,
          });
      });
    });

    await step(
      'ordinary account creation reaches actual failed explorer HTTP responses',
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
                  read.owner === 1 &&
                  read.action === action &&
                  read.phase === 'failed' &&
                  read.status === 500 &&
                  read.completedAt !== undefined
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
        expect(state.network).toEqual({
          chainId: 5700,
          kind: 'ethereum',
          url: 'https://rpc.tanenbaum.io',
          apiUrl: 'https://explorer.tanenbaum.io/api',
        });
        expect(state.transactions).toEqual([]);
        observations.failedAccount = state;
      }
    );

    await step(
      'failed history shows readable error and native Retry instead of false empty',
      async () => {
        await expect(error).toBeVisible();
        await expect(empty).toHaveCount(0);
        await expect(retry).toBeEnabled();
        expect(historyReads.some((read) => read.phase === 'recovered')).toBe(
          false
        );
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          const state = await publicHistory(page);
          expect(state.account).toEqual(
            (observations.failedAccount as any).account
          );
          expect(state.network).toEqual(
            (observations.failedAccount as any).network
          );
          expect(state.transactions).toEqual([]);
          expect(state.historyStatus?.state).toBe('error');
          await expect(empty).toHaveCount(0);
          observations['error-' + viewport.width] = {
            state,
            error: await visibleBounds(page, error),
            retry: await visibleBounds(page, retry),
          };
          await info.attach('evm-history-feedback-error-' + viewport.width, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      }
    );

    await step(
      'native Retry recovers one current-account history row on the same endpoint',
      async () => {
        await tabTo(page, retry);
        await expect(retry).toBeFocused();
        const before = await worker.evaluate(
          () => (globalThis as any).__evmHistoryFeedbackAudit.retries.length
        );
        expect(before).toBe(0);
        recovered = true;
        await page.keyboard.press('Enter');
        await expect
          .poll(() =>
            worker.evaluate(
              () => (globalThis as any).__evmHistoryFeedbackAudit.retries.length
            )
          )
          .toBe(before + 1);
        await expect
          .poll(() =>
            ['txlist', 'tokentx'].every((action) =>
              historyReads.some(
                (read) =>
                  read.owner === 1 &&
                  read.action === action &&
                  read.phase === 'recovered' &&
                  read.status === 200 &&
                  read.completedAt !== undefined
              )
            )
          )
          .toBe(true);
        await expect(error).toHaveCount(0);
        await expect(retry).toHaveCount(0);
        await expect(empty).toHaveCount(0);
        const list = page.locator('#activity-panel-list');
        const rowDetails = list.getByRole('button', {
          name: en.notifications.clickToView,
          exact: true,
        });
        await expect(rowDetails).toHaveCount(1);
        await expect(rowDetails).toBeVisible();
        const state = await publicHistory(page);
        expect(state.account).toEqual(
          (observations.failedAccount as any).account
        );
        expect(state.network).toEqual(
          (observations.failedAccount as any).network
        );
        expect(state.transactions).toEqual([
          {
            hash,
            blockNumber: 1,
            from: transaction.from,
            to: transaction.to,
          },
        ]);
        expect(state.historyStatus?.state).toBe('ready');
        const audit = await worker.evaluate(
          () => (globalThis as any).__evmHistoryFeedbackAudit
        );
        expect(audit.retries).toHaveLength(1);
        expect(audit.retries[0].params).toEqual([
          (observations['error-320'] as any).state.historyStatus.scope,
        ]);
        for (const action of ['txlist', 'tokentx']) {
          const read = historyReads.find(
            (item) => item.phase === 'recovered' && item.action === action
          )!;
          expect(read.at).toBeGreaterThanOrEqual(audit.retries[0].at);
        }
        observations.recovered = { state, audit };
      }
    );

    expect(
      routes.reads.some((read) => read === 'synthetic-evm:eth_getBalance')
    ).toBe(true);
    expect(routes.deniedWrites).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('evm-history-failure-feedback-evidence', {
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultReplaced: false,
            clocksOrAlarmsReplaced: false,
            historyReads,
            observations,
            attemptedWrites,
            unexpected,
            pageErrors,
            fixtureReads: routes?.reads || [],
            fixtureDeniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server?.blocked.length || 0,
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
