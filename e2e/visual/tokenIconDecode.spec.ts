import { expect, test } from '@playwright/test';
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

const CORRUPT = '0x000000000000000000000000000000000000ed81';
const HEALTHY = '0x000000000000000000000000000000000000ed82';
const tokens = new Map([
  [CORRUPT, 'CORRUPT'],
  [HEALTHY, 'HEALTHY'],
]);
const iconUrl = (symbol: string) =>
  `https://icons.synthetic.invalid/token-decode/${symbol}.png`;

// A genuine one-pixel RGBA PNG, including CRCs, for the native decoder control.
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
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('native token image decode failure shows fallback without affecting the next valid asset', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const validPng = tinyPng();
  // Successful HTTP with the PNG signature but no complete image chunks.
  const corruptPng = validPng.subarray(0, 16);
  const server = await startUtxoFixtureServer();
  const abi = AbiCoder.defaultAbiCoder();
  const contractReads: string[] = [];
  const marketReads: string[] = [];
  const imageReads: {
    bytes: number;
    sha256: string;
    status: number;
    url: string;
  }[] = [];
  const deniedWrites: string[] = [];
  const pageErrors: string[] = [];
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenIconDecodeSynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('token-icon-native-decode', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
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
              result = tokens.has(String(call.params?.[0]).toLowerCase())
                ? '0x60006000fd'
                : '0x';
              break;
            case 'eth_call': {
              const address = String(call.params?.[0]?.to).toLowerCase();
              const symbol = tokens.get(address);
              if (!symbol) break;
              const selector = String(call.params[0].data).slice(0, 10);
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
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      (route) => {
        const match = new URL(route.request().url()).pathname.match(
          /^\/api\/v3\/coins\/ethereum\/contract\/(0x[a-f0-9]{40})$/i
        );
        const symbol = match && tokens.get(match[1].toLowerCase());
        if (route.request().method() !== 'GET' || !symbol)
          return route.fallback();
        marketReads.push(match![1].toLowerCase());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: `synthetic-${symbol.toLowerCase()}`,
            symbol,
            name: symbol,
            image: { large: iconUrl(symbol) },
            // eslint-disable-next-line camelcase
            market_data: { current_price: { usd: 55 } },
          }),
        });
      }
    );
    await wallet.context.route(
      'https://icons.synthetic.invalid/token-decode/*.png',
      (route) => {
        const url = route.request().url();
        if (
          route.request().method() !== 'GET' ||
          ![iconUrl('CORRUPT'), iconUrl('HEALTHY')].includes(url)
        )
          return route.fallback();
        const bytes = url === iconUrl('CORRUPT') ? corruptPng : validPng;
        imageReads.push({
          url,
          status: 200,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          headers: { 'access-control-allow-origin': '*' },
          body: bytes,
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // Observe actual native decode events only. No image/error/response mutation.
    const observeNativeImages = () =>
      page.evaluate(() => {
        const events: {
          alt: string;
          naturalWidth: number;
          src: string;
          trusted: boolean;
          type: string;
        }[] = [];
        (window as any).__tokenIconDecodeEvents = events;
        const observe = (event: Event) => {
          if (!(event.target instanceof HTMLImageElement)) return;
          const image = event.target;
          if (!['CORRUPT', 'HEALTHY'].includes(image.alt)) return;
          events.push({
            alt: image.alt,
            naturalWidth: image.naturalWidth,
            src: image.currentSrc.split(',')[0],
            trusted: event.isTrusted,
            type: event.type,
          });
        };
        document.addEventListener('error', observe, true);
        document.addEventListener('load', observe, true);
      });
    const details = page.locator('[data-navigation-scroll="asset-details"]');
    const stableDetails = async () => {
      await expect(page.getByText('$55.000000', { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          details.evaluate((element) => {
            for (
              let current: Element | null = element;
              current;
              current = current.parentElement
            ) {
              const style = getComputedStyle(current);
              if (
                style.opacity !== '1' ||
                style.visibility !== 'visible' ||
                style.display === 'none'
              )
                return false;
            }
            return element.getBoundingClientRect().height > 0;
          })
        )
        .toBe(true);
      await expect(
        page
          .getByRole('button', { name: en.buttons.close, exact: true })
          .filter({ hasText: en.buttons.close })
      ).toBeEnabled();
    };
    const close = async () => {
      await page
        .getByRole('button', { name: en.buttons.close, exact: true })
        .filter({ hasText: en.buttons.close })
        .click();
      await expect(
        page.getByRole('button', {
          name: 'View details for HEALTHY token',
          exact: true,
        })
      ).toBeVisible();
    };
    await wallet.step(
      'import two ordinary ERC20 tokens behind the launch-time fence',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
        await observeNativeImages();
        expect(
          await page.evaluate(() =>
            Array.isArray((window as any).__tokenIconDecodeEvents)
          )
        ).toBe(true);
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        const field = page.locator('#custom-token-contract');
        const custom = page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .first();
        await expect(field.or(custom).first()).toBeVisible();
        if (await custom.isVisible()) await custom.click();
        for (const [contract, symbol] of tokens) {
          await field.fill(contract);
          const add = page.getByRole('button', {
            name: `Import ${symbol} token`,
            exact: true,
          });
          await expect(add).toBeEnabled();
          expect(contractReads).toContain(`${contract}:balanceOf(address)`);
          expect(marketReads).toContain(contract);
          await add.click();
          // Disabled also describes the in-flight write. This notice follows
          // the real durable save, so wait for it before changing the input.
          const imported = page.getByText(
            en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', symbol),
            { exact: true }
          );
          await expect(imported).toBeVisible();
          await imported.click();
          await expect(imported).toBeHidden();
          await expect(add).toBeDisabled();
        }
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
      }
    );
    await wallet.step(
      'a successful corrupt PNG response naturally falls back and keeps details usable',
      async (capture) => {
        await page
          .getByRole('button', {
            name: 'View details for CORRUPT token',
            exact: true,
          })
          .click();
        await stableDetails();
        await expect
          .poll(() =>
            page.evaluate(() =>
              (window as any).__tokenIconDecodeEvents.some(
                (event: any) =>
                  event.alt === 'CORRUPT' &&
                  event.type === 'error' &&
                  event.trusted &&
                  event.naturalWidth === 0 &&
                  event.src === 'data:image/png;base64'
              )
            )
          )
          .toBe(true);
        expect(
          imageReads.some(
            (read) =>
              read.url === iconUrl('CORRUPT') &&
              read.status === 200 &&
              read.bytes === corruptPng.length
          )
        ).toBe(true);
        await expect(details.locator('img[alt="CORRUPT"]')).toHaveCount(0);
        await expect(
          details
            .locator('.bg-gradient-to-br > span')
            .filter({ hasText: /^C$/ })
        ).toBeVisible();
        await page.mouse.move(0, 0);
        await capture(page);
        await close();
      }
    );
    await wallet.step(
      'the next valid tiny PNG decodes naturally and retains its own asset identity',
      async (capture) => {
        await page
          .getByRole('button', {
            name: 'View details for HEALTHY token',
            exact: true,
          })
          .click();
        await stableDetails();
        const image = details.locator('img[alt="HEALTHY"]');
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate(
              (element: HTMLImageElement) =>
                element.complete &&
                element.naturalWidth === 1 &&
                element.naturalHeight === 1
            )
          )
          .toBe(true);
        await expect
          .poll(() =>
            page.evaluate(() =>
              (window as any).__tokenIconDecodeEvents.some(
                (event: any) =>
                  event.alt === 'HEALTHY' &&
                  event.type === 'load' &&
                  event.trusted &&
                  event.naturalWidth === 1
              )
            )
          )
          .toBe(true);
        expect(
          imageReads.some(
            (read) =>
              read.url === iconUrl('HEALTHY') && read.bytes === validPng.length
          )
        ).toBe(true);
        await expect(details.locator('img[alt="CORRUPT"]')).toHaveCount(0);
        await expect(
          details
            .locator('.bg-gradient-to-br > span')
            .filter({ hasText: /^C$/ })
        ).toHaveCount(0);
        await page.mouse.move(0, 0);
        await capture(page);
        await close();
        expect(pageErrors).toEqual([]);
        expect(deniedWrites).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
      }
    );
    status = 'passed';
  } finally {
    try {
      const decodeEvents = await wallet?.page
        .evaluate(() => (window as any).__tokenIconDecodeEvents)
        .catch(() => undefined);
      await info.attach('token-icon-native-decode-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultReplaced: false,
            imageEventsDispatched: false,
            contractReads,
            marketReads,
            imageReads,
            decodeEvents,
            pageErrors,
            deniedWrites,
            routeDeniedWrites: routes?.deniedWrites ?? [],
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
