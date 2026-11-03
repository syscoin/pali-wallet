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
  fixtureRead,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press('Tab');
    if (await control.evaluate((element) => element === document.activeElement))
      return;
  }
  await expect(control).toBeFocused();
};

const publicHistory = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, activeNetwork, accounts, accountTransactions } =
      state.vault;
    const account = accounts[activeAccount.type][activeAccount.id];
    return {
      account: {
        id: activeAccount.id,
        type: activeAccount.type,
        address: account.address,
        xpub: account.xpub,
      },
      network: {
        chainId: activeNetwork.chainId,
        kind: activeNetwork.kind,
        url: activeNetwork.url,
      },
      transactions: (
        accountTransactions[activeAccount.type]?.[activeAccount.id]?.syscoin?.[
          activeNetwork.chainId
        ] || []
      ).map((transaction: any) => ({
        txid: transaction.txid,
        confirmations: transaction.confirmations,
      })),
      historyStatus: state.vaultGlobal.transactionHistoryStatus,
    };
  });

const visibleControlBounds = async (page: Page, control: Locator) => {
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

test('UTXO Activity distinguishes pending and failed history from a verified empty result', async ({}, info) => {
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
  const first = {
    id: 0,
    type: 'HDAccount',
    address: fixture.utxo.userAddress,
    xpub: fixture.utxo.userXpub,
  };
  const second = { id: 1, type: 'HDAccount', ...fixture.secondUtxo };
  const transaction = {
    txid: 'a1'.repeat(32),
    blockTime: Date.parse('2024-11-04T12:00:00Z') / 1000,
    blockHeight: 100,
    confirmations: 3,
    fees: '1000',
    addressValueIn: '0',
    addressValueOut: '100000',
    vin: [
      {
        txid: 'b2'.repeat(32),
        vout: 0,
        addresses: [fixture.utxo.recipientAddress],
        isOwn: false,
        value: '101000',
      },
    ],
    vout: [
      {
        n: 0,
        addresses: [first.address],
        isOwn: true,
        value: '100000',
      },
    ],
  };
  type Mode =
    | 'populated'
    | 'held-populated'
    | 'held-error'
    | 'error'
    | 'held-empty'
    | 'empty';
  const modes: Record<number, Mode> = { 0: 'populated', 1: 'held-error' };
  const historyReads: Array<{
    accountId: number;
    at: number;
    details: string;
    mode: Mode;
    releasedAt?: number;
    status?: number;
    txids?: string[];
  }> = [];
  const normalReads: Array<{ accountId: number; details: string | null }> = [];
  const releases = new Set<() => void>();
  const observations: Record<string, unknown> = {};
  const pendingGeometryChecks: Array<() => void> = [];
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
      password: 'ActivityHistorySyntheticOnly!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('activity-history-status', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only exact public Blockbook account history responses are controlled.
    // Native balance/bootstrap reads use the unchanged isolated fixture.
    // The real SDK, history reader, controller, store and UI process all data.
    await wallet.context.route(
      (url) =>
        [
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin) &&
        /^\/api\/v2\/(?:xpub|address)\//.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const url = new URL(route.request().url());
        const identifier = decodeURIComponent(url.pathname.split('/').pop()!);
        const owner = [first, second].find(
          (account) =>
            identifier === account.xpub || identifier === account.address
        );
        if (!owner) return route.fallback();
        const details = url.searchParams.get('details');
        if (!['txsummary', 'txslight'].includes(details || '')) {
          normalReads.push({ accountId: owner.id, details });
          return route.fallback();
        }
        const mode = modes[owner.id];
        const record: (typeof historyReads)[number] = {
          accountId: owner.id,
          at: Date.now(),
          details: details!,
          mode,
        };
        historyReads.push(record);
        if (mode.startsWith('held-'))
          await new Promise<void>((resolve) => releases.add(resolve));
        record.releasedAt = Date.now();
        if (mode === 'held-error' || mode === 'error') {
          record.status = 500;
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ error: 'Synthetic history unavailable' }),
          });
        }
        const rows =
          mode === 'populated' || mode === 'held-populated'
            ? [transaction]
            : [];
        const body = fixtureRead(
          {
            ...fixture.utxo,
            userAddress: owner.address,
            userXpub: owner.xpub,
          },
          url.href,
          'GET',
          { transactions: rows, balance: owner.id === 0 ? '100000' : '0' }
        ) as Record<string, unknown>;
        expect(body).toBeTruthy();
        record.status = 200;
        record.txids = rows.map(({ txid }) => txid);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            ...body,
            txs: rows.length,
            ...(owner.id === 1
              ? { tokens: [], usedTokens: 0, totalReceived: '0' }
              : {}),
          }),
        });
      }
    );
    const page = wallet.page;
    const empty = page.locator('#activity-panel-empty');
    const pending = page.getByText(en.networkConnection.loadingTransactions, {
      exact: true,
    });
    const error = page.getByRole('status').filter({
      hasText: en.send.unableToLoad,
    });
    const retry = page.getByRole('button', {
      name: en.receive.retry,
      exact: true,
    });
    const cachedRow = page.getByText(
      `${transaction.txid.slice(0, 4)}...${transaction.txid.slice(-14)}`,
      { exact: true }
    );
    const notEmpty = async () => {
      await expect(
        page.getByText(en.home.youHaveNoTxs, { exact: true })
      ).toHaveCount(0);
    };
    const step = (name: string, action: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        try {
          await action();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    await step(
      'prime a real populated Activity cache for the original account',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect(cachedRow).toBeVisible();
        const state = await publicHistory(page);
        expect(state.account).toEqual(first);
        expect(state.transactions).toEqual([
          { txid: transaction.txid, confirmations: 3 },
        ]);
        observations.populated = state;
        expect(
          historyReads.some(
            (read) => read.accountId === 0 && read.status === 200
          )
        ).toBe(true);
      }
    );
    const worker = wallet.context.serviceWorkers()[0];
    expect(worker).toBeTruthy();
    // Read-only observation of the existing trusted UI dispatch. No response,
    // controller method, clock or vault state is replaced.
    await worker.evaluate(() => {
      (globalThis as any).__activityHistoryRetryRequests = [];
      chrome.runtime.onMessage.addListener((message) => {
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          JSON.stringify(message.data?.methods) ===
            JSON.stringify(['wallet', 'refreshTransactionHistory'])
        )
          (globalThis as any).__activityHistoryRetryRequests.push(Date.now());
      });
    });
    const retryCount = () =>
      worker.evaluate(
        () => (globalThis as any).__activityHistoryRetryRequests.length
      );
    await step(
      'create an uncached second HD account through the ordinary menu',
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
          .poll(async () => (await publicHistory(page)).account)
          .toEqual(second);
        expect((await publicHistory(page)).transactions).toEqual([]);
        await expect
          .poll(() =>
            historyReads.some(
              (read) => read.accountId === 1 && read.mode === 'held-error'
            )
          )
          .toBe(true);
        await expect(page.locator('#home-balance')).toHaveText('0');
        expect(normalReads.some((read) => read.accountId === 1)).toBe(true);
      }
    );
    await step(
      'pending history stays loading beyond the old empty-state timer',
      async () => {
        const held = historyReads.find(
          (read) => read.accountId === 1 && read.mode === 'held-error'
        )!;
        await expect.poll(() => Date.now() - held.at).toBeGreaterThan(1200);
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          await pending.scrollIntoViewIfNeeded();
          await expect(pending).toBeVisible();
          await notEmpty();
          expect((await publicHistory(page)).account).toEqual(second);
          observations[`initial-pending-${viewport.width}`] =
            await publicHistory(page);
          const skeletonGeometry = await pending.evaluate((element) => {
            const inspect = (node: Element | null | undefined) => {
              if (!node) return null;
              const bounds = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return {
                bounds: {
                  left: bounds.left,
                  right: bounds.right,
                  top: bounds.top,
                  bottom: bounds.bottom,
                  width: bounds.width,
                  height: bounds.height,
                  clientWidth: node.clientWidth,
                  clientHeight: node.clientHeight,
                },
                computed: {
                  width: style.width,
                  minWidth: style.minWidth,
                  maxWidth: style.maxWidth,
                  display: style.display,
                  flexBasis: style.flexBasis,
                  flexGrow: style.flexGrow,
                  flexShrink: style.flexShrink,
                  gap: style.gap,
                  columnGap: style.columnGap,
                  paddingLeft: style.paddingLeft,
                  paddingRight: style.paddingRight,
                  borderLeftWidth: style.borderLeftWidth,
                  borderRightWidth: style.borderRightWidth,
                  boxSizing: style.boxSizing,
                  overflowX: style.overflowX,
                  overflowY: style.overflowY,
                },
                inlineWidth: (node as HTMLElement).style.width,
              };
            };
            const skeleton = element.parentElement;
            const rowGroup = skeleton?.firstElementChild;
            return {
              viewport: {
                width: innerWidth,
                height: innerHeight,
                devicePixelRatio,
                documentWidth: document.documentElement.scrollWidth,
              },
              skeleton: inspect(skeleton),
              rows: Array.from(rowGroup?.children || []).map((row, index) => {
                const left = row.children.item(0);
                const right = row.children.item(1);
                const avatar = left?.children.item(0);
                const labels = left?.children.item(1);
                const labelTop = labels?.children.item(0);
                const labelBottom = labels?.children.item(1);
                const valueTop = right?.children.item(0);
                const valueBottom = right?.children.item(1);
                const rowBox = row.getBoundingClientRect();
                const rowStyle = getComputedStyle(row);
                const contentLeft =
                  rowBox.left +
                  parseFloat(rowStyle.borderLeftWidth) +
                  parseFloat(rowStyle.paddingLeft);
                const contentRight =
                  rowBox.right -
                  parseFloat(rowStyle.borderRightWidth) -
                  parseFloat(rowStyle.paddingRight);
                const leftBox = left?.getBoundingClientRect();
                const rightBox = right?.getBoundingClientRect();
                const avatarBox = avatar?.getBoundingClientRect();
                const labelBox = labels?.getBoundingClientRect();
                const labelTopBox = labelTop?.getBoundingClientRect();
                const labelBottomBox = labelBottom?.getBoundingClientRect();
                const valueTopBox = valueTop?.getBoundingClientRect();
                const valueBottomBox = valueBottom?.getBoundingClientRect();
                return {
                  index,
                  row: inspect(row),
                  rowContentBounds: {
                    left: contentLeft,
                    right: contentRight,
                    width: contentRight - contentLeft,
                  },
                  leftGroup: inspect(left),
                  rightGroup: inspect(right),
                  avatar: inspect(avatar),
                  labelGroup: inspect(labels),
                  labelTop: inspect(labelTop),
                  labelBottom: inspect(labelBottom),
                  valueTop: inspect(valueTop),
                  valueBottom: inspect(valueBottom),
                  gaps: {
                    groups:
                      leftBox && rightBox
                        ? rightBox.left - leftBox.right
                        : null,
                    avatarToLabels:
                      avatarBox && labelBox
                        ? labelBox.left - avatarBox.right
                        : null,
                    topLabelToValue:
                      labelTopBox && valueTopBox
                        ? valueTopBox.left - labelTopBox.right
                        : null,
                    bottomLabelToValue:
                      labelBottomBox && valueBottomBox
                        ? valueBottomBox.left - labelBottomBox.right
                        : null,
                    rightGroupToContentEdge: rightBox
                      ? contentRight - rightBox.right
                      : null,
                    rightGroupToRowEdge: rightBox
                      ? rowBox.right - rightBox.right
                      : null,
                    topValueToRowEdge: valueTopBox
                      ? rowBox.right - valueTopBox.right
                      : null,
                    bottomValueToRowEdge: valueBottomBox
                      ? rowBox.right - valueBottomBox.right
                      : null,
                  },
                };
              }),
            };
          });
          observations[`pending-skeleton-geometry-${viewport.width}`] =
            skeletonGeometry;
          await info.attach(
            `activity-pending-skeleton-geometry-${viewport.width}`,
            {
              body: JSON.stringify(skeletonGeometry, null, 2),
              contentType: 'application/json',
            }
          );
          pendingGeometryChecks.push(() => {
            expect(skeletonGeometry.viewport.width).toBe(viewport.width);
            expect(skeletonGeometry.viewport.documentWidth).toBe(
              viewport.width
            );
            expect(skeletonGeometry.rows).toHaveLength(3);
            for (const row of skeletonGeometry.rows) {
              expect(row.avatar?.bounds).toMatchObject({
                width: 40,
                height: 40,
              });
              expect(row.valueTop?.bounds.width).toBe(100);
              expect(row.valueBottom?.bounds.width).toBe(60);
              expect(row.labelTop?.bounds.width).toBeGreaterThan(0);
              expect(row.labelTop?.bounds.width).toBeLessThanOrEqual(120);
              expect(row.labelBottom?.bounds.width).toBeGreaterThan(0);
              expect(row.labelBottom?.bounds.width).toBeLessThanOrEqual(80);
              expect(row.gaps.avatarToLabels).toBe(12);
              expect(row.gaps.groups).toBeGreaterThanOrEqual(12);
              expect(row.gaps.topLabelToValue).toBeGreaterThanOrEqual(12);
              expect(row.gaps.bottomLabelToValue).toBeGreaterThanOrEqual(12);
              expect(row.gaps.rightGroupToContentEdge).toBeGreaterThanOrEqual(
                0
              );
              expect(row.gaps.rightGroupToRowEdge).toBe(12);
              for (const box of [
                row.avatar,
                row.labelTop,
                row.labelBottom,
                row.valueTop,
                row.valueBottom,
              ]) {
                expect(box).not.toBeNull();
                expect(box!.bounds.left).toBeGreaterThanOrEqual(
                  row.rowContentBounds.left
                );
                expect(box!.bounds.right).toBeLessThanOrEqual(
                  row.rowContentBounds.right
                );
              }
              if (viewport.width === 400) {
                expect(row.leftGroup?.bounds.width).toBe(172);
                expect(row.rightGroup?.bounds.width).toBe(100);
                expect(row.labelTop?.bounds.width).toBe(120);
                expect(row.labelBottom?.bounds.width).toBe(80);
                expect(row.gaps.groups).toBe(72);
              }
            }
          });
          await info.attach(`activity-initial-pending-${viewport.width}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
        modes[1] = 'error';
        releaseHeld();
      }
    );
    await step(
      'failed history shows Retry, never a verified-empty message',
      async () => {
        await expect(error).toBeVisible();
        await expect(retry).toBeEnabled();
        await notEmpty();
        expect(
          historyReads
            .filter((read) => read.accountId === 1)
            .every((read) => read.status === 500)
        ).toBe(true);
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          await notEmpty();
          const retryBounds = await visibleControlBounds(page, retry);
          expect(retryBounds.width).toBeGreaterThanOrEqual(32);
          expect(retryBounds.height).toBeGreaterThanOrEqual(32);
          observations[`initial-error-${viewport.width}`] = {
            state: await publicHistory(page),
            status: await visibleControlBounds(page, error),
            retry: retryBounds,
          };
          await info.attach(`activity-initial-error-${viewport.width}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
        const beforeRetry = historyReads.length;
        modes[1] = 'held-empty';
        await page.waitForTimeout(300);
        expect(historyReads).toHaveLength(beforeRetry);
        await expect(error).toBeVisible();
      }
    );
    await step(
      'native keyboard Retry is coalesced while its real history read is pending',
      async () => {
        const beforeRetry = await retryCount();
        await tabTo(page, retry);
        await page.keyboard.press('Enter');
        await expect.poll(retryCount).toBe(beforeRetry + 1);
        await expect
          .poll(() =>
            historyReads.some(
              (read) => read.accountId === 1 && read.mode === 'held-empty'
            )
          )
          .toBe(true);
        // A second native key activation cannot create another UI request.
        await page.keyboard.press('Enter');
        await expect(pending).toBeVisible();
        await notEmpty();
        const held = historyReads.find(
          (read) => read.accountId === 1 && read.mode === 'held-empty'
        )!;
        await expect.poll(() => Date.now() - held.at).toBeGreaterThan(1200);
        expect(await retryCount()).toBe(beforeRetry + 1);
        expect((await publicHistory(page)).account).toEqual(second);
        observations.keyboardPending = await publicHistory(page);
        modes[1] = 'empty';
        releaseHeld();
      }
    );
    await step(
      'only a successful empty response produces the normal empty Activity view',
      async () => {
        await expect(empty).toBeVisible();
        await expect(
          page.getByText(en.home.youHaveNoTxs, { exact: true })
        ).toBeVisible();
        await expect(error).toHaveCount(0);
        await expect(retry).toHaveCount(0);
        await expect(pending).toHaveCount(0);
        const state = await publicHistory(page);
        expect(state.account).toEqual(second);
        expect(state.transactions).toEqual([]);
        expect(
          historyReads.some(
            (read) =>
              read.accountId === 1 &&
              read.status === 200 &&
              read.txids?.length === 0
          )
        ).toBe(true);
        observations.verifiedEmpty = state;
      }
    );
    await step(
      'a later failure preserves cached rows for the original account',
      async () => {
        modes[0] = 'error';
        await page.setViewportSize({ width: 400, height: 620 });
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page.locator('#account-HDAccount-0').click();
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect(error).toBeVisible();
        await expect(cachedRow).toBeVisible();
        await notEmpty();
        expect((await publicHistory(page)).account).toEqual(first);
        expect((await publicHistory(page)).transactions).toEqual([
          { txid: transaction.txid, confirmations: 3 },
        ]);
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          const retryBounds = await visibleControlBounds(page, retry);
          expect(retryBounds.width).toBeGreaterThanOrEqual(32);
          expect(retryBounds.height).toBeGreaterThanOrEqual(32);
          observations[`cached-error-${viewport.width}`] = {
            state: await publicHistory(page),
            status: await visibleControlBounds(page, error),
            retry: retryBounds,
          };
          await info.attach(`activity-cached-error-${viewport.width}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      }
    );
    await step(
      'double-click Retry restores the same owner without deleting its cached row',
      async () => {
        const beforeRetry = await retryCount();
        // Hold a successful nonempty response while the native double-click
        // exercises the UI's pending latch. No transaction is constructed.
        modes[0] = 'held-populated';
        await retry.dblclick();
        await expect.poll(retryCount).toBe(beforeRetry + 1);
        await expect
          .poll(() =>
            historyReads.some(
              (read) => read.accountId === 0 && read.mode === 'held-populated'
            )
          )
          .toBe(true);
        await notEmpty();
        await expect(cachedRow).toHaveCount(1);
        expect((await publicHistory(page)).account).toEqual(first);
        // The held request already owns the original populated payload.
        modes[0] = 'populated';
        releaseHeld();
        await expect(error).toHaveCount(0);
        await expect(cachedRow).toHaveCount(1);
        expect((await publicHistory(page)).transactions).toEqual([
          { txid: transaction.txid, confirmations: 3 },
        ]);
        expect(await retryCount()).toBe(beforeRetry + 1);
        observations.cachedRetry = await publicHistory(page);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(
      historyReads.every((read) => read.accountId === 0 || read.accountId === 1)
    ).toBe(true);
    expect(normalReads.some((read) => read.accountId === 0)).toBe(true);
    expect(normalReads.some((read) => read.accountId === 1)).toBe(true);
    expect(pendingGeometryChecks).toHaveLength(2);
    for (const check of pendingGeometryChecks) check();
    status = 'passed';
  } finally {
    releaseHeld();
    try {
      await info.attach('activity-history-status-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultReplaced: false,
            allowedAccounts: [first, second],
            historyReads,
            normalReads,
            observations,
            deniedWrites: routes?.deniedWrites || [],
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
