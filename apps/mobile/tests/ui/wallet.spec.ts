import { test, expect } from '@playwright/test';

const watchFixtures = [
  {
    id: 'syscoin', name: 'Syscoin Mainnet', coin: 'Syscoin', symbol: 'SYS', chain: 'main',
    endpoint: 'https://blockbook.syscoin.org', address: 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58',
    genesisHash: '0000022642db0346b6e01c2a397471f4f12e65d4f4251ec96c1f85367a61a7ab',
  },
  {
    id: 'bitcoin', name: 'Bitcoin', coin: 'Bitcoin', symbol: 'BTC', chain: 'main',
    endpoint: 'https://btc1.trezor.io', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    genesisHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  },
  {
    id: 'utxo:5700', name: 'Syscoin Testnet', coin: 'Syscoin Testnet', symbol: 'tSYS', chain: 'test',
    endpoint: 'https://blockbook-dev.syscoin.org', address: 'tsys1qw508d6qejxtdg4y5r3zarvary0c5xw7kn9mz8d',
    genesisHash: '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222',
  },
] as const;

for (const network of watchFixtures) {
  const { id, address } = network;
  test(`default App watches one ${id} address through the real public platform`, async ({ page }) => {
    const calls: string[] = [];
    const prices: string[] = [];
    const ticker = `${network.endpoint}/api/v2/tickers/currency`;
    const responses: Record<string, unknown> = {
      [`${network.endpoint}/api/v2/`]: {
        blockbook: { coin: network.coin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 123 },
        backend: { chain: network.chain },
      },
      [`${network.endpoint}/api/v2/block-index/0`]: { blockHash: network.genesisHash },
      [`${network.endpoint}/api/v2/address/${address}?details=tokenBalances&tokens=nonzero`]: { address, balance: '0', unconfirmedBalance: '-123', unconfirmedTxs: 1 },
    };
    await page.route('**/*', async (route) => {
      const request = route.request(), url = request.url();
      if (new URL(url).origin === 'http://127.0.0.1:4178') { await route.continue(); return; }
      if (network.chain === 'main' && request.method() === 'GET' && url === ticker) {
        prices.push(url);
        await route.fulfill({ headers: { 'access-control-allow-origin': 'http://127.0.0.1:4178' }, json: { rates: { usd: 100 } } });
        return;
      }
      if (request.method() !== 'GET' || !Object.hasOwn(responses, url)) {
        await route.abort('blockedbyclient');
        throw Error('Unexpected external request in public watch test');
      }
      calls.push(url);
      await route.fulfill({ headers: { 'access-control-allow-origin': 'http://127.0.0.1:4178' }, json: responses[url] });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
    await page.getByRole('button', { name: network.name, exact: true }).click();
    await page.getByRole('textbox', { name: 'Account name', exact: true }).fill(`Public ${network.symbol}`);
    await page.getByRole('textbox', { name: 'Public address, account key or descriptor', exact: true }).fill(address);
    await page.getByRole('button', { name: 'Review account', exact: true }).click();
    await expect(page.getByLabel(`Review ${network.name} address ${address}`, { exact: true })).toBeVisible();
    expect(calls).toEqual([]);
    expect(prices).toEqual([]);
    await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
    await expect(page.getByLabel(`${network.name} confirmed balance 0.0 ${network.symbol}`, { exact: true })).toBeVisible();
    await expect(page.getByLabel(`Pending balance change -0.00000123 ${network.symbol}`, { exact: true })).toBeVisible();
    expect(calls).toEqual([`${network.endpoint}/api/v2/`, `${network.endpoint}/api/v2/block-index/0`, `${network.endpoint}/api/v2/address/${address}?details=tokenBalances&tokens=nonzero`]);
    if (network.chain === 'main') await expect.poll(() => prices).toEqual([ticker]);
    else expect(prices).toEqual([]);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(page.getByRole('img', { name: `QR code for ${network.name} address ${address}` })).toBeVisible();
  });
}
test('sample send and receive stay inert and keep their network identity', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4178')) external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the design' }).click();
  await expect(page.getByText('DESIGN PREVIEW · SAMPLE DATA')).toBeVisible();
  await page.getByRole('button', { name: 'Preview send', exact: true }).click();
  await page
    .getByRole('button', { name: 'Choose Bitcoin on Bitcoin', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Sample recipient' })
    .fill('Sample recipient — no address');
  await page.getByRole('textbox', { name: 'Amount in BTC' }).fill('0.005');
  await page.getByRole('button', { name: 'Preview review' }).click();
  await expect(
    page.getByText('0.005 BTC', { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText('0.000042 BTC', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish preview' }).click();
  await expect(page.getByText('Review complete.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to wallet' }).click();
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await page
    .getByRole('button', { name: 'Choose Bitcoin on Bitcoin', exact: true })
    .click();
  await expect(
    page.getByText('PALI-PREVIEW:bitcoin:NOT-A-PAYMENT-ADDRESS')
  ).toBeVisible();
  await expect(
    page.getByText('Preview QR · not a payment address')
  ).toBeVisible();
  expect(external).toEqual([]);
});
test('watch-only validates before RPC, preserves zero and cannot sign', async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route('https://**', async (route) => {
    const request = route.request().postDataJSON();
    calls.push(request.method);
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: request.method === 'eth_chainId' ? '0x1' : '0x0',
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch an account' }).click();
  await expect(
    page.getByText('Use public information only. Never enter a recovery phrase or private key.', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Public EVM address' })
    .fill('not an address');
  await page.getByRole('button', { name: 'Review account' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toEqual([]);
  await page
    .getByRole('textbox', { name: 'Public EVM address' })
    .fill('0x000000000000000000000000000000000000dEaD');
  await page.getByRole('button', { name: 'Review account' }).click();
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toHaveCount(0);
  await expect(page.getByText('0.0', { exact: true }).first()).toBeVisible();
  expect(calls).toEqual(['eth_chainId', 'eth_getBalance']);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    }))
  ).toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Watch an account' })
  ).toBeVisible();
});
test('a new watch-only address can switch across every offered EVM network', async ({ page }) => {
  const networks = [
    { name: 'Ethereum', url: 'https://ethereum-rpc.publicnode.com', chain: 1 },
    { name: 'Syscoin NEVM', url: 'https://rpc.syscoin.org', chain: 57 },
    { name: 'Base', url: 'https://mainnet.base.org', chain: 8453 },
    { name: 'Arbitrum One', url: 'https://arb1.arbitrum.io/rpc', chain: 42161 },
    { name: 'Rollux', url: 'https://rpc.rollux.com', chain: 570 },
    { name: 'Syscoin NEVM Testnet', url: 'https://rpc.tanenbaum.io', chain: 5700 },
    { name: 'zkTanenbaum Testnet', url: 'https://rpc-zk.tanenbaum.io', chain: 57057 },
  ];
  const errors: string[] = [];
  const calls: { chain: number; method: string }[] = [];
  const prices: string[] = [];
  const quoteUrls = new Map(['ethereum', 'syscoin'].map((asset) => [
    `https://api.coingecko.com/api/v3/simple/price?ids=${asset}&vs_currencies=usd&include_24hr_change=true`, asset,
  ]));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, async (route) => {
    const asset = quoteUrls.get(route.request().url());
    if (asset && route.request().method() === 'GET') {
      prices.push(asset);
      await route.fulfill({ headers: { 'access-control-allow-origin': 'http://127.0.0.1:4178' }, json: { [asset]: { usd: 100, usd_24h_change: 0 } } });
      return;
    }
    const network = networks.find((entry) => new URL(entry.url).href === new URL(route.request().url()).href);
    if (!network || route.request().method() !== 'POST') {
      await route.abort('blockedbyclient');
      throw new Error('Unexpected network request');
    }
    const request = route.request().postDataJSON();
    calls.push({ chain: network.chain, method: request.method });
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id,
      result: request.method === 'eth_chainId' ? `0x${network.chain.toString(16)}` : '0x0' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch an account' }).click();
  await page.getByRole('textbox', { name: 'Public EVM address' }).fill('0x000000000000000000000000000000000000dEaD');
  await page.getByRole('button', { name: 'Review account' }).click();
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Ethereum balance 0.0 ETH', { exact: true })).toBeVisible();
  await expect.poll(() => prices).toEqual(['ethereum']);
  let selected = 'Ethereum';
  for (const network of networks) {
    await page.getByRole('button', { name: `Network ${selected}`, exact: true }).click();
    await page.getByRole('button').filter({ has: page.getByText(network.name, { exact: true }) }).click();
    await expect(page.getByRole('button', { name: `Network ${network.name}`, exact: true })).toBeVisible({ timeout: 5000 });
    await expect.poll(() => calls.filter((call) => call.chain === network.chain && call.method === 'eth_getBalance').length).toBeGreaterThan(0);
    if (network.chain === 57) await expect.poll(() => prices).toEqual(['ethereum', 'syscoin']);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    selected = network.name;
  }
  expect(errors).toEqual([]);
  expect(prices).toEqual(['ethereum', 'syscoin']);
  expect(calls.every((call) => ['eth_chainId', 'eth_getBalance'].includes(call.method))).toBe(true);
});
test('activity filters show the selected sample direction', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the design' }).click();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByRole('button', { name: 'Sent', exact: true }).click();
  await expect(page.getByText('−125.00 SYS', { exact: true })).toBeVisible();
  await expect(page.getByText('+0.25 ETH', { exact: true })).toHaveCount(0);
});
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
]) {
  test(`layout and network sheet work at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Explore the design' }).click();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBeTruthy();
    await page
      .getByRole('button', { name: 'Preview send', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Choose Syscoin on Syscoin NEVM',
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole('button', {
        name: 'Choose Syscoin on Syscoin NEVM',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Sample recipient' })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBeTruthy();
  });
}
