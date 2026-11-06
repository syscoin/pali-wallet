import { test, expect, type Page } from '@playwright/test';

const listRow = (page: Page) =>
  page.getByRole('button', {
    name: /1(?:\.0)? ETH, .*View transaction details/,
  });
const calls = (page: Page) =>
  page.evaluate(() => window.__freshActivityFixture.calls());
const rpcCalls = async (page: Page) =>
  (await calls(page)).filter((call) => call.method.startsWith('eth_'));
const detailStatus = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).filter({ visible: true });
const rowState = (page: Page) =>
  page.evaluate(() => window.__activityFixture.rowState()[0]);

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4181')
      return route.continue();
    await route.abort('blockedbyclient');
    throw Error('Unexpected external request');
  });
});

test('an unobserved saved transaction offers explicit same-nonce cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?fresh-status=retained-missing-missing');
  await listRow(page).click();
  const saved = page.getByRole('button', { name: 'Cancel saved transaction', exact: true });
  await expect(saved).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel pending transaction', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Speed Up', exact: true })).toHaveCount(0);
  await saved.click();
  await expect(page.getByRole('button', { name: 'Open Activity', exact: true })).toBeVisible();
});

test('a saved Speed Up leaves reviewed replacement actions on the live pending original', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?fresh-status=retained-missing-pending-speedup');
  await expect(listRow(page)).toHaveCount(2);
  await listRow(page).last().click();
  await expect(detailStatus(page, 'Pending')).toBeVisible();
  const speedUp = page.getByRole('button', { name: 'Speed Up', exact: true });
  const cancel = page.getByRole('button', { name: 'Cancel pending transaction', exact: true });
  await expect(speedUp).toBeVisible();
  await expect(cancel).toBeVisible();
  await speedUp.scrollIntoViewIfNeeded();
  const bounds = await speedUp.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('retained-speed-up-actions.png'), animations: 'disabled' });

  await page.getByRole('button', { name: 'View Speed Up attempt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View original transaction', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review resend', exact: true })).toBeVisible();
  await expect(speedUp).toHaveCount(0);
  await expect(cancel).toHaveCount(0);
});

for (const [indexed, observed, expected] of [
  ['pending', 'confirmed', 'Confirmed'],
  ['pending', 'reverted', 'Reverted'],
  ['confirmed', 'pending', 'Pending'],
  ['confirmed', 'reverted', 'Reverted'],
] as const) {
  test(`fresh ${observed} overrides indexed ${indexed} in details, list and accessibility`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (observed === 'pending')
      await page.setViewportSize({ width: 320, height: 480 });
    await page.goto(`/?fresh-status=${indexed}-${observed}`);
    await expect(listRow(page)).toHaveAccessibleName(
      `1 ETH, ${
        indexed === 'pending' ? 'Pending' : 'Confirmed'
      }. View transaction details`
    );
    expect((await calls(page)).map((call) => call.method).sort()).toEqual([
      'tokentx',
      'txlist',
    ]);
    await listRow(page).click();
    await expect
      .poll(async () => (await rowState(page))?.observation)
      .toBe(observed);
    await expect
      .soft(detailStatus(page, expected))
      .toBeVisible({ timeout: 1000 });
    if (observed === 'pending') {
      await expect
        .soft(page.getByText('BLOCK', { exact: true }))
        .toHaveCount(0, { timeout: 1000 });
      await expect
        .soft(page.getByText('42', { exact: true }))
        .toHaveCount(0, { timeout: 1000 });
    } else {
      await expect
        .soft(page.getByText('43', { exact: true }))
        .toBeVisible({ timeout: 1000 });
      await expect
        .soft(page.getByText('42', { exact: true }))
        .toHaveCount(0, { timeout: 1000 });
    }
    await page.screenshot({
      path: testInfo.outputPath('fresh-details.png'),
      animations: 'disabled',
      fullPage: true,
    });
    const reads = (await rpcCalls(page)).length;
    expect(reads).toBe(observed === 'pending' ? 4 : 5);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect
      .soft(listRow(page))
      .toHaveAccessibleName(`1 ETH, ${expected}. View transaction details`, {
        timeout: 1000,
      });
    await expect.soft(listRow(page)).toContainText(expected, { timeout: 1000 });
    await page.screenshot({
      path: testInfo.outputPath('fresh-list.png'),
      animations: 'disabled',
      fullPage: true,
    });
    expect((await rpcCalls(page)).length).toBe(reads);
    expect(errors).toEqual([]);
  });
}

