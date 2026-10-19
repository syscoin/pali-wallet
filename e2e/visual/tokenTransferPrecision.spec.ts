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

const assets = [
  {
    contract: '0x000000000000000000000000000000000000fa21',
    symbol: 'EXACT',
    decimals: 18,
    balance: '999999999999999999',
    amount: '0.999999999999999999',
    tokenId: undefined,
  },
  {
    contract: '0x000000000000000000000000000000000000fa22',
    symbol: 'DUST24',
    decimals: 24,
    balance: '1',
    amount: '0.000000000000000000000001',
    tokenId: undefined,
  },
  {
    contract: '0x000000000000000000000000000000000000fa23',
    symbol: 'LARGEID',
    decimals: 0,
    balance: '1',
    amount: '1',
    tokenId: '9007199254740993',
  },
];

test('token transfers retain exact verified MAX amounts and large NFT identifiers', async () => {
  test.setTimeout(180_000);
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenPrecisionSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const deniedWrites: string[] = [];
  try {
    wallet = await PaliWallet.launch('token-transfer-precision', {
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
      const findAsset = (call: any) =>
        assets.find(
          (asset) =>
            asset.contract ===
            (call.params?.[0]?.to || call.params?.[0])?.toLowerCase()
        );
      const replies = calls.map((call: any) => {
        const asset = findAsset(call);
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (
          call.method === 'eth_getBalance' &&
          fixture.evmAddresses.some(
            (address) => address.toLowerCase() === call.params[0].toLowerCase()
          )
        )
          result = '0xde0b6b3a7640000';
        if (call.method === 'eth_estimateGas') result = '0x186a0';
        if (call.method === 'eth_getCode' && asset) result = '0x60006000fd';
        if (call.method === 'eth_call' && asset) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          if (prefix === selector('name()') || prefix === selector('symbol()'))
            result = abi.encode(['string'], [asset.symbol]);
          if (prefix === selector('decimals()') && !asset.tokenId)
            result = abi.encode(['uint8'], [asset.decimals]);
          if (
            prefix === selector('balanceOf(address)') ||
            prefix === selector('totalSupply()')
          )
            result = abi.encode(['uint256'], [asset.balance]);
          if (
            prefix === selector('tokenOfOwnerByIndex(address,uint256)') &&
            asset.tokenId
          )
            result = abi.encode(['uint256'], [asset.tokenId]);
          if (prefix === selector('ownerOf(uint256)') && asset.tokenId)
            result = abi.encode(['address'], [fixture.evmAddresses[0]]);
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['bool'],
              [
                Boolean(asset.tokenId) &&
                  ['0x80ac58cd', '0x780e9d63', '0x01ffc9a7'].includes(value),
              ]
            );
          }
        }
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.every((reply) => reply !== undefined))
        return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    await wallet.step(
      'import exact-amount tokens and large-ID NFT normally',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        for (const asset of assets) {
          await wallet!.gotoRoute('#/tokens/add?tab=custom');
          const tab = page.getByRole('button', {
            name: en.tokens.addCustomTab,
            exact: true,
          });
          if (await tab.count()) await tab.first().click();
          await page.locator('#custom-token-contract').fill(asset.contract);
          const button = page.getByRole('button', {
            name: 'Import ' + asset.symbol + ' token',
            exact: true,
          });
          await expect(button).toBeEnabled();
          await button.click();
          await expect(button).toBeDisabled();
        }
      }
    );
    for (const asset of assets) {
      await wallet.step(
        `review and capture exact ${asset.symbol} transfer without signing`,
        async () => {
          await wallet!.gotoRoute('#/send/eth');
          // Install in the ready document: hash-only navigation need not run
          // init scripts. Next must retain this verified controller boundary
          // so nothing reaches signing or broadcasting.
          await page.evaluate(() => {
            const original = chrome.runtime.sendMessage;
            (window as any).__precisionSubmissions = [];
            (chrome.runtime.sendMessage as any) = (...args: any[]) => {
              const [message, callback] = args;
              if (
                message?.type === 'CONTROLLER_ACTION' &&
                JSON.stringify(message.data?.methods) ===
                  JSON.stringify(['wallet', 'sendAndSaveTokenTransaction']) &&
                typeof callback === 'function'
              ) {
                (window as any).__precisionSubmissions.push(
                  message.data.params
                );
                queueMicrotask(() =>
                  callback({
                    success: false,
                    error:
                      'Synthetic test stopped before signing or broadcasting',
                  })
                );
                return;
              }
              return (original as any).apply(chrome.runtime, args);
            };
            (window as any).__precisionSendBoundary =
              chrome.runtime.sendMessage;
          });
          expect(
            await page.evaluate(() =>
              Array.isArray((window as any).__precisionSubmissions)
            )
          ).toBe(true);
          await page.getByRole('button', { name: 'TSYS', exact: true }).click();
          await page
            .locator('button[role="menuitem"]')
            .filter({ hasText: asset.symbol })
            .click();
          await page
            .getByPlaceholder(en.send.receiver)
            .fill(fixture.evmAddresses[1]);
          if (asset.tokenId) {
            await expect(page.locator('#nftTokenId')).toHaveValue(
              asset.tokenId
            );
          } else {
            const max = page.getByRole('button', { name: 'MAX', exact: true });
            await expect(max).toBeEnabled();
            await max.click();
            await expect(page.getByPlaceholder(en.send.amount)).toHaveValue(
              asset.amount
            );
          }
          await page
            .getByRole('button', { name: en.buttons.next, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/send\/confirm/);
          if (asset.tokenId)
            await expect(
              page.getByText('#' + asset.tokenId, { exact: true })
            ).toBeVisible();
          const confirm = page.getByRole('button', {
            name: en.buttons.confirm,
            exact: true,
          });
          await expect(confirm).toBeEnabled();
          expect(
            await page.evaluate(
              () =>
                chrome.runtime.sendMessage ===
                  (window as any).__precisionSendBoundary &&
                Array.isArray((window as any).__precisionSubmissions) &&
                (window as any).__precisionSubmissions.length === 0
            )
          ).toBe(true);
          await confirm.click();
          await expect
            .poll(() =>
              page.evaluate(() => (window as any).__precisionSubmissions.length)
            )
            .toBe(1);
          const captured = await page.evaluate(
            () => (window as any).__precisionSubmissions[0]
          );
          expect(captured[0]).toBe(asset.tokenId ? 'ERC721' : 'ERC20');
          expect(captured[1]).toMatchObject(
            asset.tokenId
              ? { tokenId: asset.tokenId }
              : { tokenAmount: asset.amount, decimals: asset.decimals }
          );
          expect(deniedWrites).toEqual([]);
          expect(routes.deniedWrites).toEqual([]);
          console.log(
            'token-transfer-precision',
            JSON.stringify({ runtime, captured }, (_key, value) =>
              typeof value === 'bigint' ? value.toString() : value
            )
          );
        }
      );
    }
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
