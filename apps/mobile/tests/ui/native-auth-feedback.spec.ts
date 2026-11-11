import { expect, test } from '@playwright/test';
import { authenticateNativeOperation, deviceAuthorizationPrompt, refuseNativeOperation } from './operationAuthentication';

test.use({ baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179' });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4179' ? route.continue() : route.abort());
});

// The browser port tests app feedback and consent ownership, not an OS biometric sheet.
for (const [mode, width, height] of [['narrow', 320, 568], ['standard', 390, 844], ['reduced-motion', 390, 844]] as const) {
  test(`device refusal keeps the review retryable: ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference' });
    await page.goto('/');
    await page.getByLabel('Ethereum address', { exact: true }).fill('0x' + '1'.repeat(40));
    await page.getByLabel('Amount in ETH', { exact: true }).fill('0.001');
    await page.getByTestId('native-send-review').click();
    const review = await page.evaluate(() => window.__nativeSendFixture.reviewId());
    expect(review).not.toBeNull();
    await page.getByTestId('native-send-confirm').click();
    await expect(deviceAuthorizationPrompt(page)).toBeVisible();
    await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'PIN digit 0', exact: true })).toHaveCount(0);
    await refuseNativeOperation(page);
    await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText('Device authentication was not completed. Please try again.');
    await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
    expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(review);
    expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
    await page.getByTestId('native-send-confirm').click();
    await expect(deviceAuthorizationPrompt(page)).toBeVisible();
    await authenticateNativeOperation(page);
    await expect.poll(() => page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([{ id: review }]);
    await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  });
}
