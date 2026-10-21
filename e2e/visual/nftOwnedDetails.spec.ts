import { expect, test, type Locator, type Page } from '@playwright/test';
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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'OWN1155';
const TOKEN_ID = '7';

const publicNftState = (page: Page) =>
  page.evaluate(
    async ({ contract, tokenId }) => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const slip44 = state.vaultGlobal.activeSlip44;
      if (!Number.isSafeInteger(slip44) || slip44 !== 60)
        throw new Error('Expected the current EVM vault');
      const storageKey = `state-vault-${slip44}`;
      const stored = await chrome.storage.local.get(storageKey);
      const { id, type } = state.vault.activeAccount;
      const project = (source: any) => {
        const token = source?.accountAssets?.[type]?.[id]?.ethereum?.find(
          (entry: any) =>
            entry.contractAddress?.toLowerCase() === contract &&
            entry.tokenId === tokenId &&
            entry.chainId === state.vault.activeNetwork.chainId
        );
        return token
          ? {
              balance: token.balance,
              contractAddress: token.contractAddress.toLowerCase(),
              isNft: token.isNft,
              rawBalance: token.rawBalance,
              tokenId: token.tokenId,
              tokenStandard: token.tokenStandard,
            }
          : null;
      };
      return {
        account: {
          address: state.vault.accounts[type][id].address,
          id,
          type,
        },
        network: {
          chainId: state.vault.activeNetwork.chainId,
          kind: state.vault.activeNetwork.kind,
          url: state.vault.activeNetwork.url,
        },
        live: project(state.vault),
        saved: project(stored[storageKey]),
        storageKey,
      };
    },
    { contract: CONTRACT, tokenId: TOKEN_ID }
  );

async function quantityEvidence(
  value: Locator,
  quantity: string,
  expectedText?: string
) {
  await expect(value).toHaveCount(1);
  await expect(value).toHaveAttribute('title', quantity);
  if (expectedText) await expect(value).toHaveText(expectedText);
  await value.scrollIntoViewIfNeeded();
  await expect(value).toBeInViewport();
  const result = await value.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim(),
      title: element.getAttribute('title'),
      viewport: { height: innerHeight, width: innerWidth },
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      fits: element.scrollWidth <= element.clientWidth,
    };
  });
  expect(result.viewport).toEqual({ height: 620, width: 400 });
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(400);
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThanOrEqual(620);
  expect(result.fits).toBe(true);
  return result;
}

