import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

for (const width of [320, 390]) for (const kind of ['evm', 'utxo'] as const) {
  test(`${kind} fee sheet keeps custom values and actions usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto(kind === 'utxo' ? '/?utxo-send' : '/');
    await page.getByRole('button', { name: /^Network Fee · Automatic$/ }).click();
    const custom = page.getByRole('button', { name: 'Custom', exact: true });
    await expect(custom).toBeEnabled();
    const low = page.getByRole('button', { name: 'Low', exact: true });
    const medium = page.getByRole('button', { name: 'Medium', exact: true });
    expect((await medium.boundingBox())!.height).toBeCloseTo((await low.boundingBox())!.height, 2);
    await custom.click();
    const price = page.getByRole('textbox', { name: kind === 'utxo' ? /sat\/vB/ : 'Maximum fee per gas (Gwei)', exact: kind !== 'utxo' });
    await expect(price).toBeVisible();
    await price.fill('0');
    const apply = page.getByRole('button', { name: 'Apply fee', exact: true });
    await apply.scrollIntoViewIfNeeded();
    await apply.click();
    await expect(page.getByText('Check the fee values and try again.', { exact: true })).toBeVisible();
    await price.fill(kind === 'utxo' ? '7' : '3');
    if (kind === 'evm') await page.getByRole('textbox', { name: 'Priority fee per gas (Gwei)', exact: true }).fill('1');
    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeInViewport({ ratio: 0.99 });
    expect((await apply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: info.outputPath(`${kind}-custom-fee-${width}.png`) });
    await apply.click();
    await expect(page.getByRole('button', { name: 'Network Fee · Custom', exact: true })).toBeVisible();
    await expect(apply).toHaveCount(0);
    await page.getByRole('button', { name: 'Network Fee · Custom', exact: true }).click();
    await expect(price).toHaveValue(kind === 'utxo' ? '7' : '3.0');
    await page.getByRole('button', { name: 'Automatic', exact: true }).click();
    await apply.click();
    await expect(page.getByRole('button', { name: 'Network Fee · Automatic', exact: true })).toBeVisible();
  });
}
