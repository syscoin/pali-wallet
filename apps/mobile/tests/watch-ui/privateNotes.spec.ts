import { authenticateNativeOperation, refuseNativeOperation, deviceAuthorizationPrompt, waitForNativePublicSession } from '../ui/operationAuthentication';
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

async function openNotesFromPublicWallet(page: Page) {
  await waitForNativePublicSession(page);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await button(page, /^Private notes/).click();
}

async function openNoteTools(page: Page, android = false) {
  await page.goto(`/?private-note-fixture${android ? '&android' : ''}`);
  await button(page, 'Accounts').click();
  await button(page, 'Open wallet').click();
  await openNotesFromPublicWallet(page);
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
  await expect(page.getByRole('button')).toHaveCount(3); // Back, individual backup, and Lock wallet
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
  await expect(button(page, 'Open wallet')).toBeVisible();
  await page.evaluate(() => window.__watchFixture.focus());
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
  await openNotesFromPublicWallet(page);
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
  await expect(button(page, 'Open wallet')).toBeVisible();
  await expect(heading(page, 'Note details')).toHaveCount(0);
  await expect(page.getByText('Restored note needs review', { exact: true })).toHaveCount(0);
  await openNotesFromPublicWallet(page);
  await expect(heading(page, 'Private notes')).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.notes.audit())).toEqual({ reads: 1, settled: 1, revoked: 0 });
});

const fixtureNote = (position: 1 | 2) => `tornado-eth-1-1-0x${`0${position}`.repeat(62)}`;
const shownNote = (page: Page, position: 1 | 2) => page.getByText(fixtureNote(position), { exact: true });
const authentication = deviceAuthorizationPrompt;
async function reveal(page: Page) {
  await button(page, 'Reveal private note').click();
  await authenticateNativeOperation(page);
  await expect(authentication(page)).toHaveCount(0);
}

async function openTwinNotes(page: Page) {
  await page.evaluate(() => window.__watchFixture.notes.next('twins'));
  await button(page, /^Saved notes/).click();
}

async function selectTwin(page: Page, position: 1 | 2) {
  await button(page, new RegExp(`^1 ETH pool.*Note ${position}`)).click();
  await button(page, 'Back up this note').click();
  await expect(heading(page, 'Back up this note')).toBeVisible();
}

test('individual backup authenticates once and reveals only the exact selected note', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    document.addEventListener('copy', () => { document.documentElement.dataset.noteClipboard = 'used'; });
    const attempted = async () => { document.documentElement.dataset.noteClipboard = 'used'; throw Error('Unexpected clipboard access'); };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: attempted, writeText: attempted, read: attempted, write: attempted } });
  });
  await openNoteTools(page);
  const rpcBefore = await page.evaluate(() => window.__watchFixture.notes.rpcCalls());
  await openTwinNotes(page);
  await selectTwin(page, 1);
  await expect(authentication(page)).toHaveCount(0);
  await expect(shownNote(page, 1)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('individual-note-backup-320.png') });
  await page.evaluate(() => window.__watchFixture.notes.holdReveal());
  await button(page, 'Reveal private note').evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw Error('Expected a reveal button');
    element.click();
    element.click();
  });
  await expect.poll(() => page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([1]);
  await refuseNativeOperation(page);
  await expect(authentication(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText('Could not show this note. Try again.');
  await expect(button(page, 'Reveal private note')).toBeEnabled();
  await expect(page.getByText('Synthetic private authentication diagnostic')).toHaveCount(0);
  await expect(shownNote(page, 1)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.notes.revealAudit())).toEqual({ attempts: [1], settled: 0, revoked: 0 });
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
  await button(page, 'Reveal private note').click();
  await expect.poll(() => page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([1, 1]);
  await authenticateNativeOperation(page);
  await expect(authentication(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    window.__watchFixture.notes.releaseReveal();
    return window.__watchFixture.notes.revealAudit().settled;
  })).toBe(1);
  await expect(shownNote(page, 1)).toBeVisible();
  await expect(shownNote(page, 2)).toHaveCount(0);
  await expect(page.getByText(/Anyone with this note can withdraw/)).toBeVisible();
  await expect(authentication(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /copy|share|download/i })).toHaveCount(0);
  expect(await shownNote(page, 1).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await button(page, 'Hide note').click();
  await expect(heading(page, 'Note details')).toBeVisible();
  await expect(shownNote(page, 1)).toHaveCount(0);
  await button(page, 'Back').click();
  await selectTwin(page, 2);
  await expect(authentication(page)).toHaveCount(0);
  await reveal(page);
  await expect(shownNote(page, 2)).toBeVisible();
  await expect(shownNote(page, 1)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.notes.revealAudit())).toEqual({ attempts: [1, 1, 2], settled: 2, revoked: 0 });
  expect(await page.evaluate(() => window.__watchFixture.notes.rpcCalls())).toBe(rpcBefore);
  expect(await page.evaluate(() => window.__watchFixture.shares())).toEqual([]);
  await expect(page.locator('html')).not.toHaveAttribute('data-note-clipboard', 'used');
});

test('the revealed note expires and requires fresh authentication', async ({ page }) => {
  await page.clock.install();
  await openNoteTools(page);
  await openTwinNotes(page);
  await selectTwin(page, 1);
  await reveal(page);
  await expect(shownNote(page, 1)).toBeVisible();
  await page.clock.fastForward(30_100);
  await expect(shownNote(page, 1)).toHaveCount(0);
  await expect(page.getByText('Private note hidden. Authorize again to view it.', { exact: true })).toBeVisible();
  await expect(authentication(page)).toHaveCount(0);
  await expect(button(page, 'Reveal private note')).toBeEnabled();
  expect(await page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([1]);
  await button(page, 'Reveal private note').click();
  await expect(authentication(page)).toBeVisible();
  await expect(shownNote(page, 1)).toHaveCount(0);
  await authenticateNativeOperation(page);
  await expect(shownNote(page, 1)).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([1, 1]);
});

test('leaving rejects a late reveal and Android blur clears the current secret', async ({ page }) => {
  await openNoteTools(page, true);
  await openTwinNotes(page);
  await selectTwin(page, 1);
  await page.evaluate(() => window.__watchFixture.notes.holdReveal());
  await reveal(page);
  await expect.poll(() => page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([1]);
  await button(page, 'Back').click();
  await expect(heading(page, 'Note details')).toBeVisible();
  await button(page, 'Back').click();
  await selectTwin(page, 2);
  await reveal(page);
  await expect(shownNote(page, 2)).toBeVisible();
  await page.evaluate(() => window.__watchFixture.notes.releaseReveal());
  await expect.poll(() => page.evaluate(() => window.__watchFixture.notes.revealAudit())).toEqual({ attempts: [1, 2], settled: 2, revoked: 1 });
  await expect(shownNote(page, 1)).toHaveCount(0);
  await expect(shownNote(page, 2)).toBeVisible();
  await page.evaluate(() => window.__watchFixture.blur());
  await expect(button(page, 'Open wallet')).toBeVisible();
  await expect(heading(page, 'Back up this note')).toHaveCount(0);
  await expect(shownNote(page, 2)).toHaveCount(0);
  await page.evaluate(() => window.__watchFixture.focus());
  await expect(page.getByRole('tab', { name: 'Wallet', exact: true })).toBeVisible();
  await openNotesFromPublicWallet(page);
  await expect(heading(page, 'Private notes')).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.notes.revealAudit().attempts)).toEqual([1, 2]);
});
