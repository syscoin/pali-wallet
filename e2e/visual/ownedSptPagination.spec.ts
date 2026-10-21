import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_PATH,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const TOTAL = 75;
const LAST_GUID = '123575';
const LAST_SYMBOL = 'SPT75';

async function savedTokenProjection(page: Page) {
  return page.evaluate(async (guid) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { id, type } = state.vault.activeAccount;
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const records = await chrome.storage.local.get(storageKey);
    // Inspect only public asset metadata, never the vault or key material.
    const token = (assets: any) => {
      const value = assets?.[type]?.[id]?.syscoin?.find(
        (entry: any) => String(entry.assetGuid) === guid
      );
      return value
        ? {
            assetGuid: String(value.assetGuid),
            symbol: value.symbol,
            balance: value.balance,
            decimals: value.decimals,
            chainId: value.chainId,
          }
        : null;
    };
    return {
      account: { id, type },
      chainId: state.vault.activeNetwork.chainId,
      live: token(state.vault.accountAssets),
      saved: token(records[storageKey]?.accountAssets),
    };
  }, LAST_GUID);
}

async function discoveryProjection(page: Page) {
  return page.evaluate(() => (window as any).__ownedSptDiscovery.snapshot());
}

test('owned SPT pagination reveals every asset locally and imports the last one durably', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OwnedSptPaginationSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const accountReads: {
    details: string;
    endpoint: string;
    rows: number;
    tokens: string;
  }[] = [];
  const assetReads: string[] = [];
  const observations: Record<string, unknown> = {};
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  try {
    wallet = await PaliWallet.launch('owned-spt-pagination', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('**/api/v2/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (/^\/api\/v2\/asset\//.test(url.pathname))
        assetReads.push(url.pathname);
      const base = sptFixtureRead(
        fixture.utxo,
        request.url(),
        request.method()
      );
      if (
        !/^\/api\/v2\/(?:xpub|address)\//.test(url.pathname) ||
        !base ||
        typeof base !== 'object' ||
        !Array.isArray((base as any).tokensAsset)
      )
        return route.fallback();
      if (
        url.searchParams.get('details') === 'tokenBalances' &&
        url.searchParams.get('tokens') === 'nonzero'
      )
        accountReads.push({
          endpoint: url.pathname.split('/')[3],
          details: 'tokenBalances',
          tokens: 'nonzero',
          rows: TOTAL,
        });
      // Replace only allowlisted synthetic HTTP account balances. The real
      // controller aggregates, caches, paginates and persists these assets.
      const tokensAsset = Array.from({ length: TOTAL }, (_, offset) => ({
        assetGuid: String(123501 + offset),
        symbol: `SPT${offset + 1}`,
        name: `Synthetic owned SPT ${offset + 1}`,
        type: 'SPTAllocated',
        decimals: 8,
        maxSupply: '18446744073709551615',
        balance: '100000000',
        unconfirmedBalance: '0',
        totalReceived: '100000000',
        totalSent: '0',
        transfers: 1,
        path: UTXO_FIXTURE_PATH,
      }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ...base, tokensAsset }),
      });
    });
    const page = wallet.page;
    const imports = page.getByRole('button', {
      name: /^Import SPT\d+ token$/,
    });
    const lastImport = page.getByRole('button', {
      name: `Import ${LAST_SYMBOL} token`,
      exact: true,
    });
    const openOwnedTokens = async () => {
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.home.importToken, exact: true })
        .click();
      await page
        .getByRole('button', { name: en.tokens.yourTokens, exact: true })
        .click();
    };
    await wallet.step(
      'prepare a fenced wallet with seventy-five owned SPTs',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        expect(await savedTokenProjection(page)).toEqual({
          account: { id: 0, type: 'HDAccount' },
          chainId: 5700,
          live: null,
          saved: null,
        });
        await page.evaluate(() => {
          const original = chrome.runtime.sendMessage;
          const calls: {
            error: boolean;
            received: boolean;
            resultCount: number | null;
          }[] = [];
          // Observe the actual discovery request and its unchanged response.
          // Native-balance polling shares the same Blockbook URL, so raw HTTP
          // counts cannot attribute a request to the owned-token tab.
          (chrome.runtime.sendMessage as any) = (...args: any[]) => {
            const [message, callback] = args;
            if (
              message?.type === 'CONTROLLER_ACTION' &&
              JSON.stringify(message.data?.methods) ===
                JSON.stringify(['wallet', 'getUserOwnedTokens']) &&
              typeof callback === 'function'
            ) {
              const call = {
                resultCount: null as number | null,
                error: false,
                received: false,
              };
              calls.push(call);
              args[1] = (response: any) => {
                call.received = true;
                call.resultCount = Array.isArray(response)
                  ? response.length
                  : null;
                call.error = !!chrome.runtime.lastError || !!response?.error;
                callback(response);
              };
            }
            return (original as any).apply(chrome.runtime, args);
          };
          (window as any).__ownedSptDiscovery = {
            snapshot: () => calls.map((call) => ({ ...call })),
            restore: () => {
              chrome.runtime.sendMessage = original;
            },
          };
        });
      }
    );
    await wallet.step(
      'show the first fifty owned SPTs from one complete discovery response',
      async () => {
        await openOwnedTokens();
        await expect(imports).toHaveCount(50);
        await expect(lastImport).toHaveCount(0);
        await expect(
          page.getByRole('button', {
            name: `${en.buttons.loadMore} (50/75)`,
            exact: true,
          })
        ).toBeEnabled();
        expect(await discoveryProjection(page)).toEqual([
          { resultCount: TOTAL, error: false, received: true },
        ]);
        expect(assetReads).toEqual([]);
        observations.initialVisible = 50;
        observations.initialDiscovery = await discoveryProjection(page);
        observations.initialAccountHttpReads = accountReads.length;
      }
    );
    await wallet.step(
      'reveal the last twenty-five SPTs without another discovery request',
      async () => {
        await page
          .getByRole('button', {
            name: `${en.buttons.loadMore} (50/75)`,
            exact: true,
          })
          .click();
        await expect(imports).toHaveCount(TOTAL);
        await expect(lastImport).toBeEnabled();
        await expect(
          page.getByRole('button', {
            name: new RegExp(`^${en.buttons.loadMore} \\(`),
          })
        ).toHaveCount(0);
        expect(await discoveryProjection(page)).toEqual(
          observations.initialDiscovery
        );
        expect(assetReads).toEqual([]);
        observations.expandedVisible = TOTAL;
        observations.expandedAccountHttpReads = accountReads.length;
      }
    );
    await wallet.step(
      'import the seventy-fifth SPT through the real durable controller operation',
      async () => {
        await lastImport.click();
        await expect(lastImport).toBeDisabled();
        await expect
          .poll(() => savedTokenProjection(page))
          .toEqual({
            account: { id: 0, type: 'HDAccount' },
            chainId: 5700,
            live: {
              assetGuid: LAST_GUID,
              symbol: LAST_SYMBOL,
              balance: '1.0',
              decimals: 8,
              chainId: 5700,
            },
            saved: {
              assetGuid: LAST_GUID,
              symbol: LAST_SYMBOL,
              balance: '1.0',
              decimals: 8,
              chainId: 5700,
            },
          });
        observations.saved = await savedTokenProjection(page);
        expect(await discoveryProjection(page)).toEqual(
          observations.initialDiscovery
        );
        expect(assetReads).toEqual([]);
      }
    );
    await wallet.step(
      'reopen the ordinary owned tab with the saved asset excluded and the complete inventory retained',
      async () => {
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        await expect(
          page.getByText(LAST_SYMBOL, { exact: true })
        ).toBeVisible();
        await openOwnedTokens();
        await expect(imports).toHaveCount(50);
        await page
          .getByRole('button', {
            name: `${en.buttons.loadMore} (50/74)`,
            exact: true,
          })
          .click();
        await expect(imports).toHaveCount(74);
        await expect(lastImport).toHaveCount(0);
        expect(await discoveryProjection(page)).toEqual([
          { resultCount: TOTAL, error: false, received: true },
          { resultCount: TOTAL, error: false, received: true },
        ]);
        expect(assetReads).toEqual([]);
        observations.reopenedVisible = 74;
        observations.reopened = await savedTokenProjection(page);
        observations.reopenedDiscovery = await discoveryProjection(page);
        expect(observations.reopened).toEqual(observations.saved);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('owned-spt-pagination-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: extensionEvidence(),
          sourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultReplaced: false,
          observations,
          accountHttpReads: accountReads,
          accountHttpReadsIncludeNativeBalancePolling: true,
          assetReads,
          deniedWrites: routes?.deniedWrites ?? [],
          fixtureReads: routes?.reads ?? [],
          proxyDeniedConnections: server.blocked.length,
        }),
      });
    } finally {
      try {
        if (wallet && !wallet.page.isClosed())
          await wallet.page
            .evaluate(() => (window as any).__ownedSptDiscovery?.restore())
            .catch(() => undefined);
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
