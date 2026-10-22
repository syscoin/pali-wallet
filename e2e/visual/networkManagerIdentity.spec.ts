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
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CHAIN_ID = 5700;
const UTXO_LABEL = 'Syscoin Testnet';
const EVM_LABEL = 'Syscoin NEVM Testnet';

const publicState = (page: Page) =>
  page.evaluate(async (id) => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const stored = await chrome.storage.local.get('state');
    const project = (network: any) => ({
      chainId: network.chainId,
      kind: network.kind,
      label: network.label,
      url: network.url,
      slip44: network.slip44,
      default: network.default,
    });
    const networks = (state: any) => ({
      syscoin: project(state.vaultGlobal.networks.syscoin[id]),
      ethereum: project(state.vaultGlobal.networks.ethereum[id]),
    });
    const ref = current.vault.activeAccount;
    return {
      live: networks(current),
      saved: networks(stored.state),
      active: project(current.vault.activeNetwork),
      activeSlip44: current.vaultGlobal.activeSlip44,
      account: {
        ...ref,
        address: current.vault.accounts[ref.type][ref.id].address,
      },
    };
  }, CHAIN_ID);

// Match the isolated-vault read surface, but only at this test's exact local
// origin. The same URL serves UTXO GETs and EVM POSTs; no request is forwarded.
const evmRead = (call: any): unknown | undefined => {
  if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params)) return undefined;
  switch (call.method) {
    case 'eth_chainId':
      return call.params.length === 0 ? '0x1644' : undefined;
    case 'net_version':
      return call.params.length === 0 ? '5700' : undefined;
    case 'eth_blockNumber':
      return call.params.length === 0 ? '0x1' : undefined;
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return call.params.length === 0 ? '0x3b9aca00' : undefined;
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
    case 'eth_getCode':
      return call.params.length === 2 &&
        /^0x[0-9a-f]{40}$/i.test(call.params[0]) &&
        ['latest', 'pending'].includes(call.params[1])
        ? call.method === 'eth_getCode'
          ? '0x'
          : '0x0'
        : undefined;
    case 'eth_call':
      return call.params.length === 2 &&
        /^0x[0-9a-f]{40}$/i.test(call.params[0]?.to) &&
        ['latest', 'pending'].includes(call.params[1])
        ? '0x'
        : undefined;
    case 'eth_getLogs':
      return call.params.length === 1 &&
        typeof call.params[0] === 'object' &&
        call.params[0] !== null
        ? []
        : undefined;
    case 'eth_getBlockByNumber':
      return call.params.length === 2 &&
        ['latest', '0x0', '0x1'].includes(call.params[0]) &&
        typeof call.params[1] === 'boolean'
        ? {
            number: call.params[0] === '0x0' ? '0x0' : '0x1',
            hash: '0x' + (call.params[0] === '0x0' ? '11' : '12').repeat(32),
            parentHash:
              '0x' + (call.params[0] === '0x0' ? '00' : '11').repeat(32),
            nonce: '0x0000000000000000',
            timestamp: '0x1',
            difficulty: '0x0',
            gasLimit: '0x1c9c380',
            gasUsed: '0x0',
            miner: '0x' + '00'.repeat(20),
            extraData: '0x',
            transactions: [],
            baseFeePerGas: '0x3b9aca00',
          }
        : undefined;
    default:
      return undefined;
  }
};

