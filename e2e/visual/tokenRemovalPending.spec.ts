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

const CONTRACT = '0x000000000000000000000000000000000000e020';
const KEEP_CONTRACT = '0x000000000000000000000000000000000000e021';
const SYMBOL = 'REMOVE20';
const KEEP_SYMBOL = 'KEEP20';
const QUANTITY = '1000000000000000000';

test('ERC20 removal waits for one genuine callback and preserves the other token', async ({}, info) => {
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
  const ownershipReads: { balance: string; contract: string; owner: string }[] =
    [];
  const deniedWrites: string[] = [];
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenRemovalSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin NEVM Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('token-removal-pending', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only ABI-encoded HTTP reads are synthetic. Detection, import and
    // deletion use the real SDK and wallet controller.
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
      const targetOf = (call: any) =>
        (call.params?.[0]?.to || call.params?.[0])?.toLowerCase();
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call?.method) &&
            [CONTRACT, KEEP_CONTRACT].includes(targetOf(call))
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        const target = targetOf(call);
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (
          call.method === 'eth_getCode' &&
          [CONTRACT, KEEP_CONTRACT].includes(target)
        ) {
          reads.push('eth_getCode:' + target);
          result = '0x60006000fd';
        }
        if (
          call.method === 'eth_call' &&
          [CONTRACT, KEEP_CONTRACT].includes(target)
        ) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          if (prefix === selector('name()'))
            result = abi.encode(
              ['string'],
              ['Synthetic ' + (target === CONTRACT ? SYMBOL : KEEP_SYMBOL)]
            );
          if (prefix === selector('symbol()'))
            result = abi.encode(
              ['string'],
              [target === CONTRACT ? SYMBOL : KEEP_SYMBOL]
            );
          if (prefix === selector('decimals()'))
            result = abi.encode(['uint8'], [18]);
          if (prefix === selector('totalSupply()'))
            result = abi.encode(['uint256'], [QUANTITY]);
          if (prefix === selector('supportsInterface(bytes4)'))
            result = abi.encode(['bool'], [false]);
          if (prefix === selector('balanceOf(address)')) {
            const [owner] = abi.decode(['address'], '0x' + data.slice(10));
            const balance =
              owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase()
                ? QUANTITY
                : '0';
            ownershipReads.push({
              contract: target,
              owner: owner.toLowerCase(),
              balance,
            });
            result = abi.encode(['uint256'], [balance]);
          }
          if (result !== undefined) reads.push(target + ':' + prefix);
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
    const removeRow = page.getByRole('listitem').filter({
      has: page.getByRole('button', {
        name: 'Delete ' + SYMBOL + ' token',
        exact: true,
      }),
    });
    const keepRow = page.getByRole('listitem').filter({
      has: page.getByRole('button', {
        name: 'Delete ' + KEEP_SYMBOL + ' token',
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
    await wallet.step('open ordinary manual token import', async (capture) => {
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
      } finally {
        if (!page.isClosed()) await capture(page);
      }
    });
    for (const [contract, symbol] of [
      [CONTRACT, SYMBOL],
      [KEEP_CONTRACT, KEEP_SYMBOL],
    ]) {
      await wallet.step(
        'verify and import ERC20 ' +
          symbol +
          ' through the real SDK and wallet controller',
        async (capture) => {
          try {
            await page.locator('#custom-token-contract').fill(contract);
            const add = page.getByRole('button', {
              name: 'Import ' + symbol + ' token',
              exact: true,
            });
            await expect(add).toBeEnabled();
            expect(ownershipReads).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ contract, balance: QUANTITY }),
              ])
            );
            await add.click();
            await expect(add).toBeDisabled();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
    }
    await wallet.step(
      'return through Back and show both saved ERC20 tokens',
      async (capture) => {
        try {
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await expect(removeRow).toHaveCount(1);
          await expect(keepRow).toHaveCount(1);
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
            (window as any).__tokenDeleteDelivery = {
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
          await removeRow
            .getByRole('button', {
              name: 'Delete ' + SYMBOL + ' token',
              exact: true,
            })
            .click();
          const dialog = page.getByRole('dialog', {
            name: en.tokens.deleteToken.replace('{{symbol}}', SYMBOL),
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
                (window as any).__tokenDeleteDelivery.snapshot()
              )
            )
            .toMatchObject({
              forwardedDeletes: 1,
              genuineReplies: 1,
              held: true,
              controllerErrors: [false],
              transportErrors: [null],
              released: false,
              requestParams: [[CONTRACT, 5700, undefined, removalScope]],
            });
          observations.pending = await page.evaluate(() =>
            (window as any).__tokenDeleteDelivery.snapshot()
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
      'deliver the unchanged saved removal result and retain the other imported token',
      async (capture) => {
        try {
          await page.evaluate(() =>
            (window as any).__tokenDeleteDelivery.release()
          );
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(removeRow).toHaveCount(0);
          await expect(keepRow).toHaveCount(1);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'remove the remaining ERC20 through the real controller and reload the persisted empty list',
      async (capture) => {
        try {
          await keepRow
            .getByRole('button', {
              name: 'Delete ' + KEEP_SYMBOL + ' token',
              exact: true,
            })
            .click();
          await page
            .getByRole('dialog', {
              name: en.tokens.deleteToken.replace('{{symbol}}', KEEP_SYMBOL),
              exact: true,
            })
            .getByRole('button', { name: en.buttons.delete, exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(() =>
                (window as any).__tokenDeleteDelivery.snapshot()
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
                [CONTRACT, 5700, undefined, removalScope],
                [KEEP_CONTRACT, 5700, undefined, removalScope],
              ],
            });
          observations.completed = await page.evaluate(() =>
            (window as any).__tokenDeleteDelivery.snapshot()
          );
          await page.evaluate(() =>
            (window as any).__tokenDeleteDelivery.restore()
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
          const timing = (window as any).__tokenDeleteDelivery;
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
            contracts: [CONTRACT, KEEP_CONTRACT],
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
