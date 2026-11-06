import { test, expect, type Page } from '@playwright/test';

const fixtureUrl =
  process.env.PALI_NATIVE_SEND_UI_URL ?? 'http://127.0.0.1:4179';
test.use({ baseURL: fixtureUrl });
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === new URL(fixtureUrl).origin
      ? route.continue()
      : route.abort('blockedbyclient')
  );
});
const token = '0x1111111111111111111111111111111111111111';
const zero = '0x2222222222222222222222222222222222222222';
const long = '0x3333333333333333333333333333333333333333';

async function enlargeText(page: Page) {
  await page.evaluate(() => {
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>('[dir="auto"]')
    )) {
      const style = getComputedStyle(node);
      node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    }
  });
}

test('wallet holdings on the native Import route require verified review and explicit add', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?token-portfolio&holdings');
  const requests = () =>
    page.evaluate(() => window.__nativeTokenPortfolio.requests());
  await expect(page.getByTestId('native-token-import')).toBeEnabled();
  expect(await requests()).toEqual([]);
  await page.getByTestId('native-token-import').click();
  const contractInput = page.getByRole('textbox', {
    name: 'Token contract address',
    exact: true,
  });
  await expect(contractInput).toBeVisible();
  expect(await requests()).toEqual([]);
  await contractInput.fill('0x1');
  expect(await requests()).toEqual([]);
  await page
    .getByRole('button', { name: 'Find holdings', exact: true })
    .click();
  const suggestion = page.getByRole('button', {
    name: `Review HINT token contract ${token}`,
  });
  await expect(suggestion).toBeVisible();
  expect(await requests()).toHaveLength(1);
  expect((await requests())[0]).toContain(
    '/address/0x52908400098527886E0F7030069857D2E4169EE7/erc20-holdings?limit=100'
  );
  await expect(page.getByTestId('native-token-add')).toHaveCount(0);
  await suggestion.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('holdings-320.png') });
  await enlargeText(page);
  await suggestion.scrollIntoViewIfNeeded();
  await expect(suggestion).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('holdings-320-large-text.png'),
  });
  await suggestion.click();
  await expect(page.getByText('Fixture token', { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-token-preview-balance')).toHaveText(
    '90071992547409.93 FIXTURE'
  );
  await expect(page.getByTestId('native-token-contract')).toHaveText(token);
  const saved = () =>
    page.evaluate(() =>
      localStorage.getItem('pali-native-token-ui:native-token-registry-v1')
    );
  expect(await saved()).toBeNull();
  await page.getByTestId('native-token-add').click();
  await expect(
    page.getByRole('heading', { name: 'Token details', exact: true })
  ).toBeVisible();
  expect(await saved()).toContain('Fixture token');
  expect(await saved()).not.toContain('Explorer fixture');
});

test('collectible suggestions require an explicit lookup and remain read-only', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const external: string[] = [];
  const quote =
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true';
  await page.route(quote, async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({
      json: { ethereum: { usd: 100, usd_24h_change: 0 } },
    });
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).origin !== new URL(fixtureUrl).origin &&
      request.url() !== quote
    )
      external.push(request.url());
  });
  await page.goto('/?token-portfolio&holdings&holdings-fail');
  const requests = () =>
    page.evaluate(() => window.__nativeTokenPortfolio.requests());
  await page.getByRole('button', { name: 'Collectibles', exact: true }).click();
  const panel = page.getByTestId('native-collectibles');
  await expect(panel).toBeVisible();
  expect(await requests()).toEqual([]);
  await page.getByRole('button', { name: 'Find collectibles' }).click();
  await expect(panel.getByText('Collectibles unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.getByText('Paper foxes', { exact: true })).toBeVisible();
  await expect(panel.getByText('Token ID 0', { exact: true })).toBeVisible();
  const quantity = panel.getByText('Quantity reported: 900719925474099312345', {
    exact: true,
  });
  await expect(quantity).toBeVisible();
  expect(
    (await requests()).map((request) => request.match(/erc\d+-holdings/)?.[0])
  ).toEqual(['erc721-holdings', 'erc721-holdings', 'erc1155-holdings']);
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() =>
      localStorage.getItem('pali-native-token-ui:native-token-registry-v1')
    )
  ).toBeNull();
  await page.screenshot({ path: testInfo.outputPath('collectibles-320.png') });
  await enlargeText(page);
  await quantity.scrollIntoViewIfNeeded();
  await expect(quantity).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('collectibles-320-large-text.png'),
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Collectibles', exact: true }).click();
  await expect(panel.getByText('Paper foxes', { exact: true })).toHaveCount(0);
  expect(await requests()).toHaveLength(3);
});

