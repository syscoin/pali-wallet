import 'dotenv/config';

import { chromium, expect } from '@playwright/test';
import path from 'node:path';

export default async function globalSetup() {
  const pathToExtension = path.join(__dirname, '../build/chrome');

  const context = await chromium.launchPersistentContext('user-data', {
    headless: false,
    args: [
      `--headless=new`,
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');

  const extensionId = background.url().split('/')[2];
  const page = context.pages()[0];

  await page.goto(`chrome-extension://${extensionId}/app.html`);

  await expect(page.locator('#import-wallet-link')).toHaveText(
    'Import using wallet seed phrase'
  );

  await page.click('#import-wallet-link');

  const seedInput = page.locator('#import-wallet-input');

  seedInput.fill(process.env.TEST_WALLET_SEED_PHRASE);

  await expect(seedInput).toHaveValue(process.env.TEST_WALLET_SEED_PHRASE);

  const importButton = page.getByRole('button', { name: 'Import' });

  await importButton.click();

  await expect(page).toHaveURL(
    `chrome-extension://${extensionId}/app.html#/create-password-import`
  );

  const createButton = page.getByRole('button', { name: 'Next' });

  await expect(createButton).toBeDisabled();

  const password = process.env.TEST_WALLET_PASSWORD;

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

  await context.close();
}
