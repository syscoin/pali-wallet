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
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Both registrations use the ordinary CustomRPC UI and native persistence.
// Only canonical asset_platforms HTTP is held; no controller reply is replaced.
const PLATFORM_URL = 'https://api.coingecko.com/api/v3/asset_platforms';
const FAST_ID = 31337;
const SLOW_ID = 31338;

async function startReadServer() {
  const rpcReads: Array<{ chainId: number; method: string }> = [];
  const metadataReads: number[] = [];
  const metadataCompletions: number[] = [];
  const refused: string[] = [];
  let hold = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const headers = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (
      request.method === 'GET' &&
      url.pathname === '/metadata' &&
      !url.search
    ) {
      metadataReads.push(Date.now());
      if (hold) await held;
      response.writeHead(200, headers);
      response.end(
        JSON.stringify(
          [FAST_ID, SLOW_ID].map((chainId) => ({
            id: `synthetic-platform-${chainId}`,
            ['chain_identifier']: chainId,
            ['native_coin_id']: `synthetic-native-${chainId}`,
          }))
        )
      );
      metadataCompletions.push(Date.now());
      return;
    }
    const chainId =
      url.pathname === '/fast-rpc'
        ? FAST_ID
        : url.pathname === '/slow-rpc'
        ? SLOW_ID
        : null;
    if (chainId && request.method === 'OPTIONS' && !url.search) {
      response.writeHead(204, headers).end();
      return;
    }
    if (!chainId || request.method !== 'POST' || url.search) {
      refused.push(`${request.method} ${url.pathname}`);
      response.writeHead(403, headers).end('{}');
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += String(chunk);
      if (body.length > 65536) {
        request.destroy();
        return;
      }
    }
    try {
      const input = JSON.parse(body);
      const results = (Array.isArray(input) ? input : [input]).map((call) => {
        if (
          call?.jsonrpc !== '2.0' ||
          !Array.isArray(call.params) ||
          call.params.length ||
          !['eth_chainId', 'net_version', 'eth_blockNumber'].includes(
            call.method
          )
        ) {
          refused.push(String(call?.method));
          return {
            jsonrpc: '2.0',
            id: call?.id,
            error: {
              code: -32601,
              message: 'Only canonical read validation is allowed',
            },
          };
        }
        rpcReads.push({ method: call.method, chainId });
        return {
          jsonrpc: '2.0',
          id: call.id,
          result:
            call.method === 'net_version'
              ? String(chainId)
              : call.method === 'eth_blockNumber'
              ? '0x1'
              : `0x${chainId.toString(16)}`,
        };
      });
      response
        .writeHead(200, headers)
        .end(JSON.stringify(Array.isArray(input) ? results : results[0]));
    } catch {
      response.writeHead(400, headers).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local fixture port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    rpcReads,
    metadataReads,
    metadataCompletions,
    refused,
    beginHold: () => {
      hold = true;
    },
    release,
    close: () =>
      new Promise<void>((resolve, reject) => {
        release();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const registration = (page: Page, chainId: number) =>
  page.evaluate(async (id) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const project = (entry: any) =>
      entry
        ? {
            chainId: entry.chainId,
            kind: entry.kind,
            label: entry.label,
            url: entry.url,
            currency: entry.currency,
            default: entry.default,
            coingeckoId: entry.coingeckoId,
            coingeckoPlatformId: entry.coingeckoPlatformId,
          }
        : null;
    return {
      live: project(state.vaultGlobal.networks.ethereum[id]),
      saved: project(saved.state?.vaultGlobal?.networks?.ethereum[id]),
      activeNetwork: {
        chainId: state.vault.activeNetwork.chainId,
        kind: state.vault.activeNetwork.kind,
        url: state.vault.activeNetwork.url,
      },
    };
  }, chainId);

test('custom network saves durably without waiting for slow optional price metadata', async ({}, info) => {
  test.setTimeout(120000);
  expect(process.version).toBe('v26.12.1');
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const proxy = await startUtxoFixtureServer();
  const server = await startReadServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkMetadataSynthetic!2026',
    rpcUrl: proxy.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let profileRemoved = false;
  const observations: Record<string, any> = {};
  const unsupported: string[] = [];
  const pageErrors: string[] = [];
  try {
    wallet = await PaliWallet.launch('custom-network-metadata-deadline', {
      offlineHttpProxy: proxy.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      proxy.url
    );
    // The launch proxy remains deny-by-default, including loopback. Forward
    // only these two validation endpoints through the local HTTP fixture;
    // preserve the SDK's actual serialized request and server response.
    await wallet.context.route(`${server.origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        !['/fast-rpc', '/slow-rpc'].includes(url.pathname) ||
        url.search ||
        !['POST', 'OPTIONS'].includes(request.method())
      ) {
        unsupported.push('noncanonical local RPC request');
        await route.abort('blockedbyclient');
        return;
      }
      const response = await fetch(request.url(), {
        method: request.method(),
        headers: { 'content-type': 'application/json' },
        body: request.postData(),
      });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
    await wallet.context.route(PLATFORM_URL, async (route) => {
      if (
        route.request().method() !== 'GET' ||
        route.request().url() !== PLATFORM_URL
      ) {
        unsupported.push('noncanonical platform metadata request');
        await route.abort('blockedbyclient');
        return;
      }
      const response = await fetch(`${server.origin}/metadata`);
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerIdentity = identity;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const step = (name: string, action: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        try {
          await action();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    await step(
      'open an ordinary custom-network form in a disposable wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    const openForm = async (chainId: number, suffix: string) => {
      // Same network-header control used by PaliWallet's ordinary switch flow.
      await page
        .getByRole('button')
        .filter({ hasText: /UTXO|EVM/ })
        .first()
        .click();
      await page
        .getByRole('menuitem', { name: en.networkMenu.customRpc, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
      await page
        .getByRole('combobox', { name: en.settings.label, exact: true })
        .fill(`Metadata ${suffix}`);
      await page.locator('#rpc_symbol').fill('TEST');
      await page.locator('#rpc_chainId').fill(String(chainId));
      await page.locator('#rpc_url').fill(`${server.origin}/${suffix}-rpc`);
      await page.locator('#rpc_url').press('Tab');
    };
    await step(
      'fast metadata still enriches the exact durable registration',
      async () => {
        await openForm(FAST_ID, 'fast');
        const before = await registration(page, FAST_ID);
        expect(before.live).toBeNull();
        expect(before.saved).toBeNull();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect
          .poll(() =>
            server.rpcReads.some(
              (read) =>
                read.chainId === FAST_ID && read.method === 'eth_chainId'
            )
          )
          .toBe(true);
        await expect(page).toHaveURL(/#\/home$/);
        await expect
          .poll(
            async () =>
              (
                await registration(page, FAST_ID)
              ).saved?.coingeckoPlatformId
          )
          .toBe(`synthetic-platform-${FAST_ID}`);
        observations.fast = await registration(page, FAST_ID);
        expect(observations.fast.live).toEqual(observations.fast.saved);
        expect(observations.fast.activeNetwork).toEqual(before.activeNetwork);
      }
    );
    let beforeCount = 0;
    let saveAt = 0;
    const timeout = page
      .getByRole('dialog')
      .filter({ hasText: 'Network request timed out' });
    await step(
      'save succeeds durably while optional metadata is still held',
      async () => {
        await openForm(SLOW_ID, 'slow');
        expect((await registration(page, SLOW_ID)).saved).toBeNull();
        server.beginHold();
        beforeCount = server.metadataReads.length;
        saveAt = Date.now();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect
          .poll(() =>
            server.rpcReads.some(
              (read) =>
                read.chainId === SLOW_ID && read.method === 'eth_chainId'
            )
          )
          .toBe(true);
        await expect
          .poll(() => server.metadataReads.length)
          .toBe(beforeCount + 1);
        await expect(page).toHaveURL(/#\/home$/);
        observations.beforeRelease = {
          elapsed: Date.now() - saveAt,
          registry: await registration(page, SLOW_ID),
        };
        expect(observations.beforeRelease.elapsed).toBeLessThan(10000);
        expect(observations.beforeRelease.registry.live).toEqual(
          observations.beforeRelease.registry.saved
        );
        expect(observations.beforeRelease.registry.saved).toMatchObject({
          chainId: SLOW_ID,
          kind: 'ethereum',
          label: 'Metadata slow',
          currency: 'test',
          url: `${server.origin}/slow-rpc`,
          default: false,
        });
        expect(
          observations.beforeRelease.registry.saved.coingeckoPlatformId
        ).toBeUndefined();
        expect(observations.beforeRelease.registry.activeNetwork).toEqual(
          observations.fast.activeNetwork
        );
        expect(server.metadataCompletions).toHaveLength(beforeCount);
        await expect(timeout).toHaveCount(0);
      }
    );
    await step(
      'late metadata cannot mutate the saved network or show a timeout',
      async () => {
        // Hold the real response beyond the unchanged 10-second emitter deadline.
        await new Promise((resolve) => setTimeout(resolve, 11000));
        await expect(timeout).toHaveCount(0);
        server.release();
        await expect
          .poll(() => server.metadataCompletions.length)
          .toBe(beforeCount + 1);
        observations.afterMetadata = {
          elapsed: Date.now() - saveAt,
          registry: await registration(page, SLOW_ID),
        };
        expect(observations.afterMetadata.registry).toEqual(
          observations.beforeRelease.registry
        );
        await page.reload();
        await wallet!.ensureOnHome();
        expect(await registration(page, SLOW_ID)).toEqual(
          observations.beforeRelease.registry
        );
      }
    );
    await step(
      'ordinary duplicate validation preserves both saved networks',
      async () => {
        await openForm(SLOW_ID, 'slow');
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        const alreadyExists = en.settings.networkAlreadyExists.replace(
          '{{chainId}}',
          String(SLOW_ID)
        );
        await expect(
          page.getByRole('dialog').filter({ hasText: alreadyExists })
        ).toBeVisible();
        observations.duplicateRefused = true;
        expect(await registration(page, SLOW_ID)).toEqual(
          observations.beforeRelease.registry
        );
        expect(await registration(page, FAST_ID)).toEqual(observations.fast);
      }
    );
    expect(server.refused).toEqual([]);
    expect(unsupported).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    server.release();
    try {
      await wallet?.dispose(status);
      if (wallet) {
        const profiles = path.resolve(E2E_CONFIG.artifactsDir, 'profiles');
        const profile = path.resolve(wallet.profileDir);
        const relative = path.relative(profiles, profile);
        if (
          !relative ||
          relative.startsWith('..') ||
          path.isAbsolute(relative) ||
          relative.includes(path.sep) ||
          fs.realpathSync(profiles) !== profiles ||
          !fs.lstatSync(profile).isDirectory() ||
          fs.lstatSync(profile).isSymbolicLink() ||
          fs.realpathSync(profile) !== profile
        )
          throw new Error('Disposable profile cleanup path refused');
        fs.rmSync(profile, { recursive: true, force: true });
        profileRemoved = true;
      }
    } finally {
      try {
        await info.attach('custom-network-metadata-deadline-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime,
              sourceSha256,
              status,
              observations,
              pageErrors,
              metadataReads: server.metadataReads,
              rpcReads: server.rpcReads,
              refused: server.refused,
              unsupported,
              baseReads: routes?.reads,
              deniedWrites: routes?.deniedWrites,
              proxyDeniedConnections: proxy.blocked.length,
              controllerStateReplaced: false,
              controllerResultsReplaced: false,
              rawProfileRemoved: profileRemoved,
              signingOrBroadcastRequested: false,
              qualification:
                'Exploratory baseline reproducer; base isolated fixture may safely refuse unrelated startup reads. Not all-network-clean qualification.',
            },
            null,
            2
          ),
        });
      } finally {
        await server.close();
        await proxy.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
