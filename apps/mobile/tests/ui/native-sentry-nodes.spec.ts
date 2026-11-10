import { pinField, fillPinField } from './operationAuthentication';
import { expect, test } from '@playwright/test';
test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});

test('linked-node review and release remain reachable on a narrow, short screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/?sentry-nodes=1');
  await page.getByRole('button', { name: 'Link a node', exact: true }).click();
  await page
    .getByLabel('Registration transaction ID', { exact: true })
    .fill('11'.repeat(32));
  await page.getByRole('button', { name: 'Review node', exact: true }).click();
  await expect(
    page.getByText('https://sentry.example', { exact: true })
  ).toBeVisible();
  const link = page.getByRole('button', { name: 'Link node', exact: true });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: test.info().outputPath('sentry-node-link-320.png'),
    fullPage: true,
  });
  await link.click();
  await expect(
    page.getByText('Collateral protected', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Release collateral', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Release collateral', exact: true })
  ).toBeInViewport({ ratio: 1 });
  const password = pinField(page, 'Wallet PIN');
  await expect(password).toHaveText('Enter PIN');
  const release = page.getByRole('button', {
    name: 'Release collateral',
    exact: true,
  });
  await expect(release).toBeDisabled();
  await page.getByLabel('Allow collateral spending', { exact: true }).check();
  await fillPinField(password, '123456');
  await release.scrollIntoViewIfNeeded();
  await expect(release).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: test.info().outputPath('sentry-node-release-320.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await release.click();
  await expect(
    page.getByText('Collateral protection released.', { exact: true })
  ).toBeVisible();
  await expect(password).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__nativeSentryNodesFixture.calls())
  ).toEqual(['lookup', 'link', 'release']);
});

test('failed node lookup offers a fresh attempt without exposing the transport error', async ({
  page,
}) => {
  await page.goto('/?sentry-nodes=1&error=1');
  await page.getByRole('button', { name: 'Link a node', exact: true }).click();
  await page
    .getByLabel('Registration transaction ID', { exact: true })
    .fill('11'.repeat(32));
  await page.getByRole('button', { name: 'Review node', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('start a new review');
  await expect(page.getByText('Fixture lookup failed')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Link a node', exact: true })
  ).toBeEnabled();
});
