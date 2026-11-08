import { expect, test, type Locator, type Page } from '@playwright/test';

const baseURL = process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4197';
const recipient = `0x${'11'.repeat(20)}`;
test.use({ baseURL, viewport: { width: 320, height: 568 } });
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL).origin)
      throw new Error('Unexpected public request');
    return route.continue();
  });
});
async function open(page: Page, suffix = '') {
  await page.goto(`/?private-withdrawal${suffix}`);
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await expect(
    page.getByRole('button', { name: 'Withdraw', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Withdraw note', exact: true })
  ).toBeVisible();
}
async function visibleAction(action: Locator) {
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 0.99 });
  expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}
async function prepare(page: Page) {
  await page
    .getByRole('textbox', { name: 'Recipient address' })
    .fill(recipient);
  await page
    .getByRole('button', { name: 'Review withdrawal', exact: true })
    .click();
}

test('saved note opens direct by default and requires confirmation after proof', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await open(page, '&hold-proof');
  await expect(
    page.getByRole('radio', { name: 'Direct', exact: true })
  ).toBeChecked();
  await expect(page.getByLabel('Confirm your wallet password')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Direct', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('radio', { name: 'Relayer', exact: true })
  ).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.getByRole('radio', { name: 'Direct', exact: true })
  ).toBeChecked();
  await page
    .getByRole('textbox', { name: 'Recipient address' })
    .fill(recipient);
  await visibleAction(
    page.getByRole('button', { name: 'Review withdrawal', exact: true })
  );
  await page.screenshot({
    path: info.outputPath('withdrawal-direct-form-320x360.png'),
  });
  await page
    .getByRole('button', { name: 'Review withdrawal', exact: true })
    .click();
  await expect(
    page.getByText(
      'Preparing a proof locally. This may take up to two minutes.'
    )
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toHaveCount(0);
  expect(
    (
      await page.evaluate(() => window.__privateWithdrawalFixture.events())
    ).filter((event) => event.startsWith('confirm:'))
  ).toHaveLength(0);
  await page.evaluate(() => window.__privateWithdrawalFixture.release());
  await expect(
    page.getByRole('heading', { name: 'Review withdrawal', exact: true })
  ).toBeVisible();
  await expect(page.getByText(recipient, { exact: true })).toBeVisible();
  await page.getByText('0.013 ETH', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('0.013 ETH', { exact: true })).toBeVisible();
  await visibleAction(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  );
  await visibleAction(
    page.getByRole('button', { name: 'Cancel', exact: true })
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
  await page.screenshot({
    path: info.outputPath('withdrawal-direct-review-320x360.png'),
  });
  await page
    .getByRole('button', { name: 'Confirm withdrawal', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Withdrawal submitted', exact: true })
  ).toBeVisible();
  expect(
    (
      await page.evaluate(() => window.__privateWithdrawalFixture.events())
    ).filter((event) => event.startsWith('confirm:'))
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(
    page.getByText('Note already spent.', { exact: true })
  ).toBeVisible();
});

test('watch-only selects relayer and renders exact net amount and accepted job separately', async ({
  page,
}, info) => {
  await open(page, '&watch');
  await expect(
    page.getByRole('radio', { name: 'Direct', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('radio', { name: 'Relayer', exact: true })
  ).toBeChecked();
  await expect(
    page.getByRole('button', {
      name: 'Unavailable relayer · Unavailable',
      exact: true,
    })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Fixture relayer · 0.3%', exact: true })
    .click();
  await prepare(page);
  for (const value of [
    '0.003 ETH',
    '0.016 ETH',
    '0.984 ETH',
    'https://relay.example/withdraw',
  ]) {
    await page.getByText(value, { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  }
  await visibleAction(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  );
  await page.screenshot({
    path: info.outputPath('withdrawal-relayed-review-320.png'),
  });
  await page
    .getByRole('button', { name: 'Confirm withdrawal', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Relayer accepted the request',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText(
      'The relayer has a job ID. This does not mean the withdrawal is mined.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByText('fixture-job', { exact: true })).toBeVisible();
});

for (const change of ['removed', 'disabled'] as const) {
  test(`relayer refresh clears a selected relayer that becomes ${change}`, async ({
    page,
  }) => {
    await open(page, `&relayer-${change}`);
    await page.getByRole('radio', { name: 'Relayer', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Recipient address' })
      .fill(recipient);
    await page
      .getByRole('button', { name: 'Fixture relayer · 0.3%', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Review withdrawal', exact: true })
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Refresh relayers', exact: true })
      .click();
    if (change === 'removed') {
      await expect(
        page.getByRole('button', {
          name: 'Fixture relayer · 0.3%',
          exact: true,
        })
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByRole('button', {
          name: 'Fixture relayer · 0.3% · Unavailable',
          exact: true,
        })
      ).toBeDisabled();
    }
    await expect(
      page.getByRole('button', { name: 'Review withdrawal', exact: true })
    ).toBeDisabled();
    expect(
      (
        await page.evaluate(() => window.__privateWithdrawalFixture.events())
      ).filter((event) => event.startsWith('prepare:'))
    ).toHaveLength(0);
  });
}

test('a delivery mode cycle requires a fresh relayer selection', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('radio', { name: 'Relayer', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Recipient address' })
    .fill(recipient);
  await page
    .getByRole('button', { name: 'Fixture relayer · 0.3%', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Review withdrawal', exact: true })
  ).toBeEnabled();
  await page.getByRole('radio', { name: 'Direct', exact: true }).click();
  await page.getByRole('radio', { name: 'Relayer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Review withdrawal', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Fixture relayer · 0.3%', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Review withdrawal', exact: true })
  ).toBeEnabled();
});

test('expiry requires a new review and never sends automatically', async ({
  page,
}) => {
  await open(page, '&expire');
  await prepare(page);
  await expect(
    page.getByRole('button', { name: 'Refresh review', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Refresh review', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toBeVisible();
  const events = await page.evaluate(() =>
    window.__privateWithdrawalFixture.events()
  );
  expect(events.filter((event) => event.startsWith('prepare:'))).toHaveLength(
    2
  );
  expect(events.filter((event) => event.startsWith('confirm:'))).toHaveLength(
    0
  );
});

test('unknown result offers status without a duplicate confirmation', async ({
  page,
}, info) => {
  await open(page, '&unknown');
  await prepare(page);
  await page
    .getByRole('button', { name: 'Confirm withdrawal', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Submission status unknown',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(
    page.getByText(
      'Do not submit again. Check the transaction or relayer status before another withdrawal.',
      { exact: true }
    )
  ).toBeVisible();
  expect(
    (
      await page.evaluate(() => window.__privateWithdrawalFixture.events())
    ).filter((event) => event.startsWith('confirm:'))
  ).toHaveLength(1);
  await visibleAction(page.getByRole('button', { name: 'Done', exact: true }));
  await page.screenshot({
    path: info.outputPath('withdrawal-unknown-320.png'),
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved notes', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await expect(
    page.getByRole('button', { name: 'View withdrawal status', exact: true })
  ).toBeVisible();
});

test('cancelled proof cannot publish a late review', async ({ page }) => {
  await open(page, '&hold-proof');
  await prepare(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.__privateWithdrawalFixture.release());
  await expect(
    page.getByRole('heading', { name: 'Saved notes', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__privateWithdrawalFixture.events())
  ).toContain('dispose');
});

test('background retirement discards a held proof and its late result', async ({
  page,
}) => {
  await open(page, '&hold-proof');
  await prepare(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(
    page.getByText('Open Saved notes again to continue.', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => window.__privateWithdrawalFixture.release());
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__privateWithdrawalFixture.events())
  ).toContain('dispose');
});

test('whole invalid recipient is rejected instead of accepting a truncated prefix', async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole('textbox', { name: 'Recipient address' })
    .fill(`${recipient}junk`);
  await page.getByRole('textbox', { name: 'Recipient address' }).blur();
  await expect(
    page.getByText('Enter a valid Ethereum address.', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review withdrawal', exact: true })
  ).toBeDisabled();
  expect(
    (
      await page.evaluate(() => window.__privateWithdrawalFixture.events())
    ).filter((event) => event.startsWith('prepare:'))
  ).toHaveLength(0);
});

test('restored prerequisite clears password and returns to ordinary explicit review', async ({
  page,
}) => {
  await open(page, '&restored');
  const password = page.getByLabel('Confirm your wallet password');
  await password.fill('wrong');
  await page
    .getByRole('button', { name: 'Review restored note', exact: true })
    .click();
  await expect(password).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveText(
    'Could not review this restored note. Confirm your password and try again.'
  );
  await password.fill('Fixture password 1!');
  await page
    .getByRole('button', { name: 'Review restored note', exact: true })
    .click();
  await expect(password).toHaveCount(0);
  await prepare(page);
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toBeVisible();
  expect(
    (
      await page.evaluate(() => window.__privateWithdrawalFixture.events())
    ).filter((event) => event.startsWith('confirm:'))
  ).toHaveLength(0);
});

test('cancel waits for a pending open and late disposal before reloading inventory', async ({
  page,
}) => {
  await page.goto('/?private-withdrawal&hold-open&hold-dispose');
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const inventories = await page.evaluate(
    () =>
      window.__privateWithdrawalFixture
        .events()
        .filter((event) => event === 'inventory').length
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Closing withdrawal…')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Saved notes', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__privateWithdrawalFixture
          .events()
          .filter((event) => event === 'inventory').length
    )
  ).toBe(inventories);
  await page.evaluate(() => window.__privateWithdrawalFixture.release());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__privateWithdrawalFixture
            .events()
            .filter((event) => event === 'dispose').length
      )
    )
    .toBe(1);
  await expect(page.getByText('Closing withdrawal…')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Saved notes', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__privateWithdrawalFixture
          .events()
          .filter((event) => event === 'inventory').length
    )
  ).toBe(inventories);
  await page.evaluate(() => window.__privateWithdrawalFixture.release());
  await expect(
    page.getByRole('heading', { name: 'Saved notes', exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__privateWithdrawalFixture
            .events()
            .filter((event) => event === 'dispose').length
      )
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () =>
        window.__privateWithdrawalFixture
          .events()
          .filter((event) => event === 'inventory').length
    )
  ).toBe(inventories + 1);
});

test('proven-unsent failure needs a fresh review before another confirmation', async ({
  page,
}) => {
  await open(page, '&not-broadcast');
  await prepare(page);
  await page
    .getByRole('button', { name: 'Confirm withdrawal', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Refresh review', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh review', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Confirm withdrawal', exact: true })
  ).toBeVisible();
  expect(
    (
      await page.evaluate(() => window.__privateWithdrawalFixture.events())
    ).filter((event) => event.startsWith('confirm:'))
  ).toHaveLength(1);
});

test('saved withdrawal history opens status without requiring new-note eligibility', async ({
  page,
}) => {
  await page.goto('/?private-withdrawal&history');
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await page
    .getByRole('button', { name: 'View withdrawal status', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Submission status unknown',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review withdrawal', exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__privateWithdrawalFixture.events())
  ).not.toContain('note:status');
});

test('a spent saved note retains status and does not offer a withdrawal', async ({
  page,
}) => {
  await page.goto('/?private-withdrawal&spent');
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await expect(page.getByText('Already spent', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Withdraw', exact: true })
  ).toHaveCount(0);
});
