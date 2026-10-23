import { expect, test, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { UTXO_FIXTURE_SEED } from '../harness/utxoFixture';

const CHAIN_ID = 31337;
const LABEL = 'RPC recovery fixture';
const RPC_ERROR = 'Synthetic RPC temporarily unavailable';
const FIELD_ERROR = `Error getting chain ID: ${RPC_ERROR}`;
const NETWORK_FIELDS = [
  'kind',
  'chainId',
  'slip44',
  'url',
  'label',
  'currency',
  'explorer',
  'apiUrl',
  'key',
  'default',
  'coingeckoId',
  'coingeckoPlatformId',
];
const BLACKLIST_FEEDS = new Map<string, unknown>([
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    { blacklist: [], whitelist: [], fuzzylist: [] },
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
    [],
  ],
]);

const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return `${url.origin}${url.pathname}${query.size ? `?${query}` : ''}`;
};

// A real local HTTP server, never a controller or Chrome-message replacement.
// Failure is a JSON-RPC error at HTTP200, not a transport failure or timeout.
async function startRpcFixture() {
  let origin = '';
  let initialUnavailable = true;
  const reads: Array<{
    at: number;
    method: string;
    outcome: string;
    path: string;
  }> = [];
  const forbidden: string[] = [];
  const blocked: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
    const headers = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (
      request.method === 'GET' &&
      url.origin === origin &&
      url.pathname === '/' &&
      !url.search
    ) {
      response.writeHead(200, headers).end('{}');
      return;
    }
    const allowedPath =
      url.origin === origin &&
      ['/rpc-initial', '/rpc-edited'].includes(url.pathname) &&
      !url.search;
    if (allowedPath && request.method === 'OPTIONS') {
      response.writeHead(204, headers).end();
      return;
    }
    if (!allowedPath || request.method !== 'POST') {
      // Refuse Chromium's pre-routing clock probe without confusing it with
      // a wallet request. All other unexpected HTTP remains a hard failure.
      if (
        request.method === 'GET' &&
        url.origin === 'http://clients2.google.com' &&
        url.pathname === '/time/1/current' &&
        !url.username &&
        !url.password &&
        !url.hash &&
        [...url.searchParams.keys()].every((key) =>
          ['cup2key', 'cup2hreq'].includes(key)
        )
      )
        blocked.push(`chromium-time-service ${request.url}`);
      else forbidden.push(`${request.method} ${url.href}`);
      response.writeHead(403, headers).end('{}');
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) request.destroy();
    });
    request.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const calls = Array.isArray(payload) ? payload : [payload];
        const replies = calls.map((call: any) => {
          if (
            call?.jsonrpc !== '2.0' ||
            call.method !== 'eth_chainId' ||
            !Array.isArray(call.params) ||
            call.params.length !== 0
          ) {
            forbidden.push(String(call?.method));
            return {
              jsonrpc: '2.0',
              id: call?.id,
              error: {
                code: -32601,
                message: 'Read-only chain identity fixture',
              },
            };
          }
          const fail = url.pathname === '/rpc-initial' && initialUnavailable;
          reads.push({
            at: Date.now(),
            path: url.pathname,
            method: call.method,
            outcome: fail ? 'rpc-error' : 'success',
          });
          return fail
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: { code: -32000, message: RPC_ERROR },
              }
            : {
                jsonrpc: '2.0',
                id: call.id,
                result: `0x${CHAIN_ID.toString(16)}`,
              };
        });
        response
          .writeHead(200, headers)
          .end(JSON.stringify(Array.isArray(payload) ? replies : replies[0]));
      } catch {
        forbidden.push('malformed JSON');
        response.writeHead(400, headers).end('{}');
      }
    });
  });
  server.on('connect', (_request, socket) => {
    blocked.push('CONNECT');
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE')
        server.emit('error', error);
      socket.destroy();
    });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    reads,
    forbidden,
    blocked,
    recoverInitial: () => {
      initialUnavailable = false;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const publicRegistry = (page: Page) =>
  page.evaluate(
    async ({ fields, targetId }) => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const stored = await chrome.storage.local.get('state');
      const project = (network: any) =>
        network
          ? Object.fromEntries(
              fields.map((field) => [field, network[field] ?? null])
            )
          : null;
      const registries = (value: any) =>
        Object.fromEntries(
          ['ethereum', 'syscoin'].map((family) => [
            family,
            Object.fromEntries(
              Object.entries(value?.vaultGlobal?.networks?.[family] || {}).map(
                ([key, network]) => [key, project(network)]
              )
            ),
          ])
        );
      return {
        live: registries(state),
        saved: registries(stored.state),
        target: project(state.vaultGlobal.networks.ethereum[targetId]),
        savedTarget: project(
          stored.state?.vaultGlobal?.networks?.ethereum?.[targetId]
        ),
        active: project(state.vault.activeNetwork),
        account: {
          id: state.vault.activeAccount.id,
          type: state.vault.activeAccount.type,
        },
      };
    },
    { fields: NETWORK_FIELDS, targetId: CHAIN_ID }
  );

