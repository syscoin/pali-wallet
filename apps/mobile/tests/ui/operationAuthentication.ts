import type { Page } from '@playwright/test';

/** Explicit user action through the real authentication modal with a public fixture password. */
export async function authenticateNativeOperation(page: Page) {
  await page.getByLabel('Wallet password', { exact: true }).fill('public-password');
  await page.getByRole('button', { name: 'Confirm transaction', exact: true }).click();
}
