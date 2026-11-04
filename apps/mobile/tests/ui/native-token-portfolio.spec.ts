import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });
const token = '0x1111111111111111111111111111111111111111';
const zero = '0x2222222222222222222222222222222222222222';
const long = '0x3333333333333333333333333333333333333333';
async function preview(page: Page, address: string) {
  await page.getByTestId('native-token-import').click();
  await page
    .getByRole('textbox', { name: 'Token contract address', exact: true })
    .fill(address);
  await page.getByTestId('native-token-review').click();
  await expect(page.getByTestId('native-token-contract')).toHaveText(address);
}
async function add(page: Page, address: string) {
  await preview(page, address);
  await page.getByTestId('native-token-add').click();
  await expect(
    page.getByRole('heading', { name: 'Token details', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('native-token-contract')).toHaveText(address);
}

test('real native token controller imports, persists, shows exact units, receives and removes one list entry', async ({
  page,
}, testInfo) => {
  await page.goto('/?token-portfolio');
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  await preview(page, token);
  await expect(page.getByTestId('native-token-preview-balance')).toHaveText(
    '90071992547409.93 FIXTURE'
  );
  await expect(
    page.getByRole('heading', { name: 'Import token', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('native-portfolio-balance')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText('Custom token · Unverified issuer metadata', { exact: true })
  ).toBeVisible();
  await page.getByTestId('native-token-add').click();
  await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
    '90071992547409.93 FIXTURE'
  );
  await expect(
    page.getByText('Sending this token is not available in this build.', {
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByRole('heading', { name: 'Token details', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('native-token-detail.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Receive token', exact: true })
    .click();
  await expect(page.getByTestId('native-receive-address')).toHaveText(
    '0x52908400098527886E0F7030069857D2E4169EE7'
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: `View token contract ${token} on Ethereum`,
      exact: true,
    })
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', {
      name: `View token contract ${token} on Ethereum`,
      exact: true,
    })
    .click();
  await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
    '90071992547409.93 FIXTURE'
  );
  await page.getByRole('button', { name: 'Remove token', exact: true }).click();
  await expect(page.getByTestId('native-token-contract')).toHaveText(token);
  await page.getByTestId('native-token-remove-confirm').click();
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => window.__nativeTokenPortfolio.sends())).toBe(
    0
  );
});

test('zero and unavailable stay distinct, and the list is scoped to the selected network', async ({
  page,
}) => {
  await page.goto('/?token-portfolio');
  await add(page, zero);
  await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
    '0.0 ZERO'
  );
  await page.evaluate(() => window.__nativeTokenPortfolio.failBalances(true));
  await page
    .getByRole('button', { name: 'Refresh token balance', exact: true })
    .click();
  await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
    'Balance unavailable'
  );
  await page.evaluate(() => window.__nativeTokenPortfolio.select('base'));
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Custom tokens for this account on Base.', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => {
    window.__nativeTokenPortfolio.failBalances(false);
    window.__nativeTokenPortfolio.select('ethereum');
  });
  await page
    .getByRole('button', {
      name: `View token contract ${zero} on Ethereum`,
      exact: true,
    })
    .click();
  await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
    '0.0 ZERO'
  );
});

test('an old preview cannot survive network A-B-A or an unmount', async ({
  page,
}) => {
  await page.goto('/?token-portfolio');
  await page.evaluate(() => window.__nativeTokenPortfolio.holdPreview());
  await page.getByTestId('native-token-import').click();
  await page
    .getByRole('textbox', { name: 'Token contract address', exact: true })
    .fill(token);
  await page.getByTestId('native-token-review').click();
  await expect(page.getByText('Reading token…', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__nativeTokenPortfolio.select('base');
    window.__nativeTokenPortfolio.select('ethereum');
    window.__nativeTokenPortfolio.releasePreview();
  });
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('native-token-add')).toHaveCount(0);
  await page.evaluate(() => window.__nativeTokenPortfolio.holdPreview());
  await page.getByTestId('native-token-import').click();
  await page
    .getByRole('textbox', { name: 'Token contract address', exact: true })
    .fill(token);
  await page.getByTestId('native-token-review').click();
  await page.evaluate(() => window.__nativeTokenPortfolio.visible(false));
  await expect(page.getByTestId('native-tokens')).toHaveCount(0);
  await page.evaluate(() => {
    window.__nativeTokenPortfolio.releasePreview();
    window.__nativeTokenPortfolio.visible(true);
  });
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('native-token-add')).toHaveCount(0);
});

