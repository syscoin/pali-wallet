import { expect, test, type Page } from '@playwright/test';
import { authenticateNativeOperation, confirmFixtureBackup, deviceAuthorizationPrompt, refuseNativeOperation, waitForNativePublicSession } from '../ui/operationAuthentication';

const RECIPIENT = '0x3333333333333333333333333333333333333333';
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const recipient = (page: Page) => page.getByRole('textbox', { name: /^(Recipient|Ethereum|Base|Bitcoin|Syscoin) address$/ });
const amount = (page: Page, symbol = 'ETH') => page.getByRole('textbox', { name: `Amount in ${symbol}`, exact: true });
const backup = (page: Page) => button(page, /^Back up now$/i);

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== origin) {
      await route.abort();
      throw Error('Unexpected external request in public send draft');
    }
    await route.continue();
  });
});

async function openWallet(page: Page, query = 'public-send-fixture', accountId = 'hd:60:0') {
  await page.addInitScript(id => localStorage.setItem('pali-public-selection-fixture-v1', JSON.stringify({ kind: 'hd', id })), accountId);
  await page.goto(`/?backup-required&android&${query}`);
  await waitForNativePublicSession(page);
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('backup-required');
}

async function noPreparation(page: Page) {
  expect(await page.evaluate(() => {
    const value = window.__watchFixture.audit();
    return { prepares: value.transferPrepares, fees: value.transferFeeReads, utxo: value.utxoOpens,
      saved: value.utxoSavedReads, signs: value.signs, broadcasts: value.broadcasts, keys: value.keyReads };
  })).toEqual({ prepares: 0, fees: 0, utxo: 0, saved: 0, signs: 0, broadcasts: 0, keys: 0 });
}

async function openEvmDraft(page: Page, network = 'Ethereum') {
  await button(page, 'Send').click();
  await expect(heading(page, 'Send from')).toBeVisible();
  await page.getByRole('radio', { name: `${network}, ETH`, exact: true }).click();
  await expect(heading(page, 'Send ETH')).toBeVisible();
  await recipient(page).fill(RECIPIENT);
  await amount(page).fill('0.125');
}

async function openBackupFromDraft(page: Page) {
  await backup(page).click();
  await expect(heading(page, 'Wallet Backup')).toBeVisible();
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
}

test('unbacked All networks opens the source picker and preserves the public draft through Later and Back', async ({ page }) => {
  await openWallet(page);
  await expect(button(page, 'Choose network filter, All networks')).toBeVisible();
  await openEvmDraft(page, 'Base');
  await expect(page.getByText('Account 1 · Base', { exact: true })).toBeVisible();
  await expect(button(page, /^Network Fee/)).toBeDisabled();
  await expect(button(page, 'MAX')).toBeDisabled();
  await button(page, 'Advanced options').click();
  await page.getByRole('textbox', { name: 'Transaction nonce', exact: true }).fill('3');
  await noPreparation(page);
  for (const exit of ['Do It Later', 'Back']) {
    await openBackupFromDraft(page);
    await button(page, exit).click();
    await expect(heading(page, 'Send ETH')).toBeVisible();
    await expect(recipient(page)).toHaveValue(RECIPIENT);
    await expect(amount(page)).toHaveValue('0.125');
    await expect(page.getByRole('textbox', { name: 'Transaction nonce', exact: true })).toHaveValue('3');
    expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('backup-required');
    await noPreparation(page);
  }
  await button(page, 'Back').click();
  await expect(button(page, 'Send')).toBeVisible();
  await button(page, 'Send').click();
  await page.getByRole('radio', { name: 'Base, ETH', exact: true }).click();
  await expect(recipient(page)).toHaveValue('');
  await expect(amount(page)).toHaveValue('');
  await noPreparation(page);
});

