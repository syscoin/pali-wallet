import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
const recipient = '0x4444444444444444444444444444444444444444';
async function contained(page: import('@playwright/test').Page) {
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
for (const width of [390, 320]) {
  test(`native Smart currency form and separate authorizations at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto('/?smart-currency=1');
    await expect(
      page.getByText('Balance 5.0 ETH', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Review transfer', exact: true })
    ).toBeDisabled();
    await page.screenshot({
      path: test.info().outputPath(`smart-send-form-${width}.png`),
    });
    await page.getByLabel('Recipient address', { exact: true }).fill(recipient);
    await page
      .getByLabel('Amount (ETH)', { exact: true })
      .fill('0.000000000000000009');
    await page
      .getByRole('button', { name: 'Review transfer', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Review transfer', exact: true })
    ).toBeVisible();
    await expect(page.getByText(recipient, { exact: true })).toBeVisible();
    await expect(
      page.getByText('0.000000000000000009', { exact: true })
    ).toBeVisible();
    await contained(page);
    await page
      .getByRole('heading', { name: 'Review transfer', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`smart-send-review-${width}.png`),
    });
    const authorize = page.getByRole('button', {
      name: 'Authorize transfer',
      exact: true,
    });
    await authorize.scrollIntoViewIfNeeded();
    await expect(authorize).toBeInViewport();
    expect((await authorize.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: test.info().outputPath(`smart-send-authorization-${width}.png`),
    });
    await authorize.click();
    const confirm = page.getByRole('button', {
      name: 'Confirm transfer',
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await expect(
      page.getByText('Paying account', { exact: true })
    ).toBeVisible();
    const close = page.getByRole('button', { name: 'Close', exact: true });
    await close.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(close).toBeInViewport({ ratio: 0.999 });
    await expect(confirm).toBeInViewport({ ratio: 0.999 });
    const closeBounds = await close.boundingBox();
    expect(closeBounds!.y).toBeGreaterThanOrEqual(0);
    expect(closeBounds!.y + closeBounds!.height).toBeLessThanOrEqual(
      width === 320 ? 568 : 844
    );
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);
    await contained(page);
    await page.screenshot({
      path: test.info().outputPath(`smart-send-payer-${width}.png`),
    });
    expect(
      await page.evaluate(() => window.__nativeSmartCurrencyFixture.calls())
    ).toEqual([{ method: 'open', value: '9' }, { method: 'authorize' }]);
    await confirm.click();
    await expect(
      page.getByText('Transfer submitted', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Authorize transfer', exact: true })
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__nativeSmartCurrencyFixture.calls())
    ).toEqual([
      { method: 'open', value: '9' },
      { method: 'authorize' },
      { method: 'submit' },
    ]);
    await page.screenshot({
      path: test.info().outputPath(`smart-send-submitted-${width}.png`),
    });
  });
}

test('invalid amount stays in the form with actionable feedback', async ({
  page,
}) => {
  await page.goto('/?smart-currency=1');
  await page.getByLabel('Recipient address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount (ETH)', { exact: true }).fill('1e9');
  await page
    .getByRole('button', { name: 'Review transfer', exact: true })
    .click();
  await expect(page.getByText('Check transfer', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Amount (ETH)', { exact: true })).toHaveValue(
    '1e9'
  );
  await expect(
    page.getByRole('button', { name: 'Authorize transfer', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__nativeSmartCurrencyFixture.calls())
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('smart-send-invalid.png'),
  });
});

test('unavailable balance and preparation preserve readable failure states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(
    '/?smart-currency=1&balance-unavailable=1&prepare-unavailable=1'
  );
  await expect(
    page.getByText('Balance unavailable', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('smart-send-unavailable-balance.png'),
  });
  await page.getByLabel('Recipient address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount (ETH)', { exact: true }).fill('1');
  await page
    .getByRole('button', { name: 'Review transfer', exact: true })
    .click();
  await expect(
    page.getByText('Check transfer status', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Authorize transfer', exact: true })
  ).toHaveCount(0);
  await contained(page);
  await page
    .getByRole('button', { name: 'Close', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('smart-send-unavailable-preparation.png'),
  });
});

test('MAX keeps the exact refined amount in the narrow authorization screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-currency=1');
  await expect(
    page.getByRole('button', { name: 'MAX', exact: true })
  ).toBeEnabled();
  await page.getByLabel('Recipient address', { exact: true }).fill(recipient);
  await page.getByRole('button', { name: 'MAX', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'MAX selected', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Review transfer', exact: true })
    .click();
  await expect(page.getByText('4.999789', { exact: true })).toBeVisible();
  await expect(page.getByText(recipient, { exact: true })).toBeVisible();
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('smart-max-review-320.png'),
  });
  const authorize = page.getByRole('button', {
    name: 'Authorize transfer',
    exact: true,
  });
  await authorize.scrollIntoViewIfNeeded();
  await expect(authorize).toBeInViewport();
  expect((await authorize.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => window.__nativeSmartCurrencyFixture.calls())
  ).toEqual([{ method: 'open', value: 'maximum' }]);
  await authorize.click();
  const confirm = page.getByRole('button', {
    name: 'Confirm transfer',
    exact: true,
  });
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await expect(confirm).toBeEnabled();
  await close.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(close).toBeInViewport({ ratio: 0.999 });
  await expect(confirm).toBeInViewport({ ratio: 0.999 });
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('smart-max-payer-320.png'),
  });
  await confirm.click();
  await expect(
    page.getByText('Transfer submitted', { exact: true })
  ).toBeVisible();
});
