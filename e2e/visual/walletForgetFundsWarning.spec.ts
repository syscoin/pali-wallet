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

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

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
  let passwordValidatedOnForgetPage = false;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('wallet-forget-funds-warning', {
      offlineHttpProxy: server.url,
      recordVideo: false,
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
    // Validate with the explicit Confirm button, never the destructive action.
    // Do not take screenshots or serialize fields after the seed is revealed.
    await page.setViewportSize({ width: 320, height: 360 });
    const password = page.locator('#forget_password');
    await password.fill(E2E_CONFIG.password);
    const confirm = page.getByRole('button', {
      name: en.buttons.confirm,
      exact: true,
    });
    await password.focus();
    for (
      let count = 0;
      count < 20 &&
      !(await confirm.evaluate(
        (element) => element === document.activeElement
      ));
      count++
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    passwordValidatedOnForgetPage = true;
    const action = page.getByRole('button', {
      name: en.buttons.forget,
      exact: true,
    });
    await expect(action).toBeEnabled();
    const geometry = () =>
      page.evaluate(
        ({ warningText, actionText }) => {
          const warning = [...document.querySelectorAll('p')].find(
            (element) => element.textContent?.trim() === warningText
          );
          const card = warning?.closest('div.border-dashed');
          const button = [...document.querySelectorAll('button')].find(
            (element) => element.textContent?.trim() === actionText
          );
          if (!card || !button)
            throw new Error('Missing funded warning or action');
          const rect = (element: Element) => {
            const box = element.getBoundingClientRect();
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
            };
          };
          const visibleAndHit = (element: Element) => {
            const box = element.getBoundingClientRect();
            if (
              box.left < 0 ||
              box.top < 0 ||
              box.right > innerWidth ||
              box.bottom > innerHeight
            )
              return false;
            const hit = document.elementFromPoint(
              (box.left + box.right) / 2,
              (box.top + box.bottom) / 2
            );
            return !!hit && (hit === element || element.contains(hit));
          };
          return {
            card: rect(card),
            button: rect(button),
            height: innerHeight,
            warningVisible: visibleAndHit(card),
            actionVisible: visibleAndHit(button),
          };
        },
        {
          warningText: en.forgetWalletPage.stillHaveFunds,
          actionText: en.buttons.forget,
        }
      );
    const afterConfirm = await geometry();
    // A destructive action must not be available while its warning is wholly below the view.
    expect(
      afterConfirm.actionVisible && afterConfirm.card.top >= afterConfirm.height
    ).toBe(false);
    const port = page.locator('[data-navigation-scroll="wallet-layout"]');
    await expect(port).toHaveCount(1);
    await page.mouse.move(160, 180);
    for (let count = 0; count < 12; count++) {
      const scroll = await port.evaluate((element) => ({
        top: element.scrollTop,
        max: element.scrollHeight - element.clientHeight,
      }));
      if (scroll.top >= scroll.max - 1) break;
      await page.mouse.wheel(0, 300);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
    }
    const bottom = await geometry();
    expect(bottom.warningVisible).toBe(true);
    expect(bottom.actionVisible).toBe(true);
    await expect(action).toBeEnabled();
    await page.setViewportSize({ width: 400, height: 620 });
    await page.mouse.move(200, 310);
    for (let count = 0; count < 12; count++) {
      if (await port.evaluate((element) => element.scrollTop <= 1)) break;
      await page.mouse.wheel(0, -300);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
    }
    const wide = await geometry();
    expect(wide.warningVisible).toBe(true);
    expect(wide.actionVisible).toBe(true);
    await expect(action).toBeEnabled();
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
          passwordValidatedOnForgetPage,
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
