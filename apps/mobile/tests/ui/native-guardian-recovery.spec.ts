import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4201',
  viewport: { width: 320, height: 568 },
});
const events = (page: Page) =>
  page.evaluate(() => window.__guardianRecoveryFixture.events());
async function visibleAction(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 0.999 });
  expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}
async function start(page: Page, query = '') {
  await page.goto(`/?guardian-recovery&${query}`);
  await page
    .getByRole('button', { name: 'Choose replacement owner', exact: true })
    .click();
  await page
    .getByLabel('Search wallet accounts', { exact: true })
    .fill('Replacement key');
  await page.getByRole('radio', { name: /Replacement key/ }).click();
  await page
    .getByRole('button', { name: 'Review recovery', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Authorize recovery', exact: true })
  ).toBeVisible();
}

test('new recovery requires a replacement choice and two explicit actions before submission', async ({
  page,
}, info) => {
  await page.goto('/?guardian-recovery');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(
    page.getByRole('button', { name: 'Review recovery', exact: true })
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('guardian-recovery-form-top-320.png'),
  });
  await page
    .getByRole('button', { name: 'Choose replacement owner', exact: true })
    .click();
  await page
    .getByLabel('Search wallet accounts', { exact: true })
    .fill('Replacement key');
  await page.getByRole('radio', { name: /Replacement key/ }).click();
  await visibleAction(
    page.getByRole('button', { name: 'Review recovery', exact: true })
  );
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.screenshot({
    path: info.outputPath('guardian-recovery-form-bottom-320.png'),
  });
  await page
    .getByRole('button', { name: 'Review recovery', exact: true })
    .click();
  expect(await events(page)).not.toContain('review:schedule');
  await visibleAction(
    page.getByRole('button', { name: 'Authorize recovery', exact: true })
  );
  await page
    .getByRole('button', { name: 'Authorize recovery', exact: true })
    .click();
  await expect(
    page.getByText('Maximum network fee', { exact: true })
  ).toBeVisible();
  expect(await events(page)).not.toContain('submit:schedule');
  await page.screenshot({
    path: info.outputPath('guardian-recovery-fee-320.png'),
  });
  await visibleAction(
    page.getByRole('button', { name: 'Confirm schedule', exact: true })
  );
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.screenshot({
    path: info.outputPath('guardian-recovery-fee-bottom-320.png'),
  });
  await page
    .getByRole('button', { name: 'Confirm schedule', exact: true })
    .click();
  await expect(
    page.getByText('Recovery pending', { exact: true })
  ).toBeVisible();
  expect(
    (await events(page)).filter((value) => value === 'submit:schedule')
  ).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
});

test('resuming a pending intent does not authorize or submit another operation', async ({
  page,
}, info) => {
  await page.goto('/?guardian-recovery&resume');
  await expect(
    page.getByText('Recovery pending', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Authorize recovery', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  expect(
    (await events(page)).some(
      (value) => value.startsWith('review:') || value.startsWith('submit:')
    )
  ).toBe(false);
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  await page.screenshot({
    path: info.outputPath('guardian-recovery-pending-320.png'),
  });
});

test('ready recovery finalizes once and retries only metadata after a read failure', async ({
  page,
}) => {
  await page.goto('/?guardian-recovery&resume&ready&metadata-error');
  await page
    .getByRole('button', { name: 'Review finalization fee', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm finalization', exact: true })
    .click();
  await expect(
    page.getByText('Recovery confirmed', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh account metadata', exact: true })
    .click();
  await expect(
    page.getByText('Replacement owner active', { exact: true })
  ).toBeVisible();
  expect(
    (await events(page)).filter((value) => value === 'submit:finalize')
  ).toHaveLength(1);
  expect(
    (await events(page)).filter((value) => value === 'metadata')
  ).toHaveLength(2);
});

test('expiring a fee quote requires a new review before confirmation', async ({
  page,
}) => {
  await start(page, 'expires');
  await page
    .getByRole('button', { name: 'Authorize recovery', exact: true })
    .click();
  await expect(
    page.getByText('Review expired. Review the current fee again.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm schedule', exact: true })
  ).toHaveCount(0);
  expect(await events(page)).not.toContain('submit:schedule');
});

test('local tracking clear requires acknowledgement and never submits', async ({
  page,
}) => {
  await page.goto('/?guardian-recovery&resume');
  await page
    .getByRole('button', { name: 'Clear local recovery tracking', exact: true })
    .click();
  await expect(
    page.getByText(
      'This forgets the saved recovery intent. It does not cancel transactions or recovery scheduled on the network. Your wallet keys are kept.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Clear saved intent', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I understand that network recovery is not canceled',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Clear saved intent', exact: true })
    .click();
  await expect(
    page.getByText('Recovery tracking cleared', { exact: true })
  ).toBeVisible();
  expect(await events(page)).toContain('abandon');
  expect(
    (await events(page)).some((value) => value.startsWith('submit:'))
  ).toBe(false);
});

test('closing during opening retires the pane and prevents late review', async ({
  page,
}) => {
  await page.goto('/?guardian-recovery&resume&held-open');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.__guardianRecoveryFixture.releaseOpen());
  await expect(
    page.getByText('Recovery closed', { exact: true })
  ).toBeVisible();
  expect(
    (await events(page)).some(
      (value) => value.startsWith('review:') || value.startsWith('submit:')
    )
  ).toBe(false);
});

test('large account lists use the searched chooser without expanding the recovery form', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?guardian-recovery&large');
  await page
    .getByRole('button', { name: 'Choose replacement owner', exact: true })
    .click();
  await page
    .getByLabel('Search wallet accounts', { exact: true })
    .fill('Wallet account 1499');
  await page.getByRole('radio', { name: /Wallet account 1499/ }).click();
  await expect(
    page.getByText('Wallet account 1499', { exact: true })
  ).toBeVisible();
  await visibleAction(
    page.getByRole('button', { name: 'Review recovery', exact: true })
  );
  await visibleAction(page.getByRole('button', { name: 'Close', exact: true }));
  expect(await events(page)).toEqual([]);
});

test('failed Activity navigation keeps recovery usable and reports a safe error', async ({
  page,
}) => {
  await page.goto('/?guardian-recovery&resume&handoff-fails');
  await page
    .getByRole('button', { name: 'View saved transaction', exact: true })
    .click();
  await expect(
    page.getByText(
      'The saved transaction could not be opened. Check status or close and resume recovery.',
      { exact: true }
    )
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__guardianRecoveryFixture.disposed())
  ).toBe(0);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  expect(
    (await events(page)).filter((value) => value === 'observe').length
  ).toBeGreaterThan(1);
  await expect(page.getByText('Private failure', { exact: true })).toHaveCount(
    0
  );
});

test('unsupported guardian thresholds explain the limit before opening recovery', async ({
  page,
}) => {
  await page.goto('/?guardian-recovery&threshold-two');
  await expect(
    page.getByText('Guardian policy unsupported', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review recovery', exact: true })
  ).toBeDisabled();
  expect(await events(page)).toEqual([]);
});

test('a different pending recovery does not appear as this intent or offer authorization', async ({
  page,
}) => {
  await page.goto('/?guardian-recovery&resume&other-recovery');
  await expect(
    page.getByText(
      'Another recovery is pending for this account. Check its status before continuing.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Authorize recovery', exact: true })
  ).toHaveCount(0);
  expect(
    (await events(page)).some(
      (value) => value.startsWith('review:') || value.startsWith('submit:')
    )
  ).toBe(false);
});
