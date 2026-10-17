import { expect, test, type Locator, type Page } from '@playwright/test';
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

const focusByTab = async (page: Page, target: Locator) => {
  for (let i = 0; i < 24; i++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

test('empty-list import and connected-sites shortcut are keyboard operable', async ({}, info) => {
  test.setTimeout(90_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'QA122ShortcutsSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa122-settings-shortcuts', {
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
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ]) {
      await wallet.step(
        `keyboard settings shortcuts ${width}x${height}`,
        async () => {
          await page.setViewportSize({ width, height });
          await wallet!.gotoRoute('#/home?tab=assets');
          await page.locator('#assets-btn').click();
          const importToken = page.getByRole('button', {
            name: en.home.importToken,
            exact: true,
          });
          await expect(importToken).toHaveAttribute('type', 'button');
          await focusByTab(page, importToken);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/tokens\/add/);
          await wallet!.gotoRoute('#/home');
          const connectedSites = page.getByRole('button', {
            name: en.settings.connectedSites,
            exact: true,
          });
          await expect(connectedSites).toHaveAttribute('type', 'button');
          await focusByTab(page, connectedSites);
          await page.keyboard.press('Space');
          await expect(page).toHaveURL(
            /#\/settings\/networks\/connected-sites$/
          );
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('runtime-evidence', {
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          deniedWrites: routes.deniedWrites,
          controllerStateReplaced: false,
          simulated: true,
          publicSyntheticOnly: true,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
