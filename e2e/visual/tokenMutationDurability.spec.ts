import { expect, test, type Page, type Worker } from '@playwright/test';
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
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CONTRACT = '0x000000000000000000000000000000000000da7a';
const SYMBOL = 'DURABLE';
const FAILURE = 'Synthetic token membership storage refusal';

async function membership(page: Page) {
  return page.evaluate(async (contract) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, activeNetwork } = state.vault;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const records = await chrome.storage.local.get(key);
    const tokens = (vault: any) =>
      (
        vault?.accountAssets?.[activeAccount.type]?.[activeAccount.id]
          ?.ethereum || []
      )
        .filter(
          (token: any) =>
            token.contractAddress?.toLowerCase() === contract &&
            token.chainId === activeNetwork.chainId
        )
        .map((token: any) => ({
          id: token.id,
          contract: token.contractAddress.toLowerCase(),
          symbol: token.tokenSymbol,
          chainId: token.chainId,
        }));
    return {
      active: activeAccount,
      chainId: activeNetwork.chainId,
      slip44: state.vaultGlobal.activeSlip44,
      live: tokens(state.vault),
      saved: tokens(records[key]),
    };
  }, CONTRACT);
}

async function installStorageRefusal(worker: Worker, slip44: number) {
  await worker.evaluate(
    ({ contract, key, failure }) => {
      const local = chrome.storage.local;
      const original = local.set;
      const probe = {
        mode: 'add',
        attempts: { add: 0, remove: 0 },
        failures: { add: 0, remove: 0 },
        restore: () => {
          local.set = original;
          delete (globalThis as any).__tokenMutationStorage;
        },
      };
      (globalThis as any).__tokenMutationStorage = probe;
      local.set = ((items: Record<string, any>, ...args: any[]) => {
        const vault = items[key];
        const account = vault?.activeAccount;
        if (account) {
          const present = (
            vault.accountAssets?.[account.type]?.[account.id]?.ethereum || []
          ).some(
            (token: any) =>
              token.contractAddress?.toLowerCase() === contract &&
              token.chainId === 5700
          );
          const mode = probe.mode as 'add' | 'remove';
          if ((mode === 'add' && present) || (mode === 'remove' && !present)) {
            probe.attempts[mode] += 1;
            if (!probe.failures[mode]) {
              probe.failures[mode] += 1;
              // Fail only the actual matching Chrome write. Controller calls,
              // transport replies, Redux and all other storage operations stay real.
              throw new Error(`${failure} (${mode})`);
            }
          }
        }
        return (original as any).call(local, items, ...args);
      }) as typeof local.set;
    },
    { contract: CONTRACT, key: `state-vault-${slip44}`, failure: FAILURE }
  );
}

