import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
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

const SOURCE_RPC = 'https://rpc.tanenbaum.io';
const TARGET_RPC = 'https://edited-quality.synthetic.invalid';
const EXPLORER_API = 'https://explorer.tanenbaum.io/api';
const LABEL = 'Syscoin NEVM Testnet';
const PROVIDER_READ_CACHE_MS = 250;
const SLOW_FEEDBACK_MS = 5000;
const OLD_SLOW_READ_MS = 6000;

// Public observation only: neither controller methods nor state are replaced.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, activeNetwork, accounts } = state.vault;
    const target = state.vaultGlobal.networkTarget;
    const network = (value: any) =>
      value
        ? {
            chainId: value.chainId,
            kind: value.kind,
            url: value.url,
            label: value.label,
          }
        : null;
    return {
      active: network(activeNetwork),
      target: network(target),
      account: {
        ...activeAccount,
        address: accounts[activeAccount.type][activeAccount.id].address,
      },
      balance: String(
        accounts[activeAccount.type][activeAccount.id].balances.ethereum
      ),
      status: state.vaultGlobal.networkStatus,
      loadingBalances: state.vaultGlobal.loadingStates.isLoadingBalances,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
      quality: state.vaultGlobal.networkQuality ?? null,
      savedRpc: state.vaultGlobal.networks.ethereum[5700]?.url,
    };
  });

