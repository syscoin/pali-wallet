import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
for (const width of [400, 320])
  test(`protected-view confirmation keeps wrong and valid drafts readable at${width}`, async ({}, info) => {
    const old = { ...E2E_CONFIG },
      server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PrivateConfirmSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined,
      status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`protected-input-contrast-${width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 400 ? 620 : 360 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.ensureOnHome();
      const page = wallet.page;
      await page.locator('#general-settings-button').click();
      await page
        .getByRole('menuitem', { name: en.accountMenu.yourKeys, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/account\/private-key$/);
      const confirm = page.getByRole('button', {
        name: en.buttons.confirm,
        exact: true,
      });
      await expect(confirm).toBeDisabled();
      await captureForegroundContrast(confirm, info, `empty-control-${width}`);
      await page
        .locator('input[type=password]')
        .fill('WrongPublicFixture!2026');
      await expect(confirm).toBeEnabled();
      await captureForegroundContrast(confirm, info, `wrong-draft-${width}`);
      await confirm.click();
      await expect(
        page.getByText(en.start.wrongPassword, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: en.buttons.show, exact: true })
      ).toHaveCount(0);
      await page.locator('input[type=password]').fill(E2E_CONFIG.password);
      await expect(confirm).toBeEnabled();
      await captureForegroundContrast(confirm, info, `valid-draft-${width}`);
      await confirm.click();
      await expect(
        page.getByRole('button', { name: en.buttons.show, exact: true })
      ).toBeVisible();
      await expect(page.locator('p.font-mono')).toHaveCount(0);
      // The authenticated secret stays concealed; never activate Show or copy it.
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, old);
      }
    }
  });
