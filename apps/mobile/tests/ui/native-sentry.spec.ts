import { expect, test, type Locator, type Page } from '@playwright/test';
test.use({
  baseURL: process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179',
});
const secret = '13'.repeat(32);
async function reachable(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport({ ratio: 0.999 });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}
async function contained(page: Page) {
  expect(
    await page.locator('body').evaluate((body) =>
      Array.from(body.querySelectorAll<HTMLElement>('*'))
        .filter((element) => {
          const r = element.getBoundingClientRect();
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        })
        .map((element) => element.textContent?.slice(0, 80))
    )
  ).toEqual([]);
}
async function batch(page: Page, input: string) {
  await page
    .getByRole('button', { name: 'Import multiple keys', exact: true })
    .click();
  await page.evaluate(
    (value) => window.__nativeSentryFixture.setClipboard(value),
    input
  );
  await page
    .getByRole('button', { name: 'Paste and review keys', exact: true })
    .click();
}

test('single import stays masked and public review fits a short screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?sentry=1');
  await page.getByRole('button', { name: 'Import key', exact: true }).click();
  await page.getByLabel('Key label', { exact: true }).fill('Node one');
  const input = page.getByLabel('Private key', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill('0x' + '13'.repeat(64) + 'trailing');
  await expect(input).toHaveValue('');
  await input.fill(secret);
  await page.getByRole('button', { name: 'Review key', exact: true }).click();
  await expect(page.getByLabel('Private key', { exact: true })).toHaveCount(0);
  await expect(page.getByText('39'.repeat(48), { exact: true })).toBeVisible();
  const password = page.getByLabel('Wallet password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill('Fixture password 1!');
  const save = page.getByRole('button', { name: 'Save key', exact: true });
  await reachable(save);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('sentry-single-review-320.png'),
  });
  await save.click();
  expect(
    await page.evaluate(() => window.__nativeSentryFixture.calls())
  ).toEqual([
    { method: 'prepareImport', count: 1 },
    { method: 'confirmImport', count: 1 },
  ]);
});

test('batch paste renders only ordered public keys and uses one confirmation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?sentry=1');
  await batch(page, `Node one | ${secret}\nNode two | ${'24'.repeat(32)}`);
  await expect(page.getByLabel('Private key', { exact: true })).toHaveCount(0);
  const first = page.getByText('Node one', { exact: true });
  const second = page.getByText('Node two', { exact: true });
  expect((await first.boundingBox())!.y).toBeLessThan(
    (await second.boundingBox())!.y
  );
  expect(await page.locator('body').textContent()).not.toContain(secret);
  expect(await page.locator('body').textContent()).not.toContain(
    '24'.repeat(32)
  );
  await page
    .getByLabel('Wallet password', { exact: true })
    .fill('Fixture password 1!');
  const save = page.getByRole('button', { name: 'Save keys', exact: true });
  await reachable(save);
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('sentry-batch-review-320.png'),
  });
  await save.click();
  expect(
    await page.evaluate(() => window.__nativeSentryFixture.calls())
  ).toEqual([
    { method: 'prepareImport', count: 2 },
    { method: 'confirmImport', count: 2 },
  ]);
});

test('duplicates and oversized clipboard text cannot become a partial batch review', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?sentry=1');
  await batch(page, `Node one | ${secret}\nNode two | ${secret}`);
  await expect(
    page.getByText('Check the private key and selected key type.', {
      exact: true,
    })
  ).toBeVisible();
  await page.evaluate(
    (value) => window.__nativeSentryFixture.setClipboard(value),
    `Node one | ${secret}` + '\n'.repeat(6001)
  );
  await page
    .getByRole('button', { name: 'Paste and review keys', exact: true })
    .click();
  await expect(page.getByLabel('Wallet password', { exact: true })).toHaveCount(
    0
  );
  expect(
    await page.evaluate(() => window.__nativeSentryFixture.calls())
  ).toEqual([]);
  await reachable(
    page.getByRole('button', { name: 'Paste and review keys', exact: true })
  );
  await contained(page);
});

test('batch expiry clears the password and removes confirmation', async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto('/?sentry=1');
  await batch(page, `Node one | ${secret}\nNode two | ${'24'.repeat(32)}`);
  await page
    .getByLabel('Wallet password', { exact: true })
    .fill('Fixture password 1!');
  await page.clock.runFor(90001);
  await expect(
    page.getByText('Review expired. Start again to continue.', { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Wallet password', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: 'Save keys', exact: true })
  ).toHaveCount(0);
  await reachable(
    page.getByRole('button', { name: 'Import multiple keys', exact: true })
  );
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('sentry-expired-320.png'),
  });
});