test('network manager distinguishes active UTXO and EVM registrations sharing an ID and URL', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  let origin = '';
  const reads: Array<{ family: string; method: string; url: string }> = [];
  const deniedShared: Array<{ method: string; url: string }> = [];
  const attemptedWrites: string[] = [];
  const server = await startUtxoFixtureServer({
    readJson: (url) => {
      if (url.origin !== origin) return undefined;
      const result =
        url.pathname === '/api/v2/tickers/currency' && !url.search
          ? { ts: 1, rates: { usd: 1 } }
          : sptFixtureRead(
              fixture.utxo,
              'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
              'GET'
            );
      if (result !== undefined)
        reads.push({ family: 'syscoin', method: 'GET', url: url.href });
      return result;
    },
  });
  origin = server.url;
  const sharedRpc = origin + '/';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkManagerIdentitySynthetic!2026',
    rpcUrl: origin,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('network-manager-identity', {
      offlineHttpProxy: origin,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(wallet.context, fixture, origin);
    wallet.context.on('request', (request) => {
      if (!/^https?:/.test(request.url())) return;
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        /* Read-only REST. */
      }
      if (
        /\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname) ||
        (Array.isArray(payload) ? payload : [payload]).some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      )
        attemptedWrites.push(request.url());
    });
    await wallet.context.route(origin + '/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET') {
        if (
          url.pathname === '/' ||
          (url.pathname === '/api/v2/tickers/currency' && !url.search) ||
          sptFixtureRead(
            fixture.utxo,
            'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
            'GET'
          ) !== undefined
        )
          return route.continue();
      } else if (request.url() === sharedRpc) {
        if (request.method() === 'OPTIONS')
          return route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
              'access-control-allow-methods': 'POST, OPTIONS',
            },
          });
        if (request.method() === 'POST') {
          let input: any;
          try {
            input = request.postDataJSON();
          } catch {
            /* Malformed input is refused below. */
          }
          const calls = Array.isArray(input) ? input : [input];
          const results = calls.map(evmRead);
          if (
            calls.length > 0 &&
            results.every((result) => result !== undefined)
          ) {
            reads.push(
              ...calls.map((call) => ({
                family: 'ethereum',
                method: call.method,
                url: request.url(),
              }))
            );
            const replies = calls.map((call, index) => ({
              jsonrpc: '2.0',
              id: call.id,
              result: results[index],
            }));
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(Array.isArray(input) ? replies : replies[0]),
            });
          }
        }
      }
      deniedShared.push({ method: request.method(), url: request.url() });
      return route.abort('blockedbyclient');
    });
    const page = wallet.page;
    const manager = page.locator(
      '[data-navigation-scroll="settings-manage-networks"]'
    );
    const row = (label: string) =>
      manager
        .locator('li')
        .filter({ has: page.getByText(label, { exact: true }) });
    const openManager = async () => {
      await wallet!.gotoRoute('#/settings/networks/edit');
      await expect(manager).toBeVisible();
    };
    const edit = async (label: string, family: 'ethereum' | 'syscoin') => {
      await openManager();
      await expect(row(label)).toHaveCount(1);
      await row(label).locator('button').first().click();
      const input = page.locator('input#rpc_url');
      await expect(input).toBeVisible();
      await expect(input).toBeEnabled();
      await expect(page.locator('input#rpc_chainId')).toHaveValue(
        String(CHAIN_ID)
      );
      await input.fill(sharedRpc);
      await page.locator('input#rpc_explorer').fill(sharedRpc);
      if (family === 'ethereum')
        await page.locator('input#rpc_apiUrl').fill('');
      await input.focus();
      await input.press('Tab');
      await expect
        .poll(() => reads.some((read) => read.family === family))
        .toBe(true);
      const save = page.getByRole('button', {
        name: en.buttons.save,
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(manager).toBeVisible();
      await expect
        .poll(async () => (await publicState(page)).saved[family].url)
        .toBe(sharedRpc);
    };
    await wallet.step(
      'edit both ordinary removable testnets to the same RPC URL',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork(EVM_LABEL, 'EVM');
        const before = await publicState(page);
        expect(before.live.syscoin).toMatchObject({
          chainId: CHAIN_ID,
          default: false,
        });
        expect(before.live.ethereum).toMatchObject({
          chainId: CHAIN_ID,
          default: false,
        });
        observations.before = before;
        await edit(UTXO_LABEL, 'syscoin');
        await edit(EVM_LABEL, 'ethereum');
        const saved = await publicState(page);
        expect(saved.live).toEqual(saved.saved);
        expect(saved.live.syscoin.url).toBe(sharedRpc);
        expect(saved.live.ethereum.url).toBe(sharedRpc);
        expect(saved.live.syscoin.kind).not.toBe(saved.live.ethereum.kind);
        observations.edited = saved;
      }
    );
    for (const family of ['syscoin', 'ethereum'] as const) {
      await wallet.step(
        `only the active ${family} registration has an active badge and blocked removal`,
        async () => {
          const label = family === 'syscoin' ? UTXO_LABEL : EVM_LABEL;
          const otherLabel = family === 'syscoin' ? EVM_LABEL : UTXO_LABEL;
          await wallet!.switchNetwork(
            label,
            family === 'syscoin' ? 'UTXO' : 'EVM'
          );
          await openManager();
          const before = await publicState(page);
          expect(before.active).toEqual(before.live[family]);
          expect(before.live).toEqual(before.saved);
          expect(before.activeSlip44).toBe(family === 'syscoin' ? 1 : 60);
          expect(before.account.address).toBe(
            family === 'syscoin'
              ? fixture.utxo.userAddress
              : fixture.evmAddresses[0]
          );
          await expect(
            row(label).getByText(en.components.activeStatus, { exact: true })
          ).toBeVisible();
          await expect(
            row(otherLabel).getByText(en.components.activeStatus, {
              exact: true,
            })
          ).toHaveCount(0);
          await expect(row(label).locator('button').last()).toBeDisabled();
          const removable = row(otherLabel).locator('button').last();
          await expect(removable).toBeEnabled();
          await removable.click();
          const dialog = page.getByRole('dialog', {
            name: en.settings.confirmRemoveNetwork.replace(
              '{{networkName}}',
              otherLabel
            ),
            exact: true,
          });
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(dialog).toHaveCount(0);
          expect(await publicState(page)).toEqual(before);
          observations[family] = before;
        }
      );
    }
    observations.worker = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.worker = value;
      }
    );
    expect(reads.some((read) => read.family === 'syscoin')).toBe(true);
    expect(reads.some((read) => read.method === 'eth_chainId')).toBe(true);
    expect(deniedShared).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('network-manager-identity-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          sharedRpc,
          observations,
          reads,
          deniedShared,
          attemptedWrites,
          fixtureReads: routes?.reads || [],
          fixtureDeniedWrites: routes?.deniedWrites || [],
          proxyBlocked: server.blocked,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          chromeApiReplaced: false,
          signingOrBroadcastRequested: false,
        }),
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
