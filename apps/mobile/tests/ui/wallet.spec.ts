import { test, expect } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Watch an address' }).click();
  await expect(
    page.getByText(/Balance lookups share this public address/)
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Public EVM address' })
    .fill('not an address');
  await page.getByRole('button', { name: 'Add watch-only account' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toEqual([]);
  await page
    .getByRole('textbox', { name: 'Public EVM address' })
    .fill('0x000000000000000000000000000000000000dEaD');
  await page.getByRole('button', { name: 'Add watch-only account' }).click();
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
    page.getByRole('button', { name: 'Watch an address' })
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
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, async (route) => {
    const network = networks.find((entry) => new URL(entry.url).href === new URL(route.request().url()).href);
    if (!network) throw new Error('Unexpected network request');
    const request = route.request().postDataJSON();
    calls.push({ chain: network.chain, method: request.method });
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id,
      result: request.method === 'eth_chainId' ? `0x${network.chain.toString(16)}` : '0x0' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch an address' }).click();
  await page.getByRole('textbox', { name: 'Public EVM address' }).fill('0x000000000000000000000000000000000000dEaD');
  await page.getByRole('button', { name: 'Add watch-only account' }).click();
  await expect(page.getByLabel('Ethereum balance 0.0 ETH', { exact: true })).toBeVisible();
  let selected = 'Ethereum';
  for (const network of networks) {
    await page.getByRole('button', { name: `Network ${selected}`, exact: true }).click();
    await page.getByRole('button').filter({ has: page.getByText(network.name, { exact: true }) }).click();
    await expect(page.getByRole('button', { name: `Network ${network.name}`, exact: true })).toBeVisible({ timeout: 5000 });
    await expect.poll(() => calls.filter((call) => call.chain === network.chain && call.method === 'eth_getBalance').length).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    selected = network.name;
  }
  expect(errors).toEqual([]);
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
