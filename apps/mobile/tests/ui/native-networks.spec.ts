import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

test('network picker shows scope and passes both captured revisions to selection', async ({ page }) => {
  await page.goto('/?networks=1');
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH');
  await expect(page.getByText('Test networks', { exact: true })).toBeVisible();
  await expect(page.getByText('Balance and receive only')).toHaveCount(6);
  await page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true }).click();
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Base, ETH, balance and receive only');
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toEqual([
    { id: 'base', contextRevision: 19, catalogueRevision: 4 },
  ]);
});

test('search distinguishes test networks and leaves selection unchanged for no results', async ({ page }) => {
  await page.goto('/?networks=1');
  await page.getByLabel('Search networks', { exact: true }).fill('tsys');
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /test network/ })).toHaveCount(2);
  await page.getByLabel('Search networks', { exact: true }).fill('missing');
  await expect(page.getByText('No matching networks', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toEqual([]);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.selected())).toBe('ethereum');
});

test('duplicate taps and context replacement cannot revive a pending selection', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  await page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true }).click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.__nativeNetworksFixture.replace(); window.__nativeNetworksFixture.release(); });
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.requests())).toHaveLength(1);
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('back cancels a held network operation without applying a late result', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  await page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Picker closed', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  expect(await page.evaluate(() => window.__nativeNetworksFixture.cancelled())).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__nativeNetworksFixture.selected())).toBe('ethereum');
});

test('busy rejection is visible and the narrow screen has no horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?networks=1&busy=1');
  await page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Wait for the current wallet operation');
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-network-picker.png'), fullPage: true });
});


test('replacing a controller retires its work without blocking or clearing newer work', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  await page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true }).click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.replaceController());
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  const rollux = page.getByRole('radio', { name: 'Rollux, SYS, balance and receive only', exact: true });
  await expect(rollux).toBeEnabled();
  await rollux.click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await expect(rollux).toBeDisabled();
  await page.evaluate(() => window.__nativeNetworksFixture.releaseReplacement());
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Rollux, SYS, balance and receive only');
});


test('returning to a retired controller cannot revive its busy state', async ({ page }) => {
  await page.goto('/?networks=1&hold=1');
  const base = page.getByRole('radio', { name: 'Base, ETH, balance and receive only', exact: true });
  await base.click();
  await expect(page.getByText('Switching networks…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__nativeNetworksFixture.replaceController());
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__nativeNetworksFixture.restoreController());
  await expect(base).toBeEnabled();
  await expect(page.getByText('Switching networks…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__nativeNetworksFixture.release());
  await expect(base).toBeEnabled();
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('Ethereum, ETH');
});
