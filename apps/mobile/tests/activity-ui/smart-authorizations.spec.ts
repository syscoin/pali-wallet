import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4181'
    ? route.continue() : route.abort('blockedbyclient'));
});

for (const width of [320, 390]) {
  test(`Smart Account Activity shows transaction details and hides consumed authorization actions at ${width}px`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/?signed-instructions');
    await expect(page.getByRole('button', { name: 'Signed instructions', exact: true })).toHaveCount(0);
    await expect(page.getByTestId(`activity-row-operation:0x${'1'.repeat(64)}`)).toHaveCount(0);
    await expect(page.getByTestId(`activity-row-operation:0x${'3'.repeat(64)}`)).toBeVisible();
    await page.getByTestId(`activity-row-0x${'2'.repeat(64)}`).click();
    const cancel = page.getByRole('button', { name: 'Cancel instruction', exact: true });
    await expect(page.getByText('Transaction details', { exact: true })).toBeVisible();
    await expect(page.getByText('Operation hash', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`smart-transaction-${width}.png`), fullPage: true });
    await expect(page.getByRole('button', { name: 'Check status', exact: true })).toHaveCount(0);
    await expect(cancel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View transaction', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const older of [false, true]) test(`a pending Smart Account transaction opens the existing cancellation review (older authorization=${older})`, async ({ page }) => {
  await page.goto('/?signed-instructions&pending' + (older ? '&older-authorization' : ''));
  await page.getByTestId(`activity-row-0x${'2'.repeat(64)}`).click();
  const cancel = page.getByRole('button', { name: 'Cancel instruction', exact: true });
  await expect(cancel).toHaveCount(1);
  await cancel.click();
  await expect(page.getByText('Cancellation review requested', { exact: true })).toBeVisible();
});

for (const state of ['pending', 'consumed', 'observed', 'unavailable']) test(`an operation-only Activity row checks its status and only offers Cancel when pending (${state})`, async ({ page }) => {
  await page.goto(`/?signed-instructions&${state}`);
  await page.getByTestId(`activity-row-operation:0x${'3'.repeat(64)}`).click();
  await expect(page.getByText('Operation hash', { exact: true })).toBeVisible();
  await expect(page.getByText('Transaction ID', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View on explorer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  if (state === 'pending') {
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(page.getByText('Exact cancellation review requested', { exact: true })).toBeVisible();
  } else {
    await expect(cancel).toHaveCount(0);
    await expect(page.getByText(state === 'unavailable' ? 'Status unavailable' : state === 'observed'
      ? 'Reverted' : 'Nonce consumed · outcome unavailable', { exact: true })).toBeVisible();
  }
});

test('All Networks keeps Details open when a transaction is found for the operation', async ({ page }) => {
  await page.goto('/?signed-instructions&account-activity&observed-outer');
  const operation = page.getByTestId(`account-activity-row-ethereum-operation:0x${'3'.repeat(64)}`);
  await operation.click();
  await expect(page.getByText('Operation hash', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('show-observed-outer')));
  await expect(page.getByRole('heading', { name: 'Transaction details', exact: true })).toBeVisible();
  await expect(page.getByText('Transaction ID', { exact: true })).toBeVisible();
  await expect(page.getByText('Reverted', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Operation hash', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(operation).toHaveCount(0);
  await expect(page.getByTestId(`account-activity-row-ethereum-0x${'4'.repeat(64)}`)).toBeVisible();
});

test('All Networks sends only the exact pending authorization to the existing cancellation review', async ({ page }) => {
  await page.goto('/?signed-instructions&account-activity&pending');
  await page.getByTestId(`account-activity-row-ethereum-operation:0x${'3'.repeat(64)}`).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Exact cancellation review requested', { exact: true })).toBeVisible();
});


test('the normal Activity footer reaches an older operation after every other source is exhausted', async ({ page }) => {
  await page.goto('/?signed-instructions&older-authorization');
  const older = page.getByRole('button', { name: 'Load older activity', exact: true });
  // Bring the virtualized first page into view before tapping its footer.
  await older.scrollIntoViewIfNeeded();
  await expect(page.getByTestId(/^activity-row-operation:/)).toHaveCount(20);
  await older.scrollIntoViewIfNeeded();
  await expect(older).toBeInViewport();
  await older.click();
  await expect(older).toHaveCount(0);
  await page.getByTestId(`activity-row-0x${'2'.repeat(64)}`).click();
  await expect(page.getByText('Transaction details', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel instruction', exact: true })).toHaveCount(0);
});
