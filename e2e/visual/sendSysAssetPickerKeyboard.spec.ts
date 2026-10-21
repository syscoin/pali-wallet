import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createSptFixture,
  installSptFixtureRoutes,
  SPT_BALANCE,
  SPT_SYMBOL,
} from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tabTo = async (page: Page, target: Locator) => {
  for (let index = 0; index < 40; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const activeItem = async (menu: Locator, item: Locator) => {
  const activeId = await menu.getAttribute('aria-activedescendant');
  return Boolean(activeId) && activeId === (await item.getAttribute('id'));
};

test('UTXO asset picker keyboard selects native and SPT buttons and skips its closed menu', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceHash = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createSptFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'UtxoPickerSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installSptFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let nativeBalance = '';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('utxo-asset-picker-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installSptFixtureRoutes(wallet.context, fixture, server.url);
    const page = wallet.page;
    const menu = page.getByRole('menu');
    const amount = page.locator('#with-max-button');
    const max = page.getByRole('button', { name: 'MAX', exact: true });
    const picker = (symbol: string) =>
      page
        .getByRole('button', { name: symbol, exact: true })
        .and(page.locator('[aria-haspopup="menu"]'));
    const item = (symbol: string) =>
      menu.getByRole('menuitem').filter({ hasText: symbol });

    await wallet.step(
      'discover and import the synthetic SPT through ordinary UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('0.001');
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        const importToken = page.getByRole('button', {
          name: `Import ${SPT_SYMBOL} token`,
          exact: true,
        });
        await importToken.click();
        await expect(importToken).toBeDisabled();
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
        nativeBalance = await page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const active = state.vault.activeAccount;
          return String(
            state.vault.accounts[active.type][active.id].balances.syscoin
          );
        });
        // Independent fixture amount plus exact real controller formatting.
        expect(nativeBalance).toMatch(/^0\.0010*$/);
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await expect(picker('tsys')).toBeVisible();
        await expect(menu).toHaveCount(0);
        await max.click();
        await expect(amount).toHaveValue(nativeBalance);
        observations.nativeMax = await amount.inputValue();
      }
    );

    await wallet.step(
      'Home and ArrowDown reach actionable buttons before Enter selects the SPT',
      async (capture) => {
        await page.mouse.move(0, 0);
        await tabTo(page, picker('tsys'));
        await page.keyboard.press('ArrowDown');
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(2);
        await page.keyboard.press('Home');
        await expect.poll(() => activeItem(menu, item('TSYS'))).toBe(true);
        expect(await item('TSYS').evaluate((node) => node.tagName)).toBe(
          'BUTTON'
        );
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => activeItem(menu, item(SPT_SYMBOL))).toBe(true);
        expect(await item(SPT_SYMBOL).evaluate((node) => node.tagName)).toBe(
          'BUTTON'
        );
        await page.keyboard.press('Enter');
        await expect(picker(SPT_SYMBOL)).toBeVisible();
        await expect(menu).toHaveCount(0);
        await max.click();
        await expect(amount).toHaveValue(SPT_BALANCE);
        observations.enterSptMax = await amount.inputValue();
        await capture(page);
      }
    );

    await wallet.step(
      'Space activates native and SPT choices without losing exact MAX values',
      async () => {
        await tabTo(page, picker(SPT_SYMBOL));
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Home');
        await expect.poll(() => activeItem(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('Space');
        await expect(picker('tsys')).toBeVisible();
        await max.click();
        await expect(amount).toHaveValue(nativeBalance);
        await tabTo(page, picker('tsys'));
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => activeItem(menu, item(SPT_SYMBOL))).toBe(true);
        await page.keyboard.press('Space');
        await expect(picker(SPT_SYMBOL)).toBeVisible();
        await max.click();
        await expect(amount).toHaveValue(SPT_BALANCE);
        observations.spaceSptMax = await amount.inputValue();
      }
    );

    await wallet.step(
      'Escape preserves the SPT and Tab bypasses the closed menu to MAX',
      async () => {
        const current = picker(SPT_SYMBOL);
        await tabTo(page, current);
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Home');
        await expect.poll(() => activeItem(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(current).toBeFocused();
        await expect(menu).toHaveCount(0);
        await expect(amount).toHaveValue(SPT_BALANCE);
        await page.keyboard.press('Tab');
        await expect(max).toBeFocused();
        await expect(page).toHaveURL(/#\/send\/sys$/);
      }
    );

    await wallet.step(
      'ordinary pointer selection still switches native and SPT assets',
      async (capture) => {
        await picker(SPT_SYMBOL).click();
        await item('TSYS').click();
        await expect(picker('tsys')).toBeVisible();
        await max.click();
        await expect(amount).toHaveValue(nativeBalance);
        await picker('tsys').click();
        await item(SPT_SYMBOL).click();
        await expect(picker(SPT_SYMBOL)).toBeVisible();
        await max.click();
        await expect(amount).toHaveValue(SPT_BALANCE);
        await expect(page).toHaveURL(/#\/send\/sys$/);
        expect(
          wallet!.context
            .pages()
            .some((candidate) => candidate.url().includes('/external'))
        ).toBe(false);
        await capture(page);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceHash);
    status = 'passed';
  } finally {
    try {
      await info.attach('utxo-picker-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceHash,
          observations,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultReplaced: false,
          nextOrConfirmClicked: false,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
