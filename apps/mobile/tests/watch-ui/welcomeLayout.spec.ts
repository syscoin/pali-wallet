import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 320, height: 568 },
  { width: 320, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`welcome actions stay visible at ${viewport.width} by ${viewport.height}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const origin = new URL(baseURL!).origin;
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      await route.abort();
      throw new Error('Unexpected external request');
    });
    await page.goto('/?wallet-removal-fixture=1&empty=1&android=1');
    await expect(
      page.getByRole('button', { name: 'Explore the design', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Review full wallet design',
        exact: true,
      })
    ).toHaveCount(0);

    const setup = page.getByRole('button', {
      name: 'Set up your wallet',
      exact: true,
    });
    const watch = page.getByRole('button', {
      name: 'Watch an account',
      exact: true,
    });
    for (const action of [setup, watch]) {
      await expect(action).toBeVisible();
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }

    const initialPosition = await setup.boundingBox();
    await page.screenshot({ path: testInfo.outputPath('welcome-initial.png') });
    await page.mouse.move(viewport.width / 2, 180);
    await page.mouse.wheel(0, 700);
    await expect
      .poll(async () => (await setup.boundingBox())?.y)
      .toBe(initialPosition!.y);
    await page.screenshot({
      path: testInfo.outputPath('welcome-scrolled.png'),
    });
    await watch.click();
    await expect(
      page.getByRole('heading', { name: 'Watch an account', exact: true })
    ).toBeVisible();
  });
}
