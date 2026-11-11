import { test, expect } from '@playwright/test';

const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';
const target = 'https://faucet-zk.tanenbaum.io/';
const opened = 'Faucet opened in your browser. Paste your address there to request test funds.';

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

for (const kind of ['hd', 'watch'] as const) {
  const path = `/?faucet${kind === 'watch' ? '&watch' : ''}`;
  test(`${kind}: explicit copy and fixed handoff work from portfolio and Receive`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(path);
    await expect(page.getByTestId('native-faucet-copy')).toBeVisible();
    await expect(page.getByText('ZKTANENBAUM TESTNET TEST FUNDS', { exact: true })).toBeVisible();
    await expect(page.getByText('Pali does not send your address to the faucet.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => window.__nativeFaucetFixture.opened())).toEqual([]);
    await page.evaluate(() => navigator.clipboard.writeText('public-faucet-fixture'));
    await page.getByTestId('native-faucet-copy').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await page.getByTestId('native-faucet-open').click();
    await expect(page.getByText(opened, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${kind}-faucet-portfolio.png`), fullPage: true });
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(page.getByText(first, { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: `QR code for zkTanenbaum Testnet address ${first}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Copy address', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await page.getByTestId('native-faucet-open').click();
    expect(await page.evaluate(() => window.__nativeFaucetFixture.opened())).toEqual([target, target]);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-faucet-receive.png`), fullPage: true });
    expect(await page.evaluate(() => window.__nativeFaucetFixture.sends())).toBe(0);
    if (kind === 'watch') {
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
      await expect(page.getByText('View recovery phrase', { exact: true })).toHaveCount(0);
    }
  });

  test(`${kind}: unsupported networks hide the handoff and account changes replace the public address`, async ({ page }) => {
    await page.goto(path);
    for (const id of ['ethereum', 'syscoin-nevm-testnet', 'base'] as const) {
      await page.evaluate((network) => window.__nativeFaucetFixture.select(network), id);
      await expect(page.getByTestId('native-faucet-open')).toHaveCount(0);
    }
    await page.evaluate(() => window.__nativeFaucetFixture.select('zksys-testnet', 1));
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(page.getByText(second, { exact: true })).toBeVisible();
    await expect(page.getByText(first, { exact: true })).toHaveCount(0);
    await page.getByTestId('native-faucet-open').click();
    expect(await page.evaluate(() => window.__nativeFaucetFixture.opened())).toEqual([target]);
  });

  test(`${kind}: open failures are visible and duplicate presses do not open twice`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => window.__nativeFaucetFixture.nextOpen('failure'));
    await page.getByTestId('native-faucet-open').click();
    await expect(page.getByText('Could not open the faucet. Try again.', { exact: true })).toBeVisible();
    await page.evaluate(() => window.__nativeFaucetFixture.nextOpen('pending'));
    await page.getByTestId('native-faucet-open').click();
    await expect(page.getByTestId('native-faucet-open')).toBeDisabled();
    expect(await page.evaluate(() => window.__nativeFaucetFixture.opened())).toEqual([target, target]);
    await page.evaluate(() => window.__nativeFaucetFixture.release());
    await expect(page.getByText(opened, { exact: true })).toBeVisible();
  });

  test(`${kind}: A-B-A, background and unmount discard late external-opening feedback`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => window.__nativeFaucetFixture.nextOpen('pending'));
    await page.getByTestId('native-faucet-open').click();
    await page.evaluate(() => { window.__nativeFaucetFixture.select('base'); window.__nativeFaucetFixture.select('zksys-testnet'); window.__nativeFaucetFixture.release(true); });
    await expect(page.getByTestId('native-faucet-open')).toBeEnabled();
    await expect(page.getByText('Could not open the faucet. Try again.', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.__nativeFaucetFixture.lifecycle('background'));
    await page.getByTestId('native-faucet-open').click();
    expect(await page.evaluate(() => window.__nativeFaucetFixture.opened())).toEqual([target]);
    await page.evaluate(() => { window.__nativeFaucetFixture.lifecycle('active'); window.__nativeFaucetFixture.nextOpen('pending'); });
    await page.getByTestId('native-faucet-open').click();
    await page.evaluate(() => { window.__nativeFaucetFixture.unmount(); window.__nativeFaucetFixture.release(); });
    await expect(page.getByText('Fixture closed', { exact: true })).toBeVisible();
    await expect(page.getByText(opened, { exact: true })).toHaveCount(0);
  });

  test(`${kind}: background and lock revoke pending handoff feedback`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => window.__nativeFaucetFixture.nextOpen('pending'));
    await page.getByTestId('native-faucet-open').click();
    await page.evaluate(() => { window.__nativeFaucetFixture.lifecycle('background'); window.__nativeFaucetFixture.release(); window.__nativeFaucetFixture.lifecycle('active'); });
    await expect(page.getByTestId('native-faucet-open')).toBeEnabled();
    await expect(page.getByText(opened, { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.__nativeFaucetFixture.nextOpen('pending'));
    await page.getByTestId('native-faucet-open').click();
    await page.evaluate(() => { window.__nativeFaucetFixture.lock(); window.__nativeFaucetFixture.release(true); });
    await expect(page.getByTestId('native-faucet-open')).toHaveCount(0);
    await expect(page.getByText(first, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Could not open the faucet. Try again.', { exact: true })).toHaveCount(0);
  });
}

test('faucet Receive fits a narrow viewport with large text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?faucet&watch');
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await page.addStyleTag({ content: '[dir="auto"] { font-size: 23px !important; line-height: 1.4 !important; }' });
  await expect(page.getByTestId('native-faucet-open')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('faucet-large-text-top.png'), fullPage: true });
  await page.getByTestId('native-faucet-open').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('faucet-large-text.png'), fullPage: true });
});
