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

// Currency-save regression draft. Persistence success must not wait for quotes.
// Only actual allowlisted quote HTTP responses are held; the real storage refusal
// is separately exercised. All data is synthetic behind the launch-time fence.
const QUOTE = 'https://api.coingecko.com/api/v3/simple/price?*';
const PRICES: Record<string, number> = {
  usd: 0.125,
  eur: 0.2,
  cad: 0.3,
  gbp: 0.4,
};

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const ref = state.vault.activeAccount;
    const network = state.vault.activeNetwork;
    return {
      active: {
        id: ref.id,
        type: ref.type,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      network: {
        chainId: network.chainId,
        kind: network.kind,
        url: network.url,
      },
      coingeckoId:
        state.vaultGlobal.networks.ethereum[network.chainId]?.coingeckoId,
      live: { asset: state.price.fiat.asset, price: state.price.fiat.price },
      saved: {
        asset: saved.state?.price?.fiat?.asset,
        price: saved.state?.price?.fiat?.price,
      },
    };
  });

const uiState = async (page: Page) => ({
  url: page.url(),
  alerts: await page.getByRole('alert').allTextContents(),
  dialogs: await page.getByRole('dialog').allTextContents(),
  currency: await page
    .getByRole('button', {
      name: en.settings.setYourPreferred,
      exact: true,
      includeHidden: true,
    })
    .innerText(),
  saveEnabled: await page
    .getByRole('button', {
      name: en.buttons.save,
      exact: true,
      includeHidden: true,
    })
    .isEnabled(),
});

