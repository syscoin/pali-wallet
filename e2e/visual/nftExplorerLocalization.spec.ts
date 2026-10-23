import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
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
const cases = [
  {
    code: 'de',
    translations: de,
    option: 'German Deutsch',
    quantity: '7',
    width: 400,
  },
  {
    code: 'fr',
    translations: fr,
    option: 'French Français',
    quantity: '42',
    width: 320,
  },
] as const;

// Read only public projections. Import and language persistence must be
// performed by the real UI/controller; these observers never rewrite replies.
const publicNft = (page: Page) =>
  page.evaluate(async (contract) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get([key, 'language']);
    const account = state.vault.accounts[ref.type][ref.id];
    const project = (vault: any) =>
      (vault.accountAssets[ref.type]?.[ref.id]?.ethereum ?? [])
        .filter(
          (asset: any) =>
            asset.contractAddress.toLowerCase() === contract &&
            asset.tokenId === '7'
        )
        .map((asset: any) => ({
          id: asset.id,
          contractAddress: asset.contractAddress,
          chainId: asset.chainId,
          tokenId: asset.tokenId,
          tokenStandard: asset.tokenStandard,
          isNft: asset.isNft,
          name: asset.name,
          balance: asset.balance,
          rawBalance: asset.rawBalance,
        }));
    const network = state.vault.activeNetwork;
    return {
      active: { id: ref.id, type: ref.type },
      account: {
        id: account.id,
        label: account.label,
        address: account.address,
      },
      network: {
        kind: network.kind,
        chainId: network.chainId,
        url: network.url,
        explorer: network.explorer,
      },
      language: saved.language,
      live: project(state.vault),
      saved: project(saved[key]),
    };
  }, CONTRACT);

