import test, { expect, Page } from '@playwright/test';

import setup from '../setup';

test.describe.configure({ mode: 'serial' });

test.describe('Account', async () => {
  let extensionId: string;
  let page: Page;

  test.beforeAll(async () => {
    ({ extensionId, page } = await setup());
  });

  test('should create a new account', async () => {
    await page.goto(`chrome-extension://${extensionId}/app.html`);

    const passwordInput = page.locator('#password');

    await expect(passwordInput).toBeEmpty();

    passwordInput.fill(process.env.TEST_WALLET_PASSWORD);

    const unlockButton = page.locator('#unlock-btn');

    unlockButton.click();

    await expect(page).toHaveURL(
      `chrome-extension://${extensionId}/app.html#/home`
    );

    const generalMenu = page.locator('#general-settings-button');

    await generalMenu.click();

    const newAccountButton = page.locator('li', {
      hasText: 'Create new account',
    });

    await newAccountButton.click();

    const accountNameInput = page.locator('#account-name-input');
    const createButton = page.locator('#create-btn');

    accountNameInput.fill('Account 2');

    await createButton.click();

    await expect(page.locator('h1')).toHaveText(
      'Your new account has been created'
    );
  });
});
