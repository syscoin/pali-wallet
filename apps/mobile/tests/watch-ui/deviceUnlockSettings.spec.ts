import { expect, test, type Page } from '@playwright/test';
import { enterPin } from '../ui/operationAuthentication';

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const state = (page: Page) => page.evaluate(() => window.__watchFixture.visual.state());

async function openSettings(page: Page, enabled: boolean) {
  await page.goto(`/?visual-review=1&device-unlock=${enabled ? '1' : '0'}`);
  await button(page, 'Open wallet').click();
  await enterPin(page, '123456');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await button(page, /^Security & backups/).click();
  await button(page, /^(Biometric unlock|Fingerprint unlock|Face ID)/).click();
  await expect(button(page, enabled ? /^Turn off / : /^Enable /)).toBeVisible();
  await expect(page.getByText('Confirm PIN', { exact: true })).toHaveCount(0);
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

test('enabling biometrics uses the shared PIN-only prompt and preserves a cancelled attempt', async ({ page }, info) => {
  await openSettings(page, false);
  await button(page, /^Enable /).click();
  await expect(heading(page, 'Authorize change')).toBeVisible();
  await expect(button(page, 'PIN digit 1')).toBeVisible();
  await expect(button(page, /Use (Face ID|fingerprint|biometrics)/)).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(button(page, /^Enable /)).toBeEnabled();
  expect((await state(page)).deviceUnlockEnabled).toBe(false);
  await button(page, /^Enable /).click();
  await page.screenshot({ path: info.outputPath('enable-shared-pin.png') });
  await enterPin(page, '123456');
  await expect(heading(page, 'Security & backups')).toBeVisible();
  expect((await state(page)).deviceUnlockEnabled).toBe(true);
});

test('disabling biometrics uses the enabled biometric method and survives its owned OS interruption', async ({ page }, info) => {
  await openSettings(page, true);
  await page.evaluate(() => window.__watchFixture.delayUnlock(true));
  await button(page, /^Turn off /).click();
  await expect(heading(page, 'Authorize change')).toBeVisible();
  await expect(page.getByText('Authorizing…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.lifecycle('inactive'));
  expect((await state(page)).deviceUnlockEnabled).toBe(true);
  await page.screenshot({ path: info.outputPath('disable-shared-biometric.png') });
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await page.evaluate(() => window.__watchFixture.releaseUnlock());
  await expect(heading(page, 'Security & backups')).toBeVisible();
  expect((await state(page)).deviceUnlockEnabled).toBe(false);
});
