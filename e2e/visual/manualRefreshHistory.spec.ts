import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  fixtureRead,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const publicMetadata = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const { activeAccount, activeNetwork, accounts, accountTransactions } =
      state.vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id];
    const transactions =
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.syscoin?.[
        activeNetwork.chainId
      ] || [];
    return {
      account: {
        id: activeAccount.id,
        type: activeAccount.type,
        address: account?.address,
        xpub: account?.xpub,
      },
      network: {
        chainId: activeNetwork.chainId,
        kind: activeNetwork.kind,
        url: activeNetwork.url,
      },
      refreshEnabled: state.vaultGlobal.advancedSettings.refresh,
      savedRefreshEnabled: saved.state?.vaultGlobal?.advancedSettings?.refresh,
      transactions: transactions.map((transaction: any) => ({
        txid: transaction.txid,
        blockHeight: transaction.blockHeight,
        blockTime: transaction.blockTime,
        confirmations: transaction.confirmations,
      })),
    };
  });

test('manual Refresh retrieves new confirmed history within the normal cache interval', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('100000000');
  const transaction = (id: string, year: number, amount: string) => ({
    txid: id.repeat(32),
    blockTime: Date.parse(`${year}-11-04T12:00:00Z`) / 1000,
    blockHeight: year - 1900,
    confirmations: 3,
    fees: '1000',
    addressValueIn: '0',
    addressValueOut: amount,
    vin: [
      {
        txid: `${id[0]}0`.repeat(32),
        vout: 0,
        addresses: [fixture.recipientAddress],
        isOwn: false,
        value: String(BigInt(amount) + BigInt(1000)),
      },
    ],
    vout: [
      {
        n: 0,
        addresses: [fixture.userAddress],
        isOwn: true,
        value: amount,
      },
    ],
  });
  const initial = transaction('a1', 2024, '100000000');
  const newer = transaction('b2', 2025, '200000000');
  let available = [initial];
  let phase = 'initial-history';
  const historyReads: Array<{
    at: number;
    details: string;
    page: number;
    phase: string;
    txids: string[];
    url: string;
  }> = [];
  const observations: Record<string, unknown> = {};
  const pageErrors: string[] = [];
  let wallet: PaliWallet | undefined;
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ManualRefreshSyntheticOnly!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('manual-refresh-history', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      { readState: () => ({ transactions: available }) }
    );
    // Only public Blockbook HTTP history rows change. The balance stays fixed
    // to model delayed history indexing without a balance-change cache reset.
    // The real reader, cache, controller, store and renderer remain untouched.
    await wallet.context.route(
      (url) =>
        [
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin) &&
        /^\/api\/v2\/(?:xpub|address)\//.test(url.pathname) &&
        ['txsummary', 'txslight'].includes(
          url.searchParams.get('details') || ''
        ),
      async (route) => {
        const url = new URL(route.request().url());
        const rows = available.slice();
        const body = fixtureRead(fixture, url.href, route.request().method(), {
          transactions: rows,
        });
        if (!body || typeof body !== 'object') return route.fallback();
        historyReads.push({
          at: Date.now(),
          details: url.searchParams.get('details')!,
          page: Number(url.searchParams.get('page') || 1),
          phase,
          txids: rows.map(({ txid }) => txid),
          url: url.href,
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ ...body, txs: rows.length }),
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const row = (txid: string) =>
      page
        .getByText(`${txid.slice(0, 4)}...${txid.slice(-14)}`, { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    const refresh = page.getByRole('button', {
      name: en.header.refresh,
      exact: true,
    });
    await wallet.step(
      'enable Refresh through the normal Advanced settings menu',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await expect(refresh).toHaveCount(0);
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: en.generalMenu.advanced, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/advanced$/);
        await page.locator('#advanced-refresh').click();
        await page.getByRole('dialog').locator('#confirm-btn').click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(
          page.getByText(en.settings.advancedSettingsWasSet, { exact: true })
        ).toBeVisible();
        await expect
          .poll(async () => (await publicMetadata(page)).savedRefreshEnabled)
          .toBe(true);
        await page
          .getByRole('dialog')
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect(refresh).toBeVisible();
      }
    );
    await wallet.step(
      'prime confirmed history through ordinary network selection and Activity',
      async () => {
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect(row(initial.txid)).toBeVisible();
        await expect(
          row(initial.txid).getByText('11-04-24', { exact: true })
        ).toBeVisible();
        await expect(row(newer.txid)).toHaveCount(0);
        expect(historyReads.some((read) => read.page === 1)).toBe(true);
        const baseline = await publicMetadata(page);
        expect(baseline.account.address).toBe(fixture.userAddress);
        expect(baseline.account.xpub).toBe(fixture.userXpub);
        expect(baseline.network.chainId).toBe(5700);
        expect(baseline.network.kind).toBe('syscoin');
        expect(baseline.refreshEnabled).toBe(true);
        expect(baseline.savedRefreshEnabled).toBe(true);
        expect(baseline.transactions).toEqual([
          expect.objectContaining({ txid: initial.txid, confirmations: 3 }),
        ]);
        observations.baseline = baseline;
      }
    );
    const baselineRead = historyReads[historyReads.length - 1];
    const baselineReadCount = historyReads.length;
    // The visible row and native metadata above establish that the initial
    // response has been consumed, not merely that its HTTP request started.
    const baselineHistoryObservedAt = Date.now();
    const worker = wallet.context.serviceWorkers()[0];
    expect(worker).toBeTruthy();
    // Observe the real trusted request without replying, replacing APIs or
    // changing worker time. HTTP timestamps also use the real wall clock.
    await worker.evaluate(() => {
      (globalThis as any).__manualHistoryRefreshRequests = [];
      chrome.runtime.onMessage.addListener((message) => {
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.length === 1 &&
          message.data.methods[0] === 'refresh'
        )
          (globalThis as any).__manualHistoryRefreshRequests.push(Date.now());
      });
    });
    await wallet.step(
      'Refresh reads and displays newly available confirmed history before cache expiry',
      async () => {
        // Cross the transport's five-second reuse boundary while remaining
        // inside the separate sixty-second completed-history cache interval.
        // This is a bounded wall-clock wait, not a worker clock replacement.
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, 5001 - (Date.now() - baselineHistoryObservedAt))
          )
        );
        const readyAt = Date.now();
        expect(readyAt - baselineHistoryObservedAt).toBeGreaterThan(5000);
        expect(readyAt - baselineRead.at).toBeLessThan(60_000);
        // No ordinary poll may supply the new history during observer setup
        // or this boundary wait. Only the explicit Refresh should read it.
        expect(historyReads).toHaveLength(baselineReadCount);
        available = [newer, initial];
        phase = 'new-history-available';
        await expect(row(newer.txid)).toHaveCount(0);
        expect(historyReads).toHaveLength(baselineReadCount);
        const clickedAt = Date.now();
        expect(clickedAt - baselineRead.at).toBeLessThan(60_000);
        await refresh.click();
        await expect
          .poll(() =>
            worker.evaluate(
              () => (globalThis as any).__manualHistoryRefreshRequests.length
            )
          )
          .toBe(1);
        await expect
          .poll(() =>
            historyReads.some(
              (read) =>
                read.at >= clickedAt &&
                read.phase === 'new-history-available' &&
                read.page === 1 &&
                read.txids.includes(newer.txid)
            )
          )
          .toBe(true);
        const newRead = historyReads.find(
          (read) => read.at >= clickedAt && read.txids.includes(newer.txid)
        )!;
        expect(newRead.at - baselineRead.at).toBeLessThan(60_000);
        await expect(row(newer.txid)).toBeVisible();
        await expect(
          row(newer.txid).getByText('11-04-25', { exact: true })
        ).toBeVisible();
        await expect(row(initial.txid)).toBeVisible();
        await expect
          .poll(async () => (await publicMetadata(page)).transactions)
          .toEqual([
            expect.objectContaining({
              txid: newer.txid,
              blockHeight: newer.blockHeight,
              blockTime: newer.blockTime,
              confirmations: 3,
            }),
            expect.objectContaining({ txid: initial.txid, confirmations: 3 }),
          ]);
        const current = await publicMetadata(page);
        const baseline = observations.baseline as Awaited<
          ReturnType<typeof publicMetadata>
        >;
        expect(current.account).toEqual(baseline.account);
        expect(current.network).toEqual(baseline.network);
        expect(current.refreshEnabled).toBe(true);
        expect(current.savedRefreshEnabled).toBe(true);
        observations.refreshed = current;
        observations.timing = {
          baselineReadAt: baselineRead.at,
          baselineHistoryObservedAt,
          readyAt,
          clickedAt,
          newReadAt: newRead.at,
          elapsedSinceBaselineMs: newRead.at - baselineRead.at,
          historyReadsBeforeRefresh: baselineReadCount,
        };
        observations.refreshRequests = await worker.evaluate(
          () => (globalThis as any).__manualHistoryRefreshRequests
        );
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(testSourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('manual-refresh-history-evidence', {
        body: JSON.stringify(
          {
            runtime,
            finalRuntime: extensionEvidence(),
            status,
            testSourceSha256,
            syntheticHttpOnly: true,
            signaturesOrBroadcastsRequested: false,
            controllerStateReplaced: false,
            controllerResultReplaced: false,
            workerClockReplaced: false,
            observations,
            historyReads,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            deniedUnknown: routes?.deniedUnknown || [],
            syntheticBroadcasts: routes?.syntheticBroadcasts || [],
            proxyDenied: server?.blocked || [],
            pageErrors,
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
