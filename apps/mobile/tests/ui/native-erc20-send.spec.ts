import { test, expect, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || !['4179', '4181'].includes(url.port)) {
      await route.abort();
      throw new Error(`Unexpected external request: ${url.origin}`);
    }
    await route.continue();
  });
});
const recipient = '0x1111111111111111111111111111111111111111';
const contract = '0x3333333333333333333333333333333333333333';
const password = (page: Page) =>
  page.getByLabel('Confirm your wallet password', { exact: true });
async function prepare(page: Page, amount = '2.5') {
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in FIX', { exact: true }).fill(amount);
  await page.getByTestId('native-send-review').click();
  await expect(page.getByTestId('native-send-confirm')).toBeVisible();
  await expect(password(page)).toHaveCount(0);
}

for (const [kind, amount] of [
  ['zero', '0'],
  ['over-precision', '1.0000001'],
  ['malformed', '1e3'],
] as const) {
  test(`invalid ERC20 ${kind} amount remains editable and can be corrected on the same screen`, async ({
    page,
  }) => {
    await page.goto('/?erc20-send');
    const recipientInput = page.getByLabel('Ethereum address', { exact: true });
    const amountInput = page.getByLabel('Amount in FIX', { exact: true });
    await recipientInput.fill(recipient);
    await amountInput.fill(amount);
    await amountInput.evaluate((input) =>
      input.setAttribute('data-recovery-screen', 'original')
    );
    await page.getByTestId('native-send-review').click();
    await expect(
      page.getByText(
        'Enter an Ethereum address and an amount greater than zero.',
        { exact: true }
      )
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        rpc: window.__erc20SendFixture.rpcMethods(),
        signatures: window.__erc20SendFixture.signatures(),
        unlockChecks: window.__erc20SendFixture.unlockChecks(),
        broadcasts: window.__erc20SendFixture.broadcasts(),
        journal: window.__erc20SendFixture.journal(),
      }))
    ).toEqual({
      rpc: [],
      signatures: 0,
      unlockChecks: 0,
      broadcasts: [],
      journal: null,
    });
    await expect(amountInput).toBeEditable();
    await expect(recipientInput).toBeEditable();
    await expect(recipientInput).toHaveValue(recipient);
    await expect(amountInput).toHaveValue(amount);
    await expect(amountInput).toHaveAttribute(
      'data-recovery-screen',
      'original'
    );
    await expect(page.getByTestId('native-send-review')).toBeEnabled();
    await expect(
      page.getByText('Checking the network…', { exact: true })
    ).toHaveCount(0);
    await expect(password(page)).toHaveCount(0);

    await amountInput.fill('2.5');
    await page.getByTestId('native-send-review').click();
    await expect(page.getByTestId('native-send-confirm')).toBeVisible();
    await expect(password(page)).toHaveCount(0);
    await expect(page.getByTestId('native-send-amount')).toHaveText('2.5');
    await expect(page.getByTestId('native-send-recipient')).toHaveText(
      recipient
    );
    await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
    expect(
      await page.evaluate(() => window.__erc20SendFixture.rpcMethods())
    ).toContain('eth_estimateGas');
    expect(
      await page.evaluate(() => window.__erc20SendFixture.signatures())
    ).toBe(0);
    expect(
      await page.evaluate(() => window.__erc20SendFixture.journal())
    ).toBeNull();
  });
}

