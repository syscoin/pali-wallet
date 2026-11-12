import { unlockPublicView, authenticateNativeOperation, refuseNativeOperation, waitForNativePublicSession, deviceAuthorizationPrompt } from '../ui/operationAuthentication';
import { expect, test, type Page } from '@playwright/test';
import { nativeAccountName } from '../accountControlNames';

const NATIVE_HINT = { kind: 'hd', id: 'hd:60:1' };
const WATCH_HINT = { kind: 'watch', id: 'public_1' } as const;
const WATCH_ACCOUNTS = [{
  id: 'public_1', name: 'Shared address watch',
  addresses: { ethereum: '0x52908400098527886E0F7030069857D2E4169EE7' },
}];
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const title = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const audit = (page: Page) => page.evaluate(() => window.__watchFixture.removal.audit());
const selection = (page: Page) => page.evaluate(() => window.__watchFixture.selection());
const ready = (page: Page) => title(page, 'Security & backups');

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    await route.abort();
    throw Error('Unexpected external request');
  });
});

async function publicSession(page: Page) {
  await waitForNativePublicSession(page);
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
}

async function openWallet(page: Page, { empty = false, android = false } = {}) {
  const params = new URLSearchParams({ 'wallet-removal-fixture': '1' });
  if (empty) params.set('empty', '1');
  if (android) params.set('android', '1');
  await page.goto('/?' + params);
  if (empty) await button(page, 'Create wallet').click();
  else await button(page, 'Open wallet').click();
  await publicSession(page);
}

async function openRemoval(page: Page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await button(page, /^Security & backups/).click();
  await button(page, /^Remove wallet from this device/).click();
  await expect(title(page, 'Remove wallet')).toBeVisible();
}

async function authorize(page: Page) {
  await button(page, 'Continue').click();
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  await authenticateNativeOperation(page);
  await expect(button(page, 'Remove wallet')).toBeVisible();
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
}

async function verifiedRemoval(page: Page) {
  await authorize(page);
  await button(page, 'Remove wallet').click();
  await expect(title(page, 'Wallet removed')).toBeVisible();
}

function doublePress(element: Element) {
  if (!(element instanceof HTMLElement)) throw Error('Expected a removal action');
  element.click();
  element.click();
}

test('actual removal route separates shared authentication from destructive confirmation at 320px and at large type', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 680 });
  await openWallet(page);
  await openRemoval(page);
  await expect(page.locator('body')).toContainText(/imported (keys|accounts)/i);
  await expect(page.locator('body')).toContainText(/private notes/i);
  await expect(page.locator('body')).toContainText(/saved transaction records/i);
  await expect(page.locator('body')).toContainText(/recovery phrase/i);
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  await expect(button(page, 'Continue')).toBeEnabled();
  await expect(button(page, 'PIN digit 1')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wallet-removal-review-320.png') });

  await button(page, 'Continue').evaluate(doublePress);
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  await refuseNativeOperation(page);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  await expect(button(page, 'Continue')).toBeEnabled();
  await expect.poll(async () => (await audit(page)).authorizations).toBe(0);
  expect((await audit(page)).commits).toBe(0);

  // Large text and a shorter viewport exercise the actual fixture OS prompt.
  // This checks browser layout, not a native system sheet or keyboard.
  await page.setViewportSize({ width: 320, height: 520 });
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 22px !important; line-height: 1.4 !important; }' });
  await button(page, 'Continue').click();
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  const approve = button(page, 'Approve test device');
  await approve.focus();
  await expect(approve).toBeFocused();
  const field = await approve.boundingBox();
  expect(field).not.toBeNull();
  expect(field!.y).toBeGreaterThanOrEqual(0);
  expect(field!.y + field!.height).toBeLessThanOrEqual(520);
  await page.screenshot({ path: testInfo.outputPath('wallet-removal-device-prompt-large-text.png') });
  await authenticateNativeOperation(page);
  await expect.poll(async () => (await audit(page)).authorizations).toBe(1);
  await expect(button(page, 'Remove wallet')).toBeVisible();
  await expect(page.getByText('Remove wallet from this phone?', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText(/separate key or note backups.*cannot be undone/i);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect((await audit(page)).confirmationAttempts).toBe(0);
  expect((await audit(page)).commits).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('wallet-removal-confirm-large-text.png') });
  await button(page, 'Cancel').click();
  // Authorization retired the old producers before taking the snapshot.
  // Cancelling preserves the wallet and reopens its public controller bundle.
  await waitForNativePublicSession(page);
  expect((await audit(page)).commits).toBe(0);
  await publicSession(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await button(page, /^Security & backups/).click();
  await expect(ready(page)).toBeVisible();
});

test('late authorization after Back and a backgrounded ticket cannot reach confirmation again', async ({ page }) => {
  await openWallet(page, { android: true });
  await openRemoval(page);
  await page.evaluate(() => window.__watchFixture.removal.hold('authorize'));
  await button(page, 'Continue').click();
  await authenticateNativeOperation(page);
  await expect.poll(async () => (await audit(page)).authorizations).toBe(1);
  expect(await page.evaluate(() => window.__watchFixture.back())).toBe(true);
  await expect(ready(page)).toBeVisible();
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.removal.release());
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  await button(page, /^Remove wallet from this device/).click();
  await expect(button(page, 'Continue')).toBeVisible();
  await expect(button(page, 'PIN digit 1')).toHaveCount(0);
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  await authorize(page);
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.focus());
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
  await waitForNativePublicSession(page);
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  expect((await audit(page)).confirmationAttempts).toBe(0);
  expect((await audit(page)).commits).toBe(0);
  await publicSession(page);
  await openRemoval(page);
  await expect(button(page, 'Continue')).toBeVisible();
  await expect(button(page, 'PIN digit 1')).toHaveCount(0);
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
});