test('refused token imports and removals stay retryable and the final membership survives a cold worker', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenDurabilitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const deniedWrites: string[] = [];
  const reads: string[] = [];
  try {
    wallet = await PaliWallet.launch('token-mutation-durability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const abi = AbiCoder.defaultAbiCoder();
    const responses = new Map([
      [
        id('name()').slice(0, 10),
        abi.encode(['string'], ['Durable synthetic token']),
      ],
      [id('symbol()').slice(0, 10), abi.encode(['string'], [SYMBOL])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [6])],
      [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], ['1000000'])],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push('write-or-sign');
        return route.abort('blockedbyclient');
      }
      const targetsToken = (call: any) =>
        (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() === CONTRACT;
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call.method) &&
            targetsToken(call)
        )
      )
        return route.fallback();
      const values = calls.map((call: any) => {
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (targetsToken(call)) {
          if (call.method === 'eth_getCode') result = '0x60006000fd';
          if (call.method === 'eth_call') {
            const data = call.params[0].data as string;
            reads.push(data.slice(0, 10));
            result = responses.get(data.slice(0, 10));
            if (data.startsWith(id('balanceOf(address)').slice(0, 10))) {
              const [owner] = abi.decode(['address'], `0x${data.slice(10)}`);
              if (owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase())
                result = abi.encode(['uint256'], ['1000000']);
            }
          }
        }
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: {
                code: -32000,
                message: 'Unsupported synthetic token read',
              },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? values : values[0]),
      });
    });
    const page = wallet.page;
    const importButton = page.getByRole('button', {
      name: `Import ${SYMBOL} token`,
      exact: true,
    });
    const deleteButton = page.getByRole('button', {
      name: `Delete ${SYMBOL} token`,
      exact: true,
    });
    const openDelete = async () => {
      await deleteButton.click();
      const dialog = page.getByRole('dialog', {
        name: en.tokens.deleteToken.replace('{{symbol}}', SYMBOL),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const confirm = dialog.getByRole('button', {
        name: en.buttons.delete,
        exact: true,
      });
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
    };
    await wallet.step(
      'prepare a genuine custom-token import behind the network fence',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
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
        await field.fill(CONTRACT);
        await expect(importButton).toBeEnabled();
        expect(reads).toContain(id('symbol()').slice(0, 10));
      }
    );
    const before = await membership(page);
    expect(before).toMatchObject({
      chainId: 5700,
      slip44: 60,
      live: [],
      saved: [],
    });
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await installStorageRefusal(worker!, before.slip44);
    await wallet.step(
      'refuse the first real token write and retry the same import',
      async () => {
        await importButton.click();
        await expect(
          page.getByText(`${FAILURE} (add)`, { exact: true })
        ).toBeVisible();
        await expect(importButton).toBeEnabled();
        expect(await membership(page)).toEqual(before);
        await importButton.click();
        await expect(
          page.getByText(
            en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', SYMBOL),
            { exact: true }
          )
        ).toBeVisible();
        await expect(importButton).toBeDisabled();
        await expect
          .poll(() => membership(page))
          .toMatchObject({
            live: [{ contract: CONTRACT }],
            saved: [{ contract: CONTRACT }],
          });
        const imported = await membership(page);
        expect(imported.live).toEqual([
          {
            id: `${CONTRACT}-5700`,
            contract: CONTRACT,
            symbol: SYMBOL,
            chainId: 5700,
          },
        ]);
        expect(imported.saved).toEqual(imported.live);
        expect(imported.active).toEqual(before.active);
        observations.imported = imported;
      }
    );
    await wallet.step(
      'refuse the first removal and retry from the still-present token row',
      async () => {
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        await expect(deleteButton).toBeVisible();
        await worker!.evaluate(() => {
          (globalThis as any).__tokenMutationStorage.mode = 'remove';
        });
        const beforeRemoval = await membership(page);
        await openDelete();
        await expect(
          page.getByText(`${FAILURE} (remove)`, { exact: true })
        ).toBeVisible();
        await expect(deleteButton).toBeVisible();
        expect(await membership(page)).toEqual(beforeRemoval);
        await openDelete();
        await expect(deleteButton).toHaveCount(0);
        await expect(
          page.getByText(en.home.youHaveNoTokens, { exact: true })
        ).toBeVisible();
        expect(await membership(page)).toEqual(before);
        const probe = await worker!.evaluate(() => {
          const storedProbe = (globalThis as any).__tokenMutationStorage;
          const result = {
            attempts: storedProbe.attempts,
            failures: storedProbe.failures,
          };
          storedProbe.restore();
          return result;
        });
        observations.probe = probe;
        expect(probe).toMatchObject({
          failures: { add: 1, remove: 1 },
        });
        expect(probe.attempts.add).toBeGreaterThanOrEqual(2);
        expect(probe.attempts.remove).toBeGreaterThanOrEqual(2);
      }
    );
    await wallet.step(
      'verify the final durable membership after a cold worker restart',
      async () => {
        const cdp = await wallet!.context.newCDPSession(page);
        try {
          const { targetInfos } = await cdp.send('Target.getTargets');
          const target = targetInfos.find(
            (entry) =>
              entry.type === 'service_worker' &&
              entry.url.startsWith(`chrome-extension://${wallet!.extensionId}/`)
          );
          expect(target).toBeDefined();
          expect(
            (
              await cdp.send('Target.closeTarget', {
                targetId: target!.targetId,
              })
            ).success
          ).toBe(true);
        } finally {
          await cdp.detach();
        }
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#unlock-btn').isVisible())
          await wallet!.unlock();
        await wallet!.ensureOnHome();
        await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (identity) => {
            observations.restartedWorker = identity;
          }
        );
        expect(await membership(page)).toEqual(before);
        await page.locator('#assets-btn').click();
        await expect(
          page.getByText(en.home.youHaveNoTokens, { exact: true })
        ).toBeVisible();
      }
    );
    expect([...deniedWrites, ...routes.deniedWrites]).toEqual([]);
    await info.attach('token-mutation-durability', {
      contentType: 'application/json',
      body: JSON.stringify({
        runtime: extensionEvidence(),
        sourceSha256: createHash('sha256')
          .update(fs.readFileSync(__filename))
          .digest('hex'),
        observations,
        reads,
        deniedWrites: [...deniedWrites, ...routes.deniedWrites],
        fixtureReads: routes.reads,
        proxyDeniedConnections: server.blocked.length,
        simulated: true,
        controllerStateReplaced: false,
      }),
    });
    status = 'passed';
  } finally {
    await worker
      ?.evaluate(() => (globalThis as any).__tokenMutationStorage?.restore())
      .catch(() => undefined);
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
