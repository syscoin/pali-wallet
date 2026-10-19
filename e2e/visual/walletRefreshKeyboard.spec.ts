import { expect, test } from '@playwright/test';
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

test('enabled wallet refresh is a named keyboard control in short windows', async ({}, info) => {
  test.setTimeout(90_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RefreshSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('wallet-refresh-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    const refresh = page.getByRole('button', {
      name: en.header.refresh,
      exact: true,
    });
    await expect(refresh).toHaveCount(0);
    await wallet.step(
      'enable refresh through ordinary advanced settings',
      async () => {
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
        await wallet!.gotoRoute('#/home');
        await wallet!.ensureOnHome();
        await expect(refresh).toHaveAttribute('type', 'button');
      }
    );
    const worker = wallet.context.serviceWorkers()[0];
    expect(worker).toBeTruthy();
    // Observe the real trusted request; this listener never replies or changes it.
    await worker.evaluate(() => {
      (globalThis as any).__refreshRequests = 0;
      chrome.runtime.onMessage.addListener((message) => {
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.length === 1 &&
          message.data.methods[0] === 'refresh'
        ) {
          (globalThis as any).__refreshRequests += 1;
        }
      });
    });
    let expectedRequests = 0;
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ]) {
      await wallet.step(`keyboard refresh at ${width}x${height}`, async () => {
        await page.setViewportSize({ width, height });
        for (let index = 0; index < 24; index++) {
          if (await refresh.evaluate((node) => node === document.activeElement))
            break;
          await page.keyboard.press('Tab');
        }
        await expect(refresh).toBeFocused();
        await expect(refresh).toBeInViewport();
        await page.keyboard.press('Enter');
        await expect
          .poll(() =>
            worker.evaluate(() => (globalThis as any).__refreshRequests)
          )
          .toBe(++expectedRequests);
        await expect(refresh).toBeFocused();
        await page.keyboard.press('Space');
        await expect
          .poll(() =>
            worker.evaluate(() => (globalThis as any).__refreshRequests)
          )
          .toBe(++expectedRequests);
        await expect(page).toHaveURL(/#\/home$/);
      });
    }
    await refresh.click();
    await expect
      .poll(() => worker.evaluate(() => (globalThis as any).__refreshRequests))
      .toBe(++expectedRequests);
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('refresh-evidence', {
      body: JSON.stringify({
        ...extensionEvidence(),
        expectedRequests,
        deniedWrites: routes.deniedWrites,
        controllerResultsReplaced: false,
      }),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
