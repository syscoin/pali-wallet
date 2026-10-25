import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
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

const CONTRACT = '0x000000000000000000000000000000000000e117';
const SYMBOL = 'WATCH1155';
const QUANTITIES: Record<string, string> = {
  '7': '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  '8': '3',
};

test('wallet_watchAsset preserves exact ERC1155 quantities and distinct token IDs', async ({}, info) => {
  test.setTimeout(150_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const abi = AbiCoder.defaultAbiCoder();
  const selector = (signature: string) => id(signature).slice(0, 10);
  const contractReads: string[] = [];
  const ownershipReads: { balance: string; owner: string; tokenId: string }[] =
    [];
  const settlements: { action: string; code?: number; result?: unknown }[] = [];
  const quantityGeometry: {
    scrollWidth: number;
    tokenId: string;
    width: number;
  }[] = [];
  const deniedWrites: string[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'WatchAsset1155Synthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin NEVM Testnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('watch-asset-erc1155-identity', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only ABI-encoded reads are supplied. The real provider, controller,
    // approval and persistence paths determine token identity and quantity.
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
      const target = (call: any) =>
        (call?.params?.[0]?.to || call?.params?.[0])?.toLowerCase();
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call?.method) &&
            target(call) === CONTRACT
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (call.method === 'eth_getCode' && target(call) === CONTRACT) {
          contractReads.push('eth_getCode');
          result = '0x60006000fd';
        }
        if (call.method === 'eth_call' && target(call) === CONTRACT) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          contractReads.push(prefix);
          if (prefix === selector('name()'))
            result = abi.encode(['string'], ['Synthetic Watched Editions']);
          if (prefix === selector('symbol()'))
            result = abi.encode(['string'], [SYMBOL]);
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['bool'],
              [value === '0xd9b67a26' || value === '0x01ffc9a7']
            );
          }
          if (prefix === selector('balanceOf(address,uint256)')) {
            const [owner, tokenId] = abi.decode(
              ['address', 'uint256'],
              `0x${data.slice(10)}`
            );
            if (owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase()) {
              const balance = QUANTITIES[String(tokenId)] || '0';
              ownershipReads.push({
                balance,
                owner: owner.toLowerCase(),
                tokenId: String(tokenId),
              });
              result = abi.encode(['uint256'], [balance]);
            }
          }
          if (prefix === selector('balanceOfBatch(address[],uint256[])')) {
            const [owners, tokenIds] = abi.decode(
              ['address[]', 'uint256[]'],
              `0x${data.slice(10)}`
            );
            if (
              owners.length === tokenIds.length &&
              owners.every(
                (owner: string) =>
                  owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase()
              )
            )
              result = abi.encode(
                ['uint256[]'],
                [
                  Array.from(
                    tokenIds,
                    (tokenId) => QUANTITIES[String(tokenId)] || '0'
                  ),
                ]
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      async (route) => {
        const url = new URL(route.request().url());
        if (
          route.request().method() !== 'GET' ||
          !url.pathname.endsWith(`/contract/${CONTRACT}`)
        )
          return route.fallback();
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic token has no market data' }),
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
      'import a disposable wallet and select the fenced EVM fixture',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    const dapp = await wallet.context.newPage();
    await step(
      'connect the ordinary provider to the synthetic dapp',
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
        expect(await providerRequest(dapp, 'eth_chainId')).toBe('0x1644');
      }
    );
    const watch = (tokenId: unknown, includeId = true) => ({
      type: 'ERC1155',
      options: {
        address: CONTRACT,
        symbol: SYMBOL,
        ...(includeId ? { tokenId } : {}),
      },
    });
    const expectedAssets = (tokenIds: string[]) =>
      tokenIds.map((tokenId) => ({
        id: `${CONTRACT}-5700-${tokenId}`,
        contractAddress: CONTRACT,
        chainId: 5700,
        tokenId,
        tokenStandard: 'ERC-1155',
        rawBalance: QUANTITIES[tokenId],
      }));
    const matching = async () =>
      ((await providerRequest(dapp, 'wallet_getTokens')).ethereum || [])
        .filter(
          (asset: any) => asset.contractAddress.toLowerCase() === CONTRACT
        )
        .map(
          ({
            id: assetId,
            contractAddress,
            chainId,
            tokenId,
            tokenStandard,
            rawBalance,
          }: any) => ({
            id: assetId,
            contractAddress: contractAddress.toLowerCase(),
            chainId,
            tokenId,
            tokenStandard,
            rawBalance,
          })
        )
        .sort((left: any, right: any) =>
          left.tokenId.localeCompare(right.tokenId)
        );
    const persisted = () =>
      wallet!.page.evaluate(
        (contract) =>
          new Promise((resolve) => {
            chrome.storage.local.get('state-vault-60', (items) => {
              const vault = items['state-vault-60'];
              const assets =
                vault?.accountAssets?.HDAccount?.[0]?.ethereum || [];
              resolve(
                assets
                  .filter(
                    (asset: any) =>
                      asset.contractAddress.toLowerCase() === contract
                  )
                  .map(
                    ({
                      id: assetId,
                      contractAddress,
                      chainId,
                      tokenId,
                      tokenStandard,
                      rawBalance,
                    }: any) => ({
                      id: assetId,
                      contractAddress: contractAddress.toLowerCase(),
                      chainId,
                      tokenId,
                      tokenStandard,
                      rawBalance,
                    })
                  )
                  .sort((left: any, right: any) =>
                    left.tokenId.localeCompare(right.tokenId)
                  )
              );
            });
          }),
        CONTRACT
      );
    await step(
      'reject missing and malformed ERC1155 IDs before contract reads or approval',
      async () => {
        // Test these before imports, so asset polling cannot create unrelated
        // contract reads during the no-I/O assertion.
        expect(contractReads).toEqual([]);
        for (const [label, requestData] of [
          ['missing', watch(undefined, false)],
          ['fractional', watch('1.5')],
          ['out-of-range', watch(`0x1${'0'.repeat(64)}`)],
        ] as const) {
          const request = await startRequest(
            dapp,
            'wallet_watchAsset',
            requestData
          );
          const rejected = await settle(dapp, request);
          expect(rejected.error?.code).toBe(-32602);
          expect(rejected.result).toBeUndefined();
          expect(
            wallet!.context
              .pages()
              .filter((page) => page.url().includes('/external'))
          ).toHaveLength(0);
          expect(contractReads).toEqual([]);
          settlements.push({
            action: `invalid-${label}`,
            code: rejected.error?.code,
          });
        }
        expect(await matching()).toEqual([]);
      }
    );
    for (const tokenId of ['7', '8']) {
      await step(
        `review and durably add ERC1155 ID ${tokenId} through wallet_watchAsset`,
        async (capture) => {
          const request = await startRequest(
            dapp,
            'wallet_watchAsset',
            watch(tokenId)
          );
          // ID8 must open its own approval even after ID7 at the same contract
          // is saved; popupFor fails if the provider returns a false no-op.
          const popup = await popupFor(wallet!.context, dapp, request);
          await expect(
            popup
              .locator('p')
              .filter({ hasText: en.send.tokenId })
              .locator('span')
          ).toHaveText(tokenId);
          await expect(
            popup.getByText(QUANTITIES[tokenId], { exact: true })
          ).toBeVisible();
          const add = popup.getByRole('button', {
            name: en.buttons.addToken,
            exact: true,
          });
          await expect(add).toBeEnabled();
          expect(ownershipReads).toContainEqual({
            balance: QUANTITIES[tokenId],
            owner: fixture.evmAddresses[0].toLowerCase(),
            tokenId,
          });
          for (const width of [400, 320]) {
            await popup.setViewportSize({
              width,
              height: width === 320 ? 360 : 620,
            });
            await captureForegroundContrast(
              popup
                .locator('p')
                .filter({ hasText: en.send.tokenId })
                .locator('span'),
              info,
              `watch-token-id-${tokenId}-${width}`
            );
            await captureForegroundContrast(
              popup.getByText(QUANTITIES[tokenId], { exact: true }),
              info,
              `watch-quantity-${tokenId}-${width}`
            );
          }
          quantityGeometry.push({
            tokenId,
            ...(await popup
              .getByText(QUANTITIES[tokenId], { exact: true })
              .evaluate((node) => {
                node.scrollIntoView({ block: 'center' });
                return {
                  width: node.clientWidth,
                  scrollWidth: node.scrollWidth,
                };
              })),
          });
          await capture(popup);
          await clickClosingPopup({
            click: () => add.click(),
            isClosed: () => popup.isClosed(),
          });
          const accepted = await settle(dapp, request);
          expect(accepted.error).toBeUndefined();
          expect(accepted.result).toBe(true);
          await expect.poll(() => popup.isClosed()).toBe(true);
          const expected = expectedAssets(tokenId === '7' ? ['7'] : ['7', '8']);
          expect(await matching()).toEqual(expected);
          await expect.poll(persisted).toEqual(expected);
          settlements.push({
            action: `add-${tokenId}`,
            result: accepted.result,
          });
        }
      );
    }
    await step(
      'keep equivalent requests for the same token ID as successful no-ops',
      async () => {
        for (const tokenId of ['7', '0x07', '0007']) {
          const request = await startRequest(
            dapp,
            'wallet_watchAsset',
            watch(tokenId)
          );
          const duplicate = await settle(dapp, request);
          expect(duplicate.error).toBeUndefined();
          expect(duplicate.result).toBe(true);
          expect(
            wallet!.context
              .pages()
              .filter((page) => page.url().includes('/external'))
          ).toHaveLength(0);
          expect(await matching()).toEqual(expectedAssets(['7', '8']));
          expect(await persisted()).toEqual(expectedAssets(['7', '8']));
          settlements.push({
            action: `duplicate-${tokenId}`,
            result: duplicate.result,
          });
        }
      }
    );
    await step(
      'keep ordinary and uint256-max quantities readable without horizontal overflow',
      async () => {
        const ordinary = quantityGeometry.find(
          (entry) => entry.tokenId === '8'
        )!;
        const large = quantityGeometry.find((entry) => entry.tokenId === '7')!;
        expect(ordinary.scrollWidth).toBeLessThanOrEqual(ordinary.width);
        expect(large.scrollWidth).toBeLessThanOrEqual(large.width);
      }
    );
    await step(
      'retain both exact token identities after the wallet document reloads',
      async () => {
        await wallet!.page.reload();
        await wallet!.waitAppReady();
        expect(await matching()).toEqual(expectedAssets(['7', '8']));
        expect(await persisted()).toEqual(expectedAssets(['7', '8']));
        expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('watch-asset-erc1155-identity-runtime-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            contract: CONTRACT,
            quantities: QUANTITIES,
            contractReads,
            ownershipReads,
            settlements,
            quantityGeometry,
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
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
