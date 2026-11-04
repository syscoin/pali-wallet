import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
const recipient = '0x1111111111111111111111111111111111111111';
const passwordInput = (page: Page) => page.getByLabel('Confirm your wallet password', { exact: true });

async function prepare(page: Page) {
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in ETH', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(passwordInput(page)).toBeVisible();
}

test('expired review requires a fresh password for the next review', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await prepare(page);
  const firstId = await page.evaluate(() => window.__nativeSendFixture.reviewId());
  await passwordInput(page).fill('Password for the expired review');
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();

  await page.clock.runFor(90001);
  await expect(passwordInput(page)).toHaveCount(0);
  await prepare(page);
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).not.toBe(firstId);
  await expect(passwordInput(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);

  await passwordInput(page).fill('Fresh password for the new review');
  await page.getByTestId('native-send-confirm').click();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([
    { id: 'fixture-review-2', password: 'Fresh password for the new review' },
  ]);
});

test('replacement review clears the password while same-review updates preserve it', async ({ page }) => {
  await page.goto('/');
  await prepare(page);
  const firstId = await page.evaluate(() => window.__nativeSendFixture.reviewId());
  await passwordInput(page).fill('Password belongs to the first review');
  await page.evaluate(() => window.__nativeSendFixture.refreshReview());
  await expect(passwordInput(page)).toHaveValue('Password belongs to the first review');
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();

  await page.evaluate(() => window.__nativeSendFixture.replaceReview());
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).not.toBe(firstId);
  await expect(passwordInput(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
});
