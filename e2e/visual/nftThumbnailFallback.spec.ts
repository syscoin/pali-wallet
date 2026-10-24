import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';
import { deflateSync } from 'zlib';

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

const BASELINE = 'eddcca217822f733c0f4d6f5ead5eb0267c1716a';
const MODE = process.env.PALI_NFT_THUMBNAIL_MODE || 'after';
const COLLECTIONS = [
  {
    contract: '0x000000000000000000000000000000000000e901',
    symbol: 'C404',
    image: '404',
  },
  {
    contract: '0x000000000000000000000000000000000000e902',
    symbol: 'DPNG',
    image: 'decode',
  },
  {
    contract: '0x000000000000000000000000000000000000e903',
    symbol: 'HEALTHY',
    image: 'valid',
  },
  {
    contract: '0x000000000000000000000000000000000000e904',
    symbol: 'NOLOGO',
    image: 'none',
  },
] as const;
type Collection = (typeof COLLECTIONS)[number];
const imageUrl = (collection: Collection) =>
  `https://icons.synthetic.invalid/nft-thumbnails/${collection.image}.png`;
const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');

// A complete one-pixel PNG, including CRCs, gives the native decoder a healthy control.
function tinyPng() {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 28, 160, 90, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const publicState = (page: Page) =>
  page.evaluate(
    async (contracts) => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const { id: accountId, type } = state.vault.activeAccount;
      const account = state.vault.accounts[type][accountId];
      const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
      const saved = await chrome.storage.local.get(storageKey);
      const project = (vault: any) =>
        (vault?.accountAssets?.[type]?.[accountId]?.ethereum || [])
          .filter((asset: any) =>
            contracts.includes(asset.contractAddress?.toLowerCase())
          )
          .map((asset: any) => ({
            id: asset.id,
            contractAddress: asset.contractAddress.toLowerCase(),
            symbol: asset.tokenSymbol,
            name: asset.name,
            balance: asset.balance,
            chainId: asset.chainId,
            tokenStandard: asset.tokenStandard,
            isNft: asset.isNft,
            logo: asset.logo,
          }))
          .sort((a: any, b: any) =>
            a.contractAddress.localeCompare(b.contractAddress)
          );
      return {
        account: { id: accountId, type, address: account.address },
        network: {
          chainId: state.vault.activeNetwork.chainId,
          kind: state.vault.activeNetwork.kind,
          url: state.vault.activeNetwork.url,
        },
        storageKey,
        live: project(state.vault),
        saved: project(saved[storageKey]),
      };
    },
    COLLECTIONS.map((collection) => collection.contract)
  );

