import { expect, type Page } from '@playwright/test';

/** Explicit browser-fixture response; it grants no native credential or signing proof. */
export async function authenticateNativeOperation(page: Page) {
  await page.getByRole('button', { name: 'Approve test device', exact: true }).click();
}

export async function refuseNativeOperation(page: Page) {
  await page.getByRole('button', { name: 'Cancel test device', exact: true }).click();
}

export function deviceAuthorizationPrompt(page: Page) {
  return page.getByText('Test device authorization', { exact: true });
}

export async function revealBackupPhrase(page: Page) {
  await page.getByRole('button', { name: 'Back Up Now', exact: true }).click();
  await authenticateNativeOperation(page);
}

export async function confirmFixtureBackup(page: Page) {
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const word of [...Array<string>(11).fill('abandon'), 'about']) {
    const choices = page.getByRole('button', { name: word, exact: true });
    let selected = false;
    for (let index = 0; index < await choices.count(); index++) {
      if (await choices.nth(index).isEnabled()) { await choices.nth(index).click(); selected = true; break; }
    }
    if (!selected) throw Error('The expected fixture recovery word is unavailable');
  }
  await page.getByRole('button', { name: 'Confirm backup', exact: true }).click();
}

/** Public entry deliberately has no PIN or device approval. */
export async function waitForNativePublicSession(page: Page) {
  const open = page.getByRole('button', { name: 'Open wallet', exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PIN digit 1', exact: true })).toHaveCount(0);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
}
