import { authenticateNativeOperation, waitForNativePublicSession, revealBackupPhrase } from '../ui/operationAuthentication';
import { test, expect, type Page } from '@playwright/test';
import { expectReceiveFooter, receiveViewports, scaleReceiveText } from '../receiveLayout';
import { watchAccountName } from '../accountControlNames';

const TABS = ['Wallet', 'Activity', 'Tools', 'Settings'] as const;
const PUBLIC_KEY = `0x${'1'.repeat(64)}`;
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4182') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
    throw Error('Unexpected external request in real-shell test');
  });
});

async function tabs(page: Page, selected: typeof TABS[number] = 'Wallet') {
  await expect(page.getByRole('tablist', { name: 'Main navigation', exact: true }).getByRole('tab')).toHaveCount(4);
  for (const name of TABS) {
    const tab = page.getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('aria-selected', name === selected ? 'true' : 'false');
  }
}
async function chooseTab(page: Page, name: typeof TABS[number]) {
  await page.getByRole('tab', { name, exact: true }).click();
  await tabs(page, name);
}
async function openNative(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForNativePublicSession(page);
}
async function unlock(page: Page) {
  await waitForNativePublicSession(page);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await tabs(page);
}
async function openWatch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await tabs(page);
}

test('Receive footer hides retained public account data when the mounted watch authority locks', async ({ page }) => {
  await page.goto('/?watch-receive-fixture');
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  const address = page.getByLabel('Ethereum address 0x52908400098527886E0F7030069857D2E4169EE7', { exact: true });
  await expect(address).toBeVisible();
  await page.evaluate(() => window.__watchReceiveFixture.lock());
  await expect.poll(() => page.evaluate(() => window.__watchReceiveFixture.status())).toBe('locked');
  await expect(page.getByRole('heading', { name: 'Receive ETH', exact: true })).toBeVisible();
  await expect(page.getByText('Public account hidden', { exact: true })).toBeVisible();
  await expect(address).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy address', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Share address', exact: true })).toHaveCount(0);
});