const focusWithKeyboard = async (page: Page, link: Locator) => {
  for (let index = 0; index < 40; index++) {
    if (await link.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(link).toBeFocused();
};

for (const locale of cases) {
  test(`stored NFT explorer link uses the saved ${locale.code} language at ${locale.width}px`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(info.project.retries).toBe(0);
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
    const fixture = createIsolatedVaultFixture();
    const discoveries: Array<{ address: string; quantity: string }> = [];
    const pageErrors: string[] = [];
    const observations: Record<string, unknown> = {};
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'NftExplorerLocaleSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        'nft-explorer-localization-' + locale.code,
        {
          offlineHttpProxy: server.url,
          viewport: { width: locale.width, height: 360 },
        }
      );
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
          discoveries.push({
            address: url.searchParams.get('address')!.toLowerCase(),
            quantity: locale.quantity,
          });
          // Raw explorer data only, as in ownedNftImportQuantity. The real
          // SDK discovers it; the real controller imports and persists it.
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
                  balance: locale.quantity,
                },
              ],
            }),
          });
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      let imported: Awaited<ReturnType<typeof publicNft>>;
      let localized: Awaited<ReturnType<typeof publicNft>>;
      await wallet.step(
        `${locale.code}: import the discovered ERC1155 through Your Tokens`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
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
          expect(discoveries).toContainEqual({
            address: fixture.evmAddresses[0].toLowerCase(),
            quantity: locale.quantity,
          });
          await importToken.click();
          await expect
            .poll(async () => (await publicNft(page)).saved)
            .toMatchObject([
              {
                chainId: 5700,
                tokenId: TOKEN_ID,
                tokenStandard: 'ERC-1155',
                isNft: true,
                balance: Number(locale.quantity),
              },
            ]);
          imported = await publicNft(page);
          expect(imported.active).toEqual({ id: 0, type: 'HDAccount' });
          expect(imported.account.address.toLowerCase()).toBe(
            fixture.evmAddresses[0].toLowerCase()
          );
          expect(imported.network).toMatchObject({
            kind: 'ethereum',
            chainId: 5700,
            explorer: 'https://explorer.tanenbaum.io/',
          });
          expect(imported.live).toHaveLength(1);
          expect(imported.saved).toEqual(imported.live);
          observations.imported = imported;
        }
      );
      await wallet.step(
        `${locale.code}: save the locale through the ordinary Languages menu`,
        async () => {
          await wallet!.ensureOnHome();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: 'Languages', exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/languages$/);
          await page
            .getByRole('button', {
              name: en.settings.setYourPreferredLanguage,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: locale.option, exact: true })
            .click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(
                async () =>
                  (
                    await chrome.storage.local.get('language')
                  ).language
              )
            )
            .toBe(locale.code);
          await expect(
            page.getByText(locale.translations.settings.languageWasSet, {
              exact: true,
            })
          ).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          localized = await publicNft(page);
          expect(localized).toEqual({ ...imported, language: locale.code });
          observations.localized = localized;
        }
      );
      await wallet.step(
        `${locale.code}: open the persisted NFT through its collection actions`,
        async () => {
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', {
              name: locale.translations.tooltip.viewNFTs,
              exact: true,
            })
            .click();
          const collection = page.getByRole('button', {
            name: `View details for ${SYMBOL} collection`,
            exact: true,
          });
          await expect(
            page
              .locator('li')
              .filter({ has: collection })
              .locator(`span[title="${locale.quantity}"]`)
          ).toContainText(locale.quantity);
          await collection.click();
          await page
            .locator('[data-navigation-scroll="asset-details"]')
            .getByRole('button', {
              name: `eye ${locale.translations.send.viewCollectionItems}`,
              exact: true,
            })
            .click();
          await expect(page.getByText(/• ERC-1155$/)).toHaveAttribute(
            'title',
            locale.quantity
          );
          await expect(
            page.getByText(locale.translations.nftDetails.about, {
              exact: true,
            })
          ).toBeVisible();
          await expect(
            page.getByText(locale.translations.nftDetails.technicalInfo, {
              exact: true,
            })
          ).toBeVisible();
          expect(await publicNft(page)).toEqual(localized);
        }
      );
      const link = page.locator('#details-view-content a[target="_blank"]');
      await wallet.step(
        `${locale.code}: preserve native explorer href, query and keyboard focus`,
        async () => {
          await expect(link).toHaveCount(1);
          const expected = new URL(localized.network.explorer);
          expected.pathname = `/address/${CONTRACT}`;
          await expect(link).toHaveAttribute('href', expected.href);
          await expect(link).toHaveAttribute('target', '_blank');
          await expect(link).toHaveAttribute('rel', 'noreferrer');
          expect(new URL((await link.getAttribute('href'))!).search).toBe(
            new URL(localized.network.explorer).search
          );
          await focusWithKeyboard(page, link);
          await expect(link).toBeInViewport();
          const bounds = await link.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2
            );
            return {
              left: box.left >= 0,
              right: box.right <= innerWidth,
              top: box.top >= 0,
              bottom: box.bottom <= innerHeight,
              positive: box.width > 0 && box.height > 0,
              exposed: !!hit && (hit === node || node.contains(hit)),
            };
          });
          expect(bounds).toEqual({
            left: true,
            right: true,
            top: true,
            bottom: true,
            positive: true,
            exposed: true,
          });
          expect(await publicNft(page)).toEqual(localized);
          expect(routes!.deniedWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
          observations.link = {
            href: await link.getAttribute('href'),
            query: expected.search,
            target: await link.getAttribute('target'),
            rel: await link.getAttribute('rel'),
            focused: await link.evaluate(
              (node) => node === document.activeElement
            ),
            bounds,
            publicState: await publicNft(page),
          };
          await info.attach(`nft-explorer-${locale.code}-native-controls`, {
            contentType: 'image/png',
            body: await page.screenshot({ animations: 'disabled' }),
          });
        }
      );
      await wallet.step(
        `${locale.code}: use the localized explorer accessible name, not English`,
        async () => {
          await expect(link).toHaveAccessibleName(
            locale.translations.home.viewOnExplorer
          );
          await expect(
            link.getByText(en.home.viewOnExplorer, { exact: true })
          ).toHaveCount(0);
          expect(await publicNft(page)).toEqual(localized);
          observations.accessibleName = locale.translations.home.viewOnExplorer;
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('nft-explorer-localization-' + locale.code, {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            locale: locale.code,
            viewport: { width: locale.width, height: 360 },
            quantity: locale.quantity,
            runtime,
            sourceHash,
            observations,
            discoveries,
            fixtureReads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedRequests: server?.blocked ?? [],
            pageErrors,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            storageReplaced: false,
            signingOrBroadcastRequested: false,
            externalExplorerOpened: false,
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
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    }
  });
}
