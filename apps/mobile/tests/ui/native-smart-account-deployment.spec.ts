import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

const cases = [
  {
    phase: 'authorize',
    heading: 'Authorize deployment',
    action: 'Authorize deployment',
  },
  {
    phase: 'fund-account',
    heading: 'Fund smart account',
    action: 'Confirm funding',
  },
  {
    phase: 'submit-deployment',
    heading: 'Deploy smart account',
    action: 'Confirm deployment',
  },
  {
    phase: 'waiting',
    heading: 'Deploy smart account',
    message: 'Waiting for the network…',
  },
  {
    phase: 'complete',
    heading: 'Deploy smart account',
    message: 'Smart account deployed',
  },
  {
    phase: 'failed',
    heading: 'Deploy smart account',
    message: 'Check deployment status',
  },
] as const;

async function expectContained(page: Page) {
  const overflow = await page.locator('body').evaluate((body) => {
    const width = window.innerWidth;
    return Array.from(body.querySelectorAll<HTMLElement>('*'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > width + 1);
      })
      .map((element) => element.textContent?.slice(0, 80));
  });
  expect(overflow).toEqual([]);
}

for (const width of [390, 320]) {
  for (const scenario of cases) {
    test(`${scenario.phase} stays contained and usable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await page.goto(
        `/?smart-deployment=1&deployment-phase=${scenario.phase}`
      );
      await expect(
        page.getByRole('heading', { name: scenario.heading, exact: true })
      ).toBeVisible();
      await expect(
        page.getByText('0x1111111111111111111111111111111111111111', {
          exact: true,
        })
      ).toBeVisible();
      if ('action' in scenario) {
        const action = page.getByRole('button', {
          name: scenario.action,
          exact: true,
        });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeVisible();
        await expect(action).toBeEnabled();
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      } else {
        await expect(
          page.getByText(scenario.message, { exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('button', {
            name: /^(Authorize deployment|Confirm funding|Confirm deployment)$/,
          })
        ).toHaveCount(0);
      }
      const close = page.getByRole('button', { name: 'Close', exact: true });
      await close.scrollIntoViewIfNeeded();
      await expect(close).toBeVisible();
      expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectContained(page);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`deployment-${scenario.phase}-${width}-actions.png`),
      });
      await page.getByRole('heading').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test
          .info()
          .outputPath(`deployment-${scenario.phase}-${width}.png`),
      });
      await close.click();
      await expect(
        page.getByText('Deployment screen closed', { exact: true })
      ).toBeVisible();
    });
  }
}

test('each meaningful authorization invokes the exact current action once', async ({
  page,
}) => {
  await page.goto('/?smart-deployment=1');
  const revision = await page.evaluate(() =>
    window.__nativeSmartAccountDeploymentFixture.revision()
  );
  await page
    .getByRole('button', { name: 'Authorize deployment', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Fund smart account', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Confirm funding', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Confirm deployment', exact: true })
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Confirm deployment', exact: true })
    .click();
  await expect(
    page.getByText('Waiting for the network…', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__nativeSmartAccountDeploymentFixture.calls()
    )
  ).toEqual([
    { method: 'prepare' },
    { method: 'authorize', value: revision },
    { method: 'confirmPayer', value: 8 },
    { method: 'confirmPayer', value: 9 },
  ]);
});

test('long authorization details remain complete and actions stay reachable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?smart-deployment=1&long-values=1&font-scale=1.6');
  const details = page.getByRole('button', {
    name: 'View authorization details',
    exact: true,
  });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(
    page.getByRole('button', {
      name: 'Hide authorization details',
      exact: true,
    })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByText('0x' + '12'.repeat(1024), { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByText('0x' + '34'.repeat(512), { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByText(((1n << 256n) - 1n).toString(), { exact: true })
  ).toHaveCount(1);
  await expectContained(page);
  const authorize = page.getByRole('button', {
    name: 'Authorize deployment',
    exact: true,
  });
  await authorize.scrollIntoViewIfNeeded();
  await expect(authorize).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('deployment-details-bottom-320.png'),
  });
  await page
    .getByRole('button', { name: 'Hide authorization details', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('deployment-details-top-320.png'),
  });
  await page
    .getByRole('button', { name: 'Hide authorization details', exact: true })
    .click();
  await expect(
    page.getByText('Account creation data', { exact: true })
  ).toHaveCount(0);
  await authorize.click();
  await expect(
    page.getByRole('button', { name: 'Confirm funding', exact: true })
  ).toBeEnabled();
  await expectContained(page);
  await page.getByRole('heading').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('deployment-long-funding-320.png'),
  });
  await page
    .getByRole('button', { name: 'Confirm funding', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('deployment-long-funding-320-actions.png'),
  });
});

test('Back leaves the deployment screen', async ({ page }) => {
  await page.goto('/?smart-deployment=1');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByText('Deployment screen closed', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__nativeSmartAccountDeploymentFixture.calls()
    )
  ).toEqual([
    { method: 'prepare' },
    { method: 'close' },
    { method: 'dispose' },
  ]);
});
