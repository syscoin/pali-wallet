import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4181') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
    throw Error('Unexpected external request');
  });
});
async function activity(page: Page) {
  await page.goto('/?shell=1');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /1 ETH, Confirmed/ }).first()
  ).toBeVisible();
}
async function clickTabs(page: Page, names: string[]) {
  await page.evaluate((values) => {
    for (const name of values)
      document
        .querySelector<HTMLElement>(`[role="tab"][aria-label="${name}"]`)!
        .click();
  }, names);
}
test('Activity root uses tab navigation and saves position once when returning to Wallet', async ({
  page,
}) => {
  await activity(page);
  await page.evaluate(() => window.__activityFixture.delaySave(150));
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Wallet', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Wallet', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  expect(
    await page.evaluate(() => window.__activityFixture.saveRequests())
  ).toBe(1);
  expect(
    await page.evaluate(() => window.__activityFixture.savedView().anchor)
  ).not.toBeNull();
});
test('latest Activity tab choice wins during a held position save', async ({
  page,
}) => {
  await activity(page);
  await page.evaluate(() => window.__activityFixture.delaySave(300));
  await clickTabs(page, ['Tools', 'Settings']);
  await expect(
    page.getByRole('tab', { name: 'Settings', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  expect(
    await page.evaluate(() => window.__activityFixture.saveRequests())
  ).toBe(1);
});
test('reselecting Activity cancels its pending departure', async ({ page }) => {
  await activity(page);
  await page.evaluate(() => window.__activityFixture.delaySave(300));
  await clickTabs(page, ['Tools', 'Activity']);
  await expect
    .poll(() =>
      page.evaluate(() => window.__activityFixture.savedView().anchor)
    )
    .not.toBeNull();
  await expect(
    page.getByRole('tab', { name: 'Activity', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('heading', { name: 'Tools', exact: true })
  ).toHaveCount(0);
});
test('lock revokes delayed Activity departure and its old view write', async ({
  page,
}) => {
  await activity(page);
  await page.evaluate(() => window.__activityFixture.delaySave(300));
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__activityFixture.saveRequests()))
    .toBe(1);
  await page.evaluate(() => window.__activityFixture.lock());
  await expect(page.getByText('Fixture locked', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__activityFixture.saveSettled()))
    .toBe(1);
  expect(
    await page.evaluate(() => window.__activityFixture.savedView().anchor)
  ).toBeNull();
  await expect(
    page.getByRole('heading', { name: 'Tools', exact: true })
  ).toHaveCount(0);
});
test('a stalled Activity position write cannot trap tab navigation', async ({
  page,
}) => {
  await activity(page);
  await page.evaluate(() => window.__activityFixture.delaySave(2000));
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Tools', exact: true })
  ).toHaveAttribute('aria-selected', 'true', { timeout: 1700 });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__activityFixture.saveSettled()))
    .toBe(1);
  await expect(
    page.getByRole('tab', { name: 'Settings', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
});
