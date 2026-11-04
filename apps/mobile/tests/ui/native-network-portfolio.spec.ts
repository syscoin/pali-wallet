import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

test('actual network view switches portfolio and Receive while unsupported Send remains hidden', async ({ page }) => {
  await page.goto('/?network-portfolio');
  await expect(page.getByTestId('native-portfolio-balance')).toHaveText('1.234');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByText('Network', { exact: true }).click();
  await page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Account 1 · Base', { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Base balance 1.234 ETH');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await expect(page.getByText('Sending is not available on this network yet.')).toBeVisible();
  await page.getByTestId('native-portfolio-receive').click();
  await expect(page.getByTestId('native-receive-qr')).toHaveAttribute('aria-label', /QR code for Base address/);
  await expect(page.getByText('Use Base for this address.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.reads())).toEqual(['ethereum', 'base']);
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.sends())).toBe(0);
});

test('switching away from Receive discards its scope and labels testnet funds explicitly', async ({ page }, testInfo) => {
  await page.goto('/?network-portfolio');
  await page.getByTestId('native-portfolio-receive').click();
  await page.evaluate(() => window.__nativeNetworkPortfolio.select('syscoin-nevm-testnet'));
  await expect(page.getByTestId('native-receive-qr')).toHaveCount(0);
  await expect(page.getByText('Account 1 · Syscoin NEVM Testnet · Test network', { exact: true })).toBeVisible();
  await expect(page.getByText('Test network · Balance and receive only', { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Syscoin NEVM Testnet balance 1.234 TSYS');
  await page.getByTestId('native-portfolio-receive').click();
  await expect(page.getByText('Use Syscoin NEVM Testnet (test network) for this address.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-network-receive.png'), fullPage: true });
});

test('public address copy uses the selected network and OS browser clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?network-portfolio');
  await page.evaluate(() => window.__nativeNetworkPortfolio.select('rollux'));
  await page.getByTestId('native-portfolio-receive').click();
  await page.getByTestId('native-receive-copy').click();
  await expect(page.getByText('Rollux address copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0x52908400098527886E0F7030069857D2E4169EE7');
});
