import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
const recorded = (page: Page) =>
  page.evaluate(() => window.__nativeEoaBatchFixture.calls());
async function reachable(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport({ ratio: 0.999 });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}
async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320
  );
}

test('two-call review requires each fee confirmation and keeps the acknowledged prefix visible', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?eoa-batch');
  await expect(
    page.getByText('https://batch.example.invalid', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Call 1 of 2', exact: true })
  ).toBeVisible();
  await expect(page.getByText('0.000042 COIN', { exact: true })).toBeVisible();
  const first = page.getByRole('button', {
    name: 'Confirm call 1/2',
    exact: true,
  });
  await reachable(first);
  await contained(page);
  expect(await recorded(page)).toEqual([]);
  await page.screenshot({
    path: info.outputPath('eoa-first-fee-320.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'View all 2 calls', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Hide calls', exact: true })
  ).toHaveAttribute('aria-expanded', 'true');
  await first.click();
  await expect(
    page.getByRole('heading', { name: 'Call 2 of 2', exact: true })
  ).toBeVisible();
  const allCalls = page.getByRole('button', {
    name: 'View all 2 calls',
    exact: true,
  });
  await expect(allCalls).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('1. success', { exact: true })).toHaveCount(0);
  await allCalls.click();
  await expect(page.getByText('1. success', { exact: true })).toBeVisible();
  await expect(
    page.getByText('0x' + 'ab'.repeat(32), { exact: true })
  ).toBeVisible();
  await expect(page.getByText('0.000063 COIN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide calls', exact: true }).click();
  const second = page.getByRole('button', {
    name: 'Confirm call 2/2',
    exact: true,
  });
  await reachable(second);
  await contained(page);
  expect(await recorded(page)).toEqual([
    { method: 'approveRequest', args: ['eoa-batch-1', 7, false] },
  ]);
  await page.screenshot({
    path: info.outputPath('eoa-second-fee-320.png'),
    fullPage: true,
  });
  await second.click();
  await expect(page.getByRole('button', { name: /^Confirm call/ })).toHaveCount(
    0
  );
  await reachable(page.getByRole('button', { name: 'Close', exact: true }));
  expect(await recorded(page)).toEqual([
    { method: 'approveRequest', args: ['eoa-batch-1', 7, false] },
    { method: 'approveRequest', args: ['eoa-batch-1', 8, false] },
  ]);
});

test('a definitely unsent suffix is re-reviewed after Retry', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/?eoa-batch&failed');
  await expect(page.getByText('Call not sent', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', {
    name: 'Retry call 2/2',
    exact: true,
  });
  await reachable(retry);
  await contained(page);
  await page.screenshot({
    path: info.outputPath('eoa-retry-320.png'),
    fullPage: true,
  });
  await retry.click();
  await expect(
    page.getByRole('button', { name: 'Confirm call 2/2', exact: true })
  ).toBeVisible();
  expect(await recorded(page)).toEqual([
    { method: 'approveRequest', args: ['eoa-batch-1', 7, false] },
  ]);
  await page
    .getByRole('button', { name: 'View all 2 calls', exact: true })
    .click();
  await expect(page.getByText('1. success', { exact: true })).toBeVisible();
  await reachable(page.getByRole('button', { name: 'Close', exact: true }));
});

test('uncertain delivery exposes Close without another signing action', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/?eoa-batch&unknown');
  await expect(
    page.getByText('Check call status', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Check call status', { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByText('Check transaction status', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Confirm call|^Retry call/ })
  ).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await reachable(close);
  await contained(page);
  await page.screenshot({
    path: info.outputPath('eoa-unknown-320.png'),
    fullPage: true,
  });
  await close.click();
  await expect(page.getByText('Request closed', { exact: true })).toBeVisible();
  expect(await recorded(page)).toEqual([
    { method: 'rejectRequest', args: ['eoa-batch-1'] },
  ]);
});

test('five ordered calls retain accessible fee and consent at a narrow height', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?eoa-batch&many');
  const progress = page.getByRole('heading', {
    name: 'Call 1 of 5',
    exact: true,
  });
  const fee = page.getByText('Maximum network fee', { exact: true });
  const confirm = page.getByRole('button', {
    name: 'Confirm call 1/5',
    exact: true,
  });
  await expect(progress).toBeVisible();
  const allCalls = page.getByRole('button', {
    name: 'View all 5 calls',
    exact: true,
  });
  await expect(allCalls).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('5. pending', { exact: true })).toHaveCount(0);
  const placement = {
    progress: await progress.boundingBox(),
    fee: await fee.boundingBox(),
    confirm: await confirm.boundingBox(),
    viewport: page.viewportSize(),
  };
  await writeFile(
    info.outputPath('five-call-placement.json'),
    JSON.stringify(placement, null, 2)
  );
  await info.attach('five-call-placement', {
    body: JSON.stringify(placement, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: info.outputPath('eoa-five-calls-320.png'),
    fullPage: true,
  });
  await reachable(confirm);
  await contained(page);
  await page.screenshot({
    path: info.outputPath('eoa-five-calls-fee-320.png'),
    fullPage: true,
  });
  await allCalls.click();
  await expect(page.getByText('5. pending', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Hide calls', exact: true })
  ).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({
    path: info.outputPath('eoa-five-calls-expanded-320.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Hide calls', exact: true }).click();
  await expect(page.getByText('5. pending', { exact: true })).toHaveCount(0);
  expect(await recorded(page)).toEqual([]);
});
