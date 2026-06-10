import { expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

// Visual verification journey for the UX polish sweep: receive screen
// (network/account-type label), CustomRPC dark theme, account-switch
// feedback, send form validation, and send -> confirm -> success toast.
test('ux polish: receive, custom rpc, account switch, send validation + toast', async () => {
  const wallet = await PaliWallet.launch('ux-polish');

  try {
    await wallet.step('onboard and switch network', async () => {
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork(E2E_CONFIG.networkLabel);
    });

    await wallet.step(
      'receive screen shows network + account type',
      async () => {
        await wallet.gotoRoute('#/receive');
        await expect(wallet.page.locator('#qr-code')).toBeVisible({
          timeout: 30_000,
        });
        // New context pill: network label + account type
        await expect(
          wallet.page.getByText(E2E_CONFIG.networkLabel).first()
        ).toBeVisible();
        await expect(
          wallet.page.getByText(/HD Account/i).first()
        ).toBeVisible();
        await expect(
          wallet.page.locator('#copy-address-receive-btn')
        ).toBeVisible();
      }
    );

    await wallet.step('custom rpc page uses dark theme', async () => {
      await wallet.gotoRoute('#/settings/networks/custom-rpc');
      await wallet.page.waitForTimeout(1500);
    });

    await wallet.step('account switch shows feedback and lands', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
      // Create a second HD account so a switch is possible
      await wallet.page.locator('#general-settings-button').click();
      await wallet.page
        .getByText(/create new account/i)
        .first()
        .click();
      await expect(wallet.page).toHaveURL(/settings\/account\/new/, {
        timeout: 30_000,
      });
      await wallet.page.locator('#create-btn').click();
      await wallet.page.waitForTimeout(4000);
      await wallet.dismissBlockingModals();
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();

      // Switch back to Account 1 through the menu and capture feedback
      await wallet.page.locator('#general-settings-button').click();
      await wallet.page
        .getByText(/^Account 1 \(/)
        .first()
        .click();
      await wallet.shot('account switch in flight');
      await wallet.page.waitForTimeout(2500);
      await wallet.ensureOnHome();
    });

    await wallet.step('send form shows visible validation', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
      await wallet.page.locator('#send-btn').click();
      await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });
      // Trigger validation with an invalid address
      const receiverInput = wallet.page.getByPlaceholder(/receiver/i).first();
      await receiverInput.fill('not-an-address');
      await wallet.page.waitForTimeout(1500);
      await expect(
        wallet.page.getByText(/invalid ethereum address/i).first()
      ).toBeVisible({ timeout: 10_000 });
    });

    await wallet.step('send -> confirm -> success toast', async () => {
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
      await wallet.page.locator('#send-btn').click();
      await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });

      const receiverInput = wallet.page.getByPlaceholder(/receiver/i).first();
      // Self-send a tiny amount
      await receiverInput.fill('0xfFC854565ff83a49d3302821c0AD23822ca1A50C');
      const amountInput = wallet.page.getByPlaceholder(/amount/i).first();
      await amountInput.fill('0.0001');
      await wallet.page.waitForTimeout(2000);
      await wallet.page.getByRole('button', { name: /next/i }).first().click();
      await expect(wallet.page).toHaveURL(/send\/confirm/, {
        timeout: 30_000,
      });
      await wallet.page.waitForTimeout(3000);
      await wallet.shot('confirm screen before submit');
      await wallet.page
        .getByRole('button', { name: /^confirm$/i })
        .first()
        .click();
      // Success toast then navigation back home
      await expect(
        wallet.page.getByText(/successfully submitted/i).first()
      ).toBeVisible({ timeout: 120_000 });
      await expect(wallet.page).toHaveURL(/#\/home/, { timeout: 60_000 });
    });

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  }
});
