import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
const recipient = '0x1111111111111111111111111111111111111111';
const passwordInput = (page: Page) =>
  page.getByLabel('Confirm your wallet password', { exact: true });

async function prepare(page: Page) {
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in ETH', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-confirm')).toBeVisible();
  await expect(passwordInput(page)).toHaveCount(0);
}

test('Advanced nonce is opt-in and shows the exact choice before approval at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const nonce = page.getByLabel('Transaction nonce', { exact: true });
  await expect(nonce).toHaveCount(0);
  const advanced = page.getByRole('button', { name: 'Advanced options', exact: true });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.click();
  await expect(page.getByRole('button', { name: 'Hide advanced options' })).toHaveAttribute('aria-expanded', 'true');
  await expect(nonce).toHaveAttribute('placeholder', 'Automatic');
  await nonce.fill('7');
  await page.getByRole('button', { name: 'Hide advanced options' }).click();
  await page.getByRole('button', { name: 'Advanced options', exact: true }).click();
  await expect(nonce).toHaveValue('');
  await nonce.fill('0');
  await prepare(page);
  await expect(page.getByTestId('native-send-reviewed-nonce')).toHaveText('0');
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
  await page.getByTestId('native-send-confirm').click();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toHaveLength(1);
});

test('cancellation shows the original and maximum fee before one explicit approval at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?cancel-transfer');
  await expect(page.getByText('Review cancellation', { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-send-recipient')).toHaveText('0x' + '2'.repeat(40));
  await expect(page.getByTestId('native-send-fee')).toHaveText('0.000000000000126 ETH');
  await expect(page.getByText('0x' + '3'.repeat(64))).toBeVisible();
  await expect(page.getByText(/original can still confirm first/)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
  await page.getByRole('button', { name: 'Submit cancellation' }).click();
  await expect(page.getByText('Cancellation submitted', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toHaveLength(1);
});

test('Speed Up shows the original and reviewed fee before one explicit approval', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?speed-up-transfer');
  await expect(page.getByText('Review Speed Up', { exact: true })).toBeVisible();
  await expect(page.getByText(/same payment with updated gas and fee limits/)).toBeVisible();
  await expect(page.getByTestId('native-send-recipient')).toHaveText(recipient);
  await expect(page.getByTestId('native-send-fee')).toHaveText('0.000000000000126 ETH');
  await expect(page.getByText('0x' + '3'.repeat(64))).toBeVisible();
  await expect(page.getByText(/Original execution fee limit/)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
  await page.getByRole('button', { name: 'Submit Speed Up' }).click();
  await expect(page.getByText('Replacement submitted', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toHaveLength(1);
});

test('expired review cannot confirm and a replacement requires explicit consent', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await prepare(page);
  const firstId = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await page.clock.runFor(90001);
  await expect(page.getByTestId('native-send-confirm')).toHaveCount(0);
  await prepare(page);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.reviewId())
  ).not.toBe(firstId);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
  await expect(passwordInput(page)).toHaveCount(0);
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  await page.getByTestId('native-send-confirm').click();
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([{ id: 'fixture-review-2' }]);
});

test('same-review refresh and replacement do not automatically confirm', async ({
  page,
}) => {
  await page.goto('/');
  await prepare(page);
  const firstId = await page.evaluate(() =>
    window.__nativeSendFixture.reviewId()
  );
  await page.evaluate(() => window.__nativeSendFixture.refreshReview());
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBe(
    firstId
  );
  await page.evaluate(() => window.__nativeSendFixture.replaceReview());
  expect(
    await page.evaluate(() => window.__nativeSendFixture.reviewId())
  ).not.toBe(firstId);
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([]);
  await expect(passwordInput(page)).toHaveCount(0);
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  await page.getByTestId('native-send-confirm').click();
  expect(
    await page.evaluate(() => window.__nativeSendFixture.confirmations())
  ).toEqual([{ id: 'fixture-review-2' }]);
});

test('NEVM native send renders captured testnet and TSYS labels through ordinary confirmation', async ({
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
  ).toHaveCount(0);
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
  await page.getByTestId('native-send-confirm').click();
  await page.evaluate(() => window.__nativeSendFixture.settle('confirmed'));
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Syscoin NEVM Testnet transaction', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/finalized/i)).toHaveCount(0);
});

test('NEVM reverted receipt uses ordinary reverted status', async ({
  page,
}) => {
  await page.goto('/?nevm-send');
  await page
    .getByLabel('Syscoin NEVM Testnet address', { exact: true })
    .fill(recipient);
  await page.getByLabel('Amount in TSYS', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await page.getByTestId('native-send-confirm').click();
  await page.evaluate(() => window.__nativeSendFixture.settle('reverted'));
  await expect(
    page.getByText('Transfer reverted', { exact: true })
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
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText('Transfer reverted', { exact: true })
  ).toHaveCount(0);
});

async function prepareZkSys(page: Page) {
  await page
    .getByLabel('zkTanenbaum Testnet address', { exact: true })
    .fill(recipient);
  await page.getByLabel('Amount in TSYS', { exact: true }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-confirm')).toBeVisible();
  await expect(passwordInput(page)).toHaveCount(0);
}

test('zkSYS review keeps captured chain57057 labels through ordinary confirmation', async ({
  page,
}) => {
  await page.goto('/?zksys-send');
  await expect(page.getByText('Send TSYS', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Account 1 · zkTanenbaum Testnet · Test network', {
      exact: true,
    })
  ).toBeVisible();
  await prepareZkSys(page);
  await expect(page.getByTestId('native-send-amount')).toHaveText('0.001');
  await expect(page.getByTestId('native-send-fee')).toHaveText(
    '0.000000000000063 TSYS'
  );
  await expect(
    page.getByText('0.001000000000063 TSYS', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('zkSYS settlement policy', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText(
      'The final fee depends on network execution. This review limits the gas price and gas used by this transaction.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      'Use test funds only. This transfer is on zkTanenbaum Testnet (chain 57057).',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByText(/Ethereum|depth policy/i)).toHaveCount(0);

  // Review identity owns labels even if the current parent context changes.
  await page.evaluate(() => window.__nativeSendFixture.changeContext());
  await expect(page.getByTestId('native-send-fee')).toContainText('TSYS');
  await expect(
    page.getByText('Account 1 · zkTanenbaum Testnet · Test network', {
      exact: true,
    })
  ).toBeVisible();
  await page.getByTestId('native-send-confirm').click();
  await expect(
    page.getByText('Transfer pending', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toHaveCount(0);
  await page.evaluate(() => window.__nativeSendFixture.settle('confirmed'));
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('zkTanenbaum Testnet transaction', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/Ethereum|Depth confirmed/i)).toHaveCount(0);
});

test('zkSYS reverted and unavailable-outcome states retain distinct ordinary outcomes', async ({
  page,
}) => {
  await page.goto('/?zksys-send');
  await prepareZkSys(page);
  await page.getByTestId('native-send-confirm').click();
  await page.evaluate(() => window.__nativeSendFixture.settle('reverted'));
  await expect(
    page.getByText('Transfer reverted', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/Ethereum|Depth confirmed/i)).toHaveCount(0);
  await page.evaluate(() =>
    window.__nativeSendFixture.settle('nonce-consumed')
  );
  await expect(
    page.getByText('Check account history', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText('Transfer reverted', { exact: true })
  ).toHaveCount(0);
});

for (const kind of ['base-fee', 'nonce', 'malformed'] as const) {
  test(`zkSYS ${kind} quote failure shows truthful pre-signing recovery`, async ({
    page,
  }) => {
    await page.goto(`/?zksys-send&quoteFailure=${kind}`);
    await prepareZkSys(page);
    const prior = await page.evaluate(() =>
      window.__nativeSendFixture.reviewId()
    );
    await page.getByTestId('native-send-confirm').click();
    await expect(passwordInput(page)).toHaveCount(0);
    if (kind === 'malformed')
      await expect(
        page.getByText(
          'This request could not be completed. Try again or check Activity for an existing transaction.',
          { exact: true }
        )
      ).toBeVisible();
    else
      await expect(
        page.getByText(
          'Network conditions changed or this review expired. Review the transfer again.',
          { exact: true }
        )
      ).toBeVisible();
    await expect(
      page.getByText(/pending transaction|transaction has been preserved/i)
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__nativeSendFixture.confirmations())
    ).toEqual([]);
    await page.getByTestId('native-send-review').click();
    await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
    await expect(passwordInput(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__nativeSendFixture.reviewId())
    ).not.toBe(prior);
  });
}
