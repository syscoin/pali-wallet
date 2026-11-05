import { test, expect, type Page } from '@playwright/test';

const SYS = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
type NetworkChoice = 'Syscoin Mainnet' | 'Bitcoin' | 'Syscoin Testnet';
async function form(page: Page, network: NetworkChoice) {
  await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await page.getByRole('button', { name: network, exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill(network === 'Bitcoin' ? 'BTC savings watch' : 'SYS savings watch');
}
async function review(page: Page, network: NetworkChoice, address: string) {
  await page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true }).fill(address);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await expect(page.getByLabel(`Review ${network} address ${address.toLowerCase()}`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.audit().writes)).toBe(0);
}
async function watchOnly(page: Page) {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /private key|recovery phrase|hardware wallet/i })).toHaveCount(0);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') throw Error('Unexpected external request');
    await route.continue();
  });
});

test('SYS actual paste, full-address review, fixed scope, QR, copy/share and rename roundtrip', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?empty=1'); await form(page, 'Syscoin Mainnet');
  await page.evaluate((address) => navigator.clipboard.writeText(address), SYS.toUpperCase());
  const input = page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true });
  await input.focus(); await page.keyboard.press('ControlOrMeta+V'); await expect(input).toHaveValue(SYS.toUpperCase());
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await expect(page.getByLabel(`Review Syscoin Mainnet address ${SYS}`, { exact: true })).toBeVisible();
  await expect(page.getByText(/A public account key or descriptor includes/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sys-full-address-review.png'), fullPage: true });
  expect(await page.evaluate(() => window.__watchFixture.audit().writes)).toBe(0);
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Syscoin Mainnet confirmed balance 1.23456789 SYS', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pending balance change +0.00000123 SYS', { exact: true })).toBeVisible();
  await expect(page.getByText('Syscoin Mainnet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Network/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByRole('img', { name: `QR code for Syscoin Mainnet address ${SYS}` })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText('before-watch-copy'));
  await page.getByRole('button', { name: 'Copy address', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(SYS);
  await page.getByRole('button', { name: 'Share address', exact: true }).click();
  expect(await page.evaluate(() => window.__watchFixture.shares())).toEqual([`Syscoin Mainnet (SYS) address\n${SYS}`]);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 23px !important; line-height: 1.4 !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('sys-large-text-receive.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByText('Watch-only · Syscoin Mainnet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rename SYS savings watch', exact: true }).click();
  await page.getByRole('textbox', { name: 'Watch account name', exact: true }).fill('Renamed SYS');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Renamed SYS (watch-only)', exact: true })).toBeVisible();
  const accounts = await page.evaluate(() => window.__watchFixture.accounts());
  expect(accounts).toHaveLength(1); expect(accounts[0]!.addresses).toEqual({ syscoin: SYS });
  await page.reload(); await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByText('Renamed SYS · Watch-only', { exact: true })).toBeVisible(); await watchOnly(page);
});

test('BTC shows confirmed and negative pending separately without fiat or network switching', async ({ page }, testInfo) => {
  await page.goto('/?empty=1'); await form(page, 'Bitcoin'); await review(page, 'Bitcoin', BTC);
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Bitcoin confirmed balance 1.23456789 BTC', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pending balance change -0.00000456 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Incoming and outgoing transactions waiting for confirmation.', { exact: true })).toBeVisible();
  await expect(page.getByText(/\$|USD/)).toHaveCount(0); await expect(page.getByRole('button', { name: /^Network/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('btc-negative-pending.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false); await watchOnly(page);
});

test('Syscoin Testnet uses its own watch address, indexed history and explorer', async ({ page }, testInfo) => {
  const address = 'tsys1qw508d6qejxtdg4y5r3zarvary0c5xw7kn9mz8d';
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?empty=1'); await form(page, 'Syscoin Testnet');
  await page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true }).fill(SYS);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await review(page, 'Syscoin Testnet', address);
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Syscoin Testnet confirmed balance 1.23456789 tSYS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('20 transactions shown', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.activity.calls())).toEqual([
    'https://blockbook-dev.syscoin.org/api/v2/',
    'https://blockbook-dev.syscoin.org/api/v2/block-index/0',
    `https://blockbook-dev.syscoin.org/api/v2/address/${address}?details=txsummary&page=1&pageSize=20`,
  ]);
  await page.getByRole('button', { name: 'Net change −10.0 tSYS', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expect(page.getByText('Received by this account: 1.0 tSYS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open transaction in explorer', exact: true }).click();
  expect(await page.evaluate(() => window.__watchFixture.activity.opened())).toEqual([
    `https://explorer-blockbook-dev.syscoin.org/tx/${'1'.padStart(64, '0')}`,
  ]);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 23px !important; line-height: 1.4 !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('syscoin-testnet-activity-320.png'), fullPage: true });
});

test('known zero and unavailable remain distinct while Receive stays available offline', async ({ page }) => {
  await page.goto('/?empty=1'); await page.evaluate(() => window.__watchFixture.watchBalance('zero'));
  await form(page, 'Bitcoin'); await review(page, 'Bitcoin', BTC); await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Bitcoin confirmed balance 0.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pending balance change 0.0 BTC', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.watchBalance('error')); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByLabel('Balance unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pending balance change unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Bitcoin confirmed balance 0.0 BTC', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByLabel(`Bitcoin address ${BTC}`, { exact: true })).toBeVisible(); await watchOnly(page);
});

test('wrong-family input is rejected before save and choosing another network clears the address', async ({ page }) => {
  await page.goto('/?empty=1'); await form(page, 'Syscoin Mainnet');
  await page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true }).fill(BTC);
  await page.getByRole('button', { name: 'Review account', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.audit().writes)).toBe(0);
  await page.getByRole('button', { name: 'Bitcoin', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__watchFixture.events().filter((value) => value.startsWith('balance:')))).toEqual([]);
});

