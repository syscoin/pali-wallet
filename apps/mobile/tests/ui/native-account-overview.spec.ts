import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4179' ? route.continue() : route.abort());
});

for (const width of [390, 320]) test(`selected EVM account overview and source sheet fit at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
  await page.goto('/?account-portfolio');
  await expect(page.getByRole('button', { name: 'Choose account, Account 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose network filter, All networks', exact: true })).toBeVisible();
  await expect(page.getByTestId('account-portfolio-value')).toContainText('3,024.00');
  await expect(page.getByText('Estimated total · excludes test networks', { exact: true })).toBeVisible();
  for (const tab of ['wallet', 'activity', 'tools', 'settings']) await expect(page.getByTestId(`main-tab-caption-${tab}`)).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => window.__accountPortfolio.reads.every(read => read.endsWith('0x' + '1'.padStart(40, '0'))))).toBe(true);
  expect(await page.evaluate(() => window.__accountPortfolio.assets.length)).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`account-overview-${width}.png`) });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Send from', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Send from', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('network-source-balance-native:hd:60:0:base:native')).toHaveText('2 ETH available');
  await page.screenshot({ path: info.outputPath(`account-source-${width}.png`), animations: 'disabled' });
  await expect(page.getByRole('radio', { name: /USDC/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  expect(await page.evaluate(() => window.__accountPortfolio.sends)).toEqual(['base:ETH']);
  await expect(page.getByRole('button', { name: 'Choose network filter, All networks', exact: true })).toBeVisible();
});

test('concrete filter persists through reopen and never queries hidden networks or sibling accounts', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?account-portfolio&filter=ethereum');
  await expect(page.getByTestId('account-portfolio-value')).toContainText('1,012.00');
  await page.screenshot({ path: info.outputPath('account-ethereum-390.png') });
  expect(await page.evaluate(() => window.__accountPortfolio.reads)).toEqual(['ethereum:0x' + '1'.padStart(40, '0')]);
  await page.getByRole('button', { name: 'Choose network filter, Ethereum', exact: true }).click();
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose network filter, Base', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('account-portfolio-value')).toContainText('2,012.00');
  await page.screenshot({ path: info.outputPath('account-base-reopened-390.png') });
  expect(await page.evaluate(() => window.__accountPortfolio.reads)).toEqual(['base:0x' + '1'.padStart(40, '0')]);
  expect(await page.evaluate(() => window.__accountPortfolio.assets)).toEqual(['base:hd:60:0']);
  expect(await page.evaluate(() => window.__accountPortfolio.prices)).toEqual(['base', 'token:base']);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(await page.evaluate(() => window.__accountPortfolio.sends)).toEqual(['base:ETH']);
  await expect(page.getByRole('heading', { name: 'Send from', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose account, Account 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose account, Account 15', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__accountPortfolio.assets)).toEqual(['base:hd:60:0', 'base:hd:60:14']);
  await page.screenshot({ path: info.outputPath('account-15-base-390.png') });
});

test('255-decimal tracked amounts stay compact and preserve their full accessible value', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?account-portfolio&filter=ethereum&extreme=1');
  await expect(page.getByText('1e-255', { exact: true })).toBeVisible();
  const token = page.getByRole('button', { name: /^USDC, Ethereum, 0\./ });
  await expect(token).toHaveAttribute('aria-label', 'USDC, Ethereum, 0.' + '0'.repeat(254) + '1');
  expect(await token.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(130);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const filter of ['all', 'ethereum']) test(`unbacked ${filter} Send chooses a public source without opening backup`, async ({ page }) => {
  await page.goto(`/?account-portfolio&unbacked=1&filter=${filter}`);
  await expect(page.getByTestId('account-portfolio-value')).not.toHaveText('—');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(await page.evaluate(() => window.__accountPortfolio.backups())).toBe(0);
  if (filter === 'all') {
    await expect(page.getByRole('heading', { name: 'Send from', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  }
  expect(await page.evaluate(() => window.__accountPortfolio.sends)).toEqual([filter === 'all' ? 'base:ETH' : 'ethereum:ETH']);
});

for (const width of [390, 320]) test(`cached balances and filter errors remain clear at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
  await page.goto('/?account-portfolio&filter=ethereum');
  await expect(page.getByTestId('account-portfolio-value')).toContainText('1,012.00');
  await page.evaluate(() => window.__accountPortfolio.failBalances(true));
  await expect(page.getByText('Last known balance', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'ETH, Ethereum, 1.0, Last known balance', exact: true })).toBeVisible();
  await expect(page.getByTestId('account-portfolio-value')).toHaveText('—');
  await page.screenshot({ path: info.outputPath(`cached-balance-${width}.png`), animations: 'disabled' });
  await page.evaluate(() => window.__accountPortfolio.failFilter(true));
  await page.getByRole('button', { name: 'Choose network filter, Ethereum', exact: true }).click();
  const sheet = page.getByTestId('network-source-sheet');
  await sheet.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Could not complete this request. Try again.');
  await expect(sheet.getByRole('alert')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath(`filter-error-${width}.png`), animations: 'disabled' });
  await page.evaluate(() => window.__accountPortfolio.failFilter(false));
  await sheet.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose network filter, Base', exact: true })).toBeVisible();
});