test('completed backup restores the draft but waits for a fresh explicit Review before preparing', async ({ page }) => {
  await openWallet(page);
  await openEvmDraft(page);
  await openBackupFromDraft(page);
  await backup(page).click();
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  await authenticateNativeOperation(page);
  await confirmFixtureBackup(page);
  await expect(page.getByText('Backup complete', { exact: true })).toBeVisible();
  await button(page, 'Done').click();
  await expect(heading(page, 'Send ETH')).toBeVisible();
  await expect(recipient(page)).toHaveValue(RECIPIENT);
  await expect(amount(page)).toHaveValue('0.125');
  await expect(page.getByTestId('native-send-review')).toBeVisible();
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('ready');
  await noPreparation(page);
  await page.getByTestId('native-send-review').click();
  await expect(heading(page, 'Review transfer')).toBeVisible();
  expect((await page.evaluate(() => window.__watchFixture.audit())).transferPrepares).toBe(1);
  expect((await page.evaluate(() => window.__watchFixture.audit())).signs).toBe(0);
  await expect(deviceAuthorizationPrompt(page)).toHaveCount(0);
});

test('refusing backup authorization preserves the draft without preparing or signing it', async ({ page }) => {
  await openWallet(page);
  await openEvmDraft(page);
  await openBackupFromDraft(page);
  await backup(page).click();
  await expect(deviceAuthorizationPrompt(page)).toBeVisible();
  await refuseNativeOperation(page);
  await expect(heading(page, 'Wallet Backup')).toBeVisible();
  await button(page, 'Do It Later').click();
  await expect(recipient(page)).toHaveValue(RECIPIENT);
  await expect(amount(page)).toHaveValue('0.125');
  expect(await page.evaluate(() => window.__watchFixture.nativePhase())).toBe('backup-required');
  await noPreparation(page);
});

for (const change of ['blur', 'network', 'lock'] as const) test(`a ${change} discards an outstanding backup return instead of restoring a stale destination`, async ({ page }) => {
  await openWallet(page);
  await openEvmDraft(page);
  await openBackupFromDraft(page);
  if (change === 'blur') {
    await page.evaluate(() => window.__watchFixture.blur());
    await page.evaluate(() => window.__watchFixture.focus());
    await waitForNativePublicSession(page);
  } else if (change === 'network') {
    await page.evaluate(() => window.__watchFixture.selectNativeNetwork('base'));
    if (await button(page, 'Do It Later').isVisible()) await button(page, 'Do It Later').click();
  } else {
    await page.evaluate(() => window.__watchFixture.notes.lockAuthority());
    await waitForNativePublicSession(page);
  }
  await expect(recipient(page)).toHaveCount(0);
  await expect(heading(page, 'Wallet Backup')).toHaveCount(0);
  await expect(page.getByTestId('native-send-review')).toHaveCount(0);
  await noPreparation(page);
});

test('a different account after backup cannot inherit the previous public draft', async ({ page }) => {
  await openWallet(page);
  await openEvmDraft(page);
  await openBackupFromDraft(page);
  await backup(page).click();
  await authenticateNativeOperation(page);
  await confirmFixtureBackup(page);
  await expect(page.getByText('Backup complete', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__watchFixture.selectAccount('hd:60:1'));
  if (await button(page, 'Done').isVisible()) await button(page, 'Done').click();
  await expect(recipient(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__watchFixture.catalogue().active.accountId)).toBe('hd:60:1');
  await noPreparation(page);
});

for (const network of ['bitcoin', 'syscoin'] as const) test(`unbacked ${network} draft does not open a signer or saved-transfer reader`, async ({ page }) => {
  const syscoin = network === 'syscoin';
  await openWallet(page, syscoin ? 'sysx-utxo-send' : 'hd-utxo-send', syscoin ? 'hd:57:0' : 'hd:0:0');
  const symbol = syscoin ? 'SYSX' : 'BTC';
  if (syscoin) await button(page, /^SYSX(?:\s|$)/).click();
  await button(page, 'Send').click();
  await expect(heading(page, `Send ${symbol}`)).toBeVisible();
  await recipient(page).fill(syscoin ? await page.evaluate(() => window.__watchFixture.sysx.recipient) : 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  await amount(page, symbol).fill(syscoin ? '0.12345678' : '0.001');
  await noPreparation(page);
  await openBackupFromDraft(page);
  await button(page, 'Do It Later').click();
  await expect(amount(page, symbol)).toHaveValue(syscoin ? '0.12345678' : '0.001');
  await noPreparation(page);
  if (syscoin) expect(await page.evaluate(() => window.__watchFixture.sysx.audit().prepares)).toBe(0);
});