test('an edited same-chain RPC starts with its own network quality', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let holdOld = false;
  let holdTarget = false;
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => (releaseOld = resolve));
  let releaseTarget!: () => void;
  const targetGate = new Promise<void>((resolve) => (releaseTarget = resolve));
  const reads: Array<{
    fulfilledAt?: number;
    held: boolean;
    methods: string[];
    network: 'source' | 'target';
    receivedAt: number;
  }> = [];
  const deniedRequests: string[] = [];
  const explorerReads: string[] = [];
  const pageErrors: string[] = [];
  const observations: Record<string, unknown> = {};
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'RpcQualitySyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('network-quality-endpoint', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const knownAddress = (value: unknown) =>
      fixture.evmAddresses.some(
        (address) => address.toLowerCase() === String(value).toLowerCase()
      );
    await wallet.context.route(EXPLORER_API + '**', async (route) => {
      const url = new URL(route.request().url());
      const module = url.searchParams.get('module');
      const action = url.searchParams.get('action');
      const blockRead =
        (module === 'block' && action === 'eth_block_number') ||
        (module === 'proxy' && action === 'eth_blockNumber');
      const historyRead =
        module === 'account' &&
        [
          'txlist',
          'tokentx',
          'tokennfttx',
          'token1155tx',
          'pendingtxlist',
        ].includes(action || '') &&
        knownAddress(url.searchParams.get('address'));
      if (route.request().method() !== 'GET' || (!blockRead && !historyRead)) {
        deniedRequests.push('explorer:unexpected request');
        return route.abort('blockedbyclient');
      }
      explorerReads.push(`${module}:${action}`);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: '1',
          message: 'OK',
          result: blockRead ? '0x1' : [],
        }),
      });
    });
    await wallet.context.route(SOURCE_RPC + '/', async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        deniedRequests.push('source:invalid JSON');
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        route.request().method() !== 'POST' ||
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedRequests.push('source:non-read RPC');
        return route.abort('blockedbyclient');
      }
      if (!calls.some((call) => call?.method === 'eth_getBalance'))
        return route.fallback();
      const isHeld = holdOld;
      const replies = calls.map((call) => {
        if (
          call?.jsonrpc !== '2.0' ||
          call.method !== 'eth_getBalance' ||
          !Array.isArray(call.params) ||
          call.params.length !== 2 ||
          !knownAddress(call.params[0]) ||
          call.params[1] !== 'latest'
        )
          return undefined;
        return {
          jsonrpc: '2.0',
          id: call.id,
          result: isHeld ? '0x56bc75e2d63100000' : '0x0',
        };
      });
      if (!calls.length || replies.some((reply) => !reply)) {
        deniedRequests.push('source:unexpected balance read');
        return route.abort('blockedbyclient');
      }
      const row: (typeof reads)[number] = {
        network: 'source',
        held: isHeld,
        methods: calls.map((call) => call.method),
        receivedAt: Date.now(),
      };
      reads.push(row);
      if (isHeld) await oldGate;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
      row.fulfilledAt = Date.now();
    });
    // Only the replacement RPC is added to the inherited deny-by-default
    // fixture. Responses are synthetic and the server never forwards traffic.
    await wallet.context.route(TARGET_RPC + '/**', async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        deniedRequests.push('target:invalid JSON');
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const replies = calls.map((call) => {
        if (
          route.request().method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          !Array.isArray(call.params)
        )
          return undefined;
        let result: unknown;
        switch (call.method) {
          case 'eth_chainId':
          case 'net_version':
          case 'eth_blockNumber':
          case 'eth_gasPrice':
          case 'eth_maxPriorityFeePerGas':
            if (call.params.length !== 0) return undefined;
            result =
              call.method === 'eth_chainId'
                ? '0x1644'
                : call.method === 'net_version'
                ? '5700'
                : call.method === 'eth_blockNumber'
                ? '0x1'
                : '0x3b9aca00';
            break;
          case 'eth_getBalance':
          case 'eth_getTransactionCount':
            if (
              call.params.length !== 2 ||
              !knownAddress(call.params[0]) ||
              call.params[1] !== 'latest'
            )
              return undefined;
            result =
              call.method === 'eth_getBalance' ? '0x1bc16d674ec80000' : '0x0';
            break;
          case 'eth_getCode':
            if (
              call.params.length !== 2 ||
              !/^0x[0-9a-f]{40}$/i.test(String(call.params[0])) ||
              call.params[1] !== 'latest'
            )
              return undefined;
            result = '0x';
            break;
          case 'eth_getLogs':
            if (call.params.length !== 1 || typeof call.params[0] !== 'object')
              return undefined;
            result = [];
            break;
          case 'eth_getBlockByNumber': {
            if (
              call.params.length !== 2 ||
              !['latest', '0x0', '0x1'].includes(call.params[0]) ||
              typeof call.params[1] !== 'boolean'
            )
              return undefined;
            const genesis = call.params[0] === '0x0';
            result = {
              number: genesis ? '0x0' : '0x1',
              hash: '0x' + (genesis ? '30' : '31').repeat(32),
              parentHash: '0x' + (genesis ? '00' : '30').repeat(32),
              nonce: '0x0000000000000000',
              timestamp: genesis ? '0x0' : '0x1',
              difficulty: '0x0',
              gasLimit: '0x1c9c380',
              gasUsed: '0x0',
              miner: '0x' + '00'.repeat(20),
              extraData: '0x',
              transactions: [],
              baseFeePerGas: '0x3b9aca00',
            };
            break;
          }
          default:
            return undefined;
        }
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (!calls.length || replies.some((reply) => reply === undefined)) {
        deniedRequests.push('target:unexpected RPC');
        return route.abort('blockedbyclient');
      }
      const row: (typeof reads)[number] = {
        network: 'target',
        held:
          holdTarget && calls.some((call) => call.method === 'eth_getBalance'),
        methods: calls.map((call) => call.method),
        receivedAt: Date.now(),
      };
      reads.push(row);
      if (row.held) await targetGate;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
      row.fulfilledAt = Date.now();
    });
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // The status control has no accessible name while its dot is hidden.
    const indicator = page.locator('button.status-target');
    const tooltip = page.getByRole('tooltip');
    const refresh = page.getByRole('button', {
      name: en.header.refresh,
      exact: true,
    });
    await wallet.step(
      'rpc-quality: prepare ordinary Home refresh',
      async () => {
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
        await expect(refresh).toBeEnabled();
        await expect(indicator).toHaveCount(1);
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return (
              state.active?.chainId === 5700 &&
              state.status === 'idle' &&
              !state.loadingBalances
            );
          })
          .toBe(true);
        const prepared = await page.evaluate(() => Date.now());
        await page.waitForFunction(
          ({ since, delay }) => Date.now() - since > delay,
          { since: prepared, delay: PROVIDER_READ_CACHE_MS }
        );
        observations.prepared = await publicState(page);
      }
    );
    await wallet.step(
      'rpc-quality: finish a genuinely slow old-endpoint read',
      async () => {
        holdOld = true;
        await refresh.click();
        await expect
          .poll(() => reads.some((row) => row.network === 'source' && row.held))
          .toBe(true);
        await expect
          .poll(async () => (await publicState(page)).loadingBalances)
          .toBe(true);
        const pendingAt = await page.evaluate(() => Date.now());
        await page.waitForFunction(
          ({ since, delay }) => Date.now() - since >= delay,
          { since: pendingAt, delay: OLD_SLOW_READ_MS }
        );
        holdOld = false;
        releaseOld();
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return (
              !state.loadingBalances &&
              state.quality?.hasSlowOperations === true
            );
          })
          .toBe(true);
        const old = await publicState(page);
        expect(old.active?.url).toBe(SOURCE_RPC);
        expect(old.quality?.lastBalanceLatency).toBeGreaterThanOrEqual(
          OLD_SLOW_READ_MS
        );
        expect(old.quality?.hasCriticalErrors).toBe(false);
        const slowLabel = en.networkConnection.networkQualitySlow.replace(
          '{{latency}}',
          String(old.quality?.lastBalanceLatency) + 'ms'
        );
        const slowIndicator = page.getByRole('button', {
          name: slowLabel,
          exact: true,
        });
        await slowIndicator.hover();
        await expect(slowIndicator.locator('span')).toHaveClass(
          /bg-orange-500/
        );
        await expect(tooltip).toHaveText(slowLabel);
        observations.oldEndpointSlow = old;
      }
    );
    await wallet.step(
      'rpc-quality: save the same chain with its replacement URL',
      async () => {
        await page.mouse.move(0, 0);
        await wallet!.gotoRoute('#/settings/networks/edit');
        const row = page
          .locator('li')
          .filter({ has: page.getByText(LABEL, { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(
          new RegExp('#/settings/networks/custom-rpc$')
        );
        await expect(page.locator('#rpc_url')).toHaveValue(SOURCE_RPC);
        await page.evaluate((expectedUrl) => {
          const observation = window as typeof window & {
            rpcQualitySavedUrl?: string;
          };
          const listener = (message: any) => {
            const url =
              message.type === 'CONTROLLER_STATE_CHANGE'
                ? message.data?.vaultGlobal?.networks?.ethereum?.[5700]?.url
                : undefined;
            if (url !== expectedUrl) return;
            chrome.runtime.onMessage.removeListener(listener);
            requestAnimationFrame(() => {
              observation.rpcQualitySavedUrl = url;
            });
          };
          chrome.runtime.onMessage.addListener(listener);
        }, TARGET_RPC);
        await page.locator('#rpc_url').fill(TARGET_RPC);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp('#/settings/networks/edit$'));
        await page.waitForFunction(
          (expectedUrl) =>
            (window as typeof window & { rpcQualitySavedUrl?: string })
              .rpcQualitySavedUrl === expectedUrl,
          TARGET_RPC
        );
        const edited = await publicState(page);
        expect(edited.active?.url).toBe(SOURCE_RPC);
        expect(edited.savedRpc).toBe(TARGET_RPC);
        expect(edited.quality?.hasSlowOperations).toBe(true);
        observations.registryEdited = edited;
      }
    );
    await wallet.step(
      'rpc-quality: normal reselection starts blue at the new endpoint',
      async (capture) => {
        await wallet!.ensureOnHome();
        holdTarget = true;
        const header = page
          .getByRole('button')
          .filter({ hasText: /UTXO|EVM/ })
          .first();
        await expect(header).toBeEnabled();
        await header.click();
        const menu = page.getByRole('menu');
        const group = menu
          .getByRole('menuitem', { name: /EVM Networks/i })
          .first();
        if ((await group.getAttribute('aria-expanded')) !== 'true')
          await group.click();
        await menu.getByRole('menuitem', { name: LABEL, exact: true }).click();
        await expect
          .poll(() => reads.some((row) => row.network === 'target' && row.held))
          .toBe(true);
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return {
              active: state.active,
              target: state.target,
              status: state.status,
              loadingBalances: state.loadingBalances,
              postLoading: state.postLoading,
              quality: state.quality,
            };
          })
          .toEqual({
            active: {
              chainId: 5700,
              kind: 'ethereum',
              url: TARGET_RPC,
              label: LABEL,
            },
            target: null,
            status: 'idle',
            loadingBalances: true,
            postLoading: true,
            quality: null,
          });
        const loadingIndicator = page.getByRole('button', {
          name: en.networkConnection.updatingBalances,
          exact: true,
        });
        await loadingIndicator.hover();
        await expect(loadingIndicator.locator('span')).toHaveClass(
          /bg-brand-blue500/
        );
        await expect(tooltip).toHaveText(en.networkConnection.updatingBalances);
        const heldRead = reads.find(
          (row) => row.network === 'target' && row.held
        )!;
        expect(Date.now() - heldRead.receivedAt).toBeLessThan(SLOW_FEEDBACK_MS);
        observations.replacementFresh = await publicState(page);
        // Preserve the pending blue frame before releasing the real HTTP read.
        await capture(page);
        holdTarget = false;
        releaseTarget();
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return (
              state.active?.url === TARGET_RPC &&
              state.status === 'idle' &&
              !state.loadingBalances &&
              !state.postLoading &&
              state.balance === '2.0'
            );
          })
          .toBe(true);
        observations.replacementCompleted = await publicState(page);
      }
    );
    await wallet.step(
      'rpc-quality: a fresh ordinary read owns the replacement quality',
      async () => {
        const beforeReads = reads.filter(
          (row) =>
            row.network === 'target' &&
            !row.held &&
            row.methods.includes('eth_getBalance')
        ).length;
        const completedAt = await page.evaluate(() => Date.now());
        await page.waitForFunction(
          ({ since, delay }) => Date.now() - since > delay,
          { since: completedAt, delay: PROVIDER_READ_CACHE_MS }
        );
        await expect(refresh).toBeEnabled();
        await refresh.click();
        await expect
          .poll(
            () =>
              reads.filter(
                (row) =>
                  row.network === 'target' &&
                  !row.held &&
                  row.methods.includes('eth_getBalance')
              ).length
          )
          .toBeGreaterThan(beforeReads);
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return (
              state.active?.url === TARGET_RPC &&
              state.status === 'idle' &&
              !state.loadingBalances &&
              !state.postLoading &&
              state.balance === '2.0' &&
              state.quality?.hasSlowOperations === false &&
              state.quality?.hasCriticalErrors === false
            );
          })
          .toBe(true);
        await expect(page.locator('#home-balance')).toHaveText('2');
        const final = await publicState(page);
        expect(final.account).toEqual(
          (observations.prepared as typeof final).account
        );
        expect(final.quality?.lastBalanceLatency).toBeGreaterThanOrEqual(0);
        expect(final.quality?.lastBalanceLatency).toBeLessThanOrEqual(1000);
        const completedIndicator = page.getByRole('button', {
          name: en.networkConnection.operationCompleted,
          exact: true,
        });
        await completedIndicator.hover();
        await expect(completedIndicator.locator('span')).toHaveClass(
          /bg-green-500/
        );
        await expect(tooltip).toHaveText(
          en.networkConnection.operationCompleted
        );
        await expect(page).toHaveURL(new RegExp('#/home$'));
        expect(deniedRequests).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(testSourceSha256);
        observations.final = final;
      }
    );
    status = 'passed';
  } finally {
    releaseOld();
    releaseTarget();
    try {
      await info.attach('network-quality-endpoint-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          testSourceSha256,
          observations,
          reads,
          explorerReads,
          deniedRequests,
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedMethods: server?.blocked || [],
          pageErrors,
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signingOrBroadcast: false,
        }),
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server?.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
