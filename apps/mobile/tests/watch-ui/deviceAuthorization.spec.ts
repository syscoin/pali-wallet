import { expect, test } from '@playwright/test';
import { waitForNativePublicSession, deviceAuthorizationPrompt } from '../ui/operationAuthentication';

test('public wallet and security settings have no Pali PIN or biometric toggle', async ({ page }, info) => {
  await page.goto('/?visual-review=1');
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await waitForNativePublicSession(page);
  await page.screenshot({ path: info.outputPath('os-public-home.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Security & backups/ }).click();
  await expect(page.getByRole('button', { name: /Change PIN|Enable biometrics|Turn off Face ID|Fingerprint unlock/ })).toHaveCount(0);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Auto-lock/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /View recovery phrase/ })).toBeVisible();
});

test('creation requests explicit device authorization without an app PIN setup', async ({ page }, info) => {
  await page.goto('/?visual-review=1&native-empty=1');
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  await page.getByRole('button', { name: /^Create a wallet/ }).click();
  await expect(page.getByRole('button', { name: 'PIN digit 1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Secure with your device/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('os-onboarding-protection.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create wallet', exact: true }).click();
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.visual.state())).present).toBe(false);
  await page.getByRole('button', { name: 'Cancel test device', exact: true }).click();
  expect((await page.evaluate(() => window.__watchFixture.visual.state())).present).toBe(false);
});
