import { expect, test, type Page, type Worker } from '@playwright/test';
import http from 'http';
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
import { UTXO_FIXTURE_SEED } from '../harness/utxoFixture';

const CHAIN_ID = 31337;
const LABEL = 'Durable Local RPC';
const FAILURE = 'Synthetic network registry storage refusal';

// Like the UTXO fixture proxy, this server never forwards traffic. Its only
// additional surface is the exact local RPC used by the real URL validator.
async function startLocalRpc() {
  let origin = '';
  const reads: string[] = [];
  const deniedWrites: string[] = [];
  const blocked: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
    const allowed =
      url.origin === origin &&
      ['/rpc', '/rpc-edited'].includes(url.pathname) &&
      !url.search;
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
      blocked.push(req.method || 'unknown');
      res.writeHead(403, headers);
      res.end('{}');
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        const requests = Array.isArray(input) ? input : [input];
        const replies = requests.map((call: any) => {
          const valid =
            call.jsonrpc === '2.0' &&
            Array.isArray(call.params) &&
            call.params.length === 0 &&
            ['eth_chainId', 'net_version', 'eth_blockNumber'].includes(
              call.method
            );
          if (!valid) {
            deniedWrites.push(String(call.method));
            return {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32601, message: 'Read-only local RPC fixture' },
            };
          }
          reads.push(`${url.pathname}:${call.method}`);
          return {
            jsonrpc: '2.0',
            id: call.id,
            result:
              call.method === 'net_version'
                ? String(CHAIN_ID)
                : call.method === 'eth_blockNumber'
                ? '0x1'
                : `0x${CHAIN_ID.toString(16)}`,
          };
        });
        res.writeHead(200, headers);
        res.end(JSON.stringify(Array.isArray(input) ? replies : replies[0]));
      } catch {
        res.writeHead(400, headers);
        res.end('{}');
      }
    });
  });
  server.on('connect', (_req, socket) => {
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
    throw new Error('Missing local RPC fixture port');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    reads,
    deniedWrites,
    blocked,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const registry = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const selected = (entry: any) =>
      entry
        ? {
            chainId: entry.chainId,
            kind: entry.kind,
            label: entry.label,
            url: entry.url,
            currency: entry.currency,
            slip44: entry.slip44,
          }
        : null;
    return {
      live: selected(state.vaultGlobal.networks.ethereum[chainId]),
      saved: selected(saved.state?.vaultGlobal?.networks?.ethereum?.[chainId]),
      activeNetwork: state.vault.activeNetwork,
    };
  }, CHAIN_ID);

