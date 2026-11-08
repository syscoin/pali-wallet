import { expect, test } from '@playwright/test';
const baseURL = process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179';
test.use({ baseURL, viewport: { width: 320, height: 568 } });
const sample = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL).origin)
      throw new Error('Unexpected public request');
    return route.continue();
  });
});
test('raw note entry and verified result remain reachable at 320px', async ({
  page,
}, info) => {
  await page.goto('/?note-import');
  const input = page.getByRole('textbox', {
    name: 'Private note',
    exact: true,
  });
  await input.fill(sample);
  await page
    .getByRole('button', { name: 'Import note', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: 'Import note', exact: true })
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath('raw-note-import-320.png') });
  await page.getByRole('button', { name: 'Import note', exact: true }).click();
  await expect(page.getByText('Note saved', { exact: true })).toBeVisible();
  await expect(
    page.getByText('1 ETH pool · Verified in pool history', { exact: true })
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Done', exact: true })
  ).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('raw-note-import-saved-320.png'),
  });
});
test('keyboard-height error keeps Cancel reachable and clears input on reopen', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?note-import&not-found');
  await page
    .getByRole('textbox', { name: 'Private note', exact: true })
    .fill(sample);
  await page.getByRole('button', { name: 'Import note', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This note was not found in the verified pool history.'
  );
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('raw-note-import-error-keyboard-height.png'),
  });
  await cancel.click();
  await page
    .getByRole('button', { name: 'Import one note', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Private note', exact: true })
  ).toHaveValue('');
});
test('an already-spent note is saved without presenting it as spendable', async ({
  page,
}) => {
  await page.goto('/?note-import&spent');
  await page
    .getByRole('textbox', { name: 'Private note', exact: true })
    .fill(sample);
  await page.getByRole('button', { name: 'Import note', exact: true }).click();
  await expect(
    page.getByText('1 ETH pool · Already spent', { exact: true })
  ).toBeVisible();
});
