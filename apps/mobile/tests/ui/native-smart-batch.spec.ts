import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});

async function contained(page: Page) {
  expect(
    await page.locator('body').evaluate((body) =>
      Array.from(body.querySelectorAll<HTMLElement>('*'))
        .filter((element) => {
          const r = element.getBoundingClientRect();
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        })
        .map((element) => element.textContent?.slice(0, 80))
    )
  ).toEqual([]);
}
async function reachable(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport({ ratio: 0.999 });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}
const recorded = (page: Page) =>
  page.evaluate(() => window.__nativeSmartBatchFixture.calls());
const authorize = (page: Page) =>
  page.getByRole('button', { name: 'Authorize calls', exact: true });
const confirm = (page: Page) =>
  page.getByRole('button', { name: 'Confirm calls', exact: true });
const close = (page: Page) =>
  page.getByRole('button', { name: 'Close', exact: true });

test('batch review preserves two ordered calls and shows the requesting site', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?smart-batch=1');
  await expect(
    page.getByText('https://batch.example.invalid', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Website origin matched by WalletConnect', { exact: true })
  ).toBeVisible();
  const first = page.getByText('Call 1 of 2', { exact: true });
  const second = page.getByText('Call 2 of 2', { exact: true });
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.y).toBeLessThan(
    (await second.boundingBox())!.y
  );
  await expect(
    page.getByText('0x3333333333333333333333333333333333333333', {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText('0x4444444444444444444444444444444444444444', {
      exact: true,
    })
  ).toHaveCount(1);
  await expect(page.getByText('0.001', { exact: true })).toHaveCount(1);
  await expect(page.getByText('0.002', { exact: true })).toHaveCount(1);
  await reachable(authorize(page));
  await contained(page);
  expect(await recorded(page)).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('batch-ordered-review-390.png'),
  });
});

test('narrow batch review separates authorization from payer consent and submission', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-batch=1');
  await reachable(authorize(page));
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('batch-authorize-320.png'),
  });
  await authorize(page).click();
  await expect(page.getByText('Paying account', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Submit the authorized calls', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Submit the authorized deployment', { exact: true })
  ).toHaveCount(0);
  await reachable(close(page));
  await expect(confirm(page)).toBeInViewport({ ratio: 0.999 });
  await contained(page);
  expect(await recorded(page)).toEqual([
    { method: 'approveRequest', args: ['batch-request-1', 7, true] },
  ]);
  await page.screenshot({
    path: test.info().outputPath('batch-payer-320.png'),
  });
  await confirm(page).click();
  await expect(
    page.getByText('Calls submitted', { exact: true })
  ).toBeVisible();
  await expect(authorize(page)).toHaveCount(0);
  await expect(confirm(page)).toHaveCount(0);
  await reachable(close(page));
  await contained(page);
  expect(await recorded(page)).toEqual([
    { method: 'approveRequest', args: ['batch-request-1', 7, true] },
    { method: 'confirmSmartPayer', args: ['batch-request-1', 8, 3] },
  ]);
  await page.screenshot({
    path: test.info().outputPath('batch-submitted-320.png'),
  });
});

test('rejecting a batch at short height sends only its public request ID', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?smart-batch=1');
  await reachable(close(page));
  await contained(page);
  await close(page).click();
  await expect(page.getByText('Request closed', { exact: true })).toBeVisible();
  expect(await recorded(page)).toEqual([
    { method: 'rejectRequest', args: ['batch-request-1'] },
  ]);
});

test('expiry during batch payer review removes confirmation and keeps Close reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?smart-batch=1');
  await authorize(page).click();
  await page.evaluate(() => window.__nativeSmartBatchFixture.expire());
  await expect(confirm(page)).toHaveCount(0);
  await expect(
    page.getByText('The request expired. Request it again from the app.', {
      exact: true,
    })
  ).toBeVisible();
  await reachable(close(page));
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('batch-expired-320.png'),
  });
  await close(page).click();
  expect(await recorded(page)).toEqual([
    { method: 'approveRequest', args: ['batch-request-1', 7, true] },
    { method: 'rejectRequest', args: ['batch-request-1'] },
  ]);
});

test('long batch calldata stays paged with both calls and authorization reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?smart-batch=1&long-data=1');
  await expect(page.getByText('Page 1 of 9', { exact: true })).toBeVisible();
  const next = page
    .getByRole('button', { name: 'Next page', exact: true })
    .last();
  await reachable(next);
  for (let i = 1; i < 9; i++) await next.click();
  await expect(page.getByText('Page 9 of 9', { exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  await page
    .getByRole('button', { name: 'View authorization details', exact: true })
    .click();
  await expect(
    page.getByText('User operation nonce', { exact: true })
  ).toBeVisible();
  await reachable(authorize(page));
  await contained(page);
  expect(await recorded(page)).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('batch-long-review-320.png'),
  });
});

test('rendered confirmed status acknowledges its ID once and supports dismissal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-batch=1&status=200');
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(page.getByText('Atomic calls', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Transaction confirmed', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Block 42', { exact: true })).toBeVisible();
  await expect
    .poll(() => recorded(page))
    .toEqual([{ method: 'callsStatusShown', args: ['batch-status-1'] }]);
  await page.evaluate(() => window.__nativeSmartBatchFixture.refreshStatus());
  await reachable(close(page));
  await contained(page);
  expect(await recorded(page)).toEqual([
    { method: 'callsStatusShown', args: ['batch-status-1'] },
  ]);
  await page.screenshot({
    path: test.info().outputPath('batch-status-confirmed-320.png'),
  });
  await close(page).click();
  await expect(page.getByText('Request closed', { exact: true })).toBeVisible();
  expect(await recorded(page)).toEqual([
    { method: 'callsStatusShown', args: ['batch-status-1'] },
    { method: 'dismissCallsStatus', args: ['batch-status-1'] },
  ]);
});

test('reverted status and a long bundle ID stay contained at short height', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?smart-batch=1&status=500&long-id=1');
  await expect(page.getByText('Reverted', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Transaction reverted', { exact: true })
  ).toBeVisible();
  await reachable(close(page));
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('batch-status-reverted-320.png'),
  });
  await close(page).click();
  await expect(page.getByText('Request closed', { exact: true })).toBeVisible();
});
