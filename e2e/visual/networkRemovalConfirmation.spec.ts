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
const ORIGINAL = 'Removal original';
const REPLACEMENT = 'Removal replacement';
const OLD_EXPLORER = 'https://original-explorer.synthetic.invalid/';
const NEW_EXPLORER = 'https://replacement-explorer.synthetic.invalid/';
const PUBLIC_NETWORK_FIELDS = [
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

// Narrow copy of the private local RPC helper in customNetworkDurability.
// It never forwards HTTP or CONNECT traffic and serves one read-only endpoint.
async function startRegistrationFixture() {
  let origin = '';
  const reads: string[] = [];
  const deniedWrites: string[] = [];
  const blocked: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
    const allowed =
      url.origin === origin && url.pathname === '/rpc' && !url.search;
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (allowed && request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (!allowed || request.method !== 'POST') {
      blocked.push(request.method || 'unknown');
      response.writeHead(403, headers);
      response.end('{}');
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
            !Array.isArray(call.params) ||
            call.params.length !== 0 ||
            !['eth_chainId', 'net_version', 'eth_blockNumber'].includes(
              call.method
            )
          ) {
            deniedWrites.push(String(call?.method));
            return {
              jsonrpc: '2.0',
              id: call?.id,
              error: {
                code: -32601,
                message: 'Read-only registration fixture',
              },
            };
          }
          reads.push(call.method);
          return {
            jsonrpc: '2.0',
            id: call.id,
            result:
              call.method === 'net_version'
                ? String(CHAIN_ID)
                : call.method === 'eth_blockNumber'
                ? '0x1'
                : '0x7a69',
          };
        });
        response.writeHead(200, headers);
        response.end(
          JSON.stringify(Array.isArray(payload) ? replies : replies[0])
        );
      } catch {
        response.writeHead(400, headers);
        response.end('{}');
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
    throw new Error('Missing registration fixture port');
  origin = 'http://127.0.0.1:' + address.port;
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

const snapshot = (page: Page) =>
  page.evaluate(
    async ({ chainId, fields }) => {
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
      return {
        live: project(state.vaultGlobal.networks.ethereum[chainId]),
        saved: project(
          stored.state?.vaultGlobal?.networks?.ethereum?.[chainId]
        ),
        active: project(state.vault.activeNetwork),
        activeSlip44: state.vaultGlobal.activeSlip44,
        isBitcoinBased: state.vault.isBitcoinBased,
      };
    },
    { chainId: CHAIN_ID, fields: PUBLIC_NETWORK_FIELDS }
  );

const registryChanges = (page: Page) =>
  page.evaluate(() => [
    ...((window as any).__networkRemovalRegistryChanges || []),
  ]);

test('stale network removal confirmation preserves a same-URL replacement until fresh approval', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(__filename))
    .digest('hex');
  const previousConfig = { ...E2E_CONFIG };
  let server: Awaited<ReturnType<typeof startRegistrationFixture>> | undefined;
  let wallet: PaliWallet | undefined;
  let other: Page | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  let stableRegistryChangeCount = 0;
  try {
    server = await startRegistrationFixture();
    const rpc = server.url + '/rpc';
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'RemovalConfirmationSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('network-removal-confirmation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(server.url + '/**', (route) => {
      const url = new URL(route.request().url());
      return url.pathname === '/rpc' &&
        ['POST', 'OPTIONS'].includes(route.request().method())
        ? route.continue()
        : route.fallback();
    });
    const page = wallet.page;
    const title = (label: string) =>
      en.settings.confirmRemoveNetwork.replace(
        '{{networkName}}',
        `${label} (EVM · ${en.settings.chainNumber.replace(
          '{{chainId}}',
          String(CHAIN_ID)
        )})`
      );
    const row = (target: Page, label: string) =>
      target.locator('li').filter({
        has: target.getByText(label, { exact: true }),
      });
    const openRemoval = async (target: Page, label: string) => {
      await expect(row(target, label)).toHaveCount(1);
      const button = row(target, label).locator('button').last();
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = target.getByRole('dialog', {
        name: title(label),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const manage = async (target: Page) => {
      await target.goto(wallet!.appUrl('#/settings/networks/edit'));
      await expect(
        target.locator('[data-navigation-scroll="settings-manage-networks"]')
      ).toBeVisible();
    };
    const add = async (target: Page, label: string, explorer: string) => {
      await target.goto(wallet!.appUrl('#/settings/networks/custom-rpc'));
      const kind = target.getByRole('switch', {
        name: en.settings.networkFamilyLabel.replace('{{family}}', 'Syscoin'),
        exact: true,
      });
      await expect(kind).toHaveAttribute('aria-checked', 'false');
      await target
        .getByRole('combobox', { name: en.settings.label, exact: true })
        .fill(label);
      await target.locator('#rpc_symbol').fill('TEST');
      await target.locator('#rpc_chainId').fill(String(CHAIN_ID));
      await target.locator('#rpc_explorer').fill(explorer);
      const rpcInput = target.locator('#rpc_url');
      const beforeReads = server!.reads.length;
      await rpcInput.fill(rpc);
      await rpcInput.press('Tab');
      // The SDK caches chain identity for the same URL. Require the initial
      // real HTTP validation without pretending re-add must bypass that cache.
      if (beforeReads === 0) {
        await expect.poll(() => server!.reads).toContain('eth_chainId');
      } else {
        expect(server!.reads).toContain('eth_chainId');
      }
      const save = target.getByRole('button', {
        name: en.buttons.save,
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(target).not.toHaveURL(/#\/settings\/networks\/custom-rpc$/);
      await expect
        .poll(async () => (await snapshot(target)).saved?.label)
        .toBe(label);
      const added = await snapshot(target);
      expect(added.live).toEqual(added.saved);
      expect(added.live).toMatchObject({
        chainId: CHAIN_ID,
        kind: 'ethereum',
        label,
        url: rpc,
        explorer,
        default: false,
      });
      return added;
    };
    const step = (
      name: string,
      target: () => Page,
      action: () => Promise<void>
    ) =>
      wallet!.step(name, async (capture) => {
        try {
          await action();
        } finally {
          const current = target();
          if (!current.isClosed()) await capture(current);
        }
      });

    await step(
      'open an offline UTXO wallet with a public registry baseline',
      () => page,
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        const baseline = await snapshot(page);
        expect(baseline.live).toBeNull();
        expect(baseline.saved).toBeNull();
        expect(baseline.isBitcoinBased).toBe(true);
        observations.baseline = baseline;
      }
    );

    await step(
      'add the original inactive EVM registration through the normal RPC form',
      () => page,
      async () => {
        observations.original = await add(page, ORIGINAL, OLD_EXPLORER);
        expect((observations.original as any).active).toEqual(
          (observations.baseline as any).active
        );
        await manage(page);
        await expect(row(page, ORIGINAL)).toBeVisible();
        // A native read-only observer, not a replacement for Chrome or controller APIs.
        await page.evaluate(
          ({ chainId, fields }) => {
            const events: unknown[] = [];
            (window as any).__networkRemovalRegistryChanges = events;
            const project = (state: any) => {
              const network = state?.vaultGlobal?.networks?.ethereum?.[chainId];
              return network
                ? Object.fromEntries(
                    fields.map((field) => [field, network[field] ?? null])
                  )
                : null;
            };
            chrome.storage.onChanged.addListener((changes, area) => {
              if (area !== 'local' || !changes.state) return;
              const before = project(changes.state.oldValue);
              const after = project(changes.state.newValue);
              if (JSON.stringify(before) !== JSON.stringify(after))
                events.push({ before, after });
            });
          },
          { chainId: CHAIN_ID, fields: PUBLIC_NETWORK_FIELDS }
        );
      }
    );

    await step(
      'cancel once safely then retain the original confirmation while opening another page',
      () => page,
      async () => {
        let dialog = await openRemoval(page, ORIGINAL);
        await dialog
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        expect(await snapshot(page)).toEqual(observations.original);
        dialog = await openRemoval(page, ORIGINAL);
        other = await wallet!.context.newPage();
        await manage(other);
        await expect(row(other, ORIGINAL)).toBeVisible();
        await expect(dialog).toBeVisible();
      }
    );

    await step(
      'replace the inactive network through the second page using the same chain and URL',
      () => other!,
      async () => {
        const current = await openRemoval(other!, ORIGINAL);
        await current.locator('#confirm-btn').click();
        await expect(current).toHaveCount(0);
        await expect
          .poll(async () => (await snapshot(other!)).saved)
          .toBeNull();
        expect((await snapshot(other!)).live).toBeNull();
        await expect(
          page.getByRole('dialog', { name: title(ORIGINAL), exact: true })
        ).toBeVisible();
        const replacement = await add(other!, REPLACEMENT, NEW_EXPLORER);
        observations.replacement = replacement;
        expect(replacement.active).toEqual(
          (observations.baseline as any).active
        );
        expect(replacement.live!.url).toBe(
          (observations.original as any).live.url
        );
        expect(replacement.live!.label).not.toBe(
          (observations.original as any).live.label
        );
        expect(replacement.live!.explorer).not.toBe(
          (observations.original as any).live.explorer
        );
        await expect
          .poll(async () => (await registryChanges(page)).at(-1)?.after)
          .toEqual(replacement.saved);
        stableRegistryChangeCount = (await registryChanges(page)).length;
        await expect(
          page.getByRole('dialog', { name: title(ORIGINAL), exact: true })
        ).toBeVisible();
      }
    );

    await step(
      'refuse the old confirmation without changing the durable replacement',
      () => page,
      async () => {
        const oldDialog = page.getByRole('dialog', {
          name: title(ORIGINAL),
          exact: true,
        });
        await expect(oldDialog).toBeVisible();
        await oldDialog.locator('#confirm-btn').click();
        await expect(
          page.getByText(en.settings.networkRemovalIncomplete, { exact: true })
        ).toBeVisible();
        await expect(oldDialog).toHaveCount(0);
        const afterStale = await snapshot(page);
        observations.afterStale = afterStale;
        expect(afterStale).toEqual(observations.replacement);
        expect((await registryChanges(page)).length).toBe(
          stableRegistryChangeCount
        );
        await expect(row(page, REPLACEMENT)).toBeVisible();
      }
    );

    await step(
      'fresh confirmation removes only the current inactive registration durably',
      () => page,
      async () => {
        const fresh = await openRemoval(page, REPLACEMENT);
        await fresh.locator('#confirm-btn').click();
        await expect(fresh).toHaveCount(0);
        await expect.poll(async () => (await snapshot(page)).saved).toBeNull();
        const removed = await snapshot(page);
        observations.removed = removed;
        expect(removed.live).toBeNull();
        expect(removed.active).toEqual((observations.baseline as any).active);
        expect(removed.activeSlip44).toBe(
          (observations.baseline as any).activeSlip44
        );
        expect(removed.isBitcoinBased).toBe(true);
        await expect(row(page, REPLACEMENT)).toHaveCount(0);
      }
    );

    await step(
      'reopen the second page and retain the complete fenced runtime evidence',
      () => other!,
      async () => {
        await manage(other!);
        await expect(row(other!, ORIGINAL)).toHaveCount(0);
        await expect(row(other!, REPLACEMENT)).toHaveCount(0);
        expect(await snapshot(other!)).toEqual(observations.removed);
        observations.registryChanges = await registryChanges(page);
        expect(server!.reads).toContain('eth_chainId');
        expect(server!.deniedWrites).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
        ).toBe(testSourceSha256);
      }
    );
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    try {
      await info.attach('network-removal-confirmation-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256,
            syntheticHttpOnly: true,
            directControllerWrites: false,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApisReplaced: false,
            signingOrBroadcastRequested: false,
            observations,
            registryChangeCountBeforeStale: stableRegistryChangeCount,
            rpcReads: server?.reads ?? [],
            deniedWrites: [
              ...(server?.deniedWrites ?? []),
              ...(routes?.deniedWrites ?? []),
            ],
            proxyBlocked: server?.blocked ?? [],
            status,
          },
          null,
          2
        ),
        contentType: 'application/json',
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
          Object.assign(E2E_CONFIG, previousConfig);
        }
      }
    }
  }
});
