import { expect, test, type Locator, type Page } from '@playwright/test';
import { coins } from '@sidhujag/sysweb3-network';
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

const EVM_LABEL = 'Explorer Origin';
const EVM_RPC = 'https://rpc.tanenbaum.io';
const OLD_EXPLORER = 'https://old-evm-explorer.synthetic.invalid/';
const LITECOIN_RPC = 'https://blockbook.ltc.zelcore.io';

const publicNetworkState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? {
            chainId: network.chainId,
            currency: network.currency,
            default: network.default,
            explorer: network.explorer,
            kind: network.kind,
            label: network.label,
            slip44: network.slip44,
            url: network.url,
          }
        : null;
    const ref = state.vault.activeAccount;
    return {
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      active: project(state.vault.activeNetwork),
      live: project(state.vaultGlobal.networks.syscoin[2]),
      saved: project(saved.state?.vaultGlobal?.networks?.syscoin?.[2]),
    };
  });

async function expectActive(menu: Locator, item: Locator) {
  const id = await item.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(menu).toHaveAttribute('aria-activedescendant', id!);
  await expect(menu).toBeFocused();
}

test('network suggestions reset reopened typeahead and do not carry an EVM explorer into Litecoin', async ({}, info) => {
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
  const litecoin = coins.find((coin) => coin.name === 'Litecoin');
  expect(litecoin?.slip44).toBe(2);
  expect(litecoin?.blockchainLink?.url?.[0]).toBe(LITECOIN_RPC);
  const previous = { ...E2E_CONFIG };
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'onboarding';
  const reads: Array<{ body?: unknown; phase: string; url: string }> = [];
  const failedRequests: Array<{ method: string; url: string }> = [];
  const deniedRequests: string[] = [];
  const observations: Record<string, unknown> = {};
  const chainlistWire = JSON.stringify([
    {
      name: EVM_LABEL,
      chainId: 5700,
      networkId: 5700,
      nativeCurrency: { name: 'Test Syscoin', symbol: 'TSYS', decimals: 18 },
      rpc: [{ url: EVM_RPC, tracking: 'none', isOpenSource: true }],
      explorers: [{ name: 'Previous EVM explorer', url: OLD_EXPLORER }],
    },
  ]);
  const blockbookWire = JSON.stringify({
    blockbook: { network: 'Litecoin', coin: 'Litecoin' },
    backend: { chain: 'main' },
  });
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NetworkSuggestionsSynthetic!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('network-suggestion-lifecycle', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.context.on('requestfailed', (request) => {
      if (/^https?:/.test(request.url()))
        failedRequests.push({ method: request.method(), url: request.url() });
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(
      'https://chainlist.org/rpcs.json',
      async (route) => {
        const request = route.request();
        if (request.method() !== 'GET') {
          deniedRequests.push(request.method() + ' ' + request.url());
          return route.abort('blockedbyclient');
        }
        reads.push({ phase, url: request.url() });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: chainlistWire,
        });
      }
    );
    await wallet.context.route(EVM_RPC + '/', async (route) => {
      const request = route.request();
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        return route.fallback();
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedRequests.push('forbidden RPC');
        return route.abort('blockedbyclient');
      }
      if (
        request.method() !== 'POST' ||
        !calls.length ||
        !calls.every(
          (call) =>
            call?.jsonrpc === '2.0' &&
            Array.isArray(call.params) &&
            call.params.length === 0 &&
            ['eth_chainId', 'eth_blockNumber'].includes(call.method)
        )
      )
        return route.fallback();
      reads.push({ phase, url: request.url(), body: payload });
      const replies = calls.map((call) => ({
        jsonrpc: '2.0',
        id: call.id,
        result: call.method === 'eth_chainId' ? '0x1644' : '0x1',
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    await wallet.context.route(LITECOIN_RPC + '/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() !== 'GET' ||
        url.pathname !== '/api/v2' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        deniedRequests.push(request.method() + ' ' + request.url());
        return route.abort('blockedbyclient');
      }
      reads.push({ phase, url: request.url() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: blockbookWire,
      });
    });
    const page = wallet.page;
    const trigger = page
      .getByRole('button')
      .filter({ has: page.locator('#network-settings-btn') });
    const unchanged = async (
      initial: Awaited<ReturnType<typeof publicNetworkState>>
    ) => {
      const current = await publicNetworkState(page);
      expect(current.account).toEqual(initial.account);
      expect(current.active).toEqual(initial.active);
      expect(current.live).toBeNull();
      expect(current.saved).toBeNull();
    };
    let initial: Awaited<ReturnType<typeof publicNetworkState>>;
    await wallet.step(
      'network-suggestions: verify fresh EVM typeahead without changing the active network',
      async (capture) => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        initial = await publicNetworkState(page);
        expect(initial.active).toMatchObject({
          kind: 'syscoin',
          chainId: 5700,
        });
        expect(initial.live).toBeNull();
        expect(initial.saved).toBeNull();
        await trigger.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeFocused();
        await page.keyboard.type('EVM');
        const group = page.getByRole('menuitem', {
          name: en.networkMenu.evmNetworks,
          exact: true,
        });
        await expectActive(menu, group);
        observations.freshTypeahead = {
          activeId: await menu.getAttribute('aria-activedescendant'),
          groupId: await group.getAttribute('id'),
          state: await publicNetworkState(page),
        };
        await capture(page);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        await unchanged(initial);
      }
    );
    await wallet.step(
      'network-suggestions: Escape and pointer reopening start a fresh EVM query',
      async (capture) => {
        await trigger.click();
        const menu = page.getByRole('menu');
        // Home intentionally clears any prior control query before this sequence.
        // There is no Home/reset key between Escape and the regression's EVM query.
        await page.keyboard.press('Home');
        await page.keyboard.type('UTXO');
        await expectActive(
          menu,
          page.getByRole('menuitem', {
            name: en.networkMenu.utxoNetworks,
            exact: true,
          })
        );
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.click();
        await expect(menu).toBeFocused();
        await page.keyboard.type('EVM');
        const group = page.getByRole('menuitem', {
          name: en.networkMenu.evmNetworks,
          exact: true,
        });
        await expectActive(menu, group);
        observations.reopenedTypeahead = {
          activeId: await menu.getAttribute('aria-activedescendant'),
          groupId: await group.getAttribute('id'),
          state: await publicNetworkState(page),
        };
        await capture(page);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        await unchanged(initial);
      }
    );
    await wallet.step(
      'network-suggestions: select the EVM catalogue row with its original explorer',
      async () => {
        phase = 'evm-suggestion';
        await trigger.click();
        await page
          .getByRole('menuitem', {
            name: en.networkMenu.customRpc,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        const input = page.getByRole('combobox', {
          name: en.settings.label,
          exact: true,
        });
        await input.fill(EVM_LABEL);
        const evmOption = page.getByRole('option').filter({
          has: page.getByText(EVM_LABEL, { exact: true }),
        });
        await expect(evmOption).toHaveCount(1);
        await evmOption.click();
        await expect(input).toHaveValue(EVM_LABEL);
        await expect(page.locator('#rpc_url')).toHaveValue(EVM_RPC);
        await expect(page.locator('#rpc_explorer')).toHaveValue(OLD_EXPLORER);
        await expect(page.locator('#rpc_chainId')).toHaveValue('5700');
        await expect(
          page.getByRole('button', { name: en.buttons.save, exact: true })
        ).toBeEnabled();
        expect(
          reads.some((read) => read.url === 'https://chainlist.org/rpcs.json')
        ).toBe(true);
        expect(
          reads.filter(
            (read) => read.phase === phase && read.url === EVM_RPC + '/'
          ).length
        ).toBeGreaterThanOrEqual(3);
        observations.evmSuggestion = {
          explorer: await page.locator('#rpc_explorer').inputValue(),
          url: await page.locator('#rpc_url').inputValue(),
          chainId: await page.locator('#rpc_chainId').inputValue(),
        };
        await unchanged(initial);
      }
    );
    await wallet.step(
      'network-suggestions: select installed Litecoin and clear the previous EVM explorer',
      async () => {
        phase = 'litecoin-suggestion';
        const toggle = page.getByRole('switch', {
          name: en.settings.networkFamilyLabel.replace('{{family}}', 'Syscoin'),
          exact: true,
        });
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        const input = page.getByRole('combobox', {
          name: en.settings.label,
          exact: true,
        });
        await input.fill('Litecoin');
        const litecoinOption = page.getByRole('option').filter({
          has: page.getByText('Litecoin', { exact: true }),
        });
        await expect(litecoinOption).toHaveCount(1);
        await litecoinOption.click();
        await expect(input).toHaveValue('Litecoin');
        await expect(page.locator('#rpc_explorer')).toHaveValue('');
        await expect(page.locator('#rpc_url')).toHaveValue(LITECOIN_RPC);
        await expect(page.locator('#rpc_chainId')).toHaveValue('2');
        await expect(page.locator('#rpc_symbol')).toHaveValue('LTC');
        await expect(
          page.getByRole('button', { name: en.buttons.save, exact: true })
        ).toBeEnabled();
        expect(
          reads.filter(
            (read) =>
              read.phase === phase && read.url === LITECOIN_RPC + '/api/v2'
          ).length
        ).toBeGreaterThanOrEqual(3);
        observations.litecoinSuggestion = {
          explorer: await page.locator('#rpc_explorer').inputValue(),
          url: await page.locator('#rpc_url').inputValue(),
          chainId: await page.locator('#rpc_chainId').inputValue(),
          symbol: await page.locator('#rpc_symbol').inputValue(),
        };
        await unchanged(initial);
      }
    );
    await wallet.step(
      'network-suggestions: save Litecoin with its validated Blockbook explorer fallback',
      async () => {
        phase = 'litecoin-save';
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        const expected = {
          chainId: 2,
          currency: 'ltc',
          default: false,
          explorer: LITECOIN_RPC,
          kind: 'syscoin',
          label: 'Litecoin',
          slip44: 2,
          url: LITECOIN_RPC,
        };
        await expect
          .poll(async () => {
            const current = await publicNetworkState(page);
            return { live: current.live, saved: current.saved };
          })
          .toEqual({ live: expected, saved: expected });
        const saved = await publicNetworkState(page);
        expect(saved.active).toEqual(initial.active);
        expect(saved.account).toEqual(initial.account);
        expect(saved.live?.explorer).not.toBe(OLD_EXPLORER);
        observations.saved = saved;
      }
    );
    expect(deniedRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    try {
      await info.attach('network-suggestion-lifecycle-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(info.file))
            .digest('hex'),
          catalogue: {
            name: litecoin?.name,
            slip44: litecoin?.slip44,
            firstBlockbook: litecoin?.blockchainLink?.url?.[0],
          },
          chainlistWireSha256: createHash('sha256')
            .update(chainlistWire)
            .digest('hex'),
          blockbookWireSha256: createHash('sha256')
            .update(blockbookWire)
            .digest('hex'),
          observations,
          reads,
          failedRequests,
          deniedRequests,
          fixtureReads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedRequests: server?.blocked || [],
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          chromeApiReplaced: false,
          signingOrBroadcastRequested: false,
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
