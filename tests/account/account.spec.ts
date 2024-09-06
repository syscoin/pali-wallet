import { test, expect } from '../fixtures';

test.describe('Account', () => {
  // test.beforeEach(async ({ page, extensionId }) => {
  //   await page.goto(`chrome-extension://${extensionId}/app.html#/create-password`);
  // });

  test('should successfully import wallet using seed phrase', async ({
    page,
    extensionId,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/app.html`);

    await expect(page.locator('#import-wallet-link')).toHaveText(
      'Import using wallet seed phrase'
    );

    await page.click('#import-wallet-link');

    const seedInput = page.locator('#import-wallet-input');

    seedInput.fill(process.env.TEST_SEED_PHRASE);

    await expect(seedInput).toHaveValue(process.env.TEST_SEED_PHRASE);

    const importButton = page.getByRole('button', { name: 'Import' });

    await importButton.click();

    await expect(page).toHaveURL(
      `chrome-extension://${extensionId}/app.html#/create-password-import`
    );

    const createButton = page.getByRole('button', { name: 'Next' });

    await expect(createButton).toBeDisabled();

    const password = 'Test123@';

    const passwordFields = page.locator('#create-password');

    passwordFields.first().fill(password);

    await expect(passwordFields.first()).toHaveValue(password);

    passwordFields.last().fill(password);

    await expect(passwordFields.last()).toHaveValue(password);

    await expect(createButton).toBeEnabled();

    await createButton.click();

    await expect(page).toHaveURL(
      `chrome-extension://${extensionId}/app.html#/home`
    );
  });

  test('should create a new account', async ({ page, extensionId }) => {
    // load account before creating a new one
    await page.goto(`chrome-extension://${extensionId}/app.html#/home`);

    const generalMenu = page.locator('#general-settings-button');

    await generalMenu.click();

    await expect(page.locator('body')).toHaveText('ACCOUNTS SETTINGS');

    const newAccountButton = page.locator('li', {
      hasText: 'Create new account',
    });

    await newAccountButton.click();
  });
});
