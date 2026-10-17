import { expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('browser Back and Forward restore account-list and editor scroll in a short window', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NavigationRoundTripSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('navigation-round-trip', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 360 },
    });
    const { page } = wallet;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    for (let id = 0; id < 5; id++) {
      await wallet.gotoRoute('#/settings/account/new');
      await page.locator('#account-name-input').fill(`Round Trip ${id}`);
      await page.locator('#create-btn').click();
      await page.getByRole('button', { name: 'Ok', exact: true }).click();
      await wallet.ensureOnHome();
    }
    await wallet.gotoRoute('#/settings/manage-accounts');
    const list = page.locator(
      '[data-navigation-scroll="settings-manage-accounts"]'
    );
    await list.hover({ position: { x: 180, y: 30 } });
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(300);
    const listTop = await list.evaluate((element) => element.scrollTop);
    expect(listTop).toBeGreaterThan(0);
    await page
      .locator('li')
      .filter({ hasText: 'Round Trip 4' })
      .getByRole('button')
      .first()
      .click();
    await expect(page).toHaveURL(/#\/settings\/edit-account$/);
    const editor = page.locator('[data-navigation-scroll="wallet-layout"]');
    await editor.hover({ position: { x: 180, y: 120 } });
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(300);
    const editorTop = await editor.evaluate((element) => element.scrollTop);
    expect(editorTop).toBeGreaterThan(0);
    await info.attach('navigation-round-trip-positions', {
      body: JSON.stringify({ listTop, editorTop }),
      contentType: 'application/json',
    });
    await page.goBack();
    await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
    await expect
      .poll(() => list.evaluate((element) => element.scrollTop))
      .toBe(listTop);
    await info.attach('browser-back-account-list', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    await page.goForward();
    await expect(page).toHaveURL(/#\/settings\/edit-account$/);
    await expect
      .poll(() => editor.evaluate((element) => element.scrollTop))
      .toBe(editorTop);
    await info.attach('browser-forward-account-editor', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
