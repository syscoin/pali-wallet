import { expect, test } from '@playwright/test';
import { authenticateNativeOperation, deviceAuthorizationPrompt, refuseNativeOperation } from '../ui/operationAuthentication';

for (const [width, height] of [[320, 568], [390, 844]] as const) {
  test(`device refusal preserves the reviewed transfer and retry controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Ethereum address', exact: true }).fill('0x1111111111111111111111111111111111111111');
    await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.001');
    await page.getByTestId('native-send-review').click();
    const review = await page.evaluate(() => window.__nativeSendFixture.reviewId());
    expect(review).not.toBeNull();
    await page.getByTestId('native-send-confirm').click();
    await expect(deviceAuthorizationPrompt(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'PIN digit 0', exact: true })).toHaveCount(0);
    const cancel = page.getByRole('button', { name: 'Cancel test device', exact: true });
    await cancel.focus();
    await expect(cancel).toBeFocused();
    await expect.poll(() => cancel.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const center = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight && center !== null && element.contains(center);
    }), { message: 'The fixture device Cancel control must remain visible and uncovered' }).toBe(true);
    await refuseNativeOperation(page);
    await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
    await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
    expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
    expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(review);

    await page.getByTestId('native-send-confirm').click();
    await expect(deviceAuthorizationPrompt(page)).toBeVisible();
    await authenticateNativeOperation(page);
    await expect.poll(() => page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([{ id: review }]);
    await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
