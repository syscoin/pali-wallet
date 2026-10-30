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

const RPC = 'https://rpc.tanenbaum.io/';
// The same existing provider-cache boundary used by nativeMaxBalance.
const PROVIDER_READ_CACHE_MS = 250;
// Actual ConnectionStatusIndicator slow-warning threshold; not an assertion timeout.
const SLOW_FEEDBACK_DELAY_MS = 5_000;
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return {
      chainId: state.vault.activeNetwork.chainId,
      account: state.vault.activeAccount,
      status: state.vaultGlobal.networkStatus,
      loadingBalances: state.vaultGlobal.loadingStates.isLoadingBalances,
      quality: state.vaultGlobal.networkQuality,
    };
  });

test('a new UI refresh retires prior success while its balance read is pending', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
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
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'baseline';
  let holdSecond = false;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const reads: Array<{
    fulfilledAt?: number;
    held: boolean;
    phase: string;
    receivedAt: number;
  }> = [];
  const deniedRequests: string[] = [];
  const observations: Record<string, unknown> = {};
  let firstCompletedAt = 0;
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'IndicatorSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('connection-status-feedback', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route(RPC, async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        deniedRequests.push('invalid JSON');
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        route.request().method() !== 'POST' ||
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedRequests.push('non-read RPC');
        return route.abort('blockedbyclient');
      }
      if (!calls.some((call) => call?.method === 'eth_getBalance'))
        return route.fallback();
      const replies = calls.map((call) => {
        if (
          call?.jsonrpc !== '2.0' ||
          call.method !== 'eth_getBalance' ||
          !Array.isArray(call.params) ||
          call.params.length !== 2 ||
          !fixture.evmAddresses.some(
            (address) =>
              address.toLowerCase() === String(call.params[0]).toLowerCase()
          ) ||
          call.params[1] !== 'latest'
        )
          return undefined;
        return { jsonrpc: '2.0', id: call.id, result: '0x0' };
      });
      if (!calls.length || replies.some((reply) => !reply)) {
        deniedRequests.push('unexpected balance read');
        return route.abort('blockedbyclient');
      }
      const row = {
        phase,
        held: phase === 'first' || holdSecond,
        receivedAt: Date.now(),
      } as (typeof reads)[number];
      reads.push(row);
      if (row.held) await (row.phase === 'first' ? firstGate : secondGate);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
      row.fulfilledAt = Date.now();
    });
    const page = wallet.page;
    const refresh = page.getByRole('button', {
      name: en.header.refresh,
      exact: true,
    });
    // This is the real header status button and its visible indicator.
    const indicator = page.locator('button.status-target');
    const indicatorDot = indicator.locator('span');
    const tooltip = page.getByRole('tooltip');
    await wallet.step(
      'connection-feedback: enable ordinary refresh on the current network',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.gotoRoute('#/settings/advanced');
        await page.locator('#advanced-refresh').click();
        await page.getByRole('dialog').locator('#confirm-btn').click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await expect(refresh).toBeEnabled();
        await expect(indicator).toHaveCount(1);
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return state.status === 'idle' && !state.loadingBalances;
          })
          .toBe(true);
        await expect(indicatorDot).not.toHaveClass(/bg-green-500/);
        const preparedAt = Date.now();
        await expect
          .poll(() => Date.now() - preparedAt > PROVIDER_READ_CACHE_MS)
          .toBe(true);
        observations.prepared = await publicState(page);
      }
    );
    await wallet.step(
      'connection-feedback: complete the first real refresh successfully',
      async () => {
        phase = 'first';
        const count = reads.length;
        await refresh.click();
        await expect.poll(() => reads.length).toBeGreaterThan(count);
        // Loading-state publication is debounced. Keep the real first read
        // pending until this document has observed it, rather than assuming
        // a fast background true -> false cycle must render a green flash.
        await expect
          .poll(async () => (await publicState(page)).loadingBalances)
          .toBe(true);
        await indicator.hover();
        await expect(tooltip).toHaveText(en.networkConnection.updatingBalances);
        await expect(indicatorDot).toHaveClass(/bg-brand-blue500/);
        observations.firstPending = await publicState(page);
        releaseFirst();
        await expect
          .poll(async () => (await publicState(page)).loadingBalances)
          .toBe(false);
        await expect(indicatorDot).toHaveClass(/bg-green-500/);
        await indicator.hover();
        await expect(tooltip).toHaveText(
          en.networkConnection.operationCompleted
        );
        firstCompletedAt = Date.now();
        observations.firstCompleted = await publicState(page);
      }
    );
    await wallet.step(
      'connection-feedback: a second held refresh replaces success with pending and slow feedback',
      async () => {
        const lastRead = reads.at(-1)!;
        await expect
          .poll(() =>
            Boolean(
              lastRead.fulfilledAt &&
                Date.now() - lastRead.fulfilledAt > PROVIDER_READ_CACHE_MS
            )
          )
          .toBe(true);
        phase = 'second';
        holdSecond = true;
        await page.mouse.move(0, 0);
        await refresh.click();
        expect(Date.now() - firstCompletedAt).toBeLessThan(2000);
        await expect
          .poll(() => reads.some((row) => row.phase === 'second' && row.held))
          .toBe(true);
        await expect
          .poll(async () => (await publicState(page)).loadingBalances)
          .toBe(true);
        await indicator.hover();
        await expect(tooltip).toHaveText(en.networkConnection.updatingBalances);
        await expect(indicatorDot).not.toHaveClass(/bg-green-500/);
        await expect(indicatorDot).toHaveClass(/bg-brand-blue500/);
        observations.secondPending = await publicState(page);
        const pendingObservedAt = await page.evaluate(() => Date.now());
        observations.secondPendingAt = pendingObservedAt;
        // Observe the real held operation through its documented threshold
        // before starting the unchanged locator assertion window.
        await page.waitForFunction(
          ({ since, delay }) => Date.now() - since >= delay,
          { since: pendingObservedAt, delay: SLOW_FEEDBACK_DELAY_MS }
        );
        observations.slowAssertionStartedAt = await page.evaluate(() =>
          Date.now()
        );
        const slow = en.networkConnection.operationSlow.replace(
          '{{operation}}',
          en.networkConnection.operationInProgress.replace('...', '')
        );
        await expect(tooltip).toHaveText(slow);
        await expect(indicatorDot).toHaveClass(/bg-orange-500/);
        expect(
          reads
            .filter((row) => row.phase === 'second')
            .every((row) => row.held && row.fulfilledAt === undefined)
        ).toBe(true);
        observations.secondSlow = await publicState(page);
      }
    );
    await wallet.step(
      'connection-feedback: complete the held read and retain its actual quality warning',
      async () => {
        holdSecond = false;
        releaseSecond();
        await expect
          .poll(() =>
            reads
              .filter((row) => row.phase === 'second')
              .every((row) => row.fulfilledAt !== undefined)
          )
          .toBe(true);
        await expect
          .poll(async () => (await publicState(page)).loadingBalances)
          .toBe(false);
        const final = await publicState(page);
        expect(final.chainId).toBe(5700);
        expect(final.status).toBe('idle');
        expect(final.quality?.hasSlowOperations).toBe(true);
        expect(final.quality?.hasCriticalErrors).toBe(false);
        expect(final.account).toEqual(
          (observations.firstCompleted as typeof final).account
        );
        await expect(indicatorDot).toHaveClass(/bg-orange-500/);
        await expect(tooltip).toHaveText(
          en.networkConnection.networkQualitySlow.replace(
            '{{latency}}',
            `${final.quality.lastBalanceLatency}ms`
          )
        );
        await expect(page).toHaveURL(/#\/home$/);
        observations.secondCompleted = final;
      }
    );
    expect(deniedRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(testSourceSha256);
    status = 'passed';
  } finally {
    releaseFirst();
    releaseSecond();
    try {
      await info.attach('connection-status-feedback-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          testSourceSha256,
          observations,
          reads,
          deniedRequests,
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedMethods: server?.blocked || [],
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signingOrBroadcast: false,
        }),
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server?.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
