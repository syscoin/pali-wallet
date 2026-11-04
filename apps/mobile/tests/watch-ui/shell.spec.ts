import { test, expect, type Page } from '@playwright/test';

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
  await expect(page.getByRole('tab')).toHaveCount(4);
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
  await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
}
async function unlock(page: Page) {
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await tabs(page);
}
async function openWatch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await tabs(page);
}
async function openSecurity(page: Page) {
  await chooseTab(page, 'Settings');
  await page.getByRole('button', { name: 'Security & backups', exact: false }).click();
  await expect(page.getByText('Recovery phrase backed up', { exact: true })).toBeVisible();
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

test('native unlock and all security presentation stages exclude the tab shell', async ({ page }) => {
  await openNative(page);
  await page.evaluate(() => window.__watchFixture.delayUnlock(true));
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
  await expect(page.getByText('Unlocking your wallet securely…', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.releaseUnlock());
  await tabs(page);
  await openSecurity(page);
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide private key', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'View recovery phrase', exact: false }).click();
  await page.getByRole('textbox', { name: 'Confirm your password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click();
  await expect(page.getByText('abandon', { exact: true })).toHaveCount(11);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: "I've written them down", exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Word [0-9]+$/ })).toHaveCount(3);
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
  await expect(page.getByRole('textbox', { name: 'Confirm wallet password', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Import private key', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Public fixture import');
  await page.getByRole('textbox', { name: 'EVM private key', exact: true }).fill(`0x${'1'.padStart(64, '0')}`);
  await page.getByRole('button', { name: 'Review address', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import account', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill('0x1111111111111111111111111111111111111111');
  await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm and send', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page);
  expect((await page.evaluate(() => window.__watchFixture.audit())).signs).toBe(0);
});

test('watch shell is operational without borrowing native permissions or demo activity', async ({ page }) => {
  await openWatch(page);
  await chooseTab(page, 'Activity');
  await expect(page.getByText('Activity unavailable for watch accounts', { exact: true })).toBeVisible();
  await expect(page.getByText(/Starbucks|Spotify|Coffee|Sample transaction/)).toHaveCount(0);
  await chooseTab(page, 'Tools');
  await expect(page.getByRole('button', { name: 'Accounts', exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Network', exact: false })).toHaveCount(0);
  await chooseTab(page, 'Settings');
  await expect(page.getByText('Watch-only account', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Security & backups', exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reveal|recovery phrase|private key|Send/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide accounts', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View my accounts', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.audit().unlocks)).toBe(0);
});

test('same-address native to watch switch revokes native owner before public tabs render', async ({ page }) => {
  await openNative(page); await unlock(page);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Accounts', exact: false }).click();
  await page.getByRole('button', { name: 'Select Shared address watch (watch-only)', exact: true }).click();
  await tabs(page);
  await expect(page.getByText('Shared address watch · Watch-only', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.oldPhases()[0])).toBe('disposed');
  await chooseTab(page, 'Settings');
  await expect(page.getByRole('button', { name: /Security & backups|Reveal|Send/ })).toHaveCount(0);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Accounts', exact: false }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.audit().unlocks)).toBe(1);
});

test('fixed Bitcoin watch Activity remains unavailable and its Wallet scope survives tab changes', async ({ page }) => {
  await page.goto('/?empty=1');
  await page.getByRole('button', { name: 'Watch an address', exact: true }).click();
  await page.getByRole('button', { name: 'Bitcoin', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('BTC shell fixture');
  await page.getByRole('textbox', { name: 'Public Bitcoin address', exact: true }).fill(BTC);
  await page.getByRole('button', { name: 'Review address', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await tabs(page);
  await chooseTab(page, 'Activity');
  await expect(page.getByText('Activity unavailable for watch accounts', { exact: true })).toBeVisible();
  await chooseTab(page, 'Wallet');
  await expect(page.getByText('Bitcoin · Fixed for this address', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Bitcoin confirmed balance 1.23456789 BTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
});

test('unsupported native network shows honest Activity status and retains the selected registration', async ({ page }) => {
  await openNative(page); await unlock(page);
  await chooseTab(page, 'Tools');
  await page.getByRole('button', { name: 'Network', exact: false }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  const base = page.getByRole('radio', { name: /^Base,/ });
  await base.click(); await expect(base).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await tabs(page);
  await chooseTab(page, 'Activity');
  await expect(page.getByText('Activity unavailable on this network', { exact: true })).toBeVisible();
  await expect(page.getByText(/Wallet transaction history is currently available on Ethereum/)).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.networkId)).toBe('base');
  expect(await page.evaluate(() => window.__watchFixture.audit().unlocks)).toBe(1);
});

test('background cancels pending private presentation and requires unlock before restoring tabs', async ({ page }) => {
  await openNative(page); await unlock(page); await openSecurity(page);
  await page.getByRole('button', { name: 'Reveal account private key', exact: false }).click();
  await page.evaluate(() => window.__watchFixture.delayKeyRead(true));
  await page.getByRole('textbox', { name: 'Confirm your wallet password', exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Reveal private key', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.audit().keyReads)).toBe(1);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(() => { window.__watchFixture.lifecycle('background'); window.__watchFixture.lifecycle('active'); window.__watchFixture.releaseKeyRead(); });
  await expect(page.getByRole('button', { name: 'Unlock wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText(PUBLIC_KEY, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.events().includes('key:finish'))).toBe(false);
  await unlock(page);
  expect(await page.evaluate(() => window.__watchFixture.oldPhases())).toEqual(['ready']);
});

test('all four labels remain visible, operable and unclipped at 320px with large text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openWatch(page);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 24px !important; line-height: 1.4 !important; }' });
  for (const name of TABS) {
    await chooseTab(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const boxes = await page.getByRole('tab').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, right: box.right, width: box.width, height: box.height, client: element.clientHeight, scroll: element.scrollHeight };
    }));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(320);
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-320-large.png`), fullPage: true });
  }
});
