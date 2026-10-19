import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id, keccak256, toUtf8Bytes } from 'ethers';
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

const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'REMOVE1155';
const TOKEN_IDS = ['7', '8'];
const QUANTITY = '1';

test('NFT removal waits for one genuine callback and preserves the remaining token ID', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  const abi = AbiCoder.defaultAbiCoder();
  const selector = (signature: string) => id(signature).slice(0, 10);
  const reads: string[] = [];
  const ownershipReads: { balances: string[]; tokenIds: string[] }[] = [];
  const deniedWrites: string[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NftRemovalSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin NEVM Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('nft-removal-lifecycle', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Supply ABI-encoded contract reads, not controller results or renderer
    // state. The real SDK detects ERC1155 and derives numeric/raw quantities.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push('attempted-write-or-sign');
        return route.abort('blockedbyclient');
      }
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call?.method) &&
            (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() ===
              CONTRACT
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call?.method === 'eth_chainId') result = '0x1644';
        const target = (
          call?.params?.[0]?.to || call?.params?.[0]
        )?.toLowerCase();
        if (call?.method === 'eth_getCode' && target === CONTRACT) {
          reads.push('eth_getCode');
          result = '0x60006000fd';
        }
        if (call?.method === 'eth_call' && target === CONTRACT) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          if (prefix === selector('name()')) {
            reads.push('name');
            result = abi.encode(['string'], ['Synthetic Removal Editions']);
          }
          if (prefix === selector('symbol()')) {
            reads.push('symbol');
            result = abi.encode(['string'], [SYMBOL]);
          }
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            reads.push(`supportsInterface:${value}`);
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
              reads.push('balanceOf');
              result = abi.encode(
                ['uint256'],
                [TOKEN_IDS.includes(String(tokenId)) ? QUANTITY : '0']
              );
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
            ) {
              const ids = Array.from(tokenIds, String);
              const balances = ids.map((value) =>
                TOKEN_IDS.includes(value) ? QUANTITY : '0'
              );
              reads.push('balanceOfBatch');
              ownershipReads.push({ tokenIds: ids, balances });
              result = abi.encode(['uint256[]'], [balances]);
            }
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
        body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const imports = page.getByRole('button', {
      name: 'Import ' + SYMBOL + ' token',
      exact: true,
    });
    const rows = page.getByRole('listitem').filter({
      has: page.getByRole('button', {
        name: 'Delete ' + SYMBOL + ' collection',
        exact: true,
      }),
    });
    await wallet.step(
      'import a disposable wallet and select the EVM fixture',
      async (capture) => {
        try {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'open ordinary manual import and validate the synthetic ERC1155 contract',
      async (capture) => {
        try {
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
          await field.fill(CONTRACT);
          await expect(page.locator('#custom-token-id')).toBeVisible();
          expect(reads).toContain('supportsInterface:0xd9b67a26');
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    for (const tokenId of TOKEN_IDS) {
      await wallet.step(
        'verify and import token ID ' +
          tokenId +
          ' through the real SDK and wallet controller',
        async (capture) => {
          try {
            await page.locator('#custom-token-id').fill(tokenId);
            await expect(imports).toBeEnabled();
            await imports.click();
            await expect(imports).toBeDisabled();
            expect(ownershipReads).toContainEqual({
              tokenIds: [tokenId],
              balances: ['1'],
            });
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
    }
    await wallet.step(
      'return through Back and show both saved NFT token IDs',
      async (capture) => {
        try {
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
            .click();
          await expect(rows).toHaveCount(2);
          await expect(rows.filter({ hasText: /#7(?:\s|$)/ })).toHaveCount(1);
          await expect(rows.filter({ hasText: /#8(?:\s|$)/ })).toHaveCount(1);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    const scopeInput = await page.evaluate(
      () =>
        new Promise<{ account: string; network: string }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
            const { activeAccount, activeNetwork, accounts } = state.vault;
            const account = accounts[activeAccount.type][activeAccount.id];
            // Return only the public identity inputs used by navigation scope.
            resolve({
              account: JSON.stringify([
                activeAccount.type,
                activeAccount.id,
                account.address,
                account.xpub,
              ]),
              network: JSON.stringify([
                activeNetwork.kind,
                activeNetwork.chainId,
                activeNetwork.slip44,
                state.vaultGlobal.activeSlip44,
                activeNetwork.url,
                activeNetwork.apiUrl,
              ]),
            });
          });
        })
    );
    const removalScope = {
      account: keccak256(toUtf8Bytes(scopeInput.account)),
      network: keccak256(toUtf8Bytes(scopeInput.network)),
    };
    await wallet.step(
      'hold only the genuine completed removal callback and keep its confirmation pending',
      async (capture) => {
        try {
          await page.evaluate(() => {
            const original = chrome.runtime.sendMessage;
            let held: (() => void) | undefined;
            let receivedAt = 0;
            const evidence = {
              forwardedDeletes: 0,
              genuineReplies: 0,
              requestParams: [] as unknown[],
              controllerErrors: [] as boolean[],
              transportErrors: [] as (string | null)[],
              released: false,
              heldForMs: 0,
            };
            // Timing only: execute every real request immediately and eventually
            // deliver its identical response. Never replace data or outcomes.
            (chrome.runtime.sendMessage as any) = (...args: any[]) => {
              const [message, callback] = args;
              if (
                message?.type !== 'CONTROLLER_ACTION' ||
                JSON.stringify(message.data?.methods) !==
                  JSON.stringify(['wallet', 'deleteTokenInfo']) ||
                typeof callback !== 'function'
              )
                return (original as any).apply(chrome.runtime, args);
              const index = ++evidence.forwardedDeletes;
              evidence.requestParams.push(message.data?.params);
              return original.call(chrome.runtime, message, (response) => {
                evidence.genuineReplies += 1;
                const transportError =
                  chrome.runtime.lastError?.message || null;
                evidence.transportErrors.push(transportError);
                evidence.controllerErrors.push(
                  Boolean(response?.error || response?.success === false)
                );
                if (index === 1 && !transportError) {
                  receivedAt = performance.now();
                  held = () => callback(response);
                } else callback(response);
              });
            };
            (window as any).__nftDeleteDelivery = {
              snapshot: () => ({ ...evidence, held: Boolean(held) }),
              release: () => {
                if (!held) throw new Error('No genuine removal callback held');
                evidence.heldForMs = performance.now() - receivedAt;
                evidence.released = true;
                const deliver = held;
                held = undefined;
                deliver();
              },
              restore: () => {
                chrome.runtime.sendMessage = original;
              },
            };
          });
          await rows
            .filter({ hasText: /#7(?:\s|$)/ })
            .getByRole('button', {
              name: 'Delete ' + SYMBOL + ' collection',
              exact: true,
            })
            .click();
          const dialog = page.getByRole('dialog', {
            name: en.send.deleteCollection,
            exact: true,
          });
          const confirm = dialog.getByRole('button', {
            name: en.buttons.delete,
            exact: true,
          });
          await confirm.click();
          await expect
            .poll(() =>
              page.evaluate(() =>
                (window as any).__nftDeleteDelivery.snapshot()
              )
            )
            .toMatchObject({
              forwardedDeletes: 1,
              genuineReplies: 1,
              held: true,
              controllerErrors: [false],
              transportErrors: [null],
              released: false,
              requestParams: [[CONTRACT, 5700, '7', removalScope]],
            });
          observations.pending = await page.evaluate(() =>
            (window as any).__nftDeleteDelivery.snapshot()
          );
          await expect(confirm).toBeDisabled();
          await expect(
            dialog.getByRole('button', { name: en.buttons.cancel, exact: true })
          ).toBeDisabled();
          await page.keyboard.press('Escape');
          await expect(dialog).toBeVisible();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'deliver the unchanged saved removal result and retain the other imported token ID',
      async (capture) => {
        try {
          await page.evaluate(() =>
            (window as any).__nftDeleteDelivery.release()
          );
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(rows).toHaveCount(1);
          await expect(rows.filter({ hasText: /#7(?:\s|$)/ })).toHaveCount(0);
          await expect(rows.filter({ hasText: /#8(?:\s|$)/ })).toHaveCount(1);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'remove the last token through the real controller and reload the persisted empty list',
      async (capture) => {
        try {
          await rows
            .getByRole('button', {
              name: 'Delete ' + SYMBOL + ' collection',
              exact: true,
            })
            .click();
          await page
            .getByRole('dialog', {
              name: en.send.deleteCollection,
              exact: true,
            })
            .getByRole('button', { name: en.buttons.delete, exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(() =>
                (window as any).__nftDeleteDelivery.snapshot()
              )
            )
            .toMatchObject({
              forwardedDeletes: 2,
              genuineReplies: 2,
              held: false,
              released: true,
              controllerErrors: [false, false],
              transportErrors: [null, null],
              requestParams: [
                [CONTRACT, 5700, '7', removalScope],
                [CONTRACT, 5700, '8', removalScope],
              ],
            });
          observations.completed = await page.evaluate(() =>
            (window as any).__nftDeleteDelivery.snapshot()
          );
          await page.evaluate(() =>
            (window as any).__nftDeleteDelivery.restore()
          );
          await expect(
            page.getByText(en.home.youHaveNoTokens, { exact: true })
          ).toBeVisible();
          await page.reload();
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await expect(
            page.getByText(en.home.youHaveNoTokens, { exact: true })
          ).toBeVisible();
          expect([...deniedWrites, ...routes!.deniedWrites]).toEqual([]);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    status = 'passed';
  } finally {
    try {
      let cleanup: unknown = null;
      if (wallet && !wallet.page.isClosed()) {
        cleanup = await wallet.page.evaluate(() => {
          const timing = (window as any).__nftDeleteDelivery;
          if (!timing) return null;
          const beforeCleanup = timing.snapshot();
          if (beforeCleanup.held) timing.release();
          timing.restore();
          return {
            before: beforeCleanup,
            after: timing.snapshot(),
            restored: true,
          };
        });
      }
      await info.attach('runtime-and-real-removal-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            callbackDeliveryTimingOnly: true,
            persistenceFailureInjected: false,
            contract: CONTRACT,
            tokenIds: TOKEN_IDS,
            reads,
            ownershipReads,
            observations,
            cleanup,
            deniedWrites: [...deniedWrites, ...(routes?.deniedWrites ?? [])],
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
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
