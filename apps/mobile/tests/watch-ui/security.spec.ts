import { enterPin, revealBackupPhrase, confirmFixtureBackup } from '../ui/operationAuthentication';
import { test, expect, type Page } from '@playwright/test';
import { nativeAccountName } from '../accountControlNames';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const SECOND = '0x1111111111111111111111111111111111111111';
const PUBLIC_TEST_KEY = `0x${'1'.repeat(64)}`;

async function unlock(page: Page) {
  await enterPin(page, '123456');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toBeVisible();
}
async function openSecurity(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await unlock(page);
  await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
}
async function openKey(page: Page) {
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Unlock private information', exact: true })).toHaveCount(0);
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
}
async function reveal(page: Page, pin = '123456') {
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await enterPin(page, pin);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') throw Error('Unexpected external request');
    await route.continue();
  });
});

test('selected-account reveal stays hidden until fresh auth and clears on Hide and Back', async ({ page }, testInfo) => {
  await openSecurity(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('tab', { name: 'Wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: nativeAccountName('Account 2', 'Recovery phrase account', SECOND) }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
  await openKey(page);
  await expect(page.getByText('Account 2', { exact: true })).toBeVisible();
  await expect(page.getByText(SECOND, { exact: true })).toBeVisible();
  await expect(page.getByText(ADDRESS, { exact: true })).toHaveCount(0);
  await reveal(page);
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  const screenshot = testInfo.outputPath('native-security-public-fixture-key.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Security reveal with a public synthetic key', { path: screenshot, contentType: 'image/png' });
  await expect(page.locator(`[aria-label*="${PUBLIC_TEST_KEY}"], [data-testid*="${PUBLIC_TEST_KEY}"], input`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Copy|Share/ })).toHaveCount(0);
  expect((await page.evaluate(() => window.__watchFixture.audit())).keyReads).toBe(1);
  await page.getByRole('button', { name: 'Hide private key', exact: true }).click();
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Unlock private information', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reveal private key', exact: true })).toBeEnabled();
  await reveal(page);
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.audit())).keyReads).toBe(2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  await openKey(page);
  await expect(page.getByRole('button', { name: 'Reveal private key', exact: true })).toBeEnabled();
});

test('Security uses the actual seed backup flow and offers no reset or clipboard action', async ({ page }) => {
  await openSecurity(page);
  await expect(page.getByText('Backed up', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recovery guide', exact: false }).click();
  await expect(page.getByText(/lock your wallet and choose Forgot PIN/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Reset|Restore|Import|Copy|Share/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'View recovery phrase', exact: false }).click();
  await revealBackupPhrase(page);
  await expect(page.getByText('abandon', { exact: true })).toHaveCount(11);
  await expect(page.getByRole('button', { name: /Copy|Share/ })).toHaveCount(0);
  await confirmFixtureBackup(page);
  await expect(page.getByText('Backup complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.events().filter((event) => event === 'backup:confirmed').length)).toBe(1);
  expect((await page.evaluate(() => window.__watchFixture.audit())).keyReads).toBe(0);
});

for (const event of ['background', 'inactive', 'blur'] as const) {
  test(`${event} immediately hides the key and cancels a pending reveal`, async ({ page }) => {
    await openSecurity(page, event === 'blur' ? '?android=1' : '');
    await openKey(page); await reveal(page);
    await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toBeVisible();
    await page.evaluate((state) => state === 'blur' ? window.__watchFixture.blur() : window.__watchFixture.lifecycle(state), event);
    await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await page.evaluate(() => window.__watchFixture.lifecycle('active'));
    await unlock(page);
    await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
    await openKey(page);
    await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
    await reveal(page);
    await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(2);
    await expect(page.getByRole('heading', { name: 'Unlock private information', exact: true })).toHaveCount(0);
    await page.evaluate((state) => state === 'blur' ? window.__watchFixture.blur() : window.__watchFixture.lifecycle(state), event);
    await page.evaluate(() => { window.__watchFixture.lifecycle('active'); window.__watchFixture.releaseKeyRead(); });
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(/could not be shown/)).toHaveCount(0);
    expect(await page.evaluate(() => window.__watchFixture.events().filter((entry) => entry === 'key:finish').length)).toBe(1);
  });
}

test('Back during pending key read suppresses late key and feedback', async ({ page }) => {
  await openSecurity(page); await openKey(page);
  await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
  await reveal(page);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Backed up', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.releaseKeyRead());
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/could not be shown/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
});

test('wrong PIN retries in the same prompt without releasing a key or locking', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openSecurity(page); await openKey(page); await reveal(page, '000000');
  await expect(page.getByText('PIN not accepted. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('PIN, 0 of 6 digits entered', { exact: true })).toBeVisible();
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
  expect((await page.evaluate(() => window.__watchFixture.audit())).keyReads).toBe(0);
  await enterPin(page, '123456');
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.audit())).keyAttempts).toBe(1);
  expect(failures).toEqual([]);
});

test('branded key-read refusal preserves the public owner without exposing a key', async ({ page }) => {
  await openSecurity(page); await openKey(page);
  await page.evaluate(() => window.__watchFixture.keyFailure('AUTH_THROTTLED'));
  await reveal(page);
  await expect(page.getByText('The private key could not be shown. Confirm your PIN and try again.', { exact: true })).toBeVisible();
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
  expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
  await page.evaluate(() => window.__watchFixture.keyFailure(null));
  await reveal(page);
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toBeVisible();
});

for (const departure of ['back', 'background', 'new-unlock'] as const) {
  test(`late key-read refusal is suppressed after ${departure}`, async ({ page }) => {
    await openSecurity(page); await openKey(page);
    await page.evaluate(() => { window.__watchFixture.delayKeyRead(true); window.__watchFixture.keyFailure('AUTH_THROTTLED'); });
    await reveal(page);
    await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(1);
    if (departure === 'back') {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByText('Backed up', { exact: true })).toBeVisible();
    } else {
      await page.evaluate(() => { window.__watchFixture.lifecycle('background'); window.__watchFixture.lifecycle('active'); });
      await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
      if (departure === 'new-unlock') await unlock(page);
    }
    await page.evaluate(() => window.__watchFixture.releaseKeyRead());
    if (departure === 'new-unlock') {
      await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toBeVisible();
      expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
    } else if (departure === 'back') await expect(page.getByText('Backed up', { exact: true })).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await expect(page.getByText(/could not be shown/)).toHaveCount(0);
    await expect(page.getByText('Too many incorrect PINs. Wait a few minutes before trying again.', { exact: true })).toHaveCount(0);
    await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
  });
}

test('A-B-A account changes cannot republish a pending key', async ({ page }) => {
  await openSecurity(page); await openKey(page);
  await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
  await reveal(page);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(1);
  await page.evaluate(async () => {
    await window.__watchFixture.selectAccount('hd:60:1');
    await window.__watchFixture.selectAccount('hd:60:0');
    window.__watchFixture.releaseKeyRead();
  });
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/could not be shown/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
});
