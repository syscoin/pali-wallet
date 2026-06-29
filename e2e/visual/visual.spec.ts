import { type Locator, expect, test } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';

// Pixel-baseline walk of the core screens. One onboarding, then every test
// navigates and asserts a masked screenshot against the committed baseline.
//
// Masking policy: anything sourced from live chain/market data is masked --
// balances, fiat values, fee estimates, tx history rows. Addresses and QR
// codes are deterministic for the fixed test seed and stay unmasked so
// regressions in address rendering are caught.

const SELF_ADDRESS = '0xfFC854565ff83a49d3302821c0AD23822ca1A50C';

let wallet: PaliWallet;
let smartAccountCreated = false;

// Matches any "money-looking" number (balances, fiat, fees) anywhere on the
// page. The text engine resolves to the innermost matching elements.
const dynamicNumbers = () => wallet.page.getByText(/\d[\d,]*\.\d{2,}/);

const commonMasks = (): Locator[] => [
  dynamicNumbers(),
  wallet.page.locator('#activity-panel-list'),
  wallet.page.locator('#activity-panel-empty'),
];

const settle = async (ms = 1200) => {
  await wallet.page.waitForLoadState('networkidle').catch(() => undefined);
  await wallet.page.waitForTimeout(ms);
  // Hash routing keeps one document alive across screens, so a scroll
  // container can carry scroll offset from a previous test into the next
  // capture. Pin every baseline to scroll-top for determinism.
  await wallet.page
    .evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll('*')
        .forEach((el) => el.scrollTop > 0 && (el.scrollTop = 0));
    })
    .catch(() => undefined);
  await wallet.page.waitForTimeout(150);
};

