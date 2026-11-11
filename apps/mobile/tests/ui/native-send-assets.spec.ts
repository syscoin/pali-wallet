import { expect, test } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:4179' });

for (const width of [390, 320]) test(`saved asset search stays scoped and preserves recipient at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4179' ? route.continue() : route.abort());
  await page.goto('/?send-assets=1');
  await page.getByLabel('Ethereum address', { exact: true }).fill('0x1111111111111111111111111111111111111111');
  await page.getByLabel('Amount in ETH', { exact: true }).fill('0.25');
  await page.getByRole('button', { name: 'Change asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose asset', exact: true })).toBeInViewport();
  await page.getByLabel('Search saved assets', { exact: true }).fill('usdc');
  await expect(page.getByRole('radio')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`send-asset-picker-${width}.png`), animations: 'disabled' });
  await page.getByRole('radio', { name: 'USD Coin, USDC', exact: true }).click();
  await expect(page.getByLabel('Ethereum address', { exact: true })).toHaveValue('0x1111111111111111111111111111111111111111');
  await expect(page.getByLabel('Amount in USDC', { exact: true })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Send USDC', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Send from', exact: true })).toHaveCount(0);
});

test('hundreds of cached assets use a virtual list and search without expanding requests', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4179' ? route.continue() : route.abort());
  await page.goto('/?send-assets=1&many-assets=1');
  await page.getByRole('button', { name: 'Change asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose asset', exact: true })).toBeInViewport();
  expect(await page.getByRole('radio').count()).toBeLessThan(100);
  await page.getByLabel('Search saved assets', { exact: true }).fill('Saved token 299');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Saved token 299, T299', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
