import { test, expect } from '@playwright/test';

for (const width of [320, 390]) {
  test(`Activity options and copy stay on their public screen at ${width}px`, async ({ page, context }, info) => {
    await context.grantPermissions(['clipboard-write']);
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/');
    const activity = page.getByText('Activity', { exact: true });
    await expect(activity).toBeVisible();
    await page.getByRole('button', { name: 'Activity options', exact: true }).click();
    const options = page.getByRole('dialog', { name: 'Activity options', exact: true });
    await expect(options).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activity options', exact: true })).toHaveCount(0);
    await expect(options.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`activity-options-${width}.png`) });
    await options.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(options).toHaveCount(0);
    await expect(activity).toBeVisible();
    await page.getByRole('button', { name: /View transaction details/ }).first().click();
    const details = page.getByText('Transaction details', { exact: true });
    await expect(details).toBeVisible();
    const recipient = page.getByRole('button', { name: /^Copy recipient address:/ }).first();
    await recipient.click();
    const copy = page.getByRole('dialog', { name: 'Copy this address?', exact: true });
    await expect(copy).toBeVisible();
    await expect(copy.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`activity-copy-${width}.png`) });
    await copy.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(copy).toHaveCount(0);
    await expect(details).toBeVisible();
    await recipient.click();
    await copy.getByRole('button', { name: 'Copy full address', exact: true }).click();
    await expect(copy).toHaveCount(0);
    await expect(details).toBeVisible();
    await expect(page.getByText('Address copied. Verify it again before sending funds.', { exact: true })).toBeVisible();
  });
}
