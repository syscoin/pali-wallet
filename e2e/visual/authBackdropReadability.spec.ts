import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Welcome and Unlock keep readable text over the short-window backdrop', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AuthReadabilitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let result: 'passed' | 'failed' = 'failed';
  const runtime = extensionEvidence();
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('auth-backdrop-readability', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    const page = wallet.page;
    const inspect = async (state: 'welcome' | 'unlock') => {
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 400, height: 619 },
        { width: 400, height: 600 },
        { width: 400, height: 580 },
        { width: 400, height: 500 },
        { width: 400, height: 499 },
        { width: 400, height: 360 },
        { width: 320, height: 620 },
        { width: 320, height: 500 },
        { width: 320, height: 360 },
      ]) {
        await wallet!.step(
          `${state}: inspect backdrop, text and keyboard link at ${viewport.width}x${viewport.height}`,
          async () => {
            await page.setViewportSize(viewport);
            await expect(page.locator('#initial-loader')).toHaveAttribute(
              'aria-hidden',
              'true'
            );
            await expect(page.locator('#initial-loader')).toHaveAttribute(
              'inert',
              ''
            );
            await expect(
              page.getByRole('heading', { name: 'Pali', exact: true })
            ).toHaveCount(1);
            const backdrop = page.locator('.login-animated-bg');
            const link = page.locator('#import-wallet-link');
            await expect(link).toHaveText(
              state === 'welcome'
                ? en.start.importWalletSeedPhrase
                : en.start.importUsing
            );
            const art = await backdrop.evaluate(
              (element) => getComputedStyle(element).backgroundImage
            );
            const renderedViewport = await backdrop.evaluate((element) => ({
              width: innerWidth,
              height: innerHeight,
              backgroundImage: getComputedStyle(element).backgroundImage,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            }));
            expect(renderedViewport.width).toBe(viewport.width);
            expect(renderedViewport.height).toBe(viewport.height);
            if (viewport.height < 620 || viewport.width < 400) {
              expect(art).toBe('none');
              const heading = await captureForegroundContrast(
                backdrop.getByRole('heading', { name: 'Pali', exact: true }),
                info,
                `${state}-heading-${viewport.width}x${viewport.height}`
              );
              const action = await captureForegroundContrast(
                link,
                info,
                `${state}-import-${viewport.width}x${viewport.height}`
              );
              observations.push({
                state,
                viewport,
                renderedViewport,
                heading,
                action,
              });
            } else {
              expect(art).toMatch(/^url\(/);
              observations.push({ state, viewport, renderedViewport });
            }
            // Use ordinary keyboard traversal, without focusing a DOM node.
            await page.keyboard.press('Tab');
            for (let index = 0; index < 8; index++) {
              if (
                await link.evaluate((node) => node === document.activeElement)
              )
                break;
              await page.keyboard.press('Tab');
            }
            await expect(link).toBeFocused();
            await expect(link).toBeInViewport();
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth)
            ).toBeLessThanOrEqual(viewport.width);
            await page.mouse.move(0, 0);
            await info.attach(`${state}-${viewport.width}x${viewport.height}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
        );
      }
    };
    await inspect('welcome');
    await wallet.step(
      'import only the disposable fixture and lock through the ordinary menu',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await page.locator('#general-settings-button').click();
        await page.getByText(en.generalMenu.lock, { exact: true }).click();
        await expect(page.locator('#login #password')).toBeVisible();
        await expect(page.locator('#unlock-btn')).toBeEnabled();
      }
    );
    await inspect('unlock');
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    result = 'passed';
  } finally {
    await info.attach('auth-backdrop-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({ runtime, result, observations }),
    });
    try {
      await wallet?.dispose(result);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
