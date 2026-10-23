import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { UTXO_FIXTURE_SEED } from '../harness/utxoFixture';

const CHAIN_ID = 31337;
const LABEL = 'Chain ID Validation Local';
const INVALID_CHAIN_ID = en.settings.positiveChainId;

// Same localhost-only transport boundary as customNetworkDurability. It never
// forwards; these inert reads also permit selecting the saved synthetic chain.
async function startLocalRpc(addresses: string[]) {
  let origin = '';
  const reads: string[] = [];
  const denied: Array<Record<string, unknown>> = [];
  const blockedProxy: Array<{
    classification: 'chromium-time-service' | 'refused-https-tunnel';
    forwarded: false;
    method: string;
    rawUrl: string;
    responseStatus: 403;
    url: string;
  }> = [];
  const knownAddresses = new Set(addresses.map((value) => value.toLowerCase()));
  const resultFor = (call: any): unknown => {
    if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
      return undefined;
    switch (call.method) {
      case 'eth_chainId':
        return `0x${CHAIN_ID.toString(16)}`;
      case 'net_version':
        return String(CHAIN_ID);
      case 'eth_blockNumber':
        return '0x1';
      case 'eth_getBalance':
      case 'eth_getTransactionCount':
        return knownAddresses.has(String(call.params[0]).toLowerCase())
          ? '0x0'
          : undefined;
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_getCode':
      case 'eth_call':
        return '0x';
      case 'eth_getLogs':
        return [];
      case 'eth_getBlockByNumber':
        return {
          number: '0x1',
          hash: '0x' + '12'.repeat(32),
          parentHash: '0x' + '11'.repeat(32),
          nonce: '0x0000000000000000',
          timestamp: '0x1',
          difficulty: '0x0',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          miner: '0x' + '00'.repeat(20),
          extraData: '0x',
          transactions: [],
          baseFeePerGas: '0x3b9aca00',
        };
      default:
        return undefined;
    }
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
    const allowed =
      url.origin === origin && url.pathname === '/rpc' && !url.search;
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (allowed && req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (!allowed || req.method !== 'POST') {
      const request = {
        method: req.method || 'unknown',
        rawUrl: req.url || '',
        url: url.href,
        responseStatus: 403 as const,
        forwarded: false as const,
      };
      // Chromium's launch-time clock probe reaches the deny proxy before page
      // routing exists. Only this exact non-RPC endpoint is expected here.
      if (
        req.method === 'GET' &&
        url.origin === 'http://clients2.google.com' &&
        url.pathname === '/time/1/current' &&
        !url.username &&
        !url.password &&
        !url.hash &&
        [...url.searchParams.keys()].every((key) =>
          ['cup2key', 'cup2hreq'].includes(key)
        )
      ) {
        blockedProxy.push({
          classification: 'chromium-time-service',
          ...request,
        });
      } else {
        denied.push({ reason: 'unexpected-http-request', ...request });
      }
      res.writeHead(403, headers);
      res.end('{}');
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        denied.push({
          reason: 'oversized-rpc-body',
          method: req.method,
          url: url.href,
          forwarded: false,
        });
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        const calls = Array.isArray(input) ? input : [input];
        const replies = calls.map((call: any) => {
          const result = resultFor(call);
          if (result === undefined) {
            denied.push({
              reason: 'unsupported-rpc-call',
              method: req.method,
              url: url.href,
              rpcMethod: String(call?.method),
              responseStatus: 200,
              rpcError: -32601,
              forwarded: false,
            });
            return {
              jsonrpc: '2.0',
              id: call?.id,
              error: { code: -32601, message: 'Read-only local RPC fixture' },
            };
          }
          reads.push(call.method);
          return { jsonrpc: '2.0', id: call.id, result };
        });
        res.writeHead(200, headers);
        res.end(JSON.stringify(Array.isArray(input) ? replies : replies[0]));
      } catch {
        denied.push({
          reason: 'malformed-rpc-json',
          method: req.method,
          url: url.href,
          responseStatus: 400,
          forwarded: false,
        });
        res.writeHead(400, headers);
        res.end('{}');
      }
    });
  });
  server.on('connect', (request, socket) => {
    const rawUrl = request.url || '';
    // This is a refusal, not a destination allowlist: no socket is opened to
    // any target. Keep every full HTTPS authority in the launch-proxy audit.
    if (/^[a-z0-9.-]+:443$/i.test(rawUrl)) {
      blockedProxy.push({
        classification: 'refused-https-tunnel',
        method: 'CONNECT',
        rawUrl,
        url: `https://${rawUrl}/`,
        responseStatus: 403,
        forwarded: false,
      });
    } else {
      denied.push({
        reason: 'unexpected-connect-authority',
        method: 'CONNECT',
        rawUrl,
        responseStatus: 403,
        forwarded: false,
      });
    }
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
    throw new Error('Missing RPC port');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    reads,
    denied,
    blockedProxy,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

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
            url: network.url,
            currency: network.currency,
            slip44: network.slip44,
          }
        : null;
    const ref = state.vault.activeAccount;
    return {
      live: project(state.vaultGlobal.networks.ethereum[chainId]),
      saved: project(saved.state?.vaultGlobal?.networks?.ethereum?.[chainId]),
      active: project(state.vault.activeNetwork),
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
    };
  }, CHAIN_ID);

