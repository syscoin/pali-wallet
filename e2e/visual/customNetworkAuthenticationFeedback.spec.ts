import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

// Draft intentionally stays outside the source checkout. When promoted, replace
// these absolute imports with the ordinary e2e/visual relative imports.
import en from '../../source/assets/locales/en.json';
import es from '../../source/assets/locales/es.json';
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
const ENGLISH_GUIDANCE =
  'This RPC endpoint requires authentication. Please use an RPC URL that includes your API key or choose a different provider.';

// Real loopback HTTP boundary plus launch-time deny proxy. No upstream socket,
// injected controller response, Redux mutation, fabricated DOM state or signing.
async function startAuthenticationRpc() {
  let origin = '';
  const reads: { id: unknown; method: string; path: string; status: number }[] =
    [];
  const denied: unknown[] = [];
  const proxyRefusals: unknown[] = [];
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
    const allowed =
      url.origin === origin &&
      ['/auth-rpc', '/healthy-rpc'].includes(url.pathname) &&
      !url.search;
    if (allowed && req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (!allowed || req.method !== 'POST') {
      proxyRefusals.push({
        method: req.method,
        url: url.href,
        forwarded: false,
      });
      res.writeHead(403, headers);
      res.end('{}');
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        denied.push({ reason: 'oversized-body', url: url.href });
        req.destroy();
      }
    });
    req.on('end', () => {
      let call: any;
      try {
        call = JSON.parse(body);
      } catch {
        /* refused below */
      }
      if (
        call?.jsonrpc !== '2.0' ||
        call.method !== 'eth_chainId' ||
        !Array.isArray(call.params) ||
        call.params.length ||
        !['number', 'string'].includes(typeof call.id)
      ) {
        denied.push({
          reason: 'unexpected-rpc',
          path: url.pathname,
          method: call?.method,
        });
        res.writeHead(400, headers);
        res.end('{}');
        return;
      }
      const status = url.pathname === '/auth-rpc' ? 401 : 200;
      reads.push({
        path: url.pathname,
        method: call.method,
        id: call.id,
        status,
      });
      res.writeHead(
        status,
        status === 401 ? { ...headers, 'Content-Type': 'text/plain' } : headers
      );
      res.end(
        status === 401
          ? 'unauthorized'
          : JSON.stringify({ jsonrpc: '2.0', id: call.id, result: '0x7a69' })
      );
    });
  });
  server.on('connect', (request, socket) => {
    proxyRefusals.push({
      method: 'CONNECT',
      url: request.url,
      forwarded: false,
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE')
        server.emit('error', error);
    });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local RPC port');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    reads,
    denied,
    proxyRefusals,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function networkState(page: Page) {
  return page.evaluate(async (chainId) => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const persisted = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? {
            kind: network.kind,
            chainId: network.chainId,
            url: network.url,
            label: network.label,
            currency: network.currency,
          }
        : null;
    return {
      persistedRegistryAvailable: Boolean(
        persisted.state?.vaultGlobal?.networks?.ethereum
      ),
      live: project(current.vaultGlobal.networks.ethereum[chainId]),
      persisted: project(
        persisted.state?.vaultGlobal?.networks?.ethereum?.[chainId]
      ),
      active: project(current.vault.activeNetwork),
    };
  }, CHAIN_ID);
}

test('custom network authentication feedback follows the saved Spanish locale and recovers without registration', async ({}, info) => {
  expect(process.version).toBe('v26.12.1');
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
  const server = await startAuthenticationRpc();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RpcAuthSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = { runtime, sourceSha256 };
  const pageErrors: string[] = [];
  try {
    wallet = await PaliWallet.launch('custom-network-authentication-feedback', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(`${server.url}/**`, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      return ['/auth-rpc', '/healthy-rpc'].includes(url.pathname) &&
        !url.search &&
        ['POST', 'OPTIONS'].includes(request.method())
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await wallet.step(
      'set Spanish through the ordinary language controls',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', {
            name: en.generalMenu.languages,
            exact: true,
          })
          .click();
        await page
          .getByRole('button', {
            name: en.settings.setYourPreferredLanguage,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: 'Spanish Español', exact: true })
          .click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(
          page.getByText(es.settings.languageWasSet, { exact: true })
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      }
    );
    let before: Awaited<ReturnType<typeof networkState>>;
    await wallet.step(
      'open ordinary Custom RPC and receive a real local HTTP401',
      async () => {
        before = await networkState(page);
        observations.before = before;
        expect(before.persistedRegistryAvailable).toBe(true);
        expect(before.live).toBeNull();
        expect(before.persisted).toBeNull();
        await page
          .getByRole('button')
          .filter({ has: page.locator('#network-settings-btn') })
          .click();
        await page
          .getByRole('menuitem', {
            name: es.networkMenu.customRpc,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await page
          .getByRole('combobox', { name: es.settings.label, exact: true })
          .fill('Public authentication fixture');
        await page.locator('#rpc_symbol').fill('TEST');
        await page.locator('#rpc_chainId').fill(String(CHAIN_ID));
        await page.locator('#rpc_url').fill(`${server.url}/auth-rpc`);
        await page.locator('#rpc_url').press('Tab');
        const field = page
          .locator('.ant-form-item')
          .filter({ has: page.locator('#rpc_url') });
        await expect(
          field.locator('.ant-form-item-explain-error')
        ).toBeVisible();
        const error = await field
          .locator('.ant-form-item-explain-error')
          .innerText();
        observations.authenticationError = error;
        await info.attach('custom-network-authentication-error', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        expect(error.trim().length).toBeGreaterThan(0);
        // Preserve the before-state negative check and require Pali's exact
        // localized guidance, while continuing to exercise refusal and recovery.
        expect.soft(error).not.toContain(ENGLISH_GUIDANCE);
        expect.soft(error.trim()).toBe(es.settings.rpcAuthenticationRequired);
        expect(
          server.reads.some(
            (read) => read.path === '/auth-rpc' && read.status === 401
          )
        ).toBe(true);
        await page
          .getByRole('button', { name: es.buttons.save, exact: true })
          .click();
        await expect(
          field.locator('.ant-form-item-explain-error')
        ).toBeVisible();
        expect(await networkState(page)).toEqual(before);
      }
    );
    await wallet.step(
      'replace the rejected URL with a healthy local RPC without saving',
      async () => {
        await page.locator('#rpc_url').fill(`${server.url}/healthy-rpc`);
        await page.locator('#rpc_url').press('Tab');
        await expect(page.locator('#rpc_chainId')).toHaveValue(
          String(CHAIN_ID)
        );
        const field = page
          .locator('.ant-form-item')
          .filter({ has: page.locator('#rpc_url') });
        await expect(field.locator('.ant-form-item-explain-error')).toHaveCount(
          0
        );
        await expect(
          page.getByRole('button', { name: es.buttons.save, exact: true })
        ).toBeEnabled();
        expect(
          server.reads.some(
            (read) => read.path === '/healthy-rpc' && read.status === 200
          )
        ).toBe(true);
        observations.after = await networkState(page);
        expect(observations.after).toEqual(before!);
        await info.attach('custom-network-authentication-recovered', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    );
    expect(server.denied).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(server.reads.every((read) => read.method === 'eth_chainId')).toBe(
      true
    );
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await info.attach('custom-network-authentication-feedback', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          observations,
          reads: server.reads,
          denied: server.denied,
          proxyRefusals: server.proxyRefusals,
          fixtureReads: routes?.reads,
          deniedWrites: routes?.deniedWrites,
          pageErrors,
          syntheticHttpOnly: true,
          controllerResponsesReplaced: false,
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