for (const observed of ['unknown', 'missing', 'error'] as const) {
  test(`indexed status and block remain the fallback after ${observed} RPC details`, async ({
    page,
  }) => {
    await page.goto(`/?fresh-status=confirmed-${observed}`);
    await listRow(page).click();
    if (observed === 'unknown')
      await expect
        .poll(async () => (await rowState(page))?.observation)
        .toBe('unknown');
    else
      await expect
        .poll(async () => (await rowState(page))?.unavailable)
        .toBe(true);
    const row = await rowState(page);
    expect(row?.observation).toBe(
      observed === 'unknown' ? 'unknown' : undefined
    );
    expect(row?.unavailable).toBe(observed !== 'unknown');
    await expect(detailStatus(page, 'Confirmed')).toBeVisible();
    await expect(page.getByText('42', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(listRow(page)).toHaveAccessibleName(
      '1 ETH, Confirmed. View transaction details'
    );
    if (observed !== 'unknown')
      await expect(listRow(page)).toContainText('RPC details unavailable');
  });
}

test('explicit recheck replaces its previous observation and refresh restores indexed fallback without row RPC', async ({
  page,
}) => {
  await page.goto('/?fresh-status=pending-confirmed');
  await listRow(page).click();
  await expect
    .poll(async () => (await rowState(page))?.observation)
    .toBe('confirmed');
  await expect(detailStatus(page, 'Confirmed')).toBeVisible();
  await page.evaluate(() =>
    window.__freshActivityFixture.observation('pending')
  );
  await page
    .getByRole('button', { name: 'Check transaction again', exact: true })
    .click();
  await expect
    .poll(async () => (await rowState(page))?.observation)
    .toBe('pending');
  await expect(detailStatus(page, 'Pending')).toBeVisible();
  await expect(page.getByText('BLOCK', { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    window.__freshActivityFixture.observation('reverted')
  );
  await page
    .getByRole('button', { name: 'Check transaction again', exact: true })
    .click();
  await expect
    .poll(async () => (await rowState(page))?.observation)
    .toBe('reverted');
  await expect(detailStatus(page, 'Reverted')).toBeVisible();
  await expect(page.getByText('43', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(listRow(page)).toHaveAccessibleName(
    '1 ETH, Reverted. View transaction details'
  );
  const reads = (await rpcCalls(page)).length;
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await expect(listRow(page)).toHaveAccessibleName(
    '1 ETH, Pending. View transaction details'
  );
  expect((await rowState(page))?.observation).toBeUndefined();
  expect((await rpcCalls(page)).length).toBe(reads);
});

test('fresh pending reorg details restore Cancel for a previously confirmed local transaction', async ({ page }, testInfo) => {
  await page.goto('/?fresh-status=retained-terminal-confirmed');
  await expect(listRow(page)).toBeVisible();
  expect(await rpcCalls(page)).toEqual([]);
  await listRow(page).click();
  await expect(detailStatus(page, 'Confirmed')).toBeVisible();
  const cancel = page.getByRole('button', { name: 'Cancel pending transaction', exact: true });
  await expect(cancel).toHaveCount(0);

  await page.evaluate(() => window.__freshActivityFixture.observation('pending'));
  await page.getByRole('button', { name: 'Check transaction again', exact: true }).click();
  await expect(detailStatus(page, 'Pending')).toBeVisible();
  await expect(cancel).toBeVisible();
  await cancel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('reorg-cancellation.png'), animations: 'disabled' });
  await cancel.click();
  await expect(page.getByRole('button', { name: 'Open Activity' })).toBeVisible();
});

test('a context change cancels the selected read and cannot revive its stale success', async ({
  page,
}) => {
  await page.goto('/?fresh-status=confirmed-reverted');
  await expect(listRow(page)).toBeVisible();
  await page.evaluate(() => window.__freshActivityFixture.hold());
  await listRow(page).click();
  await expect
    .poll(async () =>
      (
        await rpcCalls(page)
      ).some((call) => call.method === 'eth_getTransactionReceipt')
    )
    .toBe(true);
  await page.evaluate(() => window.__activityFixture.changeContext());
  await expect
    .poll(async () => (await rowState(page))?.indexedStatus)
    .toBe('confirmed');
  await page.evaluate(() => window.__freshActivityFixture.release());
  await expect
    .poll(async () => (await calls(page)).some((call) => call.cancelled))
    .toBe(true);
  await expect.poll(async () => (await rowState(page))?.checking).toBe(false);
  expect((await rowState(page))?.observation).toBeUndefined();
  await expect(detailStatus(page, 'Reverted')).toHaveCount(0);
  if (await page.getByText('Transaction details', { exact: true }).isVisible())
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(listRow(page)).toHaveAccessibleName(
    '1 ETH, Confirmed. View transaction details'
  );
  expect((await rpcCalls(page)).map((call) => call.method)).toEqual([
    'eth_chainId',
    'eth_getTransactionByHash',
    'eth_getTransactionReceipt',
  ]);
});

for (const [retained, observed, expected, previous] of [
  ['confirmed', 'reverted', 'Reverted', 'Confirmed'],
  ['missing', 'confirmed', 'Confirmed', 'Submission unconfirmed'],
] as const) {
  test(`fresh ${observed} overrides nonindexed retained ${retained} without changing fallback meaning`, async ({
    page,
  }) => {
    await page.goto(`/?fresh-status=retained-${retained}-${observed}`);
    await expect(listRow(page)).toHaveAccessibleName(
      `1.0 ETH, ${previous}. View transaction details`
    );
    expect(await rpcCalls(page)).toEqual([]);
    await listRow(page).click();
    await expect
      .poll(async () => (await rowState(page))?.observation)
      .toBe(observed);
    await expect(detailStatus(page, expected)).toBeVisible();
    await expect(page.getByText('43', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(listRow(page)).toHaveAccessibleName(
      `1.0 ETH, ${expected}. View transaction details`
    );
    const reads = (await rpcCalls(page)).length;
    await page
      .getByRole('button', { name: 'Refresh activity', exact: true })
      .click();
    await expect(listRow(page)).toHaveAccessibleName(
      `1.0 ETH, ${previous}. View transaction details`
    );
    expect((await rpcCalls(page)).length).toBe(reads);
  });
}
