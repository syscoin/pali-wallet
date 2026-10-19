import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'OWN1155';
const TOKEN_ID = '7';

for (const quantity of ['42', '9007199254740993']) {
  test(`owned ERC1155 import retains quantity ${quantity} through reload and Send MAX`, async ({}, info) => {
    test.setTimeout(120_000);
    const before = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const discoveries: string[] = [];
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'OwnedNftSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch('owned-nft-import-quantity', {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api?**',
        async (route) => {
          const url = new URL(route.request().url());
          if (
            route.request().method() !== 'GET' ||
            url.searchParams.get('module') !== 'account' ||
            url.searchParams.get('action') !== 'tokenlist' ||
            url.searchParams.get('address')?.toLowerCase() !==
              fixture.evmAddresses[0].toLowerCase()
          )
            return route.fallback();
          discoveries.push(quantity);
          // Raw synthetic explorer data only: the real background discovery,
          // import, persistence and Send code must carry its exact quantity.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: '1',
              result: [
                {
                  contractAddress: CONTRACT,
                  type: 'ERC-1155',
                  id: TOKEN_ID,
                  name: 'Synthetic owned editions',
                  symbol: SYMBOL,
                  decimals: '0',
                  balance: quantity,
                },
              ],
            }),
          });
        }
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet.ensureOnHome();
      const page = wallet.page;
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.home.importToken, exact: true })
        .click();
      await page
        .getByRole('button', { name: en.tokens.yourTokens, exact: true })
        .click();
      const importToken = page.getByRole('button', {
        name: `Import ${SYMBOL} token`,
        exact: true,
      });
      await expect(importToken).toBeEnabled();
      expect(discoveries).toContain(quantity);
      await importToken.click();
      const saved = () =>
        page.evaluate(async (contract) => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const { id, type } = state.vault.activeAccount;
          const token = state.vault.accountAssets[type]?.[id]?.ethereum.find(
            (entry: any) =>
              entry.contractAddress.toLowerCase() === contract &&
              entry.tokenId === '7'
          );
          return token
            ? { balance: token.balance, rawBalance: token.rawBalance }
            : null;
        }, CONTRACT);
      await expect.poll(saved).toMatchObject({ balance: Number(quantity) });
      await info.attach('real-imported-quantity', {
        contentType: 'application/json',
        body: JSON.stringify({ quantity, saved: await saved(), discoveries }),
      });
      // Do not supply contract balances to repair the explorer result later.
      // Healthy small quantities remain usable through the numeric fallback;
      // quantities beyond Number precision require the exact stored string.
      await wallet.gotoRoute('#/send/eth');
      await page.getByRole('button', { name: 'TSYS', exact: true }).click();
      await page
        .locator('button[role="menuitem"]')
        .filter({ hasText: SYMBOL })
        .click();
      const max = page.getByRole('button', { name: 'MAX', exact: true });
      await expect(max).toBeEnabled();
      await max.click();
      await expect(page.locator('#with-max-button')).toHaveValue(quantity);
      if (!Number.isSafeInteger(Number(quantity)))
        await expect.poll(saved).toMatchObject({ rawBalance: quantity });
      await page.reload();
      await wallet.waitAppReady();
      await expect.poll(saved).toMatchObject({ balance: Number(quantity) });
      if (!Number.isSafeInteger(Number(quantity)))
        await expect.poll(saved).toMatchObject({ rawBalance: quantity });
      const native = page.getByRole('button', { name: 'TSYS', exact: true });
      const selected = page.getByRole('button', {
        name: SYMBOL,
        exact: true,
      });
      await expect(native.or(selected)).toBeVisible();
      // Re-enter through the ordinary asset picker, not the saved draft's
      // ownership refresh (contract reads are intentionally unavailable).
      await native.or(selected).click();
      await page
        .locator('button[role="menuitem"]')
        .filter({ hasText: SYMBOL })
        .click();
      await expect(max).toBeEnabled();
      await max.click();
      await expect(page.locator('#with-max-button')).toHaveValue(quantity);
      await info.attach('owned-quantity-max', {
        contentType: 'image/png',
        body: await page.screenshot({ animations: 'disabled' }),
      });
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, before);
      }
    }
  });
}
