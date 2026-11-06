import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4179' });

test('SYSX appears as an exact read-only balance on the selected Syscoin UTXO account', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?network-portfolio');
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Ethereum balance 1.234 ETH');
  await page.evaluate(() => window.__nativeNetworkPortfolio.select('syscoin'));
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Syscoin Mainnet balance 1.234 SYS');
  await expect(page.getByTestId('native-portfolio-sysx')).toHaveText('90071992.54740995 SYSX');
  await expect(page.getByText('Pending -0.00000001 SYSX', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /send sysx/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.__nativeNetworkPortfolio.setSysx('unavailable'));
  await page.getByTestId('native-portfolio-refresh').click();
  await expect(page.getByTestId('native-portfolio-sysx')).toHaveText('Balance unavailable');
  await expect(page.getByText('Pending -0.00000001 SYSX', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__nativeNetworkPortfolio.setSysx('empty'));
  await page.getByTestId('native-portfolio-refresh').click();
  await expect(page.getByTestId('native-portfolio-sysx')).toHaveCount(0);
  await page.evaluate(() => window.__nativeNetworkPortfolio.select('bitcoin'));
  await expect(page.getByTestId('native-portfolio-sysx')).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.reads())).toEqual(['ethereum', 'syscoin', 'syscoin', 'syscoin', 'bitcoin']);
});

test('actual network view switches portfolio and Receive with generic Send available', async ({ page }) => {
  await page.goto('/?network-portfolio');
  await expect(page.getByTestId('native-portfolio-balance')).toHaveText('1.234');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByText('Network', { exact: true }).click();
  await page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Base, ETH, Chain ID 8453', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Account 1 · Base', { exact: true })).toBeVisible();
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Base balance 1.234 ETH');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(page.getByText('Sending is not available on this network yet.')).toHaveCount(0);
  await page.getByTestId('native-portfolio-receive').click();
  await expect(page.getByTestId('native-receive-qr')).toHaveAttribute('aria-label', /QR code for Base address/);
  await expect(page.getByText('Use Base for this address.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.reads())).toEqual(['ethereum', 'base']);
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.sends())).toBe(0);
});

test('switching away from Receive discards its scope and labels testnet funds explicitly', async ({ page }, testInfo) => {
  await page.goto('/?network-portfolio');
  await page.getByTestId('native-portfolio-receive').click();
  await page.evaluate(() => window.__nativeNetworkPortfolio.select('syscoin-nevm-testnet'));
  await expect(page.getByTestId('native-receive-qr')).toHaveCount(0);
  await expect(page.getByText('Account 1 · Syscoin NEVM Testnet · Test network', { exact: true })).toBeVisible();
  await expect(page.getByText('Test network · Balance and receive only', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Syscoin NEVM Testnet balance 1.234 TSYS');
  await page.getByTestId('native-portfolio-receive').click();
  await expect(page.getByText('Use Syscoin NEVM Testnet (test network) for this address.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-network-receive.png'), fullPage: true });
});

test('public address copy uses the selected network and OS browser clipboard', async ({ page, context }) => {
  await page.route('https://api.coingecko.com/**', (route) => route.abort());
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?network-portfolio');
  await page.evaluate(() => window.__nativeNetworkPortfolio.select('rollux'));
  await page.getByTestId('native-portfolio-receive').click();
  await page.getByTestId('native-receive-copy').click();
  await expect(page.getByText('Rollux address copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0x52908400098527886E0F7030069857D2E4169EE7');
});


test('Bitcoin selection renders the scoped Receive address, exact balance and Send', async ({ page, context }, testInfo) => {
  const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4179'
    ? route.continue() : route.abort());
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?network-portfolio');
  await page.getByText('Network', { exact: true }).click();
  const bitcoin = page.getByRole('radio', { name: 'Bitcoin, BTC', exact: true });
  await bitcoin.click();
  await expect(bitcoin).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Bitcoin balance 1.234 BTC');
  await expect(page.getByText('Pending -0.00000123 BTC', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.sends())).toBe(1);
  await page.getByTestId('native-portfolio-receive').click();
  await expect(page.getByTestId('native-receive-address')).toHaveText(address);
  await expect(page.getByTestId('native-receive-qr')).toHaveAttribute('aria-label', `QR code for Bitcoin address ${address}`);
  await page.getByTestId('native-receive-copy').click();
  await expect(page.getByText('Bitcoin address copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-bitcoin-receive.png'), fullPage: true });
  expect(await page.evaluate(() => window.__nativeNetworkPortfolio.reads())).toEqual(['ethereum', 'bitcoin']);
});

