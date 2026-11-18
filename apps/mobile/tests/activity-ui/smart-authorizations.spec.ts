import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`signed instructions fit ${width}px and preserve unknown execution status`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 640 });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4181'
      ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/?signed-instructions');
    const cancel = page.getByRole('button', { name: 'Cancel instruction', exact: true });
    await expect(cancel).toBeVisible();
    await cancel.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const bounds = await cancel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`signed-instructions-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await expect(cancel).toHaveCount(0);
    await expect(page.getByText(/nonce.*used|nonce.*consumed/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'View transaction', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
