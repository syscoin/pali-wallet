import { test, expect, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
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

test('local recipient picker keeps duplicate labels distinguishable at 320px and prepares only on Review', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?local-recipient');
  await page.getByRole('button', { name: 'Choose account' }).click();
  const search = page.getByRole('textbox', { name: 'Find account' });
  await search.fill('savings');
  await expect(search).toBeFocused();
  await page.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('div, span, input'))) {
      if (element.childElementCount || !element.textContent?.trim() && element.tagName !== 'INPUT') continue;
      const { fontSize, lineHeight } = getComputedStyle(element);
      element.style.fontSize = `${parseFloat(fontSize) * 1.6}px`;
      if (Number.isFinite(parseFloat(lineHeight)))
        element.style.lineHeight = `${parseFloat(lineHeight) * 1.6}px`;
    }
  });
  const choice = page.getByRole('button', { name: `Savings account, ${recipient}` });
  const secondRecipient = '0x' + '4'.repeat(40);
  const secondChoice = page.getByRole('button', { name: `Savings account, ${secondRecipient}` });
  await expect(choice).toBeVisible();
  await expect(secondChoice).toBeVisible();
  expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: info.outputPath('local-recipient-320.png') });
  await secondChoice.scrollIntoViewIfNeeded();
  await expect(secondChoice).toBeInViewport({ ratio: 0.9 });
  await page.screenshot({ path: info.outputPath('local-recipient-second-320.png') });
  await secondChoice.click();
  await expect(page.getByRole('textbox', { name: 'Ethereum address' })).toHaveValue(secondRecipient);
  await expect(search).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBeNull();
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.001');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-recipient')).toHaveText(secondRecipient);
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
});

test('a retired picker cannot choose or prepare on a new account scope', async ({ page }) => {
  await page.goto('/?local-recipient');
  const open = page.getByRole('button', { name: 'Choose account' });
  const address = page.getByRole('textbox', { name: 'Ethereum address' });
  await open.click();
  await page.getByRole('button', { name: `Savings account, ${recipient}` }).click();
  await expect(address).toHaveValue(recipient);

  await page.evaluate(() => window.__nativeSendFixture.replaceRecipientScope('Second wallet'));
  await expect(address).toHaveValue('');
  await open.click();
  const stale = page.getByRole('button', { name: `Second wallet, ${recipient}` });
  await stale.evaluate((element) => {
    window.__nativeSendFixture.retireRecipientScope();
    (element as HTMLElement).click();
  });
  await expect(address).toHaveValue('');
  await page.evaluate(() => window.__nativeSendFixture.replaceRecipientScope('Savings account'));
  await expect(page.getByRole('textbox', { name: 'Find account' })).toHaveCount(0);
  await expect(address).toHaveValue('');
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBeNull();
});

test('queued recipient callbacks cannot change a closed or newly opened picker', async ({ page }) => {
  await page.goto('/?local-recipient');
  const open = page.getByRole('button', { name: 'Choose account' });
  const hide = page.getByRole('button', { name: 'Hide accounts' });
  const search = page.getByRole('textbox', { name: 'Find account' });
  const address = page.getByRole('textbox', { name: 'Ethereum address' });

  await open.click();
  // Keep the original rendered callbacks to emulate a delayed native event.
  // Dispatching an event on a detached web node would never call them.
  const callbacks = await page.evaluateHandle((recipientAddress) => {
    const callback = (label: string, name: string) => {
      type Fiber = { memoizedProps?: Record<string, unknown>; return?: Fiber };
      const element = document.querySelector(`[aria-label="${label}"]`);
      if (!element) throw Error('Picker control was not rendered');
      const key = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
      if (!key) throw Error('Picker control has no React fiber');
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      let handler: ((value?: unknown) => void) | undefined;
      for (; fiber; fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (props?.accessibilityLabel === label && typeof props[name] === 'function')
          handler = props[name] as typeof handler;
      }
      if (!handler) throw Error('Picker callback was not found');
      return handler;
    };
    return {
      search: callback('Find account', 'onChangeText'),
      row: callback(`Savings account, ${recipientAddress}`, 'onPress'),
    };
  }, recipient);

  const flush = () => page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await hide.click();
  await callbacks.evaluate(({ search }) => search('retired query'));
  await flush();
  await expect.soft(search).toHaveCount(0, { timeout: 500 });
  if (await hide.isVisible()) await hide.click();

  await open.click();
  await callbacks.evaluate(({ row }) => row({ nativeEvent: {} }));
  await flush();
  await expect.soft(address).toHaveValue('', { timeout: 500 });
  await expect(search).toHaveValue('', { timeout: 500 });
  await callbacks.dispose();
});

test('an unavailable local picker blocks its selected address but leaves manual review usable', async ({ page }) => {
  await page.goto('/?local-recipient');
  await page.getByRole('button', { name: 'Choose account' }).click();
  await page.getByRole('button', { name: `Savings account, ${recipient}` }).click();
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.001');
  await page.evaluate(() => window.__nativeSendFixture.retireRecipientScope());
  await page.getByTestId('native-send-review').click();
  expect(await page.evaluate(() => window.__nativeSendFixture.reviewId())).toBeNull();

  const manual = '0x' + '5'.repeat(40);
  await page.getByRole('textbox', { name: 'Ethereum address' }).fill(manual);
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-recipient')).toHaveText(manual);
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
});

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

test('queued cancellation directs the user to earlier activity', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?cancel-transfer&cancel-queued');
  await expect(page.getByRole('alert')).toHaveText('This cancellation must wait for earlier transactions. Check Activity before trying again.');
  await expect(page.getByRole('button', { name: 'Submit cancellation' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
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

// Existing saved errors must retain their alert even though the status Notice
// also presents recovery guidance.
test('saved expired review keeps its accessible error alert', async ({ page }) => {
  await page.goto('/?quoteFailure=saved-expired');
  await prepare(page);
  await page.getByTestId('native-send-confirm').click();
  const message = 'Your signed transaction is saved. Check it before sending again.';
  const alert = page.getByRole('alert');
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText(message);
  await expect(alert).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('native-send-hash')).toBeVisible();
});


test('storage limit shows one actionable no-submission alert', async ({ page }) => {
  await page.goto('/?storage-full');
  await prepare(page);
  await page.getByTestId('native-send-confirm').click();
  await expect(page.getByRole('alert')).toHaveText('This transaction was not submitted because Pali could not save it within its local transaction storage limit. Check Activity.');
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
});

test('storage limit distinguishes a failed replacement from its earlier saved transaction', async ({ page }) => {
  await page.goto('/?speed-up-transfer&storage-full');
  await page.getByRole('button', { name: 'Submit Speed Up' }).click();
  await expect(page.getByText('Check earlier transaction', { exact: true })).toBeVisible();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveCount(1);
  await expect(alert.getByText('Keep this transaction', { exact: true })).toBeVisible();
  await expect(alert.getByText('This new transaction was not submitted because Pali could not save it within its local transaction storage limit. Check the earlier transaction in Activity.', { exact: true })).toBeVisible();
  await expect(alert).toHaveAttribute('aria-live', 'polite');
  expect(await page.evaluate(() => window.__nativeSendFixture.confirmations())).toEqual([]);
});
