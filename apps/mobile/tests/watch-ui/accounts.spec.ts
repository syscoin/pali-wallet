import { unlockPublicView, authenticateNativeOperation, deviceAuthorizationPrompt, revealBackupPhrase, confirmFixtureBackup } from '../ui/operationAuthentication';
import { test, expect, type Page } from '@playwright/test';
import { nativeAccountName, watchAccountName } from '../accountControlNames';
const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const SECOND = '0x1111111111111111111111111111111111111111';
const fixture = (page: Page) => page.evaluate(() => window.__watchFixture.audit());
async function openNative(page: Page) {
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForPublicWallet(page);
}
async function waitForPublicWallet(page: Page) {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
}
async function unlockPublicWallet(page: Page) {
  await unlockPublicView(page);
  await waitForPublicWallet(page);
}
async function lockWallet(page: Page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Security & backups/ }).click();
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
}
async function selectWatchFromNative(page: Page) {
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: watchAccountName('Select', 'Shared address watch', 'Public EVM address', ADDRESS) }).click();
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
}
async function expectWatchOnly(page: Page) {
  await expect(page.getByRole('button', { name: 'Receive', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View recovery phrase', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /private key|biometric|Preview send|Explore the design/ })).toHaveCount(0);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  // Any unexpected real network dependency makes the test fail, including RPC.
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') throw Error(`Unexpected external request: ${route.request().url()}`);
    await route.continue();
  });
});

test('Receive keeps the full address and its copy icon inside a narrow screen', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await openNative(page);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  const address = page.getByTestId('native-receive-address');
  const copy = page.getByTestId('native-receive-address-copy');
  await expect(address).toHaveText(ADDRESS);
  expect(await address.evaluate(element => {
    const row = element.parentElement!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return Array.from(range.getClientRects()).every(rect => rect.left >= row.left && rect.right <= row.right && rect.right <= innerWidth);
  })).toBe(true);
  expect(await copy.locator('svg').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  })).toBe(true);
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ADDRESS);
});

test('actual App switches HD to watch to HD; shared address never inherits authority', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await openNative(page);
  await waitForPublicWallet(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: nativeAccountName('Account 1', 'Recovery phrase account', ADDRESS) })).toContainText(ADDRESS);
  await expect(page.getByRole('button', { name: watchAccountName('Select', 'Shared address watch', 'Public EVM address', ADDRESS) })).toContainText(ADDRESS);
  await page.getByRole('button', { name: watchAccountName('Select', 'Shared address watch', 'Public EVM address', ADDRESS) }).click();
  await expectWatchOnly(page);
  await expect(page.getByLabel('Ethereum balance 2.5 ETH', { exact: true })).toBeVisible();
  expect((await fixture(page)).unlocks).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.oldPhases()[0])).toBe('disposed');
  expect(await page.evaluate(() => window.__watchFixture.events())).toContain('connections:dispose');
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: nativeAccountName('Account 1', 'Recovery phrase account', ADDRESS) })).toHaveCount(0);
  await expect(page.getByText(SECOND, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForPublicWallet(page);
  expect((await fixture(page)).unlocks).toBe(2);
  expect((await fixture(page)).signs).toBe(0);
  expect(errors).toEqual([]);
});

test('HD account choice survives watch navigation and reload into its public view', async ({ page }) => {
  await page.goto('/'); await openNative(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: nativeAccountName('Account 2', 'Recovery phrase account', SECOND) }).click();
  await expect(page.getByText('Account 2 · Ethereum', { exact: true })).toBeVisible();
  await selectWatchFromNative(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForPublicWallet(page);
  await expect(page.getByText('Account 2 · Ethereum', { exact: true })).toBeVisible();
  await page.reload();
  await waitForPublicWallet(page);
  await expect(page.getByText('Account 2 · Ethereum', { exact: true })).toBeVisible();
  expect((await fixture(page)).unlocks).toBe(1);
});

