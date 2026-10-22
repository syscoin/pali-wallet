import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
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

async function publicBalances(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return {
      active: state.vault.activeAccount,
      accounts: Object.values(state.vault.accounts.HDAccount).map(
        (account: any) => ({
          id: account.id,
          address: account.address,
          xpub: account.xpub,
          rawBalance: account.balances.syscoin,
          balance: Number(account.balances.syscoin),
        })
      ),
    };
  });
}

test('Forget Wallet retains its funds warning after ordinary creation selects an empty account', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ForgetFundsWarningSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('wallet-forget-funds-warning', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    await wallet.step(
      'a funded selected account shows the existing warning',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect
          .poll(async () => (await publicBalances(page)).accounts[0].balance)
          .toBeGreaterThan(0);
        observations.before = await publicBalances(page);
        await wallet!.gotoRoute('#/settings/forget-wallet');
        await expect(
          page.getByText(en.forgetWalletPage.stillHaveFunds, { exact: true })
        ).toBeVisible();
        await expect(page.locator('#forget_password')).toHaveValue('');
        await expect(
          page.getByRole('button', { name: en.buttons.forget, exact: true })
        ).toBeDisabled();
      }
    );
    await wallet.step(
      'ordinary account creation selects the real empty second account',
      async () => {
        await wallet!.gotoRoute('#/settings/account/new');
        await page.locator('#account-name-input').fill('Empty second account');
        await page.locator('#create-btn').click();
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await expect
          .poll(async () => (await publicBalances(page)).active.id)
          .toBe(1);
        await expect
          .poll(async () => (await publicBalances(page)).accounts[1].balance)
          .toBe(0);
        const after = await publicBalances(page);
        expect(after.accounts).toHaveLength(2);
        expect(after.accounts[0].balance).toBeGreaterThan(0);
        expect(after.accounts[1]).toMatchObject({
          id: 1,
          address: fixture.secondUtxo.address,
          xpub: fixture.secondUtxo.xpub,
          balance: 0,
        });
        observations.after = after;
      }
    );
    await wallet.step(
      'wallet-wide warning stays visible without validating a password or removing anything',
      async () => {
        await wallet!.gotoRoute('#/settings/forget-wallet');
        await expect(page.locator('#forget_password')).toHaveValue('');
        await expect(
          page.getByText(en.forgetWalletPage.importedAccountsWont, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page.getByText(en.forgetWalletPage.stillHaveFunds, { exact: true })
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath('forget-after-empty-account.png'),
          animations: 'disabled',
        });
        await expect(
          page.getByRole('button', { name: en.buttons.forget, exact: true })
        ).toBeDisabled();
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    fs.writeFileSync(
      info.outputPath('runtime-evidence.json'),
      JSON.stringify(
        {
          ...extensionEvidence(),
          observations,
          simulated: true,
          publicSyntheticOnly: true,
          controllerStateReplaced: false,
          passwordValidatedOnForgetPage: false,
          forgetSubmitted: false,
        },
        null,
        2
      )
    );
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
