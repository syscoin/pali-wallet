// The production form, refresh path and fee reads remain unmodified.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { parseEther } from 'ethers';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
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

const RPC = 'https://rpc.tanenbaum.io';
const CHAIN = 5700;
const INITIAL_WEI = '10000000000000000000';
const scenarios = [
  {
    id: 'unchanged',
    balanceWei: INITIAL_WEI,
    admitsPreview: true,
    isMax: true,
  },
  {
    id: 'increase-1001-wei',
    balanceWei: '10000000000000001001',
    admitsPreview: false,
    isMax: false,
  },
  {
    id: 'increase-100000-wei',
    balanceWei: '10000000000000100000',
    admitsPreview: false,
    isMax: false,
  },
  {
    id: 'increase-one-coin',
    balanceWei: '11000000000000000000',
    admitsPreview: true,
    isMax: false,
  },
] as const;

// Only public HTTP replies change. This layer neither replaces controller
// results nor writes Redux, navigation state, account state or DOM form values.
async function installNativeRpc(
  context: BrowserContext,
  sender: string,
  recipient: string
) {
  let phase = 'onboarding';
  let balanceWei = INITIAL_WEI;
  const reads: { method: string; phase: string }[] = [];
  const balanceReads: {
    address: string;
    balanceWei: string;
    phase: string;
  }[] = [];
  const deniedWrites: string[] = [];
  const deniedUnknown: string[] = [];
  const lower = (value: unknown) => String(value).toLowerCase();
  const accounts = new Set([sender, recipient].map(lower));
  const codeTargets = new Set(
    [
      sender,
      recipient,
      PALI_CREATE2_DEPLOYER_ADDRESS,
      PALI_MULTICALL3_CANONICAL_ADDRESS,
      ...getPaliInfrastructureContracts(CHAIN).map((entry) => entry.address),
    ].map(lower)
  );
  const blockHash = '0x' + '41'.repeat(32);
  const block = {
    number: '0x1',
    hash: blockHash,
    parentHash: '0x' + '40'.repeat(32),
    nonce: '0x0000000000000000',
    timestamp: '0x6553f100',
    difficulty: '0x0',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    miner: '0x' + '00'.repeat(20),
    extraData: '0x',
    transactions: [],
    baseFeePerGas: '0x3b9aca00',
  };
  const reply = (method: string, params: any[]): unknown => {
    reads.push({ method, phase });
    switch (method) {
      case 'eth_chainId':
        return '0x1644';
      case 'net_version':
        return String(CHAIN);
      case 'eth_blockNumber':
        return '0x1';
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_getBalance': {
        if (!accounts.has(lower(params[0]))) break;
        const value = lower(params[0]) === lower(sender) ? balanceWei : '0';
        balanceReads.push({
          address: lower(params[0]),
          balanceWei: value,
          phase,
        });
        return '0x' + BigInt(value).toString(16);
      }
      case 'eth_getTransactionCount':
        if (accounts.has(lower(params[0]))) return '0x0';
        break;
      case 'eth_getCode':
        if (codeTargets.has(lower(params[0]))) return '0x';
        break;
      case 'eth_call':
        if (codeTargets.has(lower(params[0]?.to))) return '0x';
        break;
      case 'eth_getLogs':
        if (params[0] && typeof params[0] === 'object') return [];
        break;
      case 'eth_getTransactionByHash':
      case 'eth_getTransactionReceipt':
        if (/^0x[0-9a-f]{64}$/i.test(String(params[0]))) return null;
        break;
      case 'eth_getBlockByNumber':
        if (['latest', 'pending', '0x1'].includes(params[0])) return block;
        break;
      case 'eth_getBlockByHash':
        if (params[0] === blockHash) return block;
        break;
      case 'eth_feeHistory':
        return {
          oldestBlock: '0x1',
          baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
          gasUsedRatio: [0.5],
          reward: [['0x3b9aca00']],
        };
      case 'eth_estimateGas': {
        const tx = params[0];
        if (
          tx &&
          lower(tx.to) === lower(recipient) &&
          (!tx.from || lower(tx.from) === lower(sender)) &&
          (!tx.data || tx.data === '0x') &&
          /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(String(tx.value ?? '0x0')) &&
          BigInt(tx.value ?? '0x0') <= BigInt(INITIAL_WEI)
        )
          return '0x5208';
        break;
      }
    }
    throw new Error('Unallowlisted native MAX fixture read: ' + method);
  };
  await context.route(RPC + '/', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: any;
    try {
      body = request.postDataJSON();
    } catch {
      deniedUnknown.push('non-JSON RPC');
      return route.abort('blockedbyclient');
    }
    const calls = Array.isArray(body) ? body : [body];
    if (
      request.method() !== 'POST' ||
      url.origin !== RPC ||
      url.pathname !== '/' ||
      url.search ||
      url.username ||
      url.password ||
      !calls.length ||
      calls.length > 32 ||
      calls.some(
        (call) =>
          call?.jsonrpc !== '2.0' ||
          typeof call.method !== 'string' ||
          !Array.isArray(call.params)
      )
    ) {
      deniedUnknown.push('invalid RPC envelope');
      return route.abort('blockedbyclient');
    }
    const writes = calls.filter((call) =>
      /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
        call.method
      )
    );
    if (writes.length) {
      deniedWrites.push(...writes.map((call) => call.method));
      return route.abort('blockedbyclient');
    }
    const replies = calls.map((call) => {
      try {
        return {
          jsonrpc: '2.0',
          id: call.id,
          result: reply(call.method, call.params),
        };
      } catch (error) {
        deniedUnknown.push(
          error instanceof Error ? error.message : String(error)
        );
        return {
          jsonrpc: '2.0',
          id: call.id,
          error: {
            code: -32602,
            message: 'Unsupported native MAX fixture read',
          },
        };
      }
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
    });
  });
  return {
    setBalance(nextPhase: string, value: string) {
      if (!/^[0-9]+$/.test(value)) throw new Error('Invalid fixture balance');
      phase = nextPhase;
      balanceWei = value;
    },
    reads,
    balanceReads,
    deniedWrites,
    deniedUnknown,
  };
}