test('a quote arriving during a press keeps the selected Receive button in place', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const started = Promise.withResolvers<void>();
  const quoteReady = Promise.withResolvers<void>();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4179') return route.continue();
    if (url.origin !== 'https://api.coingecko.com' || url.pathname !== '/api/v3/simple/price')
      return route.abort();
    if (url.searchParams.get('ids') === 'ethereum')
      return route.fulfill({ json: { ethereum: { usd: 100 } } });
    if (url.searchParams.get('ids') !== 'syscoin') return route.abort();
    started.resolve();
    await quoteReady.promise;
    return route.fulfill({ json: { syscoin: { usd: 2 } } });
  });
  try {
    await page.goto('/?network-portfolio');
    await page.addStyleTag({ content: '[dir="auto"] { font-size: 22px !important; line-height: 1.4 !important; }' });
    await page.evaluate(() => window.__nativeNetworkPortfolio.select('rollux'));
    await expect(page.getByTestId('native-portfolio-balance')).toHaveAttribute('aria-label', 'Rollux balance 1.234 SYS');
    await started.promise;
    const quote = page.getByTestId('native-portfolio-quote');
    await expect(quote).toHaveCount(0);
    const receive = page.getByTestId('native-portfolio-receive');
    await receive.scrollIntoViewIfNeeded();
    const button = await receive.boundingBox();
    expect(button).not.toBeNull();
    expect(button!.width).toBeGreaterThanOrEqual(44);
    expect(button!.height).toBeGreaterThanOrEqual(44);
    const send = await page.getByRole('button', { name: 'Send', exact: true }).boundingBox();
    expect(send).not.toBeNull();
    expect(send!.width).toBeGreaterThanOrEqual(44);
    expect(send!.height).toBeGreaterThanOrEqual(44);
    expect(send!.y).toBeCloseTo(button!.y, 1);
    expect(await receive.getByText('Receive', { exact: true }).evaluate((label) =>
      label.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(label).lineHeight) + 1
    )).toBe(true);
    await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2);
    await page.mouse.down();
    try {
      // Capture both measurements after React has committed the pressed scale.
      await expect.poll(() => receive.evaluate((node) => getComputedStyle(node).transform))
        .toBe('matrix(0.99, 0, 0, 0.99, 0, 0)');
      const before = await receive.boundingBox();
      quoteReady.resolve();
      await expect(quote).toHaveText('≈ 2.468 USD');
      const after = await receive.boundingBox();
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      expect(after!.y).toBeCloseTo(before!.y, 1);
      await expect(quote).toHaveAttribute('aria-label', '≈ 2.468 USD');
      expect(await quote.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('portfolio-quote-320-large-type.png') });
    } finally {
      await page.mouse.up();
    }
    await expect(page.getByTestId('native-receive-copy')).toBeVisible();
    await expect(page.getByTestId('native-receive-qr')).toHaveAttribute('aria-label', /QR code for Rollux address/);
  } finally {
    quoteReady.resolve();
  }
});


// Exercise the actual NativePortfolio with synthetic public account data.
test('scrolled native wallet opens Receive at its header', async ({ page }, info) => {
  await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4179'
    ? route.continue() : route.abort('blockedbyclient'));
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('/?network-portfolio&font-scale=1.6');
  const receive = page.getByTestId('native-portfolio-receive');
  await expect(receive).toBeVisible();
  const scroll = await receive.evaluate((element) => {
    let parent = element.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight && /(auto|scroll)/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    if (!parent) return 0;
    parent.scrollTop = Math.min(180, parent.scrollHeight - parent.clientHeight);
    return parent.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);
  await receive.click();
  // Capture before any later click or locator scrolls the screen.
  await page.screenshot({ path: info.outputPath('native-receive-after-scrolled-home.png') });
  await expect(page.getByRole('heading', { name: 'Receive ETH', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeInViewport({ ratio: 1 });
});

test('native Receive footer words remain whole at 320px and 1.6 text', async ({ page }, info) => {
  await page.route('**/*', (route) => new URL(route.request().url()).origin === 'http://127.0.0.1:4179'
    ? route.continue() : route.abort('blockedbyclient'));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?network-portfolio&font-scale=1.6');
  await page.getByTestId('native-portfolio-receive').click();
  await expect(page.getByTestId('native-receive-copy')).toBeVisible();
  // RN Web does not apply native font scaling. Scale each computed font and
  // line-height once by 1.6; this does not establish native text shaping.
  await page.evaluate(() => {
    const values = Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]')).map((element) => {
      const style = getComputedStyle(element);
      return { element, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
    });
    for (const { element, font, line } of values) {
      if (Number.isFinite(font)) element.style.setProperty('font-size', `${font * 1.6}px`, 'important');
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * 1.6}px`, 'important');
    }
  });
  await page.screenshot({ path: info.outputPath('native-receive-footer-320-1_6.png') });
  for (const label of ['Copy address', 'Share address']) {
    const text = page.getByRole('button', { name: label, exact: true }).getByText(label, { exact: true });
    const split = await text.evaluate((element) => {
      const node = element.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return ['missing text'];
      return Array.from((node.textContent ?? '').matchAll(/[A-Za-z]+/g)).filter((match) => {
        const range = document.createRange();
        range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size !== 1;
      }).map((match) => match[0]);
    });
    expect(split, `${label} should not break within a word`).toEqual([]);
  }
});
