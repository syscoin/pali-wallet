import { test, expect } from '@playwright/test';
test('actual Activity component loads, filters zero-value events, and requires full-address copy confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByText('1 zero-value token transaction hidden.')
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Show zero-value token activity',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('1 token transfer event', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: /1 token transfer event, Confirmed/ })
    .click();
  await expect(
    page.getByText('Transaction details', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy event sender', exact: true })
    .click();
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy full address', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('feed failure remains retryable, and detail/back works while receipts are in flight', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__activityFixture', {
      configurable: true,
      set(value) {
        Object.defineProperty(window, '__activityFixture', {
          value,
          configurable: true,
        });
        value.fail(true);
        value.delay(true);
      },
    });
  });
  await page.goto('/');
  await expect(
    page.getByText('Some activity is unavailable', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => (window as any).__activityFixture.fail(false));
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await expect(
    page
      .getByRole('button', { name: /Ethereum activity, Checking transaction/ })
      .first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Ethereum activity, Checking transaction/ })
    .first()
    .click();
  await expect(
    page.getByText('Transaction details', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByText('Activity', { exact: true }).first()
  ).toBeVisible();
  await page.evaluate(() => (window as any).__activityFixture.release());
  await expect(
    page.getByRole('button', { name: /1\.0 ETH, Confirmed/ }).first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Load older activity', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Load older activity', exact: true })
  ).toBeEnabled();
});
test('older visible rows receive RPC checks and return to the same list position', async ({
  page,
}) => {
  await page.goto('/');
  const older = page.getByRole('button', {
    name: 'Load older activity',
    exact: true,
  });
  await older.click();
  await older.scrollIntoViewIfNeeded();
  const row = page
    .getByRole('button')
    .filter({ hasText: '0x0000000000…00000028' });
  await expect(row).toContainText('Confirmed');
  await row.click();
  await expect(
    page.getByText('Transaction details', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(row).toBeVisible();
});
test('copy review actions remain reachable on a small screen with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/');
  await page
    .getByRole('button', { name: /1\.0 ETH, Confirmed/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Copy sender address', exact: true })
    .click();
  await page.addStyleTag({
    content:
      '[role="dialog"] div { font-size: 25px !important; line-height: 1.6 !important; }',
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).not.toBeVisible();
});
