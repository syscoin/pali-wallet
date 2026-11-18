import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`Smart Account Activity fits ${width}px and preserve unknown execution status`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 640 });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4181'
      ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/?signed-instructions');
    await expect(page.getByRole('button', { name: 'Signed instructions', exact: true })).toHaveCount(0);
    await page.getByTestId(`activity-row-0x${'1'.repeat(64)}`).click();
    const cancel = page.getByRole('button', { name: 'Cancel instruction', exact: true });
    await expect(page.getByText('Nonce consumed; outcome unknown', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`signed-instructions-${width}.png`), fullPage: true });
    await expect(page.getByRole('button', { name: 'Check status', exact: true })).toHaveCount(0);
    await expect(cancel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View transaction', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
