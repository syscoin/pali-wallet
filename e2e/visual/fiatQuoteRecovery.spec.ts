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
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Only public synthetic HTTP data changes; controller, Redux, provider and
// Chrome APIs remain real.
const quoteState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return {
      currency: state.price.fiat.asset,
      price: state.price.fiat.price,
      chainId: state.vault.activeNetwork.chainId,
      kind: state.vault.activeNetwork.kind,
      account: state.vault.activeAccount,
    };
  });

async function changeCurrency(wallet: PaliWallet, currency: string) {
  const page = wallet.page;
  await wallet.gotoRoute('#/settings/currency');
  await page
    .getByRole('button', { name: en.settings.setYourPreferred, exact: true })
    .click();
  await page
    .getByRole('textbox', { name: en.settings.searchCurrencies, exact: true })
    .fill(currency);
  const option = page.getByRole('button').filter({
    has: page.getByText(currency.toUpperCase(), { exact: true }),
  });
  await expect(option).toHaveCount(1);
  await option.click();
  await page
    .getByRole('button', { name: en.buttons.save, exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: en.settings.fiatCurrencySetSuccessfully,
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.locator('#got-it-btn').click();
  await wallet.ensureOnHome();
}

test('Home survives malformed fiat quotes and recovers without a poisoned quote cache', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const original = { ...E2E_CONFIG };
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'malformed-usd';
  let recovered = false;
  const quoteReads: Array<{ phase: string; url: string; wireSha256: string }> =
    [];
  const deniedQuoteRequests: string[] = [];
  const observations: Array<{
    phase: string;
    quote: Awaited<ReturnType<typeof quoteState>>;
    visibleFiat: string;
  }> = [];
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'FiatQuoteSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('fiat-quote-recovery', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture('200000000'),
      server.url
    );
    await wallet.context.route('**/api/v2/tickers/currency', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        ![
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin)
      )
        return route.fallback();
      if (request.method() !== 'GET' || url.search || url.hash) {
        deniedQuoteRequests.push(request.method() + ' ' + request.url());
        return route.abort('blockedbyclient');
      }
      // Keep exponent syntax on the HTTP wire: JSON.stringify(Infinity)
      // would turn the reproduction into an unrelated null-value control.
      const wire = `{"ts":1,"rates":{"usd":${
        recovered ? '4' : '9e9999'
      },"eur":13,"gbp":1e308}}`;
      quoteReads.push({
        phase,
        url: request.url(),
        wireSha256: createHash('sha256').update(wire).digest('hex'),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: wire,
      });
    });
    const page = wallet.page;
    const assertHome = async (
      currency: string,
      price: number,
      text: string
    ) => {
      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.locator('#home-balance')).toHaveText(/^2(?:\.0+)?$/);
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const quote = await quoteState(page);
          return {
            currency: quote.currency,
            price: quote.price,
            kind: quote.kind,
            chainId: quote.chainId,
          };
        })
        .toEqual({ currency, price, kind: 'syscoin', chainId: 5700 });
      const quote = await quoteState(page);
      if (observations.length)
        expect(quote.account).toEqual(observations[0].quote.account);
      observations.push({
        phase,
        quote,
        visibleFiat: text,
      });
    };
    await wallet.step(
      'fiat-quote: reject an overflowed HTTP quote while retaining Home',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect
          .poll(() => quoteReads.filter((read) => read.phase === phase).length)
          .toBeGreaterThan(0);
        await assertHome('usd', 0, en.settings.unavailable);
      }
    );
    await wallet.step(
      'fiat-quote: retain a healthy quote and currency conversion',
      async () => {
        phase = 'healthy-eur';
        await changeCurrency(wallet!, 'eur');
        await expect
          .poll(() => quoteReads.filter((read) => read.phase === phase).length)
          .toBeGreaterThan(0);
        await assertHome('eur', 13, '€26 EUR');
      }
    );
    await wallet.step(
      'fiat-quote: guard a finite quote whose balance multiplication overflows',
      async () => {
        phase = 'finite-overflow-gbp';
        await changeCurrency(wallet!, 'gbp');
        await expect
          .poll(() => quoteReads.filter((read) => read.phase === phase).length)
          .toBeGreaterThan(0);
        await assertHome('gbp', 1e308, '£0 GBP');
      }
    );
    await wallet.step(
      'fiat-quote: refetch the original currency after invalid data and recover',
      async () => {
        phase = 'recovered-usd';
        recovered = true;
        await changeCurrency(wallet!, 'usd');
        await expect
          .poll(() => quoteReads.filter((read) => read.phase === phase).length)
          .toBeGreaterThan(0);
        await assertHome('usd', 4, '$8 USD');
      }
    );
    expect(deniedQuoteRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    try {
      await info.attach('fiat-quote-recovery-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(info.file))
            .digest('hex'),
          status,
          quoteReads,
          observations,
          deniedQuoteRequests,
          deniedWrites: routes?.deniedWrites || [],
          syntheticBroadcasts: routes?.syntheticBroadcasts || [],
          otherDeniedReads: routes?.deniedUnknown || [],
          proxyDeniedRequests: server?.blocked || [],
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signingOrBroadcastRequested: false,
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
          Object.assign(E2E_CONFIG, original);
        }
      }
    }
  }
});
