import { test, expect, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || !['4179', '4181'].includes(url.port)) {
      await route.abort();
      throw new Error(`Unexpected external request: ${url.origin}`);
    }
    await route.continue();
  });
});
const recipient = '0x1111111111111111111111111111111111111111';
const contract = '0x3333333333333333333333333333333333333333';
const password = (page: Page) =>
  page.getByLabel('Confirm your wallet password', { exact: true });
async function prepare(page: Page, amount = '2.5') {
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in FIX', { exact: true }).fill(amount);
  await page.getByTestId('native-send-review').click();
  await expect(password(page)).toBeVisible();
}

test('real ERC20 controller shows asset intent and preserves exact signed bytes and precision over reload/retry', async ({
  page,
}, info) => {
  await page.goto('/?erc20-send');
  await prepare(page);
  await expect(page.getByTestId('native-send-amount')).toHaveText('2.5');
  await expect(page.getByTestId('native-send-token-contract')).toHaveText(
    contract
  );
  await expect(page.getByTestId('native-send-token-decimals')).toHaveText('6');
  await expect(page.getByTestId('native-send-recipient')).toHaveText(recipient);
  await expect(page.getByTestId('native-send-fee')).toContainText('ETH');
  await expect(page.getByText('MAXIMUM TOTAL', { exact: true })).toHaveCount(0);
  await page
    .getByRole('heading', { name: 'Review transfer', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('erc20-review.png'),
    fullPage: true,
  });
  await password(page).fill('Public fixture password');
  await page.getByTestId('native-send-confirm').click();
  await expect(page.getByTestId('native-send-hash')).toBeVisible();
  const firstHash = await page.getByTestId('native-send-hash').textContent();
  const firstBytes = await page.evaluate(
    () => window.__erc20SendFixture.broadcasts()[0]
  );
  expect(firstBytes).toBeTruthy();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(1);

  await page.reload();
  await expect(page.getByTestId('native-send-hash')).toHaveText(firstHash!);
  await page.evaluate(() => {
    window.__erc20SendFixture.setRuntimePrecision(18);
    window.__erc20SendFixture.acceptBroadcasts();
  });
  await page.getByRole('button', { name: 'Review retry', exact: true }).click();
  await expect(page.getByTestId('native-send-amount')).toHaveText('2.5');
  await expect(page.getByTestId('native-send-token-contract')).toHaveText(
    contract
  );
  await expect(password(page)).toHaveValue('');
  await password(page).fill('Fresh public fixture password');
  await page.getByTestId('native-send-confirm').click();
  await expect(page.getByTestId('native-send-hash')).toHaveText(firstHash!);
  expect(
    await page.evaluate(() => window.__erc20SendFixture.broadcasts()[0])
  ).toBe(firstBytes);
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
  expect(
    await page.evaluate(() => window.__erc20SendFixture.authorizations())
  ).toBe(1);
  await page.evaluate(() => window.__erc20SendFixture.finalized());
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(
    page.getByText('Transaction confirmed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText(/Check the token balance for the received amount/)
  ).toBeVisible();
});

test('ERC20 review expiry requires fresh password entry for its replacement', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?erc20-send');
  await prepare(page);
  await password(page).fill('Expired public fixture password');
  await page.clock.runFor(90001);
  await expect(password(page)).toHaveCount(0);
  await prepare(page);
  await expect(password(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
});

test('account-context revision retires an ERC20 review and entered password', async ({
  page,
}) => {
  await page.goto('/?erc20-send');
  await prepare(page);
  await password(page).fill('Old account-context password');
  await page.evaluate(() => window.__erc20SendFixture.revise());
  await expect(password(page)).toHaveCount(0);
  await prepare(page);
  await expect(password(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
});

test('network A-B-A rejects a held ERC20 quote before a new review', async ({
  page,
}) => {
  await page.goto('/?erc20-send');
  await page.evaluate(() => window.__erc20SendFixture.holdQuote());
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in FIX', { exact: true }).fill('2.5');
  await page.getByTestId('native-send-review').click();
  await expect(
    page.getByText('Checking the network…', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => {
    window.__erc20SendFixture.networkRoundTrip();
    window.__erc20SendFixture.releaseQuote();
  });
  await expect(password(page)).toHaveCount(0);
  await prepare(page);
  await expect(password(page)).toHaveValue('');
  await expect(page.getByTestId('native-send-confirm')).toBeDisabled();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
});

test('narrow ERC20 review retains full identities, exact amount and reachable password/confirmation', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?erc20-send');
  await prepare(page, '90071992547409.93');
  await expect(page.getByTestId('native-send-amount')).toHaveText(
    '90071992547409.93'
  );
  await expect(page.getByTestId('native-send-token-contract')).toHaveText(
    contract
  );
  await password(page).focus();
  await password(page).fill('Narrow public fixture password');
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page
    .getByRole('heading', { name: 'Review transfer', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('erc20-review-320.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>('[dir="auto"]')
    )) {
      const style = getComputedStyle(node);
      node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    }
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await password(page).scrollIntoViewIfNeeded();
  await expect(password(page)).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('erc20-password-320-large-text.png'),
    fullPage: true,
  });
  await page.getByTestId('native-send-confirm').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('native-send-confirm')).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('erc20-confirm-320-large-text.png'),
    fullPage: true,
  });
});
