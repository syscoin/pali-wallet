import { test, expect } from '@playwright/test';
const hash = `0x${'aa'.repeat(32)}`;
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => new URL(route.request().url()).origin === 'http://127.0.0.1:4181' ? route.continue() : route.abort('blockedbyclient'));
});
test('all-network Activity shows newest first, network badges and full accessible amounts', async ({ page }) => {
  await page.goto('/?all-networks=1');
  const rows = page.locator('[data-testid^="account-activity-row-"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-testid', `account-activity-row-base-${hash}`);
  await expect(rows.nth(1)).toHaveAccessibleName(/1\.23456789 ETH, Confirmed.*Network: Ethereum/);
  await expect(rows.nth(0).getByText('Base', { exact: true })).toBeVisible();
  await expect(rows.nth(0).getByTestId('activity-network-icon-base')).toBeVisible();
  await expect(rows.nth(1).getByTestId('activity-network-icon-ethereum')).toBeVisible();
  for (const tab of ['wallet', 'activity', 'tools', 'settings']) await expect(page.getByTestId(`main-tab-caption-${tab}`)).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/pali-all-activity-390.png', fullPage: true });
});
test('same transaction hash opens only its selected network child and Back returns to the aggregate', async ({ page }) => {
  await page.goto('/?all-networks=1');
  await page.getByTestId(`account-activity-row-base-${hash}`).click();
  await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible();
  await expect(page.getByTestId('main-tab-caption-activity')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__allActivityFixture.inspections())).toEqual(['base']);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByTestId('main-tab-caption-activity')).toBeInViewport();
  await expect(page.locator('[data-testid^="account-activity-row-"]')).toHaveCount(2);
});
test('concrete and direction filters stay scoped, and hidden balances do not leak through labels', async ({ page }) => {
  await page.goto('/?all-networks=1');
  await page.getByRole('tablist', { name: 'Activity filter' }).getByRole('tab', { name: 'Received', exact: true }).click();
  await expect(page.locator('[data-testid^="account-activity-row-"]')).toHaveCount(1);
  await page.getByRole('tablist', { name: 'Activity filter' }).getByRole('tab', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Activity network: All networks' }).click();
  await page.getByRole('radio', { name: /^Ethereum/ }).click();
  await expect(page.getByTestId('activity-filter-icon-ethereum')).toBeVisible();
  await expect(page.getByTestId(`account-activity-row-base-${hash}`)).toHaveCount(0);
  await expect(page.getByTestId(`account-activity-row-ethereum-${hash}`).getByText('Ethereum', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('activity-network-icon-ethereum')).toHaveCount(0);
  await page.evaluate(() => window.__allActivityFixture.hideBalances(true));
  await expect(page.getByTestId(`account-activity-row-ethereum-${hash}`)).toHaveAccessibleName(/^Amount hidden, Confirmed/);
});

test('network icons and badges stay within a 320px Activity layout', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?all-networks=1');
  await expect(page.getByTestId('activity-network-icon-base')).toBeVisible();
  await expect(page.getByTestId('activity-network-icon-ethereum')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('activity-network-icons-320.png'), animations: 'disabled' });
});
test('an explicit cross-network target is resolved by network and hash even under a concrete filter', async ({ page }) => {
  await page.goto('/?all-networks=1&filter=ethereum&target=base');
  await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__allActivityFixture.inspections())).toEqual(['base']);
});

test('an explicit target opens even when the direction filter excludes its row', async ({ page }) => {
  await page.goto('/?all-networks=1&direction=received&target=base');
  await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__allActivityFixture.inspections())).toEqual(['base']);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('[data-testid^="account-activity-row-"]')).toHaveCount(1);
  await expect(page.getByTestId(`account-activity-row-ethereum-${hash}`)).toBeVisible();
});

for (const width of [390, 320]) test(`saved pending keeps older inventory and review bound to its chosen network at ${width}px`, async ({ page }, info) => {
  const olderHash = '0x' + 'cc'.repeat(32), nextHash = '0x' + 'dd'.repeat(32);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
  await page.goto('/?all-networks=1');
  await expect(page.getByTestId(`account-activity-row-base-${olderHash}`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await expect(page.getByTestId('network-source-sheet')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('radio')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath(`saved-pending-networks-${width}.png`), animations: 'disabled' });
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved pending', exact: true })).toBeVisible();
  await expect(page.getByText('Public test account · Base', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`activity-row-${olderHash}`)).toBeVisible();
  expect(await page.evaluate(() => window.__allActivityFixture.savedLoads())).toEqual(['base:0']);
  await page.screenshot({ path: info.outputPath(`saved-pending-inventory-${width}.png`), animations: 'disabled' });
  await page.getByRole('button', { name: 'Load more saved transfers', exact: true }).click();
  await expect(page.getByTestId(`activity-row-${nextHash}`)).toBeVisible();
  await page.getByTestId(`activity-row-${olderHash}`).click();
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review resend', exact: true }).click();
  expect(await page.evaluate(() => window.__allActivityFixture.actions())).toEqual([`base:saved:${olderHash}`]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved pending', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activity network: All networks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await page.getByRole('radio', { name: 'Ethereum, ETH', exact: true }).click();
  await page.getByTestId(`activity-row-${olderHash}`).click();
  await page.getByRole('button', { name: 'Review resend', exact: true }).click();
  expect(await page.evaluate(() => window.__allActivityFixture.actions())).toEqual([`base:saved:${olderHash}`, `ethereum:saved:${olderHash}`]);
});

test('a concrete Activity filter opens only its saved inventory without another network choice', async ({ page }) => {
  await page.goto('/?all-networks=1&filter=ethereum');
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved pending', exact: true })).toBeVisible();
  await expect(page.getByTestId('network-source-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => window.__allActivityFixture.savedLoads())).toEqual(['ethereum:0']);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activity network: Ethereum', exact: true })).toBeVisible();
});

test('scoped pending actions navigate through the selected network host', async ({ page }) => {
  const olderHash = '0x' + 'cc'.repeat(32);
  await page.goto('/?all-networks=1&pending=1');
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await page.getByTestId(`activity-row-${olderHash}`).click();
  await page.getByRole('button', { name: 'Speed Up', exact: true }).click();
  await page.getByRole('button', { name: 'Review resend', exact: true }).click();
  expect(await page.evaluate(() => window.__allActivityFixture.actions())).toEqual([`base:speed-up:${olderHash}`, `base:saved:${olderHash}`]);
});

test('returning from a detail or saved inventory restores the aggregate scroll position', async ({ page }) => {
  await page.goto('/?all-networks=1&many=1');
  const list = page.getByTestId('account-activity-list');
  await list.evaluate(element => { element.scrollTop = 300; });
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(250);
  const row = page.getByTestId('account-activity-row-base-0x' + '2'.padStart(64, '0'));
  await expect(row).toBeInViewport();
  const offset = await list.evaluate(element => element.scrollTop);
  await row.click();
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeCloseTo(offset, 0);
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved pending', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeCloseTo(offset, 0);
});