test('an expired ticket requires fresh shared authorization', async ({ page }) => {
  await page.clock.install();
  await openWallet(page);
  await openRemoval(page);
  await authorize(page);
  await page.clock.runFor(30_001);
  await expect(button(page, 'Continue')).toBeVisible();
  await expect(button(page, 'PIN digit 1')).toHaveCount(0);
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  await authorize(page);
  expect((await audit(page)).authorizations).toBe(2);
  expect((await audit(page)).confirmationAttempts).toBe(0);
  expect((await audit(page)).commits).toBe(0);
});

test('verified removal dispatches once, survives background reconciliation, and reaches Welcome', async ({ page }) => {
  await openWallet(page, { empty: true });
  await openRemoval(page);
  await authorize(page);
  await page.evaluate(() => window.__watchFixture.removal.hold('commit'));
  await button(page, 'Remove wallet').evaluate(doublePress);
  await expect.poll(async () => (await audit(page)).commits).toBe(1);
  expect((await audit(page)).confirmationAttempts).toBe(1);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('disposed');
  await expect(button(page, 'Create wallet')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.lifecycle('background'));
  await page.evaluate(() => window.__watchFixture.removal.release());
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await expect(title(page, 'Wallet removed')).toBeVisible();
  await button(page, 'Continue').click();
  await expect(button(page, 'Create wallet')).toBeVisible();
  expect(await selection(page)).toBeNull();
  await button(page, 'Create wallet').click();
  await expect(title(page, 'Secure with your device')).toBeVisible();
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  expect((await audit(page)).reopens).toBe(1);
});

test('known unchanged removal returns to the existing wallet, never setup', async ({ page }) => {
  await openWallet(page);
  await openRemoval(page);
  await page.evaluate(() => window.__watchFixture.removal.result('unchanged'));
  await authorize(page);
  await button(page, 'Remove wallet').click();
  await expect(title(page, 'Wallet kept')).toBeVisible();
  await expect(button(page, 'Create wallet')).toHaveCount(0);
  await button(page, /Return to wallet|Back to unlock/).click();
  await publicSession(page);
  expect((await audit(page)).commits).toBe(1);
});

test('an unconfirmed removal stays on a truthful outcome and offers no setup or replay', async ({ page }) => {
  await openWallet(page, { empty: true, android: true });
  await openRemoval(page);
  await page.evaluate(() => window.__watchFixture.removal.result('unconfirmed'));
  await authorize(page);
  await button(page, 'Remove wallet').click();
  await expect(title(page, 'Removal could not be confirmed')).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.back())).toBe(true);
  await expect(title(page, 'Removal could not be confirmed')).toBeVisible();
  await expect(button(page, 'Create wallet')).toHaveCount(0);
  await expect(button(page, 'Create a wallet')).toHaveCount(0);
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  expect((await audit(page)).commits).toBe(1);
});

for (const nextId of ['hd:60:0', 'hd:60:1'] as const) {
  test(`verified removal clears stale in-memory native hint before opening a fixture wallet at ${nextId}`, async ({ page }) => {
    await openWallet(page);
    await button(page, 'Accounts').click();
    await button(page, nativeAccountName('Account 2', 'Recovery phrase account', '0x1111111111111111111111111111111111111111')).click();
    await expect.poll(() => selection(page)).toEqual(NATIVE_HINT);
    await openRemoval(page);
    await verifiedRemoval(page);
    await button(page, 'Continue').click();
    await expect(button(page, 'View my accounts')).toBeVisible();
    expect(await selection(page)).toBeNull();

    await page.evaluate((id) => window.__watchFixture.removal.recreate(id), nextId);
    expect(await selection(page)).toBeNull();
    await button(page, 'Open wallet').click();
    await publicSession(page);
    const label = nextId === 'hd:60:0' ? 'Account 1' : 'Account 2';
    await expect(page.getByText(`${label} · Ethereum`, { exact: true })).toBeVisible();
    await expect.poll(() => selection(page)).toEqual({ kind: 'hd', id: nextId });
  });
}

test('verified removal preserves independent watch records and selection', async ({ page }) => {
  await page.addInitScript((rows) => localStorage.setItem('pali-public-watch-fixture-v1', JSON.stringify(rows)), WATCH_ACCOUNTS);
  await openWallet(page);
  await openRemoval(page);
  await page.evaluate((hint) => window.__watchFixture.removal.saveSelection(hint), WATCH_HINT);
  await verifiedRemoval(page);
  await button(page, 'Continue').click();
  await expect(button(page, 'View my accounts')).toBeVisible();
  expect(await selection(page)).toEqual(WATCH_HINT);
  expect(await page.evaluate(() => window.__watchFixture.accounts())).toEqual(WATCH_ACCOUNTS);
  await button(page, 'View my accounts').click();
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await expect(button(page, 'Send')).toHaveCount(0);
});


test('expiry after a backgrounded removal keeps a reachable OS-authorized public unlock', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pali-fixture-security-preferences', JSON.stringify({ version: 1, custodyIdleMinutes: 5, watchIdleMinutes: 5 })));
  await openWallet(page, { android: true });
  await openRemoval(page);
  await authorize(page);
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(button(page, 'Remove wallet')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().closed)).toBe(1);
  await page.evaluate(() => { window.__watchFixture.idle.elapse(300001); window.__watchFixture.focus(); });
  await expect(title(page, 'Wallet locked')).toBeVisible();
  await expect(button(page, 'Unlock wallet')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await unlockPublicView(page);
  await waitForNativePublicSession(page);
  expect((await audit(page)).confirmationAttempts).toBe(0);
  expect((await audit(page)).commits).toBe(0);
  expect(await page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(0);
});
