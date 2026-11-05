import { test, expect } from '@playwright/test';
for (const decimals of [0, 18, 19, 255]) {
  test(`Activity renders a valid ${decimals}-decimal token in the list and details`, async ({
    page,
  }) => {
    await page.addInitScript((precision) => {
      Object.defineProperty(window, '__activityFixture', {
        configurable: true,
        set(value) {
          Object.defineProperty(window, '__activityFixture', {
            value,
            configurable: true,
          });
          value.tokenPrecision(precision);
        },
      });
    }, decimals);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const exactAmount = decimals === 0 ? '1 PRECISE' : `0.${'0'.repeat(decimals - 1)}1 PRECISE`;
    const row = page.getByRole('button', {
      name: new RegExp('PRECISE.*View transaction details'),
    });
    await expect(row).toContainText(exactAmount);
    await row.click();
    await expect(
      page.getByText('Transaction details', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(exactAmount, { exact: true }).last()
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test('Activity details remain usable when an invalid fee reaches the view', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__activityFixture', {
      configurable: true,
      set(value) {
        Object.defineProperty(window, '__activityFixture', {
          value,
          configurable: true,
        });
        value.invalidFee(true);
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('button', { name: /1 ETH, Confirmed/ })
    .first()
    .click();
  await expect(
    page.getByText('Actual fee not verified', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByText('Activity', { exact: true }).first()
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('confirmed address copy writes the complete address to the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(() =>
    navigator.clipboard.writeText('fixture-before-copy')
  );
  await page
    .getByRole('button', { name: /1 ETH, Confirmed/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Copy sender address', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Copy full address', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`0x${'11'.repeat(20)}`);
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).not.toBeVisible();
});
test('actual Activity uses indexed values without RPC, filters zero-value events, and requires full-address copy confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByText('1 zero-value token transaction hidden.')
  ).toBeVisible();
  expect(await page.evaluate(() => window.__activityFixture.feedReads())).toBe(
    2
  );
  expect(
    await page.evaluate(() => window.__activityFixture.receiptReads())
  ).toBe(0);
  await page
    .getByRole('button', {
      name: 'Show zero-value token activity',
      exact: true,
    })
    .click();
  await expect(page.getByText('0 ZERO', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /0 ZERO, Confirmed/ }).click();
  await expect(
    page.getByText('Transaction details', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy event sender', exact: true })
    .click();
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy full address', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('feed failure remains retryable, and indexed detail/back works while explicit enrichment is in flight', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__activityFixture', {
      configurable: true,
      set(value) {
        Object.defineProperty(window, '__activityFixture', {
          value,
          configurable: true,
        });
        value.fail(true);
        value.delay(true);
      },
    });
  });
  await page.goto('/');
  await expect(
    page.getByText('Some activity is unavailable', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => (window as any).__activityFixture.fail(false));
  await page
    .getByRole('button', { name: 'Refresh activity', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /1 ETH, Confirmed/ }).first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: /1 ETH, Confirmed/ })
    .first()
    .click();
  await expect(
    page.getByText('Transaction details', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByText('Activity', { exact: true }).first()
  ).toBeVisible();
  await page.evaluate(() => (window as any).__activityFixture.release());
  await expect(
    page.getByRole('button', { name: /1 ETH, Confirmed/ }).first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Load older activity', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Load older activity', exact: true })
  ).toBeEnabled();
});
test('older indexed rows need no RPC and return to the same list position after selected enrichment', async ({
  page,
}) => {
  await page.goto('/');
  const older = page.getByRole('button', {
    name: 'Load older activity',
    exact: true,
  });
  await older.click();
  await older.scrollIntoViewIfNeeded();
  const row = page
    .getByRole('button')
    .filter({ hasText: '0x0000000000…00000028' });
  await expect(row).toContainText('Confirmed');
  expect(
    await page.evaluate(() => window.__activityFixture.receiptReads())
  ).toBe(0);
  await row.click();
  await expect(
    page.getByText('Transaction details', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__activityFixture.receiptReads())
  ).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(row).toBeVisible();
});
test('copy review actions remain reachable on a small screen with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/');
  await page
    .getByRole('button', { name: /1 ETH, Confirmed/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Copy sender address', exact: true })
    .click();
  await page.addStyleTag({
    content:
      '[role="dialog"] div { font-size: 25px !important; line-height: 1.6 !important; }',
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('Copy this address?', { exact: true })
  ).not.toBeVisible();
});
test('Back waits for asynchronous position persistence before unmounting', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /1 ETH, Confirmed/ }).first()
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).__activityFixture.clearView();
    (window as any).__activityFixture.delaySave(100);
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Activity', exact: true })
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    (window as any).__activityFixture.savedView()
  );
  expect(saved.anchor).toMatch(/^0x[0-9a-f]{64}$/);
  expect(saved.offset).toBeGreaterThanOrEqual(0);
  await page
    .getByRole('button', { name: 'Open Activity', exact: true })
    .click();
  await expect(
    page.getByText('Activity', { exact: true }).first()
  ).toBeVisible();
});

test('generic contract creation keeps activity readable without inventing a recipient', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?contract-creation');
  await page
    .getByRole('button')
    .filter({ hasText: '0x0000000000…00000001' })
    .click();
  await expect(
    page.getByText('Contract creation', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy recipient address', exact: true })
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const mode of ['missing','invalid','malformed']) test(`custody ${mode} token metadata never displays raw units as a human amount`, async ({page}, testInfo) => {
  await page.goto('/?token-metadata='+mode);
  const row=page.getByRole('button',{name:/UNKNOWN.*View transaction details/});
  const amount=mode==='malformed'?'? UNKNOWN':'UNKNOWN transfer';
  await expect(row).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('custody-'+mode+'-list.png')});
  await expect(row).toContainText(amount);
  await expect(row).not.toContainText('1000000 UNKNOWN');
  await row.click();
  await expect(page.getByText(amount,{exact:true}).last()).toBeVisible();
  await expect(page.getByText(mode==='malformed'?'Raw token units: Unavailable':'Raw token units: 1000000',{exact:true})).toBeVisible();
});


for (const mode of ['token-placeholder', 'mixed-case']) test(`custody Activity preserves both transaction hashes for ${mode} history`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?history-identity=${mode}`);
  for (const index of [0xabc, 0xdef]) {
    const id = `0x${index.toString(16).padStart(64, '0')}`;
    const row = page.getByText(`${id.slice(0, 12)}…${id.slice(-8)}`, { exact: true }).locator('xpath=ancestor::*[@role="button"][1]');
    await expect(row).toBeVisible(); await expect(row).toContainText('Confirmed');
  }
  expect(await page.evaluate(() => window.__activityFixture.feedReads())).toBe(mode === 'mixed-case' ? 3 : 2);
  expect(await page.evaluate(() => window.__activityFixture.receiptReads())).toBe(0);
  await expect(page.getByText(/One activity feed is unavailable|Activity could not be fully loaded/)).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`custody-${mode}.png`), fullPage: true });
  expect(errors).toEqual([]);
});
