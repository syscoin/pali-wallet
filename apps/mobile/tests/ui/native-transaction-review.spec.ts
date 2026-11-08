import { expect, test } from '@playwright/test';

const fixture = `${process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179'}/?transaction-review=1`;
test.use({ hasTouch: true });

test('shows exact amounts and inspectable transaction details on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${fixture}&font-scale=1.6`);
  await expect(page.getByText('1234567.890123456789012345 COIN', { exact: true })).toBeVisible();
  await expect(page.getByText('0.000000000000252 COIN', { exact: true })).toBeVisible();
  await expect(page.getByText('1234567.890123456789264345 COIN', { exact: true })).toBeVisible();
  await expect(page.getByText('Custom network · Chain ID 743211')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('transaction-review-320-top.png'), fullPage: true });
  await page.getByRole('button', { name: 'View transaction details', exact: true }).click();
  await expect(page.getByText(/"storageKeys"/)).toBeVisible();
  await expect(page.getByText(/"nonce": "3"/)).toBeVisible();
  const approve = page.getByRole('button', { name: 'Confirm transaction', exact: true });
  await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('transaction-review-320-controls.png'), fullPage: true });
  await approve.click();
  await expect(page.getByText('Request completed')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls()))
    .toEqual([{ method: 'approveRequest', args: ['transaction-1', 7, false] }]);
});

