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
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/pali-all-activity-390.png', fullPage: true });
});
test('same transaction hash opens only its selected network child and Back returns to the aggregate', async ({ page }) => {
  await page.goto('/?all-networks=1');
  await page.getByTestId(`account-activity-row-base-${hash}`).click();
  await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__allActivityFixture.inspections())).toEqual(['base']);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
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
