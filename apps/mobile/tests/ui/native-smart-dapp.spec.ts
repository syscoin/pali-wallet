import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});

async function contained(page: Page) {
  expect(
    await page.locator('body').evaluate((body) =>
      Array.from(body.querySelectorAll<HTMLElement>('*'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
          );
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

for (const width of [390, 320]) {
  test(`Smart dapp has separate transaction and payer consent at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto('/?smart-dapp=1');
    await expect(
      page.getByText('https://swap.example.invalid', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Website origin matched by WalletConnect', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('0.000000000000000009', { exact: true })
    ).toBeVisible();
    await contained(page);
    await page.screenshot({
      path: test.info().outputPath(`smart-dapp-review-${width}.png`),
    });
    const authorize = page.getByRole('button', {
      name: 'Authorize transaction',
      exact: true,
    });
    await reachable(authorize);
    await page.screenshot({
      path: test.info().outputPath(`smart-dapp-authorize-${width}.png`),
    });
    await authorize.click();
    await expect(
      page.getByText('Paying account', { exact: true })
    ).toBeVisible();
    const confirm = page.getByRole('button', {
      name: 'Confirm transaction',
      exact: true,
    });
    const close = page.getByRole('button', { name: 'Close', exact: true });
    await reachable(close);
    await expect(confirm).toBeInViewport({ ratio: 0.999 });
    await contained(page);
    await page.screenshot({
      path: test.info().outputPath(`smart-dapp-payer-${width}.png`),
    });
    expect(
      await page.evaluate(() => window.__nativeSmartDappFixture.calls())
    ).toEqual([
      { method: 'approveRequest', args: ['smart-request-1', 7, true] },
    ]);
    await confirm.click();
    await expect(
      page.getByText('Transaction submitted', { exact: true })
    ).toBeVisible();
    await expect(authorize).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__nativeSmartDappFixture.calls())
    ).toEqual([
      { method: 'approveRequest', args: ['smart-request-1', 7, true] },
      { method: 'confirmSmartPayer', args: ['smart-request-1', 7, 3] },
    ]);
    await contained(page);
    await reachable(close);
    await page.screenshot({
      path: test.info().outputPath(`smart-dapp-submitted-${width}.png`),
    });
  });
}

test('unsafe-address acknowledgement and account switch gate consent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-dapp=1&warning=1&switch=1');
  const authorize = page.getByRole('button', {
    name: 'Authorize transaction',
    exact: true,
  });
  await expect(authorize).toBeDisabled();
  await expect(
    page.getByText('Known unsafe recipient', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('checkbox', {
      name: 'I understand the address warning',
      exact: true,
    })
    .click();
  await expect(authorize).toBeDisabled();
  await page
    .getByRole('button', { name: 'Switch account', exact: true })
    .click();
  await expect(authorize).toBeEnabled();
  await reachable(authorize);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('smart-dapp-warning-320.png'),
  });
  await authorize.click();
  expect(
    await page.evaluate(() => window.__nativeSmartDappFixture.calls())
  ).toEqual([
    { method: 'activateRequestAccount', args: ['smart-request-1', 7] },
    { method: 'approveRequest', args: ['smart-request-1', 8, true] },
  ]);
});

test('long calldata and authorization details remain reachable on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-dapp=1&long-data=1');
  await expect(page.getByText('Page 1 of 9', { exact: true })).toBeVisible();
  const next = page.getByRole('button', { name: 'Next page', exact: true });
  await reachable(next);
  for (let index = 1; index < 9; index++) await next.click();
  await expect(page.getByText('Page 9 of 9', { exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  await page
    .getByRole('button', { name: 'View authorization details', exact: true })
    .click();
  await expect(
    page.getByText('User operation nonce', { exact: true })
  ).toBeVisible();
  await contained(page);
  await reachable(
    page.getByRole('button', { name: 'Authorize transaction', exact: true })
  );
  await page.screenshot({
    path: test.info().outputPath('smart-dapp-long-details-320.png'),
  });
  expect(
    await page.evaluate(() => window.__nativeSmartDappFixture.calls())
  ).toEqual([]);
});

test('allowance editor keeps consent disabled and reachable at keyboard-sized height', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-dapp=1&allowance=1');
  await expect(
    page.getByText('Token allowance', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Unlimited', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Edit spending limit', exact: true })
    .click();
  const input = page.getByLabel('New spending limit', { exact: true });
  await input.fill('1.234567');
  await page.setViewportSize({ width: 320, height: 360 });
  await input.focus();
  await expect(
    page.getByRole('button', { name: 'Authorize transaction', exact: true })
  ).toBeDisabled();
  const apply = page.getByRole('button', { name: 'Apply limit', exact: true });
  await reachable(apply);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('smart-dapp-allowance-keyboard-320.png'),
  });
  await apply.click();
  await expect(page.getByText('1.234567 TOK', { exact: true })).toBeVisible();
  const authorize = page.getByRole('button', {
    name: 'Authorize transaction',
    exact: true,
  });
  await expect(authorize).toBeEnabled();
  await reachable(authorize);
  expect(
    await page.evaluate(() => window.__nativeSmartDappFixture.calls())
  ).toEqual([
    { method: 'editApprovalAmount', args: ['smart-request-1', 7, '1.234567'] },
  ]);
});

test('expiry during payer review removes consent and keeps Close reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-dapp=1');
  await page
    .getByRole('button', { name: 'Authorize transaction', exact: true })
    .click();
  await page.evaluate(() => window.__nativeSmartDappFixture.expire());
  await expect(
    page.getByText('Transaction unavailable', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm transaction', exact: true })
  ).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await reachable(close);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('smart-dapp-expired-320.png'),
  });
  await close.click();
  await expect(page.getByText('Request closed', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.__nativeSmartDappFixture.calls())
  ).toEqual([
    { method: 'approveRequest', args: ['smart-request-1', 7, true] },
    { method: 'rejectRequest', args: ['smart-request-1'] },
  ]);
});

test('invalid website cannot authorize and can be rejected without signing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-dapp=1&invalid-site=1');
  await expect(
    page.getByText('Website mismatch', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Authorize transaction', exact: true })
  ).toBeDisabled();
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await reachable(close);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('smart-dapp-invalid-site-320.png'),
  });
  await close.click();
  expect(
    await page.evaluate(() => window.__nativeSmartDappFixture.calls())
  ).toEqual([{ method: 'rejectRequest', args: ['smart-request-1'] }]);
});
