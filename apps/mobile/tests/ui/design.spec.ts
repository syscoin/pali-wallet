import { test, expect, type Page } from '@playwright/test';
async function open(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Review full wallet design', exact: true })
    .click();
  await expect(
    page.getByText('DESIGN ONLY · SAMPLE DATA', { exact: true })
  ).toBeVisible();
}
async function choose(page: Page, id: string, mobile = false) {
  if (mobile)
    await page.getByRole('button', { name: 'Choose design screen' }).click();
  await page.getByRole('textbox', { name: 'Search design screens' }).fill(id);
  await page.getByTestId(`design-open-${id}`).click();
}
test('design Back closes panels, follows local history and exits to welcome', async ({
  page,
}) => {
  await open(page, 390, 844);
  await choose(page, 'transfer.eth-details', true);
  await expect(page.getByTestId('design-phone')).toContainText('Send ETH');
  await page
    .getByRole('button', { name: 'Design notes and account scenario' })
    .click();
  await expect(page.getByText('SAFETY BOUNDARY', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('SAFETY BOUNDARY', { exact: true })).not.toBeVisible();
  await expect(page.getByTestId('design-phone')).toContainText('Send ETH');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('design-phone')).toContainText('Portfolio value');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Review full wallet design', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('design-phone')).toHaveCount(0);
});
test('full design covers product roots and never requests a live endpoint', async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4178')) requests.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  for (const id of [
    'wallet.home',
    'onboarding.phrase',
    'transfer.eth-review',
    'connections.typed-data',
    'smart.composite',
    'privacy.deposit-review',
    'sentry.operation',
    'settings.remove',
  ]) {
    await choose(page, id);
    await expect(page.getByTestId('design-phone')).toBeVisible();
    await expect(
      page.getByTestId('design-phone').getByRole('textbox')
    ).toHaveCount(0);
  }
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    }))
  ).toEqual({ local: 0, session: 0 });
});
test('EVM and sign-only journeys retain their identity', async ({ page }) => {
  await open(page);
  await choose(page, 'transfer.eth-details');
  await page.getByTestId('design-primary-action').click();
  const phone = page.getByTestId('design-phone');
  await expect(
    phone.getByRole('button', {
      name: 'Network: Ethereum. View network design.',
    })
  ).toBeVisible();
  await expect(phone.getByText('0.250042 ETH', { exact: true })).toBeVisible();
  await page.getByTestId('design-primary-action').click();
  await expect(phone.getByText('0.25 ETH', { exact: true })).toBeVisible();
  await expect(phone.getByText('Wallet password', { exact: true })).toHaveCount(0);
  await choose(page, 'transfer.psbt');
  await page.getByTestId('design-primary-action').click();
  await expect(
    phone.getByText('Signed data returned', { exact: true })
  ).toBeVisible();
  await expect(phone.getByText(/No transaction was broadcast/)).toBeVisible();
  await choose(page, 'transfer.eth-review');
  await page.getByRole('radio', { name: 'Hardware', exact: true }).click();
  await page.getByRole('button', { name: 'Return to review', exact: true }).click();
  await page.getByTestId('design-primary-action').click();
  await expect(phone.getByText('Check your device.', { exact: true })).toBeVisible();
  await expect(phone.getByText('Wallet password', { exact: true })).toHaveCount(0);
});
test('account and review scenarios expose safe unavailable states', async ({
  page,
}) => {
  await open(page);
  await choose(page, 'transfer.btc-review');
  await page.getByRole('radio', { name: 'Watch-only', exact: true }).click();
  await expect(
    page.getByText('Review the updated request', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Return to review', exact: true })
    .click();
  await expect(
    page.getByTestId('design-phone').getByText('This account is watch-only')
  ).toBeVisible();
  await expect(page.getByTestId('design-primary-action')).toBeDisabled();
  await page.getByRole('radio', { name: 'Personal', exact: true }).click();
  await page
    .getByRole('radio', { name: 'Review expired', exact: true })
    .click();
  await expect(
    page.getByText('This review has expired', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('design-primary-action')).toBeDisabled();
  await page.getByRole('button', { name: 'Review again', exact: true }).click();
  await expect(
    page
      .getByTestId('design-phone')
      .getByRole('button', { name: 'Network: Bitcoin. View network design.' })
  ).toBeVisible();
});
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`design chooser and notes fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await open(page, viewport.width, viewport.height);
    await choose(page, 'privacy.backup-review', true);
    await expect(
      page.getByTestId('design-phone').getByText('PRIVATE-NOTE-PLACEHOLDER')
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBeTruthy();
  });
}

test('note-vault package restoration previews a merge without accepting secrets', async ({
  page,
}) => {
  await open(page);
  await choose(page, 'privacy.bundle-import');
  const phone = page.getByTestId('design-phone');
  await expect(phone.getByRole('textbox')).toHaveCount(0);
  await page.getByTestId('design-primary-action').click();
  await expect(
    phone.getByText('Existing notes', { exact: true })
  ).toBeVisible();
  await expect(
    phone.getByText('Current state and reservations kept unchanged', { exact: true })
  ).toBeVisible();
  await page.getByTestId('design-primary-action').click();
  await expect(
    phone.getByText('Destination wallet password', { exact: true })
  ).toBeVisible();
  await page.getByTestId('design-primary-action').click();
  await expect(
    phone.getByText('Note saved. Verification pending.', { exact: true })
  ).toBeVisible();
  await page.getByTestId('design-primary-action').click();
  await expect(
    phone.getByText('Needs chain verification · withdrawal unavailable', { exact: true })
  ).toBeVisible();
});

test('local key administration and relayed note recovery are separate from account signing', async ({
  page,
}) => {
  await open(page);
  await choose(page, 'sentry.service-review');
  await page.getByTestId('design-primary-action').click();
  await page.getByRole('radio', { name: 'Hardware', exact: true }).click();
  await page
    .getByRole('button', { name: 'Return to review', exact: true })
    .click();
  await page.getByTestId('design-primary-action').click();
  const phone = page.getByTestId('design-phone');
  await expect(
    phone.getByText('Wallet password', { exact: true })
  ).toBeVisible();
  await expect(
    phone.getByText('Check your device.', { exact: true })
  ).toHaveCount(0);
  await choose(page, 'privacy.withdraw-review');
  await page.getByRole('radio', { name: 'Watch-only', exact: true }).click();
  await page
    .getByRole('button', { name: 'Return to review', exact: true })
    .click();
  await expect(
    phone.getByText('Relayed withdrawal', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('design-primary-action')).toBeEnabled();
});