for (const change of ['select', 'create', 'shared-select', 'stale-create'] as const) {
  test(`the initial HD hint is consumed before a managed ${change} and relock`, async ({ page }) => {
    const initialId = change === 'stale-create' ? 'hd:60:2' : 'hd:60:1';
    await page.addInitScript((id) => localStorage.setItem('pali-public-selection-fixture-v1', JSON.stringify({ kind: 'hd', id })), initialId);
    await page.goto('/');
    await waitForPublicWallet(page);
    // A valid public hint selects its account; a missing account hint is ignored.
    await expect(page.getByText(`${change === 'stale-create' ? 'Account 1' : 'Account 2'} · Ethereum`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    if (change === 'shared-select') {
      await page.getByRole('button', { name: nativeAccountName('Account 1', 'Recovery phrase account', ADDRESS) }).click();
      await expect(page.getByText('Account 1 · Ethereum', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Manage wallet accounts', exact: true }).click();
    if (change === 'select' || change === 'shared-select') {
      await page.getByRole('button', { name: `Select Account ${change === 'select' ? '1' : '2'}`, exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Add account', exact: true }).click();
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Savings');
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await authenticateNativeOperation(page);
    }
    if (change === 'stale-create') {
      await expect(page.getByRole('button', { name: 'Select Savings', exact: true })).toContainText('Selected');
      await page.getByRole('button', { name: 'Select Account 1', exact: true }).click();
    }
    const name = change === 'select' || change === 'stale-create' ? 'Account 1' : change === 'shared-select' ? 'Account 2' : 'Savings';
    const address = change === 'select' || change === 'stale-create' ? ADDRESS : change === 'shared-select' ? SECOND : '0x2222222222222222222222222222222222222222';
    const id = change === 'select' || change === 'stale-create' ? 'hd:60:0' : change === 'shared-select' ? 'hd:60:1' : 'hd:60:2';
    await expect(page.getByRole('button', { name: `Select ${name}`, exact: true })).toContainText('Selected');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByText(`${name} · Ethereum`, { exact: true })).toBeVisible();
    await lockWallet(page);
    await unlockPublicWallet(page);
    await expect(page.getByText(`${name} · Ethereum`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__watchFixture.selection())).toEqual({ kind: 'hd', id });
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(page.getByTestId('native-receive-address')).toHaveText(address);
    expect((await fixture(page)).unlocks).toBe(2);
    expect((await fixture(page)).signs).toBe(0);
  });
}

test('backup-required public entry consumes the hint before backup completion and account creation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pali-public-selection-fixture-v1', JSON.stringify({ kind: 'hd', id: 'hd:60:0' })));
  await page.goto('/?backup-required=1');
  await page.getByRole('button', { name: 'Back up your wallet. Protect access if this phone is lost.', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back Up Now', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('backup-required');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await revealBackupPhrase(page);
  await confirmFixtureBackup(page);
  await expect(page.getByText('Backup complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.events().filter((event) => event === 'backup:confirmed').length)).toBe(1);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Manage wallet accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Savings');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await authenticateNativeOperation(page);
  await expect(page.getByRole('button', { name: 'Select Savings', exact: true })).toContainText('Selected');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Savings · Ethereum', { exact: true })).toBeVisible();
  await lockWallet(page);
  await unlockPublicWallet(page);
  await expect(page.getByText('Savings · Ethereum', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.selection())).toEqual({ kind: 'hd', id: 'hd:60:1' });
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByTestId('native-receive-address')).toHaveText(SECOND);
  expect((await fixture(page)).signs).toBe(0);
});

test('interrupted native public reopen retains the selected account without a signing prompt', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pali-public-selection-fixture-v1', JSON.stringify({ kind: 'hd', id: 'hd:60:1' })));
  await page.goto('/'); await waitForPublicWallet(page);
  await page.evaluate(() => window.__watchFixture.delayUnlock(true));
  await lockWallet(page);
  await unlockPublicView(page);
  await expect(page.getByText('Opening your wallet securely…', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.__watchFixture.lifecycle('background'); window.__watchFixture.releaseUnlock(); });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await waitForPublicWallet(page);
  await expect(page.getByText('Account 2 · Ethereum', { exact: true })).toBeVisible();
  expect((await fixture(page)).signs).toBe(0);
});

test('pending native public reopen cannot revive signing after exit and watch selection', async ({ page }) => {
  await page.goto('/'); await openNative(page);
  await page.evaluate(() => window.__watchFixture.delayUnlock(true));
  await lockWallet(page);
  await unlockPublicView(page);
  await expect(page.getByText('Opening your wallet securely…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expectWatchOnly(page);
  await page.evaluate(() => window.__watchFixture.releaseUnlock());
  await expect.poll(() => page.evaluate(() => window.__watchFixture.oldPhases()[0])).toBe('disposed');
  await expectWatchOnly(page);
  expect((await fixture(page)).signs).toBe(0);
  expect((await fixture(page)).broadcasts).toBe(0);
});

test('an unconfirmed native review cannot authorize after switching to a public watch address', async ({ page }) => {
  await page.goto('/'); await openNative(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill(SECOND);
  await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm and send', exact: true })).toBeVisible();
  const reviewId = await page.evaluate(() => window.__watchFixture.reviewId());
  expect(reviewId).not.toBeNull();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await selectWatchFromNative(page);
  await expectWatchOnly(page);
  const staleResult = await page.evaluate((id) => window.__watchFixture.confirmReview(id!), reviewId);
  expect(staleResult).toMatch(/CANCELLED|EXPIRED/);
  expect((await fixture(page)).signs).toBe(0);
  expect((await fixture(page)).broadcasts).toBe(0);
});

test('review and pending signing are revoked before a watch account becomes active', async ({ page }) => {
  await page.goto('/'); await openNative(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill(SECOND);
  await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm and send', exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.delaySign(true));
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm and send', exact: true }).click();
  await authenticateNativeOperation(page);
  await expect.poll(async () => (await fixture(page)).signs).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  // Cancelling an in-flight secret operation locks the native source immediately.
  await expect(page.getByRole('button', { name: 'Open wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.releaseSign());
  expect((await fixture(page)).broadcasts).toBe(0);
  expect(await page.evaluate(() => window.__watchFixture.events().includes('sign:finish'))).toBe(false);
  // Cancelled signing closes its runtime; it does not set the deliberate view-lock marker.
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForPublicWallet(page);
  await selectWatchFromNative(page);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.oldPhases()[0])).toBe('disposed');
  await expectWatchOnly(page);
  expect((await fixture(page)).broadcasts).toBe(0);
  await expect(page.getByRole('button', { name: 'Confirm and send', exact: true })).toHaveCount(0);
});

test('watch management persists add rename and remove through actual forms', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Vacation');
  await page.getByRole('textbox', { name: 'Public EVM address', exact: true }).fill(SECOND);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByText('Vacation · Watch-only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: watchAccountName('Rename', 'Vacation', 'Public EVM address', SECOND) }).click();
  await page.getByRole('textbox', { name: 'Watch account name', exact: true }).fill('Travel');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('button', { name: watchAccountName('Select', 'Travel', 'Public EVM address', SECOND) })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: watchAccountName('Select', 'Travel', 'Public EVM address', SECOND) })).toBeVisible();
  await page.getByRole('button', { name: watchAccountName('Remove', 'Travel', 'Public EVM address', SECOND) }).click();
  await page.getByRole('button', { name: 'Remove watch account', exact: true }).click();
  await expect(page.getByRole('button', { name: watchAccountName('Select', 'Travel', 'Public EVM address', SECOND) })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: watchAccountName('Select', 'Travel', 'Public EVM address', SECOND) })).toHaveCount(0);
  expect((await fixture(page)).unlocks).toBe(0);
  expect((await fixture(page)).writes).toBe(0); // reload resets the audit, not persisted records
});

test('read failure is visible, preserves saved records, and prevents an empty replacement', async ({ page }) => {
  await page.goto('/?read-failure=1');
  await expect(page.getByText('Unable to open accounts', { exact: true })).toBeVisible();
  await expect(page.getByText('Your saved data is preserved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch an account', exact: true })).toHaveCount(0);
  expect((await fixture(page)).writes).toBe(0);
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForPublicWallet(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByText('Watch accounts unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch an account', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__watchFixture.readFailure(false));
  await page.getByRole('button', { name: 'Reopen watch accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: watchAccountName('Select', 'Shared address watch', 'Public EVM address', ADDRESS) })).toBeVisible();
  expect((await fixture(page)).writes).toBe(0);
});

test('watch Receive copies full address and never adds native signing or preview affordances', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expectWatchOnly(page);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByLabel(`Ethereum address ${ADDRESS}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: `QR code for Ethereum address ${ADDRESS}` })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText('before-copy'));
  await page.getByRole('button', { name: 'Copy address', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ADDRESS);
  await expect(page.getByText('Ethereum address copied.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Network/ }).click();
  await page.getByRole('button', { name: /Base/ }).click();
  await expect(page.getByLabel('Base balance 2.5 ETH', { exact: true })).toBeVisible();
  await expectWatchOnly(page);
  expect((await fixture(page)).unlocks).toBe(0);
});

test('background closes the native public view; watch-only chooser and large type remain usable', async ({ page }, testInfo) => {
  await page.goto('/'); await openNative(page);
  await page.evaluate(() => window.__watchFixture.lifecycle('background'));
  await expect(page.getByText(SECOND, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await waitForPublicWallet(page);
  await selectWatchFromNative(page);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('button', { name: nativeAccountName('Account 2', 'Recovery phrase account', SECOND) })).toHaveCount(0);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 23px !important; line-height: 1.4 !important; }' });
  await page.getByRole('button', { name: watchAccountName('Select', 'Shared address watch', 'Public EVM address', ADDRESS) }).click();
  await expectWatchOnly(page);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy address', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  const screenshot = testInfo.outputPath('watch-large-type-receive.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Watch Receive at large type', { path: screenshot, contentType: 'image/png' });
});
