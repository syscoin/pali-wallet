import { enterPin } from '../ui/operationAuthentication';
import { test, expect, type Page } from '@playwright/test';
import { SENTRY_COLLATERAL_TXID, SENTRY_TXID } from '../sentryNodeFixtures';
const ID = (n: number) => n.toString(16).padStart(64, '0');
const activityRows = (page: Page, amount: string) => page.getByRole('button', {
  name: new RegExp(`^${amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `),
});
const copyTransaction = (page: Page) => page.getByRole('button', { name: /^Copy transaction ID: [a-f0-9]{64}$/ });
async function expandDetails(page: Page) {
  const details = page.getByRole('button', { name: 'Details', exact: true });
  if (await details.getAttribute('aria-expanded') !== 'true') await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
}
declare global {
  interface Window {
    __activityDelayedCopy: { calls: string[]; release(): void };
  }
}
async function delayClipboard(page: Page) {
  await page.evaluate(() => {
    const delayed = window.__activityDelayedCopy = { calls: [] as string[], release: () => undefined as void };
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (text: string) => {
      delayed.calls.push(text);
      return new Promise<void>(resolve => { delayed.release = resolve; });
    } });
  });
}
async function open(page: Page, network = 'bitcoin', android = false, mode = 'value') {
  await page.goto(`/?utxo-activity=${network}&activity-mode=${mode}${android ? '&android=1' : ''}`);
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
}
async function load(page: Page) {
  await expect(page.getByText('20 transactions shown', { exact: true })).toBeVisible();
}
const CONFIRMATION = 'Explorer reports a transaction now has confirmations.';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') { await route.abort(); throw Error('Unexpected live network request'); }
    await route.continue();
  });
});

