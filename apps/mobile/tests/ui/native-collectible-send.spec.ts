import { authenticateNativeOperation } from './operationAuthentication';
import { expect, test } from '@playwright/test';

const owner = '0x1111111111111111111111111111111111111111';
const contract = '0x3333333333333333333333333333333333333333';
const tokenId = ((1n << 256n) - 1n).toString();
const fixtureUrl = process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179';
test.use({ viewport: { width: 320, height: 844 }, baseURL: fixtureUrl });
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, async (route) => {
    if (new URL(route.request().url()).origin !== new URL(fixtureUrl).origin) {
      await route.abort();
      throw new Error('External fixture request');
    }
    await route.continue();
  });
});
test('ERC-721 ID zero has exact collectible consent at 320px', async ({ page }, testInfo) => {
  await page.goto('/?collectible=721');
  await page.getByRole('textbox', { name: 'Recipient address' }).fill(owner);
  await page.getByRole('textbox', { name: 'Token ID' }).fill('0');
  await expect(page.getByRole('textbox', { name: 'Quantity' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('erc721-draft.png') });
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-amount')).toHaveAccessibleName('1 collectible');
  await expect(page.getByTestId('native-send-collectible-id')).toHaveText('0');
  await expect(page.getByTestId('native-send-collectible-contract')).toHaveText(contract);
  await expect(page.getByTestId('native-send-recipient')).toHaveText(owner);
  await expect(page.getByText('AMOUNT + EXECUTION FEE LIMIT', { exact: true })).toHaveCount(0);
  await expect(page.getByText('EXECUTION FEE LIMIT', { exact: true })).toBeVisible();
  await expect(page.getByText('Token transfer', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('erc721-review.png') });
  await page.getByTestId('native-send-confirm').click();
  await authenticateNativeOperation(page);
  await expect(page.getByTestId('native-send-hash')).toBeVisible();
  await expect(page.getByTestId('native-send-collectible-contract')).toHaveText(contract);
});
test('ERC-1155 fixed uint256 ID and quantity stay exact with large text', async ({ page }, testInfo) => {
  await page.goto('/?collectible=1155');
  await expect(page.getByTestId('native-send-collectible-id')).toHaveText(tokenId);
  await expect(page.getByRole('textbox', { name: 'Token ID' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Recipient address' }).fill(owner);
  const quantity = page.getByRole('textbox', { name: 'Quantity' });
  await expect(quantity).toHaveValue('1');
  await quantity.fill('1.5');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByRole('alert')).toHaveText('Enter a whole quantity greater than zero.');
  await quantity.fill('0');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByRole('alert')).toHaveText('Enter a whole quantity greater than zero.');
  await quantity.fill(tokenId);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-amount')).toHaveText(tokenId);
  await expect(page.getByTestId('native-send-collectible-id')).toHaveText(tokenId);
  await expect(page.getByTestId('native-send-recipient')).toHaveText(owner);
  await page.evaluate(() => {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[dir=auto]'))) {
      const style = getComputedStyle(node);
      node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    }
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  for (const id of ['native-send-amount', 'native-send-collectible-id', 'native-send-recipient']) {
    const bounds = (await page.getByTestId(id).boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: testInfo.outputPath('erc1155-review-large.png'), fullPage: true });
  const fee = page.getByTestId('native-send-fee');
  await fee.scrollIntoViewIfNeeded();
  await expect(fee).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('erc1155-review-large-fee.png') });
  const confirm = page.getByTestId('native-send-confirm');
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('erc1155-review-large-confirm.png') });
});