test('real ERC20 controller shows asset intent and preserves exact signed bytes and precision over reload/retry', async ({
  page,
}, info) => {
  await page.goto('/?erc20-send');
  await prepare(page);
  await expect(page.getByTestId('native-send-amount')).toHaveText('2.5');
  await expect(page.getByTestId('native-send-token-contract')).toHaveText(
    contract
  );
  await expect(page.getByTestId('native-send-token-decimals')).toHaveText('6');
  await expect(page.getByTestId('native-send-recipient')).toHaveText(recipient);
  await expect(page.getByTestId('native-send-fee')).toContainText('ETH');
  await expect(page.getByText('MAXIMUM TOTAL', { exact: true })).toHaveCount(0);
  await page
    .getByRole('heading', { name: 'Review transfer', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('erc20-review.png'),
    fullPage: true,
  });
  await page.getByTestId('native-send-confirm').click();
  await expect(page.getByTestId('native-send-hash')).toBeVisible();
  const firstHash = await page.getByTestId('native-send-hash').textContent();
  const firstBytes = await page.evaluate(
    () => window.__erc20SendFixture.broadcasts()[0]
  );
  expect(firstBytes).toBeTruthy();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(1);

  await page.goto(`/?erc20-send&saved=${firstHash!}`);
  await expect(page.getByText(firstHash!, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__erc20SendFixture.setRuntimePrecision(18);
    window.__erc20SendFixture.acceptBroadcasts();
  });
  await expect(page.getByTestId('native-send-amount')).toHaveText('2.5');
  await expect(page.getByTestId('native-send-token-contract')).toHaveText(
    contract
  );
  await expect(password(page)).toHaveCount(0);
  await page.getByTestId('native-send-confirm').click();
  await expect(page.getByTestId('native-send-hash')).toHaveText(firstHash!);
  expect(
    await page.evaluate(() => window.__erc20SendFixture.broadcasts()[0])
  ).toBe(firstBytes);
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
  expect(
    await page.evaluate(() => window.__erc20SendFixture.unlockChecks())
  ).toBe(1);
  await page.evaluate(() => window.__erc20SendFixture.finalized());
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(
    page.getByText('Transaction confirmed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Transfer confirmed', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText(/Check the token balance for the received amount/)
  ).toBeVisible();
});

test('saved recovery remains actionable through an observation outage', async ({ page }, info) => {
  await page.goto('/?erc20-send');
  await prepare(page);
  await page.getByTestId('native-send-confirm').click();
  const hash = await page.getByTestId('native-send-hash').textContent();
  expect(hash).toBeTruthy();

  // Activity opens the retained transaction after the original lost ACK.
  await page.goto(`/?erc20-send&saved=${hash!}&observation-unavailable`);
  await expect(page.getByTestId('native-send-hash')).toHaveText(hash!);
  await expect(page.getByText('Status unavailable', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('saved-status-unavailable.png') });
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  await expect(page.getByTestId('native-send-review')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review retry', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts())).toEqual([]);
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(0);

  await page.evaluate(() => window.__erc20SendFixture.restoreObservation());
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review retry', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review retry', exact: true }).click();
  await expect(page.getByTestId('native-send-confirm')).toHaveText('Resend signed transaction');
  await page.screenshot({ path: info.outputPath('saved-status-retry-review.png') });
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts())).toEqual([]);
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(0);
});

test('a fresh token send waits for the saved predecessor and succeeds after canonical confirmation', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/?erc20-send&multiple-pending');
  await prepare(page);
  await page.getByTestId('native-send-confirm').click();
  const hash = page.getByTestId('native-send-hash');
  await expect(hash).toBeVisible();
  const firstHash = await hash.textContent();
  expect(firstHash).toBeTruthy();
  await page.getByRole('button', { name: 'Back to wallet', exact: true }).click();
  const callsBefore = await page.evaluate(() => {
    window.__erc20SendFixture.acceptPendingNonce();
    return window.__erc20SendFixture.rpcMethods();
  });

  await page.getByRole('button', { name: 'Send token', exact: true }).click();
  const amount = page.getByLabel('Amount in FIX', { exact: true });
  const address = page.getByLabel('Ethereum address', { exact: true });
  await expect(amount).toBeEditable();
  await expect(hash).toHaveCount(0);
  expect(await page.evaluate(() => window.__erc20SendFixture.rpcMethods())).toEqual(callsBefore);
  await page.screenshot({ path: info.outputPath('fresh-send-320.png'), fullPage: true });
  await address.fill(recipient);
  await amount.fill('1');
  await page.getByTestId('native-send-review').click();
  await expect(page.getByText('Network conditions changed while checking this transfer. Check Activity, then try again.', { exact: true })).toBeVisible();
  await expect(address).toBeEditable();
  await expect(address).toHaveValue(recipient);
  await expect(amount).toBeEditable();
  await expect(amount).toHaveValue('1');
  await expect(page.getByTestId('native-send-confirm')).toHaveCount(0);
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(1);
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts().length)).toBe(1);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Open first saved transfer', exact: true }).click();
  await expect(page.getByText(firstHash!, { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-send-confirm')).toHaveText('Resend signed transaction');
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(1);
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts().length)).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // The fixture advances both the canonical nonce and the matching receipt;
  // pending nonce alone must not unblock asset review.
  await page.evaluate(() => window.__erc20SendFixture.finalized());
  await page.getByRole('button', { name: 'Open first saved transfer', exact: true }).click();
  await expect(page.getByTestId('native-send-hash')).toHaveText(firstHash!);
  await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Send token', exact: true }).click();
  await prepare(page, '1');
  await page.getByTestId('native-send-confirm').click();
  await expect(hash).toBeVisible();
  await expect(hash).not.toHaveText(firstHash!);
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(2);
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts().length)).toBe(2);

  await page.evaluate(() => window.__erc20SendFixture.lock());
  await expect(page.getByText('Wallet closed', { exact: true })).toBeVisible();
  await expect(hash).toHaveCount(0);
  await page.evaluate(() => window.__erc20SendFixture.unlock());
  await page.getByRole('button', { name: 'Send token', exact: true }).click();
  await expect(amount).toBeEditable();
  await expect(page.getByTestId('native-send-confirm')).toHaveCount(0);
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(2);
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts().length)).toBe(2);
});