const fieldSnapshot = (page: Page) =>
  page.locator('#rpc_url').evaluate((element) => {
    const input = element as HTMLInputElement;
    const item = input.closest('.ant-form-item');
    return {
      value: input.value,
      invalid: input.getAttribute('aria-invalid'),
      errors: Array.from(
        item?.querySelectorAll('.ant-form-item-explain-error') || []
      )
        .filter(
          (error) =>
            error.getClientRects().length > 0 &&
            getComputedStyle(error).visibility !== 'hidden'
        )
        .map((error) => error.textContent || ''),
      focused: input === document.activeElement,
    };
  });

for (const scenario of ['edited-url', 'same-url'] as const) {
  test(`Custom RPC ${scenario} retry clears prior validation feedback`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.version).toBe('v23.11.1');
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
    const fixture = createIsolatedVaultFixture();
    const config = getNetworkConfig(57, 'sys');
    const initialXpub = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      config.networks,
      57,
      config.types.zPubType,
      84
    ).getAccountXpub();
    const startupQueries = new Set([
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ]);
    const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
    const addAuxiliary = (url: string, body: unknown) =>
      auxiliary.set(requestKey(new URL(url)), body);
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addAuxiliary(`${origin}/api/v2/tickers/currency`, {
        ts: 1,
        rates: { usd: 1 },
      });
    addAuxiliary('https://chainlist.org/rpcs.json', []);
    addAuxiliary('https://api.coingecko.com/api/v3/asset_platforms', []);
    addAuxiliary(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      { syscoin: { usd: 1, ['usd_24h_change']: 0 } }
    );
    for (const action of ['tokenlist', 'txlist', 'pendingtxlist', 'tokentx']) {
      const url = new URL('https://explorer.tanenbaum.io/api');
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', action);
      url.searchParams.set('address', fixture.evmAddresses[0]);
      if (action === 'txlist' || action === 'tokentx')
        url.searchParams.set('sort', 'desc');
      addAuxiliary(url.href, {
        status: action === 'tokenlist' ? '1' : '0',
        message: action === 'tokenlist' ? 'OK' : 'No transactions found',
        result: [],
      });
    }
    const server = await startRpcFixture();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'UnchangedRpcSynthetic!2026',
      rpcUrl: server.origin,
    });
    const httpReads: Array<{ method: string; url: string }> = [];
    const httpFailures: Array<{ method: string; url: string }> = [];
    const forbiddenRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = {
      scenario,
      runtime,
      sourceSha256,
      milestones: {},
    };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const evidence = () => ({
      status,
      observations,
      rpcReads: server.reads,
      httpReads,
      httpFailures,
      forbiddenRequests,
      pageErrors,
      fixtureReads: routes?.reads || [],
      fixtureDeniedWrites: routes?.deniedWrites || [],
      forbiddenLocalRequests: server.forbidden,
      proxyBlockedConnections: server.blocked.length,
      proxyCountIsPlatformEvidenceOnly: true,
      controllerReplaced: false,
      chromeReplaced: false,
      formReplaced: false,
      stateInjected: false,
      signingOrBroadcastRequested: false,
    });
    try {
      wallet = await PaliWallet.launch(
        `custom-rpc-error-recovery-${scenario}`,
        {
          offlineHttpProxy: server.origin,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.origin
      );
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          httpReads.push({ method: request.method(), url: request.url() });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname))
          forbiddenRequests.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          /* Ordinary GET has no JSON body. */
        }
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          httpFailures.push({ method: request.method(), url: request.url() });
      });
      await wallet.context.route(`${server.origin}/**`, (route) => {
        const request = route.request(),
          url = new URL(request.url());
        return (!url.search &&
          ['/rpc-initial', '/rpc-edited'].includes(url.pathname) &&
          ['POST', 'OPTIONS'].includes(request.method())) ||
          (url.pathname === '/' && !url.search && request.method() === 'GET')
          ? route.continue()
          : route.fallback();
      });
      await wallet.context.route(
        (url) =>
          auxiliary.has(requestKey(url)) ||
          (url.origin === 'https://blockbook.syscoin.org' &&
            url.pathname === `/api/v2/xpub/${initialXpub}` &&
            startupQueries.has(url.searchParams.toString())),
        async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const url = new URL(route.request().url());
          const body = auxiliary.has(requestKey(url))
            ? auxiliary.get(requestKey(url))
            : {
                address: initialXpub,
                balance: '0',
                unconfirmedBalance: '0',
                totalReceived: '0',
                totalSent: '0',
                txs: 0,
                unconfirmedTxs: 0,
                usedTokens: 0,
                tokens: [],
                tokensAsset: [],
                transactions: [],
              };
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(body),
          });
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const step: PaliWallet['step'] = (name, action) =>
        wallet!.step(`${scenario}: ${name}`, action);
      const urlInput = page.locator('#rpc_url');
      const chainInput = page.locator('#rpc_chainId');
      const urlErrors = page
        .locator('.ant-form-item')
        .filter({ has: urlInput })
        .locator('.ant-form-item-explain-error');
      const openMenu = async () => {
        const trigger = page
          .getByRole('button')
          .filter({ has: page.locator('#network-settings-btn') });
        await expect(trigger).toHaveCount(1);
        await trigger.click();
      };
      let initial: Awaited<ReturnType<typeof publicRegistry>>;
      let recovery: Awaited<ReturnType<typeof fieldSnapshot>>;
      const initialUrl = `${server.origin}/rpc-initial`;
      const targetUrl =
        scenario === 'same-url' ? initialUrl : `${server.origin}/rpc-edited`;
      await step(
        'open the real custom RPC form from an unchanged active wallet',
        async () => {
          observations.worker = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.worker = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          initial = await publicRegistry(page);
          expect(initial.target).toBeNull();
          expect(initial.savedTarget).toBeNull();
          expect(initial.live).toEqual(initial.saved);
          expect(initial.active).toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
          });
          await openMenu();
          await page
            .getByRole('menuitem', {
              name: en.networkMenu.customRpc,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          observations.initial = initial;
        }
      );
      await step(
        'observe a genuine failed identity request and inline field error',
        async (capture) => {
          await page
            .getByRole('combobox', { name: en.settings.label, exact: true })
            .fill(LABEL);
          await page.locator('#rpc_symbol').fill('ETH');
          await page
            .locator('#rpc_explorer')
            .fill(`${server.origin}/explorer/`);
          await urlInput.fill(initialUrl);
          await page.keyboard.press('Tab');
          await expect
            .poll(
              () =>
                server.reads.filter((read) => read.outcome === 'rpc-error')
                  .length
            )
            .toBe(1);
          await expect(urlErrors).toHaveText(FIELD_ERROR);
          await expect(urlInput).toHaveAttribute('aria-invalid', 'true');
          await expect(chainInput).toHaveValue('');
          expect(await publicRegistry(page)).toEqual(initial);
          observations.failed = await fieldSnapshot(page);
          await capture(page);
        }
      );
      await step(
        'retry through normal focus and blur after the provider recovers',
        async (capture) => {
          const recoveredAt = Date.now();
          server.recoverInitial();
          await urlInput.click();
          if (scenario === 'edited-url') await urlInput.fill(targetUrl);
          await page.keyboard.press('Tab');
          await expect
            .poll(() =>
              server.reads.some(
                (read) =>
                  read.at >= recoveredAt &&
                  read.outcome === 'success' &&
                  read.path === new URL(targetUrl).pathname
              )
            )
            .toBe(true);
          // Auto-fill is the downstream proof that the current successful reply
          // passed the unmodified UI's operation guard, not just a server receipt.
          await expect(chainInput).toHaveValue(String(CHAIN_ID));
          await expect(urlInput).toHaveValue(targetUrl);
          await expect(urlErrors).toHaveCount(0);
          await expect(urlInput).not.toHaveAttribute('aria-invalid', 'true');
          recovery = await fieldSnapshot(page);
          observations.recovery = recovery;
          expect(await publicRegistry(page)).toEqual(initial);
          observations.milestones.noPrematureRegistryMutation = true;
          await capture(page);
        }
      );
      await step(
        'Save performs full validation and durably adds only the exact target',
        async () => {
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
          await expect
            .poll(async () => (await publicRegistry(page)).savedTarget?.url)
            .toBe(targetUrl);
          const saved = await publicRegistry(page);
          expect(saved.target).toEqual(saved.savedTarget);
          expect(saved.target).toMatchObject({
            chainId: CHAIN_ID,
            kind: 'ethereum',
            slip44: 60,
            label: LABEL,
            url: targetUrl,
            explorer: `${server.origin}/explorer/`,
            currency: 'eth',
            default: false,
          });
          const remaining = (registries: typeof saved.live) => ({
            ...registries,
            ethereum: Object.fromEntries(
              Object.entries(registries.ethereum).filter(
                ([id]) => Number(id) !== CHAIN_ID
              )
            ),
          });
          expect(remaining(saved.live)).toEqual(initial.live);
          expect(remaining(saved.saved)).toEqual(initial.saved);
          expect(saved.active).toEqual(initial.active);
          expect(saved.account).toEqual(initial.account);
          observations.saved = saved;
          observations.milestones.fullValidationSaveHealthy = true;
        }
      );
      await step(
        'reopen the exact saved registration and Cancel without changing it',
        async (capture) => {
          const before = await publicRegistry(page);
          await openMenu();
          await page
            .getByRole('menuitem', {
              name: en.networkMenu.manageNetworks,
              exact: true,
            })
            .click();
          const identity = `${LABEL} (EVM · ${en.settings.chainNumber.replace(
            '{{chainId}}',
            String(CHAIN_ID)
          )})`;
          await page
            .getByRole('button', {
              name: `${en.buttons.edit}: ${identity}`,
              exact: true,
            })
            .click();
          await expect(urlInput).toHaveValue(targetUrl);
          await expect(chainInput).toHaveValue(String(CHAIN_ID));
          await expect(page.locator('#rpc_symbol')).toHaveValue('ETH');
          await expect(urlErrors).toHaveCount(0);
          await expect(urlInput).not.toHaveAttribute('aria-invalid', 'true');
          await capture(page);
          await page
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
          expect(await publicRegistry(page)).toEqual(before);
          observations.milestones.exactReopenCancelHealthy = true;
        }
      );
      await step(
        'verify immutable source and all read-only network fences',
        async () => {
          expect(
            server.reads.every((read) => read.method === 'eth_chainId')
          ).toBe(true);
          expect(server.forbidden).toEqual([]);
          expect(forbiddenRequests).toEqual([]);
          expect(httpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
          observations.milestones.safetyHealthy = true;
          await info.attach('custom-rpc-recovery-before-assertion', {
            contentType: 'application/json',
            body: JSON.stringify(evidence(), null, 2),
          });
        }
      );
      await step(
        'successful retry must not retain the earlier inline RPC failure',
        async () => {
          // Retain the captured pre-Save assertion after all independent
          // Save/reopen/Cancel and safety controls.
          expect({
            invalid: recovery.invalid,
            errors: recovery.errors,
          }).toEqual({ invalid: null, errors: [] });
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('custom-rpc-unchanged-url-recovery', {
          contentType: 'application/json',
          body: JSON.stringify(evidence(), null, 2),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
