import { authenticateNativeOperation, waitForNativePublicSession } from '../ui/operationAuthentication';
import { expect, test, type Page } from '@playwright/test';
const PHRASE = [...Array(11).fill('abandon'), 'about'].join(' ');
async function open(page: Page) {
  await page.goto('/?credential-missing'); await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForNativePublicSession(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Security & backups/ }).click();
  await page.getByRole('button', { name: /^Restore secure access/ }).click();
  await expect(page.getByRole('button', { name: 'Restore Wallet', exact: true })).toBeVisible();
}
async function verify(page: Page) {
  await page.getByRole('button', { name: 'Restore Wallet', exact: true }).click();
  for (const [index, word] of PHRASE.split(' ').entries()) {
    await page.getByRole('textbox', { name: `Recovery word ${index + 1}`, exact: true }).fill(word);
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wallet verified', exact: true })).toBeVisible();
}
async function restoreDeviceAccess(page: Page) {
  await page.getByRole('button', { name: 'Restore secure access', exact: true }).click();
  await authenticateNativeOperation(page);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4182') return route.continue();
    await route.abort(); throw new Error('Unexpected external request');
  });
});
test('actual NativeWallet preserves recovery across expected owner disposal and reopens public replacement', async ({ page }) => {
  await open(page); await verify(page);
  await expect(page.getByRole('heading', { name: 'Wallet verified', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('disposed');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await restoreDeviceAccess(page);
  await waitForNativePublicSession(page);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
});
test('background while committing clears recovery and retains honest possible-completion outcome', async ({ page }) => {
  await open(page); await verify(page);
  await page.evaluate(() => window.__watchFixture.holdRecovery('commit'));
  await restoreDeviceAccess(page);
  await page.evaluate(() => window.__watchFixture.lifecycle('background'));
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.releaseRecovery('commit'));
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await waitForNativePublicSession(page);
  expect(await page.evaluate(() => window.__watchFixture.recoveryAudit().committed)).toBe(1);
});
test('leaving and reentering waits for a prepared coordinator to drain', async ({ page }) => {
  await open(page); await verify(page); await page.evaluate(() => window.__watchFixture.holdRecovery('dispose'));
  await page.getByRole('button', { name: 'Cancel recovery', exact: true }).click();
  await expect(page.getByText('Reopening your wallet securely…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PIN digit 1', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.oldPhases().length)).toBe(1);
  await page.evaluate(() => window.__watchFixture.releaseRecovery('dispose'));
  await waitForNativePublicSession(page);
  expect(await page.evaluate(() => window.__watchFixture.oldPhases().length)).toBe(2);
});
