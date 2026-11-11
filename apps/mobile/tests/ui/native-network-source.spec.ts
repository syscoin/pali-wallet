import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

for (const width of [390, 320]) test(`Send from sheet keeps exact balances and close reachable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 740 });
  await page.goto('/?networks=1&source=send');
  const sheet = page.getByTestId('network-source-sheet');
  await expect(page.getByRole('heading', { name: 'Send from', exact: true })).toBeVisible();
  await expect(page.getByTestId('network-source-balance-ethereum')).toHaveText('1.234 ETH available');
  await expect(page.getByTestId('network-source-balance-base')).toHaveText('—');
  await expect(page.getByRole('radio', { name: 'Ethereum, ETH, Chain ID 1', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add network', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Search networks', { exact: true })).toHaveCount(0);
  const bounds = await sheet.boundingBox();
  expect(bounds!.y).toBeGreaterThan(100);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`send-from-${width}.png`) });
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Picker closed', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toEqual([]);
});

test('Receive source selection uses the guarded network receipt and closes after commit', async ({ page }) => {
  await page.goto('/?networks=1&source=receive');
  await expect(page.getByRole('heading', { name: 'Receive on', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByText('Picker closed', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toEqual([
    { id: 'base', contextRevision: 19, catalogueRevision: 4 },
  ]);
});

test('closing a busy source sheet cancels its pending selection', async ({ page }) => {
  await page.goto('/?networks=1&source=send&hold=1');
  const sheet = page.getByTestId('network-source-sheet');
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  await expect(page.getByText('Picker closed', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.selected())).toBe('ethereum');
});
