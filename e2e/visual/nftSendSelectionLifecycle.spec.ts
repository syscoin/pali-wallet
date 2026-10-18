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

const collections = [
  {
    contract: '0x000000000000000000000000000000000000ca71',
    symbol: 'FIRSTNFT',
    tokenId: '7',
  },
  {
    contract: '0x000000000000000000000000000000000000ca72',
    symbol: 'NEXTNFT',
    tokenId: '9',
  },
];

test('NFT Send keeps the selected collection token ID after a late enumeration reply', async () => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NftSelectionSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const deniedWrites: string[] = [];
  try {
    wallet = await PaliWallet.launch('nft-send-selection-lifecycle', {
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
      const findCollection = (call: any) =>
        collections.find(
          (collection) =>
            collection.contract ===
            (call.params?.[0]?.to || call.params?.[0])?.toLowerCase()
        );
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call.method) &&
            findCollection(call)
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        const collection = findCollection(call);
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (call.method === 'eth_getCode' && collection)
          result = '0x60006000fd';
        if (call.method === 'eth_call' && collection) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          if (prefix === selector('name()'))
            result = abi.encode(['string'], [collection.symbol]);
          if (prefix === selector('symbol()'))
            result = abi.encode(['string'], [collection.symbol]);
          if (prefix === selector('balanceOf(address)'))
            result = abi.encode(['uint256'], ['1']);
          if (prefix === selector('tokenOfOwnerByIndex(address,uint256)'))
            result = abi.encode(['uint256'], [collection.tokenId]);
          if (prefix === selector('ownerOf(uint256)'))
            result = abi.encode(['address'], [fixture.evmAddresses[0]]);
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['bool'],
              [['0x80ac58cd', '0x780e9d63', '0x01ffc9a7'].includes(value)]
            );
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    await wallet.step(
      'import two collections through the ordinary form',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        for (const collection of collections) {
          await wallet!.gotoRoute('#/tokens/add?tab=custom');
          const tab = page.getByRole('button', {
            name: en.tokens.addCustomTab,
            exact: true,
          });
          if (await tab.count()) await tab.first().click();
          await page
            .locator('#custom-token-contract')
            .fill(collection.contract);
          const button = page.getByRole('button', {
            name: 'Import ' + collection.symbol + ' token',
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
      'hold delivery of a genuine first-collection enumeration',
      async () => {
        await page.evaluate((firstContract) => {
          const original = chrome.runtime.sendMessage;
          let held: (() => void) | undefined;
          const evidence = {
            held: false,
            responses: [] as {
              contract: string;
              error: boolean;
              ids: string[];
            }[],
          };
          (chrome.runtime.sendMessage as any) = (...args: any[]) => {
            const [message, callback] = args;
            if (
              message?.type !== 'CONTROLLER_ACTION' ||
              JSON.stringify(message.data?.methods) !==
                JSON.stringify(['wallet', 'fetchNftTokenIds']) ||
              typeof callback !== 'function'
            )
              return (original as any).apply(chrome.runtime, args);
            const contract = String(message.data.params[0]).toLowerCase();
            return original.call(chrome.runtime, message, (response) => {
              const error = Boolean(
                chrome.runtime.lastError ||
                  response?.error ||
                  response?.success === false
              );
              // Record only public collection IDs. Never replace a response.
              evidence.responses.push({
                contract,
                error,
                ids: (Array.isArray(response)
                  ? response
                  : response?.result || []
                ).map((entry: any) => String(entry.tokenId)),
              });
              const deliver = () => callback(response);
              if (contract === firstContract && !held) {
                held = deliver;
                evidence.held = true;
              } else deliver();
            });
          };
          (window as any).__nftEnumerationDelivery = {
            snapshot: () => ({ ...evidence }),
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
        }, collections[0].contract);
        await page.getByRole('button', { name: 'TSYS', exact: true }).click();
        await page
          .locator('button[role="menuitem"]')
          .filter({ hasText: collections[0].symbol })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as any).__nftEnumerationDelivery.snapshot().held
            )
          )
          .toBe(true);
      }
    );
    await wallet.step(
      'select the second collection and its genuine token ID',
      async () => {
        await page
          .getByRole('button', { name: collections[0].symbol, exact: true })
          .click();
        await page
          .locator('button[role="menuitem"]')
          .filter({ hasText: collections[1].symbol })
          .click();
        await expect(
          page.getByRole('button', { name: '#9', exact: true })
        ).toBeVisible();
        await expect(page.locator('#nftTokenId')).toHaveValue('9');
      }
    );
    await wallet.step(
      'late first-collection IDs cannot overwrite the selected collection',
      async () => {
        await page.evaluate(async () => {
          (window as any).__nftEnumerationDelivery.release();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        const evidence = await page.evaluate(() =>
          (window as any).__nftEnumerationDelivery.snapshot()
        );
        console.log(
          'nft-send-selection-lifecycle',
          JSON.stringify({ runtime, evidence })
        );
        expect(evidence.responses).toEqual(
          collections.map((collection) => ({
            contract: collection.contract,
            error: false,
            ids: [collection.tokenId],
          }))
        );
        expect(deniedWrites).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        await expect(
          page.getByRole('button', { name: collections[1].symbol, exact: true })
        ).toBeVisible();
        await expect(page.locator('#nftTokenId')).toHaveValue('9');
        await expect(
          page.getByRole('button', { name: '#9', exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: '#7', exact: true })
        ).toHaveCount(0);
      }
    );
    status = 'passed';
  } finally {
    try {
      if (wallet) {
        await wallet.page
          .evaluate(() => (window as any).__nftEnumerationDelivery?.restore())
          .catch(() => undefined);
        await wallet.dispose(status);
      }
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
