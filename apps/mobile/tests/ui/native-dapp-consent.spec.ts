import { enterPin } from './operationAuthentication';
import { expect, test } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:4179' });

for (const viewport of [{ width: 320, height: 480 }, { width: 390, height: 844 }]) {
  test(`Sentry changes and explicit signing consent fit ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4179' ? route.continue() : route.abort());
    await page.goto('/?sentry-consent');
    await expect(page.getByText('https://app.example.test', { exact: true })).toBeVisible();
    await expect(page.getByText('Unverified website', { exact: true })).toBeInViewport();
    await expect(page.getByText('Check the website address before continuing.', { exact: true })).toBeInViewport();
    await expect(page.getByText('new.example.test:8369', { exact: true })).toBeVisible();
    await expect(page.getByText('new.example.test:8369', { exact: true })).toBeInViewport();
    await expect(page.getByText('sys1qwamhwamhwamhwamhwamhwamhwamhwamhjx836v', { exact: true })).toBeVisible();
    await expect(page.getByText('0014' + '77'.repeat(20), { exact: true })).toHaveCount(0);
    const confirm = page.getByRole('button', { name: 'Update node service', exact: true });
    await confirm.scrollIntoViewIfNeeded(); await expect(confirm).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('sentry-consent.png') });
    await page.getByRole('button', { name: 'View request details', exact: true }).click();
    await expect(page.getByText('0014' + '77'.repeat(20), { exact: true })).toBeVisible();
    await confirm.click();
    await enterPin(page, '123456');
    await expect(page.getByText('Fixture approved', { exact: true })).toBeVisible();
  });
}
test('adding a dapp network shows its reported origin, chain and RPC before consent', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 }); await page.goto('/?control-consent');
  await expect(page.getByText('https://rpc.example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Chain ID 12345 · COIN', { exact: true })).toBeVisible();
  const approve = page.getByRole('button', { name: 'Add network', exact: true }); await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeInViewport(); await approve.click(); await expect(page.getByText('Fixture approved')).toBeVisible();
});