for (const scenario of [
  { id: 'small', quantity: '42', compact: '42' },
  {
    id: 'max',
    quantity:
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    compact: '1.16e77',
  },
]) {
  test(`NFT details retain Owned quantity ${scenario.quantity} through collection Back and reopen`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const original = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const observations: Record<string, unknown> = {};
    const discoveries: Array<{ phase: string; url: string }> = [];
    const failedRequests: Array<{ method: string; url: string }> = [];
    const forbiddenRequests: string[] = [];
    let phase = 'import';
    let status: 'passed' | 'failed' = 'failed';
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    const wire = JSON.stringify({
      status: '1',
      result: [
        {
          contractAddress: CONTRACT,
          type: 'ERC-1155',
          id: TOKEN_ID,
          name: 'Synthetic owned editions',
          symbol: SYMBOL,
          decimals: '0',
          balance: scenario.quantity,
        },
      ],
    });
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'NftOwnedDetailsSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(`nft-owned-details-${scenario.id}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
      wallet.context.on('request', (request) => {
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          return;
        }
        for (const call of Array.isArray(payload) ? payload : [payload]) {
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
              call?.method || ''
            )
          )
            forbiddenRequests.push(call.method);
        }
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api?**',
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (
            request.method() !== 'GET' ||
            url.searchParams.get('module') !== 'account' ||
            url.searchParams.get('action') !== 'tokenlist' ||
            url.searchParams.get('address')?.toLowerCase() !==
              fixture.evmAddresses[0].toLowerCase()
          )
            return route.fallback();
          discoveries.push({ phase, url: request.url() });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: wire,
          });
        }
      );
      const page = wallet.page;
      let identity: Awaited<ReturnType<typeof publicNftState>> | undefined;
      const currentState = async () => {
        const current = await publicNftState(page);
        expect(identity).toBeDefined();
        expect(current.account).toEqual(identity!.account);
        expect(current.network).toEqual(identity!.network);
        expect(current.storageKey).toBe(identity!.storageKey);
        const expected = {
          balance: Number(scenario.quantity),
          contractAddress: CONTRACT,
          isNft: true,
          rawBalance: scenario.quantity,
          tokenId: TOKEN_ID,
          tokenStandard: 'ERC-1155',
        };
        expect(current.live).toEqual(expected);
        expect(current.saved).toEqual(expected);
        return current;
      };
      const viewCollection = page.getByRole('button', {
        name: `View details for ${SYMBOL} collection`,
        exact: true,
      });
      const openNftList = async () => {
        await page.locator('#assets-btn').click();
        if (!(await viewCollection.isVisible()))
          await page
            .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
            .click();
        await expect(viewCollection).toBeVisible();
      };
      const owned = () =>
        page
          .locator('[data-navigation-scroll="asset-details"]')
          .getByText('Owned', { exact: true })
          .locator('..')
          .locator('span[title]');
      await wallet.step(
        `nft-owned-${scenario.id}: import the exact public ERC1155 quantity through Your Tokens`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          identity = await publicNftState(page);
          expect(identity.network).toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
          });
          expect(identity.account.address.toLowerCase()).toBe(
            fixture.evmAddresses[0].toLowerCase()
          );
          expect(identity.live).toBeNull();
          expect(identity.saved).toBeNull();
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
          expect(discoveries.length).toBeGreaterThan(0);
          await importToken.click();
          await expect
            .poll(async () => (await publicNftState(page)).saved?.rawBalance)
            .toBe(scenario.quantity);
          observations.imported = await currentState();
        }
      );
      await wallet.step(
        `nft-owned-${scenario.id}: show the exact titled quantity in the ordinary NFT list`,
        async () => {
          phase = 'list';
          await page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home(?:\?|$)/);
          await openNftList();
          const row = page.locator('li').filter({ has: viewCollection });
          observations.list = {
            quantity: await quantityEvidence(
              row.locator(`span[title="${scenario.quantity}"]`),
              scenario.quantity,
              `${scenario.compact} ${en.nftDetails.items}`
            ),
            state: await currentState(),
          };
        }
      );
      await wallet.step(
        `nft-owned-${scenario.id}: open token details and preserve the visible Owned quantity`,
        async () => {
          phase = 'details';
          await viewCollection.click();
          await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
          observations.details = {
            quantity: await quantityEvidence(
              owned(),
              scenario.quantity,
              `${scenario.compact} NFTs`
            ),
            state: await currentState(),
          };
        }
      );
      await wallet.step(
        `nft-owned-${scenario.id}: use collection items and real AppLayout Back to restore Owned`,
        async (capture) => {
          phase = 'collection-back';
          await page
            .locator('[data-navigation-scroll="asset-details"]')
            .getByRole('button', {
              name: `eye ${en.send.viewCollectionItems}`,
              exact: true,
            })
            .click();
          const header = page.getByText(/• ERC-1155$/);
          observations.collection = {
            quantity: await quantityEvidence(
              header,
              scenario.quantity,
              `${scenario.compact} ${en.nftDetails.items} • ERC-1155`
            ),
            state: await currentState(),
          };
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          observations.returned = {
            quantity: await quantityEvidence(
              owned(),
              scenario.quantity,
              `${scenario.compact} NFTs`
            ),
            state: await currentState(),
          };
          await capture(page);
        }
      );
      await wallet.step(
        `nft-owned-${scenario.id}: Close normally then reopen the retained NFT details`,
        async () => {
          phase = 'reopened';
          await page
            .locator('#details-view-content')
            .getByRole('button', { name: en.buttons.close, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home(?:\?|$)/);
          await openNftList();
          await viewCollection.click();
          observations.reopened = {
            quantity: await quantityEvidence(
              owned(),
              scenario.quantity,
              `${scenario.compact} NFTs`
            ),
            state: await currentState(),
          };
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(forbiddenRequests).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      status = 'passed';
    } finally {
      try {
        await info.attach('nft-owned-details-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            quantity: scenario.quantity,
            compact: scenario.compact,
            contract: CONTRACT,
            tokenId: TOKEN_ID,
            wireSha256: createHash('sha256').update(wire).digest('hex'),
            observations,
            discoveries,
            fixtureReads: routes?.reads || [],
            failedRequests,
            deniedWrites: routes?.deniedWrites || [],
            forbiddenRequests,
            proxyDeniedRequests: server?.blocked || [],
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            signingOrBroadcastRequested: false,
          }),
        });
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server?.close();
          } finally {
            Object.assign(E2E_CONFIG, original);
          }
        }
      }
    }
  });
}
