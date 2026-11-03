import { expect, test } from '@playwright/test';
import { HDNodeWallet } from 'ethers';

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
const password = 'PublicWatchControl!2026';
const failure = 'Synthetic JSON-RPC endpoint has no Blockbook API';
for (const family of ['EVM', 'UTXO'] as const) {
  test(`normal ${family} watch-only import survives reload without a Blockbook request on EVM`, async ({}, info) => {
    test.setTimeout(90000);
    const old = { ...E2E_CONFIG },
      noCopy = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password,
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined,
      status: 'passed' | 'failed' = 'failed';
    const rejectedReads: string[] = [];
    try {
      wallet = await PaliWallet.launch(`watch-only-import-${family}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
      });
      const fixture = createIsolatedVaultFixture();
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(
        'https://rpc.tanenbaum.io/api/v2/address/**',
        async (route) => {
          expect(route.request().method()).toBe('GET');
          rejectedReads.push(route.request().url());
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: failure }),
          });
        }
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork(
        family === 'EVM' ? 'Syscoin NEVM Testnet' : 'Syscoin Testnet',
        family
      );
      await wallet.ensureOnHome();
      const page = wallet.page;
      const count = () =>
        page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          return Object.values(state.vault.accounts).reduce<number>(
            (n: number, bucket: any) => n + Object.keys(bucket).length,
            0
          );
        });
      const before = await count();
      await page.locator('#general-settings-button').click();
      await page
        .getByRole('menuitem', {
          name: en.accountMenu.importAccount,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/#\/settings\/account\/import$/);
      await page
        .locator('#account-name-input')
        .fill(`Public ${family} control`);
      await page.locator('#import-account-watch-only').check();
      const address =
        family === 'EVM'
          ? HDNodeWallet.fromPhrase(
              UTXO_FIXTURE_SEED,
              undefined,
              "m/44'/60'/0'/0/9"
            ).address
          : fixture.watchAddress;
      await page.locator('#import-account-identifier').fill(address);
      const submit = page.getByRole('button', {
        name: en.buttons.import,
        exact: true,
      });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await count()).toBe(before + 1);
      expect(rejectedReads).toEqual([]);
      for (const width of [400, 320]) {
        await page.setViewportSize({
          width,
          height: width === 400 ? 620 : 360,
        });
        await page.mouse.move(0, 0);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter((a) =>
                Number.isFinite(Number(a.effect?.getComputedTiming().endTime))
              )
              .map((a) => a.finished.catch(() => undefined))
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        await info.attach(`${family}-watch-import-${width}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
      await page
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await page.reload();
      await wallet.ensureOnHome();
      const identity = await page.evaluate(async () => {
        const state = await chrome.runtime.sendMessage({
          type: 'getCurrentState',
        });
        const active = state.vault.activeAccount;
        const account = state.vault.accounts[active.type][active.id];
        return {
          type: active.type,
          address: account.address,
          xpub: account.xpub,
          privateKeyPresent: Boolean(account.xprv),
        };
      });
      expect(identity).toEqual({
        type: 'Imported',
        address,
        xpub: address,
        privateKeyPresent: false,
      });
      const openSettings = async (name: string) => {
        await page.locator('#general-settings-button').click();
        await page.getByRole('menuitem', { name, exact: true }).click();
      };
      // Exercise the real account menu and manager for a public watch account.
      await page.locator('#general-settings-button').click();
      const importedMenuBadge = page
        .locator('[id^="account-Imported-"]')
        .getByText(en.components.imported, { exact: true });
      const paliMenuBadge = page
        .locator('[id^="account-HDAccount-"]')
        .getByText('Pali', { exact: true });
      for (const width of [400, 320]) {
        await page.setViewportSize({
          width,
          height: width === 400 ? 620 : 360,
        });
        const importedMenuContrast = await captureForegroundContrast(
          importedMenuBadge,
          info,
          `${family}-watch-menu-imported-${width}`
        );
        expect(importedMenuContrast.disabled).toBe(false);
        const paliMenuContrast = await captureForegroundContrast(
          paliMenuBadge,
          info,
          `${family}-watch-menu-pali-${width}`
        );
        expect(paliMenuContrast.disabled).toBe(false);
      }
      await page
        .getByRole('menuitem', {
          name: en.accountMenu.manageAccounts,
          exact: true,
        })
        .click();
      const accountList = page.locator(
        'ul[data-navigation-scroll="settings-manage-accounts"]'
      );
      const importedManagerBadge = accountList.getByText(
        en.components.imported,
        {
          exact: true,
        }
      );
      const paliManagerBadge = accountList.getByText('Pali', { exact: true });
      for (const width of [400, 320]) {
        await page.setViewportSize({
          width,
          height: width === 400 ? 620 : 360,
        });
        const importedManagerContrast = await captureForegroundContrast(
          importedManagerBadge,
          info,
          `${family}-watch-manager-imported-${width}`
        );
        expect(importedManagerContrast.disabled).toBe(false);
        const paliManagerContrast = await captureForegroundContrast(
          paliManagerBadge,
          info,
          `${family}-watch-manager-pali-${width}`
        );
        expect(paliManagerContrast.disabled).toBe(false);
      }
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await openSettings(en.accountMenu.yourKeys);
      await expect(
        page.getByText(en.settings.watchOnlyNoPrivateKey, { exact: true })
      ).toBeVisible();
      await expect(page.locator('#phraseview_password')).toHaveCount(0);
      await expect(page.getByTitle(address, { exact: true })).toBeVisible();
      for (const width of [400, 320]) {
        await page.setViewportSize({
          width,
          height: width === 400 ? 620 : 360,
        });
        await info.attach(`${family}-watch-public-keys-${width}`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
      await page
        .getByRole('button', { name: en.buttons.close, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await openSettings(en.accountMenu.importAccount);
      await page
        .locator('#account-name-input')
        .fill('Duplicate public control');
      await page.locator('#import-account-watch-only').check();
      await page
        .locator('#import-account-identifier')
        .fill(family === 'EVM' ? address.toLowerCase() : address);
      await page
        .getByRole('button', { name: en.buttons.import, exact: true })
        .click();
      await expect(page.getByText(/Account already exists/)).toBeVisible();
      expect(await count()).toBe(before + 1);
      expect(rejectedReads).toEqual([]);
      await info.attach('watch-import-evidence', {
        body: JSON.stringify({
          family,
          address,
          before,
          after: await count(),
          rejectedReads,
          blockbookReads: routes.reads.filter((x) =>
            x.startsWith('synthetic-blockbook:')
          ),
          deniedWrites: routes.deniedWrites,
        }),
        contentType: 'application/json',
      });
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, old);
        if (noCopy === undefined) delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
        else process.env.PLAYWRIGHT_NO_COPY_PROMPT = noCopy;
      }
    }
  });
}
