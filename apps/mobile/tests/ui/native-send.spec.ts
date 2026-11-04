import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
const recipient = '0x1111111111111111111111111111111111111111';
const passwordInput = (page: Page) =>
  page.getByLabel('Confirm your wallet password', { exact: true });

async function prepare(page: Page) {
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in ETH', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(passwordInput(page)).toBeVisible();
}

test('expired review requires a fresh password for the next review', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await prepare(page);
  const firstId = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await passwordInput(page).fill('Password for the expired review');
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();

  await page.clock.runFor(90001);
  await expect(passwordInput(page)).toHaveCount(0);
  await prepare(page);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.reviewId())
  ).not.toBe(firstId);
  await expect(passwordInput(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);

  await passwordInput(page).fill('Fresh password for the new review');
  await page.getByTestId('native-send-confirm').click();
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([
    { id: 'fixture-review-2', password: 'Fresh password for the new review' },
  ]);
});

test('replacement review clears the password while same-review updates preserve it', async ({
  page,
}) => {
  await page.goto('/');
  await prepare(page);
  const firstId = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await passwordInput(page).fill('Password belongs to the first review');
  await page.evaluate(() => window.__nativeSendFixture.refreshReview());
  await expect(passwordInput(page)).toHaveValue(
    'Password belongs to the first review'
  );
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();

  await page.evaluate(() => window.__nativeSendFixture.replaceReview());
  expect(
    await page.evaluate(() => window.__nativeSendFixture.reviewId())
  ).not.toBe(firstId);
  await expect(passwordInput(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
});

test('NEVM native send renders captured testnet and TSYS labels through depth confirmation', async ({
  page,
}) => {
  await page.goto('/?nevm-send');
  await expect(page.getByText('Send TSYS', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Account 1 · Syscoin NEVM Testnet · Test network', {
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByLabel('Syscoin NEVM Testnet address', { exact: true })
    .fill(recipient);
  await page.getByLabel('Amount in TSYS', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-amount')).toHaveText('0.001');
  await expect(page.getByTestId('native-send-fee')).toHaveText(
    '0.000000000000063 TSYS'
  );
  await expect(
    page.getByText('0.001000000000063 TSYS', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('12-confirmation depth policy', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      'Use test funds only. This transfer is on Syscoin NEVM Testnet (chain 5700).',
      { exact: true }
    )
  ).toBeVisible();

  // Review identity wins over a parent/current-context update.
  await page.evaluate(() => window.__nativeSendFixture.changeContext());
  await expect(page.getByTestId('native-send-fee')).toContainText('TSYS');
  await expect(
    page.getByText('Account 1 · Syscoin NEVM Testnet · Test network', {
      exact: true,
    })
  ).toBeVisible();
  await passwordInput(page).fill('Fixture testnet password');
  await page.getByTestId('native-send-confirm').click();
  await page.evaluate(() => window.__nativeSendFixture.settle('confirmed'));
  await expect(
    page.getByText('Depth confirmed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Syscoin NEVM Testnet transaction', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toHaveCount(0);
  await expect(page.getByText(/finalized/i)).toHaveCount(0);
});

test('NEVM reverted receipt keeps a depth label instead of protocol finality', async ({
  page,
}) => {
  await page.goto('/?nevm-send');
  await page
    .getByLabel('Syscoin NEVM Testnet address', { exact: true })
    .fill(recipient);
  await page.getByLabel('Amount in TSYS', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await passwordInput(page).fill('Fixture testnet password');
  await page.getByTestId('native-send-confirm').click();
  await page.evaluate(() => window.__nativeSendFixture.settle('reverted'));
  await expect(
    page.getByText('Reverted · depth confirmed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Account 1 · Syscoin NEVM Testnet · Test network', {
      exact: true,
    })
  ).toBeVisible();
  await page.evaluate(() =>
    window.__nativeSendFixture.settle('nonce-consumed')
  );
  await expect(
    page.getByText('Check account history', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Depth confirmed', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByText('Reverted · depth confirmed', { exact: true })
  ).toHaveCount(0);
});
