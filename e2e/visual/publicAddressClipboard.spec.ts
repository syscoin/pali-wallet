import { expect, test, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const selection = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const account = state.vault.accounts[ref.type][ref.id];
    return { id: ref.id, address: account.address, label: account.label };
  });

for (const view of ['header', 'receive', 'edit'] as const) {
  test(`public address copy feedback follows the current ${view} context and native result`, async ({}, info) => {
    test.setTimeout(120_000);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PublicCopySynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let control: Page | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`public-address-copy-${view}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet.ensureOnHome();
      const page = wallet.page;
      const original = await selection(page);
      await wallet.gotoRoute('#/settings/account/new');
      await page
        .locator('#account-name-input')
        .fill('Clipboard second account');
      await page.locator('#create-btn').click();
      await page.getByRole('button', { name: /^ok$/i }).first().click();
      await wallet.ensureOnHome();
      const second = await selection(page);
      expect(second.id).not.toBe(original.id);
      expect(second.address).not.toBe(original.address);
      control = await wallet.context.newPage();
      await control.goto(wallet.appUrl('#/home'));
      await expect(control.locator('#home-balance')).toBeVisible();
      const choose = async (account: typeof original) => {
        await control!
          .locator('#general-settings-button')
          .locator('..')
          .click();
        await control!
          .getByRole('menuitem', {
            name: `${account.label} (${account.address})`,
            exact: true,
          })
          .click();
        await expect.poll(() => selection(page)).toMatchObject(account);
      };
      await choose(original);
      if (view === 'receive') await wallet.gotoRoute('#/receive');
      if (view === 'edit') {
        await wallet.gotoRoute('#/settings/manage-accounts');
        await page
          .getByRole('button', { name: `Edit: ${original.label}`, exact: true })
          .click();
        await expect(page).toHaveURL(/settings\/edit-account/);
      }
      // Only the native clipboard boundary is controlled. Account creation,
      // selection, controller replies and rendered wallet state stay real.
      await page.evaluate(() => {
        (window as any).__publicCopies = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (text: string) =>
              new Promise<void>((resolve, reject) => {
                (window as any).__publicCopies.push(text);
                (window as any).__finishPublicCopy = (success: boolean) =>
                  success
                    ? resolve()
                    : reject(
                        new DOMException(
                          'Synthetic clipboard refusal',
                          'NotAllowedError'
                        )
                      );
              }),
          },
        });
      });
      const copy = () =>
        view === 'header'
          ? page.locator('#copy-address-btn').locator('..')
          : view === 'receive'
          ? page.locator('#copy-address-receive-btn button')
          : page
              .locator('#edit-account')
              .getByRole('button', { name: en.buttons.copy, exact: true });
      const finish = async (success: boolean) => {
        await page.evaluate(async (accepted) => {
          (window as any).__finishPublicCopy(accepted);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        }, success);
      };
      await copy().click();
      expect(await page.evaluate(() => (window as any).__publicCopies)).toEqual(
        [original.address]
      );
      await expect(
        page.getByText(en.home.addressCopied, { exact: true })
      ).toHaveCount(0);
      await choose(second);
      await finish(true);
      await expect(
        page.getByText(en.home.addressCopied, { exact: true })
      ).toHaveCount(0);
      if (view === 'edit')
        await expect(
          page.getByText(en.components.copied, { exact: true })
        ).toHaveCount(0);

      // Fresh copies remain usable after the old request is retired.
      await copy().click();
      const currentAddress =
        view === 'edit' ? original.address : second.address;
      expect(
        (await page.evaluate(() => (window as any).__publicCopies)).at(-1)
      ).toBe(currentAddress);
      await finish(false);
      await expect(
        page.getByText(en.transactions.copyFailed, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(en.home.addressCopied, { exact: true })
      ).toHaveCount(0);
      await copy().click();
      expect(
        (await page.evaluate(() => (window as any).__publicCopies)).at(-1)
      ).toBe(currentAddress);
      await finish(true);
      if (view === 'edit')
        await expect(
          page.getByText(en.components.copied, { exact: true })
        ).toBeVisible();
      else
        await expect(
          page.getByText(en.home.addressCopied, { exact: true })
        ).toBeVisible();
      await info.attach(`public-address-copy-${view}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        try {
          await control?.close();
        } finally {
          await wallet?.dispose(status);
        }
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
