import { expect, test } from '@playwright/test';

test('320px SYSX review preserves exact amounts and leaves on Back, lock, account or network change', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4182')
      throw Error('Unexpected external request');
    await route.continue();
  });
  await page.goto('/?sysx-utxo-send&android');
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  const heading = (name: string) =>
    page.getByRole('heading', { name, exact: true });
  const unlock = async () => {
    await page
      .getByRole('textbox', { name: 'Password', exact: true })
      .fill('public-password');
    await button('Unlock wallet').click();
    await expect(page.getByRole('button', { name: /^SYSX(?:\s|$)/ })).toBeVisible();
  };
  await button('Accounts').click();
  await button('Open wallet').click();
  await unlock();
  const recipient = await page.evaluate(
    () => window.__watchFixture.sysx.recipient
  );
  const address = page.getByRole('textbox', {
    name: 'Recipient address',
    exact: true,
  });
  const amount = page.getByRole('textbox', {
    name: 'Amount in SYSX',
    exact: true,
  });
  const review = page.getByTestId('native-utxo-review');
  const confirm = page.getByTestId('native-utxo-confirm');
  async function enterDraft() {
    await page.getByRole('button', { name: /^SYSX(?:\s|$)/ }).click();
    await button('Send').click();
    await expect(heading('Send SYSX')).toBeVisible();
    await expect(address).toHaveValue('');
    await expect(amount).toHaveValue('');
    await expect(button('Use maximum')).toBeVisible();
    await expect(review).toBeDisabled();
    await address.fill(recipient);
    await amount.fill('0.12345678');
    await expect(amount).toHaveAttribute('inputmode', 'decimal');
    await expect(amount).toBeFocused();
  }
  await enterDraft();
  await review.click();
  await expect(heading('Review transfer')).toBeVisible();
  await expect(amount).toHaveCount(0);
  await expect(
    page.getByText('0.12345678 SYSX', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('0.00000294 SYS', { exact: true })).toBeVisible();
  await expect(
    page.getByText('1.87654322 SYSX', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('native-utxo-recipient')).toHaveText(recipient);
  await expect(page.getByTestId('native-utxo-fee')).toHaveText(
    '0.00000452 SYS'
  );
  await expect(
    page.getByText('Account 1 · Syscoin Mainnet', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(321);
  await page.screenshot({
    path: info.outputPath('sysx-review-context-320.png'),
  });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await page.screenshot({ path: info.outputPath('sysx-review-320.png') });

  expect(await page.evaluate(() => window.__watchFixture.back())).toBe(true);
  await expect(heading('Send SYSX')).toBeVisible();
  await expect(amount).toHaveValue('0.12345678');
  await review.click();
  await expect(confirm).toBeVisible();
  await page.evaluate(() => window.__watchFixture.lifecycle('background'));
  await expect(confirm).toHaveCount(0);
  await expect(button('Unlock wallet')).toBeVisible();
  await page.evaluate(() => window.__watchFixture.lifecycle('active'));
  await unlock();

  const heldAttempt = async (change: () => Promise<void>) => {
    await enterDraft();
    const before = await page.evaluate(() =>
      window.__watchFixture.sysx.audit()
    );
    await page.evaluate(() => window.__watchFixture.sysx.hold());
    await review.click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__watchFixture.sysx.audit().prepares)
      )
      .toBe(before.prepares + 1);
    await change();
    await expect(amount).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => window.__watchFixture.sysx.audit().cancellations)
      )
      .toBeGreaterThan(before.cancellations);
    await page.evaluate(() => window.__watchFixture.sysx.release());
    await expect
      .poll(() => page.evaluate(() => window.__watchFixture.sysx.audit().late))
      .toBe(before.late + 1);
    await expect(confirm).toHaveCount(0);
    await expect(amount).toHaveCount(0);
    await expect(button('Send SYSX')).toHaveCount(0);
  };
  await heldAttempt(() =>
    page.evaluate(() => window.__watchFixture.selectAccount('hd:57:1'))
  );
  await expect(
    page.getByText('Account 2 · Syscoin Mainnet', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => window.__watchFixture.selectAccount('hd:57:0'));
  await heldAttempt(() =>
    page.evaluate(() => window.__watchFixture.selectNativeNetwork('bitcoin'))
  );
  await expect(
    page.getByText('Account 1 · Bitcoin', { exact: true })
  ).toBeVisible();
  await page.evaluate(() =>
    window.__watchFixture.selectNativeNetwork('syscoin')
  );
  await enterDraft();
  await button('Back').click();
  await expect(page.getByRole('button', { name: /^SYSX(?:\s|$)/ })).toBeVisible();
  expect(
    await page.evaluate(() => window.__watchFixture.sysx.audit().confirmations)
  ).toBe(0);
});
