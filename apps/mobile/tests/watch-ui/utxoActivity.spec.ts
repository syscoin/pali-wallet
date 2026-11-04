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
async function open(page: Page, network = 'bitcoin') {
  await page.goto(`/?utxo-activity=${network}`);
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load confirmed activity', exact: true })).toBeVisible();
}
async function load(page: Page) {
  await page.getByRole('button', { name: 'Load confirmed activity', exact: true }).click();
  await expect(page.getByText('20 loaded transactions. Amounts are changes to this address, not your entire wallet.', { exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182') { await route.abort(); throw Error('Unexpected live network request'); }
    await route.continue();
  });
});

test('actual WatchSession requires consent, loads exact native change and details, preserves list, guards copy/link', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  expect(await page.evaluate(() => window.__watchFixture.activity.calls())).toEqual([]);
  await expect(page.getByText(/Loading shares this address and your IP address with blockbook.btc.zelcore.io/)).toBeVisible();
  await load(page);
  const calls = await page.evaluate(() => window.__watchFixture.activity.calls());
  expect(calls[0]).toBe('https://blockbook.btc.zelcore.io/api/');
  expect(calls[3]).toContain('details=txids&pageSize=20&page=1&to=200');
  const row = page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).nth(5);
  await row.scrollIntoViewIfNeeded();
  const scroll = await page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop);
  await row.click();
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expect(page.getByText('Received by this address: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Spent from this address: 11.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Whole transaction fee: 1.0 BTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy transaction ID', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ID(6));
  await page.getByRole('button', { name: 'Open transaction in explorer', exact: true }).click();
  expect(await page.evaluate(() => window.__watchFixture.activity.opened())).toEqual([`https://blockbook.btc.zelcore.io/tx/${ID(6)}`]);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.getByTestId('watch-activity-list').evaluate(element => element.scrollTop)).toBe(scroll);
  const beforeMore = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.getByRole('button', { name: 'Load older confirmed activity', exact: true }).click();
  await expect(page.getByText('23 loaded transactions. Amounts are changes to this address, not your entire wallet.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBeGreaterThan(beforeMore);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const left = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load confirmed activity', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBe(left);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(0); expect(audit.signs).toBe(0); expect(audit.broadcasts).toBe(0);
});

test('unavailable, empty and stale views remain distinct; SYS asset data is not displayed as native value', async ({ page }) => {
  await open(page, 'syscoin');
  await page.evaluate(() => window.__watchFixture.activity.mode('error'));
  await page.getByRole('button', { name: 'Load confirmed activity', exact: true }).click();
  await expect(page.getByText('Activity unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No confirmed activity in the loaded range', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.activity.mode('empty'));
  await page.getByRole('button', { name: 'Try loading again', exact: true }).click();
  await expect(page.getByText('No confirmed activity in the loaded range', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.activity.mode('asset'));
  await page.getByRole('button', { name: 'Refresh confirmed activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Net change −10.0 SYS', exact: true }).first()).toBeVisible();
  await expect(page.getByText(/999999999|hostile/)).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.activity.mode('error'));
  await page.getByRole('button', { name: 'Refresh confirmed activity', exact: true }).click();
  await expect(page.getByText('Saved view is out of date', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Net change −10.0 SYS', exact: true }).first()).toBeVisible();
});

test('leaving a slow request and Android focus loss revoke consent without automatic return requests', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__watchFixture.activity.mode('slow'));
  await page.getByRole('button', { name: 'Load confirmed activity', exact: true }).click();
  await expect(page.getByLabel('Loading confirmed activity', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.activity.calls().some(p => p.includes('/address/')))).toBe(true);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.evaluate(() => window.__watchFixture.activity.release());
  const left = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load confirmed activity', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBe(left);
  await load(page);
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(page.getByRole('button', { name: 'Load confirmed activity', exact: true })).toBeVisible();
  const blurred = await page.evaluate(() => window.__watchFixture.activity.calls().length);
  await page.getByRole('button', { name: 'Load confirmed activity', exact: true }).click();
  expect(await page.evaluate(() => window.__watchFixture.activity.calls().length)).toBe(blurred);
});

test('narrow and scaled text keeps the active activity and detail usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 }); await open(page); await load(page);
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 22px !important; line-height: 1.45 !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.getByRole('button', { name: 'Net change −10.0 BTC', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Copy transaction ID', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('btc-watch-activity-large-text.png'), fullPage: true });
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
  await page.getByRole('button', { name: 'Refresh confirmed activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh confirmed activity', exact: true })).toBeEnabled();
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
