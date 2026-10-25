import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
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

const COLLECTIONS = [
  {
    address: '0x000000000000000000000000000000000000c711',
    count: 11,
    symbol: 'CAP11',
  },
  {
    address: '0x000000000000000000000000000000000000c710',
    count: 10,
    symbol: 'CAP10',
  },
] as const;
const tabTo = async (page: Page, target: Locator) => {
  for (let step = 0; step < 60; step++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`ERC721 enumeration retains overflow metadata and exact explorer navigation at ${viewport.width}px`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence(),
      previous = { ...E2E_CONFIG };
    const sourceHash = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const fixture = createIsolatedVaultFixture(),
      server = await startUtxoFixtureServer(),
      abi = AbiCoder.defaultAbiCoder();
    const enumerated: Array<{ contract: string; index: number }> = [],
      opened: string[] = [],
      denied: string[] = [];
    let wallet: PaliWallet | undefined,
      status: 'passed' | 'failed' = 'failed';
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NftPaginationSynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(
        'nft-collection-pagination-' + viewport.width,
        { offlineHttpProxy: server.url, viewport, recordVideo: false }
      );
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON(),
          calls = Array.isArray(body) ? body : [body];
        const collection = (call: any) =>
          COLLECTIONS.find(
            (item) =>
              item.address ===
              String(call.params?.[0]?.to || call.params?.[0]).toLowerCase()
          );
        if (!calls.some((call: any) => collection(call)))
          return route.fallback();
        const answers = calls.map((call: any) => {
          const item = collection(call);
          let result: unknown;
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'eth_getCode' && item) result = '0x60006000fd';
          if (call.method === 'eth_call' && item) {
            const data = String(call.params[0].data),
              prefix = data.slice(0, 10),
              args = '0x' + data.slice(10);
            if (
              prefix === id('name()').slice(0, 10) ||
              prefix === id('symbol()').slice(0, 10)
            )
              result = abi.encode(['string'], [item.symbol]);
            if (prefix === id('supportsInterface(bytes4)').slice(0, 10)) {
              const [type] = abi.decode(['bytes4'], args);
              result = abi.encode(
                ['bool'],
                [
                  [
                    '0x80ac58cd',
                    '0x780e9d63',
                    '0x5b5e139f',
                    '0x01ffc9a7',
                  ].includes(type),
                ]
              );
            }
            if (prefix === id('balanceOf(address)').slice(0, 10)) {
              const [owner] = abi.decode(['address'], args);
              expect(owner.toLowerCase()).toBe(
                fixture.evmAddresses[0].toLowerCase()
              );
              result = abi.encode(['uint256'], [item.count]);
            }
            if (prefix === id('totalSupply()').slice(0, 10))
              result = abi.encode(['uint256'], [item.count]);
            if (
              prefix === id('tokenOfOwnerByIndex(address,uint256)').slice(0, 10)
            ) {
              const [owner, index] = abi.decode(['address', 'uint256'], args);
              expect(owner.toLowerCase()).toBe(
                fixture.evmAddresses[0].toLowerCase()
              );
              expect(index < BigInt(10)).toBe(true);
              enumerated.push({ contract: item.address, index: Number(index) });
              result = abi.encode(['uint256'], [index + BigInt(7)]);
            }
            if (prefix === id('ownerOf(uint256)').slice(0, 10)) {
              const [tokenId] = abi.decode(['uint256'], args);
              if (tokenId >= BigInt(7) && tokenId < BigInt(7 + item.count))
                result = abi.encode(['address'], [fixture.evmAddresses[0]]);
            }
          }
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
              call.method
            )
          ) {
            denied.push(call.method);
            return {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32601, message: 'Writes forbidden' },
            };
          }
          return result === undefined
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: {
                  code: -32000,
                  message: 'Synthetic unminted NFT or unsupported read',
                },
              }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? answers : answers[0]),
        });
      });
      await wallet.context.route(
        'https://explorer.tanenbaum.io/token/**',
        async (route) => {
          const url = new URL(route.request().url());
          if (
            route.request().method() !== 'GET' ||
            !COLLECTIONS.some(
              (item) =>
                url.href ===
                'https://explorer.tanenbaum.io/token/' + item.address
            )
          ) {
            denied.push(url.href);
            return route.abort('blockedbyclient');
          }
          opened.push(url.href);
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>Synthetic explorer</title><p>Public fixture collection</p>',
          });
        }
      );
      const page = wallet.page;
      const state = () =>
        page.evaluate(async () => {
          const s = await chrome.runtime.sendMessage({
              type: 'getCurrentState',
            }),
            a = s.vault.activeAccount;
          return {
            active: a,
            address: s.vault.accounts[a.type][a.id].address,
            network: s.vault.activeNetwork.chainId,
            assets: (s.vault.accountAssets[a.type]?.[a.id]?.ethereum ?? []).map(
              (x: any) => ({ contract: x.contractAddress, balance: x.balance })
            ),
          };
        });
      await wallet.step(
        'import two genuine collection fixtures through ordinary wallet controls',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          for (const item of COLLECTIONS) {
            await wallet!.ensureOnHome();
            await page.locator('#assets-btn').click();
            await page
              .getByRole('button', { name: en.home.importToken, exact: true })
              .click();
            const custom = page
              .getByRole('button', {
                name: en.tokens.addCustomTab,
                exact: true,
              })
              .and(page.locator('[aria-pressed]'));
            if (await custom.count()) await custom.click();
            await page.locator('#custom-token-contract').fill(item.address);
            const add = page.getByRole('button', {
              name: 'Import ' + item.symbol + ' token',
              exact: true,
            });
            await expect(add).toBeEnabled();
            await add.click();
            await expect(add).toBeDisabled();
            await page
              .getByRole('button', { name: en.buttons.close, exact: true })
              .click();
          }
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
            .click();
        }
      );
      const baseline = await state();
      for (const item of COLLECTIONS) {
        await wallet.step(
          `${item.count}-item collection keeps the ten-ID cap and its genuine overflow state`,
          async (capture) => {
            // Closing details returns to Home; explicitly reopen the ordinary
            // Assets/NFT view before inspecting the next collection.
            await page.locator('#assets-btn').click();
            const viewNfts = page.getByRole('button', {
              name: en.tooltip.viewNFTs,
              exact: true,
            });
            if (await viewNfts.count()) await viewNfts.click();
            await page
              .getByRole('button', {
                name: 'View details for ' + item.symbol + ' collection',
                exact: true,
              })
              .click();
            const viewCollection = page.getByRole('button', {
              name: en.send.viewCollectionItems,
              exact: true,
            });
            await captureForegroundContrast(
              viewCollection,
              info,
              'view-collection-' + item.count + '-' + viewport.width
            );
            await viewCollection.click();
            const ids = page.getByRole('button', { name: /^#\d+$/ });
            await expect(ids).toHaveCount(10);
            expect(await ids.allTextContents()).toEqual(
              Array.from({ length: 10 }, (_, i) => '#' + (i + 7))
            );
            const more = page.getByRole('button', {
              name: en.send.viewAllOnExplorer,
              exact: true,
            });
            if (item.count === 11) {
              await expect(more).toBeVisible();
              await tabTo(page, more);
              await captureForegroundContrast(
                more,
                info,
                'nft-view-all-' + viewport.width
              );
              await capture(page);
              const [explorer] = await Promise.all([
                wallet!.context.waitForEvent('page'),
                page.keyboard.press('Enter'),
              ]);
              await expect
                .poll(() => explorer.url())
                .toBe('https://explorer.tanenbaum.io/token/' + item.address);
              await expect
                .poll(() => opened.includes(explorer.url()))
                .toBe(true);
              await explorer.close();
              await page.locator('#nft-details-token-id').fill('17');
              await expect(
                page
                  .locator('#nft-details-token-id')
                  .locator('..')
                  .locator('.text-green-500')
              ).toBeVisible();
            } else await expect(more).toHaveCount(0);
            expect(
              enumerated
                .filter((x) => x.contract === item.address)
                .every((x) => x.index < 10)
            ).toBe(true);
            expect(await state()).toEqual(baseline);
            await capture(page);
            await page
              .getByRole('button', { name: en.buttons.back, exact: true })
              .click();
            await expect(viewCollection).toBeVisible();
            await page
              .getByRole('button', { name: en.buttons.close, exact: true })
              .first()
              .click();
            await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
          }
        );
      }
      await wallet.step(
        'finish with unchanged ownership, source and no broadcast',
        async () => {
          expect(await state()).toEqual(baseline);
          expect(denied).toEqual([]);
          expect(routes.deniedWrites).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
        }
      );
      status = 'passed';
    } finally {
      await info.attach('nft-enumeration-evidence', {
        body: JSON.stringify(
          {
            status,
            runtime,
            sourceHash,
            viewport,
            enumerated,
            opened,
            denied,
            controllerStateReplaced: false,
            signedOrBroadcast: false,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
