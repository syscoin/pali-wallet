import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
  viewport: { width: 320, height: 568 },
});
const events = (page: Page) =>
  page.evaluate(() => window.__guardianPolicyFixture.events());
async function visibleAction(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 0.999 });
  const box = await locator.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
}
async function open(page: Page, query = '') {
  await page.goto(`/?guardian-policy&${query}`);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check again', exact: true })
  ).toBeVisible();
}
async function form(page: Page, query = '') {
  await open(page, query);
  await page
    .getByRole('button', {
      name: query.includes('new-policy') ? 'Set guardian' : 'Update guardian',
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel('Guardian address', { exact: true })
  ).toBeVisible();
}

test('watch-only status exposes no guardian mutation', async ({ page }) => {
  await open(page, 'read-only');
  await expect(
    page.getByRole('button', { name: 'Update guardian', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Set guardian', exact: true })
  ).toHaveCount(0);
  expect(await events(page)).toEqual([]);
});

test('ordinary and testnet forms reuse the shared delay choices', async ({
  page,
}, info) => {
  await form(page, 'new-policy');
  await expect(
    page.getByRole('radio', { name: '10 minutes', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('radio', { name: '3 days', exact: true })
  ).toBeChecked();
  await expect(
    page.getByText(
      'This policy uses one guardian. A recovery request becomes ready after 3 days and can be finalized for 6 days once ready.',
      { exact: true }
    )
  ).toBeVisible();
  await page.getByLabel('Guardian address', { exact: true }).fill('invalid');
  await page
    .getByRole('button', { name: 'Review policy', exact: true })
    .click();
  await expect(
    page.getByText('Enter a valid guardian address.', { exact: true })
  ).toBeVisible();
  expect(await events(page)).toEqual([]);
  await page
    .getByLabel('Guardian address', { exact: true })
    .fill('0x5555555555555555555555555555555555555555');
  await page.getByText('Recovery delay', { exact: true }).click();
  await expect(
    page.getByText('Enter a valid guardian address.', { exact: true })
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('guardian-form-320.png'),
    fullPage: false,
  });
  await visibleAction(
    page.getByRole('button', { name: 'Review policy', exact: true })
  );
  await visibleAction(
    page.getByRole('button', { name: 'Cancel', exact: true })
  );
  await page.screenshot({
    path: info.outputPath('guardian-form-bottom-320.png'),
    fullPage: false,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
  await form(page, 'new-policy&testnet');
  await expect(
    page.getByRole('radio', { name: '10 minutes', exact: true })
  ).toBeVisible();
});

test('pending recovery acknowledgement carries its exact observed operation ID', async ({
  page,
}) => {
  await form(page, 'pending');
  const review = page.getByRole('button', {
    name: 'Review policy',
    exact: true,
  });
  await expect(review).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I understand this changes the pending recovery policy',
      exact: true,
    })
    .check();
  await review.click();
  const recorded = await events(page);
  expect(recorded).toEqual([
    {
      method: 'open',
      draft: {
        action: 'set',
        guardian: '0x5555555555555555555555555555555555555555',
        delaySeconds: 259200,
        acknowledgedPendingOperationId: '0x' + 'ab'.repeat(32),
      },
    },
  ]);
  await expect(
    page.getByRole('button', { name: 'Authorize policy', exact: true })
  ).toBeVisible();
});

test('guardian policy uses distinct authorization and payer consent with metadata-only refresh', async ({
  page,
}, info) => {
  await form(page, 'refresh-fails');
  await page
    .getByRole('button', { name: 'Review policy', exact: true })
    .click();
  await expect(
    page.getByText('Review guardian policy', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Recovery delay · 3 days', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Finalization window once ready · 6 days', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('guardian-authorization-top-320.png'),
    fullPage: false,
  });
  const authorize = page.getByRole('button', {
    name: 'Authorize policy',
    exact: true,
  });
  await visibleAction(authorize);
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await authorize.click();
  await expect(
    page.getByText('Submit the authorized guardian policy', { exact: true })
  ).toBeVisible();
  const confirm = page.getByRole('button', {
    name: 'Confirm policy',
    exact: true,
  });
  await visibleAction(confirm);
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.screenshot({
    path: info.outputPath('guardian-payer-bottom-320.png'),
    fullPage: false,
  });
  await confirm.click();
  await expect(
    page.getByText('Guardian policy updated', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh account status', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Refresh account status', exact: true })
  ).toHaveCount(0);
  expect((await events(page)).map((event) => event.method)).toEqual([
    'open',
    'authorize',
    'confirm',
    'refresh',
  ]);
  await expect(
    page.getByText('0x' + 'cd'.repeat(32), { exact: true })
  ).toBeVisible();
});

test('closing held policy preparation disposes the late operation without authorization', async ({
  page,
}) => {
  await form(page, 'hold-open');
  await page
    .getByRole('button', { name: 'Review policy', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('Guardian tool closed', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => window.__guardianPolicyFixture.resolveOpening());
  await expect
    .poll(() => page.evaluate(() => window.__guardianPolicyFixture.disposed()))
    .toBeGreaterThan(0);
  expect((await events(page)).map((event) => event.method)).toEqual(['open']);
});

test('short viewport preserves guardian form and close controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 380 });
  await form(page, 'new-policy');
  await page
    .getByLabel('Guardian address', { exact: true })
    .fill('0x5555555555555555555555555555555555555555');
  await visibleAction(
    page.getByRole('button', { name: 'Review policy', exact: true })
  );
  await visibleAction(
    page.getByRole('button', { name: 'Cancel', exact: true })
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
});

async function removal(page: Page, query = '') {
  await open(page, query);
  await page
    .getByRole('button', { name: 'Remove guardian', exact: true })
    .click();
}

test('removal requires recovery-loss and pending-ID acknowledgement before both transaction reviews', async ({
  page,
}, info) => {
  await removal(page, 'pending&refresh-fails');
  await page
    .getByText('Remove guardian', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('guardian-remove-form-top-320.png'),
    fullPage: false,
  });
  const review = page.getByRole('button', {
    name: 'Review removal',
    exact: true,
  });
  await expect(review).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I understand guardian recovery will be removed',
      exact: true,
    })
    .check();
  await expect(review).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I understand this changes the pending recovery policy',
      exact: true,
    })
    .check();
  await expect(review).toBeEnabled();
  await visibleAction(review);
  await visibleAction(
    page.getByRole('button', { name: 'Cancel', exact: true })
  );
  await page.screenshot({
    path: info.outputPath('guardian-remove-form-bottom-320.png'),
    fullPage: false,
  });
  await review.click();
  const recorded = await events(page);
  expect(recorded).toEqual([
    { method: 'inspect' },
    {
      method: 'open',
      draft: {
        action: 'remove',
        acknowledgedPendingOperationId: '0x' + 'ab'.repeat(32),
        recoveryLossAcknowledged: true,
      },
    },
  ]);
  await expect(
    page.getByText('Review guardian removal', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Guardian recovery module', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('guardian-remove-review-top-320.png'),
    fullPage: false,
  });
  await visibleAction(
    page.getByRole('button', { name: 'Authorize removal', exact: true })
  );
  await page
    .getByRole('button', { name: 'Authorize removal', exact: true })
    .click();
  await visibleAction(
    page.getByRole('button', { name: 'Confirm removal', exact: true })
  );
  await page
    .getByRole('button', { name: 'Confirm removal', exact: true })
    .click();
  await expect(
    page.getByText('Guardian recovery removed', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh account status', exact: true })
    .click();
  expect((await events(page)).map((event) => event.method)).toEqual([
    'inspect',
    'open',
    'authorize',
    'confirm',
    'refresh',
  ]);
});

test('a retained unresolved removal requires an explicit status check before another review', async ({
  page,
}) => {
  await removal(page, 'removal-pending');
  await expect(
    page.getByText('Removal awaiting a network result', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review removal', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText('0x' + 'cd'.repeat(32), { exact: true })
  ).toBeVisible();
  expect((await events(page)).map((event) => event.method)).toEqual([
    'inspect',
  ]);
  await page
    .getByRole('button', { name: 'Check removal status', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Review removal', exact: true })
  ).toBeDisabled();
  expect((await events(page)).map((event) => event.method)).toEqual([
    'inspect',
    'inspect',
  ]);
});

for (const status of ['unknown', 'removed'])
  test(`${status} removal inspection cannot prepare another transaction`, async ({
    page,
  }) => {
    await removal(page, `removal-${status}`);
    await expect(
      page.getByText(
        status === 'unknown'
          ? 'Removal status unavailable'
          : 'Guardian recovery is already removed',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Review removal', exact: true })
    ).toHaveCount(0);
    expect((await events(page)).map((event) => event.method)).toEqual([
      'inspect',
    ]);
  });

test('closing an in-flight removal inspection cannot reopen its form', async ({
  page,
}) => {
  await removal(page, 'hold-inspection');
  await expect(
    page.getByText('Checking previous removal attempts…', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.__guardianPolicyFixture.resolveInspection());
  await expect(
    page.getByText('Guardian tool closed', { exact: true })
  ).toBeVisible();
  expect((await events(page)).map((event) => event.method)).toEqual([
    'inspect',
  ]);
});