test.describe('visual baselines', () => {
  test.beforeAll(async () => {
    wallet = await PaliWallet.launch('visual');
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork(E2E_CONFIG.networkLabel);

    // Create the smart account up front so every account list below renders
    // the same set of rows regardless of test order.
    await wallet.gotoRoute('#/settings/account/new');
    await settle(600);
    const createSmartAccount = wallet.page
      .getByRole('button', { name: /create smart account/i })
      .first();
    const smartAccountsUnavailable = await wallet.page
      .getByText(/smart accounts are not ready on this network yet/i)
      .isVisible()
      .catch(() => false);
    if (
      !smartAccountsUnavailable &&
      (await createSmartAccount.isVisible().catch(() => false))
    ) {
      await createSmartAccount.click();
      const unavailableMessage = wallet.page.getByText(
        /smart accounts are not ready on this network yet/i
      );
      const okButton = wallet.page
        .getByRole('button', { name: /^ok$/i })
        .first();
      const outcome = await Promise.race([
        unavailableMessage
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'unavailable' as const),
        okButton
          .waitFor({
            state: 'visible',
            timeout: E2E_CONFIG.slowActionTimeoutMs,
          })
          .then(() => 'dialog' as const),
        wallet.page
          .waitForURL(/#\/home/, { timeout: E2E_CONFIG.slowActionTimeoutMs })
          .then(() => 'home' as const),
      ]);
      if (outcome === 'dialog') {
        await okButton.click();
        await wallet.page.waitForURL(/#\/home/, { timeout: 30_000 });
      }
      if (outcome !== 'unavailable') {
        smartAccountCreated = true;
        // Smart-account creation lands with the new account active; switch
        // back to Account 1 so home/send baselines use the HD account.
        await wallet.ensureOnHome();
        await wallet.page.locator('#general-settings-button').click();
        await wallet.page
          .getByText(/^Account 1 \(/)
          .first()
          .click();
        await wallet.page.waitForTimeout(2500);
      }
    }
    await wallet.ensureOnHome();
  });

  test.afterAll(async () => {
    await wallet?.dispose();
  });

  test('home', async () => {
    await wallet.ensureOnHome();
    await settle();
    await expect(wallet.page).toHaveScreenshot(['home.png'], {
      mask: commonMasks(),
    });
  });

  test('settings menu', async () => {
    test.skip(!smartAccountCreated, 'smart account was not created');
    await wallet.ensureOnHome();
    await wallet.page.locator('#general-settings-button').click();
    await settle(600);
    await expect(wallet.page).toHaveScreenshot(['settings-menu.png'], {
      mask: commonMasks(),
    });
    await wallet.page.keyboard.press('Escape');
  });

  test('receive', async () => {
    await wallet.gotoRoute('#/receive');
    await expect(wallet.page.locator('#qr-code')).toBeVisible({
      timeout: 30_000,
    });
    // The header buttons stay disabled until the page fully settles; wait for
    // the copy button so the capture never races the loading state.
    await expect(wallet.page.locator('#copy-address-receive-btn')).toBeVisible({
      timeout: 30_000,
    });
    await settle(1200);
    await expect(wallet.page).toHaveScreenshot(['receive.png'], {
      mask: commonMasks(),
    });
  });

  test('send form', async () => {
    await wallet.ensureOnHome();
    await wallet.page.locator('#send-btn').click();
    await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });
    await settle();
    await expect(wallet.page).toHaveScreenshot(['send-eth.png'], {
      mask: commonMasks(),
    });
  });

  test('send confirm', async () => {
    await wallet.ensureOnHome();
    await wallet.page.locator('#send-btn').click();
    await expect(wallet.page).toHaveURL(/send\/eth/, { timeout: 30_000 });
    await wallet.page
      .getByPlaceholder(/receiver/i)
      .first()
      .fill(SELF_ADDRESS);
    await wallet.page
      .getByPlaceholder(/amount/i)
      .first()
      .fill('0.0001');
    await wallet.page.waitForTimeout(2000);
    await wallet.page.getByRole('button', { name: /next/i }).first().click();
    await expect(wallet.page).toHaveURL(/send\/confirm/, { timeout: 30_000 });
    // Fee estimation needs a beat to resolve before the layout is final.
    await settle(3000);
    await expect(wallet.page).toHaveScreenshot(['send-confirm.png'], {
      mask: [...commonMasks(), wallet.page.getByText(/gwei/i)],
    });
    // Leave without submitting.
    await wallet.gotoRoute('#/home');
  });

  test('activity list', async () => {
    await wallet.gotoRoute('#/home?tab=activity');
    await wallet.ensureOnHome();
    await expect(
      wallet.page
        .locator('#activity-panel-list')
        .or(wallet.page.locator('#activity-panel-empty'))
        .first()
    ).toBeVisible({ timeout: 60_000 });
    await settle();
    await expect(wallet.page).toHaveScreenshot(['activity.png'], {
      mask: commonMasks(),
    });
  });

  test('tx details', async () => {
    await wallet.gotoRoute('#/home?tab=activity');
    await wallet.ensureOnHome();
    // Rows are not clickable as a whole; the drill-down affordance is the
    // detail arrow (cursor-pointer svg) rendered on confirmed rows.
    const detailArrow = wallet.page
      .locator('#activity-panel-list svg.cursor-pointer')
      .first();
    const hasRow = await detailArrow
      .isVisible({ timeout: 30_000 })
      .catch(() => false);
    test.skip(!hasRow, 'no confirmed transaction history on this account');
    await detailArrow.click();
    await expect(wallet.page).toHaveURL(/home\/details/, { timeout: 30_000 });
    await expect(wallet.page.locator('#details-view-content')).toBeVisible({
      timeout: 30_000,
    });
    await settle();
    // The whole detail list is chain data; baseline covers page chrome,
    // header and layout shell.
    await expect(wallet.page).toHaveScreenshot(['tx-details.png'], {
      mask: [...commonMasks(), wallet.page.locator('#details-view-content')],
    });
  });

  test('manage accounts', async () => {
    test.skip(!smartAccountCreated, 'smart account was not created');
    await wallet.gotoRoute('#/settings/manage-accounts');
    await expect(wallet.page.getByText(/^Account 1 \(/).first()).toBeVisible({
      timeout: 30_000,
    });
    await settle(600);
    await expect(wallet.page).toHaveScreenshot(['manage-accounts.png'], {
      mask: commonMasks(),
    });
  });

  test('edit account', async () => {
    await wallet.gotoRoute('#/settings/manage-accounts');
    const account1Row = wallet.page
      .locator('li', { hasText: /Account 1 \(/ })
      .first();
    await expect(account1Row).toBeVisible({ timeout: 30_000 });
    await account1Row.locator('button').first().click();
    await expect(wallet.page).toHaveURL(/settings\/edit-account/, {
      timeout: 30_000,
    });
    await settle(600);
    await expect(wallet.page).toHaveScreenshot(['edit-account.png'], {
      mask: commonMasks(),
    });
  });

  test('smart account policy', async () => {
    await wallet.gotoRoute('#/settings/manage-accounts');
    const smartAccountRow = wallet.page
      .locator('li', { hasText: /Smart Account/ })
      .first();
    const hasSmartAccount = await smartAccountRow
      .isVisible()
      .catch(() => false);
    test.skip(!hasSmartAccount, 'smart account was not created');
    await smartAccountRow.locator('button').first().click();
    await expect(wallet.page).toHaveURL(/settings\/edit-account/, {
      timeout: 30_000,
    });
    await wallet.page
      .getByRole('button', { name: /smart account settings/i })
      .first()
      .click();
    await expect(wallet.page).toHaveURL(/smart-account-policy/, {
      timeout: 30_000,
    });
    // Wait out the hydration spinners so the baseline captures settled state.
    await wallet.page
      .getByText(/checking/i)
      .first()
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);
    await settle(1500);
    await expect(wallet.page).toHaveScreenshot(['smart-account-policy.png'], {
      mask: commonMasks(),
      // Policy page scrolls; capture everything for layout coverage.
      fullPage: true,
    });
  });

  test('advanced settings', async () => {
    await wallet.gotoRoute('#/settings/advanced');
    await expect(
      wallet.page.getByText(/smart account setup/i).first()
    ).toBeVisible({ timeout: 60_000 });
    await settle(1500);
    await expect(wallet.page).toHaveScreenshot(['advanced.png'], {
      mask: commonMasks(),
      fullPage: true,
    });
  });

  test('custom rpc', async () => {
    await wallet.gotoRoute('#/settings/networks/custom-rpc');
    await settle();
    await expect(wallet.page).toHaveScreenshot(['custom-rpc.png'], {
      mask: commonMasks(),
    });
  });
});
