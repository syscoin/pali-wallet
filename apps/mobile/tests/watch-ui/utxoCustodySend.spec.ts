import { enterPin } from '../ui/operationAuthentication';
import { expect, test } from '@playwright/test';

test('the software Bitcoin HD account opens the owned native Send screen', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182')
      throw Error('Unexpected external request');
    await route.continue();
  });
  await page.goto('/?hd-utxo-send=1');
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await enterPin(page, '123456');
  await expect(page.getByText('Account 1 · Bitcoin', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.accountId)).toBe('hd:0:0');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Send BTC', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Recipient address', exact: true })).toBeEditable();
  await expect(page.getByRole('textbox', { name: 'Amount in BTC', exact: true })).toBeEditable();
});
