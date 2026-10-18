import { expect, test } from '@playwright/test';
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

test('SPT discovery failure offers Retry without claiming the wallet has no additional tokens', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SptDiscoverySynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  type DiscoveryPhase = 'setup' | 'unavailable' | 'recovered';
  let phase: DiscoveryPhase = 'setup';
  const discoveryResponses: { phase: DiscoveryPhase; status: number }[] = [];
  const normalAccountReads: {
    details: string | null;
    tokens: string | null;
  }[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  try {
    wallet = await PaliWallet.launch('spt-discovery-retry', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Fail this scoped discovery read only after initialization. Ordinary asset
    // refresh uses tokens=used; bootstrap may also use nonzero and stays allowed.
    await wallet.context.route(
      (url) =>
        [
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin) &&
        url.pathname === `/api/v2/xpub/${fixture.utxo.userXpub}`,
      async (route) => {
        const request = route.request();
        if (request.method() !== 'GET') return route.fallback();
        const url = new URL(request.url());
        const options = {
          details: url.searchParams.get('details'),
          tokens: url.searchParams.get('tokens'),
        };
        if (
          phase === 'setup' ||
          options.details !== 'tokenBalances' ||
          options.tokens !== 'nonzero'
        ) {
          normalAccountReads.push(options);
          return route.fallback();
        }
        const unavailable = phase === 'unavailable';
        discoveryResponses.push({ phase, status: unavailable ? 503 : 200 });
        return route.fulfill({
          status: unavailable ? 503 : 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(
            unavailable
              ? { error: 'Synthetic owned-token discovery unavailable' }
              : {
                  ...(fixtureRead(fixture.utxo, request.url(), 'GET') as Record<
                    string,
                    unknown
                  >),
                  tokensAsset: [],
                }
          ),
        });
      }
    );
    const page = wallet.page;
    const error = page
      .getByRole('alert')
      .filter({ hasText: en.settings.apiConnectionError });
    const retry = page.getByRole('button', {
      name: en.receive.retry,
      exact: true,
    });
    const assertNotEmpty = async () => {
      await expect(
        page.getByText(en.tokens.noTokensFound, { exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByText(en.tokens.youDontHaveTokensYet, { exact: true })
      ).toHaveCount(0);
    };
    await wallet.step(
      'import a disposable synthetic wallet and select the UTXO fixture',
      async (capture) => {
        try {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await expect(page.locator('#home-balance')).toHaveText('0.001');
          expect(discoveryResponses).toHaveLength(0);
          // Bootstrap may share these account query options. Arm the failure
          // only after normal network/account initialization has settled.
          phase = 'unavailable';
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'open token import and distinguish a failed discovery read from an empty result',
      async (capture) => {
        try {
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
          // HTTP503 intentionally exercises the SDK's built-in backoff before
          // the real controller rejects the owned-token discovery request.
          await expect(error).toBeVisible({ timeout: 25_000 });
          await expect(retry).toBeEnabled();
          await assertNotEmpty();
          expect(discoveryResponses.length).toBeGreaterThan(0);
          expect(
            discoveryResponses.every((response) => response.status === 503)
          ).toBe(true);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'keep manual GUID entry available while owned-token discovery is unavailable',
      async (capture) => {
        try {
          await page
            .getByRole('button', {
              name: en.tokens.addCustomTab,
              exact: true,
            })
            .click();
          await expect(page.locator('#custom-spt-guid')).toBeVisible();
          await expect(page.locator('#custom-spt-guid')).toBeEditable();
          await page.locator('#custom-spt-guid').focus();
          await expect(page.locator('#custom-spt-guid')).toBeFocused();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'return to the discovery error without silently retrying or showing false empty copy',
      async (capture) => {
        try {
          const attempts = discoveryResponses.length;
          await page
            .getByRole('button', { name: en.tokens.yourTokens, exact: true })
            .click();
          await expect(error).toBeVisible();
          await expect(retry).toBeEnabled();
          // The fixture has recovered, but only an explicit Retry may replace
          // the settled error. This also lets the request-dedup cache expire.
          phase = 'recovered';
          await page.waitForTimeout(500);
          expect(discoveryResponses).toHaveLength(attempts);
          await assertNotEmpty();
          await expect(error).toBeVisible();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'explicitly retry discovery and show a genuine empty result after HTTP recovery',
      async (capture) => {
        try {
          await retry.click();
          await expect(
            page.getByText(en.tokens.noTokensFound, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(en.tokens.youDontHaveTokensYet, { exact: true })
          ).toBeVisible();
          await expect(error).toHaveCount(0);
          await expect(retry).toHaveCount(0);
          expect(
            discoveryResponses.filter((response) => response.status === 200)
          ).toEqual([{ phase: 'recovered', status: 200 }]);
          expect(normalAccountReads.length).toBeGreaterThan(0);
          expect(routes!.deniedWrites).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('runtime-and-http-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            requestMatch: {
              method: 'GET',
              path: '/api/v2/xpub/<public-synthetic-account>',
              details: 'tokenBalances',
              tokens: 'nonzero',
            },
            discoveryResponses,
            normalAccountReads,
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedConnections: server.blocked.length,
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
        await server.close();
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
