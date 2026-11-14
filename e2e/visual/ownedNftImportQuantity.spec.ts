import { expect, test } from '@playwright/test';
import { Interface } from 'ethers';

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

for (const quantity of [
  '0',
  '42',
  '9007199254740993',
  '115792089237316195423570985008687907853269984665640564039457584007913129639935',
]) {
  test(`owned ERC1155 import retains quantity ${quantity} through the list, collection details, reload and Send MAX`, async ({}, info) => {
    test.setTimeout(120_000);
    const before = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const discoveries: string[] = [];
    const ownershipReads: { ids: string[]; quantity: string }[] = [];
    let currentQuantity = quantity;
    const nft = new Interface([
      'function supportsInterface(bytes4) view returns (bool)',
      'function balanceOf(address,uint256) view returns (uint256)',
      'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
    ]);
    Object.assign(E2E_CONFIG, {
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'OwnedNftSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(
        `owned-nft-import-quantity-${quantity}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      // The explorer supplies discovery metadata; Send independently verifies
      // ownership through the real controller and shared contract reader.
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const rpc = route.request().postDataJSON();
        const calls = Array.isArray(rpc) ? rpc : [rpc];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
              call?.method || ''
            )
          )
        ) {
          routes.deniedWrites.push('attempted-write-or-sign');
          return route.abort('blockedbyclient');
        }
        if (
          !calls.some(
            (call: any) =>
              ['eth_call', 'eth_getCode'].includes(call?.method) &&
              (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() ===
                CONTRACT
          )
        )
          return route.fallback();
        const replies = calls.map((call: any) => {
          let result: unknown;
          const target = (
            call.params?.[0]?.to || call.params?.[0]
          )?.toLowerCase();
          if (call.method === 'eth_chainId') result = '0x1644';
          if (target === CONTRACT && call.method === 'eth_getCode')
            result = '0x60006000fd';
          if (target === CONTRACT && call.method === 'eth_call') {
            const decoded = nft.parseTransaction({ data: call.params[0].data });
            if (decoded?.name === 'supportsInterface')
              result = nft.encodeFunctionResult(decoded.fragment, [
                ['0xd9b67a26', '0x01ffc9a7'].includes(decoded.args[0]),
              ]);
            if (
              decoded?.name === 'balanceOf' ||
              decoded?.name === 'balanceOfBatch'
            ) {
              const owners =
                decoded.name === 'balanceOf'
                  ? [decoded.args[0]]
                  : Array.from(decoded.args[0]);
              const ids = (
                decoded.name === 'balanceOf'
                  ? [decoded.args[1]]
                  : Array.from(decoded.args[1])
              ).map(String);
              if (
                owners.length === ids.length &&
                owners.every(
                  (owner: any) =>
                    owner.toLowerCase() ===
                    fixture.evmAddresses[0].toLowerCase()
                )
              ) {
                ownershipReads.push({ ids, quantity: currentQuantity });
                const balances = ids.map((id) =>
                  id === TOKEN_ID ? currentQuantity : '0'
                );
                result = nft.encodeFunctionResult(decoded.fragment, [
                  decoded.name === 'balanceOf' ? balances[0] : balances,
                ]);
              }
            }
          }
          return result === undefined
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: {
                  code: -32000,
                  message: 'Unsupported synthetic contract read',
                },
              }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
        });
      });
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
      await wallet.ensureOnHome();
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
        .click();
      const viewCollection = page.getByRole('button', {
        name: `View details for ${SYMBOL} collection`,
        exact: true,
      });
      const collection = page.locator('li').filter({ has: viewCollection });
      const listQuantity = collection.locator(`span[title="${quantity}"]`);
      const visibleQuantity =
        quantity.length > 20
          ? '1.16e77'
          : quantity.length > 15
          ? '9.01e15'
          : quantity;
      await expect(listQuantity).toHaveAttribute('title', quantity);
      for (const width of [320, 400]) {
        await page.setViewportSize({ width, height: 360 });
        await listQuantity.scrollIntoViewIfNeeded();
        await expect(listQuantity).toBeInViewport();
        await expect(listQuantity).toContainText(visibleQuantity);
        expect(
          await listQuantity.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              left: bounds.left >= 0,
              right: bounds.right <= window.innerWidth,
              fits: element.scrollWidth <= element.clientWidth,
            };
          })
        ).toEqual({ left: true, right: true, fits: true });
        await info.attach(`list-quantity-${width}`, {
          contentType: 'image/png',
          body: await page.screenshot({ animations: 'disabled' }),
        });
      }
      await page.setViewportSize({ width: 400, height: 620 });
      await viewCollection.click();
      await page
        .locator('[data-navigation-scroll="asset-details"]')
        .getByRole('button', {
          name: en.send.viewCollectionItems,
          exact: true,
        })
        .click();
      const header = page.getByText(/• ERC-1155$/);
      const amount = page.getByText('Amount', { exact: true }).locator('..');
      await expect(header).toHaveAttribute('title', quantity);
      await expect(amount).toHaveAttribute('title', quantity);
      for (const width of [320, 400]) {
        await page.setViewportSize({ width, height: 360 });
        for (const [label, value] of [
          ['header', header],
          ['amount', amount],
        ] as const) {
          await value.scrollIntoViewIfNeeded();
          await expect(value).toBeInViewport();
          await expect(value).toContainText(visibleQuantity);
          expect(
            await value.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                left: bounds.left >= 0,
                right: bounds.right <= window.innerWidth,
                fits: element.scrollWidth <= element.clientWidth,
              };
            })
          ).toEqual({ left: true, right: true, fits: true });
          await info.attach(`collection-quantity-${width}-${label}`, {
            contentType: 'image/png',
            body: await page.screenshot({ animations: 'disabled' }),
          });
        }
      }
      await page.setViewportSize({ width: 400, height: 620 });
      const readsBeforeSend = ownershipReads.length;
      await wallet.gotoRoute('#/send/eth');
      await page.getByRole('button', { name: 'TSYS', exact: true }).click();
      await page
        .locator('button[role="menuitem"]')
        .filter({ hasText: SYMBOL })
        .click();
      const max = page.getByRole('button', { name: 'MAX', exact: true });
      await expect
        .poll(() =>
          ownershipReads
            .slice(readsBeforeSend)
            .some(
              (read) =>
                read.ids.includes(TOKEN_ID) && read.quantity === quantity
            )
        )
        .toBe(true);
      await expect(page.locator('#with-max-button')).toHaveAttribute(
        'max',
        quantity
      );
      if (quantity === '0') {
        await expect(max).toBeDisabled();
        await expect(page.locator('#with-max-button')).toHaveValue('1');
      } else {
        await expect(max).toBeEnabled();
        await max.click();
        await expect(page.locator('#with-max-button')).toHaveValue(quantity);
      }
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
      // Keep the saved explorer quantity unchanged, but make the fresh chain
      // read smaller. Re-selection must use that current balance for MAX.
      currentQuantity =
        quantity === '0' ? '0' : (BigInt(quantity) - BigInt(1)).toString();
      const readsBeforeReselect = ownershipReads.length;
      await native.or(selected).click();
      await page
        .locator('button[role="menuitem"]')
        .filter({ hasText: SYMBOL })
        .click();
      await expect
        .poll(() =>
          ownershipReads
            .slice(readsBeforeReselect)
            .some(
              (read) =>
                read.ids.includes(TOKEN_ID) && read.quantity === currentQuantity
            )
        )
        .toBe(true);
      await expect(page.locator('#with-max-button')).toHaveAttribute(
        'max',
        currentQuantity
      );
      if (currentQuantity === '0') {
        await expect(max).toBeDisabled();
        await expect(page.locator('#with-max-button')).toHaveValue('1');
      } else {
        await expect(max).toBeEnabled();
        await max.click();
        await expect(page.locator('#with-max-button')).toHaveValue(
          currentQuantity
        );
      }
      await info.attach('fresh-ownership-reads', {
        contentType: 'application/json',
        body: JSON.stringify({
          importedQuantity: quantity,
          currentQuantity,
          ownershipReads,
        }),
      });
      await info.attach('owned-quantity-max', {
        contentType: 'image/png',
        body: await page.screenshot({ animations: 'disabled' }),
      });
      expect(routes.deniedWrites).toEqual([]);
      status = info.errors.length === 0 ? 'passed' : 'failed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, before);
        }
      }
    }
  });
}
