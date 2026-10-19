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

async function accountState(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const account = state.vault.accounts.HDAccount[0];
    return {
      address: account.address,
      label: account.label,
      kind: state.vault.activeNetwork.kind,
      switching: state.vaultGlobal.isSwitchingAccount,
      status: state.vaultGlobal.networkStatus,
    };
  });
}

async function selectNetwork(page: Page, label: string, group: 'EVM' | 'UTXO') {
  await page
    .getByRole('button')
    .filter({ hasText: /UTXO|EVM/ })
    .first()
    .click();
  const menu = page.getByRole('menu');
  const category = menu
    .getByRole('menuitem', { name: new RegExp(`${group} Networks`, 'i') })
    .first();
  if ((await category.getAttribute('aria-expanded')) !== 'true')
    await category.click();
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
  await expect
    .poll(async () => {
      const state = await accountState(page);
      return (
        state.kind === (group === 'EVM' ? 'ethereum' : 'syscoin') &&
        !state.switching &&
        state.status === 'idle'
      );
    })
    .toBe(true);
}

test('a delayed label request cannot rename an account in another vault and a current edit remains usable', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLabelSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('account-label-context', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet');
    const original = await accountState(wallet.page);
    await wallet.gotoRoute('#/settings/manage-accounts');
    await wallet.page
      .locator('[data-navigation-scroll="settings-manage-accounts"] li')
      .first()
      .getByRole('button')
      .first()
      .click();
    await expect(wallet.page).toHaveURL(/settings\/edit-account/);
    await wallet.page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      (window as any).__labelPending = false;
      (window as any).__releaseLabel = undefined;
      chrome.runtime.sendMessage = ((request: any, callback: any) => {
        if (
          request?.type === 'CONTROLLER_ACTION' &&
          request.data?.methods?.join('.') === 'wallet.editAccountLabel'
        ) {
          (window as any).__labelPending = true;
          (window as any).__releaseLabel = () =>
            new Promise<boolean>((resolve) => {
              // Delay only the stale request; ordinary edits must use the
              // original transport after it has been released.
              chrome.runtime.sendMessage = send;
              send(request, (response: any) => {
                callback(response);
                resolve(Boolean(response?.error));
              });
            });
          return;
        }
        return typeof callback === 'function'
          ? send(request, callback)
          : send(request);
      }) as typeof chrome.runtime.sendMessage;
    });
    await wallet.page
      .getByPlaceholder(en.settings.accountLabel, { exact: true })
      .fill('Stale EVM label');
    await wallet.page
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect
      .poll(() => wallet!.page.evaluate(() => (window as any).__labelPending))
      .toBe(true);

    const control = await wallet.context.newPage();
    await control.goto(wallet.appUrl('#/home'));
    await expect(control.locator('#home-balance')).toBeVisible();
    await selectNetwork(control, 'Syscoin Testnet', 'UTXO');
    const other = await accountState(control);
    expect(other.address).not.toBe(original.address);
    const rejected = await wallet.page.evaluate(() =>
      (window as any).__releaseLabel()
    );
    const afterDelivery = await accountState(control);
    await info.attach('delayed-label-delivery', {
      contentType: 'application/json',
      body: JSON.stringify({ original, other, rejected, afterDelivery }),
    });
    expect
      .soft(
        rejected,
        'A delayed request must be rejected after its originating vault changes'
      )
      .toBe(true);
    expect(afterDelivery.label).toBe(other.label);

    await wallet.gotoRoute('#/settings/manage-accounts');
    await wallet.page
      .locator('[data-navigation-scroll="settings-manage-accounts"] li')
      .first()
      .getByRole('button')
      .first()
      .click();
    await wallet.page
      .getByPlaceholder(en.settings.accountLabel, { exact: true })
      .fill('Current UTXO label');
    await wallet.page
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect
      .poll(async () => (await accountState(control)).label)
      .toBe('Current UTXO label');
    await expect(wallet.page).not.toHaveURL(/settings\/edit-account/);
    await wallet.page.reload();
    await wallet.waitAppReady();
    expect((await accountState(wallet.page)).label).toBe('Current UTXO label');
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('account-label-context', {
      contentType: 'application/json',
      body: JSON.stringify({
        original,
        other,
        rejected,
        final: await accountState(control),
        deniedWrites: routes.deniedWrites,
      }),
    });
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});

test('an unsaved label draft does not follow a replacement account in another vault', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountDraftSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('account-label-draft-target', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet');
    const original = await accountState(wallet.page);
    await wallet.gotoRoute('#/settings/manage-accounts');
    await wallet.page
      .locator('[data-navigation-scroll="settings-manage-accounts"] li')
      .first()
      .getByRole('button')
      .first()
      .click();
    await expect(wallet.page).toHaveURL(/settings\/edit-account/);
    const label = wallet.page.getByPlaceholder(en.settings.accountLabel, {
      exact: true,
    });
    await label.fill('Unsaved EVM-only draft');
    const control = await wallet.context.newPage();
    await control.goto(wallet.appUrl('#/home'));
    await expect(control.locator('#home-balance')).toBeVisible();
    await selectNetwork(control, 'Syscoin Testnet', 'UTXO');
    const target = await accountState(control);
    expect(target.address).not.toBe(original.address);
    await expect
      .poll(async () => (await accountState(wallet!.page)).address)
      .toBe(target.address);
    await expect(wallet.page).toHaveURL(/settings\/edit-account/);
    await info.attach('account-draft-vault-switch', {
      body: await wallet.page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    await expect(label).toHaveValue(target.label);
    await label.fill('Explicit new UTXO label');
    await wallet.page
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect
      .poll(async () => (await accountState(control)).label)
      .toBe('Explicit new UTXO label');
    await expect(wallet.page).not.toHaveURL(/settings\/edit-account/);
    await selectNetwork(control, 'Syscoin NEVM Testnet', 'EVM');
    expect((await accountState(control)).label).toBe(original.label);
    await selectNetwork(control, 'Syscoin Testnet', 'UTXO');
    expect((await accountState(control)).label).toBe('Explicit new UTXO label');
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
