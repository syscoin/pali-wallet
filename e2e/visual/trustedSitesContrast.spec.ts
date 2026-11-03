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
  test(`trusted-site status labels remain readable at${width}`, async ({}, info) => {
    const old = { ...E2E_CONFIG },
      server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PublicTrustControl!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined,
      status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`trusted-sites-contrast-${width}`, {
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
      const selection = () =>
        page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          return {
            network: state.vault.activeNetwork,
            account: state.vault.activeAccount,
            grants: Object.keys(state.dapp.dapps),
          };
        });
      const before = await selection();
      expect(before.grants).toEqual([]);
      await page
        .locator('button[aria-haspopup="menu"]')
        .filter({ hasText: /Syscoin|NEVM/ })
        .first()
        .click();
      const trustedAction = page.getByText(en.networkMenu.trustedSites, {
        exact: true,
      });
      const trustedPaint = trustedAction.locator('..').locator('svg path');
      await page.mouse.move(width - 1, 1);
      for (const state of ['rest', 'hover'] as const) {
        if (state === 'hover') await trustedAction.hover();
        await captureForegroundContrast(
          trustedAction,
          info,
          `trusted-action-${state}-${width}`
        );
        // Prove the rendered SVG paint follows the measured foreground rather
        // than assuming a currentColor class overrides a hard-coded fill.
        const foreground = await trustedAction.evaluate(
          (element) => getComputedStyle(element).color
        );
        const paints = await trustedPaint.evaluateAll((paths) =>
          paths.map((path) => ({
            fill: getComputedStyle(path).fill,
            color: getComputedStyle(path).color,
          }))
        );
        expect(paints.length).toBeGreaterThan(0);
        expect(paints).toEqual(
          paints.map(() => ({ fill: foreground, color: foreground }))
        );
        await captureForegroundContrast(
          trustedPaint.first(),
          info,
          `trusted-action-paint-${state}-${width}`,
          'currentColor-icon'
        );
      }
      await trustedAction.click();
      await expect(page).toHaveURL(/#\/settings\/networks\/trusted-sites$/);
      const search = page.getByRole('textbox', {
        name: en.settings.searchTrustedSites,
        exact: true,
      });
      await search.fill('unlisted-contrast.invalid');
      await captureForegroundContrast(
        page.getByText(en.settings.unlistedSite, { exact: true }),
        info,
        `unlisted-control-${width}`
      );
      await search.fill('metamask.io');
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(
        page.locator('[data-navigation-scroll=trusted-sites]')
      ).toContainText('metamask.io');
      await captureForegroundContrast(
        page.getByText(en.settings.trustedSiteMatch, { exact: true }),
        info,
        `trusted-status-${width}`
      );
      expect(await selection()).toEqual(before);
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
