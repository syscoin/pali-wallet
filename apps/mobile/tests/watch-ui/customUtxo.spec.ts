import { expect, test } from '@playwright/test';

const key = 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';

test('sets up a verified custom watch network and retains it across reopen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/*', async (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://127.0.0.1:4182');
    await route.continue();
  });
  await page.goto('/?empty=1&custom-utxo');
  await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
  await page.getByRole('button', { name: 'Manage watch networks', exact: true }).click();
  await page.getByRole('button', { name: 'Add UTXO network', exact: true }).click();
  const endpoint = page.getByRole('textbox', { name: 'Blockbook URL', exact: true });
  await endpoint.fill('https://wrong-ltc.invalid/blockbook');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Check the Blockbook URL and try again.');
  await endpoint.fill('https://watch-ltc.invalid/blockbook');
  await page.screenshot({ path: testInfo.outputPath('custom-watch-network-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.getByText('Litecoin', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.events())).some((event) => event.includes('/xpub/'))).toBe(false);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Litecoin · watch-ltc.invalid', exact: true }).click();
  await page.getByRole('textbox', { name: 'Public address, account key or descriptor' }).fill(key);
  await page.getByRole('button', { name: 'Review account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm watch account', exact: true }).click();
  await expect(page.getByLabel('Litecoin confirmed balance 1.23456789 LTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('custom-watch-network-balance.png'), fullPage: true });

  await page.reload();
  await page.getByRole('button', { name: 'View my accounts', exact: true }).click();
  await expect(page.getByLabel('Litecoin confirmed balance 1.23456789 LTC', { exact: true })).toBeVisible();
});

for (const fault of ['write', 'readback'] as const) {
  test(`reloads verified settings after an uncertain network ${fault}`, async ({ page }) => {
    await page.goto(`/?empty=1&custom-utxo&custom-utxo-storage-fault=${fault}`);
    await page.getByRole('button', { name: 'Watch an account', exact: true }).click();
    await page.getByRole('button', { name: 'Manage watch networks', exact: true }).click();
    await page.getByRole('button', { name: 'Add UTXO network', exact: true }).click();
    const endpoint = page.getByRole('textbox', { name: 'Blockbook URL', exact: true });
    const name = page.getByRole('textbox', { name: 'Network name', exact: true });
    const save = page.getByRole('button', { name: 'Save network', exact: true });
    await endpoint.fill('https://watch-ltc.invalid/blockbook');
    await name.fill('My Litecoin');
    await save.click();
    const reload = page.getByRole('button', { name: 'Reload saved networks', exact: true });
    await expect(reload).toBeVisible();
    await expect(save).toBeDisabled();
    const observed = () => page.evaluate(() => window.__watchFixture.events().filter((event) =>
      event === 'watch-network-write' || event.startsWith('blockbook:')));
    const beforeReload = await observed();
    expect(beforeReload.filter((event) => event === 'watch-network-write')).toHaveLength(1);
    await reload.click();

    if (fault === 'write') {
      await expect(save).toBeEnabled();
      await expect(endpoint).toHaveValue('https://watch-ltc.invalid/blockbook');
      await expect(name).toHaveValue('My Litecoin');
      expect(await observed()).toEqual(beforeReload);
      await save.click();
      await expect(page.getByText('My Litecoin', { exact: true })).toBeVisible();
      expect((await observed()).filter((event) => event === 'watch-network-write')).toHaveLength(2);
    } else {
      await expect(page.getByText('My Litecoin', { exact: true })).toBeVisible();
      await expect(save).toHaveCount(0);
      expect(await observed()).toEqual(beforeReload);
    }
  });
}