test('actual WatchSession automatically loads account activity, preserves list and guards copy/link', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await expect(page.getByRole('button', { name: /Load confirmed/ })).toHaveCount(0);
  await expect(page.getByText(/Loading shares|One address|not a complete wallet history/)).toHaveCount(0);
  await load(page);
  const calls = await page.evaluate(() => window.__watchFixture.activity.calls());
  expect(calls.some(url => url.includes('details=txsummary&page=1&pageSize=20'))).toBe(true);
  expect(calls.some(url => /\/tx\//.test(url))).toBe(false);
  const row = activityRows(page, '−10.0 BTC').nth(5);
  await row.scrollIntoViewIfNeeded();
  const scroll = await page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop);
  await row.focus(); await row.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expandDetails(page);
  await expect(page.getByText('−9.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Received by this account: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Spent from this account: 11.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await copyTransaction(page).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ID(6));
  await page.getByRole('button', { name: 'View on explorer', exact: true }).click();
  expect(await page.evaluate(() => window.__watchFixture.activity.opened())).toEqual([`https://btc1.trezor.io/tx/${ID(6)}`]);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop)).toBe(scroll);
  const bottomRow = activityRows(page, '−10.0 BTC').last();
  await bottomRow.scrollIntoViewIfNeeded();
  await page.getByTestId('watch-activity-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const bottomScroll = await page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop);
  expect(bottomScroll).toBeGreaterThan(scroll);
  await bottomRow.focus(); await bottomRow.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expandDetails(page);
  await expect(activityRows(page, '−10.0 BTC')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh activity', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop)).toBe(bottomScroll);
  const beforeMore = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.getByRole('button', { name: 'Older activity', exact: true }).click();
  await expect(page.getByText('23 transactions shown', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBeGreaterThan(beforeMore);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const left = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await load(page);
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBeGreaterThanOrEqual(left);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
});

test('seeded UTXO Activity uses the shared list and detail at 320 pixels', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?hd-utxo-send=1');
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await enterPin(page, '123456');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await load(page);
  await expect(page.getByText('Account 1 · Bitcoin', { exact: true })).toBeVisible();
  const calls = () => page.evaluate(() => window.__watchFixture.activity.calls());
  expect((await calls()).some(url => /\/api\/v2\/tx\//.test(url))).toBe(false);
  const row = activityRows(page, '−10.0 BTC').first();
  await row.focus();
  await row.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expandDetails(page);
  await expect(page.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('12ZEw5Hcv1hTb6YUQJ69y1V7uhcoDz92PH', { exact: true }).last()).toBeVisible();
  expect((await calls()).filter(url => /\/api\/v2\/tx\//.test(url))).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('seeded-utxo-activity-detail-320.png') });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await load(page);
});

test('unavailable, empty, stale and asset amounts remain distinct', async ({ page }) => {
  await open(page, 'syscoin', false, 'error');
  await expect(page.getByText('Activity unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No activity yet', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.activity.mode('empty'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('No activity yet', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.activity.mode('asset'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(activityRows(page, 'Asset activity').first()).toBeVisible();
  await expect(page.getByText(/999999999|hostile/)).toHaveCount(0);
  await activityRows(page, 'Asset activity').first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByLabel('Asset amount unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Native account change: −10.0 SYS', { exact: true })).toBeVisible();
  await expect(detail.getByText('Whole transaction fee: 1.0 SYS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('error'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('Could not refresh activity', { exact: true })).toBeVisible();
  await expect(activityRows(page, 'Asset activity').first()).toBeVisible();
});

test('an explicit watch refresh shows one quiet confirmation result without extra reads', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await open(page, 'bitcoin', false, 'pending');
  await load(page);
  const feedback = page.getByRole('status').getByText(CONFIRMATION, { exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh activity', exact: true });
  const calls = () => page.evaluate(() => window.__watchFixture.activity.calls());
  const firstPage = await calls();
  await expect(page.getByTestId(`watch-activity-row-${ID(1)}`)).toHaveAccessibleName(/^−10\.0 BTC, Pending\./);
  await expect(feedback).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.activity.mode('value'));
  await refresh.click();
  await expect(feedback).toHaveCount(1);
  await expect(feedback).toBeVisible();
  await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect((await calls()).slice(firstPage.length)).toEqual(firstPage);
  await page.screenshot({ path: testInfo.outputPath('watch-confirmation-320.png') });
  await page.addStyleTag({ content: '[data-testid="watch-activity-list"] [dir="auto"] { font-size: 22px !important; line-height: 1.45 !important; }' });
  await expect(feedback).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('watch-confirmation-320-large-text.png') });

  await refresh.click();
  await expect(feedback).toHaveCount(0);
  await expect(refresh).toBeEnabled();
  expect((await calls()).slice(firstPage.length * 2)).toEqual(firstPage);

  await page.evaluate(() => window.__watchFixture.activity.mode('pending'));
  await refresh.click();
  await expect(page.getByTestId(`watch-activity-row-${ID(1)}`)).toHaveAccessibleName(/^−10\.0 BTC, Pending\./);
  await page.evaluate(() => window.__watchFixture.activity.mode('error'));
  await refresh.click();
  await expect(page.getByText('Could not refresh activity', { exact: true })).toBeVisible();
  await expect(feedback).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.activity.mode('value'));
  await refresh.click();
  await expect(page.getByTestId(`watch-activity-row-${ID(1)}`)).toHaveAccessibleName(/^−10\.0 BTC, 11 confirmations · Block 190\./);
  await expect(feedback).toHaveCount(0);
});

test('leaving and reopening the same watch Activity cannot publish a late confirmation', async ({ page }) => {
  await open(page, 'bitcoin', true, 'pending');
  await load(page);
  const feedback = page.getByRole('status').getByText(CONFIRMATION, { exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh activity', exact: true });
  const row = page.getByTestId(`watch-activity-row-${ID(1)}`);
  await page.evaluate(() => window.__watchFixture.activity.mode('late'));
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.activity.calls().filter(url => url.includes('/address/')).length)).toBe(2);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.activity.mode('value'));
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(row).toHaveAccessibleName(/^−10\.0 BTC, 11 confirmations · Block 190\./);
  await page.evaluate(() => window.__watchFixture.activity.release());
  await expect.poll(() => page.evaluate(() => window.__watchFixture.activity.lateResponses())).toBe(1);
  await expect(feedback).toHaveCount(0);

  await page.evaluate(() => window.__watchFixture.activity.mode('pending'));
  await refresh.click();
  await expect(row).toHaveAccessibleName(/^−10\.0 BTC, Pending\./);
  await page.evaluate(() => window.__watchFixture.activity.mode('value'));
  await refresh.click();
  await expect(feedback).toBeVisible();
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(page.getByRole('button', { name: 'View my accounts', exact: true })).toBeVisible();
  await expect(feedback).toHaveCount(0);
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(row).toHaveAccessibleName(/^−10\.0 BTC, 11 confirmations · Block 190\./);
  await expect(feedback).toHaveCount(0);
});

test('leaving a slow request and Android focus loss revoke the active account history', async ({ page }) => {
  await open(page, 'bitcoin', true); await load(page);
  await page.evaluate(() => window.__watchFixture.activity.mode('slow'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByLabel('Loading activity', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.activity.cancelled())).toBeGreaterThan(0);
  await page.evaluate(() => window.__watchFixture.activity.release());
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await load(page);
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(page.getByRole('button', { name: 'View my accounts', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(activityRows(page, '−10.0 BTC')).toHaveCount(0);
  const blurred = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBe(blurred);
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await load(page);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
});

test('narrow and scaled text keeps the active activity and detail usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 }); await open(page); await load(page);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 22px !important; line-height: 1.45 !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-list-large-text.png'), fullPage: true });
  await activityRows(page, '−10.0 BTC').first().click();
  await expect(copyTransaction(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-large-text.png'), fullPage: true });
  const explorer = page.getByRole('button', { name: 'View on explorer', exact: true });
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer).toBeInViewport();
  await expect(copyTransaction(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-actions-large-text.png'), fullPage: true });
});

test('pending copy completion stays bound to its transaction after detail navigation', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page); await load(page); await delayClipboard(page);
  await activityRows(page, '−10.0 BTC').first().click();
  await copyTransaction(page).click();
  expect(await page.evaluate(() => window.__activityDelayedCopy.calls)).toEqual([ID(1)]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await activityRows(page, '−10.0 BTC').nth(1).click();
  const copy = copyTransaction(page);
  // The old native action may still be draining; do not overlap clipboard writes.
  await expect(copy).toBeDisabled();
  await page.evaluate(() => window.__activityDelayedCopy.release());
  await expect(copy).toBeEnabled();
  await expect(page.getByText('Transaction ID copied.', { exact: true })).toHaveCount(0);
  await copy.click();
  expect(await page.evaluate(() => window.__activityDelayedCopy.calls)).toEqual([ID(1), ID(2)]);
  await page.evaluate(() => window.__activityDelayedCopy.release());
  await expect(page.getByText('Transaction ID copied.', { exact: true })).toBeVisible();
});

test('pending copy drains and releases actions after refreshing the list', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page); await load(page); await delayClipboard(page);
  await activityRows(page, '−10.0 BTC').first().click();
  await copyTransaction(page).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__activityDelayedCopy.release());
  await activityRows(page, '−10.0 BTC').nth(1).click();
  await expect(copyTransaction(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'View on explorer', exact: true })).toBeEnabled();
  await expect(page.getByText('Transaction ID copied.', { exact: true })).toHaveCount(0);
  await copyTransaction(page).click();
  expect(await page.evaluate(() => window.__activityDelayedCopy.calls)).toEqual([ID(1), ID(2)]);
  await page.evaluate(() => window.__activityDelayedCopy.release());
  await expect(page.getByText('Transaction ID copied.', { exact: true })).toBeVisible();
});


test('pending placement and unknown account amounts are ordinary activity states', async ({ page }) => {
  await open(page, 'bitcoin', false, 'pending'); await load(page);
  await activityRows(page, '−10.0 BTC').first().click();
  let detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('Pending', { exact: true }).last()).toBeVisible();
  await expect(detail.getByText(/Block time:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('included'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByTestId(`watch-activity-row-${ID(1)}`)).toHaveAccessibleName(/^−10\.0 BTC, 0 confirmations · Block 190\./);
  await activityRows(page, '−10.0 BTC').first().click();
  detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('0 confirmations · Block 190', { exact: true }).last()).toBeVisible();
  await expect(detail.getByText('Pending', { exact: true }).last()).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('unknown'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await activityRows(page, 'Unavailable').first().click();
  detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('Native account change: Unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Received by this account: Unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(detail.getByText(/NaN|undefined/)).toHaveCount(0);
});

test('100-row window navigates older and newer without an arbitrary end-of-history claim', async ({ page }) => {
  await open(page, 'bitcoin', false, 'window'); await load(page);
  const list = page.getByTestId('watch-activity-list');
  const clickPage = async (direction: 'Older' | 'Newer', lastRow: number) => {
    const button = page.getByRole('button', { name: `${direction} activity`, exact: true });
    // The virtualized footer can move when an automatic scroll measures more rows.
    // Reach the last loaded row and footer together before sending the pointer click.
    await expect(async () => {
      await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(list.getByTestId(`watch-activity-row-${ID(lastRow)}`)).toBeInViewport({ timeout: 250 });
      await expect(button).toBeInViewport({ timeout: 250 });
    }).toPass({ timeout: 5000 });
    await button.click();
  };
  for (const count of [40, 60, 80, 100]) {
    await clickPage('Older', count - 20);
    await expect(page.getByText(new RegExp(`^${count} transactions shown`))).toBeVisible();
  }
  await clickPage('Older', 100);
  await expect(page.getByText('100 transactions shown · Pages 2–6', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Newer activity', exact: true })).toBeVisible();
  await expect(page.getByText(/display limit|complete history/)).toHaveCount(0);
  await clickPage('Newer', 120);
  await expect(page.getByText(/^100 transactions shown/)).toBeVisible();
  await expect(page.getByTestId(`watch-activity-row-${ID(1)}`)).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.activity.calls())).some(url => url.includes('page=6&pageSize=20'))).toBe(true);
});

test('a pasted public account key loads account-wide history without exposing the key', async ({ page, context }) => {
  const xpub = 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?empty=1');
  await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await page.getByRole('button', { name: 'Bitcoin', exact: true }).click();
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('BTC account history');
  await page.evaluate(value => navigator.clipboard.writeText(value), xpub);
  const input = page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true });
  await input.focus(); await page.keyboard.press('ControlOrMeta+V');
  await expect(input).toHaveValue(xpub);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Bitcoin confirmed balance 1.23456789 BTC', { exact: true })).toBeVisible();
  const canonical = (await page.evaluate(() => window.__watchFixture.events())).find(event => event.startsWith('balance:bitcoin:zpub'))?.slice('balance:bitcoin:'.length);
  expect(canonical).toBeDefined();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await load(page);
  const calls = await page.evaluate(() => window.__watchFixture.activity.calls());
  expect(calls.some(url => url.includes(`/xpub/${encodeURIComponent(canonical!)}`) && url.includes('details=txsummary&page=1&pageSize=20'))).toBe(true);
  expect(calls.some(url => /\/address\/|\/tx\//.test(url))).toBe(false);
  expect(await page.locator('body').innerText()).not.toMatch(/(?:xpub|zpub|wpkh\()/);
  expect(JSON.stringify(await page.evaluate(() => window.__watchFixture.accounts()))).not.toContain('pub6');
  await activityRows(page, '−10.0 BTC').first().click();
  await expandDetails(page);
  await expect(page.getByText('BTC account history', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/(?:xpub|zpub|wpkh\()/);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
});


test('SPT account quantity stays exact and list reads do not request transaction bodies', async ({ page }, testInfo) => {
  await open(page, 'syscoin', false, 'asset-exact'); await load(page);
  const title = '9007199254740993 BIG';
  expect((await page.evaluate(() => window.__watchFixture.activity.calls())).filter(url => /\/tx\//.test(url))).toEqual([]);
  await expect(activityRows(page, title).first()).toBeVisible();
  await activityRows(page, title).first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText(title, { exact: true })).toBeVisible();
  await expect(detail.getByText('Account asset amount', { exact: true })).toBeVisible();
  await expect(detail.getByText('987654321', { exact: true })).toBeVisible();
  await expect(detail.getByText('Native account change: −10.0 SYS', { exact: true })).toBeVisible();
  await expect(detail.getByText('Whole transaction fee: 1.0 SYS', { exact: true })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__watchFixture.activity.calls())).filter(url => /\/tx\//.test(url)).length).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('spt-account-exact.png'), fullPage: true });
});

test('SPT one-atom direction and full bridge operation come from shared interpretation', async ({ page }) => {
  await open(page, 'syscoin', false, 'asset-owned'); await load(page);
  await activityRows(page, '+0.00000001 ATOM').first().click();
  await expect(page.getByTestId('watch-activity-detail').getByLabel('+0.00000001 ATOM', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('asset-bridge'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  // Distinct transaction bodies have distinct hashes; the old rows remain visible.
  await expect(page.getByText('40 transactions shown', { exact: true })).toBeVisible();
  await activityRows(page, '9007199254740993 BIG').first().click();
  await expandDetails(page);
  await expect(page.getByTestId('watch-activity-detail').getByText('Asset operation amount', { exact: true })).toBeVisible();
  await expect(page.getByTestId('watch-activity-detail').getByText('9007199254740994 BIG', { exact: true })).toBeVisible();
  await expect(page.getByTestId('watch-activity-detail').getByText('TO', { exact: true })).toHaveCount(0);
});

test('SPT unavailable quantity and unsafe optional metadata never substitute or echo funding', async ({ page }) => {
  await open(page, 'syscoin', false, 'asset-invalid'); await load(page);
  await activityRows(page, 'Asset activity').first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByLabel('Asset amount unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Native account change: −10.0 SYS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('asset-hostile'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  // Distinct transaction bodies have distinct hashes; the old rows remain visible.
  await expect(page.getByText('40 transactions shown', { exact: true })).toBeVisible();
  await activityRows(page, '9007199254740993 SPT').first().click();
  await expandDetails(page);
  expect(await page.locator('body').innerText()).not.toMatch(/SPOOF|provider-metadata|\u202e/);
  await expect(detail.getByText('ASSET ID', { exact: true })).toHaveCount(0);
});

test('exact SPT quantity remains readable at 320px with scaled text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await open(page, 'syscoin', false, 'asset-exact'); await load(page);
  // Match native Dynamic Type body scaling and the existing 1.25x caption cap.
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 24px !important; line-height: 1.4 !important; } [data-testid^="main-tab-caption-"] { font-size: 15px !important; line-height: 21.25px !important; }' });
  for (const tab of await page.getByRole('tablist', { name: 'Main navigation', exact: true }).getByRole('tab').all()) {
    const box = await tab.boundingBox(); expect(box?.width).toBeGreaterThanOrEqual(44); expect(box?.height).toBeGreaterThanOrEqual(44);
    const caption = tab.locator('[data-testid^="main-tab-caption-"]');
    const width = await caption.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return { full: range.getBoundingClientRect().width, box: element.getBoundingClientRect().width };
    });
    expect(width.full).toBeLessThanOrEqual(width.box + 1);
  }
  await page.screenshot({ path: testInfo.outputPath('spt-account-list-320-large.png'), fullPage: true });
  await activityRows(page, '9007199254740993 BIG').first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('9007199254740993 BIG', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('spt-account-320-large.png'), fullPage: true });
  await detail.getByText('Whole transaction fee: 1.0 SYS', { exact: true }).scrollIntoViewIfNeeded();
  await copyTransaction(page).scrollIntoViewIfNeeded();
  await expect(copyTransaction(page)).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(activityRows(page, '9007199254740993 BIG').first()).toBeVisible();
});


test('exact 78-digit SPT quantity remains accessible with bounded summaries and full details at large text', async ({ page }, testInfo) => {
  const quantity = '9'.repeat(78) + ' BIG';
  const compactQuantity = '≈9.99999e+77 BIG';
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page, 'syscoin', false, 'asset-max'); await load(page);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 24px !important; line-height: 1.4 !important; } [data-testid^="main-tab-caption-"] { font-size: 15px !important; line-height: 21.25px !important; }' });
  const row = activityRows(page, quantity).first();
  const measure = async (element: ReturnType<Page['locator']>) => element.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const outer = node.closest('[role="button"]') ?? node;
    const box = outer.getBoundingClientRect();
    return { text: node.textContent, left: box.left, right: box.right,
      rects: Array.from(range.getClientRects()).map(rect => ({ left: rect.left, right: rect.right })) };
  });
  const assertInside = (value: Awaited<ReturnType<typeof measure>>, text: string) => {
    expect(value.text).toBe(text);
    expect(value.left).toBeGreaterThanOrEqual(0); expect(value.right).toBeLessThanOrEqual(320);
    for (const rect of value.rects) { expect(rect.left).toBeGreaterThanOrEqual(value.left - 1); expect(rect.right).toBeLessThanOrEqual(value.right + 1); }
  };
  await page.screenshot({ path: testInfo.outputPath('spt-78-list.png'), fullPage: true });
  await expect(row).toHaveAccessibleName(new RegExp(`^${'9'.repeat(78)} BIG, `));
  assertInside(await measure(row.getByText(compactQuantity, { exact: true })), compactQuantity);
  await row.click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByLabel(quantity, { exact: true })).toBeVisible();
  assertInside(await measure(detail.getByText(quantity, { exact: true })), quantity);
  await page.screenshot({ path: testInfo.outputPath('spt-78-detail.png'), fullPage: true });
  const copy = copyTransaction(page);
  await copy.scrollIntoViewIfNeeded(); await expect(copy).toBeInViewport();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(row).toBeVisible();
});

test('selected details hydrate participants once and reuse the shared warm cache', async ({ page }) => {
  await open(page); await load(page);
  const rawCalls = () => page.evaluate(() => window.__watchFixture.activity.calls().filter(url => /\/api\/v2\/tx\//.test(url)).length);
  expect(await rawCalls()).toBe(0);
  const first = activityRows(page, '−10.0 BTC').first();
  await first.click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('FROM', { exact: true })).toBeVisible();
  await expect(detail.getByText('TO', { exact: true })).toBeVisible();
  await expect(detail.getByText('Native account change: −10.0 BTC', { exact: true })).toBeVisible();
  expect(await rawCalls()).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await first.click();
  await expandDetails(page);
  await expect(detail.getByText('FROM', { exact: true })).toBeVisible();
  expect(await rawCalls()).toBe(1);
});

test('failed detail preserves compact facts and explicit retry succeeds', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page); await load(page);
  await page.evaluate(() => window.__watchFixture.activity.detail('error'));
  await activityRows(page, '−10.0 BTC').first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('Couldn’t load full details.', { exact: true })).toBeVisible();
  await expect(detail.getByText('−9.0 BTC', { exact: true })).toBeVisible();
  await expect(detail.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('utxo-detail-unavailable-320.png'), fullPage: true });
  await page.evaluate(() => window.__watchFixture.activity.detail('value'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(detail.getByText('FROM', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.__watchFixture.activity.calls())).filter(url => /\/api\/v2\/tx\//.test(url))).toHaveLength(2);
});

test('Back cancels only selected detail work and a fresh reorg observation may become pending', async ({ page }, testInfo) => {
  await open(page); await load(page);
  await page.evaluate(() => window.__watchFixture.activity.detail('slow'));
  await activityRows(page, '−10.0 BTC').first().click();
  await expect(page.getByLabel('Loading transaction details', { exact: true })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__watchFixture.activity.calls())).filter(url => /\/api\/v2\/tx\//.test(url)).length).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('utxo-detail-loading.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.activity.cancelled())).toBe(1);
  await load(page);
  await page.evaluate(() => window.__watchFixture.activity.detail('reorg'));
  await activityRows(page, '−10.0 BTC').first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expandDetails(page);
  await expect(detail.getByText('Pending', { exact: true }).last()).toBeVisible();
  await expect(detail.getByText(/Block time:/)).toHaveCount(0);
  await expect(detail.getByText('Native account change: −10.0 BTC', { exact: true })).toBeVisible();
});

for (const initiallyPending of [false, true]) test(`reopening keeps the detail observation from an unchanged ${initiallyPending ? 'pending' : 'confirmed'} summary`, async ({ page }) => {
  await open(page, 'bitcoin', false, initiallyPending ? 'pending' : 'value');
  await load(page);
  const row = page.getByTestId(`watch-activity-row-${ID(1)}`);
  const details = row;
  const detail = page.getByTestId('watch-activity-detail');
  const rawCalls = () => page.evaluate(() => window.__watchFixture.activity.calls().filter(url => /\/api\/v2\/tx\//.test(url)).length);
  await page.evaluate(pending => {
    window.__watchFixture.activity.mode('value');
    window.__watchFixture.activity.detail(pending ? 'value' : 'reorg');
  }, initiallyPending);
  const status = initiallyPending ? '11 confirmations · Block 190' : 'Pending';
  await details.click();
  await expandDetails(page);
  await expect(detail.getByText('FROM', { exact: true })).toBeVisible();
  await expect(detail.getByText(status, { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await details.click();
  await expandDetails(page);
  await expect(detail.getByText('FROM', { exact: true })).toBeVisible();
  await expect(detail.getByText(status, { exact: true }).last()).toBeVisible();
  expect(await rawCalls()).toBe(1);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(pending => window.__watchFixture.activity.mode(pending ? 'pending' : 'value'), initiallyPending);
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await load(page);
  await details.click();
  await expandDetails(page);
  await expect(detail.getByText('FROM', { exact: true })).toBeVisible();
  await expect(detail.getByText(initiallyPending ? 'Pending' : '11 confirmations · Block 190', { exact: true }).last()).toBeVisible();
  expect(await rawCalls()).toBe(1);
});

test('narrow Syscoin detail only looks up Sentry information after an explicit tap', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await open(page, 'syscoin', false, 'sentry');
  await load(page);
  const calls = () => page.evaluate(() => window.__watchFixture.activity.calls().filter(url => url.includes('/api/sentry/')));
  await page.getByTestId(`watch-activity-row-${SENTRY_TXID}`).click();
  await expandDetails(page);
  const lookup = page.getByRole('button', { name: 'Look up Sentry node', exact: true });
  await expect(lookup).toBeVisible();
  expect(await calls()).toEqual([]);
  await lookup.click();
  await expect(page.getByRole('heading', { name: 'Sentry node information', exact: true })).toBeVisible();
  await expect(page.getByText('Reported by https://sysnode.info', { exact: true })).toBeVisible();
  const outpoint = page.getByText(`${SENTRY_COLLATERAL_TXID}:1`, { exact: true });
  await outpoint.scrollIntoViewIfNeeded();
  await expect(outpoint).toBeInViewport();
  expect(await calls()).toEqual([`https://sysnode.info/api/sentry/v1/context?network=mainnet&proTxHash=${SENTRY_TXID}`]);
  await expect(page.getByRole('button', { name: /link|reserve|sign/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sentry-node-information-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(lookup).toHaveCount(0);
});