for (const viewport of receiveViewports) {
  for (const scale of [1, 1.6]) {
    test(`Receive address and actions stay reachable in watch at ${viewport.width}x${viewport.height} and ${scale} text`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await openWatch(page);
      await page.getByRole('button', { name: 'Receive', exact: true }).click();
      if (scale !== 1) await scaleReceiveText(page, scale);
      const address = page.getByLabel('Ethereum address 0x52908400098527886E0F7030069857D2E4169EE7', { exact: true });
      const qr = page.getByRole('img', { name: 'QR code for Ethereum address 0x52908400098527886E0F7030069857D2E4169EE7', exact: true });
      if (scale === 1 && viewport.height >= 568) {
        await expect(address).toBeInViewport({ ratio: 1 });
        await expect(qr).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: 'Copy address', exact: true })).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: 'Share address', exact: true })).toBeInViewport({ ratio: 1 });
      }
      await expectReceiveFooter(page, address, qr);
      await page.evaluate(() => { navigator.clipboard.writeText = async () => undefined; });
      await page.getByRole('button', { name: 'Copy address', exact: true }).click();
      await expect(page.getByText('Ethereum address copied.', { exact: true })).toBeVisible();
      if (scale !== 1) await scaleReceiveText(page, scale);
      await expectReceiveFooter(page, address, qr);
      await address.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('receive-address-footer.png') });
    });
  }
}
async function openSecurity(page: Page) {
  await chooseTab(page, 'Settings');
  await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
  await expect(page.getByText('Backed up', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
}

// These are the actual App/session owners with synthetic runtime ports. They do
// not establish physical-device Back, clipboard or native layout qualification.
test('native tab switches retain one ready controller and never invoke authentication or signing', async ({ page }, testInfo) => {
  await openNative(page); await unlock(page);
  const initial = await page.evaluate(() => ({ audit: window.__watchFixture.audit(), phases: window.__watchFixture.oldPhases() }));
  expect(initial.phases).toEqual(['ready']);
  await page.screenshot({ path: testInfo.outputPath('native-wallet.png'), fullPage: true });
  for (let i = 0; i < 2; i++) {
    await chooseTab(page, 'Tools');
    await expect(page.getByRole('button', { name: 'Accounts', exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Network', exact: false })).toBeVisible();
    await chooseTab(page, 'Settings');
    await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toBeVisible();
    await chooseTab(page, 'Activity');
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
    await expect(page.getByText(/Starbucks|Spotify|Coffee|Sample transaction/)).toHaveCount(0);
    await chooseTab(page, 'Wallet');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  }
  const after = await page.evaluate(() => ({ audit: window.__watchFixture.audit(), phases: window.__watchFixture.oldPhases() }));
  expect(after.phases).toEqual(['ready']);
  expect(after.audit.closed).toBe(initial.audit.closed);
  expect(after.audit.unlocks).toBe(1);
  expect(after.audit.signs).toBe(0); expect(after.audit.broadcasts).toBe(0);
});

test('rapid Activity departures honor the latest requested tab and still return to Wallet', async ({ page }) => {
  await openNative(page); await unlock(page); await chooseTab(page, 'Activity');
  // Both clicks happen before Activity's asynchronous position save completes.
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
    tabs.find((element) => element.getAttribute('aria-label') === 'Tools')!.click();
    tabs.find((element) => element.getAttribute('aria-label') === 'Settings')!.click();
  });
  await tabs(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await chooseTab(page, 'Wallet');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.oldPhases())).toEqual(['ready']);
});

test('Tools checks exact site origins locally and clears its result on Back', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openWatch(page);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: /Check a site/ }).click();
  await expect(page.getByRole('heading', { name: 'Check a site' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Site address' });
  const check = page.getByRole('button', { name: 'Check site', exact: true });
  await expect(check).toBeDisabled();
  await input.fill('BRIDGE.Syscoin.org/a?session=public-fixture');
  await input.press('Enter');
  await expect(page.getByText('Listed by Pali', { exact: true })).toBeVisible();
  await expect(page.getByText('https://bridge.syscoin.org', { exact: true })).toBeVisible();
  await expect(page.getByText('A list match does not verify a connection.')).toBeVisible();
  await input.fill('https://bridge.syscoin.org.attacker.invalid');
  await expect(page.getByText('Listed by Pali', { exact: true })).toHaveCount(0);
  await check.click();
  const unlisted = page.getByText('Unlisted site', { exact: true });
  await expect(unlisted).toBeVisible();
  await expect(page.getByText('https://bridge.syscoin.org.attacker.invalid', { exact: true })).toBeVisible();
  expect((await unlisted.boundingBox())!.x - (await check.boundingBox())!.x).toBeGreaterThanOrEqual(15);
  await page.screenshot({ path: testInfo.outputPath('unlisted-site-320.png'), fullPage: true });
  await input.fill('file:///tmp/index.html');
  await check.click();
  await expect(page.getByText('Enter a valid site address', { exact: true })).toBeVisible();
  const prefix = 'https://bridge.syscoin.org'.padEnd(200);
  await input.fill(`${prefix}😈@attacker.invalid`);
  await expect(input).toHaveValue(`${prefix}…`);
  await check.click();
  await expect(page.getByText('Site address is too long', { exact: true })).toBeVisible();
  await expect(page.getByText('Listed by Pali', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page, 'Tools');
  await page.getByRole('button', { name: /Check a site/ }).click();
  await expect(input).toHaveValue('');
  await expect(check).toBeDisabled();
});

test('native unlock and all security presentation stages exclude the tab shell', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => window.__watchFixture.delayUnlock(true));
  await authenticateNativeOperation(page);
  await expect(page.getByText('Unlocking your wallet securely…', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.releaseUnlock());
  await tabs(page);
  await openSecurity(page);
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await authenticateNativeOperation(page);
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide private key', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'View recovery phrase', exact: false }).click();
  await revealBackupPhrase(page);
  await expect(page.getByText('abandon', { exact: true })).toHaveCount(11);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Word [0-9]+$/ })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('account management, imported-key review and send approval exclude tabs', async ({ page }) => {
  await openNative(page); await unlock(page);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Accounts', exact: false }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage wallet accounts', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Account name', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Authorize change', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Import private key', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Public fixture import');
  await page.getByRole('textbox', { name: 'EVM private key', exact: true }).fill(`0x${'1'.padStart(64, '0')}`);
  await page.getByRole('button', { name: 'Review address', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import account', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page, 'Tools');
  await chooseTab(page, 'Wallet');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill('0x1111111111111111111111111111111111111111');
  await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm and send', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH', exact: true })).toHaveValue('0.001');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page);
  expect((await page.evaluate(() => window.__watchFixture.audit())).signs).toBe(0);
});

