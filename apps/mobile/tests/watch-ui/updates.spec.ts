import { test, expect } from '@playwright/test';

for (const width of [320, 390]) test(`update notes and action remain usable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 740 });
  await page.goto('/?update-fixture=1');
  await expect(page.getByText('Improved transaction recovery')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock Pali to update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart and install' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Turn off update alerts' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Turn off update alerts' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText('Improved transaction recovery').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`update-notice-${width}.png`) });
});

test('retained update notes show failed freshness check', async ({ page }) => {
  await page.goto('/?update-fixture=1&update-state=error');
  await page.getByText('The latest check failed. Showing the last known release.').scrollIntoViewIfNeeded();
  await expect(page.getByText('The latest check failed. Showing the last known release.')).toBeVisible();
});

for (const width of [320, 390]) test(`About keeps updates behind a compact entry at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 740 });
  await page.goto('/?update-fixture=1&about-updates-fixture=1');
  await expect(page.getByText('Help & about', { exact: true })).toBeVisible();
  await expect(page.getByText('Improved transaction recovery')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'App updates Check for updates' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`about-updates-${width}.png`) });
  await page.getByRole('button', { name: 'App updates Check for updates' }).click();
  await expect(page.getByText('Improved transaction recovery')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Help & about', { exact: true })).toBeVisible();
});
