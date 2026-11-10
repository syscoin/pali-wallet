import { authenticateNativeOperation } from './operationAuthentication';
import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
const recipient = '0x1111111111111111111111111111111111111111';

async function prepareEvm(page: Page) {
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in ETH', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
}
async function chooseLedger(page: Page) {
  await page
    .getByRole('button', { name: 'Connect Ledger', exact: true })
    .click();
  await page.getByRole('button', { name: 'Find Ledger', exact: true }).click();
  await page
    .getByRole('button', { name: 'My Ledger · Nano X', exact: true })
    .click();
  await expect(page.getByLabel('Ledger account name')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add Ledger account', exact: true })
  ).toHaveCount(0);
}

test('connecting a Ledger preserves the EVM review and still requires Confirm', async ({
  page,
}) => {
  await page.goto('/?ledger-send=1');
  await prepareEvm(page);
  const review = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await chooseLedger(page);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(
    review
  );
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
  await page.getByTestId('native-send-confirm').click();
  await authenticateNativeOperation(page);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([{ id: review }]);
});

test('canceling the Ledger picker leaves the EVM review unsigned', async ({
  page,
}) => {
  await page.goto('/?ledger-send=1');
  await prepareEvm(page);
  const review = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await chooseLedger(page);
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(
    review
  );
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
});

test('EVM review expiry continues while the Ledger picker is open', async ({
  page,
}) => {
  await page.goto('/?ledger-send=1');
  await prepareEvm(page);
  await chooseLedger(page);
  await page.evaluate(() => window.__nativeSendFixture.expireReview());
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('native-send-confirm')).toHaveCount(0);
  await expect(page.getByTestId('native-send-review')).toBeVisible();
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
});

test('Back suppresses a late Ledger connection completion', async ({
  page,
}) => {
  await page.goto('/?ledger-send=1&hold-connection=1');
  await prepareEvm(page);
  await chooseLedger(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.evaluate(() => window.__nativeLedgerSigningFixture.complete());
  await expect(
    page.getByRole('button', { name: 'Done', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
});

async function prepareUtxo(page: Page) {
  await page
    .getByLabel('Recipient address', { exact: true })
    .fill('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  await page.getByLabel('Amount in BTC', { exact: true }).fill('0.1');
  await page.getByTestId('native-utxo-review').click();
  await expect(page.getByTestId('native-utxo-confirm')).toBeDisabled();
}

test('UTXO prepares from saved public data and still requires confirmation after connection', async ({
  page,
}) => {
  await page.goto('/?utxo-send=1&ledger-send=1');
  await prepareUtxo(page);
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.opens())
  ).toBe(1);
  await chooseLedger(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('native-utxo-confirm')).toBeEnabled();
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.confirmations())
  ).toBe(0);
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.opens())
  ).toBe(1);
  await page.getByTestId('native-utxo-confirm').click();
  await authenticateNativeOperation(page);
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.confirmations())
  ).toBe(1);
});

test('UTXO reconnect keeps the existing review and its expiry', async ({
  page,
}) => {
  await page.goto('/?utxo-send=1&ledger-send=1');
  await prepareUtxo(page);
  await chooseLedger(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('native-utxo-confirm').evaluate((button) => {
    window.__nativeLedgerSigningFixture.disconnect();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId('native-utxo-confirm')).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.confirmations())
  ).toBe(0);
  await chooseLedger(page);
  await page.evaluate(() => window.__nativeUtxoLedgerFixture.expire());
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.opens())
  ).toBe(1);
  await page.getByTestId('native-utxo-confirm').click();
  await authenticateNativeOperation(page);
  await expect(page.getByRole('alert')).toContainText(
    'This review is no longer available'
  );
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.confirmations())
  ).toBe(0);
});

test('saved EVM signed bytes replay without connecting Ledger', async ({
  page,
}) => {
  await page.goto('/?ledger-send=1&ledger-replay=1');
  await expect(
    page.getByRole('button', { name: 'Resend signed transaction', exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Connect Ledger', exact: true })
  ).toHaveCount(0);
  await page.getByTestId('native-send-confirm').click();
  await authenticateNativeOperation(page);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toHaveLength(1);
  expect(
    await page.evaluate(() => window.__nativeLedgerSigningFixture.calls())
  ).toEqual([]);
});

test('saved UTXO signed bytes replay without connecting Ledger', async ({
  page,
}) => {
  await page.goto('/?utxo-send=1&ledger-send=1');
  await page
    .getByRole('button', { name: 'Check transfer aaaaaaaa…', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Review saved transfer', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Resend saved transfer', exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Connect Ledger', exact: true })
  ).toHaveCount(0);
  await page.getByTestId('native-utxo-confirm').click();
  await authenticateNativeOperation(page);
  expect(
    await page.evaluate(() => window.__nativeUtxoLedgerFixture.confirmations())
  ).toBe(1);
  expect(
    await page.evaluate(() => window.__nativeLedgerSigningFixture.calls())
  ).toEqual([]);
});

test('physical disconnect restores Connect Ledger without losing the approved EVM review', async ({
  page,
}) => {
  await page.goto('/?ledger-send=1');
  await prepareEvm(page);
  const review = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await chooseLedger(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  await page.evaluate(() => window.__nativeLedgerSigningFixture.disconnect());
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Connect Ledger', exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(
    review
  );
  await chooseLedger(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(
    review
  );
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
});
