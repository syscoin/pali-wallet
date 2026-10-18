import { expect, test } from '@playwright/test';
import { AbiCoder, id } from 'ethers';

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

const tokens = [
  {
    contract: '0x000000000000000000000000000000000000ba11',
    symbol: 'FIRST',
    balance: '5000000000000000000',
  },
  {
    contract: '0x000000000000000000000000000000000000ba12',
    symbol: 'SECOND',
    balance: '2000000000000000000',
  },
];

test('Send keeps token verification and MAX bound to the selected ERC20', async () => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenBalanceSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('send-token-verification-lifecycle', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const abi = AbiCoder.defaultAbiCoder();
    const selector = (signature: string) => id(signature).slice(0, 10);
    const deniedWrites: string[] = [];
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push('write-or-sign');
        return route.abort('blockedbyclient');
      }
      const findToken = (call: any) =>
        tokens.find(
          (token) =>
            token.contract ===
            (call.params?.[0]?.to || call.params?.[0])?.toLowerCase()
        );
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call.method) && findToken(call)
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        const token = findToken(call);
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (call.method === 'eth_getCode' && token) result = '0x60006000fd';
        if (call.method === 'eth_call' && token) {
          const prefix = call.params[0].data.slice(0, 10);
          if (prefix === selector('name()'))
            result = abi.encode(
              ['string'],
              [token.symbol + ' synthetic token']
            );
          if (prefix === selector('symbol()'))
            result = abi.encode(['string'], [token.symbol]);
          if (prefix === selector('decimals()'))
            result = abi.encode(['uint8'], [18]);
          if (
            prefix === selector('balanceOf(address)') ||
            prefix === selector('totalSupply()')
          )
            result = abi.encode(['uint256'], [token.balance]);
          if (prefix === selector('supportsInterface(bytes4)'))
            result = abi.encode(['bool'], [false]);
        }
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message: 'Unsupported synthetic read' },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    await wallet.step(
      'import two synthetic ERC20s through the ordinary form',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        for (const token of tokens) {
          await wallet!.gotoRoute('#/tokens/add?tab=custom');
          const tab = page.getByRole('button', {
            name: en.tokens.addCustomTab,
            exact: true,
          });
          if (await tab.count()) await tab.first().click();
          await page.locator('#custom-token-contract').fill(token.contract);
          const button = page.getByRole('button', {
            name: 'Import ' + token.symbol + ' token',
            exact: true,
          });
          await expect(button).toBeEnabled();
          await button.click();
          await expect(button).toBeDisabled();
        }
        await wallet!.gotoRoute('#/send/eth');
      }
    );
    await wallet.step(
      'hold only a genuine first-token balance callback',
      async () => {
        await page.evaluate((firstContract) => {
          const original = chrome.runtime.sendMessage;
          let held: (() => void) | undefined;
          const evidence = {
            held: false,
            delivered: [] as string[],
            errors: [] as boolean[],
          };
          let nextHold: string | undefined = firstContract;
          (chrome.runtime.sendMessage as any) = (...args: any[]) => {
            const [message, callback] = args;
            if (
              message?.type !== 'CONTROLLER_ACTION' ||
              JSON.stringify(message.data?.methods) !==
                JSON.stringify(['wallet', 'getERC20TokenInfo']) ||
              typeof callback !== 'function'
            )
              return (original as any).apply(chrome.runtime, args);
            const contract = String(message.data.params[0]).toLowerCase();
            return original.call(chrome.runtime, message, (response) => {
              evidence.errors.push(
                Boolean(
                  chrome.runtime.lastError ||
                    response?.error ||
                    response?.success === false
                )
              );
              const deliver = () => {
                callback(response);
                evidence.delivered.push(contract);
              };
              if (contract === nextHold) {
                nextHold = undefined;
                held = deliver;
                evidence.held = true;
              } else deliver();
            });
          };
          (window as any).__tokenBalanceDelivery = {
            snapshot: () => ({ ...evidence }),
            holdNext: (contract: string) => {
              nextHold = contract;
            },
            release: () => {
              if (!held) throw new Error('No genuine callback held');
              const deliver = held;
              held = undefined;
              evidence.held = false;
              deliver();
            },
            restore: () => {
              if (held) held();
              chrome.runtime.sendMessage = original;
            },
          };
        }, tokens[0].contract);
        await page.getByRole('button', { name: 'TSYS', exact: true }).click();
        await page
          .locator('button[role="menuitem"]')
          .filter({ hasText: tokens[0].symbol })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as any).__tokenBalanceDelivery.snapshot().held
            )
          )
          .toBe(true);
      }
    );
    await wallet.step(
      'verify the second token while the first response is held',
      async () => {
        await page
          .getByRole('button', { name: tokens[0].symbol, exact: true })
          .click();
        await page
          .locator('button[role="menuitem"]')
          .filter({ hasText: tokens[1].symbol })
          .click();
        const max = page.getByRole('button', { name: 'MAX', exact: true });
        await expect(max).toBeEnabled();
        await max.click();
        await expect(page.getByRole('spinbutton')).toHaveValue('2');
      }
    );
    await wallet.step(
      'a late first-token reply cannot change the second-token MAX',
      async () => {
        await page.evaluate(async () => {
          (window as any).__tokenBalanceDelivery.release();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        await page.getByRole('button', { name: 'MAX', exact: true }).click();
        await expect(page.getByRole('spinbutton')).toHaveValue('2');
      }
    );
    await wallet.step(
      'changing selection immediately retires the verified balance',
      async () => {
        await page.evaluate(
          (contract) =>
            (window as any).__tokenBalanceDelivery.holdNext(contract),
          tokens[0].contract
        );
        await page
          .getByRole('button', { name: tokens[1].symbol, exact: true })
          .click();
        await page
          .locator('button[role="menuitem"]')
          .filter({ hasText: tokens[0].symbol })
          .click();
        const max = page.getByRole('button', { name: 'MAX', exact: true });
        await expect(max).toBeDisabled();
        await expect(
          page.getByTitle(en.send.balanceVerified, { exact: true })
        ).toHaveCount(0);
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as any).__tokenBalanceDelivery.snapshot().held
            )
          )
          .toBe(true);
        await page.evaluate(() =>
          (window as any).__tokenBalanceDelivery.release()
        );
        await expect(max).toBeEnabled();
        await max.click();
        await expect(page.getByRole('spinbutton')).toHaveValue('5');
        const evidence = await page.evaluate(() =>
          (window as any).__tokenBalanceDelivery.snapshot()
        );
        expect(evidence.errors.every((error: boolean) => !error)).toBe(true);
        expect(deniedWrites).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        console.log(
          'send-token-verification-lifecycle',
          JSON.stringify({ runtime, evidence })
        );
      }
    );
    status = 'passed';
  } finally {
    if (wallet) {
      await wallet.page
        .evaluate(() => (window as any).__tokenBalanceDelivery?.restore())
        .catch(() => undefined);
      await wallet.dispose(status);
    }
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
