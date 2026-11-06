import { test, expect, type Page } from '@playwright/test';
import { PALI_INFRASTRUCTURE_BY_ID } from '../../../../source/utils/smartAccount/deployment.ts';

const RUNTIME = `0x${PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.deployCalldata!.slice(-5662 * 2)}`;
type Mode = Parameters<Window['__watchFixture']['guardian']['select']>[0];

async function selectMode(page: Page, mode: Mode) {
  await page.evaluate(({ mode, runtime }) => window.__watchFixture.guardian.select(mode, runtime), { mode, runtime: RUNTIME });
}

async function openGuardian(page: Page) {
  await page.goto('/?guardian-fixture&android');
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: /Guardian recovery/ }).click();
  await expect(page.getByRole('heading', { name: 'Guardian recovery' })).toBeVisible();
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) await route.continue();
    else { await route.abort('blockedbyclient'); throw new Error('Unexpected network request'); }
  });
});

test('watch recovery checks explicitly and renders a verified schedule at 320 px', async ({ page }, testInfo) => {
  await openGuardian(page);
  expect(await page.evaluate(() => window.__watchFixture.guardian.methods())).toEqual([]);
  await selectMode(page, 'healthy');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByText('Recovery scheduled', { exact: true })).toBeVisible();
  await expect(page.getByText('Checked at block 32', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Ready /)).toBeVisible();
  await expect(page.getByText(/^Expires /)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('guardian-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Tools', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Guardian recovery/ }).click();
  await expect(page.getByRole('button', { name: 'Check status' })).toBeVisible();
  await expect(page.getByText('Recovery scheduled', { exact: true })).toHaveCount(0);
});

test('watch recovery separates unsupported module from an unavailable endpoint', async ({ page }) => {
  await openGuardian(page);
  await selectMode(page, 'unsupported-revert');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByText('Guardian module unsupported', { exact: true })).toBeVisible();
  await selectMode(page, 'unavailable');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('Status unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No guardian policy found', { exact: true })).toHaveCount(0);
});

test('an ordinary address displays no compatible guardian policy at 320 px', async ({ page }, testInfo) => {
  await openGuardian(page);
  await selectMode(page, 'eoa');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByText('No compatible guardian policy', { exact: true })).toBeVisible();
  await expect(page.getByText('Status unavailable', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('guardian-no-policy-320.png'), fullPage: true });
});

test('Back and a changed network retire a held watch recovery read', async ({ page }) => {
  await openGuardian(page);
  for (const leave of ['Back', 'hardware', 'network'] as const) {
    await selectMode(page, 'hold');
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect.poll(() => page.evaluate(() => window.__watchFixture.guardian.methods())).toEqual(['eth_chainId', 'eth_getBlockByNumber']);
    if (leave === 'Back') await page.getByRole('button', { name: 'Back', exact: true }).click();
    else if (leave === 'hardware') expect(await page.evaluate(() => window.__watchFixture.back())).toBe(true);
    else await page.evaluate(() => window.__watchFixture.selectWatchNetwork('base'));
    await expect(page.getByRole('heading', { name: 'Guardian recovery' })).toHaveCount(0);
    await page.evaluate(() => window.__watchFixture.guardian.release());
    await expect.poll(() => page.evaluate(() => window.__watchFixture.guardian.interrupted())).toBe(2);
    if (leave !== 'network') await page.getByRole('button', { name: /Guardian recovery/ }).click();
  }
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: /Guardian recovery/ }).click();
  await expect(page.getByRole('button', { name: 'Check status' })).toBeVisible();
  await expect(page.getByText('Base', { exact: true })).toBeVisible();
  await expect(page.getByText('Recovery scheduled', { exact: true })).toHaveCount(0);
});
