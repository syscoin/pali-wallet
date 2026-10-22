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
const RPC = 'https://required-fields.synthetic.invalid/rpc';
const LABEL = '  Required fields fixture  ';
const SYMBOL = ' TST ';

const publicState = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? {
            chainId: network.chainId,
            kind: network.kind,
            label: network.label,
            currency: network.currency,
            slip44: network.slip44,
            url: network.url,
          }
        : null;
    const ref = state.vault.activeAccount;
    return {
      live: project(state.vaultGlobal.networks.ethereum[chainId]),
      stored: project(saved.state?.vaultGlobal?.networks?.ethereum?.[chainId]),
      active: project(state.vault.activeNetwork),
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      grantHosts: Object.keys(state.dapp.dapps).sort(),
      storedGrantHosts: Object.keys(saved.state?.dapp?.dapps || {}).sort(),
    };
  }, CHAIN_ID);

test('custom network required fields refuse blank text and preserve meaningful padding on Save', async ({}, info) => {
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
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RequiredNetworkFieldsSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'onboarding';
  const reads: Array<{ method: string; phase: string; url: string }> = [];
  const unexpectedRpcRequests: Array<{ method: string; url: string }> = [];
  const attemptedWrites: string[] = [];
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('custom-network-required-fields', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
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
    // The launch proxy never forwards. Only this exact synthetic chain-ID read
    // is fulfilled; form validation, SDK code, controller and storage stay real.
    await wallet.context.route(
      (url) => url.origin === new URL(RPC).origin,
      async (route) => {
        const request = route.request();
        const refuse = () => {
          unexpectedRpcRequests.push({
            method: request.method(),
            url: request.url(),
          });
          return route.abort('blockedbyclient');
        };
        if (request.url() !== RPC) return refuse();
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
          return refuse();
        }
        if (
          request.method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          call.method !== 'eth_chainId' ||
          !Array.isArray(call.params) ||
          call.params.length !== 0 ||
          !['number', 'string'].includes(typeof call.id)
        )
          return refuse();
        reads.push({ phase, method: call.method, url: request.url() });
        return route.fulfill({
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
    await wallet.context.route('https://chainlist.org/rpcs.json', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          })
        : route.abort('blockedbyclient')
    );
    const page = wallet.page;
    const networkMenu = page
      .getByRole('button')
      .filter({ has: page.locator('#network-settings-btn') });
    const label = page.getByRole('combobox', {
      name: en.settings.label,
      exact: true,
    });
    const symbol = page.locator('input#rpc_symbol');
    const save = page.getByRole('button', {
      name: en.buttons.save,
      exact: true,
    });
    let before: Awaited<ReturnType<typeof publicState>>;
    await wallet.step(
      'open the ordinary custom network form and validate its synthetic endpoint',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        before = await publicState(page);
        expect(before.live).toBeNull();
        expect(before.stored).toBeNull();
        expect(before.grantHosts).toEqual([]);
        expect(before.storedGrantHosts).toEqual([]);
        await networkMenu.click();
        await page
          .getByRole('menuitem', {
            name: en.networkMenu.customRpc,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await label.fill('Required fields fixture');
        await symbol.fill('TST');
        await page.locator('input#rpc_url').fill(RPC);
        await page.locator('input#rpc_url').press('Tab');
        await expect(page.locator('input#rpc_chainId')).toHaveValue(
          String(CHAIN_ID)
        );
        expect(reads.some((read) => read.method === 'eth_chainId')).toBe(true);
        await expect(save).toBeEnabled();
        observations.before = before;
      }
    );
    const invalid = [
      {
        name: 'spaces label',
        label: '   ',
        symbol: 'TST',
        error: en.settings.networkNameRequired,
      },
      {
        name: 'NBSP label',
        label: '\u00a0\u00a0',
        symbol: 'TST',
        error: en.settings.networkNameRequired,
      },
      {
        name: 'spaces symbol',
        label: 'Required fields fixture',
        symbol: '   ',
        error: en.settings.symbolRequired,
      },
      {
        name: 'NBSP symbol',
        label: 'Required fields fixture',
        symbol: '\u00a0\u00a0',
        error: en.settings.symbolRequired,
      },
    ];
    for (const scenario of invalid) {
      await wallet.step(
        `refuse ${scenario.name} without adding, granting or selecting a network`,
        async () => {
          phase = scenario.name;
          await label.fill(scenario.label);
          await symbol.fill(scenario.symbol);
          const readsBefore = reads.length;
          await save.click();
          await expect(
            page.getByText(scenario.error, { exact: true })
          ).toBeVisible();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          await expect(label).toHaveValue(scenario.label);
          await expect(symbol).toHaveValue(scenario.symbol);
          await expect(save).toBeEnabled();
          await expect(
            page.getByText(en.settings.rpcSuccessfullyAdded, { exact: true })
          ).toHaveCount(0);
          expect(reads.length).toBe(readsBefore);
          expect(await publicState(page)).toEqual(before!);
          observations[scenario.name] = {
            label: await label.inputValue(),
            symbol: await symbol.inputValue(),
            state: await publicState(page),
          };
        }
      );
    }
    const expected = {
      chainId: CHAIN_ID,
      kind: 'ethereum',
      label: LABEL,
      currency: SYMBOL.toLowerCase(),
      slip44: 60,
      url: RPC,
    };
    await wallet.step(
      'save meaningful padded fields through the actual SDK and durable registry',
      async () => {
        phase = 'save';
        await label.fill(LABEL);
        await symbol.fill(SYMBOL);
        await save.click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect
          .poll(() => publicState(page))
          .toEqual({
            ...before,
            live: expected,
            stored: expected,
          });
        observations.saved = await publicState(page);
      }
    );
    await wallet.step(
      'reload and reopen the saved row with exact padded values',
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
        const row = page
          .locator('li')
          .filter({ has: page.getByText(LABEL.trim(), { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(page.locator('input#rpc_label')).toHaveAttribute(
          'type',
          'hidden'
        );
        await expect(page.locator('input#rpc_label')).toHaveValue(LABEL);
        await expect(symbol).toHaveValue(SYMBOL);
        await expect(page.locator('input#rpc_url')).toHaveValue(RPC);
        observations.reopened = await publicState(page);
      }
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every((read) => read.url === RPC && read.method === 'eth_chainId')
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
      await info.attach('custom-network-required-fields-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          reads,
          unexpectedRpcRequests,
          attemptedWrites,
          fixtureReads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          proxyBlocked: server.blocked,
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
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
