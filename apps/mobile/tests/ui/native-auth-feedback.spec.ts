import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179' });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4179' ? route.continue() : route.abort());
});

for (const mode of ['pin', 'biometric', 'reduced-motion'] as const) test(`authentication error feedback: ${mode}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference' });
  await page.goto(mode === 'biometric' ? '/?biometric-auth=1&biometric-fallback=1' : '/');
  await page.getByLabel('Ethereum address', { exact: true }).fill('0x' + '1'.repeat(40));
  await page.getByLabel('Amount in ETH', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await page.getByTestId('native-send-confirm').click();
  if (mode !== 'biometric') for (let digit = 0; digit < 6; digit++) await page.getByRole('button', { name: 'PIN digit 0', exact: true }).click();
  const feedback = page.getByTestId('pin-error-feedback');
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  const positions = await feedback.evaluate(element => new Promise<number[]>(resolve => {
    const values: number[] = [], started = performance.now();
    const sample = () => {
      const transform = getComputedStyle(element).transform;
      values.push(transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41);
      if (performance.now() - started < 500) requestAnimationFrame(sample);
      else resolve(values);
    };
    sample();
  }));
  if (mode === 'reduced-motion') expect(positions.every(value => value === 0)).toBe(true);
  else expect(positions.some(value => Math.abs(value) > 0.1)).toBe(true);
  expect(positions.at(-1)).toBe(0);
  await expect(page.getByLabel('PIN, 0 of 6 digits entered', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
});