// Read-only public projection. No wallet secret or full vault is exported.
async function publicNativeState(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        address: string;
        balance: string;
        chainId: number;
        loading: boolean;
        rpcUrl: string;
        type: string;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Public state timeout')),
          5000
        );
        chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
          try {
            if (chrome.runtime.lastError)
              throw new Error(chrome.runtime.lastError.message);
            const { vault, vaultGlobal } = state;
            const ref = vault.activeAccount;
            const account = vault.accounts[ref.type][ref.id];
            resolve({
              type: ref.type,
              address: account.address,
              balance: String(account.balances.ethereum),
              chainId: vault.activeNetwork.chainId,
              rpcUrl: vault.activeNetwork.url,
              loading: Boolean(vaultGlobal.loadingStates?.isLoadingBalances),
            });
          } catch (error) {
            reject(error);
          } finally {
            clearTimeout(timer);
          }
        });
      })
  );
}

test('native MAX revalidates a live balance change without rewriting the reviewed amount', async ({}, info) => {
  test.setTimeout(180_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  expect(runtime.version).toBe(packageJson.version);
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NativeMaxBalanceSyntheticOnly!2026',
    chainId: CHAIN,
    networkLabel: 'Syscoin NEVM Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let rpc: Awaited<ReturnType<typeof installNativeRpc>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown>[] = [];
  try {
    wallet = await PaliWallet.launch('native-max-balance', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    rpc = await installNativeRpc(
      wallet.context,
      fixture.evmAddresses[0],
      fixture.evmAddresses[1]
    );
    const page = wallet.page;
    const refresh = page.getByRole('button', {
      name: en.header.refresh,
      exact: true,
    });
    await wallet.step('native-max-balance-enable-normal-refresh', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet!.gotoRoute('#/settings/advanced');
      await page.locator('#advanced-refresh').click();
      await page.getByRole('dialog').locator('#confirm-btn').click();
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await wallet!.ensureOnHome();
      await expect(refresh).toBeVisible();
      wallet!.summary.addAddress('native-max-sender', fixture.evmAddresses[0]);
      wallet!.summary.addAddress(
        'native-max-recipient',
        fixture.evmAddresses[1]
      );
    });
    for (const scenario of scenarios) {
      await wallet.step(
        'native-max-' + scenario.id + '-open-and-select-max',
        async () => {
          rpc!.setBalance(scenario.id + '-baseline', INITIAL_WEI);
          await wallet!.ensureOnHome();
          const readCount = rpc!.balanceReads.length;
          await refresh.click();
          await expect
            .poll(() => rpc!.balanceReads.length)
            .toBeGreaterThan(readCount);
          await expect
            .poll(async () => {
              const state = await publicNativeState(page);
              return !state.loading && parseEther(state.balance).toString();
            })
            .toBe(INITIAL_WEI);
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
          await page
            .getByPlaceholder(en.send.receiver, { exact: true })
            .fill(fixture.evmAddresses[1]);
          await expect(page.locator('#send-eth-next-btn')).toBeEnabled();
          await page.getByRole('button', { name: 'MAX', exact: true }).click();
          await expect(
            page.getByPlaceholder(en.send.amount, { exact: true })
          ).toHaveValue('10');
        }
      );
      await wallet.step(
        'native-max-' + scenario.id + '-refresh-and-validate',
        async () => {
          const form = await page.locator('#send-form').elementHandle();
          expect(form).not.toBeNull();
          const before = await publicNativeState(page);
          const readCount = rpc!.balanceReads.length;
          rpc!.setBalance(scenario.id, scenario.balanceWei);
          await refresh.click();
          await expect
            .poll(() =>
              rpc!.balanceReads
                .slice(readCount)
                .some(
                  (entry) =>
                    entry.phase === scenario.id &&
                    entry.address === fixture.evmAddresses[0].toLowerCase() &&
                    entry.balanceWei === scenario.balanceWei
                )
            )
            .toBe(true);
          await expect
            .poll(async () => {
              const state = await publicNativeState(page);
              return !state.loading && parseEther(state.balance).toString();
            })
            .toBe(scenario.balanceWei);
          const after = await publicNativeState(page);
          expect(after).toMatchObject({
            type: before.type,
            address: fixture.evmAddresses[0],
            chainId: CHAIN,
            rpcUrl: RPC,
          });
          // A remount would erase the stale local MAX state and falsify this test.
          expect(await form!.evaluate((node) => node.isConnected)).toBe(true);
          await expect(
            page.getByPlaceholder(en.send.amount, { exact: true })
          ).toHaveValue('10');
          await page.locator('#send-eth-next-btn').click();
          if (!scenario.admitsPreview) {
            await expect(
              page.getByText(en.send.insufficientFundsForGas, { exact: true })
            ).toBeVisible();
            await expect(page).toHaveURL(/#\/send\/eth$/);
            await expect(
              page.getByRole('button', {
                name: en.buttons.confirm,
                exact: true,
              })
            ).toHaveCount(0);
            observations.push({
              scenario: scenario.id,
              before,
              after,
              rejectedForGas: true,
              amount: '10',
            });
          } else {
            await expect(page).toHaveURL(/#\/send\/confirm$/);
            const tx = await page.evaluate(() => {
              const value = history.state?.usr?.tx;
              return {
                amount: value?.amount,
                isMax: value?.isMax,
                sender: value?.sender,
                receivingAddress: value?.receivingAddress,
                transactionType: value?.transactionType,
              };
            });
            expect(tx).toMatchObject({
              amount: '10',
              isMax: scenario.isMax,
              sender: fixture.evmAddresses[0],
              receivingAddress: fixture.evmAddresses[1],
              transactionType: 'NATIVE_ETH',
            });
            await expect(
              page.getByRole('button', {
                name: en.buttons.confirm,
                exact: true,
              })
            ).toBeEnabled();
            observations.push({
              scenario: scenario.id,
              before,
              after,
              tx,
              unsignedReviewOnly: true,
            });
            // Deliberately never click transaction Confirm: no signing or send.
            await page
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/send\/eth$/);
          }
        }
      );
    }
    await wallet.step('native-max-balance-final-read-only-audit', async () => {
      expect(
        rpc!.reads.some((entry) => entry.method === 'eth_maxPriorityFeePerGas')
      ).toBe(true);
      expect(
        rpc!.reads.some((entry) => entry.method === 'eth_estimateGas')
      ).toBe(true);
      expect(rpc!.deniedWrites).toEqual([]);
      expect(rpc!.deniedUnknown).toEqual([]);
      expect(routes!.deniedWrites).toEqual([]);
    });
    status = 'passed';
  } finally {
    try {
      const evidence = info.outputPath('native-max-balance-evidence.json');
      fs.writeFileSync(
        evidence,
        JSON.stringify(
          {
            runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            syntheticPublicRpcOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            directRefreshControllerCalls: false,
            transactionConfirmClicked: false,
            observations,
            reads: rpc?.reads || [],
            balanceReads: rpc?.balanceReads || [],
            deniedUnknown: rpc?.deniedUnknown || [],
            deniedWrites: [
              ...(rpc?.deniedWrites || []),
              ...(routes?.deniedWrites || []),
            ],
            proxyDeniedConnections: server.blocked.length,
          },
          null,
          2
        )
      );
      await info.attach('native-max-balance-evidence', {
        path: evidence,
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