test('a post-sign asset-state change shows one saved no-broadcast message', async ({ page }) => {
  await page.goto('/?erc20-send');
  await prepare(page);
  await page.evaluate(() => window.__erc20SendFixture.raceAfterSigning());
  await page.getByTestId('native-send-confirm').click();
  const message = 'Your signed transaction is saved and was not submitted. The network is still updating; check Activity before retrying.';
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(page.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByText('Saved, not submitted', { exact: true })).toBeVisible();
  await expect(page.getByText('Checking submission', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('native-send-hash')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__erc20SendFixture.signatures())).toBe(1);
  expect(await page.evaluate(() => window.__erc20SendFixture.broadcasts())).toEqual([]);
  expect(await page.evaluate(() => window.__erc20SendFixture.journal())).toBeTruthy();
});

test('ERC20 review expiry retires consent and its replacement never signs automatically', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?erc20-send');
  await prepare(page);
  await page.clock.runFor(90001);
  await expect(password(page)).toHaveCount(0);
  await prepare(page);
  await expect(password(page)).toHaveCount(0);
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
});

test('account-context revision retires an ERC20 review without signing', async ({
  page,
}) => {
  await page.goto('/?erc20-send');
  await prepare(page);
  await page.evaluate(() => window.__erc20SendFixture.revise());
  await expect(password(page)).toHaveCount(0);
  await prepare(page);
  await expect(password(page)).toHaveCount(0);
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
});

test('network A-B-A rejects a held ERC20 quote before a new review', async ({
  page,
}) => {
  await page.goto('/?erc20-send');
  await page.evaluate(() => window.__erc20SendFixture.holdQuote());
  await page.getByLabel('Ethereum address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount in FIX', { exact: true }).fill('2.5');
  await page.getByTestId('native-send-review').click();
  await expect(
    page.getByText('Checking the network…', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => {
    window.__erc20SendFixture.networkRoundTrip();
    window.__erc20SendFixture.releaseQuote();
  });
  await expect(password(page)).toHaveCount(0);
  await prepare(page);
  await expect(password(page)).toHaveCount(0);
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  expect(
    await page.evaluate(() => window.__erc20SendFixture.signatures())
  ).toBe(0);
});

test('narrow ERC20 review retains full identities, exact amount and reachable confirmation', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?erc20-send');
  await prepare(page, '90071992547409.93');
  await expect(page.getByTestId('native-send-amount')).toHaveText(
    '90071992547409.93'
  );
  await expect(page.getByTestId('native-send-token-contract')).toHaveText(
    contract
  );
  await expect(page.getByTestId('native-send-confirm')).toBeEnabled();
  const reviewOrder = await page.evaluate(() =>
    ['recipient', 'fee', 'token-contract', 'confirm'].map((field) =>
      document.querySelector(`[data-testid="native-send-${field}"]`)!.getBoundingClientRect().top
    )
  );
  expect(reviewOrder).toEqual([...reviewOrder].sort((a, b) => a - b));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page
    .getByRole('heading', { name: 'Review transfer', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('erc20-review-320.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>('[dir="auto"]')
    )) {
      const style = getComputedStyle(node);
      node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    }
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await expect(password(page)).toHaveCount(0);
  await page.getByTestId('native-send-confirm').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('native-send-confirm')).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('erc20-confirm-320-large-text.png'),
    fullPage: true,
  });
});
