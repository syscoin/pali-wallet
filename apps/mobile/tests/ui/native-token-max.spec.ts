import { expect, test } from '@playwright/test';

const baseURL = process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179';
test.use({ baseURL, viewport: { width: 320, height: 568 } });
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => {
    const requested = new URL(route.request().url());
    if (requested.origin !== new URL(baseURL).origin)
      throw new Error('Unexpected external request');
    return route.continue();
  });
});
const dust = '0.' + '0'.repeat(254) + '1';
const to = '0x4444444444444444444444444444444444444444';
for (const smart of [false, true]) {
  test(`${
    smart ? 'Smart' : 'ordinary'
  } token MAX preserves 255-decimal dust on a narrow review`, async ({
    page,
  }, info) => {
    await page.goto(
      smart
        ? '/?smart-currency&token&max-token-dust'
        : '/?erc20-send&max-token-dust'
    );
    const amount = page.getByLabel(smart ? 'Amount (TOK)' : 'Amount in FIX', {
      exact: true,
    });
    await expect(
      page.getByRole('button', { name: 'MAX', exact: true })
    ).toBeEnabled();
    await page.getByRole('button', { name: 'MAX', exact: true }).click();
    await expect(amount).toHaveValue(dust);
    await page
      .getByLabel(smart ? 'Recipient address' : 'Ethereum address', {
        exact: true,
      })
      .fill(to);
    await page
      .getByRole('button', { name: 'Review transfer', exact: true })
      .click();
    if (smart) {
      await expect(page.getByText(dust, { exact: true })).toBeVisible();
      await page.getByText(dust, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('token-max-smart-amount-320.png') });
      const authorize = page.getByRole('button', {
        name: 'Authorize transfer',
        exact: true,
      });
      await authorize.scrollIntoViewIfNeeded();
      await expect(authorize).toBeEnabled();
      const close = page.getByRole('button', { name: 'Close', exact: true });
      await close.scrollIntoViewIfNeeded();
      await expect(close).toBeInViewport();
    } else {
      await expect(page.getByTestId('native-send-amount')).toHaveText(dust);
      await page.getByTestId('native-send-amount').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('token-max-ordinary-amount-320.png') });
      await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
      await page.getByTestId('native-send-confirm').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('native-send-confirm')).toBeInViewport();
    }
    await page.screenshot({
      path: info.outputPath(
        `token-max-${smart ? 'smart' : 'ordinary'}-320.png`
      ),
    });
  });
  test(`${
    smart ? 'Smart' : 'ordinary'
  } token MAX clears its selection when the amount is edited`, async ({
    page,
  }) => {
    await page.goto(smart ? '/?smart-currency&token' : '/?erc20-send');
    const amount = page.getByLabel(smart ? 'Amount (TOK)' : 'Amount in FIX', {
      exact: true,
    });
    await page.getByRole('button', { name: 'MAX', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'MAX selected', exact: true })
    ).toBeVisible();
    await amount.fill('2.5');
    await expect(
      page.getByRole('button', { name: 'MAX', exact: true })
    ).toBeVisible();
    await page
      .getByLabel(smart ? 'Recipient address' : 'Ethereum address', {
        exact: true,
      })
      .fill(to);
    await page
      .getByRole('button', { name: 'Review transfer', exact: true })
      .click();
    if (smart)
      await expect(page.getByText('2.5', { exact: true })).toBeVisible();
    else await expect(page.getByTestId('native-send-amount')).toHaveText('2.5');
  });
}
