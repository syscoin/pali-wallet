import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Ordinary UI and public synthetic read fixtures. No
// controller/store replacement, signing, exports, or public network forwarding.
test('currency quotes keep their denomination and custom RPC drafts survive header detours', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'QA123SettingsSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const tickerReads: string[] = [];
  const capture = async (page: Page, label: string) => {
    const file = info.outputPath(`${label}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    await info.attach(label, { path: file, contentType: 'image/png' });
  };
  try {
    wallet = await PaliWallet.launch('settings-draft-navigation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture('1000000000'),
      server.url
    );
    await wallet.context.route('**/api/v2/tickers/currency', async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() !== 'GET' ||
        url.pathname !== '/api/v2/tickers/currency' ||
        ![
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin)
      )
        return route.fallback();
      tickerReads.push(url.href);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ts: 1, rates: { usd: 1, eur: 2 } }),
      });
    });
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    const page = wallet.page;
    await wallet.step(
      'compare saved currency and unsaved preview',
      async () => {
        await wallet!.gotoRoute('#/settings/currency');
        const trigger = page.getByRole('button', {
          name: en.settings.setYourPreferred,
          exact: true,
        });
        await expect(trigger).toContainText('USD');
        const balanceCard = page
          .getByText(en.components.currentBalance, { exact: true })
          .locator('..');
        await expect(balanceCard).toContainText('$10');
        observations.usdCard = await balanceCard.innerText();
        await capture(page, 'currency-saved-usd');
        await trigger.click();
        await page
          .getByRole('textbox', { name: en.settings.searchCurrencies })
          .fill('eur');
        await page.getByRole('button', { name: /EUR/ }).click();
        await expect(trigger).toContainText('EUR');
        await expect(
          page.getByText(en.settings.saveToUpdateRate, { exact: true })
        ).toBeVisible();
        await expect(balanceCard).toContainText('$10 USD');
        await expect(balanceCard).toContainText('🇺🇸');
        await expect(balanceCard).not.toContainText('€10 EUR');
        observations.unsavedEurCard = await balanceCard.innerText();
        await capture(page, 'currency-unsaved-eur');
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(
          page.getByText(en.settings.fiatCurrencySetSuccessfully, {
            exact: true,
          })
        ).toBeVisible();
        await page.keyboard.press('Escape');
        // Closing the success dialog returns to Home in a React transition.
        // Let that navigation finish before starting a new document/route.
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(
          page.getByText(en.settings.fiatCurrencySetSuccessfully, {
            exact: true,
          })
        ).toBeHidden();
        await wallet!.gotoRoute('#/settings/currency');
        await expect(page).toHaveURL(/#\/settings\/currency$/);
        await expect(trigger).toContainText('EUR');
        await expect(balanceCard).toContainText('€20');
        await expect(balanceCard).toContainText('🇪🇺');
        observations.savedEurCard = await balanceCard.innerText();
        await capture(page, 'currency-saved-eur');
      }
    );
    await wallet.step(
      'public custom RPC draft through connected-sites detour',
      async () => {
        await wallet!.gotoRoute('#/settings/networks/custom-rpc');
        const label = page.getByRole('combobox', {
          name: en.settings.label,
          exact: true,
        });
        await expect(label).toBeVisible();
        await label.fill('QA123 Public Draft');
        await page.locator('#rpc_chainId').fill('424242');
        await page.locator('#rpc_symbol').fill('QA');
        await page
          .locator('#rpc_explorer')
          .fill('https://qa123-explorer.invalid/');
        const readDraft = async () => ({
          label: await label.inputValue(),
          chainId: await page.locator('#rpc_chainId').inputValue(),
          symbol: await page.locator('#rpc_symbol').inputValue(),
          explorer: await page.locator('#rpc_explorer').inputValue(),
        });
        observations.draftBefore = await readDraft();
        await capture(page, 'custom-rpc-before-detour');
        await page
          .getByRole('button', {
            name: en.settings.connectedSites,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/connected-sites$/);
        await page
          .getByRole('button', { name: en.buttons.close, exact: true })
          .last()
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(label).toBeVisible();
        observations.draftAfter = await readDraft();
        await capture(page, 'custom-rpc-after-detour');
        expect(
          observations.draftAfter,
          'An ordinary header detour should preserve the public network draft'
        ).toEqual(observations.draftBefore);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(tickerReads.length).toBeGreaterThan(0);
    observations.runtime = {
      ...extensionEvidence(),
      deniedWrites: routes.deniedWrites,
      tickerReads,
      controllerStateReplaced: false,
      publicSyntheticOnly: true,
    };
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    await info.attach('settings-draft-observations', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
