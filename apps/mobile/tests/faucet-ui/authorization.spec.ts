import { expect, test } from '@playwright/test';

for (const [width, height] of [[320, 568], [390, 844]] as const) {
  test(`biometric refusal keeps the PIN keypad usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('/?biometric-auth=1&biometric-fallback=1');
    await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill('0x1111111111111111111111111111111111111111');
    await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
    await page.getByTestId('native-send-review').click();
    await page.getByTestId('native-send-confirm').click();
    await expect(page.getByRole('button', { name: 'Use biometrics', exact: true })).toBeVisible();
    const zero = page.getByRole('button', { name: 'PIN digit 0', exact: true });
    await expect.poll(() => zero.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const center = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight && center !== null && element.contains(center);
    }), { message: 'PIN zero must be visible and uncovered by the biometric action' }).toBe(true);
    await zero.click();
    await expect(page.getByLabel('PIN, 1 of 6 digits entered', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete PIN digit', exact: true }).click();
    await expect(page.getByLabel('PIN, 0 of 6 digits entered', { exact: true })).toBeVisible();
  });
}
