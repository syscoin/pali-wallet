import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
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

// Read the actual painted control without moving focus or scrolling it into view.
const closeVisibility = (close: Locator) =>
  close.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    // Measure the actual focused outline, without assuming a padding class.
    const outlineOutset = ['none', 'hidden'].includes(style.outlineStyle)
      ? 0
      : Math.max(
          0,
          (Number.parseFloat(style.outlineWidth) || 0) +
            (Number.parseFloat(style.outlineOffset) || 0)
        );
    const center = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    return {
      focused: document.activeElement === button,
      focusVisible: button.matches(':focus-visible'),
      outlineVisible:
        !['none', 'hidden'].includes(style.outlineStyle) &&
        Number.parseFloat(style.outlineWidth) > 0 &&
        style.outlineColor !== 'transparent' &&
        !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(style.outlineColor),
      withinViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight,
      focusOutlineWithinViewport:
        rect.top - outlineOutset >= 0 &&
        rect.left - outlineOutset >= 0 &&
        rect.right + outlineOutset <= innerWidth &&
        rect.bottom + outlineOutset <= innerHeight,
      outlineOutset,
      // A rounded button's outer corners are intentionally not hit targets.
      centerHit: !!center && (center === button || button.contains(center)),
      rect: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });

for (const { width, height } of [
  { width: 320, height: 360 },
  { width: 400, height: 360 },
  { width: 400, height: 620 },
]) {
  for (const focusOwner of ['close', 'header'] as const) {
    const title =
      `asset details keep keyboard focus and their live pane when market data arrives at ${width}px` +
      (height === 360 ? '' : ` in a ${height}px window`) +
      (focusOwner === 'close' ? '' : ' without moving header focus');
    test(title, async ({}, info) => {
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
        const suffix =
          height === 360 && focusOwner === 'close'
            ? ''
            : `-${height}-${focusOwner}`;
        wallet = await PaliWallet.launch(
          `asset-details-continuity-${width}${suffix}`,
          {
            offlineHttpProxy: server.url,
            viewport: { width, height },
          }
        );
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
                id: width === 320 ? { toString: null } : 'syscoin',
                market_cap_rank: width === 320 ? { value: 7 } : 7,
                market_data: {
                  current_price: { usd: 42 },
                  market_cap: { usd: width === 320 ? { toString: null } : 0 },
                  total_volume: { usd: width === 320 ? { toString: null } : 0 },
                  circulating_supply: width === 320 ? { toString: null } : 0,
                },
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
        const captureState = async (state: string) => {
          const label = `asset-close-${state}-${width}x${height}-${focusOwner}`;
          const screenshot = await wallet!.shot(label);
          await info.attach(label, {
            path: path.join(E2E_CONFIG.artifactsDir, screenshot),
            contentType: 'image/png',
          });
        };
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
              const visible = await closeVisibility(close);
              observations.push({
                phase: 'pending',
                focused: true,
                top,
                visible,
              });
              expect(visible.focusVisible).toBe(true);
              expect(visible.outlineVisible).toBe(true);
              expect(visible.withinViewport).toBe(true);
              expect(visible.focusOutlineWithinViewport).toBe(true);
              expect(visible.centerHit).toBe(true);
              await captureState('pending');
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        const headerBack = page.getByRole('button', {
          name: en.buttons.back,
          exact: true,
        });
        const layout = page.locator('[data-navigation-scroll="wallet-layout"]');
        let headerScrollTop: number | undefined;
        if (focusOwner === 'header') {
          await wallet.step(
            `${width}px move to the header with native Shift Tab before the market reply`,
            async (capture) => {
              try {
                for (let index = 0; index < 25; index++) {
                  if (
                    await headerBack.evaluate(
                      (button) => button === document.activeElement
                    )
                  )
                    break;
                  await page.keyboard.press('Shift+Tab');
                }
                await expect(headerBack).toBeFocused();
                headerScrollTop = await layout.evaluate(
                  (element) => element.scrollTop
                );
                await captureState('pending-header');
              } finally {
                if (!page.isClosed()) await capture(page);
              }
            }
          );
        }
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
              expect(result.focused).toBe(focusOwner === 'close');
              expect(result.oldPaneConnected).toBe(true);
              expect(result.oldCloseConnected).toBe(true);
              const visible = await closeVisibility(close);
              observations.push({ phase: 'settled-visibility', visible });
              // Retain the actual loaded state even when visibility regresses.
              await captureState('loaded');
              if (focusOwner === 'close') {
                expect(visible.focused).toBe(true);
                expect(visible.focusVisible).toBe(true);
                expect(visible.outlineVisible).toBe(true);
                expect(visible.withinViewport).toBe(true);
                expect(visible.focusOutlineWithinViewport).toBe(true);
                expect(visible.centerHit).toBe(true);
              } else {
                await expect(headerBack).toBeFocused();
                expect(
                  await layout.evaluate((element) => element.scrollTop)
                ).toBe(headerScrollTop);
              }
              await expect(
                page.getByText(en.tokens.about, { exact: true })
              ).toHaveCount(width === 320 ? 0 : 1);
              await expect(
                page.getByText('<b>Synthetic SPT description</b>', {
                  exact: true,
                })
              ).toHaveCount(width === 320 ? 0 : 1);
              await expect(page.locator('p b')).toHaveCount(0);
              for (const label of [
                en.tokens.rank,
                en.tokens.marketCap,
                en.tokens.volume24h,
                en.tokens.circulatingSupply,
              ]) {
                await expect(
                  page.getByText(label, { exact: true })
                ).toHaveCount(width === 320 ? 0 : 1);
              }
              await expect(
                page.getByRole('link', {
                  name: en.tokens.historicalData,
                  exact: true,
                })
              ).toHaveCount(width === 320 ? 0 : 1);
              if (width === 400) {
                await expect(page.getByText('#7', { exact: true })).toHaveCount(
                  1
                );
                for (const label of [
                  en.tokens.marketCap,
                  en.tokens.volume24h,
                ]) {
                  await expect(
                    page
                      .getByText(label, { exact: true })
                      .locator('..')
                      .getByText('$0', { exact: true })
                  ).toHaveCount(1);
                }
                await expect(
                  page
                    .getByText(en.tokens.circulatingSupply, { exact: true })
                    .locator('..')
                    .getByText('0', { exact: true })
                ).toHaveCount(1);
              }
              expect(marketReads).toBe(1);
              expect(routes!.deniedWrites).toEqual([]);
              const rank = page.getByText(/^#\d+$/);
              if (await rank.count())
                await captureForegroundContrast(
                  rank,
                  info,
                  'spt-market-rank-' + width
                );
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
                height,
                focusOwner,
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
}