test('shows contract deployment and pages large calldata without hiding approval controls', async ({ page }) => {
  await page.goto(`${fixture}&deployment=1&large-data=1`);
  await expect(page.getByText('Contract deployment', { exact: true })).toBeVisible();
  await expect(page.getByText('New contract', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View transaction details', exact: true }).click();
  const counter = page.getByText(/^Page \d+ of \d+$/);
  await expect(counter).toBeVisible();
  const pages = Number((await counter.innerText()).split(' of ')[1]);
  expect(pages).toBeGreaterThan(1);
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  for (let i = 1; i < pages; i++) await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText(/"storageKeys"/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  await reject.scrollIntoViewIfNeeded();
  await expect(reject).toBeVisible();
});

test('requires the requested account and renewed warning acknowledgement before approval', async ({ page }) => {
  await page.goto(`${fixture}&switch=1&warning=1`);
  await expect(page.getByRole('checkbox', { name: 'I understand the address warning' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch account', exact: true }).click();
  const approve = page.getByRole('button', { name: 'Confirm transaction', exact: true });
  const acknowledgement = page.getByRole('checkbox', { name: 'I understand the address warning' });
  await expect(approve).toBeDisabled();
  await acknowledgement.click();
  await expect(approve).toBeEnabled();
  await page.evaluate(() => window.__nativeTransactionReviewFixture.revise());
  await expect(approve).toBeDisabled();
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.click();
  await approve.click();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls()))
    .toEqual([
      { method: 'activateRequestAccount', args: ['transaction-1', 7] },
      { method: 'approveRequest', args: ['transaction-1', 9, true] },
    ]);
});

test('blocks incomplete and mismatched requests while keeping rejection available', async ({ page }) => {
  await page.goto(`${fixture}&preparing=1`);
  await expect(page.getByText('Preparing transaction…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm transaction', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
  await page.goto(`${fixture}&invalid-origin=1`);
  await expect(page.getByText('Website mismatch', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm transaction', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls()))
    .toEqual([{ method: 'rejectRequest', args: ['transaction-1'] }]);
});

for (const state of ['broadcasting', 'uncertain']) {
  test(`offers Close after ${state} without another approval or rejection`, async ({ page }) => {
    await page.goto(`${fixture}&${state}=1`);
    await expect(page.getByRole('button', { name: 'Confirm transaction', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
    await expect(page.getByText('0x' + '6'.repeat(64), { exact: true })).toBeVisible();
    await expect(page.getByText(state === 'broadcasting' ? 'Sending transaction…' : 'The result could not be confirmed. Check Activity before trying again.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Request completed')).toBeVisible();
  });
}

test('shows the token authority and edits an allowance into a fresh transaction review', async ({ page }) => {
  await page.goto(`${fixture}&approval=erc20`);
  await expect(page.getByText('Token allowance', { exact: true })).toBeVisible();
  await expect(page.getByText('Spender', { exact: true })).toBeVisible();
  await expect(page.getByText('Unlimited', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit spending limit', exact: true }).click();
  await page.getByRole('textbox', { name: 'New spending limit', exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Apply limit', exact: true }).click();
  await expect(page.getByText('1.5 TOK', { exact: true })).toBeVisible();
  await expect(page.getByText('Unlimited', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'New spending limit', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('edited-allowance.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm transaction', exact: true }).click();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls()))
    .toEqual([
      { method: 'editApprovalAmount', args: ['transaction-1', 7, '1.5'] },
      { method: 'approveRequest', args: ['transaction-1', 8, false] },
    ]);
});

test('zero allowance remains a reviewed revocation request', async ({ page }) => {
  await page.goto(`${fixture}&approval=erc20`);
  await page.getByRole('button', { name: 'Edit spending limit', exact: true }).click();
  await page.getByRole('textbox', { name: 'New spending limit', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply limit', exact: true }).click();
  await expect(page.getByText('Set allowance to zero', { exact: true })).toBeVisible();
  await expect(page.getByText('0.0 TOK', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm transaction', exact: true })).toBeEnabled();
});

test('unknown approval and NFT token IDs never become verified editable ERC20 limits', async ({ page }) => {
  await page.goto(`${fixture}&approval=unknown`);
  await expect(page.getByText('Contract standard is unverified.', { exact: true })).toBeVisible();
  await expect(page.getByText('Approval value (raw)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit spending limit', exact: true })).toHaveCount(0);
  await expect(page.getByText('Unlimited', { exact: true })).toHaveCount(0);
  await page.goto(`${fixture}&approval=nft`);
  await expect(page.getByText('Token ID', { exact: true })).toBeVisible();
  await expect(page.getByText('Unlimited', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit spending limit', exact: true })).toHaveCount(0);
  await page.goto(`${fixture}&approval=operator`);
  await expect(page.getByText('Remove operator access', { exact: true })).toBeVisible();
});

test('unapplied or invalid allowance edits block confirmation until discarded', async ({ page }) => {
  await page.goto(`${fixture}&approval=erc20`);
  const confirm = page.getByRole('button', { name: 'Confirm transaction', exact: true });
  await page.getByRole('button', { name: 'Edit spending limit', exact: true }).click();
  await page.getByRole('textbox', { name: 'New spending limit', exact: true }).fill('1.5');
  await expect(confirm).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())).toEqual([]);
  await page.getByRole('textbox', { name: 'New spending limit', exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Apply limit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter an exact amount');
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => window.__nativeTransactionReviewFixture.revise());
  await expect(page.getByRole('textbox', { name: 'New spending limit', exact: true })).toHaveValue('invalid');
  await expect(page.getByRole('alert')).toContainText('Enter an exact amount');
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Keep current limit', exact: true }).click();
  await expect(confirm).toBeEnabled();
  await expect(page.getByText('Unlimited', { exact: true })).toBeVisible();
  await confirm.click();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())).toEqual([
    { method: 'approveRequest', args: ['transaction-1', 8, false] },
  ]);
});


test('unrelated controller revisions preserve an allowance draft and its confirmation block', async ({ page }) => {
  await page.goto(`${fixture}&approval=erc20`);
  const confirm = page.getByRole('button', { name: 'Confirm transaction', exact: true });
  await page.getByRole('button', { name: 'Edit spending limit', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'New spending limit', exact: true });
  await input.fill('1.5');
  await page.evaluate(() => window.__nativeTransactionReviewFixture.revise());
  await expect(input).toHaveValue('1.5');
  await expect(confirm).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())).toEqual([]);
  await page.getByRole('button', { name: 'Apply limit', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(page.getByText('1.5 TOK', { exact: true })).toBeVisible();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  expect(await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())).toEqual([
    { method: 'editApprovalAmount', args: ['transaction-1', 8, '1.5'] },
    { method: 'approveRequest', args: ['transaction-1', 9, false] },
  ]);
});

test("fee choices remain reachable by keyboard and touch at 320px and require a fresh Confirm", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(`${fixture}&fees=recommendation&font-scale=1.6`);
  await expect(
    page.getByRole("heading", { name: "Below estimate", exact: true })
  ).toBeVisible();
  const appFee = page.getByRole("button", {
    name: "Use dapp fee anyway",
    exact: true,
  });
  const networkFee = page.getByRole("button", {
    name: "Use network suggestion",
    exact: true,
  });
  for (const button of [appFee, networkFee]) {
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 0.999 });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.keyboard.press("Tab");
    if (await appFee.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(appFee).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(networkFee).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath("fee-choices-320.png"),
    fullPage: true,
  });
  await page.keyboard.press("Enter");
  await expect(appFee).toHaveCount(0);
  await expect(
    page.getByText("0.000000000000504 COIN", { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toEqual([
    { method: "chooseTransactionFee", args: ["transaction-1", 7, "network"] },
  ]);
  await page
    .getByRole("button", { name: "Confirm transaction", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toEqual([
    { method: "chooseTransactionFee", args: ["transaction-1", 7, "network"] },
    { method: "approveRequest", args: ["transaction-1", 9, false] },
  ]);
});

test("adjusted fees expose only the app choice and hold both choice and Confirm during preparation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto(`${fixture}&fees=adjusted&hold-fee=1`);
  await expect(
    page.getByRole("heading", { name: "Fee adjusted", exact: true })
  ).toBeVisible();
  const appFee = page.getByRole("button", {
    name: "Use dapp fee anyway",
    exact: true,
  });
  const confirm = page.getByRole("button", {
    name: "Confirm transaction",
    exact: true,
  });
  await expect(
    page.getByRole("button", { name: "Use network suggestion", exact: true })
  ).toHaveCount(0);
  await appFee.scrollIntoViewIfNeeded();
  await expect(appFee).toBeInViewport({ ratio: 0.999 });
  await appFee.tap();
  await expect(appFee).toBeDisabled();
  await expect(confirm).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toEqual([
    { method: "chooseTransactionFee", args: ["transaction-1", 7, "dapp"] },
  ]);
  await page.evaluate(() =>
    window.__nativeTransactionReviewFixture.releaseFeeChoice()
  );
  await expect(appFee).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toHaveLength(1);
});

for (const mode of ["switch", "broadcasting", "invalid-origin"]) {
  test(`fee choices are disabled for ${mode}`, async ({ page }) => {
    await page.goto(`${fixture}&fees=recommendation&${mode}=1`);
    await expect(
      page.getByRole("button", { name: "Use dapp fee anyway", exact: true })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Use network suggestion", exact: true })
    ).toBeDisabled();
    expect(
      await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
    ).toEqual([]);
  });
}

test("an expired held fee choice cannot revive confirmation", async ({
  page,
}) => {
  await page.goto(`${fixture}&fees=recommendation&hold-fee=1`);
  await page
    .getByRole("button", { name: "Use network suggestion", exact: true })
    .click();
  await page.evaluate(() => window.__nativeTransactionReviewFixture.expire());
  await page.evaluate(() =>
    window.__nativeTransactionReviewFixture.releaseFeeChoice()
  );
  await expect(
    page.getByRole("button", { name: "Use dapp fee anyway", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Confirm transaction", exact: true })
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toEqual([
    { method: "chooseTransactionFee", args: ["transaction-1", 7, "network"] },
  ]);
});

test("the review deadline disables fee choices and Confirm before another command", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-08T12:00:00Z") });
  await page.goto(`${fixture}&fees=recommendation`);
  const appFee = page.getByRole("button", {
    name: "Use dapp fee anyway",
    exact: true,
  });
  const confirm = page.getByRole("button", {
    name: "Confirm transaction",
    exact: true,
  });
  await expect(appFee).toBeEnabled();
  await expect(confirm).toBeEnabled();
  await page.clock.fastForward(300001);
  await expect(appFee).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Use network suggestion", exact: true })
  ).toBeDisabled();
  await expect(confirm).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toEqual([]);
});

test("a requote that raises the requested choice keeps the adjustment visible without another automatic command", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(`${fixture}&fees=recommendation&raise-after-choice=1`);
  await page
    .getByRole("button", { name: "Use network suggestion", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fee adjusted", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("0.0000000000006 COIN", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use dapp fee anyway", exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Use network suggestion", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm transaction", exact: true })
  ).toBeEnabled();
  expect(
    await page.evaluate(() => window.__nativeTransactionReviewFixture.calls())
  ).toEqual([
    { method: "chooseTransactionFee", args: ["transaction-1", 7, "network"] },
  ]);
});