test('backgrounding the public review cannot save it or reveal private account controls', async ({ page }) => {
  await page.goto('/?empty=1'); await form(page, 'Bitcoin'); await review(page, 'Bitcoin', BTC);
  await page.evaluate(() => window.__watchFixture.lifecycle('background')); await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await expect(page.getByRole('button', { name: 'Confirm watch account', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.accounts())).toEqual([]); await watchOnly(page);
});

test('UTXO choices remain disabled when the host has not enabled them', async ({ page }) => {
  await page.goto('/?empty=1&disabled-utxo=1'); await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Syscoin Mainnet', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Bitcoin', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Syscoin Testnet', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'EVM networks', exact: true })).toBeEnabled();
});

test('public account key follows the real add, aggregate refresh, receive, rename and restart flow', async ({ page, context }, testInfo) => {
  const xpub = 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
  const firstAddress = 'bc1qalwlmdxd2ggue4290ekzxl9tetg56neexr6amw';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?empty=1'); await form(page, 'Bitcoin');
  await page.evaluate((value) => navigator.clipboard.writeText(value), xpub);
  const input = page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true });
  await input.focus(); await page.keyboard.press('ControlOrMeta+V'); await expect(input).toHaveValue(xpub);
  await expect(page.getByText(/IP address|shares this public/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your watch account', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('account-key-review-320.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Bitcoin confirmed balance 1.23456789 BTC', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.events().some((event) => event.startsWith('balance:bitcoin:zpub')))).toBe(true);
  expect(JSON.stringify(await page.evaluate(() => window.__watchFixture.accounts()))).not.toContain('pub6');
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByRole('img', { name: `QR code for Bitcoin address ${firstAddress}` })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Rename BTC savings watch', exact: true }).click();
  await page.getByRole('textbox', { name: 'Watch account name', exact: true }).fill('Public wallet');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByText('Public wallet · Watch-only', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.events().some((event) => event.startsWith('balance:bitcoin:zpub')))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('account-key-balance-320.png'), fullPage: true });
  await watchOnly(page);
});
