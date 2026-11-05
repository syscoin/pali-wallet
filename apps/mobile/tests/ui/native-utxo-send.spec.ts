import { expect, test } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});

test('narrow UTXO review puts the exact recipient and fee before consent', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?utxo-send');
  const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const address = page.getByLabel('Recipient address', { exact: true });
  const amount = page.getByLabel('Amount in BTC', { exact: true });
  await address.fill('invalid');
  await amount.fill('1.23456789');
  await page.getByTestId('native-utxo-review').click();
  await expect(page.getByRole('alert')).toHaveText(
    'Enter a valid address and amount for this network.'
  );
  await address.fill(recipient);
  await expect(amount).toHaveValue('1.23456789');
  await page.getByTestId('native-utxo-review').click();
  await expect(page.getByText('1.23456789 BTC', { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-utxo-recipient')).toHaveText(recipient);
  await expect(page.getByTestId('native-utxo-fee')).toHaveText(
    '0.00000452 BTC'
  );
  await page.evaluate(() => {
    for (const text of Array.from(
      document.querySelectorAll<HTMLElement>('[dir="auto"]')
    )) {
      const fontSize = Number.parseFloat(getComputedStyle(text).fontSize);
      text.style.fontSize = `${fontSize * 2}px`;
      text.style.lineHeight = '1.15';
    }
  });
  const confirm = page.getByTestId('native-utxo-confirm');
  await expect(confirm).not.toBeInViewport();
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('utxo-confirm-320-large-text.png'),
  });
  await confirm.click();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
});

test('a saved UTXO retry reviews each exact output before resubmission', async ({
  page,
}) => {
  await page.goto('/?utxo-send');
  await page.getByRole('button', { name: 'Check transfer aaaaaaaa…' }).click();
  await expect(page.getByText('Submission unverified')).toBeVisible();
  await page.getByRole('button', { name: 'Review saved transfer' }).click();
  await expect(page.getByText('Output 1', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Output 2 · 0.000005 BTC', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resend saved transfer' }).click();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
});
