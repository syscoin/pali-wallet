import { expect, test, type Page } from '@playwright/test';
const PHRASE = [...Array(11).fill('abandon'), 'about'].join(' ');
const PASSWORD = 'Public replacement password 1!';
async function open(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
}
async function verify(page: Page) {
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Matching recovery phrase', exact: true }).fill(PHRASE);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4182') return route.continue();
    await route.abort(); throw new Error('Unexpected external request');
  });
});
test('actual NativeWallet preserves recovery across expected owner disposal and installs locked replacement', async ({ page }) => {
  await open(page); await verify(page);
  await expect(page.getByRole('heading', { name: 'Wallet verified', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('disposed');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByText('Password changed. Unlock with your new password.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('locked');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
});
test('background while committing clears recovery and retains honest possible-completion outcome', async ({ page }) => {
  await open(page); await verify(page);
  await page.evaluate(() => window.__watchFixture.holdRecovery('commit'));
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.lifecycle('background'));
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.releaseRecovery('commit'));
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await expect(page.getByText(/It may have completed/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__watchFixture.recoveryAudit().committed)).toBe(1);
});
test('leaving and reentering waits for a prepared coordinator to drain', async ({ page }) => {
  await open(page); await verify(page); await page.evaluate(() => window.__watchFixture.holdRecovery('dispose'));
  await page.getByRole('button', { name: 'Cancel recovery', exact: true }).click();
  await expect(page.getByText('Reopening your wallet securely…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.oldPhases().length)).toBe(1);
  await page.evaluate(() => window.__watchFixture.releaseRecovery('dispose'));
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.oldPhases().length)).toBe(2);
});