test('watch shell is operational without borrowing native permissions or demo activity', async ({ page }) => {
  await page.goto('/?evm-activity=1');
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await tabs(page);
  await chooseTab(page, 'Activity');
  await expect(page.getByRole('button', { name: /^1\.000000000000000001 ETH, Confirmed\./ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await expect(page.getByText('Direct transactions and token transfer events from the selected explorer. Internal transfers are not included; older activity may require loading.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close activity options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review resend', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Starbucks|Spotify|Coffee|Sample transaction/)).toHaveCount(0);
  await chooseTab(page, 'Tools');
  await expect(page.getByRole('button', { name: 'Accounts', exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Network', exact: false })).toHaveCount(0);
  await chooseTab(page, 'Settings');
  await expect(page.getByText('This account contains a public address, not its private key or recovery phrase. Keep backups in the wallet that controls it.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reveal|recovery phrase|private key|Send/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide accounts', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View my accounts', exact: true })).toBeVisible();
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
});

test('same-address native to watch switch revokes native owner before public tabs render', async ({ page }) => {
  await openNative(page); await unlock(page);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Accounts', exact: false }).click();
  await page.getByRole('button', { name: watchAccountName('Select', 'Shared address watch', 'Public EVM address', '0x52908400098527886E0F7030069857D2E4169EE7') }).click();
  await tabs(page);
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.oldPhases()[0])).toBe('disposed');
  await chooseTab(page, 'Settings');
  await expect(page.getByRole('button', { name: /Security & backups|Reveal|Send/ })).toHaveCount(0);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Accounts', exact: false }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForNativePublicSession(page);
  expect(await page.evaluate(() => window.__watchFixture.audit().unlocks)).toBe(1);
});

test('fixed Bitcoin watch Activity loads automatically and its Wallet scope survives tab changes', async ({ page }) => {
  await page.goto('/?empty=1');
  await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await page.getByRole('button', { name: 'Bitcoin', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('BTC shell fixture');
  await page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true }).fill(BTC);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await tabs(page);
  await chooseTab(page, 'Activity');
  await expect(page.getByRole('button', { name: 'Load confirmed activity', exact: true })).toHaveCount(0);
  await expect(page.getByText('20 transactions shown', { exact: true })).toBeVisible();
  const accountCalls = (await page.evaluate(() => window.__watchFixture.activity.calls()))
    .filter(url => new URL(url).pathname.includes('/address/'));
  expect(accountCalls).toEqual([`https://btc1.trezor.io/api/v2/address/${BTC}?details=txsummary&page=1&pageSize=20`]);
  await chooseTab(page, 'Wallet');
  await expect(page.getByText('Network', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'BTC Bitcoin 1.23456789 BTC', exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByLabel('Bitcoin confirmed balance 1.23456789 BTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
});

test('native network without an explorer shows saved-transfer coverage and retains its registration', async ({ page }) => {
  await openNative(page); await unlock(page);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Network', exact: false }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  const base = page.getByRole('radio', { name: /^Base,/ });
  await base.click(); await expect(base).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page);
  await chooseTab(page, 'Activity');
  await page.getByRole('button', { name: 'Activity network: All networks', exact: true }).click();
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activity network: Base', exact: true })).toBeVisible();
  await expect(page.getByText('Some activity is unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Some network activity is unavailable.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show zero-value token activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Some activity is unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No activity yet', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.networkId)).toBe('base');
  expect(await page.evaluate(() => window.__watchFixture.audit().unlocks)).toBe(1);
});

test('background cancels pending private presentation and requires unlock before restoring tabs', async ({ page }) => {
  await openNative(page); await unlock(page); await openSecurity(page);
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await authenticateNativeOperation(page);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(1);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(() => { window.__watchFixture.lifecycle('background'); window.__watchFixture.lifecycle('active'); window.__watchFixture.releaseKeyRead(); });
  await waitForNativePublicSession(page);
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
  await unlock(page);
  expect(await page.evaluate(() => window.__watchFixture.oldPhases())).toEqual(['ready']);
});

test('clearing Security returns to its originating Settings tab', async ({ page }) => {
  await openNative(page); await unlock(page); await openSecurity(page);
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await authenticateNativeOperation(page);
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PIN digit 1', exact: true })).toHaveCount(0);
});

test('activity reset admits one same-turn double click and returns to Settings', async ({ page }, testInfo) => {
  await openNative(page); await unlock(page); await chooseTab(page, 'Settings');
  await page.getByRole('button', { name: /^Reset activity Clear local/ }).click();
  await expect(page.getByRole('heading', { name: 'Reset activity', exact: true })).toBeVisible();
  await expect(page.getByText('Transactions already held by the network remain pending and may still confirm.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('activity-reset.png'), fullPage: true });
  await page.evaluate(() => window.__watchFixture.delayActivityReset(true));
  await page.getByRole('button', { name: 'Reset activity', exact: true }).evaluate((button) => {
    (button as HTMLElement).click(); (button as HTMLElement).click();
  });
  await expect.poll(() => page.evaluate(() => window.__watchFixture.events().filter(event => event === 'activity:reset:start').length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Resetting activity…', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__watchFixture.finishActivityReset());
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.events().filter(event => event === 'activity:reset:done').length)).toBe(1);
});

test('locking during activity reset prevents stale completion', async ({ page }) => {
  await openNative(page); await unlock(page); await chooseTab(page, 'Settings');
  await page.getByRole('button', { name: /^Reset activity Clear local/ }).click();
  await page.evaluate(() => window.__watchFixture.delayActivityReset(true));
  await page.getByRole('button', { name: 'Reset activity', exact: true }).click();
  await page.evaluate(() => {
    window.__watchFixture.lifecycle('background');
    window.__watchFixture.lifecycle('active');
    window.__watchFixture.finishActivityReset();
  });
  await expect(page.getByRole('heading', { name: 'Your wallet', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.events().includes('activity:reset:done'))).toBe(false);
});

test('activity reset remains readable with narrow large-text confirmation and error states', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openNative(page, '?font-scale=1.6'); await unlock(page); await chooseTab(page, 'Settings');
  // RN Web ignores Dynamic Type. Enlarge the rendered body text for this layout check.
  await page.addStyleTag({ content: `
    [dir="auto"] { font-size: 24px !important; line-height: 1.4 !important; }
    [data-testid^="main-tab-caption-"] { font-size: 15px !important; line-height: 21.25px !important; }
  ` });
  await page.getByRole('button', { name: /^Reset activity Clear local/ }).click();
  await expect(page.getByRole('button', { name: 'Reset activity', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('confirmation-narrow.png'), fullPage: true });
  await page.evaluate(() => window.__watchFixture.failActivityReset());
  await page.getByRole('button', { name: 'Reset activity', exact: true }).click();
  await expect(page.getByText('Activity reset incomplete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset activity', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('error-narrow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reset activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('success-narrow.png'), fullPage: true });
});

test('a changed native account invalidates the old originating tab before Back', async ({ page }) => {
  await openNative(page); await unlock(page); await openSecurity(page);
  await page.evaluate(() => window.__watchFixture.selectAccount('hd:60:1'));
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page, 'Wallet');
  await expect(page.getByText('Account 2 · Ethereum', { exact: true })).toBeVisible();
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.accountId)).toBe('hd:60:1');
});

test('all four labels remain whole, operable and unclipped at 320px with large body text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openWatch(page);
  // RN Web ignores native Dynamic Type props. Emulate large body text and the
  // 1.25x native caption limit; the actual component props have a Node regression.
  await page.addStyleTag({ content: `
    [dir="auto"] { font-size: 24px !important; line-height: 1.4 !important; }
    [data-testid^="main-tab-caption-"] { font-size: 15px !important; line-height: 21.25px !important; }
  ` });
  for (const name of TABS) {
    await chooseTab(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const boxes = await page.getByRole('tablist', { name: 'Main navigation', exact: true }).getByRole('tab').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, right: box.right, width: box.width, height: box.height, client: element.clientHeight, scroll: element.scrollHeight };
    }));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(320);
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    }
    for (const label of TABS) {
      const caption = page.getByRole('tab', { name: label, exact: true }).getByText(label, { exact: true });
      const metrics = await caption.evaluate((element) => {
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        const box = element.getBoundingClientRect();
        return { text: element.textContent, whiteSpace: getComputedStyle(element).whiteSpace, lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
          fullWidth: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
          width: box.width, client: element.clientWidth, scroll: element.scrollWidth };
      });
      expect(metrics.text).toBe(label); expect(metrics.whiteSpace).toBe('nowrap'); expect(metrics.lines).toBe(1);
      expect(metrics.fullWidth).toBeLessThanOrEqual(metrics.width + 1);
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
    }
    expect(await page.getByRole('heading', { name: name === 'Wallet' ? 'Pali Wallet' : name, exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).toBe('24px');
    await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-320-large.png`), fullPage: true });
    if (name === 'Settings') {
      await page.getByRole('button', { name: 'Help & about', exact: false }).click();
      await expect(page.getByRole('heading', { name: 'Help & about', exact: true })).toBeVisible();
      await expect(page.getByText('Native features are under qualification. Use only test wallets and testnet funds.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy support link', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('help-about-320-large.png'), fullPage: true });
      await page.getByRole('button', { name: 'Routescan', exact: true }).scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const write = navigator.clipboard.writeText, exec = document.execCommand;
        navigator.clipboard.writeText = async () => { throw Error('Public fixture clipboard denied'); };
        document.execCommand = () => { throw Error('Public fixture fallback denied'); };
        (window as unknown as { restoreHelpClipboard(): void }).restoreHelpClipboard = () => { navigator.clipboard.writeText = write; document.execCommand = exec; };
      });
      await page.getByRole('button', { name: 'Copy support link', exact: true }).click();
      await expect(page.getByText('Could not copy the support link.', { exact: true })).toBeVisible();
      const assertFeedbackVisible = async () => {
        const feedback = await page.getByTestId('help-copy-feedback').boundingBox();
        const done = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox();
        expect(feedback).not.toBeNull(); expect(done).not.toBeNull();
        expect(feedback!.y).toBeGreaterThanOrEqual(0);
        expect(feedback!.y + feedback!.height).toBeLessThanOrEqual(done!.y);
      };
      await assertFeedbackVisible();
      await page.screenshot({ path: testInfo.outputPath('help-about-copy-error-320-large.png'), fullPage: true });
      await page.evaluate(() => (window as unknown as { restoreHelpClipboard(): void }).restoreHelpClipboard());
      await page.getByRole('button', { name: 'Copy support link', exact: true }).click();
      await expect(page.getByText('Support link copied.', { exact: true })).toBeVisible();
      await assertFeedbackVisible();
      await page.screenshot({ path: testInfo.outputPath('help-about-copy-success-320-large.png'), fullPage: true });
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await tabs(page, 'Settings');
    }
  }
});


// RN Web does not apply native font scaling, so scale each rendered text node
// from its own computed size. The fixture independently sets Dimensions before
// this screen mounts to exercise the same responsive branch as native.
async function scaleVisibleText(page: Page, scale = 1.6) {
  await page.evaluate((factor) => {
    const values = Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]'))
      .filter((element) => !element.hasAttribute('data-qa-font-scaled'))
      .map((element) => {
        const style = getComputedStyle(element);
        return { element, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      });
    for (const { element, font, line } of values) {
      element.setAttribute('data-qa-font-scaled', 'true');
      if (Number.isFinite(font)) element.style.setProperty('font-size', `${font * factor}px`, 'important');
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * factor}px`, 'important');
    }
  }, scale);
}

async function expectWholeLabel(page: Page, label: string) {
  const text = page.getByRole('button', { name: label, exact: true }).getByText(label, { exact: true });
  const lines = await text.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  });
  expect(lines, `${label} should not split across lines`).toBe(1);
}

test('watch portfolio keeps toolbar targets and full-width Receive at 320px with font scale 1.6', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?font-scale=1.6');
  expect(await page.evaluate(() => window.__watchFixture.fontScale())).toBe(1.6);
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  const subtitle = page.getByText('Shared address watch · Watch-only', { exact: true });
  await expect(subtitle).toBeVisible();
  await scaleVisibleText(page);

  const heading = page.getByRole('heading', { name: 'Pali Wallet', exact: true });
  const headerBottom = await heading.evaluate((element) => element.parentElement!.parentElement!.getBoundingClientRect().bottom);
  const accounts = page.getByRole('button', { name: 'Accounts', exact: true });
  const accountsBox = (await accounts.boundingBox())!;
  expect(accountsBox.width).toBeGreaterThanOrEqual(44); expect(accountsBox.height).toBeGreaterThanOrEqual(44);
  expect(accountsBox.x).toBeGreaterThanOrEqual(0); expect(accountsBox.x + accountsBox.width).toBeLessThanOrEqual(320);
  const splitWords = await subtitle.evaluate((element) => {
    const node = element.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return ['missing text'];
    const content = node.textContent ?? '';
    return Array.from(content.matchAll(/[A-Za-z]+/g)).filter((match) => {
      const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
      return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size !== 1;
    }).map((match) => match[0]);
  });
  expect(splitWords).toEqual([]);
  const receive = page.getByRole('button', { name: 'Receive', exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  const receiveBox = (await receive.boundingBox())!; const refreshBox = (await refresh.boundingBox())!;
  expect(receiveBox.width).toBeGreaterThan(250); expect(receiveBox.y).toBeGreaterThanOrEqual(headerBottom);
  expect(refreshBox.width).toBeGreaterThanOrEqual(44); expect(refreshBox.height).toBeGreaterThanOrEqual(44);
  expect(refreshBox.x + refreshBox.width).toBeLessThanOrEqual(accountsBox.x + 1);
  await expect(refresh.locator('svg')).toBeVisible(); await expectWholeLabel(page, 'Receive');

  await receive.click();
  await expect(page.getByRole('heading', { name: 'Receive ETH', exact: true })).toBeVisible();
  await scaleVisibleText(page);
  const copy = page.getByRole('button', { name: 'Copy address', exact: true });
  const share = page.getByRole('button', { name: 'Share address', exact: true });
  const copyBox = (await copy.boundingBox())!; const shareBox = (await share.boundingBox())!;
  expect(copyBox.width).toBeGreaterThan(250); expect(shareBox.width).toBeGreaterThan(250);
  expect(shareBox.y).toBeGreaterThanOrEqual(copyBox.y + copyBox.height);
  await expectWholeLabel(page, 'Copy address'); await expectWholeLabel(page, 'Share address');
});

test('watch portfolio retains its icon toolbar and full-width Receive at normal font scale', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openWatch(page);
  expect(await page.evaluate(() => window.__watchFixture.fontScale())).toBe(1);
  const accounts = (await page.getByRole('button', { name: 'Accounts', exact: true }).boundingBox())!;
  const title = (await page.getByRole('heading', { name: 'Pali Wallet', exact: true }).boundingBox())!;
  expect(accounts.y).toBeLessThan(title.y + title.height + 30);
  const receive = (await page.getByRole('button', { name: 'Receive', exact: true }).boundingBox())!;
  const refresh = (await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox())!;
  expect(receive.width).toBeGreaterThan(250);
  expect(receive.y).toBeGreaterThanOrEqual(refresh.y + refresh.height);
  expect(refresh.width).toBeGreaterThanOrEqual(44); expect(refresh.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  const copy = (await page.getByRole('button', { name: 'Copy address', exact: true }).boundingBox())!;
  const share = (await page.getByRole('button', { name: 'Share address', exact: true }).boundingBox())!;
  expect(Math.abs(copy.y - share.y)).toBeLessThanOrEqual(1);
  expect(share.x).toBeGreaterThan(copy.x + copy.width - 1);
});


test('watch Receive and icon toolbar remain accessible at 320px with font scale 1.3', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?font-scale=1.3');
  expect(await page.evaluate(() => window.__watchFixture.fontScale())).toBe(1.3);
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await scaleVisibleText(page, 1.3);
  const receive = page.getByRole('button', { name: 'Receive', exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await expectWholeLabel(page, 'Receive'); await expect(refresh.locator('svg')).toBeVisible();
  const receiveBox = (await receive.boundingBox())!; const refreshBox = (await refresh.boundingBox())!;
  expect(receiveBox.width).toBeGreaterThan(250); expect(receiveBox.y).toBeGreaterThanOrEqual(refreshBox.y + refreshBox.height);
  expect(refreshBox.width).toBeGreaterThanOrEqual(44); expect(refreshBox.height).toBeGreaterThanOrEqual(44);
  // Capture a real scroll offset on the home view before changing modes.
  // The following viewport assertions must precede any locator click, focus or
  // scrollIntoView that could hide an inherited offset.
  const previousScroll = await receive.evaluate((element) => {
    let parent = element.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight && /(auto|scroll)/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    if (!parent) return 0;
    parent.scrollTop = Math.min(180, parent.scrollHeight - parent.clientHeight);
    return parent.scrollTop;
  });
  expect(previousScroll).toBeGreaterThan(0);
  await receive.click();
  await expect(page.getByRole('heading', { name: 'Receive ETH', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeInViewport({ ratio: 1 });
  await scaleVisibleText(page, 1.3);
  const copy = page.getByRole('button', { name: 'Copy address', exact: true });
  const share = page.getByRole('button', { name: 'Share address', exact: true });
  const copyBox = (await copy.boundingBox())!; const shareBox = (await share.boundingBox())!;
  expect(Math.abs(copyBox.y - shareBox.y)).toBeLessThanOrEqual(1);
  expect(shareBox.x).toBeGreaterThanOrEqual(copyBox.x + copyBox.width - 1);
  for (const label of ['Copy address', 'Share address']) {
    const text = page.getByRole('button', { name: label, exact: true }).getByText(label, { exact: true });
    const splitWords = await text.evaluate((element) => {
      const node = element.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return ['missing text'];
      return Array.from((node.textContent ?? '').matchAll(/[A-Za-z]+/g)).filter((match) => {
        const range = document.createRange();
        range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size !== 1;
      }).map((match) => match[0]);
    });
    expect(splitWords).toEqual([]);
  }
});

for (const scale of [1, 1.6]) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`watch Receive ${outcome} feedback stays beside actions at ${scale} text scale`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.goto(scale === 1 ? '/' : '/?font-scale=1.6');
      await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
      await page.getByRole('button', { name: 'Receive', exact: true }).click();
      if (scale !== 1) await scaleVisibleText(page, scale);
      await page.evaluate((fail) => {
        navigator.clipboard.writeText = async () => { if (fail) throw Error('fixture denied'); };
        if (fail) document.execCommand = () => { throw Error('fixture denied'); };
      }, outcome === 'failure');
      const copy = page.getByRole('button', { name: 'Copy address', exact: true });
      await copy.click();
      const message = page.getByText(outcome === 'success' ? 'Ethereum address copied.' : 'Could not copy this address. Try again.', { exact: true });
      await expect(message).toBeVisible();
      if (scale !== 1) await scaleVisibleText(page, scale);
      await expect(message).toHaveAttribute('aria-live', 'polite');
      if (outcome === 'failure') await expect(message).toHaveAttribute('role', 'alert');
      const status = (await message.boundingBox())!, button = (await copy.boundingBox())!;
      expect(status.y).toBeGreaterThanOrEqual(0);
      expect(status.y + status.height).toBeLessThanOrEqual(button.y);
      await expect(message).toBeInViewport({ ratio: 1 });
      await expect(copy).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Share address', exact: true })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath(`watch-receive-${outcome}-${scale}.png`) });
    });
  }
}

for (const { width, height } of [{ width: 320, height: 360 }, { width: 844, height: 390 }]) {
  for (const scale of [1, 1.6]) {
    test(`watch Receive failure controls stay reachable at ${width}x${height} and ${scale} text scale`, async ({ page }, testInfo) => {

      await page.setViewportSize({ width, height });
      await page.goto(scale === 1 ? '/' : '/?font-scale=1.6');
      await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
      await page.getByRole('button', { name: 'Receive', exact: true }).click();
      const scaleText = async () => page.evaluate((factor) => {
        const values = Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]'))
          .filter((element) => !element.hasAttribute('data-qa-font-scaled'))
          .map((element) => { const style = getComputedStyle(element); return { element, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) }; });
        for (const { element, font, line } of values) {
          element.setAttribute('data-qa-font-scaled', 'true');
          if (Number.isFinite(font)) element.style.setProperty('font-size', `${font * factor}px`, 'important');
          if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * factor}px`, 'important');
        }
      }, scale);
      if (scale !== 1) await scaleText();
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => { throw Error('fixture denied'); };
        document.execCommand = () => { throw Error('fixture denied'); };
      });
      const copy = page.getByRole('button', { name: 'Copy address', exact: true });
      await copy.click();
      const message = page.getByText('Could not copy this address. Try again.', { exact: true });
      await expect(message).toBeVisible();
      if (scale !== 1) await scaleText();
      for (const control of [message, copy, page.getByRole('button', { name: 'Share address', exact: true }), page.getByRole('button', { name: 'Back', exact: true })]) {
        await control.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        await expect(control).toBeInViewport({ ratio: 1 });
      }
      await page.screenshot({ path: testInfo.outputPath(`watch-receive-${width}x${height}-${scale}.png`) });
    });
  }
}
