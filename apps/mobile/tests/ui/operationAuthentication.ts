import type { Locator, Page } from '@playwright/test';

/** Explicit user action through the real PIN keypad with a public fixture PIN. */
export async function authenticateNativeOperation(page: Page) {
  await enterPin(page, '123456');
}

export async function enterPin(page: Page, pin: string) {
  if (!/^\d{1,6}$/.test(pin)) throw Error('A public test PIN must contain one to six digits');
  for (const digit of pin) await page.getByRole('button', { name: `PIN digit ${digit}`, exact: true }).click();
}

export function pinField(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..').getByRole('button');
}

export async function fillPinField(control: Locator, pin: string) {
  await control.click();
  await enterPin(control.page(), pin);
}

export async function revealBackupPhrase(page: Page) {
  await page.getByRole('button', { name: 'Back Up Now', exact: true }).click();
  await enterPin(page, '123456');
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
