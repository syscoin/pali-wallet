import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id as selectorId } from 'ethers';
import fs from 'fs';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  extensionEvidence,
  popupFor,
  startRequest,
  settle,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// A local image response and real imports exercise production metadata and visual deduplication.
test.use({ trace: 'off', video: 'off' });
const tokens = new Map([
  ['0x000000000000000000000000000000000000ed71', 'ALPHA'],
  ['0x000000000000000000000000000000000000ed72', 'BRAVO'],
  ['0x000000000000000000000000000000000000ed73', 'CHARLIE'],
  ['0x000000000000000000000000000000000000ed74', 'DELTA'],
]);
test('account review preserves readable overflow for four imported positive tokens', async ({}, info) => {
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
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('token-overflow-normal-import', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
      recordVideo: false,
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
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
      }
    );

    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      async (route) => {
        const match = new URL(route.request().url()).pathname.match(
          /^\/api\/v3\/coins\/ethereum\/contract\/(0x[a-f0-9]{40})$/i
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
      await wallet.context.route(`${server.url}/token-${symbol}.png`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: fs.readFileSync('source/assets/all_assets/favicon-32.png'),
        })
      );
    }
    const page = wallet.page;
    const openImport = async () => {
      await wallet!.ensureOnHome();
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.home.importToken, exact: true })
        .click();
      const custom = page
        .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
        .first();
      await expect(custom).toBeVisible();
      await custom.click();
      await expect(page.locator('#custom-token-contract')).toBeVisible();
    };
    const imported = () =>
      page.evaluate(async () => {
        const s = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
        const a = s.vault.activeAccount;
        return (s.vault.accountAssets[a.type]?.[a.id]?.ethereum || []).map(
          (t: any) => ({
            contractAddress: t.contractAddress,
            symbol: t.symbol,
            tokenSymbol: t.tokenSymbol,
            logo: t.logo,
            balance: t.balance,
          })
        );
      });
    await wallet.step(
      'Import disposable wallet and three distinct positive ERC20s through normal UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await openImport();
        for (const [contract, symbol] of [...tokens].slice(0, 3)) {
          await page.locator('#custom-token-contract').fill(contract);
          const add = page.getByRole('button', {
            name: 'Import ' + symbol + ' token',
            exact: true,
          });
          await expect(add).toBeEnabled();
          expect(contractReads).toContain(contract + ':balanceOf(address)');
          await add.click();
          await expect(add).toBeDisabled();
        }
        await expect
          .poll(
            async () =>
              (await imported()).filter((t: any) => Number(t.balance) > 0)
                .length
          )
          .toBe(3);
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
      }
    );
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url + '/');
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    const inspect = async (count: number) => {
      const requestId = await startRequest(dapp, 'eth_requestAccounts');
      const popup = await popupFor(wallet!.context, dapp, requestId);
      await expect(
        popup.locator('[role="button"]').filter({
          has: popup.getByText('Account 1', { exact: true }),
        })
      ).toBeVisible();
      const overflow = popup.locator('span').filter({ hasText: /^\+1$/ });
      for (const width of [400, 320]) {
        await popup.setViewportSize({
          width,
          height: width === 400 ? 620 : 360,
        });
        await expect(overflow).toHaveCount(count === 4 ? 1 : 0);
        const accountRow = popup
          .locator('[role="button"]')
          .filter({ hasText: 'Account 1' });
        // Real keyboard movement exposes the same account card at both widths.
        await popup.keyboard.press('Tab');
        for (let n = 0; n < 30; n++) {
          if (
            await accountRow.evaluate((node) => node === document.activeElement)
          )
            break;
          await popup.keyboard.press('Tab');
        }
        await expect(accountRow).toBeFocused();
        const icons = accountRow.locator('img.border-bkg-3');
        await expect(icons).toHaveCount(3);
        await expect
          .poll(() =>
            icons.evaluateAll((nodes) =>
              nodes.every(
                (node) =>
                  (node as HTMLImageElement).complete &&
                  (node as HTMLImageElement).naturalWidth > 0
              )
            )
          )
          .toBe(true);
        if (count === 4)
          observations.push({
            count,
            width,
            contrast: await captureForegroundContrast(
              overflow,
              info,
              'token-overflow-' + width
            ),
          });
        else
          await info.attach('three-token-control-' + width, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
      }
      const result = await dismissRejectedApproval({
        click: () =>
          popup
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click(),
        isClosed: () => popup.isClosed(),
        settle: () => settle(dapp, requestId),
      });
      expect(result.result).toBeUndefined();
      expect(result.error?.code).toBe(4100);
      const grant = await page.evaluate(async (origin) => {
        const s = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
        return s.dapp.dapps[origin] ?? null;
      }, server.url);
      expect(grant).toBeNull();
      observations.push({
        count,
        originalRequestRejected: true,
        errorCode: result.error?.code,
        grant: null,
        imported: await imported(),
      });
    };
    await wallet.step(
      'Three positive tokens show three icons and Cancel does not grant access',
      () => inspect(3)
    );
    await wallet.step(
      'Import fourth distinct positive ERC20 through the same normal flow',
      async () => {
        await openImport();
        const [contract, symbol] = [...tokens][3];
        await page.locator('#custom-token-contract').fill(contract);
        const add = page.getByRole('button', {
          name: 'Import ' + symbol + ' token',
          exact: true,
        });
        await expect(add).toBeEnabled();
        await add.click();
        await expect(add).toBeDisabled();
        await expect
          .poll(
            async () =>
              (await imported()).filter((t: any) => Number(t.balance) > 0)
                .length
          )
          .toBe(4);
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'Four positive tokens expose actual plus one label and Cancel still refuses access',
      () => inspect(4)
    );
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    await info.attach('token-overflow-evidence', {
      body: JSON.stringify(
        {
          ...runtime,
          observations,
          deniedWrites,
          fixtureDeniedWrites: routes?.deniedWrites ?? [],
          sourceSha256: createHash('sha256')
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
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
