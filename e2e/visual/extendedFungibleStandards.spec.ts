import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id as selectorId } from 'ethers';
import fs from 'fs';

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

// A local image response and real imports exercise production metadata and visual deduplication.
test.use({ trace: 'off', video: 'off' });
const tokens = new Map([
  ['0x000000000000000000000000000000000000ed77', 'FUNG777'],
  ['0x000000000000000000000000000000000000e462', 'VAULT4626'],
  ['0x000000000000000000000000000000000000ed20', 'UNKNOWN20'],
]);
const standards = new Map([
  ['FUNG777', 'ERC-777'],
  ['VAULT4626', 'ERC-4626'],
  ['UNKNOWN20', 'ERC-20'],
]);
for (const width of [400, 320]) {
  test(`ordinary owned import preserves extended fungible token standards at ${width}`, async ({}, info) => {
    test.setTimeout(180000);
    expect(info.config.workers).toBe(1);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const abi = AbiCoder.defaultAbiCoder();
    const contractReads: string[] = [];
    const deniedWrites: string[] = [];
    const observations: unknown[] = [];
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'TokenOverflowSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
      rpcUrl: server.url,
    });
    try {
      wallet = await PaliWallet.launch(`extended-token-standards-${width}`, {
        offlineHttpProxy: server.url,
        viewport: { width, height: width === 400 ? 620 : 360 },
        recordVideo: false,
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
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
              result = '0x1644';
              break;
            case 'net_version':
              result = '5700';
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
                [
                  'supportsInterface(bytes4)',
                  'bool',
                  symbol === 'FUNG777' &&
                    call.params[0].data.slice(10, 18) === 'e58e113c',
                ],
              ] as const;
              if (
                selector === selectorId('asset()').slice(0, 10) &&
                symbol === 'VAULT4626'
              )
                result = abi.encode(
                  ['address'],
                  ['0x000000000000000000000000000000000000ed20']
                );
              const match = metadata.find(
                ([signature]) => selectorId(signature).slice(0, 10) === selector
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
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      });

      await wallet.context.route(
        'https://api.coingecko.com/api/v3/**',
        async (route) => {
          const match = new URL(route.request().url()).pathname.match(
            /^\/api\/v3\/coins\/[a-z0-9-]+\/contract\/(0x[a-f0-9]{40})$/i
          );
          if (!match || !tokens.has(match[1].toLowerCase()))
            return route.fallback();
          const symbol = tokens.get(match[1].toLowerCase());
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'synthetic-' + symbol!.toLowerCase(),
              name: symbol,
              symbol,
              image: { large: `${server.url}/token-${symbol}.png` },
              // eslint-disable-next-line camelcase
              market_data: { current_price: { usd: 1 } },
            }),
          });
        }
      );
      for (const symbol of tokens.values()) {
        await wallet.context.route(
          `${server.url}/token-${symbol}.png`,
          (route) =>
            route.fulfill({
              status: 200,
              contentType: 'image/png',
              body: fs.readFileSync('source/assets/all_assets/favicon-32.png'),
            })
        );
      }

      const fixture = createIsolatedVaultFixture();
      const discoveryReads: string[] = [];
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api?**',
        async (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get('action') !== 'tokenlist')
            return route.fallback();
          expect(route.request().method()).toBe('GET');
          expect(url.searchParams.get('address')?.toLowerCase()).toBe(
            fixture.evmAddresses[0].toLowerCase()
          );
          discoveryReads.push(url.href);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: '1',
              result: [...tokens].map(([contractAddress, symbol]) => ({
                contractAddress,
                symbol,
                name: symbol,
                decimals: '6',
                balance: '12000000',
                ...(symbol !== 'UNKNOWN20'
                  ? { type: standards.get(symbol) }
                  : {}),
              })),
            }),
          });
        }
      );
      const page = wallet.page;
      const snapshot = async (label: string) => {
        await page.mouse.move(0, 0);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await info.attach(label, {
          body: await page.screenshot({
            animations: 'disabled',
            mask: [page.locator('input[type="password"]')],
          }),
          contentType: 'image/png',
        });
      };
      const publicTokens = () =>
        page.evaluate(async () => {
          const s = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const a = s.vault.activeAccount;
          return (s.vault.accountAssets[a.type]?.[a.id]?.ethereum || []).map(
            (t: any) => ({
              contractAddress: t.contractAddress,
              tokenStandard: t.tokenStandard,
              symbol: t.symbol || t.tokenSymbol,
              balance: t.balance,
            })
          );
        });
      await wallet.step(
        'ordinary owned-token import reads typed metadata and defaults missing type',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          for (const symbol of tokens.values()) {
            const add = page.getByRole('button', {
              name: 'Import ' + symbol + ' token',
              exact: true,
            });
            await expect(add).toBeEnabled();
            await snapshot(`owned-${symbol}-${width}`);
            await add.click();
            await expect
              .poll(async () =>
                (
                  await publicTokens()
                ).some(
                  (t) =>
                    t.symbol === symbol &&
                    t.tokenStandard === standards.get(symbol)
                )
              )
              .toBe(true);
          }
          expect(discoveryReads.length).toBeGreaterThan(0);
          await page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .click();
        }
      );
      await wallet.step(
        'ordinary asset detail rows preserve literal standards and native keyboard close',
        async () => {
          for (const [address, symbol] of tokens) {
            await wallet!.ensureOnHome();
            await page.locator('#assets-btn').click();
            await page
              .getByRole('button', {
                name: `View details for ${symbol} token`,
                exact: true,
              })
              .click();
            const pane = page.locator(
              '[data-navigation-scroll="asset-details"]'
            );
            await expect(pane).toBeVisible();
            const standard = standards.get(symbol)!;
            const badge = pane
              .locator('span.bg-opacity-80')
              .filter({ hasText: new RegExp('^' + standard + '$') });
            if (standard === 'ERC-20') await expect(badge).toHaveCount(0);
            else {
              await expect(badge).toHaveCount(1);
              const contrast = await captureForegroundContrast(
                badge,
                info,
                `standard-${symbol}-${width}`
              );
              expect
                .soft(contrast.ratio, `${symbol} standard text contrast`)
                .toBeGreaterThanOrEqual(4.5);
            }
            await snapshot(`detail-${symbol}-${width}`);
            const close = page
              .getByRole('button', {
                name: en.buttons.close,
                exact: true,
              })
              .filter({ hasText: new RegExp(`^${en.buttons.close}$`) });
            await close.scrollIntoViewIfNeeded();
            await snapshot(`detail-footer-${symbol}-${width}`);
            for (let index = 0; index < 40; index++) {
              if (
                await close.evaluate((node) => node === document.activeElement)
              )
                break;
              await page.keyboard.press('Tab');
            }
            await expect(close).toBeFocused();
            await page.keyboard.press('Enter');
            observations.push({ symbol, standard, address });
          }
          await page.reload();
          await wallet!.ensureOnHome();
          for (const [address, symbol] of tokens)
            expect(
              (await publicTokens()).some(
                (t) =>
                  t.contractAddress.toLowerCase() === address &&
                  t.tokenStandard === standards.get(symbol)
              )
            ).toBe(true);
          expect(deniedWrites).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
          status = info.errors.length === 0 ? 'passed' : 'failed';
        }
      );
    } finally {
      await info.attach('extended-standard-public-audit', {
        body: JSON.stringify(
          {
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            runtime,
            observations,
            contractReads,
            deniedWrites,
            routeDenied: routes?.deniedWrites,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
      await wallet?.dispose(status);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}