test('custom RPC add and edit remain retryable after refused storage and survive a cold worker', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startLocalRpc();
  const rpc = `${server.url}/rpc`;
  const editedRpc = `${server.url}/rpc-edited`;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkDurabilitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  try {
    wallet = await PaliWallet.launch('custom-network-durability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(`${server.url}/**`, (route) => {
      const url = new URL(route.request().url());
      return ['/rpc', '/rpc-edited'].includes(url.pathname) &&
        ['POST', 'OPTIONS'].includes(route.request().method())
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    const page = wallet.page;
    const save = page.getByRole('button', {
      name: en.buttons.save,
      exact: true,
    });
    const labelInput = page.getByRole('combobox', {
      name: en.settings.label,
      exact: true,
    });
    const rpcInput = page.locator('input#rpc_url');
    const expected = (url: string) => ({
      chainId: CHAIN_ID,
      kind: 'ethereum',
      label: LABEL,
      url,
      currency: 'test',
      slip44: 60,
    });
    await wallet.step(
      'open the ordinary custom RPC form in an offline wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/networks/custom-rpc');
        await expect(labelInput).toBeVisible();
        await labelInput.fill(LABEL);
        await page.locator('input#rpc_symbol').fill('TEST');
        await page.locator('input#rpc_chainId').fill(String(CHAIN_ID));
        await rpcInput.fill(rpc);
        await rpcInput.press('Tab');
        await expect
          .poll(() => server.reads.includes('/rpc:eth_chainId'))
          .toBe(true);
        await expect(save).toBeEnabled();
      }
    );
    const before = await registry(page);
    expect(before.live).toBeNull();
    expect(before.saved).toBeNull();
    observations.before = before;
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await worker!.evaluate(
      ({ chainId, rpcUrl, editUrl, failure }) => {
        const local = chrome.storage.local;
        const original = local.set;
        const probe = {
          mode: 'add',
          failures: { add: 0, edit: 0 },
          attempts: { add: 0, edit: 0 },
          restore: () => {
            local.set = original;
            delete (globalThis as any).__networkRegistryStorage;
          },
        };
        (globalThis as any).__networkRegistryStorage = probe;
        local.set = ((items: Record<string, any>, ...args: any[]) => {
          const mode = probe.mode as 'add' | 'edit';
          const entry = items.state?.vaultGlobal?.networks?.ethereum?.[chainId];
          if (entry?.url === (mode === 'add' ? rpcUrl : editUrl)) {
            probe.attempts[mode] += 1;
            if (!probe.failures[mode]) {
              probe.failures[mode] += 1;
              throw new Error(`${failure} (${mode})`);
            }
          }
          return (original as any).call(local, items, ...args);
        }) as typeof local.set;
      },
      { chainId: CHAIN_ID, rpcUrl: rpc, editUrl: editedRpc, failure: FAILURE }
    );
    const dismissRefusal = async (mode: 'add' | 'edit') => {
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: `${FAILURE} (${mode})` });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText(`${FAILURE} (${mode})`, { exact: true })
      ).toBeVisible();
      await dialog
        .getByRole('button', { name: en.buttons.close, exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(save).toBeEnabled();
      await expect(save).toBeInViewport();
    };
    await wallet.step(
      'refuse add without publishing it and retry the same form',
      async () => {
        await save.click();
        await dismissRefusal('add');
        expect(await registry(page)).toEqual(before);
        await expect(rpcInput).toHaveValue(rpc);
        await expect(labelInput).toHaveValue(LABEL);
        await save.click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect
          .poll(() => registry(page))
          .toEqual({
            live: expected(rpc),
            saved: expected(rpc),
            activeNetwork: before.activeNetwork,
          });
        observations.added = await registry(page);
      }
    );
    await wallet.step(
      'edit the real saved registry row and retain its prior config on refusal',
      async () => {
        await wallet!.gotoRoute('#/settings/networks/edit');
        const row = page
          .locator('li')
          .filter({ has: page.getByText(LABEL, { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(rpcInput).toHaveValue(rpc);
        await worker!.evaluate(() => {
          (globalThis as any).__networkRegistryStorage.mode = 'edit';
        });
        await rpcInput.fill(editedRpc);
        await rpcInput.press('Tab');
        await expect
          .poll(() => server.reads.includes('/rpc-edited:eth_chainId'))
          .toBe(true);
        await save.click();
        await dismissRefusal('edit');
        expect(await registry(page)).toEqual(observations.added);
        await expect(rpcInput).toHaveValue(editedRpc);
        await save.click();
        await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
        await expect
          .poll(() => registry(page))
          .toEqual({
            live: expected(editedRpc),
            saved: expected(editedRpc),
            activeNetwork: before.activeNetwork,
          });
        observations.edited = await registry(page);
        observations.storage = await worker!.evaluate(() => {
          const probe = (globalThis as any).__networkRegistryStorage;
          const result = { attempts: probe.attempts, failures: probe.failures };
          probe.restore();
          return result;
        });
        expect(observations.storage).toMatchObject({
          failures: { add: 1, edit: 1 },
        });
      }
    );
    await wallet.step(
      'restore the accepted registry after an actual background-worker restart',
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
        expect(await registry(page)).toEqual(observations.edited);
        await wallet!.gotoRoute('#/settings/networks/edit');
        const row = page
          .locator('li')
          .filter({ has: page.getByText(LABEL, { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(rpcInput).toHaveValue(editedRpc);
      }
    );
    expect(server.deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('custom-network-durability-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: extensionEvidence(),
          observations,
          reads: server.reads,
          deniedWrites: [
            ...server.deniedWrites,
            ...(routes?.deniedWrites || []),
          ],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
        }),
      });
    } finally {
      await worker
        ?.evaluate(() =>
          (globalThis as any).__networkRegistryStorage?.restore()
        )
        .catch(() => undefined);
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
