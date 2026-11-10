import { test, expect, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
const calls = (page: Page) =>
  page.evaluate(() => window.__nativeTrezorFixture.calls());
const open = (page: Page) =>
  page.getByRole('button', { name: 'Open Trezor Suite', exact: true });
const back = (page: Page) =>
  page.getByRole('button', { name: 'Back', exact: true });

test('Suite opens only on explicit action and parent renders do not duplicate it', async ({
  page,
}) => {
  await page.goto('/?trezor=1&hold=1');
  await expect(open(page)).toBeEnabled();
  expect(await calls(page)).toEqual([]);
  await page.evaluate(() => window.__nativeTrezorFixture.refreshParent());
  expect(await calls(page)).toEqual([]);
  await page.getByLabel('Trezor account name').fill('Travel Trezor');
  await open(page).click();
  await expect(
    page.getByText('Waiting for Trezor…', { exact: true })
  ).toBeVisible();
  await expect(open(page)).toBeDisabled();
  await page.evaluate(() => window.__nativeTrezorFixture.refreshParent());
  expect(await calls(page)).toEqual(['open:Travel Trezor']);
});

test('resuming a send only returns to a fresh review', async ({ page }) => {
  await page.goto('/?trezor=1&resume=send');
  await expect(
    page.getByText('Review the request again before continuing.', {
      exact: true,
    })
  ).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('Fresh transaction review', { exact: true })
  ).toBeVisible();
  expect(await calls(page)).toEqual(['resume:send', 'navigate:review']);
});

test('Back cancels and drains an active wait before navigation', async ({
  page,
}) => {
  await page.goto('/?trezor=1&hold=1&hold-cancel=1');
  await open(page).click();
  await back(page).click();
  await expect(
    page.getByText('Trezor screen closed', { exact: true })
  ).toHaveCount(0);
  expect(await calls(page)).toEqual(['open:Trezor', 'cancel']);
  await page.evaluate(() => window.__nativeTrezorFixture.resolveOperation());
  await expect(
    page.getByText('Trezor account added', { exact: true })
  ).toHaveCount(0);
  await page.evaluate(() => window.__nativeTrezorFixture.resolveCancel());
  await expect(
    page.getByText('Trezor screen closed', { exact: true })
  ).toBeVisible();
  expect(await calls(page)).toEqual(['open:Trezor', 'cancel', 'navigate:back']);
});

test('cleanup rejection keeps the screen open and does not publish a late import completion', async ({
  page,
}) => {
  await page.goto('/?trezor=1&hold=1&hold-cancel=1');
  await open(page).click();
  await back(page).click();
  await page.evaluate(() => window.__nativeTrezorFixture.rejectCancel());
  await expect(page.getByRole('alert')).toHaveText(
    'The Trezor request is still closing. Try again.'
  );
  await expect(
    page.getByText('Trezor screen closed', { exact: true })
  ).toHaveCount(0);
  await expect(open(page)).toBeDisabled();
  await page.evaluate(() => window.__nativeTrezorFixture.resolveOperation());
  await expect(
    page.getByText('Trezor account added', { exact: true })
  ).toHaveCount(0);
  expect(await calls(page)).toEqual(['open:Trezor', 'cancel']);
  await back(page).click();
  await page.evaluate(() => window.__nativeTrezorFixture.resolveCancel());
  await expect(
    page.getByText('Trezor screen closed', { exact: true })
  ).toBeVisible();
  expect(await calls(page)).toEqual([
    'open:Trezor',
    'cancel',
    'cancel',
    'navigate:back',
  ]);
});

test('locking unmounts the view without cancelling the public job', async ({
  page,
}) => {
  await page.goto('/?trezor=1&hold=1');
  await open(page).click();
  await page.evaluate(() => window.__nativeTrezorFixture.lock());
  await expect(page.getByText('Wallet locked', { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual(['open:Trezor']);
  expect(
    await page.evaluate(() => window.__nativeTrezorFixture.snapshot().operation)
  ).toBe('import');
  await page.evaluate(() => window.__nativeTrezorFixture.resolveOperation());
  expect(await calls(page)).toEqual(['open:Trezor']);
  await page.evaluate(() => window.__nativeTrezorFixture.returnFromSuite());
  await page.evaluate(() => window.__nativeTrezorFixture.mount());
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true })
  ).toBeVisible();
  expect(await calls(page)).toEqual(['open:Trezor']);
});

for (const mode of ['idle', 'resume'] as const)
  test(`${mode} fits a narrow display and preserves the primary action when the viewport shrinks`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(mode === 'idle' ? '/?trezor=1' : '/?trezor=1&resume=send');
    const action =
      mode === 'idle'
        ? open(page)
        : page.getByRole('button', { name: 'Continue', exact: true });
    await expect(action).toBeVisible();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(320);
    await page.screenshot({
      path: info.outputPath(`trezor-${mode}-320.png`),
      fullPage: true,
    });
    if (mode === 'idle') {
      const inset = await page
        .getByText('Account name', { exact: true })
        .evaluate(
          (element) =>
            element.getBoundingClientRect().left -
            element.parentElement!.getBoundingClientRect().left
        );
      expect(inset).toBeGreaterThanOrEqual(16);
      await page.getByLabel('Trezor account name').focus();
      await page.setViewportSize({ width: 320, height: 400 });
      await expect(page.getByLabel('Trezor account name')).toBeFocused();
      await expect(action).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: info.outputPath('trezor-keyboard-sized-320.png'),
        fullPage: true,
      });
    }
  });
