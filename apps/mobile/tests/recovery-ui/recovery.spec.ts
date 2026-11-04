import { test, expect, type Page } from '@playwright/test';

const PHRASE = `${'abandon '.repeat(11)}about`;
const WORDS24 = `${'abandon '.repeat(23)}art`;
const PASSWORD = 'public fixture password';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4188') { await route.continue(); return; }
    await route.abort('blockedbyclient'); throw Error('Unexpected external request in recovery leaf test');
  });
});
async function entry(page: Page, query = '') {
  await page.goto(`/${query}`); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Matching recovery phrase', exact: true })).toBeVisible();
}
async function fill(page: Page, phrase = PHRASE) {
  await page.getByRole('textbox', { name: 'Matching recovery phrase', exact: true }).fill(phrase);
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm new password', { exact: true }).fill(PASSWORD);
}

test('scope gives exact saved-data and imported-backup limits without a phrase-match claim', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Recover access', exact: true })).toBeVisible();
  await expect(page.getByText('Seed-derived accounts', { exact: true })).toBeVisible();
  await expect(page.getByText('6 tokens · 7 saved summaries', { exact: true })).toBeVisible();
  await expect(page.getByText(/Existing recovery phrase backup: not confirmed/)).toBeVisible();
  await expect(page.getByText('Private notes are not supported by this recovery.', { exact: true })).toBeVisible();
  await expect(page.getByText(/phrase alone cannot recreate imported accounts on a new or lost device/)).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText('Your phrase matches this saved wallet.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Saved-data details', exact: true }).click();
  await expect(page.getByText('Retired imported account records', { exact: true })).toBeVisible();
  await expect(page.getByText('Cached transactions', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('recovery-scope-public.png'), fullPage: true });
});

test('field errors remain local, admitted input clears, and explicit review precedes a single commit', async ({ page }, info) => {
  await entry(page); await fill(page);
  await page.getByLabel('Confirm new password', { exact: true }).fill('different public password');
  await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The new passwords do not match.');
  await expect(page.getByRole('textbox', { name: /Confirm new password The new passwords do not match/ })).toBeVisible();
  await page.getByRole('textbox', { name: /Confirm new password/ }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
  await expect(page.getByText('Verifying your wallet…', { exact: true })).toBeVisible();
  await expect(page.locator('input, textarea')).toHaveCount(0);
  const snapshot = await page.evaluate(() => JSON.stringify(window.__recoveryFixture.snapshot()));
  expect(snapshot).not.toContain(PHRASE); expect(snapshot).not.toContain(PASSWORD);
  await page.evaluate(() => window.__recoveryFixture.verify('match'));
  await expect(page.getByText('Your phrase matches this saved wallet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('recovery-review-public.png'), fullPage: true });
  await page.getByRole('button', { name: 'Change password', exact: true }).evaluate((button) => { (button as HTMLElement).click(); (button as HTMLElement).click(); });
  expect((await page.evaluate(() => window.__recoveryFixture.audit())).commits).toBe(1);
  await expect(page.getByText('Leaving now stops this screen. The password change may already have completed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave recovery', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('It may have completed. Unlock with your new password first');
});

test('wrong-phrase retry starts empty and accepts a 24-word input without retaining either phrase', async ({ page }) => {
  await entry(page); await fill(page); await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
  await page.evaluate(() => window.__recoveryFixture.verify('wrong'));
  await expect(page.getByRole('alert')).toHaveText('This recovery phrase does not match this wallet.');
  await expect(page.getByRole('textbox', { name: 'Matching recovery phrase', exact: true })).toHaveValue('');
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Confirm new password', { exact: true })).toHaveValue('');
  await fill(page, WORDS24); await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
  expect((await page.evaluate(() => window.__recoveryFixture.audit())).admittedWordCounts).toEqual([12, 24]);
  expect(await page.evaluate(() => JSON.stringify(window.__recoveryFixture.snapshot()))).not.toContain(WORDS24);
});

for (const stage of ['entry', 'verifying', 'review'] as const) test(`background cancels ${stage} and a late match cannot restore fields or review`, async ({ page }) => {
  await entry(page); await fill(page);
  if (stage !== 'entry') await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
  if (stage === 'review') await page.evaluate(() => window.__recoveryFixture.verify('match'));
  await page.evaluate(() => { window.__recoveryFixture.lifecycle('background'); window.__recoveryFixture.verify('match'); });
  await expect(page.getByText('Recovery was cancelled', { exact: true })).toBeVisible();
  await expect(page.locator('input, textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toHaveCount(0);
});

test('Back clears entry before scope, and unmount cancels the leaf flow', async ({ page }) => {
  await entry(page, '?android'); await fill(page);
  await page.evaluate(() => window.__recoveryFixture.back());
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Matching recovery phrase', exact: true })).toHaveValue('');
  await fill(page); await page.evaluate(() => window.__recoveryFixture.unmount());
  await expect(page.getByText('Recovery fixture closed', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__recoveryFixture.audit())).cancels).toBe(1);
});

test('unavailable saved data is blocked without invented zero counts or editable secrets', async ({ page }) => {
  await page.goto('/?unavailable');
  await expect(page.getByRole('heading', { name: 'Recovery unavailable', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Nothing has been reset.');
  await expect(page.getByText('Seed-derived accounts', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(page.locator('input, textarea')).toHaveCount(0);
});

test('reading remains cancellable and 320px large-text footer stays operable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/?reading');
  await expect(page.getByText('Checking saved wallet data…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel recovery', exact: true })).toBeVisible();
  await page.evaluate(() => window.__recoveryFixture.read());
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 28px !important; line-height: 1.4 !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  const bounds = await next.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.height).toBeGreaterThanOrEqual(52); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: info.outputPath('recovery-scope-large-public.png'), fullPage: true });
  await next.click(); await fill(page);
  await page.setViewportSize({ width: 320, height: 390 });
  await expect(page.getByRole('button', { name: 'Verify wallet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify wallet', exact: true }).click();
  await expect(page.locator('input, textarea')).toHaveCount(0);
});
