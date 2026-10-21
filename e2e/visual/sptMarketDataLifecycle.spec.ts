import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
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

test('SPT market failure settles and a later visit can display price-only data', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  const runtime = extensionEvidence();
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'MarketReadSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let recovered = false;
  let releaseDuplicate: (() => void) | undefined;
  const marketReads: number[] = [];
  const failureBody = 'Synthetic record 503 not found';
  const pageErrors: string[] = [];
  try {
    wallet = await PaliWallet.launch('spt-market-data-lifecycle', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route(
      (url) => url.pathname === '/api/v2/asset/123456',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            asset: {
              assetGuid: '123456',
              symbol: 'SYSX',
              name: 'Synthetic known-GUID metadata',
              decimals: 8,
              balance: '0',
              totalSent: '0',
              totalReceived: '0',
              type: 'SPTAllocated',
            },
          }),
        })
    );
    await wallet.context.route(
      (url) =>
        url.origin === 'https://api.coingecko.com' &&
        url.pathname === '/api/v3/coins/syscoin',
      async (route) => {
        // Other startup reads have a different query; only the asset-details
        // request is under test through Pali's actual retryableFetch helper.
        if (
          new URL(route.request().url()).searchParams.get('market_data') !==
          'true'
        )
          return route.fallback();
        marketReads.push(recovered ? 200 : 404);
        // Bound evidence on a regressed build instead of feeding a hot loop.
        if (!recovered && marketReads.length > 1)
          await new Promise<void>((resolve) => {
            releaseDuplicate = resolve;
          });
        return route.fulfill({
          status: recovered ? 200 : 404,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(
            recovered
              ? // eslint-disable-next-line camelcase
                { market_data: { current_price: { usd: 42 } } }
              : { error: failureBody }
          ),
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const details = page.getByRole('button', {
      name: 'View details for SYSX token',
      exact: true,
    });
    // The shell header also has an icon-only "Close" control. Exercise the
    // asset details' visible footer action, not that separate shell action.
    const closeDetails = page
      .getByRole('button', { name: en.buttons.close, exact: true })
      .filter({ hasText: en.buttons.close });
    await wallet.step(
      'onboard and preview a known SPT using HTTP-only metadata',
      async (capture) => {
        try {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await page
            .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
            .click();
          await page.locator('#custom-spt-guid').fill('123456');
          await expect(details).toBeVisible();
          await details.click();
          await expect(page).toHaveURL(/#\/home\/details/);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'settle the failed market read without silently starting more requests',
      async (capture) => {
        try {
          await expect.poll(() => marketReads.length).toBeGreaterThan(0);
          await expect(page.locator('.animate-spin')).toHaveCount(0);
          await page.waitForTimeout(500);
          expect(marketReads).toEqual([404]);
          await expect(closeDetails).toBeEnabled();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'revisit after HTTP recovery and keep price-only data readable',
      async (capture) => {
        try {
          await closeDetails.click();
          await expect(details).toBeVisible();
          recovered = true;
          await details.click();
          await expect(
            page.getByText(en.tokens.currentPrice, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText('$42.000000', { exact: true })
          ).toBeVisible();
          await expect(page.getByText(/\(24h\)/)).toHaveCount(0);
          expect(marketReads).toEqual([404, 200]);
          expect(pageErrors).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    status = 'passed';
  } finally {
    releaseDuplicate?.();
    try {
      await info.attach('runtime-and-http-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            marketReads,
            failureBody,
            pageErrors,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            deniedWrites: routes?.deniedWrites ?? [],
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, before);
    }
  }
});
