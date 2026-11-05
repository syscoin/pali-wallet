import { test, expect, type Page } from '@playwright/test';
const ID = (n: number) => n.toString(16).padStart(64, '0');
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
  const row = page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).nth(5);
  await row.scrollIntoViewIfNeeded();
  const scroll = await page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop);
  await row.focus(); await row.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expect(page.getByText('−9.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Received by this account: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Spent from this account: 11.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy transaction ID', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ID(6));
  await page.getByRole('button', { name: 'Open transaction in explorer', exact: true }).click();
  expect(await page.evaluate(() => window.__watchFixture.activity.opened())).toEqual([`https://blockbook.btc.zelcore.io/tx/${ID(6)}`]);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop)).toBe(scroll);
  const bottomRow = page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).last();
  await bottomRow.scrollIntoViewIfNeeded();
  await page.getByTestId('watch-activity-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const bottomScroll = await page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop);
  expect(bottomScroll).toBeGreaterThan(scroll);
  await bottomRow.focus(); await bottomRow.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true })).toHaveCount(0);
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

test('unavailable, empty, stale and asset amounts remain distinct', async ({ page }) => {
  await open(page, 'syscoin', false, 'error');
  await expect(page.getByText('Activity unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No activity yet', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.activity.mode('empty'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('No activity yet', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.activity.mode('asset'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Asset activity', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Native account change: −10.0 SYS', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/999999999|hostile/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Asset activity', exact: true }).first().click();
  const detail = page.getByTestId('watch-activity-detail');
  await expect(detail.getByText('Asset amount unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Whole transaction fee: 1.0 SYS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('error'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('Could not refresh activity', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Asset activity', exact: true }).first()).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Copy transaction ID', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-large-text.png'), fullPage: true });
  const explorer = page.getByRole('button', { name: 'Open transaction in explorer', exact: true });
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Copy transaction ID', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-actions-large-text.png'), fullPage: true });
});

test('pending copy completion stays bound to its transaction after detail navigation', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page); await load(page); await delayClipboard(page);
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  await page.getByRole('button', { name: 'Copy transaction ID', exact: true }).click();
  expect(await page.evaluate(() => window.__activityDelayedCopy.calls)).toEqual([ID(1)]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).nth(1).click();
  const copy = page.getByRole('button', { name: 'Copy transaction ID', exact: true });
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
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  await page.getByRole('button', { name: 'Copy transaction ID', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__activityDelayedCopy.release());
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).nth(1).click();
  await expect(page.getByRole('button', { name: 'Copy transaction ID', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open transaction in explorer', exact: true })).toBeEnabled();
  await expect(page.getByText('Transaction ID copied.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy transaction ID', exact: true }).click();
  expect(await page.evaluate(() => window.__activityDelayedCopy.calls)).toEqual([ID(1), ID(2)]);
  await page.evaluate(() => window.__activityDelayedCopy.release());
  await expect(page.getByText('Transaction ID copied.', { exact: true })).toBeVisible();
});


test('pending placement and unknown account amounts are ordinary activity states', async ({ page }) => {
  await open(page, 'bitcoin', false, 'pending'); await load(page);
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  let detail = page.getByTestId('watch-activity-detail');
  await expect(detail.getByText('Pending', { exact: true })).toBeVisible();
  await expect(detail.getByText(/Block time:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('included'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('0 confirmations · Block 190', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  detail = page.getByTestId('watch-activity-detail');
  await expect(detail.getByText('0 confirmations · Block 190', { exact: true })).toBeVisible();
  await expect(detail.getByText('Pending', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.mode('unknown'));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await page.getByRole('button', { name: 'Amount unavailable', exact: true }).first().click();
  detail = page.getByTestId('watch-activity-detail');
  await expect(detail.getByText('Native account change: Unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Received by this account: Unavailable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(detail.getByText(/NaN|undefined/)).toHaveCount(0);
});

test('100-row window navigates older and newer without an arbitrary end-of-history claim', async ({ page }) => {
  await open(page, 'bitcoin', false, 'window'); await load(page);
  for (const count of [40, 60, 80, 100]) {
    await page.getByRole('button', { name: 'Older activity', exact: true }).click();
    await expect(page.getByText(new RegExp(`^${count} transactions shown`))).toBeVisible();
  }
  await page.getByRole('button', { name: 'Older activity', exact: true }).click();
  await expect(page.getByText('100 transactions shown · Pages 2–6', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Newer activity', exact: true })).toBeVisible();
  await expect(page.getByText(/display limit|complete history/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Newer activity', exact: true }).click();
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
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  await expect(page.getByText('BTC account history', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/(?:xpub|zpub|wpkh\()/);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
});
