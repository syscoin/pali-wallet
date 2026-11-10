import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

async function connect(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Find Ledger', exact: true }).click();
  await page
    .getByRole('button', { name: 'My Ledger · Nano X', exact: true })
    .click();
  await expect(page.getByLabel('Ledger account name')).toBeVisible();
}

test('Ledger discovery and import require explicit actions', async ({
  page,
}) => {
  await page.goto('/?ledger=1');
  expect(
    await page.evaluate(() => window.__nativeLedgerFixture.calls())
  ).toEqual([]);
  await connect(page);
  await expect(
    page.getByText('0x1111111111111111111111111111111111111111', {
      exact: true,
    })
  ).toBeVisible();
  await page.getByLabel('Ledger account name').fill('Travel Ledger');
  await page
    .getByRole('button', { name: 'Add Ledger account', exact: true })
    .click();
  await expect(
    page.getByText('Ledger account added', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__nativeLedgerFixture.calls())
  ).toContain('import:Travel Ledger');
});

test('a parent render preserves discovery and Back retires the screen', async ({
  page,
}) => {
  await page.goto('/?ledger=1');
  await page.getByRole('button', { name: 'Find Ledger', exact: true }).click();
  await page.evaluate(() => window.__nativeLedgerFixture.refreshParent());
  expect(
    await page.evaluate(() => window.__nativeLedgerFixture.calls())
  ).not.toContain('close');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByText('Ledger screen closed', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__nativeLedgerFixture.calls())
  ).toContain('close');
});

test('Back suppresses completion of an already pending import', async ({
  page,
}) => {
  await page.goto('/?ledger=1&hold=1');
  await connect(page);
  await page
    .getByRole('button', { name: 'Add Ledger account', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Adding account…', exact: true })
  ).toBeDisabled();
  await expect(page.getByLabel('Ledger account name')).not.toBeEditable();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__nativeLedgerFixture.resolveImport());
  await expect(
    page.getByText('Ledger screen closed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Ledger account added', { exact: true })
  ).toHaveCount(0);
});

test('Ledger review remains usable on a narrow display', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?ledger=1');
  await connect(page);
  await expect(
    page.getByRole('button', { name: 'Add Ledger account', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('ledger-account-review.png'),
    fullPage: true,
  });
});

test('Bluetooth failure provides a retry action', async ({ page }) => {
  await page.goto('/?ledger=1');
  await page.evaluate(() => window.__nativeLedgerFixture.fail());
  await expect(page.getByRole('alert')).toContainText(
    'Bluetooth is unavailable'
  );
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true })
  ).toBeEnabled();
});
