import { expect, test, TestInfo } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
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

const COMPLETE = '0x000000000000000000000000000000000000ed71';
const PARTIAL = '0x000000000000000000000000000000000000ed72';
const tokens = new Map([
  [COMPLETE, 'COMPLETE'],
  [PARTIAL, 'PARTIAL'],
]);

async function marketAvailability(
  malformedCategories: boolean,
  malformedDescription: boolean,
  malformedIdentity: boolean,
  info: TestInfo
) {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const abi = AbiCoder.defaultAbiCoder();
  const contractReads: string[] = [];
  const marketResponses: { address: string; body: unknown }[] = [];
  const deniedWrites: string[] = [];
  const pageErrors: string[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AssetMarketAvailabilitySynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('asset-market-availability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only HTTP inputs are synthetic; normal detection, import, persistence,
    // market fetching and rendering remain unchanged. Public egress is fenced.
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
      }
    );
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      async (route) => {
        const match = new URL(route.request().url()).pathname.match(
          /^\/api\/v3\/coins\/ethereum\/contract\/(0x[a-f0-9]{40})$/i
        );
        if (
          route.request().method() !== 'GET' ||
          !match ||
          !tokens.has(match[1].toLowerCase())
        )
          return route.fallback();
        const address = match[1].toLowerCase();
        const complete = address === COMPLETE;
        const body = {
          id: malformedIdentity
            ? { toString: null }
            : `synthetic-${tokens.get(address)!.toLowerCase()}`,
          symbol: tokens.get(address),
          name: tokens.get(address),
          categories: malformedCategories
            ? complete
              ? 'Payments'
              : ['Payments', null]
            : ['Payments', 'Layer 2'],
          description: {
            en: malformedDescription
              ? { summary: 'Synthetic unrenderable description' }
              : complete
              ? '<b>Synthetic complete description</b>'
              : 'Synthetic partial description',
          },
          // eslint-disable-next-line camelcase
          market_cap_rank: malformedIdentity
            ? { value: 17 }
            : complete
            ? 17
            : null,
          // eslint-disable-next-line camelcase
          market_data: {
            // eslint-disable-next-line camelcase
            current_price: { usd: 55 },
            // eslint-disable-next-line camelcase
            market_cap: {
              usd: malformedIdentity
                ? { toString: null }
                : complete
                ? 1000
                : null,
            },
            // eslint-disable-next-line camelcase
            total_volume: {
              usd: malformedIdentity
                ? { toString: null }
                : complete
                ? 200
                : null,
            },
            // eslint-disable-next-line camelcase
            circulating_supply: malformedIdentity
              ? { toString: null }
              : complete
              ? 10
              : null,
          },
        };
        marketResponses.push({ address, body });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const step = (name: string, run: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        try {
          await run();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    await step(
      'import a disposable wallet with fenced Ethereum reads',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
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
      }
    );
    for (const [contract, symbol] of tokens) {
      await step(
        `import ${symbol} through normal ERC20 validation`,
        async () => {
          await page.locator('#custom-token-contract').fill(contract);
          const add = page.getByRole('button', {
            name: `Import ${symbol} token`,
            exact: true,
          });
          await expect(add).toBeEnabled();
          expect(contractReads).toContain(`${contract}:balanceOf(address)`);
          expect(
            marketResponses.some(({ address }) => address === contract)
          ).toBe(true);
          await add.click();
          await expect(add).toBeDisabled();
        }
      );
    }
    await step(
      'complete market data keeps the normal details price and close action',
      async () => {
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', {
            name: 'View details for COMPLETE token',
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/home\/details/);
        await expect(
          page.getByText('$55.000000', { exact: true })
        ).toBeVisible();
        for (const label of [en.tokens.marketCap, en.tokens.volume24h]) {
          const value = page.getByText(label, { exact: true });
          if (malformedIdentity) await expect(value).toHaveCount(0);
          else await expect(value).toBeVisible();
        }
        await expect(
          page.getByRole('link', { name: 'Payments', exact: true })
        ).toHaveCount(malformedCategories ? 0 : 1);
        await expect(
          page.getByText(en.tokens.categories, { exact: true })
        ).toHaveCount(malformedCategories ? 0 : 1);
        const history = page.getByRole('link', {
          name: en.tokens.historicalData,
          exact: true,
        });
        if (malformedIdentity) await expect(history).toHaveCount(0);
        else
          await expect(history).toHaveAttribute(
            'href',
            'https://www.coingecko.com/en/coins/synthetic-complete/historical_data'
          );
        await expect(
          page.getByText(en.tokens.about, { exact: true })
        ).toHaveCount(malformedDescription ? 0 : 1);
        await expect(
          page.getByText('<b>Synthetic complete description</b>', {
            exact: true,
          })
        ).toHaveCount(malformedDescription ? 0 : 1);
        await expect(page.locator('p b')).toHaveCount(0);
        await info.attach('complete-market-details', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        expect(pageErrors).toEqual([]);
        await page
          .getByRole('button', { name: en.buttons.close, exact: true })
          .filter({ hasText: en.buttons.close })
          .click();
        await expect(
          page.getByRole('button', {
            name: 'View details for PARTIAL token',
            exact: true,
          })
        ).toBeVisible();
      }
    );
    await step(
      'null optional market values cannot remove the price or close action',
      async () => {
        await page
          .getByRole('button', {
            name: 'View details for PARTIAL token',
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/home\/details/);
        await expect(page.getByText('$55.000000', { exact: true })).toBeVisible(
          { timeout: 5_000 }
        );
        for (const label of [
          en.tokens.rank,
          en.tokens.marketCap,
          en.tokens.volume24h,
          en.tokens.circulatingSupply,
        ])
          await expect(page.getByText(label, { exact: true })).toHaveCount(0);
        await expect(
          page.getByRole('link', { name: 'Payments', exact: true })
        ).toHaveAttribute(
          'href',
          'https://www.coingecko.com/en/categories/payments'
        );
        await expect(
          page.getByRole('link', { name: 'Layer 2', exact: true })
        ).toHaveCount(malformedCategories ? 0 : 1);
        await expect(
          page.getByText(en.tokens.about, { exact: true })
        ).toHaveCount(malformedDescription ? 0 : 1);
        await expect(
          page.getByText('Synthetic partial description', { exact: true })
        ).toHaveCount(malformedDescription ? 0 : 1);
        const close = page
          .getByRole('button', {
            name: en.buttons.close,
            exact: true,
          })
          .filter({ hasText: en.buttons.close });
        await expect(close).toBeEnabled();
        expect(pageErrors).toEqual([]);
        expect(deniedWrites).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        await close.click();
        await expect(
          page.getByRole('button', {
            name: 'View details for PARTIAL token',
            exact: true,
          })
        ).toBeVisible();
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('asset-market-availability-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            malformedCategories,
            malformedDescription,
            malformedIdentity,
            controllerStateReplaced: false,
            controllerResultReplaced: false,
            contractReads,
            marketResponses,
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
}

for (const [malformedCategories, malformedDescription, malformedIdentity] of [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [false, false, true],
]) {
  test(`ERC20 details preserve the price and close action with ${
    malformedCategories
      ? 'malformed categories'
      : malformedDescription
      ? 'malformed descriptions'
      : malformedIdentity
      ? 'malformed market identity and optional numeric values'
      : 'null optional market values'
  }`, async ({}, info) =>
    marketAvailability(
      malformedCategories,
      malformedDescription,
      malformedIdentity,
      info
    ));
}