test('checks selected collectible ownership and cancels stale reads', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route('https://api.coingecko.com/**', (route) =>
    route.fulfill({ json: { ethereum: { usd: 100, usd_24h_change: 0 } } })
  );
  await page.goto('/?token-portfolio&holdings&collectible-check&ownership-fail');
  const rpc = () => page.evaluate(() => window.__nativeTokenPortfolio.requests().filter((entry) => entry.startsWith('nft:')));
  const aborts = () => page.evaluate(() => window.__nativeTokenPortfolio.nftAborts());
  const check = page.getByRole('button', { name: 'Check ownership', exact: true });
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await page.getByRole('button', { name: 'Collectibles', exact: true }).click();
  await page.getByRole('button', { name: 'Find collectibles', exact: true }).click();
  await page.getByRole('button', { name: 'View NFT Collection token 0', exact: true }).click();
  await expect(check).toBeVisible();
  await expect(page.getByText('Explorer-reported name', { exact: true })).toBeVisible();
  expect(await rpc()).toEqual([]);
  await check.click();
  await expect(page.getByText('Ownership unavailable', { exact: true })).toBeVisible();
  await check.click();
  const result = page.getByTestId('native-collectible-quantity');
  await expect(result).toHaveText('Quantity on network: 900719925474099312345');
  expect(await rpc()).toEqual([
    'nft:chain', 'nft:block:latest', `nft:code:${long}`, `nft:balanceOf:${long}`,
    'nft:chain', 'nft:block:latest', `nft:code:${long}`, `nft:balanceOf:${long}`, `nft:balanceOfBatch:${long}`,
    'nft:block:0x100', 'nft:chain',
  ]);
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('collectible-ownership-320.png') });
  await enlargeText(page);
  await result.scrollIntoViewIfNeeded();
  await expect(result).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('collectible-ownership-large.png') });
  await back.click();

  const collection = page.getByRole('button', { name: 'View Paper foxes collection', exact: true });
  await collection.click();
  const id = page.getByRole('textbox', { name: 'Token ID', exact: true });
  await id.fill('1e2');
  await check.click();
  await expect(page.getByText('Enter a valid token ID.', { exact: true })).toBeVisible();
  expect(await rpc()).toHaveLength(11);
  await id.fill('0');
  await page.evaluate(() => window.__nativeTokenPortfolio.holdNft());
  await check.click();
  await expect.poll(async () => (await rpc()).at(-1)).toBe(`nft:ownerOf:${zero}`);
  await expect(page.getByRole('button', { name: 'Checking ownership…' })).toBeDisabled();
  await back.click();
  expect(await aborts()).toBe(1);
  await page.evaluate(() => window.__nativeTokenPortfolio.releaseNft());
  await expect(result).toHaveCount(0);
  await collection.click();
  await expect(id).toHaveValue('');
  await id.fill('0');
  await check.click();
  await expect(result).toHaveText('This account owns this item.');
  expect(await rpc()).toHaveLength(22); // Held probe stopped; fresh check completed all seven reads.
  await page.evaluate(() => window.__nativeTokenPortfolio.holdNft());
  await check.click();
  await expect.poll(async () => (await rpc()).length).toBe(26);
  await id.fill('1');
  expect(await aborts()).toBe(2);
  await page.evaluate(() => window.__nativeTokenPortfolio.releaseNft());
  await expect(result).toHaveCount(0);
  await check.click();
  await expect(result).toHaveText('This account doesn’t own this item.');
  expect(await rpc()).toHaveLength(33);
  await page.evaluate(() => window.__nativeTokenPortfolio.holdNft());
  await check.click();
  await expect.poll(async () => (await rpc()).length).toBe(37);
  await page.evaluate(() => {
    window.__nativeTokenPortfolio.lock();
    window.__nativeTokenPortfolio.releaseNft();
  });
  expect(await aborts()).toBe(3);
  await expect(result).toHaveCount(0);
  expect(await rpc()).toHaveLength(37);
});

test('failed holdings stays separate from manual review and requires explicit retry', async ({
  page,
}) => {
  await page.goto('/?token-portfolio&holdings&holdings-fail');
  await page.getByTestId('native-token-import').click();
  await page
    .getByRole('button', { name: 'Find holdings', exact: true })
    .click();
  await expect(
    page.getByText('Holdings unavailable', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Token contract address', exact: true })
    .fill(zero);
  await expect(page.getByTestId('native-token-review')).toBeEnabled();
  const requests = () =>
    page.evaluate(() => window.__nativeTokenPortfolio.requests());
  expect(await requests()).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry holdings' }).click();
  await expect(
    page.getByText('Explorer fixture · HINT', { exact: true })
  ).toBeVisible();
  expect(await requests()).toHaveLength(2);
  await page.getByTestId('native-token-review').click();
  await expect(page.getByTestId('native-token-contract')).toHaveText(zero);
  await expect(page.getByTestId('native-token-preview-balance')).toHaveText(
    '0.0 ZERO'
  );
});
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
  await enlargeText(page);
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
