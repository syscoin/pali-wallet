import { expect, test, type Page } from '@playwright/test';

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === baseURL) return route.continue();
    await route.abort('blockedbyclient');
    throw Error('Unexpected external request in saved notes test');
  });
});

async function unlock(page: Page) {
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('public-password');
  await button(page, 'Unlock wallet').click();
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await button(page, /^Private notes/).click();
}

async function openNoteTools(page: Page, android = false) {
  await page.goto(`/?private-note-fixture${android ? '&android' : ''}`);
  await button(page, 'Accounts').click();
  await button(page, 'Open wallet').click();
  await unlock(page);
}

test('private notes shows a real empty list and retains the existing Tools routes', async ({ page }) => {
  await openNoteTools(page);
  await expect(heading(page, 'Private notes')).toBeVisible();
  await button(page, /^Back up private notes/).click();
  await expect(heading(page, 'Back up private notes')).toBeVisible();
  await button(page, 'Back').click();
  await button(page, /^Restore note backup/).click();
  await expect(heading(page, 'Restore private notes')).toBeVisible();
  await button(page, 'Back').click();
  await button(page, /^Note capacity/).click();
  await expect(page.getByText('0 of 128 notes saved', { exact: true })).toBeVisible();
  await button(page, 'Back').click();
  await page.evaluate(() => window.__watchFixture.notes.next('empty', true));
  await button(page, /^Saved notes/).click();
  await expect(page.getByText('Loading saved notes…', { exact: true })).toBeVisible();
  await expect(page.getByText('No saved notes', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.notes.release());
  await expect(page.getByText('No saved notes', { exact: true })).toBeVisible();
  await button(page, 'Back').click();
  await expect(heading(page, 'Private notes')).toBeVisible();
  await button(page, 'Back').click();
  await expect(page.getByRole('tab', { name: 'Tools', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 1, settled: 1, revoked: 0 });
});

test('saved-note detail shows unchecked status and separate local hints at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openNoteTools(page);
  const rpcBefore = await page.evaluate(() => window.__watchFixture.notes.rpcCalls());
  await page.evaluate(() => window.__watchFixture.notes.next('error'));
  await button(page, /^Saved notes/).click();
  await expect(page.getByRole('alert')).toHaveText('Could not load saved notes.');
  await expect(page.getByText('Synthetic private storage diagnostic')).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.notes.next('saved'));
  await button(page, 'Retry').click();
  const restored = button(page, /^1 ETH pool.*Note 1/);
  await expect(restored).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('saved-notes-320.png') });
  await restored.focus();
  await restored.press('Enter');
  await expect(heading(page, 'Note details')).toBeVisible();
  await expect(page.getByText('Status not checked', { exact: true })).toBeVisible();
  await expect(page.getByText('Restored note needs review', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved withdrawal history', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(2); // Back and Lock wallet
  await expect(page.getByRole('link')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('saved-note-detail-320.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await button(page, 'Back').click();
  await button(page, /^10 ETH pool.*Note 2/).click();
  await expect(page.getByText('Saved withdrawal history', { exact: true })).toBeVisible();
  await expect(page.getByText('Restored note needs review', { exact: true })).toHaveCount(0);
  await button(page, 'Back').click();
  await button(page, /^0\.1 ETH pool.*Note 3/).click();
  await expect(page.getByText('Status not checked', { exact: true })).toBeVisible();
  await expect(page.getByText(/Restored note needs review|Saved withdrawal history/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 2, settled: 2, revoked: 0 });
  expect(await page.evaluate(() => window.__watchFixture.notes.rpcCalls())).toBe(rpcBefore);
  const audit = await page.evaluate(() => window.__watchFixture.audit());
  expect(audit.unlocks).toBe(1);
  expect(audit.keyReads + audit.signs + audit.broadcasts).toBe(0);
  await button(page, 'Lock wallet').click();
  await expect(button(page, 'Unlock wallet')).toBeVisible();
  await expect(page.getByText('Status not checked', { exact: true })).toHaveCount(0);
});

test('paging mounts no more than 20 rows and detail Back returns to the same page', async ({ page }) => {
  await openNoteTools(page);
  await page.evaluate(() => window.__watchFixture.notes.next('paged'));
  await button(page, /^Saved notes/).click();
  await expect(page.getByText('Notes 1–20 of 21', { exact: true })).toBeVisible();
  await expect(button(page, /^1 ETH pool/)).toHaveCount(20);
  await expect(button(page, 'Previous')).toBeDisabled();
  await button(page, 'Next').click();
  await expect(page.getByText('Notes 21–21 of 21', { exact: true })).toBeVisible();
  await expect(button(page, /^1 ETH pool/)).toHaveCount(1);
  await expect(button(page, 'Next')).toBeDisabled();
  await button(page, /^1 ETH pool.*Note 21/).click();
  await expect(heading(page, 'Note details')).toBeVisible();
  await button(page, 'Back').click();
  await expect(button(page, /^1 ETH pool.*Note 21/)).toBeVisible();
  await button(page, 'Previous').click();
  await expect(button(page, /^1 ETH pool/)).toHaveCount(20);
  expect(await page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 1, settled: 1, revoked: 0 });
});

test('Back and Android blur suppress late results after reopening the same wallet and route', async ({ page }) => {
  await openNoteTools(page, true);
  await page.evaluate(() => window.__watchFixture.notes.next('stale', true));
  await button(page, /^Saved notes/).click();
  await expect(page.getByText('Loading saved notes…', { exact: true })).toBeVisible();
  await button(page, 'Back').click();
  await page.evaluate(() => window.__watchFixture.notes.next('saved'));
  await button(page, /^Saved notes/).click();
  await expect(button(page, /^1 ETH pool/)).toBeVisible();
  await page.evaluate(() => window.__watchFixture.notes.release());
  await expect.poll(() => page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 2, settled: 2, revoked: 1 });
  await expect(button(page, /^100 ETH pool/)).toHaveCount(0);
  await expect(button(page, /^1 ETH pool/)).toBeVisible();
  await button(page, 'Back').click();
  await page.evaluate(() => window.__watchFixture.notes.next('error', true));
  await button(page, /^Saved notes/).click();
  await expect(page.getByText('Loading saved notes…', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(button(page, 'Unlock wallet')).toBeVisible();
  await unlock(page);
  await button(page, /^Saved notes/).click();
  await expect(page.getByText('No saved notes', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.notes.release());
  await expect.poll(() => page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 4, settled: 4, revoked: 2 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('No saved notes', { exact: true })).toBeVisible();
});

test('an authority-owned lock closes note details and does not reopen them on unlock', async ({ page }) => {
  await openNoteTools(page);
  await page.evaluate(() => window.__watchFixture.notes.next('saved'));
  await button(page, /^Saved notes/).click();
  await button(page, /^1 ETH pool.*Note 1/).click();
  await expect(heading(page, 'Note details')).toBeVisible();
  await page.evaluate(() => window.__watchFixture.notes.lockAuthority());
  await expect(button(page, 'Unlock wallet')).toBeVisible();
  await expect(heading(page, 'Note details')).toHaveCount(0);
  await expect(page.getByText('Restored note needs review', { exact: true })).toHaveCount(0);
  await unlock(page);
  await expect(heading(page, 'Private notes')).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 1, settled: 1, revoked: 0 });
});
