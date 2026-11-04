import { test, expect, type Page } from '@playwright/test';

const KEY = `0x${'1'.padStart(64, '0')}`;
const ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const HD_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const NAME = 'Imported savings';
async function unlock(page: Page) {
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
}
async function openWallet(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await unlock(page);
}
async function manage(page: Page) {
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Manage wallet accounts', exact: true }).click();
}
async function openImport(page: Page) {
  await manage(page);
  await page.getByRole('button', { name: 'Import private key', exact: true }).click();
}
async function preview(page: Page, key = KEY, name = NAME) {
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'EVM private key', exact: true }).fill(key);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
}
async function submit(page: Page, password = 'public-password') {
  await page.getByRole('checkbox', { name: 'I have a separate backup of this private key', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'I have a separate backup of this private key', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('textbox', { name: 'Confirm wallet password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Import account', exact: true }).click();
}
async function imported(page: Page) {
  await expect(page.getByText(`${NAME} · Ethereum`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.accountId)).toBe('imported:60:0');
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') throw Error('Unexpected external request');
    await route.continue();
  });
});

test('private-key import reviews full address, then selects the account with receive, send and reveal', async ({ page }, info) => {
  await openWallet(page); await openImport(page);
  await expect(page.getByRole('textbox', { name: 'EVM private key', exact: true })).toHaveAttribute('type', 'password');
  await preview(page);
  await expect(page.getByText(ADDRESS, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import account', exact: true })).toBeDisabled();
  await expect(page.getByText(/Your recovery phrase cannot restore an imported account/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'EVM private key', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Copy|Share/ })).toHaveCount(0);
  const screenshot = info.outputPath('import-address-review.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach('Imported account review with public fixture', { path: screenshot, contentType: 'image/png' });
  await submit(page); await imported(page);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByTestId('native-receive-address')).toHaveText(ADDRESS);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(`${NAME} · Ethereum`, { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill(HD_ADDRESS);
  await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm and send', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
  await expect(page.getByText('Imported key needs a separate backup', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await expect(page.getByText(KEY, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  const keyScreenshot = info.outputPath('imported-key-public-fixture.png');
  await page.screenshot({ path: keyScreenshot, fullPage: true });
  await info.attach('Imported account key reveal with a public fixture', { path: keyScreenshot, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Hide private key', exact: true }).click();
  await expect(page.getByText(KEY, { exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.__watchFixture.audit())).broadcasts).toBe(0);
});

test('malformed keys and oversized valid prefixes never reach import', async ({ page }) => {
  await openWallet(page); await openImport(page);
  for (const key of ['0x' + '0'.repeat(64), '5HueCGU8rMjxEXxiPuD5BDu', KEY + '12']) {
    await preview(page, key);
    await expect(page.getByText(/Enter a valid 32-byte EVM private key/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import account', exact: true })).toHaveCount(0);
  }
  expect((await page.evaluate(() => window.__watchFixture.audit())).importAttempts).toBe(0);
});

test('duplicate imported key keeps the existing account and shows a useful safe error', async ({ page }) => {
  await openWallet(page); await openImport(page); await preview(page); await submit(page); await imported(page);
  await openImport(page); await preview(page, KEY, 'Duplicate'); await submit(page);
  await expect(page.getByText('This address is already a wallet account. Select that account instead.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'EVM private key', exact: true })).toHaveValue('');
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.imports).toBe(1); expect(audit.importAttempts).toBe(1);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
});

for (const failure of ['password', 'throttle'] as const) {
  test(`import ${failure} rejection clears input and preserves typed lock feedback`, async ({ page }) => {
    await openWallet(page); await openImport(page); await preview(page);
    if (failure === 'throttle') await page.evaluate(() => window.__watchFixture.importFailure('AUTH_THROTTLED'));
    await submit(page, failure === 'password' ? 'wrong-password' : 'public-password');
    await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
    await expect(page.getByText(failure === 'password' ? 'That password is incorrect. Unlock your wallet to try again.' :
      'Too many incorrect passwords. Wait a few minutes before trying again.', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('');
    expect((await page.evaluate(() => window.__watchFixture.audit())).imports).toBe(0);
    expect(await page.content()).not.toContain(KEY);
  });
}

for (const departure of ['back', 'background', 'inactive', 'blur', 'new-unlock'] as const) {
  test(`pending import clears secrets and cannot publish after ${departure}`, async ({ page }) => {
    await openWallet(page, departure === 'blur' ? '?android=1' : ''); await openImport(page); await preview(page);
    await page.evaluate(() => window.__watchFixture.delayImport(true));
    await submit(page, departure === 'new-unlock' ? 'wrong-password' : 'public-password');
    await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().importAttempts)).toBe(1);
    await expect(page.getByRole('textbox', { name: 'Confirm wallet password', exact: true })).toHaveValue('');
    expect(await page.content()).not.toContain(KEY);
    if (departure === 'back') await page.getByRole('button', { name: 'Back', exact: true }).click();
    else await page.evaluate((event) => { if (event === 'blur') window.__watchFixture.blur(); else window.__watchFixture.lifecycle(event === 'new-unlock' ? 'background' : event); }, departure);
    await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
    await page.evaluate(() => { window.__watchFixture.lifecycle('active'); window.__watchFixture.releaseImport(); });
    if (departure === 'new-unlock') { await unlock(page); await expect(page.getByText('Account 1 · Ethereum', { exact: true })).toBeVisible(); }
    expect((await page.evaluate(() => window.__watchFixture.audit())).imports).toBe(0);
    expect(await page.evaluate(() => window.__watchFixture.catalogue().accounts.some((account) => account.type === 'Imported'))).toBe(false);
    await expect(page.getByText('That password is incorrect. Unlock your wallet to try again.', { exact: true })).toHaveCount(0);
  });
}

test('imported removal requires its own backup warning and reimport creates a new identity', async ({ page }) => {
  await openWallet(page); await openImport(page); await preview(page); await submit(page); await imported(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Select Account 1 (wallet)', exact: true }).click();
  await manage(page);
  const card = page.locator('div').filter({ has: page.getByRole('button', { name: `Select ${NAME}`, exact: true }) }).filter({ has: page.getByRole('button', { name: 'Remove', exact: true }) }).last();
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText(/Your recovery phrase cannot restore it/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Confirm wallet password', exact: true }).fill('public-password');
  await expect(page.getByRole('button', { name: 'Remove from this device', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I have the original private key backed up', exact: true }).check();
  await page.getByRole('button', { name: 'Remove from this device', exact: true }).click();
  await expect(page.getByRole('button', { name: `Select ${NAME}`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Import private key', exact: true }).click();
  await preview(page); await submit(page);
  await expect(page.getByText(`${NAME} · Ethereum`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.accountId)).toBe('imported:60:1');
});

test('a shared-address watch remains public and separate from its imported key account', async ({ page }) => {
  await openWallet(page); await openImport(page); await preview(page); await submit(page); await imported(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Imported address watch');
  await page.getByRole('textbox', { name: 'Public EVM address', exact: true }).fill(ADDRESS);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByText('Imported address watch · Watch-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Receive', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Security|private key|recovery phrase/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Imported address watch (watch-only)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Select ${NAME} (wallet)`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click(); await unlock(page);
  await expect(page.getByText(`${NAME} · Ethereum`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.accounts().some((account) => account.name === 'Imported address watch'))).toBe(true);
});

test('leaving a review and opening a new import clears every entered secret and acknowledgement', async ({ page }) => {
  await openWallet(page); await openImport(page); await preview(page);
  await page.getByRole('checkbox', { name: 'I have a separate backup of this private key', exact: true }).check();
  await page.getByRole('textbox', { name: 'Confirm wallet password', exact: true }).fill('not-submitted-password');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Import private key', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'EVM private key', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Account name', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Review account', exact: true })).toBeDisabled();
  expect(await page.content()).not.toContain('not-submitted-password');
  expect((await page.evaluate(() => window.__watchFixture.audit())).importAttempts).toBe(0);
});

test('the combined 20-account limit disables both native creation entries', async ({ page }) => {
  await openWallet(page, '?account-limit=1'); await manage(page);
  await expect(page.getByRole('button', { name: 'Import private key', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeDisabled();
  await expect(page.getByText('Account limit reached', { exact: true })).toBeVisible();
});
