import { test, expect } from '@playwright/test';
test('Saved pending pages exact hashes and opens the selected retry at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?saved-pending');
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await expect(page.getByText('Submitted · waiting for confirmation', { exact: true })).toBeVisible();
  const older = page.getByRole('button', { name: /Submission unconfirmed.*View transaction details/ });
  await expect(older).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more saved transfers' }).click();
  await older.click();
  await expect(page.getByText('Transaction details', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review resend', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Activity' })).toBeVisible();
});

test('older saved detail uses current nonce status over stale indexed confirmation at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?saved-pending=indexed');
  await page.waitForFunction(() => window.__activityFixture?.rowState().some(row => row.indexedStatus === 'confirmed'));
  await page.getByRole('button', { name: 'Saved pending', exact: true }).click();
  await page.getByRole('button', { name: 'Load more saved transfers' }).click();
  await page.getByRole('button', { name: /Submission unconfirmed.*View transaction details/ }).click();
  await expect(page.getByText('Transaction details', { exact: true })).toBeVisible();
  await expect(page.getByText('Nonce consumed · outcome unavailable', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('BLOCK', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__activityFixture!.receiptReads())).toBe(0);
});

test('retained collectible details show signed fields without a resend action at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?retained-collectible');
  const row = page.getByRole('button', { name: /View transaction details/ });
  await expect(row).toHaveAccessibleName(/^Collectible transfer, Submission unconfirmed\..*View transaction details$/);
  const label = row.getByText('Collectible transfer', { exact: true });
  await expect(label).toBeInViewport();
  const labelBounds = await label.boundingBox();
  expect(labelBounds!.x + labelBounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('retained-collectible-row-320.png') });
  await row.click();
  await expect(page.getByText('SIGNED COLLECTIBLE TRANSFER', { exact: true })).toBeVisible();
  await expect(page.getByText('ERC-1155', { exact: true })).toBeVisible();
  await expect(page.getByText('0', { exact: true })).toBeVisible();
  const quantity = page.getByText(((1n << 256n) - 1n).toString(), { exact: true });
  await quantity.scrollIntoViewIfNeeded();
  await expect(quantity).toBeInViewport();
  const bounds = await quantity.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await expect(page.getByText(`0x${'22'.repeat(20)}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`0x${'33'.repeat(20)}`, { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review resend', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('retained-collectible-320.png') });
});

test('a retained collectible copies the signed recipient even when indexed history gives the contract', async ({ page }) => {
  const signedRecipient = `0x${'22'.repeat(20)}`;
  const contract = `0x${'33'.repeat(20)}`;
  await page.goto('/?retained-collectible=indexed');
  await page.waitForFunction(() => window.__activityFixture?.rowState().some(row => row.indexedStatus !== undefined));
  await page.getByRole('button', { name: /Collectible transfer.*View transaction details/ }).click();
  await expect(page.getByText('SIGNED RECIPIENT', { exact: true })).toBeVisible();
  await expect(page.getByText(signedRecipient, { exact: true })).toBeVisible();
  await expect(page.getByText(contract, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy recipient address' }).click();
  await expect(page.getByText('Copy this address?', { exact: true })).toBeVisible();
  const address = page.getByText(signedRecipient, { exact: true });
  await expect(address).toHaveCount(2);
  await expect(address.last()).toBeInViewport();
  await expect(page.getByText(contract, { exact: true })).toHaveCount(1);
});

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
    await expect(row).toHaveAccessibleName(new RegExp(`^${exactAmount.replace('.', '\\.')}[,]`));
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
  await expect(page.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Activity options', exact: true }).click();
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
  const row = page.getByTestId(`activity-row-0x${'28'.padStart(64, '0')}`);
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
  await page.getByTestId(`activity-row-0x${'1'.padStart(64, '0')}`).click();
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
    const row = page.getByTestId(`activity-row-${id}`);
    await expect(row).toBeVisible(); await expect(row).toContainText('Confirmed');
  }
  expect(await page.evaluate(() => window.__activityFixture.feedReads())).toBe(mode === 'mixed-case' ? 3 : 2);
  expect(await page.evaluate(() => window.__activityFixture.receiptReads())).toBe(0);
  await expect(page.getByText(/One activity feed is unavailable|Activity could not be fully loaded/)).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`custody-${mode}.png`), fullPage: true });
  expect(errors).toEqual([]);
});
