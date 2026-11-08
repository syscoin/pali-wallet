import { expect, test } from '@playwright/test';

test('reviews a connection at narrow width and passes the selected account and revision', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://127.0.0.1:4179/?connections=1&font-scale=1.6');
  await page.evaluate(() => window.__nativeConnectionsFixture.proposal());
  await expect(page.getByText('Reported website')).toBeVisible();
  await expect(page.getByText('https://example.invalid', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /^Savings,/ }).click();
  const approve = page.getByRole('button', { name: 'Connect', exact: true });
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  await reject.scrollIntoViewIfNeeded();
  await expect(reject).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('connection-actions-320.png'), fullPage: true });
  await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('connection-review-320.png'), fullPage: true });
  await approve.click();
  await expect.poll(() => page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'approve')))
    .toEqual([{ method: 'approve', args: [42, 'hd:60:1', 'ethereum', 8] }]);
  await expect(page.getByText('Your connections')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect Example app' }).click();
  await expect(page.getByText('Your connections')).toHaveCount(0);
});

test('shows an unsupported proposal with rejection available', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => window.__nativeConnectionsFixture.proposal(false));
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
  await expect(page.getByText('Unsupported request', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Connect to Example app')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'reject')))
    .toEqual([{ method: 'reject', args: [42] }]);
});

test('does not submit a delayed clipboard result after leaving the screen', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: () => new Promise<string>((resolve) => { window.__completeConnectionClipboard = resolve; }),
    } });
  });
  await page.getByRole('button', { name: 'Paste connection link' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Connections closed')).toBeVisible();
  await page.evaluate(() => window.__completeConnectionClipboard('wc:disposable-test-link'));
  await expect.poll(() => page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'pair'))).toEqual([]);
});

test('shows pairing progress, cancellation and a recoverable context error', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: async () => 'wc:disposable-test-link',
    } });
  });
  await page.getByRole('button', { name: 'Paste connection link' }).click();
  await expect(page.getByText('Waiting for the app', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paste connection link' })).toBeVisible();
  await page.evaluate(() => window.__nativeConnectionsFixture.fail());
  await expect(page.getByText('Your wallet context changed. Review the connection again.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('connection-error.png'), fullPage: true });
});

test('offers restoration retry without asking for another connection link', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => window.__nativeConnectionsFixture.unavailable());
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paste connection link' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'retry')))
    .toEqual([{ method: 'retry', args: [] }]);
});

declare global {
  interface Window { __completeConnectionClipboard(value: string): void }
}