test('CurrencySave acknowledges durable preferences before delayed quotes and keeps the newest currency', async ({}, info) => {
  expect(process.version).toBe('v26.12.1');
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
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'CurrencyQuoteSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'setup';
  let releaseQuote: (() => void) | undefined;
  let heldQuoteFinished: Promise<void> | undefined;
  let heldCad = false;
  let heldGbp = false;
  let releaseGbpQuote: (() => void) | undefined;
  let heldGbpQuoteFinished: Promise<void> | undefined;
  const quotes: Array<{
    currency: string;
    phase: string;
    receivedAt: number;
    releasedAt?: number;
    fulfilledAt?: number;
  }> = [];
  const unsupportedQuotes: string[] = [];
  const pageErrors: string[] = [];
  const observations: Record<string, any> = { runtime, sourceSha256 };
  try {
    wallet = await PaliWallet.launch('currency-save-quote-independence', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => pageErrors.push(error.message))
    );
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    // Same real CoinGecko route/schema as homeFiatUnits.spec.ts. No endpoint or
    // network metadata is edited, and no controller message is intercepted.
    await wallet.context.route(QUOTE, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const currency = url.searchParams.get('vs_currencies') || '';
      if (
        request.method() !== 'GET' ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.get('ids') !== 'syscoin' ||
        url.searchParams.get('include_24hr_change') !== 'true' ||
        !Object.prototype.hasOwnProperty.call(PRICES, currency) ||
        [...url.searchParams.keys()].sort().join(',') !==
          'ids,include_24hr_change,vs_currencies'
      ) {
        unsupportedQuotes.push(`${request.method()} ${request.url()}`);
        return route.abort('blockedbyclient');
      }
      const row: (typeof quotes)[number] = {
        currency,
        phase,
        receivedAt: Date.now(),
      };
      quotes.push(row);
      let finishHeldQuote: (() => void) | undefined;
      if (currency === 'cad' && phase === 'slow-cad' && !heldCad) {
        heldCad = true;
        heldQuoteFinished = new Promise<void>((resolve) => {
          finishHeldQuote = resolve;
        });
        await new Promise<void>((resolve) => {
          releaseQuote = resolve;
        });
        row.releasedAt = Date.now();
      } else if (currency === 'gbp' && phase === 'queued-gbp' && !heldGbp) {
        heldGbp = true;
        heldGbpQuoteFinished = new Promise<void>((resolve) => {
          finishHeldQuote = resolve;
        });
        await new Promise<void>((resolve) => {
          releaseGbpQuote = resolve;
        });
        row.releasedAt = Date.now();
      }
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            syscoin: {
              [currency]: PRICES[currency],
              [`${currency}_24h_change`]: 0,
            },
          }),
        });
        row.fulfilledAt = Date.now();
      } finally {
        finishHeldQuote?.();
      }
    });
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    const openCurrency = async () => {
      await expect(page).toHaveURL(/#\/home$/);
      await page.locator('#general-settings-button').locator('..').click();
      await page
        .getByRole('menuitem', { name: en.generalMenu.currency, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/currency$/);
      await expect(
        page.getByRole('button', {
          name: en.settings.setYourPreferred,
          exact: true,
        })
      ).toBeVisible();
    };
    const choose = async (currency: string) => {
      await page
        .getByRole('button', {
          name: en.settings.setYourPreferred,
          exact: true,
        })
        .click();
      await page
        .getByRole('textbox', {
          name: en.settings.searchCurrencies,
          exact: true,
        })
        .fill(currency);
      const option = page.getByRole('button', {
        name: new RegExp(`\\b${currency.toUpperCase()}\\b`),
      });
      await expect(option).toHaveCount(1);
      await option.click();
    };
    const save = () =>
      page.getByRole('button', { name: en.buttons.save, exact: true });
    const closeSuccess = async () => {
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toContainText(
        en.settings.fiatCurrencySetSuccessfully
      );
      await dialog
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home$/);
    };
    await wallet.step(
      'prepare the real wallet and its configured EVM quote source',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        const state = await publicState(page);
        expect(state.network).toMatchObject({
          chainId: 5700,
          kind: 'ethereum',
        });
        expect(state.coingeckoId).toBe('syscoin');
        observations.initial = state;
      }
    );
    await wallet.step(
      'a fast genuine EUR quote saves and returns normally',
      async () => {
        phase = 'fast-eur';
        await openCurrency();
        await choose('eur');
        await save().click();
        await expect
          .poll(async () => (await publicState(page)).live)
          .toEqual({ asset: 'eur', price: PRICES.eur });
        await expect
          .poll(async () => (await publicState(page)).saved.asset)
          .toBe('eur');
        await expect(page.getByRole('alert')).toHaveCount(0);
        observations.fastEur = {
          state: await publicState(page),
          ui: await uiState(page),
        };
        await closeSuccess();
      }
    );
    await wallet.step(
      'CAD Save succeeds while its genuine quote remains held',
      async (capture) => {
        phase = 'slow-cad';
        await openCurrency();
        await choose('cad');
        const startedAt = Date.now();
        observations.slowCadStartedAt = startedAt;
        await save().click();
        await expect.poll(() => Boolean(releaseQuote)).toBe(true);
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return { live: state.live, saved: state.saved.asset };
          })
          .toEqual({ live: { asset: 'cad', price: 0 }, saved: 'cad' });
        const success = page.getByRole('dialog');
        await expect(success).toContainText(
          en.settings.fiatCurrencySetSuccessfully
        );
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(
          quotes.some((row) => row.currency === 'cad' && row.fulfilledAt)
        ).toBe(false);
        expect(Date.now() - startedAt).toBeLessThan(10_000);
        observations.cadSuccessBeforeQuoteRelease = {
          state: await publicState(page),
          ui: await uiState(page),
          elapsedMs: Date.now() - startedAt,
        };
        await capture(page);
        await closeSuccess();
      }
    );
    await wallet.step(
      'a second GBP Save is durable and successful while CAD is still held',
      async (capture) => {
        phase = 'queued-gbp';
        await openCurrency();
        await choose('gbp');
        const startedAt = Date.now();
        await save().click();
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return { live: state.live, saved: state.saved.asset };
          })
          .toEqual({ live: { asset: 'gbp', price: 0 }, saved: 'gbp' });
        await expect(page.getByRole('dialog')).toContainText(
          en.settings.fiatCurrencySetSuccessfully
        );
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(releaseQuote).toBeDefined();
        expect(
          quotes.some((row) => row.currency === 'cad' && row.fulfilledAt)
        ).toBe(false);
        expect(Date.now() - startedAt).toBeLessThan(10_000);
        observations.gbpSuccessBeforeCadRelease = {
          state: await publicState(page),
          ui: await uiState(page),
          elapsedMs: Date.now() - startedAt,
        };
        await capture(page);
        await closeSuccess();
        // Keep the original long-latency stimulus, but only AFTER both save
        // acknowledgements. Neither save is permitted to wait for this release.
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, 11_000 - (Date.now() - observations.slowCadStartedAt))
          )
        );
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect((await publicState(page)).live).toEqual({
          asset: 'gbp',
          price: 0,
        });
        expect((await publicState(page)).saved.asset).toBe('gbp');
      }
    );
    await wallet.step(
      'late CAD cannot overwrite GBP and the subsequent genuine GBP quote applies',
      async () => {
        releaseQuote!();
        releaseQuote = undefined;
        await heldQuoteFinished;
        await expect.poll(() => Boolean(releaseGbpQuote)).toBe(true);
        await expect
          .poll(() =>
            quotes.some(
              (row) => row.currency === 'cad' && Boolean(row.fulfilledAt)
            )
          )
          .toBe(true);
        // GBP HTTP arrival proves the older serialized quote has completed and
        // released the quote mutex. Observe before fulfilling GBP itself.
        await page.evaluate(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        const afterCad = await publicState(page);
        expect(afterCad.live).toEqual({ asset: 'gbp', price: 0 });
        expect(afterCad.saved.asset).toBe('gbp');
        expect(
          quotes.some((row) => row.currency === 'gbp' && row.fulfilledAt)
        ).toBe(false);
        observations.lateCadDidNotPublish = afterCad;
        releaseGbpQuote!();
        releaseGbpQuote = undefined;
        await heldGbpQuoteFinished;
        await expect
          .poll(async () => (await publicState(page)).live)
          .toEqual({ asset: 'gbp', price: PRICES.gbp });
        await expect
          .poll(async () => (await publicState(page)).saved.asset)
          .toBe('gbp');
        expect(
          quotes.some((row) => row.currency === 'gbp' && row.fulfilledAt)
        ).toBe(true);
        observations.genuineGbpApplied = await publicState(page);
      }
    );
    await wallet.step(
      'restore CAD as the unchanged baseline for actual storage failure and retry',
      async () => {
        phase = 'restore-cad';
        await openCurrency();
        await choose('cad');
        await save().click();
        await expect
          .poll(async () => (await publicState(page)).live)
          .toEqual({ asset: 'cad', price: PRICES.cad });
        await expect
          .poll(async () => (await publicState(page)).saved.asset)
          .toBe('cad');
        await closeSuccess();
      }
    );
    await wallet.step(
      'Back and ordinary reopen read the actual saved CAD without stale feedback',
      async () => {
        phase = 'reopen-cad';
        await openCurrency();
        await expect(
          page.getByRole('button', {
            name: en.settings.setYourPreferred,
            exact: true,
          })
        ).toContainText('CAD');
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(save()).toBeDisabled();
        const state = await publicState(page);
        expect(state.live.asset).toBe('cad');
        expect(state.saved.asset).toBe('cad');
        observations.reopenedCad = { state, ui: await uiState(page) };
      }
    );
    await wallet.step(
      'an actual refused storage API write leaves CAD durable and permits GBP retry',
      async () => {
        phase = 'refused-gbp';
        await choose('gbp');
        const gbpQuotesBeforeRefusal = quotes.filter(
          (row) => row.currency === 'gbp'
        ).length;
        const worker = wallet!.context
          .serviceWorkers()
          .find((candidate) =>
            candidate
              .url()
              .startsWith(`chrome-extension://${wallet!.extensionId}/`)
          );
        expect(worker).toBeDefined();
        // Existing safe seam: connectedSitesLifecycle.spec.ts intercepts only
        // chrome.storage.local.set and throws once at the real persistence I/O.
        // Here the exact staged public currency discriminates the single write.
        await worker!.evaluate(() => {
          const local = chrome.storage.local;
          const original = local.set;
          const probe = {
            failures: 0,
            refusedAt: null as number | null,
            refusedAsset: null as string | null,
            restore: () => {
              local.set = original;
            },
          };
          (globalThis as any).__currencySaveStorageRefusal = probe;
          local.set = ((items: Record<string, any>, ...args: any[]) => {
            if (
              items.state?.price?.fiat?.asset === 'gbp' &&
              probe.failures === 0
            ) {
              probe.failures += 1;
              probe.refusedAt = Date.now();
              probe.refusedAsset = items.state.price.fiat.asset;
              throw new Error('Synthetic currency preference storage refusal');
            }
            return (original as any).call(local, items, ...args);
          }) as typeof local.set;
        });
        try {
          await save().click();
          await expect(page.getByRole('alert')).toContainText(
            en.settings.preferencesSaveFailed
          );
          await expect(save()).toBeEnabled();
          const state = await publicState(page);
          expect(state.live.asset).toBe('cad');
          expect(state.saved.asset).toBe('cad');
          const refusal = await worker!.evaluate(() => {
            const probe = (globalThis as any).__currencySaveStorageRefusal;
            return {
              failures: probe.failures,
              refusedAt: probe.refusedAt,
              refusedAsset: probe.refusedAsset,
            };
          });
          expect(refusal.failures).toBe(1);
          expect(refusal.refusedAsset).toBe('gbp');
          expect(refusal.refusedAt).toEqual(expect.any(Number));
          expect(quotes.filter((row) => row.currency === 'gbp')).toHaveLength(
            gbpQuotesBeforeRefusal
          );
          observations.realStorageRefusal = {
            refusal,
            state,
            ui: await uiState(page),
          };
        } finally {
          await worker!.evaluate(() =>
            (globalThis as any).__currencySaveStorageRefusal.restore()
          );
        }
        phase = 'retry-fast-gbp';
        await save().click();
        await expect
          .poll(async () => (await publicState(page)).live)
          .toEqual({ asset: 'gbp', price: PRICES.gbp });
        await expect
          .poll(async () => (await publicState(page)).saved.asset)
          .toBe('gbp');
        await expect(page.getByRole('alert')).toHaveCount(0);
        observations.gbpRetry = {
          state: await publicState(page),
          ui: await uiState(page),
        };
        await closeSuccess();
      }
    );
    await wallet.step(
      'an unsaved currency draft is canceled by Back and does not change the saved preference',
      async () => {
        await openCurrency();
        await choose('usd');
        await expect(save()).toBeEnabled();
        await page.goBack();
        await expect(page).toHaveURL(/#\/home$/);
        await openCurrency();
        await expect(
          page.getByRole('button', {
            name: en.settings.setYourPreferred,
            exact: true,
          })
        ).toContainText('GBP');
        await expect(save()).toBeDisabled();
        await expect(page.getByRole('alert')).toHaveCount(0);
        observations.canceledDraft = {
          state: await publicState(page),
          ui: await uiState(page),
        };
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(unsupportedQuotes).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    phase = 'cleanup';
    releaseQuote?.();
    releaseGbpQuote?.();
    await heldQuoteFinished;
    await heldGbpQuoteFinished;
    try {
      const worker = wallet?.context
        .serviceWorkers()
        .find((candidate) =>
          candidate
            .url()
            .startsWith(`chrome-extension://${wallet!.extensionId}/`)
        );
      await worker
        ?.evaluate(() =>
          (globalThis as any).__currencySaveStorageRefusal?.restore()
        )
        .catch(() => undefined);
      await info.attach('currency-save-quote-deadline-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          observations,
          quotes: quotes.map((row) => ({
            ...row,
            heldForMs:
              row.releasedAt === undefined
                ? null
                : row.releasedAt - row.receivedAt,
          })),
          unsupportedQuotes,
          pageErrors,
          deniedWrites: routes?.deniedWrites ?? [],
          fixtureReads: routes?.reads ?? [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          emitterTimeoutChanged: false,
          networkTimeoutChanged: false,
          quoteHTTPResponseOnlyDelayed: true,
          heldCadRequestObserved: heldCad,
          heldGbpRequestObserved: heldGbp,
          storageFailureSeam: {
            mechanism:
              'scoped one-shot chrome.storage.local.set refusal; original restored',
            actual: observations.realStorageRefusal?.refusal ?? null,
          },
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
