import { expect, test } from '@playwright/test';
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

const LOGO = 'https://www.coingecko.com/favicon-96x96.png';
const imageBytes = fs.readFileSync(
  path.resolve(__dirname, '../../source/assets/all_assets/favicon-32.png')
);
const CONTRACT = '0x000000000000000000000000000000000000ed71';
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
for (const family of ['SPT', 'EVM'] as const) {
  for (const width of [400, 320]) {
    const height = width === 400 ? 620 : 360;
    for (const mode of ['healthy', 'broken', 'absent'] as const) {
      test(`${family} market logo HTTP control ${mode} at ${width}px`, async ({}, info) => {
        test.setTimeout(120_000);
        const runtime = extensionEvidence();
        const before = { ...E2E_CONFIG };
        const fixture = createIsolatedVaultFixture();
        const server = await startUtxoFixtureServer();
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'LogoControlSynthetic!2026',
          chainId: 5700,
          networkLabel: 'Syscoin Testnet',
          rpcUrl: server.url,
        });
        let wallet: PaliWallet | undefined;
        let routes:
          | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
          | undefined;
        let status: 'passed' | 'failed' = 'failed';
        let imageReads = 0;
        let marketReads = 0;
        const observations: unknown[] = [];
        try {
          wallet = await PaliWallet.launch(
            `market-logo-${family}-${width}-${mode}`,
            {
              offlineHttpProxy: server.url,
              recordVideo: false,
              viewport: { width, height },
            }
          );
          routes = await installIsolatedVaultRoutes(
            wallet.context,
            fixture,
            server.url
          );
          const abi = AbiCoder.defaultAbiCoder();
          const tokens = new Map([[CONTRACT, 'COMPLETE']]);
          const contractReads: string[] = [];
          const deniedWrites: string[] = [];
          if (family === 'EVM') {
            await wallet.context.route(
              'https://ethereum-rpc.publicnode.com/',
              async (route) => {
                if (route.request().method() !== 'POST')
                  return route.fallback();
                const body = route.request().postDataJSON();
                const calls = Array.isArray(body) ? body : [body];
                if (
                  calls.some((call: any) =>
                    /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
                      call?.method || ''
                    )
                  )
                ) {
                  deniedWrites.push('attempted-write-or-sign');
                  return route.abort('blockedbyclient');
                }
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
                      result = tokens.has(call.params[0].toLowerCase())
                        ? '0x60006000fd'
                        : '0x';
                      break;
                    case 'eth_call': {
                      const address = call.params[0]?.to?.toLowerCase();
                      const symbol = tokens.get(address);
                      if (!symbol) {
                        result = '0x';
                        break;
                      }
                      const selector = call.params[0].data.slice(0, 10);
                      const metadata = [
                        ['name()', 'string', symbol],
                        ['symbol()', 'string', symbol],
                        ['decimals()', 'uint8', 6],
                        ['balanceOf(address)', 'uint256', 12000000],
                        ['totalSupply()', 'uint256', 12000000],
                        ['supportsInterface(bytes4)', 'bool', false],
                      ] as const;
                      const match = metadata.find(
                        ([signature]) => id(signature).slice(0, 10) === selector
                      );
                      if (match) {
                        contractReads.push(`${address}:${match[0]}`);
                        result = abi.encode([match[1]], [match[2]]);
                      }
                      break;
                    }
                  }
                  return result === undefined
                    ? {
                        jsonrpc: '2.0',
                        id: call.id,
                        error: {
                          code: -32000,
                          message: 'Unsupported synthetic read',
                        },
                      }
                    : { jsonrpc: '2.0', id: call.id, result };
                });
                return route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify(
                    Array.isArray(body) ? replies : replies[0]
                  ),
                });
              }
            );
          }
          await wallet.context.route(LOGO, async (route) => {
            imageReads++;
            await route.fulfill({
              status: mode === 'healthy' ? 200 : 404,
              contentType: mode === 'healthy' ? 'image/png' : 'text/plain',
              headers: { 'access-control-allow-origin': '*' },
              body:
                mode === 'healthy'
                  ? imageBytes
                  : Buffer.from('Synthetic missing image'),
            });
          });
          await wallet.context.route(
            (url) => url.pathname === '/api/v2/asset/123456',
            (route) =>
              route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                  asset: {
                    assetGuid: '123456',
                    symbol: 'SYSX',
                    name: 'Synthetic known-GUID asset',
                    decimals: 8,
                    balance: '0',
                    totalSent: '0',
                    totalReceived: '0',
                    type: 'SPTAllocated',
                  },
                }),
              })
          );
          await wallet.context.route(
            (url) =>
              url.origin === 'https://api.coingecko.com' &&
              url.pathname ===
                (family === 'SPT'
                  ? '/api/v3/coins/syscoin'
                  : `/api/v3/coins/ethereum/contract/${CONTRACT}`),
            async (route) => {
              if (
                new URL(route.request().url()).searchParams.get(
                  'market_data'
                ) !== 'true'
              )
                return route.fallback();
              marketReads++;
              return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                  id: mode === 'absent' ? '' : 'syscoin',
                  // eslint-disable-next-line camelcase
                  market_cap_rank: 7,
                  // eslint-disable-next-line camelcase
                  market_data: {
                    // eslint-disable-next-line camelcase
                    current_price: { usd: 42 },
                    // eslint-disable-next-line camelcase
                    market_cap: { usd: 0 },
                    // eslint-disable-next-line camelcase
                    total_volume: { usd: 0 },
                    // eslint-disable-next-line camelcase
                    circulating_supply: 0,
                  },
                  description: { en: 'Synthetic SPT description' },
                }),
              });
            }
          );
          const page = wallet.page;
          const pane = page.locator('[data-navigation-scroll="asset-details"]');
          const close = page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .filter({ hasText: en.buttons.close });
          await wallet.step(
            `${width}px ${mode} enter SPT through normal import and preview`,
            async () => {
              await wallet!.importSeedAndCreatePassword();
              await wallet!.switchNetwork(
                family === 'SPT' ? 'Syscoin Testnet' : 'Ethereum Mainnet',
                family === 'SPT' ? 'UTXO' : 'EVM'
              );
              await wallet!.ensureOnHome();
              await page.locator('#assets-btn').click();
              await page
                .getByRole('button', { name: en.home.importToken, exact: true })
                .click();
              await page
                .getByRole('button', {
                  name: en.tokens.addCustomTab,
                  exact: true,
                })
                .and(page.locator('button[aria-pressed]'))
                .click();
              if (family === 'SPT') {
                await page.locator('#custom-spt-guid').fill('123456');
              } else {
                await page.locator('#custom-token-contract').fill(CONTRACT);
              }
              await page
                .getByRole('button', {
                  name: `View details for ${
                    family === 'SPT' ? 'SYSX' : 'COMPLETE'
                  } token`,
                  exact: true,
                })
                .click();
              await expect(page).toHaveURL(/#\/home\/details/);
              await expect(
                page.getByText('$42.000000', { exact: true })
              ).toBeAttached();
              expect(marketReads).toBe(family === 'EVM' ? 2 : 1);
            }
          );
          await wallet.step(
            `${width}px ${mode} inspect genuine image response and settled top`,
            async () => {
              const images = page.locator(`img[src="${LOGO}"]`);
              await expect(images).toHaveCount(mode === 'absent' ? 0 : 2);
              if (mode !== 'absent') {
                await expect
                  .poll(() =>
                    images.evaluateAll((nodes) =>
                      nodes.every((img) => (img as HTMLImageElement).complete)
                    )
                  )
                  .toBe(true);
                expect(
                  await images.evaluateAll((nodes) =>
                    nodes.map(
                      (img) => (img as HTMLImageElement).naturalWidth > 0
                    )
                  )
                ).toEqual(mode === 'healthy' ? [true, true] : [false, false]);
                for (const image of await images.all()) {
                  if (mode === 'healthy') await expect(image).toBeVisible();
                  else await expect(image).toBeHidden();
                  await expect(image).toHaveAttribute('alt', '');
                  await expect(image).toHaveAttribute('aria-hidden', 'true');
                }
                await expect(
                  page.getByRole('link', { name: 'CoinGecko', exact: true })
                ).toHaveAttribute('href', 'https://www.coingecko.com');
                await expect(
                  page.getByRole('link', {
                    name: en.tokens.tokenPage,
                    exact: true,
                  })
                ).toHaveAttribute(
                  'href',
                  'https://www.coingecko.com/en/coins/syscoin'
                );
              }
              const rect = await pane.boundingBox();
              if (!rect) throw new Error('Missing details scroll pane');
              await page.mouse.move(
                rect.x + rect.width / 2,
                rect.y + Math.min(140, rect.height / 2)
              );
              await page.mouse.wheel(0, -2500);
              await expect
                .poll(() => pane.evaluate((node) => node.scrollTop))
                .toBe(0);
              await page.waitForTimeout(400);
              observations.push({
                phase: 'top',
                imageReads,
                images: await images.evaluateAll((nodes) =>
                  nodes.map((node) => {
                    const img = node as HTMLImageElement;
                    const imageRect = img.getBoundingClientRect();
                    return {
                      src: img.src,
                      complete: img.complete,
                      naturalWidth: img.naturalWidth,
                      x: imageRect.x,
                      y: imageRect.y,
                      width: imageRect.width,
                      height: imageRect.height,
                    };
                  })
                ),
              });
              await info.attach(`market-logo-${family}-${mode}-top-${width}`, {
                body: await page.screenshot(),
                contentType: 'image/png',
              });
            }
          );
          if (mode !== 'absent') {
            await wallet.step(
              `${width}px ${mode} expose the second logo through ordinary keyboard`,
              async () => {
                const tokenPage = page.locator('a').filter({
                  hasText: en.tokens.tokenPage,
                });
                for (let n = 0; n < 30; n++) {
                  if (
                    await tokenPage.evaluate(
                      (node) => node === document.activeElement
                    )
                  )
                    break;
                  await page.keyboard.press('Tab');
                }
                expect(
                  await tokenPage.evaluate(
                    (node) => node === document.activeElement
                  )
                ).toBe(true);
                const bounds = await tokenPage.boundingBox();
                if (!bounds) throw new Error('Missing Token Page bounds');
                expect(bounds.y).toBeGreaterThanOrEqual(0);
                expect(bounds.y + bounds.height).toBeLessThanOrEqual(
                  height + 0.5
                );
                await page.waitForTimeout(400);
                await info.attach(
                  `market-logo-${family}-${mode}-token-page-${width}`,
                  {
                    body: await page.screenshot(),
                    contentType: 'image/png',
                  }
                );
                if (mode === 'healthy') {
                  const history = page.getByRole('link', {
                    name: en.tokens.historicalData,
                    exact: true,
                  });
                  await page.mouse.move(0, 0);
                  observations.push({
                    phase: 'historical-link-default',
                    contrast: await captureForegroundContrast(
                      history,
                      info,
                      `spt-historical-default-${width}`
                    ),
                  });
                  await history.hover();
                  observations.push({
                    phase: 'historical-link-hover',
                    contrast: await captureForegroundContrast(
                      history,
                      info,
                      `spt-historical-hover-${width}`
                    ),
                  });
                  await page.mouse.move(0, 0);
                }
              }
            );
          }
          await wallet.step(
            `${width}px ${mode} expose loaded footer through ordinary keyboard`,
            async () => {
              for (let n = 0; n < 30; n++) {
                if (
                  await close.evaluate(
                    (node) => node === document.activeElement
                  )
                )
                  break;
                await page.keyboard.press('Tab');
              }
              expect(
                await close.evaluate((node) => node === document.activeElement)
              ).toBe(true);
              const bounds = await close.boundingBox();
              if (!bounds) throw new Error('Missing Close bounds');
              expect(bounds.y).toBeGreaterThanOrEqual(0);
              expect(bounds.y + bounds.height).toBeLessThanOrEqual(
                height + 0.5
              );
              await page.waitForTimeout(400);
              observations.push({
                phase: 'footer',
                close: bounds,
                focused: true,
                scrollTop: await pane.evaluate((node) => node.scrollTop),
              });
              await info.attach(
                `market-logo-${family}-${mode}-footer-${width}`,
                {
                  body: await page.screenshot(),
                  contentType: 'image/png',
                }
              );
              await close.click();
              await expect(page).toHaveURL(/#\/tokens\/add/);
              expect(routes!.deniedWrites).toEqual([]);
              expect(deniedWrites).toEqual([]);
            }
          );
          status = 'passed';
        } finally {
          await info.attach(`market-logo-${family}-control-evidence`, {
            body: JSON.stringify(
              {
                ...runtime,
                family,
                width,
                height,
                mode,
                imageBytesSha256: createHash('sha256')
                  .update(imageBytes)
                  .digest('hex'),
                exactInterceptedImageUrl: LOGO,
                upstreamImageRequests: 0,
                imageReads,
                marketReads,
                observations,
                deniedWrites: routes?.deniedWrites ?? [],
                testSourceSha256: createHash('sha256')
                  .update(fs.readFileSync(__filename))
                  .digest('hex'),
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
            Object.assign(E2E_CONFIG, before);
          }
        }
      });
    }
  }
}