test('custom RPC rejects malformed chain ID text and saves only the corrected matching integer', async ({}, info) => {
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
  const fixture = createIsolatedVaultFixture();
  const server = await startLocalRpc(fixture.evmAddresses);
  const rpc = `${server.url}/rpc`;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ChainIdInputSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('custom-rpc-chain-id-input', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route(`${server.url}/**`, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      return url.pathname === '/rpc' &&
        !url.search &&
        ['POST', 'OPTIONS'].includes(request.method())
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    const page = wallet.page;
    const save = page.getByRole('button', {
      name: en.buttons.save,
      exact: true,
    });
    const chain = page.locator('input#rpc_chainId');
    const chainError = page.locator('.ant-form-item').filter({ has: chain });
    let before: Awaited<ReturnType<typeof publicState>>;
    await wallet.step(
      'open Custom RPC normally and detect the fixed synthetic chain',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        before = await publicState(page);
        expect(before.live).toBeNull();
        expect(before.saved).toBeNull();
        const trigger = page
          .getByRole('button')
          .filter({ has: page.locator('#network-settings-btn') });
        await trigger.click();
        await page
          .getByRole('menuitem', {
            name: en.networkMenu.customRpc,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await page
          .getByRole('combobox', { name: en.settings.label, exact: true })
          .fill(LABEL);
        await page.locator('input#rpc_symbol').fill('TEST');
        await page.locator('input#rpc_url').fill(rpc);
        await page.locator('input#rpc_url').press('Tab');
        await expect(chain).toHaveValue(String(CHAIN_ID));
        expect(server.reads).toContain('eth_chainId');
        await expect(save).toBeEnabled();
        observations.before = before;
      }
    );
    for (const malformed of ['31337.5', '31337oops']) {
      await wallet.step(
        `refuse complete malformed chain ID ${malformed} without registration`,
        async () => {
          await chain.fill(malformed);
          const readsBefore = server.reads.length;
          await save.click();
          await expect(
            chainError.getByText(INVALID_CHAIN_ID, { exact: true })
          ).toBeVisible();
          await expect(chain).toHaveValue(malformed);
          await expect(save).toBeEnabled();
          expect(server.reads.length).toBe(readsBefore);
          expect(await publicState(page)).toEqual(before!);
          observations[malformed] = await chain.inputValue();
        }
      );
    }
    await wallet.step(
      'refuse a well-formed integer that does not match the fixed RPC',
      async () => {
        await chain.fill('31338');
        await save.click();
        await expect(
          page
            .getByText(
              en.settings.chainIdMismatch
                .replace('{{actual}}', String(CHAIN_ID))
                .replace('{{expected}}', '31338'),
              { exact: true }
            )
            .first()
        ).toBeVisible();
        await expect(chain).toHaveValue('31338');
        await expect(save).toBeEnabled();
        expect(await publicState(page)).toEqual(before!);
      }
    );
    await wallet.step(
      'correct the integer, persist it and select that real registry row',
      async () => {
        await chain.fill(String(CHAIN_ID));
        await save.click();
        await expect(page).toHaveURL(/#\/home$/);
        const expected = {
          chainId: CHAIN_ID,
          kind: 'ethereum',
          label: LABEL,
          url: rpc,
          currency: 'test',
          slip44: 60,
        };
        await expect
          .poll(async () => {
            const current = await publicState(page);
            return { live: current.live, saved: current.saved };
          })
          .toEqual({ live: expected, saved: expected });
        const added = await publicState(page);
        expect(added.account).toEqual(before!.account);
        expect(added.active).toEqual(before!.active);
        await wallet!.switchNetwork(LABEL, 'EVM');
        const selected = await publicState(page);
        expect(selected).toEqual({
          live: expected,
          saved: expected,
          active: expected,
          account: before!.account,
        });
        observations.selected = selected;
      }
    );
    expect(server.denied).toEqual([]);
    expect(
      server.blockedProxy.every(
        (request) => request.responseStatus === 403 && !request.forwarded
      )
    ).toBe(true);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('custom-rpc-chain-id-input-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          reads: server.reads,
          denied: server.denied,
          blockedProxy: server.blockedProxy,
          fixtureReads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
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