test('full contract and long exact amounts remain reachable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?token-portfolio');
  await add(page, long);
  await expect(page.getByTestId('native-token-detail-balance')).toContainText(
    '0.' + '0'.repeat(254) + '1'
  );
  await expect(page.getByTestId('native-token-contract')).toHaveAttribute(
    'aria-label',
    `Token contract address ${long}`
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page
    .getByRole('heading', { name: 'Token details', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('native-token-detail-320.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>('[dir="auto"]')
    )) {
      const style = getComputedStyle(node);
      node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    }
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page
    .getByRole('heading', { name: 'Token details', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('native-token-detail-320-large-text.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Remove token', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: 'Remove token', exact: true })
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('native-token-actions-320-large-text.png'),
    fullPage: true,
  });
});

test('Back cancels an in-flight preview and leaves the current token list reachable', async ({
  page,
}) => {
  await page.goto('/?token-portfolio');
  await page.evaluate(() => window.__nativeTokenPortfolio.holdPreview());
  await page.getByTestId('native-token-import').click();
  await page
    .getByRole('textbox', { name: 'Token contract address', exact: true })
    .fill(token);
  await page.getByTestId('native-token-review').click();
  await expect(page.getByText('Reading token…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  await page.evaluate(() => window.__nativeTokenPortfolio.releasePreview());
  await expect(page.getByTestId('native-token-add')).toHaveCount(0);
  await expect(page.getByTestId('native-token-import')).toBeEnabled();
});

for (const refresh of ['list', 'selected'] as const)
  test(`Import and Back preserve a pending ${refresh} balance refresh`, async ({
    page,
  }) => {
    await page.goto('/?token-portfolio');
    await add(page, token);
    await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
      '90071992547409.93 FIXTURE'
    );
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await add(page, zero);
    await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
      '0.0 ZERO'
    );
    await page.evaluate(() => window.__nativeTokenPortfolio.holdBalances());
    if (refresh === 'selected') {
      await page
        .getByRole('button', { name: 'Refresh token balance', exact: true })
        .click();
      await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
        'Loading…'
      );
      await page.getByRole('button', { name: 'Back', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page
        .getByRole('button', { name: 'Refresh tokens', exact: true })
        .click();
      await expect(page.getByTestId('native-token-row-balance')).toHaveText([
        'Loading…',
        'Loading…',
      ]);
    }

    await page.getByTestId('native-token-import').click();
    await expect(
      page.getByRole('heading', { name: 'Import token', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.evaluate(() => window.__nativeTokenPortfolio.releaseBalances());
    await expect(page.getByTestId('native-token-row-balance')).toHaveText([
      '90071992547409.93',
      '0.0',
    ]);
    await page
      .getByRole('button', {
        name: `View token contract ${zero} on Ethereum`,
        exact: true,
      })
      .click();
    await expect(page.getByTestId('native-token-detail-balance')).toHaveText(
      '0.0 ZERO'
    );
    await expect(
      page.getByRole('button', { name: 'Refresh token balance', exact: true })
    ).toBeEnabled();
  });

test('unreadable saved configuration stays unavailable and is preserved on retry', async ({
  page,
}) => {
  await page.goto('/?token-portfolio');
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem(
      'pali-native-token-ui:native-token-registry-v1',
      '{"version":99}'
    )
  );
  await page.reload();
  await expect(
    page.getByText('Saved tokens unavailable', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('No custom tokens added', { exact: true })
  ).toHaveCount(0);
  await expect(page.getByTestId('native-token-import')).toBeDisabled();
  await page
    .getByRole('button', { name: 'Refresh tokens', exact: true })
    .click();
  await expect(
    page.getByText('Saved tokens unavailable', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('pali-native-token-ui:native-token-registry-v1')
    )
  ).toBe('{"version":99}');
});
