import { expect, test, type Locator } from '@playwright/test';

const baseURL = process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179';
test.use({ baseURL, viewport: { width: 320, height: 568 } });
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL).origin)
      throw Error('Unexpected public request');
    return route.continue();
  });
});
async function visibleAction(action: Locator) {
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 0.99 });
  expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}

test('deposit review has exact values and explicit fresh note acknowledgement at 320px', async ({
  page,
}, info) => {
  await page.goto('/?private-deposit');
  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.getByRole('radio', { name: '0.1 ETH pool', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('radio', { name: '1 ETH pool', exact: true })
  ).toBeChecked();
  await visibleAction(
    page.getByRole('button', { name: 'Review deposit', exact: true })
  );
  await page.screenshot({
    path: info.outputPath('private-deposit-pool-320.png'),
  });
  await page
    .getByRole('button', { name: 'Review deposit', exact: true })
    .click();
  const confirm = page.getByRole('button', {
    name: 'Confirm deposit',
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText('1.0042 ETH', { exact: true })).toBeVisible();
  await expect(page.getByText('0.0042 ETH', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
  await page.screenshot({
    path: info.outputPath('private-deposit-review-320.png'),
  });
  const acknowledgement = page.getByRole('checkbox');
  await acknowledgement.scrollIntoViewIfNeeded();
  await acknowledgement.press('Space');
  await expect(acknowledgement).toBeChecked();
  await visibleAction(confirm);
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.screenshot({
    path: info.outputPath('private-deposit-confirm-320.png'),
  });
  await confirm.click();
  await expect(
    page.getByText('Transaction submitted', { exact: true })
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.__privateDepositFixture.events())).filter(
      (event) => event.startsWith('submit:')
    )
  ).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await expect(
    page.getByText('Deposit verified', { exact: true })
  ).toBeVisible();
  await page
    .getByText('Deposit verified', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('private-deposit-verified-320.png'),
  });
  expect(
    (await page.evaluate(() => window.__privateDepositFixture.events())).filter(
      (event) => event === 'status'
    )
  ).toHaveLength(1);
  await page
    .getByRole('button', { name: 'View in Activity', exact: true })
    .click();
  await expect(page.getByText('Saved Activity', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
});

test('expired review refreshes the same note and needs a new acknowledgement', async ({
  page,
}) => {
  await page.goto('/?private-deposit&expire');
  await page
    .getByRole('button', { name: 'Review deposit', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Refresh review', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh review', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Confirm deposit', exact: true })
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.__privateDepositFixture.events())
  ).toContain('review:eth-0.1:11111111-1111-4111-8111-111111111111');
  expect(
    (await page.evaluate(() => window.__privateDepositFixture.events())).filter(
      (event) => event.startsWith('submit:')
    )
  ).toHaveLength(0);
});

test('unknown submission checks status without offering another send', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?private-deposit&unknown');
  await page
    .getByRole('button', { name: 'Review deposit', exact: true })
    .click();
  await page.getByRole('checkbox').click();
  await page
    .getByRole('button', { name: 'Confirm deposit', exact: true })
    .click();
  await expect(
    page.getByText('Submission status unknown', { exact: true })
  ).toBeVisible();
  await page
    .getByText('Submission status unknown', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('private-deposit-unknown-top-320x360.png'),
  });
  await expect(
    page.getByRole('button', { name: 'Confirm deposit', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await expect(
    page.getByText(
      'This deposit is not present in the current verified pool history.',
      { exact: true }
    )
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
  await visibleAction(page.getByRole('button', { name: 'Done', exact: true }));
  await page.screenshot({
    path: info.outputPath('private-deposit-unknown-320x360.png'),
  });
  expect(
    (await page.evaluate(() => window.__privateDepositFixture.events())).filter(
      (event) => event.startsWith('submit:')
    )
  ).toHaveLength(1);
});

test('closing an opening deposit rejects late UI publication', async ({
  page,
}) => {
  await page.goto('/?private-deposit&hold-open');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.__privateDepositFixture.releaseOpen());
  await expect(page.getByText('Private notes', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__privateDepositFixture
            .events()
            .filter((event) => event === 'close').length
      )
    )
    .toBe(1);
});

test('preparation failures keep provider details hidden and Close reachable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?private-deposit&failed');
  await page
    .getByRole('button', { name: 'Review deposit', exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveText(
    'Could not prepare this deposit. Check your network and funds, then retry.'
  );
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(
    page.getByText('Synthetic provider diagnostic must stay hidden', {
      exact: true,
    })
  ).toHaveCount(0);
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.screenshot({
    path: info.outputPath('private-deposit-error-320x360.png'),
  });
});

test('the encrypted backup link leaves review without submitting', async ({
  page,
}) => {
  await page.goto('/?private-deposit');
  await page
    .getByRole('button', { name: 'Review deposit', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Back up private notes', exact: true })
    .click();
  await expect(
    page.getByText('Encrypted note backup', { exact: true })
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.__privateDepositFixture.events())).filter(
      (event) => event.startsWith('submit:')
    )
  ).toHaveLength(0);
});

test('saved note status is explicit and a spent result never advertises withdrawal', async ({
  page,
}) => {
  await page.goto('/?note-status&spent');
  expect(
    await page.evaluate(() => window.__privateDepositFixture.events())
  ).not.toContain('note:status');
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await expect(page.getByText('Already spent', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Observed at block 100', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Withdraw/ })).toHaveCount(0);
});

test('leaving a note check prevents its delayed result appearing in the list', async ({
  page,
}) => {
  await page.goto('/?note-status&hold-status');
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await page
    .getByRole('button', { name: 'Check pool status', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Checking pool…', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.__privateDepositFixture.releaseStatus());
  await expect(page.getByText('Saved notes', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Verified in pool history', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: /1 ETH pool/ }).click();
  await expect(
    page.getByRole('button', { name: 'Check pool status', exact: true })
  ).toBeEnabled();
});
