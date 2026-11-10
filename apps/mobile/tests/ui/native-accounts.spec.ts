import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

test('actual account screen creates, selects, renames, removes and re-adds an address', async ({ page }) => {
  await page.goto('/?accounts=1');
  await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
  await expect(page.getByText('Selected', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Savings');
  await page.getByLabel('Confirm wallet password', { exact: true }).fill('Public fixture password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Savings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select Account 1', exact: true }).click();
  const savings = page.getByRole('button', { name: 'Select Savings', exact: true }).locator('..');
  await savings.getByRole('button', { name: 'Rename Savings', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Travel');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  const travel = page.getByRole('button', { name: 'Select Travel', exact: true }).locator('..');
  await travel.getByRole('button', { name: 'Remove Travel', exact: true }).click();
  await expect(page.getByText('Your funds stay at this address', { exact: true })).toBeVisible();
  await page.getByLabel('Confirm wallet password', { exact: true }).fill('Public fixture password');
  await page.getByRole('button', { name: 'Remove from this device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Travel', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Account 3');
  await expect(page.getByLabel('Confirm wallet password', { exact: true })).toHaveValue('');
  await page.getByLabel('Confirm wallet password', { exact: true }).fill('Public fixture password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Account 3', exact: true })).toBeVisible();
  const requests = await page.evaluate(() => window.__nativeAccountsFixture.requests());
  expect(requests.map((request) => request.kind)).toEqual(['create', 'select', 'rename', 'remove', 'create']);
  expect(requests.at(-1)).toMatchObject({ kind: 'create', label: 'Account 3' });
});

test('context replacement clears typed account credentials and requires a fresh form', async ({ page }) => {
  await page.goto('/?accounts=1');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Private label');
  await page.getByLabel('Confirm wallet password', { exact: true }).fill('Must be cleared');
  await page.evaluate(() => window.__nativeAccountsFixture.revise());
  await expect(page.getByLabel('Confirm wallet password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByLabel('Account name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Confirm wallet password', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeAccountsFixture.requests())).toEqual([]);
});

test('account screen stays within a narrow viewport and renders its actual create form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?accounts=1');
  await expect(page.getByRole('button', { name: 'Select Account 2', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pali-hd-accounts-list.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Savings');
  await page.screenshot({ path: testInfo.outputPath('pali-hd-accounts-create.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('expected account limit rejection remains visible without changing the ready context', async ({ page }) => {
  await page.goto('/?accounts=1&failure=limit');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Savings');
  await page.getByLabel('Confirm wallet password', { exact: true }).fill('Public fixture password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('There is not enough protected storage for this account.');
  await expect(page.getByLabel('Confirm wallet password', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeAccountsFixture.contextRevision())).toBe(0);
});

for (const [failure, message] of [
  ['credential', 'That password is incorrect. Unlock your wallet to try again.'],
  ['uncertain', 'Pali could not confirm the saved wallet state.'],
] as const) {
  test(`parent retains safe feedback after ${failure} unmounts account controls`, async ({ page }) => {
    await page.goto(`/?accounts=1&failure=${failure}`);
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByLabel('Account name', { exact: true }).fill('Savings');
    await page.getByLabel('Confirm wallet password', { exact: true }).fill('Public fixture password');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByLabel('Confirm wallet password', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByText('Wallet locked', { exact: true })).toBeVisible();
  });
}


test('a thousand retained accounts use a bounded rendered window with reachable controls', async ({page}, testInfo) => {
  await page.setViewportSize({width: 320, height: 740});
  await page.goto('/?accounts=1&many-accounts=1');
  await expect(page.getByTestId('native-accounts-list')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeAccountsFixture.count())).toBe(1000);
  await expect(page.getByRole('button', {name: 'Select Account 1', exact: true})).toBeVisible();
  expect(await page.getByRole('button', {name: /^Select Account /}).count()).toBeLessThan(100);
  await expect(page.getByRole('button', {name: 'Add account', exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('pali-thousand-accounts.png'), fullPage: false});
  // Variable-height rows preserve Dynamic Type. Advance real scroll events
  // through the virtual window until the final retained row is measured.
  await page.getByTestId('native-accounts-list').hover();
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await page.getByRole('button', {name: 'Select Account 1000', exact: true}).isVisible()) break;
    await page.mouse.wheel(0, 1000000);
    await page.waitForTimeout(50);
  }
  await expect(page.getByRole('button', {name: 'Select Account 1000', exact: true})).toBeVisible();
  expect(await page.getByRole('button', {name: /^Select Account /}).count()).toBeLessThan(100);
  await page.getByRole('button', {name: 'Select Account 1000', exact: true}).click();
  expect(await page.evaluate(() => window.__nativeAccountsFixture.requests().at(-1))).toEqual({kind: 'select', id: 'hd:60:999'});
  expect(await page.evaluate(() => window.__nativeAccountsFixture.count())).toBe(1000);

});
