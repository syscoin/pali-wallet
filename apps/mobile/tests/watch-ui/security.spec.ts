import { test, expect, type Page } from '@playwright/test';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const SECOND = '0x1111111111111111111111111111111111111111';
const PUBLIC_TEST_KEY = `0x${'1'.repeat(64)}`;

async function unlock(page: Page) {
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
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
  await expect(page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true })).toHaveValue('');
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
}
async function reveal(page: Page, password = 'public-password') {
  await page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
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
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Select Account 2 (wallet)', exact: true }).click();
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
  await expect(page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Reveal private key', exact: true })).toBeDisabled();
  await reveal(page);
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.audit())).keyReads).toBe(2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  await openKey(page);
  await expect(page.getByRole('button', { name: 'Reveal private key', exact: true })).toBeDisabled();
});

test('Security uses the actual seed backup flow and offers no reset or clipboard action', async ({ page }) => {
  await openSecurity(page);
  await expect(page.getByText('Recovery phrase backed up', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recovery guide', exact: false }).click();
  await expect(page.getByText(/This screen cannot reset your password or replace an existing wallet/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Reset|Restore|Import|Copy|Share/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'View recovery phrase', exact: false }).click();
  await page.getByRole('textbox', { name: 'Confirm your password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click();
  await expect(page.getByText('abandon', { exact: true })).toHaveCount(11);
  await expect(page.getByRole('button', { name: /Copy|Share/ })).toHaveCount(0);
  await page.getByRole('button', { name: "I've written them down", exact: true }).click();
  for (const input of await page.getByRole('textbox', { name: /^Word [0-9]+$/ }).all()) {
    await input.fill(await input.getAttribute('aria-label') === 'Word 12' ? 'about' : 'abandon');
  }
  await page.getByRole('button', { name: 'Confirm backup', exact: true }).click();
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
    await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
    await page.evaluate(() => window.__watchFixture.lifecycle('active'));
    await unlock(page);
    await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
    await openKey(page);
    await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
    await reveal(page);
    await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(2);
    await expect(page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true })).toHaveValue('');
    await page.evaluate((state) => state === 'blur' ? window.__watchFixture.blur() : window.__watchFixture.lifecycle(state), event);
    await page.evaluate(() => { window.__watchFixture.lifecycle('active'); window.__watchFixture.releaseKeyRead(); });
    await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
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
  await expect(page.getByText('Recovery phrase backed up', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.releaseKeyRead());
  await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/could not be shown/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
});

for (const failure of ['password', 'throttle'] as const) {
  test(`${failure} failure shows fixed recovery feedback after the actual flow locks`, async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await openSecurity(page); await openKey(page);
    if (failure === 'throttle') await page.evaluate(() => window.__watchFixture.keyFailure('AUTH_THROTTLED'));
    await reveal(page, failure === 'password' ? 'wrong-password' : 'public-password');
    await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
    await expect(page.getByText(failure === 'password' ? 'That password is incorrect. Please try again.' :
      'Too many incorrect passwords. Wait a few minutes before trying again.', { exact: true })).toBeVisible();
    await expect(page.getByText(PUBLIC_TEST_KEY, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('');
    expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('locked');
    expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
    expect(failures).toEqual([]);
  });
}

for (const departure of ['back', 'background', 'new-unlock'] as const) {
  test(`late wrong-password feedback is suppressed after ${departure}`, async ({ page }) => {
    await openSecurity(page); await openKey(page);
    await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
    await reveal(page, 'wrong-password');
    await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyAttempts)).toBe(1);
    if (departure === 'back') {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByText('Recovery phrase backed up', { exact: true })).toBeVisible();
    } else {
      await page.evaluate(() => { window.__watchFixture.lifecycle('background'); window.__watchFixture.lifecycle('active'); });
      await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
      if (departure === 'new-unlock') await unlock(page);
    }
    await page.evaluate(() => window.__watchFixture.releaseKeyRead());
    if (departure === 'new-unlock') {
      await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toBeVisible();
      expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
    } else await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
    await expect(page.getByText('That password is incorrect. Please try again.', { exact: true })).toHaveCount(0);
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