test('NFT thumbnails keep their category through native image failures and collection navigation', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(['before', 'after']).toContain(MODE);
  if (process.env.CI) expect(MODE).toBe('after');
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  if (MODE === 'before')
    expect(process.env.PALI_TEST_DAPP_REVISION).toBe(BASELINE);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const abi = AbiCoder.defaultAbiCoder();
  const validPng = tinyPng();
  const invalidPng = validPng.subarray(0, 16);
  const discoveries: string[] = [];
  const marketReads: string[] = [];
  const contractReads: string[] = [];
  const imageReads: Array<{
    bytes: number;
    sha256: string;
    status: number;
    url: string;
  }> = [];
  const forbiddenRequests: string[] = [];
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
      password: 'NftThumbnailSynthetic!2026',
      chainId: 1,
      networkLabel: 'Ethereum Mainnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch(`nft-thumbnail-${MODE}`, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    wallet.context.on('request', (request) => {
      let body: any;
      try {
        body = request.postDataJSON();
      } catch {
        return;
      }
      for (const call of Array.isArray(body) ? body : [body]) {
        if (
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
          forbiddenRequests.push(call.method);
      }
    });
    await wallet.context.route(
      'https://ethereum-rpc.publicnode.com/',
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
              call?.method || ''
            )
          )
        )
          return route.abort('blockedbyclient');
        const replies = calls.map((call: any) => {
          let result: unknown;
          switch (call.method) {
            case 'eth_chainId':
              result = '0x1';
              break;
            case 'net_version':
              result = '1';
              break;
            case 'eth_blockNumber':
              result = '0x1';
              break;
            case 'eth_getBalance':
            case 'eth_getTransactionCount':
              if (
                fixture.evmAddresses.some(
                  (address) =>
                    address.toLowerCase() ===
                    String(call.params?.[0]).toLowerCase()
                )
              )
                result = '0x0';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getLogs':
              result = [];
              break;
            case 'eth_getBlockByNumber':
              result = {
                number: '0x1',
                hash: `0x${'12'.repeat(32)}`,
                parentHash: `0x${'11'.repeat(32)}`,
                nonce: '0x0000000000000000',
                timestamp: '0x1',
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x0',
                miner: `0x${'00'.repeat(20)}`,
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
              break;
            case 'eth_getCode':
              result = COLLECTIONS.some(
                (collection) =>
                  collection.contract === String(call.params?.[0]).toLowerCase()
              )
                ? '0x60006000fd'
                : '0x';
              break;
            case 'eth_call': {
              const collection = COLLECTIONS.find(
                (entry) =>
                  entry.contract === String(call.params?.[0]?.to).toLowerCase()
              );
              if (!collection) break;
              const data = String(call.params[0].data);
              const selector = data.slice(0, 10);
              const args = `0x${data.slice(10)}`;
              const isCall = (signature: string) =>
                selector === id(signature).slice(0, 10);
              if (isCall('name()') || isCall('symbol()'))
                result = abi.encode(['string'], [collection.symbol]);
              else if (isCall('decimals()'))
                result = abi.encode(['uint8'], [0]);
              else if (isCall('totalSupply()'))
                result = abi.encode(['uint256'], [1]);
              else if (isCall('balanceOf(address)')) {
                const [owner] = abi.decode(['address'], args);
                if (
                  String(owner).toLowerCase() ===
                  fixture.evmAddresses[0].toLowerCase()
                )
                  result = abi.encode(['uint256'], [1]);
              } else if (isCall('supportsInterface(bytes4)')) {
                const [interfaceId] = abi.decode(['bytes4'], args);
                result = abi.encode(
                  ['bool'],
                  [
                    ['0x01ffc9a7', '0x80ac58cd', '0x780e9d63'].includes(
                      interfaceId
                    ),
                  ]
                );
              } else if (isCall('tokenOfOwnerByIndex(address,uint256)')) {
                const [owner, index] = abi.decode(['address', 'uint256'], args);
                if (
                  String(owner).toLowerCase() ===
                    fixture.evmAddresses[0].toLowerCase() &&
                  index === BigInt(0)
                )
                  result = abi.encode(['uint256'], [7]);
              } else if (isCall('ownerOf(uint256)')) {
                const [tokenId] = abi.decode(['uint256'], args);
                if (tokenId === BigInt(7))
                  result = abi.encode(['address'], [fixture.evmAddresses[0]]);
              }
              contractReads.push(`${collection.contract}:${selector}`);
              break;
            }
          }
          return result === undefined
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: { code: -32000, message: 'Unsupported synthetic read' },
              }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      }
    );

    await wallet.context.route('https://api.routescan.io/**', async (route) => {
      const url = new URL(route.request().url());
      const match = url.pathname.match(
        /^\/v2\/network\/mainnet\/evm\/1\/address\/(0x[a-f0-9]{40})\/(erc20|erc721|erc1155)-holdings$/i
      );
      if (
        route.request().method() !== 'GET' ||
        !match ||
        match[1].toLowerCase() !== fixture.evmAddresses[0].toLowerCase() ||
        url.searchParams.has('next')
      )
        return route.fallback();
      discoveries.push(match[2]);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items:
            match[2] === 'erc721'
              ? COLLECTIONS.map((collection) => ({
                  chainId: 1,
                  tokenAddress: collection.contract,
                  tokenId: '7',
                  collectionName: collection.symbol,
                  collectionSymbol: collection.symbol,
                }))
              : [],
        }),
      });
    });
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      async (route) => {
        const match = new URL(route.request().url()).pathname.match(
          /^\/api\/v3\/coins\/ethereum\/contract\/(0x[a-f0-9]{40})$/i
        );
        const collection =
          match &&
          COLLECTIONS.find(
            (entry) => entry.contract === match[1].toLowerCase()
          );
        if (route.request().method() !== 'GET' || !collection)
          return route.fallback();
        marketReads.push(collection.contract);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: `synthetic-${collection.symbol.toLowerCase()}`,
            symbol: collection.symbol,
            name: collection.symbol,
            ...(collection.image !== 'none' && {
              image: { large: imageUrl(collection) },
            }),
            // CoinGecko's wire format uses these exact property names.
            // eslint-disable-next-line camelcase
            market_data: { current_price: { usd: 0 } },
          }),
        });
      }
    );
    await wallet.context.route(
      'https://icons.synthetic.invalid/nft-thumbnails/*.png',
      async (route) => {
        const collection = COLLECTIONS.find(
          (entry) =>
            entry.image !== 'none' && imageUrl(entry) === route.request().url()
        );
        if (route.request().method() !== 'GET' || !collection)
          return route.fallback();
        const responseStatus = collection.image === '404' ? 404 : 200;
        const bytes =
          collection.image === 'decode'
            ? invalidPng
            : collection.image === 'valid'
            ? validPng
            : Buffer.alloc(0);
        imageReads.push({
          url: route.request().url(),
          status: responseStatus,
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
        return route.fulfill({
          status: responseStatus,
          contentType: 'image/png',
          headers: { 'access-control-allow-origin': '*' },
          body: bytes,
        });
      }
    );

    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await wallet.step(
      'import four synthetic NFT collections through the ordinary Your Tokens screen',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
        await page.evaluate(
          (symbols: string[]) => {
            const events: unknown[] = [];
            (window as any).__nftThumbnailEvents = events;
            const observe = (event: Event) => {
              if (
                !(event.target instanceof HTMLImageElement) ||
                !symbols.includes(event.target.alt)
              )
                return;
              const image = event.target;
              events.push({
                alt: image.alt,
                type: event.type,
                trusted: event.isTrusted,
                width: image.naturalWidth,
                height: image.naturalHeight,
                source: image.currentSrc.startsWith('data:')
                  ? image.currentSrc.split(',')[0]
                  : image.currentSrc,
              });
            };
            document.addEventListener('load', observe, true);
            document.addEventListener('error', observe, true);
          },
          COLLECTIONS.map((collection) => collection.symbol)
        );
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await page
          .getByRole('button', { name: en.tokens.yourTokens, exact: true })
          .click();
        for (const collection of COLLECTIONS) {
          const button = page.getByRole('button', {
            name: `Import ${collection.symbol} token`,
            exact: true,
          });
          await expect(button).toBeEnabled();
          await button.click();
          await expect
            .poll(
              async () =>
                (
                  await publicState(page)
                ).saved.find(
                  (entry: any) => entry.contractAddress === collection.contract
                )?.logo
            )
            .toBeTruthy();
          const imported = page.getByText(
            en.tokens.hasBeenAddedToYourWallet.replace(
              '{{token}}',
              collection.symbol
            ),
            { exact: true }
          );
          await expect(imported).toBeVisible();
          await imported.click();
          await expect(imported).toBeHidden();
          expect(marketReads).toContain(collection.contract);
        }
        const imported = await publicState(page);
        expect(imported.network).toMatchObject({
          chainId: 1,
          kind: 'ethereum',
        });
        expect(imported.account.address.toLowerCase()).toBe(
          fixture.evmAddresses[0].toLowerCase()
        );
        expect(imported.live).toEqual(imported.saved);
        expect(imported.live).toHaveLength(COLLECTIONS.length);
        for (const collection of COLLECTIONS) {
          const entry = imported.live.find(
            (asset: any) => asset.contractAddress === collection.contract
          )!;
          expect(entry).toMatchObject({
            symbol: collection.symbol,
            balance: 1,
            chainId: 1,
            isNft: true,
            tokenStandard: 'ERC-721',
          });
          if (collection.image === 'none')
            expect(entry.logo).toMatch(/(?:^|\/)favicon-32\.png$/);
          else expect(entry.logo).toBe(imageUrl(collection));
        }
        observations.imported = imported;
        await page
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home(?:\?|$)/);
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
          .click();
      }
    );

    const capture = async (node: Locator, name: string) => {
      await node.scrollIntoViewIfNeeded();
      await expect(node).toBeVisible();
      await page.mouse.move(0, 0);
      await info.attach(`${MODE}-${name}-screen`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await info.attach(`${MODE}-${name}-crop`, {
        body: await node.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
    };
    const nftFallback = (parent: Locator) =>
      parent
        .locator('svg[viewBox="0 0 100 100"]')
        .filter({ has: page.locator('text', { hasText: /^NFT$/ }) });
    for (const width of [400, 320]) {
      await page.setViewportSize({ width, height: width === 400 ? 620 : 360 });
      for (const collection of COLLECTIONS) {
        await wallet.step(
          `${MODE}: ${collection.symbol} list and collection detail at ${width}px`,
          async () => {
            const detailsButton = page.getByRole('button', {
              name: `View details for ${collection.symbol} collection`,
              exact: true,
            });
            const row = page.locator('li').filter({ has: detailsButton });
            await row.scrollIntoViewIfNeeded();
            await expect(row).toBeVisible();
            const image = row.locator(`img[alt="${collection.symbol}"]`);
            const failed = ['404', 'decode'].includes(collection.image);
            if (failed) {
              await expect
                .poll(() =>
                  imageReads.some((read) => read.url === imageUrl(collection))
                )
                .toBe(true);
              if (collection.image === 'decode')
                await expect
                  .poll(() =>
                    page.evaluate(
                      (symbol) =>
                        (window as any).__nftThumbnailEvents.some(
                          (event: any) =>
                            event.alt === symbol &&
                            event.type === 'error' &&
                            event.trusted &&
                            event.width === 0
                        ),
                      collection.symbol
                    )
                  )
                  .toBe(true);
              await expect(image).toHaveCount(0);
              if (MODE === 'before') {
                await expect(
                  row.locator('.bg-gradient-to-br > span').filter({
                    hasText: new RegExp(`^${collection.symbol[0]}$`),
                  })
                ).toBeVisible();
                await expect(nftFallback(row)).toHaveCount(0);
              } else {
                await expect(nftFallback(row)).toBeVisible();
                await expect(
                  row.locator('.bg-gradient-to-br > span').filter({
                    hasText: new RegExp(`^${collection.symbol[0]}$`),
                  })
                ).toHaveCount(0);
              }
            } else {
              await expect(image).toBeVisible();
              await expect
                .poll(() =>
                  image.evaluate(
                    (element: HTMLImageElement) =>
                      element.complete && element.naturalWidth > 0
                  )
                )
                .toBe(true);
              await expect(nftFallback(row)).toHaveCount(0);
            }
            await capture(row, `${width}-${collection.symbol}-list`);
            const identity = await publicState(page);
            expect(identity).toEqual(observations.imported);
            await detailsButton.click();
            const assetDetails = page.locator(
              '[data-navigation-scroll="asset-details"]'
            );
            await assetDetails
              .getByRole('button', {
                name: en.send.viewCollectionItems,
                exact: true,
              })
              .click();
            await expect(
              page.getByRole('heading', {
                name: collection.symbol,
                exact: true,
              })
            ).toBeVisible();
            const detail = page.locator('#details-view-content');
            const detailIcon = failed
              ? nftFallback(detail).first()
              : detail.locator(`img[alt="${collection.symbol}"]`).first();
            await expect(detailIcon).toBeVisible();
            if (!failed)
              await expect
                .poll(() =>
                  detailIcon.evaluate(
                    (element: HTMLImageElement) =>
                      element.complete && element.naturalWidth > 0
                  )
                )
                .toBe(true);
            await capture(
              detailIcon,
              `${width}-${collection.symbol}-collection`
            );
            observations[`${width}-${collection.symbol}`] = {
              identity,
              detailIdentity: await publicState(page),
              failed,
              mode: MODE,
            };
            expect(await publicState(page)).toEqual(observations.imported);
            await page
              .getByRole('button', { name: en.buttons.back, exact: true })
              .click();
            await expect(assetDetails).toBeVisible();
            await page
              .locator('#details-view-content')
              .getByRole('button', { name: en.buttons.close, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/home(?:\?|$)/);
            await expect(detailsButton).toBeVisible();
          }
        );
      }
    }
    expect(
      imageReads.find((read) => read.url === imageUrl(COLLECTIONS[0]))
    ).toMatchObject({ status: 404, bytes: 0 });
    expect(
      imageReads.find((read) => read.url === imageUrl(COLLECTIONS[1]))
    ).toMatchObject({ status: 200, bytes: invalidPng.length });
    expect(
      imageReads.find((read) => read.url === imageUrl(COLLECTIONS[2]))
    ).toMatchObject({ status: 200, bytes: validPng.length });
    expect(
      imageReads.some((read) => read.url === imageUrl(COLLECTIONS[3]))
    ).toBe(false);
    const nativeEvents = await page.evaluate(
      () => (window as any).__nftThumbnailEvents
    );
    expect(nativeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alt: 'DPNG',
          type: 'error',
          trusted: true,
          width: 0,
        }),
        expect.objectContaining({
          alt: 'HEALTHY',
          type: 'load',
          trusted: true,
          width: 1,
          height: 1,
        }),
      ])
    );
    expect(discoveries).toEqual(
      expect.arrayContaining(['erc20', 'erc721', 'erc1155'])
    );
    expect(pageErrors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    try {
      await info.attach('nft-thumbnail-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            status,
            mode: MODE,
            baselineRevision: BASELINE,
            runtime,
            testSourceSha256: sha256(fs.readFileSync(info.file)),
            observations,
            discoveries,
            marketReads,
            contractReads,
            imageReads,
            nativeImageEvents: await wallet?.page
              .evaluate(() => (window as any).__nftThumbnailEvents)
              .catch(() => undefined),
            pageErrors,
            forbiddenRequests,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedRequests: server?.blocked || [],
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            imageEventsDispatched: false,
            signingOrBroadcastRequested: false,
            noLogoControl:
              'No upstream image; normal import persists bundled Pali logo. Empty stored logo is not reachable through this import flow.',
          },
          null,
          2
        ),
      });
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
