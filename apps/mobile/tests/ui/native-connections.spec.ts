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

test('opening the scanner supersedes a pending clipboard read', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: () => new Promise<string>((resolve) => { window.__completeConnectionClipboard = resolve; }),
    } });
  });
  await page.getByRole('button', { name: 'Paste connection link' }).click();
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await page.evaluate(() => window.__completeConnectionClipboard('wc:stale-clipboard-link'));
  await expect(page.getByText('Use Pali on your phone', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'pair'))).toEqual([]);
});

test('an incoming link supersedes a pending clipboard read', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: () => new Promise<string>((resolve) => { window.__completeConnectionClipboard = resolve; }),
    } });
  });
  await page.getByRole('button', { name: 'Paste connection link' }).click();
  await page.evaluate(() => window.__nativeConnectionsFixture.incoming({ id: 'new-os-link', uri: 'wc:new-os-link', expiresAt: Date.now() + 60000 }));
  await expect(page.getByText('Waiting for the app', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.__completeConnectionClipboard('wc:stale-clipboard-link'));
  expect(await page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'pair')))
    .toEqual([{ method: 'pair', args: ['wc:new-os-link'] }]);
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

test('a queued OS link pairs once after unlock without an extra connection-start action', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => {
    window.__nativeConnectionsFixture.locked(true);
    window.__nativeConnectionsFixture.incoming({ id: 'os-link-1', uri: 'wc:disposable-os-link', expiresAt: Date.now() + 60000 });
  });
  await expect(page.getByText('Unlock to connect')).toBeVisible();
  expect(await page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'pair'))).toEqual([]);
  await page.evaluate(() => window.__nativeConnectionsFixture.locked(false));
  await expect.poll(() => page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'pair')))
    .toEqual([{ method: 'pair', args: ['wc:disposable-os-link'] }]);
  expect(await page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'handled')))
    .toEqual([{ method: 'handled', args: ['os-link-1'] }]);
});

test('an expired incoming link is consumed without starting a pairing', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.evaluate(() => window.__nativeConnectionsFixture.incoming({ id: 'expired-1', uri: 'wc:expired-test-link', expiresAt: Date.now() - 1 }));
  await expect(page.getByText('Connection link expired', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeConnectionsFixture.calls().filter((call) => call.method === 'pair'))).toEqual([]);
});

test('closing the scanner returns to the same connection screen without cancelling other requests', async ({ page }) => {
  await page.goto('http://127.0.0.1:4179/?connections=1');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await expect(page.getByText('Use Pali on your phone', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use pasted link', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paste connection link' })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeConnectionsFixture.calls())).toEqual([]);
});

declare global {
  interface Window { __completeConnectionClipboard(value: string): void }
}
