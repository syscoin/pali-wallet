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

const CHAIN_ID = 31337;
const scenarios = [
  { name: 'IPv6', url: 'http://[2001:db8::1]:8545/rpc' },
  { name: 'IPv4', url: 'http://192.0.2.1:8545/rpc' },
] as const;

const publicState = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const stored = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? {
            chainId: network.chainId,
            kind: network.kind,
            label: network.label,
            url: network.url,
            explorer: network.explorer ?? '',
            apiUrl: network.apiUrl ?? '',
            currency: network.currency,
            slip44: network.slip44,
          }
        : null;
    const account = state.vault.activeAccount;
    return {
      live: project(state.vaultGlobal.networks.ethereum[chainId]),
      stored: project(stored.state?.vaultGlobal?.networks?.ethereum?.[chainId]),
      active: project(state.vault.activeNetwork),
      account: {
        ...account,
        address: state.vault.accounts[account.type][account.id].address,
      },
    };
  }, CHAIN_ID);

for (const scenario of scenarios) {
  test(`manual ${scenario.name} RPC saves its exact endpoint and reopens from storage`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const label = `${scenario.name} fixture`;
    const expected = {
      chainId: CHAIN_ID,
      kind: 'ethereum',
      label,
      url: scenario.url,
      explorer: `${scenario.url}/`,
      apiUrl: '',
      currency: 'test',
      slip44: 60,
    };
    const target = new URL(scenario.url);
    const previous = { ...E2E_CONFIG };
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase = 'onboarding';
    const reads: Array<{
      id: unknown;
      method: string;
      params: unknown[];
      phase: string;
      url: string;
    }> = [];
    const unexpectedRpcRequests: Array<{ method: string; url: string }> = [];
    const attemptedWrites: string[] = [];
    const failedRequests: Array<{ method: string; url: string }> = [];
    const observations: Record<string, unknown> = {};
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'CustomRpcAddressFamilySynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        `custom-rpc-${scenario.name.toLowerCase()}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
      wallet.context.on('request', (request) => {
        if (!/^https?:/.test(request.url())) return;
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* ordinary REST */
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        if (
          /\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname) ||
          calls.some((call) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
              call?.method || ''
            )
          )
        )
          attemptedWrites.push(request.url());
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      // Only HTTP responses are synthetic. All URL validation, SDK calls,
      // account selection and storage run in the real extension. Both target
      // addresses are documentation ranges; the launch proxy never forwards.
      await wallet.context.route(
        (url) => url.origin === target.origin,
        async (route) => {
          const request = route.request();
          if (request.url() !== target.href) {
            unexpectedRpcRequests.push({
              method: request.method(),
              url: request.url(),
            });
            return route.abort('blockedbyclient');
          }
          const headers = {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
          };
          if (request.method() === 'OPTIONS')
            return route.fulfill({ status: 204, headers });
          let call: any;
          try {
            call = request.postDataJSON();
          } catch {
            /* refuse non-JSON */
          }
          if (
            request.method() !== 'POST' ||
            call?.jsonrpc !== '2.0' ||
            call.method !== 'eth_chainId' ||
            !Array.isArray(call.params) ||
            call.params.length !== 0 ||
            !['number', 'string'].includes(typeof call.id)
          ) {
            unexpectedRpcRequests.push({
              method: request.method(),
              url: request.url(),
            });
            return route.abort('blockedbyclient');
          }
          reads.push({
            phase,
            url: request.url(),
            method: call.method,
            id: call.id,
            params: call.params,
          });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: call.id,
              result: `0x${CHAIN_ID.toString(16)}`,
            }),
          });
        }
      );
      await wallet.context.route(
        'https://chainlist.org/rpcs.json',
        async (route) => {
          if (route.request().method() !== 'GET') {
            unexpectedRpcRequests.push({
              method: route.request().method(),
              url: route.request().url(),
            });
            return route.abort('blockedbyclient');
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
        }
      );
      const page = wallet.page;
      const networkMenu = page
        .getByRole('button')
        .filter({ has: page.locator('#network-settings-btn') });
      let before: Awaited<ReturnType<typeof publicState>>;
      await wallet.step(
        `${scenario.name}: open the ordinary custom network form`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          before = await publicState(page);
          expect(before.live).toBeNull();
          expect(before.stored).toBeNull();
          await networkMenu.click();
          await page
            .getByRole('menuitem', {
              name: en.networkMenu.customRpc,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        }
      );
      await wallet.step(
        `${scenario.name}: validate the exact manually entered HTTP endpoint`,
        async () => {
          phase = 'manual-entry';
          await page
            .getByRole('combobox', { name: en.settings.label, exact: true })
            .fill(label);
          await page.locator('#rpc_symbol').fill('TEST');
          await page.locator('#rpc_chainId').fill(String(CHAIN_ID));
          await page.locator('#rpc_url').fill(scenario.url);
          await page.locator('#rpc_url').press('Tab');
          await expect
            .poll(() =>
              reads.some(
                (read) => read.phase === phase && read.method === 'eth_chainId'
              )
            )
            .toBe(true);
          await expect(page.locator('#rpc_url')).toHaveValue(scenario.url);
          await expect(
            page.getByRole('button', { name: en.buttons.save, exact: true })
          ).toBeEnabled();
          observations.entered = {
            url: await page.locator('#rpc_url').inputValue(),
            state: await publicState(page),
          };
        }
      );
      await wallet.step(
        `${scenario.name}: save the registration without changing the active account or network`,
        async () => {
          phase = 'save';
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
          await expect
            .poll(() => publicState(page))
            .toEqual({ ...before, live: expected, stored: expected });
          observations.saved = await publicState(page);
        }
      );
      await wallet.step(
        `${scenario.name}: reload and reopen the same durable endpoint`,
        async () => {
          phase = 'reopen';
          await page.reload();
          await wallet!.waitAppReady();
          if (await page.locator('#unlock-btn').isVisible())
            await wallet!.unlock();
          await wallet!.ensureOnHome();
          expect(await publicState(page)).toEqual(observations.saved);
          await networkMenu.click();
          await page
            .getByRole('menuitem', {
              name: en.networkMenu.manageNetworks,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
          const row = page
            .locator('li')
            .filter({ has: page.getByText(label, { exact: true }) });
          await expect(row).toHaveCount(1);
          await row.locator('button').first().click();
          await expect(page.locator('#rpc_url')).toHaveValue(scenario.url);
          await expect(page.locator('#rpc_explorer')).toHaveValue(
            expected.explorer
          );
          await expect(page.locator('#rpc_apiUrl')).toHaveValue('');
          observations.reopened = {
            url: await page.locator('#rpc_url').inputValue(),
            state: await publicState(page),
          };
        }
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(
        reads.every(
          (read) =>
            read.url === target.href &&
            read.method === 'eth_chainId' &&
            read.params.length === 0
        )
      ).toBe(true);
      expect(unexpectedRpcRequests).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(sourceSha256);
      status = 'passed';
    } finally {
      try {
        await info.attach('custom-rpc-address-family-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            scenario,
            runtime,
            sourceSha256,
            observations,
            reads,
            unexpectedRpcRequests,
            attemptedWrites,
            failedRequests,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            proxyBlocked: server?.blocked || [],
            syntheticHttpOnly: true,
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
            await server?.close();
          } finally {
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    }
  });
}
