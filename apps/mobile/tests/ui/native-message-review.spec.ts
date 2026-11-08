import { expect, test } from '@playwright/test';

test('shows complete typed data and reachable signing controls on a narrow large-text screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://127.0.0.1:4179/?message-review=1&typed=1&font-scale=1.6');
  await expect(page.getByText('https://example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText(/End of signed data/)).toHaveCount(1);
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  await reject.scrollIntoViewIfNeeded();
  await expect(reject).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('message-review-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign typed data', exact: true }).click();
  await expect(page.getByText('Request completed')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeMessageReviewFixture.calls()))
    .toEqual([{ method: 'approveMessage', args: ['message-1', 7, false] }]);
});

test('keeps invalid requests blocked and rejection available', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&blocked=1');
  await expect(page.getByRole('button', { name: 'Sign message', exact: true })).toBeDisabled();
  await expect(page.getByText('The app is asking for a signature from a different account.')).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  expect(await page.evaluate(() => window.__nativeMessageReviewFixture.calls()))
    .toEqual([{ method: 'rejectMessage', args: ['message-1'] }]);
});

test('switches the requested account before offering a separate signing action', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&switch=1');
  await expect(page.getByRole('button', { name: 'Sign message', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign message', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__nativeMessageReviewFixture.calls()))
    .toEqual([{ method: 'activateMessageAccount', args: ['message-1', 7] }]);
  await page.getByRole('button', { name: 'Sign message', exact: true }).click();
  expect(await page.evaluate(() => window.__nativeMessageReviewFixture.calls()))
    .toEqual([
      { method: 'activateMessageAccount', args: ['message-1', 7] },
      { method: 'approveMessage', args: ['message-1', 8, false] },
    ]);
});

test('requires fresh warning acknowledgement after the review changes', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&warning=1');
  const sign = page.getByRole('button', { name: 'Sign message', exact: true });
  const acknowledgement = page.getByRole('checkbox', { name: 'I understand the address warning' });
  await expect(sign).toBeDisabled();
  await expect(page.getByText('Known phishing recipient')).toBeVisible();
  await acknowledgement.click();
  await expect(sign).toBeEnabled();
  await page.evaluate(() => window.__nativeMessageReviewFixture.revise());
  await expect(sign).toBeDisabled();
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.click();
  await sign.click();
  expect(await page.evaluate(() => window.__nativeMessageReviewFixture.calls()))
    .toEqual([{ method: 'approveMessage', args: ['message-1', 8, true] }]);
});

test('keeps rejection available while signing is pending', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&pending=1');
  await page.getByRole('button', { name: 'Sign message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Please wait…', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Request completed')).toBeVisible();
});

test('distinguishes an unverified site and blocks a mismatched site', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&unverified=1');
  await expect(page.getByText('Unverified website', { exact: true })).toBeVisible();
  await expect(page.getByText('Website origin matched by WalletConnect')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign message', exact: true })).toBeEnabled();
  await page.goto('http://127.0.0.1:4179/?message-review=1&invalid-origin=1');
  await expect(page.getByText('Website mismatch', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign message', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
});

test('labels an already-dispatched signature with Close instead of Reject', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&pending=1&dispatched=1');
  await page.getByRole('button', { name: 'Sign message', exact: true }).click();
  await expect(page.getByText('Sending signature…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Request completed')).toBeVisible();
});

test('requires warning acknowledgement for signing after switching accounts', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&switch=1&warning=1');
  await expect(page.getByRole('checkbox', { name: 'I understand the address warning' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch account', exact: true }).click();
  const sign = page.getByRole('button', { name: 'Sign message', exact: true });
  await expect(sign).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I understand the address warning' }).click();
  await expect(sign).toBeEnabled();
});

test('explains uncertain delivery without offering another signature or rejection', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?message-review=1&delivery-uncertain=1');
  await expect(page.getByText('The signature was handed to WalletConnect. Delivery could not be confirmed. Check the requesting app before trying again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign message', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Request completed')).toBeVisible();
});
