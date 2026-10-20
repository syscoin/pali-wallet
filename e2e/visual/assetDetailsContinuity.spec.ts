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

for (const width of [320, 400]) {
  test(`asset details keep keyboard focus and their live pane when market data arrives at ${width}px`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    const runtime = extensionEvidence();
    const before = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'DetailsContinuitySynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    let release!: () => void;
    const delayedRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let marketReads = 0;
    const observations: unknown[] = [];
    try {
      wallet = await PaliWallet.launch(`asset-details-continuity-${width}`, {
        offlineHttpProxy: server.url,
        viewport: { width, height: 360 },
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
                name: 'Synthetic known-GUID asset',
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
          if (
            new URL(route.request().url()).searchParams.get('market_data') !==
            'true'
          )
            return route.fallback();
          marketReads += 1;
          await delayedRead;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            // HTTP-only synthetic metadata; real fetching/rendering unchanged.
            // eslint-disable-next-line camelcase
            body: JSON.stringify({
              market_data: { current_price: { usd: 42 } },
              description: {
                en:
                  width === 320
                    ? { summary: 'Synthetic malformed description' }
                    : '<b>Synthetic SPT description</b>',
              },
            }),
          });
        }
      );
      const page = wallet.page;
      const close = page
        .getByRole('button', { name: en.buttons.close, exact: true })
        .filter({ hasText: en.buttons.close });
      const pane = page.locator('[data-navigation-scroll="asset-details"]');
      await wallet.step(
        `${width}px open an ordinary SPT details preview while its HTTP market read is pending`,
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
              .getByRole('button', {
                name: en.tokens.addCustomTab,
                exact: true,
              })
              .click();
            await page.locator('#custom-spt-guid').fill('123456');
            await page
              .getByRole('button', {
                name: 'View details for SYSX token',
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/home\/details/);
            await expect.poll(() => marketReads).toBe(1);
            await expect(pane.locator('.animate-spin')).toHaveCount(1);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        `${width}px reach the visible details footer using the keyboard`,
        async (capture) => {
          try {
            for (let index = 0; index < 25; index++) {
              if (
                await close.evaluate(
                  (element) => element === document.activeElement
                )
              )
                break;
              await page.keyboard.press('Tab');
            }
            expect(
              await close.evaluate(
                (element) => element === document.activeElement
              )
            ).toBe(true);
            const top = await pane.evaluate((element) => element.scrollTop);
            observations.push({ phase: 'pending', focused: true, top });
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      const oldPane = await pane.elementHandle();
      const oldClose = await close.elementHandle();
      await wallet.step(
        `${width}px complete the real HTTP read without replacing the focused control or details pane`,
        async (capture) => {
          try {
            release();
            await expect(
              page.getByText('$42.000000', { exact: true })
            ).toBeAttached();
            const result = {
              phase: 'settled',
              focused: await close.evaluate(
                (element) => element === document.activeElement
              ),
              oldPaneConnected: await oldPane!.evaluate(
                (element) => element.isConnected
              ),
              oldCloseConnected: await oldClose!.evaluate(
                (element) => element.isConnected
              ),
              top: await pane.evaluate((element) => element.scrollTop),
            };
            observations.push(result);
            // Snapshot assertions must not wait for some later focus recovery.
            expect(result.focused).toBe(true);
            expect(result.oldPaneConnected).toBe(true);
            expect(result.oldCloseConnected).toBe(true);
            await expect(
              page.getByText(en.tokens.about, { exact: true })
            ).toHaveCount(width === 320 ? 0 : 1);
            await expect(
              page.getByText('<b>Synthetic SPT description</b>', {
                exact: true,
              })
            ).toHaveCount(width === 320 ? 0 : 1);
            await expect(page.locator('p b')).toHaveCount(0);
            expect(marketReads).toBe(1);
            expect(routes!.deniedWrites).toEqual([]);
            await close.click();
            await expect(page).toHaveURL(/#\/tokens\/add/);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      status = 'passed';
    } finally {
      release();
      try {
        await info.attach('asset-details-continuity-evidence', {
          body: JSON.stringify(
            {
              ...runtime,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(__filename))
                .digest('hex'),
              width,
              malformedDescription: width === 320,
              height: 360,
              syntheticHttpOnly: true,
              controllerStateReplaced: false,
              controllerResultReplaced: false,
              marketReads,
              observations,
              deniedWrites: routes?.deniedWrites ?? [],
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
          try {
            await server.close();
          } finally {
            Object.assign(E2E_CONFIG, before);
          }
        }
      }
    }
  });
}
