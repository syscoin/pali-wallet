import { expect, test, type Page } from '@playwright/test';
import { authenticateNativeOperation, confirmFixtureBackup, deviceAuthorizationPrompt, refuseNativeOperation, waitForNativePublicSession } from '../ui/operationAuthentication';

const RECIPIENT = '0x3333333333333333333333333333333333333333';
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const recipient = (page: Page) => page.getByRole('textbox', { name: /^(Recipient|Ethereum|Base|Bitcoin|Syscoin) address$/ });
const amount = (page: Page, symbol = 'ETH') => page.getByRole('textbox', { name: `Amount in ${symbol}`, exact: true });
const reminder = (page: Page) => button(page, 'Back up your wallet. Protect access if this phone is lost.');

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== origin) {
      await route.abort(); throw Error('Unexpected external request in public send draft');
    }
    await route.continue();
  });
});

async function openWallet(page: Page, query = 'public-send-fixture', accountId = 'hd:60:0') {
  await page.addInitScript(id => localStorage.setItem('pali-public-selection-fixture-v1', JSON.stringify({ kind: 'hd', id })), accountId);
  await page.goto(`/?backup-required&android&${query}`);
  await waitForNativePublicSession(page);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
}
async function noSpending(page: Page) {
  expect(await page.evaluate(() => {
    const value = window.__watchFixture.audit();
    return { signs: value.signs, broadcasts: value.broadcasts, keys: value.keyReads };
  })).toEqual({ signs: 0, broadcasts: 0, keys: 0 });
}
async function openEvmDraft(page: Page, network = 'Ethereum') {
  await button(page, 'Send').click();
  await expect(heading(page, 'Send from')).toBeVisible();
  await page.getByRole('radio', { name: `${network}, ETH`, exact: true }).click();
  await expect(heading(page, 'Send ETH')).toBeVisible();
  await recipient(page).fill(RECIPIENT); await amount(page).fill('0.125');
}

test('unconfirmed backup remains a reminder and Later permits a normal EVM review', async ({ page }, testInfo) => {
  await openWallet(page);
  await reminder(page).click();
  await expect(heading(page, 'Wallet Backup')).toBeVisible();
  await button(page, 'Do It Later').click();
  await expect(reminder(page)).toBeVisible();
  await openEvmDraft(page);
  await expect(button(page, /^Network Fee/)).toBeEnabled();
  await expect(button(page, 'MAX')).toBeEnabled();
  await page.getByTestId('native-send-review').click();
  await expect(heading(page, 'Review transfer')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('unconfirmed-evm-review.png') });
  await noSpending(page);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
  await button(page, 'Confirm and send').click();
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  await noSpending(page);
  await refuseNativeOperation(page);
  await noSpending(page);
});

test('explicit backup still requires authorization and removes the reminder only after verification', async ({ page }) => {
  await openWallet(page); await reminder(page).click();
  await button(page, /^Back up now$/i).click();
  await authenticateNativeOperation(page);
  await confirmFixtureBackup(page);
  await expect(page.getByText('Backup complete', { exact: true })).toBeVisible();
  await button(page, 'Done').click();
  await expect(reminder(page)).toHaveCount(0);
  await expect(button(page, 'Send')).toBeVisible(); await noSpending(page);
});

for (const network of ['bitcoin', 'syscoin'] as const) test(`unconfirmed ${network} backup enters the ordinary send controller`, async ({ page }, testInfo) => {
  const syscoin = network === 'syscoin';
  await openWallet(page, syscoin ? 'sysx-utxo-send' : 'hd-utxo-send', syscoin ? 'hd:57:0' : 'hd:0:0');
  const symbol = syscoin ? 'SYSX' : 'BTC';
  if (syscoin) await button(page, /^SYSX(?:\s|$)/).click();
  await button(page, 'Send').click();
  await expect(heading(page, `Send ${symbol}`)).toBeVisible();
  await recipient(page).fill(syscoin ? await page.evaluate(() => window.__watchFixture.sysx.recipient) : 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  await amount(page, symbol).fill(syscoin ? '0.12345678' : '0.001');
  await button(page, 'Review transfer').click();
  if (syscoin) {
    await expect(heading(page, 'Review transfer')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('unconfirmed-spt-review.png') });
  } else {
    // This routing fixture deliberately refuses preparation; real Bitcoin SDK
    // signing is exercised by utxoSend.integration.test.ts.
    await expect(page.getByRole('alert')).toHaveText('Pali could not complete this request. Try again or check your saved transfers.');
    expect((await page.evaluate(() => window.__watchFixture.audit())).utxoOpens).toBe(1);
    expect((await page.evaluate(() => window.__watchFixture.audit())).utxoSavedReads).toBe(1);
    await expect(heading(page, 'Wallet Backup')).toHaveCount(0);
  }
  await noSpending(page); await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
});
