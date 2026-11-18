import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`Smart Account Activity shows transaction details and hides consumed authorization actions at ${width}px`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 640 });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4181'
      ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/?signed-instructions');
    await expect(page.getByRole('button', { name: 'Signed instructions', exact: true })).toHaveCount(0);
    for (const operationHash of ['1', '3'])
      await expect(page.getByTestId(`activity-row-0x${operationHash.repeat(64)}`)).toHaveCount(0);
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

test('a pending Smart Account transaction opens the existing cancellation review', async ({ page }) => {
  await page.goto('/?signed-instructions&pending');
  await page.getByTestId(`activity-row-0x${'2'.repeat(64)}`).click();
  const cancel = page.getByRole('button', { name: 'Cancel instruction', exact: true });
  await expect(cancel).toHaveCount(1);
  await cancel.click();
  await expect(page.getByText('Cancellation review requested', { exact: true })).toBeVisible();
});
