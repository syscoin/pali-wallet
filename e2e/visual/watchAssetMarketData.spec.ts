import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const PRICE_ONLY = '0x000000000000000000000000000000000000ed55';
const ZERO_CHANGE = '0x000000000000000000000000000000000000ed56';
const tokens = new Map([
  [PRICE_ONLY, 'PRICEONLY'],
  [ZERO_CHANGE, 'ZERODAY'],
]);

test('watch-asset review tolerates missing market change data and preserves zero-change Add and Cancel', async ({}, info) => {
  test.setTimeout(150_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const abi = AbiCoder.defaultAbiCoder();
  const contractReads: string[] = [];
  const marketResponses: {
    address: string;
    change: number | null;
    hasChange: boolean;
  }[] = [];
  const deniedWrites: string[] = [];
  const settlements: { action: string; code?: number; result?: unknown }[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'WatchAssetMarketSynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('watch-asset-market-data', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Network identity is Ethereum, but every read is synthetic and fenced
    // before worker launch. No public chain or market service is contacted.
    await wallet.context.route(
      'https://ethereum-rpc.publicnode.com/',
      async (route) => {
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
      async (route) => {
        const url = new URL(route.request().url());
        const match = url.pathname.match(
          /^\/api\/v3\/coins\/ethereum\/contract\/(0x[a-f0-9]{40})$/i
        );
        if (
          route.request().method() !== 'GET' ||
          !match ||
          !tokens.has(match[1].toLowerCase())
        )
          return route.fallback();
        const address = match[1].toLowerCase();
        marketResponses.push({
          address,
          change: address === ZERO_CHANGE ? 0 : null,
          hasChange: address === ZERO_CHANGE,
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: `synthetic-${tokens.get(address)!.toLowerCase()}`,
            symbol: tokens.get(address),
            name: tokens.get(address),
            // Omission is deliberate valid optional metadata, not a controller result.
            // eslint-disable-next-line camelcase
            market_data: {
              // eslint-disable-next-line camelcase
              current_price: { usd: 55 },
              ...(address === ZERO_CHANGE
                ? // eslint-disable-next-line camelcase
                  { price_change_percentage_24h: 0 }
                : {}),
            },
          }),
        });
      }
    );
    const step = async <T>(
      name: string,
      run: (capture: (page: Page) => Promise<void>) => Promise<T>
    ) =>
      wallet!.step(name, async (capture) => {
        try {
          return await run(capture);
        } finally {
          const popup = wallet!.context
            .pages()
            .find((page) => page.url().includes('/external'));
          if (popup && !popup.isClosed()) await capture(popup);
        }
      });
    await step(
      'import a disposable wallet and select the fully synthetic Ethereum reads',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    const dapp = await wallet.context.newPage();
    await step(
      'connect the ordinary provider to the disposable fixture page',
      async (capture) => {
        await dapp.goto(server.url);
        await dapp.waitForFunction(() => Boolean((window as any).pali));
        const request = await startRequest(dapp, 'eth_requestAccounts');
        const connected = await approve(
          wallet!.context,
          dapp,
          request,
          capture
        );
        expect(
          connected.result.map((address: string) => address.toLowerCase())
        ).toEqual([fixture.evmAddresses[0].toLowerCase()]);
        expect(await providerRequest(dapp, 'eth_chainId')).toBe('0x1');
      }
    );
    const watch = (address: string) => ({
      type: 'ERC20',
      options: { address, symbol: tokens.get(address), decimals: 6 },
    });
    const matching = async (address: string) =>
      ((await providerRequest(dapp, 'wallet_getTokens')).ethereum || []).filter(
        (token: any) => token.contractAddress.toLowerCase() === address
      );
    let request = -1;
    let popup: Page;
    await step(
      'review a price-only token through wallet_watchAsset and the real metadata controller',
      async () => {
        request = await startRequest(
          dapp,
          'wallet_watchAsset',
          watch(PRICE_ONLY)
        );
        popup = await popupFor(wallet!.context, dapp, request);
        await expect(
          popup.getByRole('button', { name: en.buttons.addToken, exact: true })
        ).toBeVisible();
        await expect(
          popup.getByRole('button', { name: en.buttons.addToken, exact: true })
        ).toBeEnabled();
        await expect(
          popup.getByRole('button', { name: en.buttons.cancel, exact: true })
        ).toBeVisible();
        await expect(
          popup.getByText('$55.000000', { exact: true })
        ).toBeVisible();
        await expect(
          popup.getByText('PRICEONLY', { exact: true }).first()
        ).toBeVisible();
        await expect(popup.getByText(/%$/)).toHaveCount(0);
        expect(marketResponses).toContainEqual({
          address: PRICE_ONLY,
          change: null,
          hasChange: false,
        });
        expect(contractReads).toContain(`${PRICE_ONLY}:balanceOf(address)`);
        expect(contractReads).toContain(`${PRICE_ONLY}:symbol()`);
        for (const width of [400, 320]) {
          await popup.setViewportSize({
            width,
            height: width === 320 ? 360 : 620,
          });
          for (const label of [
            en.settings.tokenName,
            en.settings.decimals,
            en.send.balance,
            en.settings.tokenSymbol,
          ]) {
            const value = popup
              .locator('p')
              .filter({ hasText: label })
              .locator('span')
              .first();
            await expect(value).toHaveCount(1);
            await captureForegroundContrast(
              value,
              info,
              `watch-${label}-${width}`
            );
          }
          const contract = popup.getByRole('button', {
            name: PRICE_ONLY,
            exact: true,
          });
          const layout = await contract.evaluate((element) => {
            const parent = element.parentElement!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return {
              text: element.textContent,
              outside: Array.from(range.getClientRects()).some(
                (rect) =>
                  rect.left < parent.left - 1 || rect.right > parent.right + 1
              ),
            };
          });
          expect(layout.text).toBe(PRICE_ONLY);
          expect(layout.outside).toBe(false);
          await captureForegroundContrast(
            contract,
            info,
            `watch-contract-default-${width}`
          );
          await contract.hover();
          await captureForegroundContrast(
            contract,
            info,
            `watch-contract-hover-${width}`
          );
          await popup.mouse.move(0, 0);
        }
      }
    );
    await step(
      'cancel the price-only review and settle the original request without importing',
      async (capture) => {
        await capture(popup!);
        const cancelled = await dismissRejectedApproval({
          click: () =>
            popup!
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => popup!.isClosed(),
          settle: () => settle(dapp, request),
        });
        expect(cancelled.error?.code).toBe(4001);
        expect(await matching(PRICE_ONLY)).toEqual([]);
        settlements.push({
          action: 'price-only-cancel',
          code: cancelled.error?.code,
        });
      }
    );
    await step(
      'approve the same price-only token through its ordinary Add action',
      async (capture) => {
        request = await startRequest(
          dapp,
          'wallet_watchAsset',
          watch(PRICE_ONLY)
        );
        popup = await popupFor(wallet!.context, dapp, request);
        const add = popup.getByRole('button', {
          name: en.buttons.addToken,
          exact: true,
        });
        await expect(add).toBeEnabled();
        await expect(
          popup.getByText('$55.000000', { exact: true })
        ).toBeVisible();
        await capture(popup);
        await clickClosingPopup({
          click: () => add.click(),
          isClosed: () => popup.isClosed(),
        });
        const accepted = await settle(dapp, request);
        expect(accepted.error).toBeUndefined();
        expect(accepted.result).toBe(true);
        await expect.poll(() => popup.isClosed()).toBe(true);
        const saved = await matching(PRICE_ONLY);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
          tokenSymbol: 'PRICEONLY',
          chainId: 1,
          decimals: 6,
          balance: 12,
        });
        settlements.push({ action: 'price-only-add', result: accepted.result });
      }
    );
    await step(
      'preserve an actual zero-percent change in a separate token review',
      async (capture) => {
        request = await startRequest(
          dapp,
          'wallet_watchAsset',
          watch(ZERO_CHANGE)
        );
        popup = await popupFor(wallet!.context, dapp, request);
        await expect(popup.getByText('+0.00%', { exact: true })).toBeVisible();
        await expect(
          popup.getByRole('button', { name: en.buttons.addToken, exact: true })
        ).toBeEnabled();
        expect(marketResponses).toContainEqual({
          address: ZERO_CHANGE,
          change: 0,
          hasChange: true,
        });
        await capture(popup);
        const cancelled = await dismissRejectedApproval({
          click: () =>
            popup
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => popup.isClosed(),
          settle: () => settle(dapp, request),
        });
        expect(cancelled.error?.code).toBe(4001);
        expect(await matching(ZERO_CHANGE)).toEqual([]);
        settlements.push({
          action: 'zero-change-cancel',
          code: cancelled.error?.code,
        });
      }
    );
    expect([...deniedWrites, ...routes.deniedWrites]).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('watch-asset-market-data-runtime-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            contractReads,
            marketResponses,
            settlements,
            deniedWrites: [...deniedWrites, ...(routes?.deniedWrites || [])],
            proxyDeniedConnections: server.blocked.length,
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
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
