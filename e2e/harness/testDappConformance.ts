import {
  type BrowserContext,
  type Page,
  chromium,
  expect,
} from '@playwright/test';
import { type ChildProcess, execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';

import { E2E_CONFIG } from './config';
import { clickClosingPopup } from './dismissRejectedApproval';
import { PaliWallet } from './pali';

// Public Anvil fixture. This mnemonic must never be used on a public network.
export const TEST_DAPP_MNEMONIC =
  'test test test test test test test test test test test junk';
export const TEST_DAPP_URL = 'https://metamask.github.io/test-dapp/';
export const LOCAL_CHAINS = [
  { chainId: 31337, port: Number(process.env.PALI_TEST_DAPP_PORT_A || 28545) },
  { chainId: 31338, port: Number(process.env.PALI_TEST_DAPP_PORT_B || 28546) },
].map((chain) => ({
  ...chain,
  backendPort: chain.port + 100,
  backendUrl: `http://127.0.0.1:${chain.port + 100}`,
  hexId: `0x${chain.chainId.toString(16)}`,
  url: `https://127.0.0.1:${chain.port}`,
}));

export type RpcObservation = {
  durationMs?: number;
  error?: { code?: number; message: string };
  id: number;
  method: string;
  params?: unknown;
  result?: any;
  settled?: boolean;
  started: number;
};

export function extensionEvidence() {
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH!;
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push(path.relative(extensionPath, file));
    }
  };
  walk(extensionPath);
  const artifactHash = createHash('sha256');
  for (const relativeFile of files.sort()) {
    const digest = createHash('sha256')
      .update(fs.readFileSync(path.join(extensionPath, relativeFile)))
      .digest('hex');
    artifactHash.update(`${relativeFile}\0${digest}\n`);
  }
  const bundleHashes = Object.fromEntries(
    ['background', 'external', 'inpage'].flatMap((name) => {
      const file = path.join(extensionPath, 'js', `${name}.bundle.js`);
      return fs.existsSync(file)
        ? [
            [
              name,
              createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
            ],
          ]
        : [];
    })
  );
  return {
    extensionPath,
    artifactSha256: artifactHash.digest('hex'),
    fileCount: files.length,
    sourceRevision: process.env.PALI_TEST_DAPP_REVISION,
    version: JSON.parse(
      fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8')
    ).version,
    bundleHashes,
  };
}

export async function localRpc(
  url: string,
  method: string,
  params: any[] = []
) {
  if (!LOCAL_CHAINS.some((chain) => chain.url === url)) {
    throw new Error(`Refusing non-fixture RPC: ${url}`);
  }
  const fixture = LOCAL_CHAINS.find((chain) => chain.url === url)!;
  const response = await fetch(fixture.backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as any;
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

export async function startLocalChains() {
  const children: ChildProcess[] = [];
  const proxies: https.Server[] = [];
  fs.mkdirSync(E2E_CONFIG.artifactsDir, { recursive: true });
  const keyFile = path.join(E2E_CONFIG.artifactsDir, 'loopback-fixture.key');
  const certFile = path.join(E2E_CONFIG.artifactsDir, 'loopback-fixture.crt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { stdio: 'ignore' }
  );
  const occupied = (port: number) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      const finish = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
  try {
    for (const chain of LOCAL_CHAINS) {
      // Never attach to or kill an RPC owned by another task.
      for (const port of [chain.port, chain.backendPort]) {
        if (await occupied(port))
          throw new Error(`Fixture port already occupied: ${port}`);
      }
      const log = fs.openSync(
        path.join(E2E_CONFIG.artifactsDir, `anvil-${chain.chainId}.log`),
        'w'
      );
      const child = spawn(
        process.env.PALI_TEST_DAPP_ANVIL || 'anvil',
        [
          '--host',
          '127.0.0.1',
          '--port',
          String(chain.backendPort),
          '--chain-id',
          String(chain.chainId),
          '--mnemonic',
          TEST_DAPP_MNEMONIC,
        ],
        { stdio: ['ignore', log, log] }
      );
      fs.closeSync(log);
      children.push(child);
      let spawnError: Error | undefined;
      child.on('error', (error) => {
        spawnError = error;
      });
      await expect
        .poll(
          async () => {
            if (spawnError) throw spawnError;
            if (child.exitCode !== null)
              throw new Error(`Anvil exited: ${child.exitCode}`);
            return localRpc(chain.url, 'eth_chainId').catch(() => null);
          },
          { timeout: 15_000 }
        )
        .toBe(chain.hexId);
      // The production extension's CSP permits HTTPS RPCs. This local TLS
      // proxy lets the immutable production build reach Anvil without
      // changing its manifest or connecting to an external chain.
      const proxy = https.createServer(
        {
          key: fs.readFileSync(keyFile),
          cert: fs.readFileSync(certFile),
        },
        (incoming, outgoing) => {
          const forwarded = http.request(
            chain.backendUrl,
            {
              method: incoming.method,
              headers: incoming.headers,
            },
            (response) => {
              outgoing.writeHead(response.statusCode || 502, response.headers);
              response.pipe(outgoing);
            }
          );
          forwarded.on('error', () => {
            outgoing.writeHead(502);
            outgoing.end();
          });
          incoming.pipe(forwarded);
        }
      );
      proxies.push(proxy);
      await new Promise<void>((resolve, reject) => {
        proxy.once('error', reject);
        proxy.listen(chain.port, '127.0.0.1', resolve);
      });
    }
  } catch (error) {
    children.forEach((child) => child.kill('SIGTERM'));
    proxies.forEach((proxy) => proxy.close());
    throw error;
  }
  return () => {
    children.forEach((child) => child.kill('SIGTERM'));
    proxies.forEach((proxy) => proxy.close());
  };
}

export async function launchConformanceWallet(
  journeyName = 'test-dapp-conformance'
) {
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath)) {
    throw new Error(
      'Set PALI_TEST_DAPP_EXTENSION_PATH to the exact built extension'
    );
  }
  const previousConfig = { ...E2E_CONFIG };
  Object.assign(E2E_CONFIG, {
    extensionPath,
    password: 'PaliConformance!2026',
    seedPhrase: TEST_DAPP_MNEMONIC,
    chainId: LOCAL_CHAINS[0].chainId,
    rpcUrl: LOCAL_CHAINS[0].url,
    networkLabel: `Pali Local ${LOCAL_CHAINS[0].chainId}`,
  });
  // Chrome for Testing 149 otherwise retains Playwright's default
  // --disable-extensions flag. Adapt this one launch without changing the
  // shared harness or any browser/profile owned by another test.
  const originalLaunch = chromium.launchPersistentContext;
  let launchedContext: BrowserContext | undefined;
  chromium.launchPersistentContext = async (profile, options) => {
    const context = await originalLaunch.call(chromium, profile, {
      ...options,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [...(options?.args || []), '--ignore-certificate-errors'],
      ignoreHTTPSErrors: true,
    });
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(30_000);
    launchedContext = context;
    console.log('CONFORMANCE disposable browser launched');
    return context;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const wallet = await Promise.race([
      PaliWallet.launch(journeyName),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Extension startup exceeded 60 seconds')),
          60_000
        );
      }),
    ]);
    const dispose = wallet.dispose.bind(wallet);
    wallet.dispose = async (status) => {
      try {
        await dispose(status);
      } finally {
        // A worker can run another journey after this isolated fixture.
        Object.assign(E2E_CONFIG, previousConfig);
      }
    };
    return wallet;
  } catch (error) {
    try {
      await launchedContext?.close();
    } finally {
      Object.assign(E2E_CONFIG, previousConfig);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    chromium.launchPersistentContext = originalLaunch;
  }
}

export async function installConformanceInstrumentation(
  context: BrowserContext
) {
  const forbiddenBroadcasts: Array<{ method: string; url: string }> = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    let payload: any;
    try {
      payload = request.postDataJSON();
    } catch {
      /* Not a JSON RPC. */
    }
    const requests = Array.isArray(payload) ? payload : [payload];
    for (const rpc of requests) {
      if (
        !rpc ||
        !/^(eth_sendRawTransaction|eth_sendTransaction|wallet_sendCalls)$/.test(
          rpc.method
        )
      )
        continue;
      const url = new URL(request.url());
      const local = LOCAL_CHAINS.some(
        (chain) =>
          url.origin === chain.url &&
          (url.pathname === '/' || url.pathname === '')
      );
      if (!local) {
        forbiddenBroadcasts.push({ url: request.url(), method: rpc.method });
        await route.abort('blockedbyclient');
        return;
      }
    }
    await route.continue();
  });
  await context.addInitScript(() => {
    const state = {
      providers: [] as any[],
      requests: [] as any[],
      events: [] as any[],
      notifications: [] as any[],
      providerSnapshots: [] as any[],
    };
    (window as any).__paliConformance = state;
    window.addEventListener('paliNotification', ((event: CustomEvent) => {
      try {
        const notification = JSON.parse(event.detail);
        const data = notification.data || notification;
        if (
          [
            'pali_accountsChanged',
            'pali_chainChanged',
            'pali_isBitcoinBased',
            'pali_unlockStateChanged',
          ].includes(data.method)
        )
          state.notifications.push({ ...data, at: Date.now() });
      } catch {
        /* Not a provider notification. */
      }
    }) as EventListener);
    window.addEventListener('eip6963:announceProvider', ((
      event: CustomEvent
    ) => {
      const detail = event.detail;
      if (detail.info.rdns !== 'com.paliwallet') return;
      state.providers.push({ ...detail.info });
      const provider = detail.provider;
      (window as any).__paliConformanceProvider = provider;
      if ((provider as any).__conformanceWrapped) return;
      (provider as any).__conformanceWrapped = true;
      const request = provider.request.bind(provider);
      let accountsListener: ((value: unknown) => void) | undefined;
      const snapshot = (phase: string, method: string) => {
        state.providerSnapshots.push({
          at: Date.now(),
          phase,
          method,
          providerUuid: detail.info.uuid,
          initialized: provider.isInitialized?.(),
          isBitcoinBased: provider.isBitcoinBased?.(),
          selectedAddress: provider.selectedAddress,
          accounts: provider.accounts?.slice(),
          internalState: (provider as any)._state
            ? {
                ...(provider as any)._state,
                accounts: (provider as any)._state.accounts?.slice(),
              }
            : undefined,
          accountsListenerCount: provider.listenerCount?.('accountsChanged'),
          accountsListenerPresent: provider
            .listeners?.('accountsChanged')
            .includes(accountsListener),
        });
      };
      provider.request = async (args: any) => {
        const observation: any = {
          id: state.requests.length,
          method: args?.method,
          params: args?.params,
          started: Date.now(),
        };
        state.requests.push(observation);
        const observeAccount = ['eth_accounts', 'eth_requestAccounts'].includes(
          args?.method
        );
        if (observeAccount) snapshot('before', args.method);
        try {
          const result = await request(args);
          observation.result = result;
          return result;
        } catch (error: any) {
          observation.error = {
            code: error?.code,
            message: String(error?.message),
          };
          throw error;
        } finally {
          observation.settled = true;
          observation.durationMs = Date.now() - observation.started;
          if (observeAccount) snapshot('after', args.method);
        }
      };
      for (const name of [
        'connect',
        'disconnect',
        'accountsChanged',
        'chainChanged',
        '_initialized',
      ]) {
        const listener = (value: any) =>
          state.events.push({ name, value, at: Date.now() });
        if (name === 'accountsChanged') accountsListener = listener;
        provider.on(name, listener);
      }
    }) as EventListener);
  });
  // Prove this route also guards fetches made by the real MV3 worker. The
  // reserved .invalid destination and invalid raw bytes cannot broadcast.
  const canaryUrl = 'https://pali-conformance.invalid/rpc';
  const worker = context.serviceWorkers()[0];
  const rejected = await worker.evaluate(async (url) => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_sendRawTransaction',
          params: ['0x'],
        }),
      });
      return false;
    } catch {
      return true;
    }
  }, canaryUrl);
  expect(rejected).toBe(true);
  expect(forbiddenBroadcasts).toEqual([
    { url: canaryUrl, method: 'eth_sendRawTransaction' },
  ]);
  const [broadcastGuardCanary] = forbiddenBroadcasts.splice(0, 1);
  return { forbiddenBroadcasts, broadcastGuardCanary };
}

export async function openOfficialDapp(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(TEST_DAPP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean((window as any).__paliConformanceProvider)
  );
  await page
    .getByRole('button', { name: 'Use Pali Wallet', exact: true })
    .click();
  return page;
}

export async function startRequest(
  page: Page,
  rpcMethod: string,
  rpcParams?: any
) {
  return page.evaluate(
    ({ method, params }) => {
      const state = (window as any).__paliConformance;
      const id = state.requests.length;
      const request = { method, ...(params === undefined ? {} : { params }) };
      (window as any).__paliConformanceProvider
        .request(request)
        .catch(() => undefined);
      return id;
    },
    { method: rpcMethod, params: rpcParams }
  );
}

export async function rpcObservation(
  page: Page,
  id: number
): Promise<RpcObservation> {
  return page.evaluate(
    (requestId) => (window as any).__paliConformance.requests[requestId],
    id
  );
}

export async function settle(page: Page, id: number, timeout = 15_000) {
  await expect
    .poll(async () => (await rpcObservation(page, id))?.settled, { timeout })
    .toBe(true);
  return rpcObservation(page, id);
}

export async function providerRequest(
  page: Page,
  method: string,
  params?: any
) {
  const result = await settle(page, await startRequest(page, method, params));
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.result;
}

export async function popupFor(
  context: BrowserContext,
  page: Page,
  id: number
) {
  let popup: Page | undefined;
  await expect
    .poll(
      async () => {
        popup = context
          .pages()
          .find((candidate) => candidate.url().includes('/external'));
        const rpc = await rpcObservation(page, id);
        if (rpc?.settled)
          throw new Error(
            `Request settled before popup: ${JSON.stringify(rpc)}`
          );
        return Boolean(popup);
      },
      { timeout: 15_000 }
    )
    .toBe(true)
    .catch(async (error) => {
      throw new Error(
        `${error.message}; request=${JSON.stringify(
          await rpcObservation(page, id)
        )}; pages=${JSON.stringify(context.pages().map((tab) => tab.url()))}`
      );
    });
  await popup!.waitForLoadState('domcontentloaded');
  await popup!.locator('#external-root').waitFor({ state: 'attached' });
  await popup!
    .locator('body.app-loaded')
    .waitFor({ state: 'attached', timeout: 5000 });
  // Screenshots should capture the approval, after the HTML loader's normal
  // 300ms fade, rather than the transient dark overlay.
  await expect(popup!.locator('#initial-loader')).toHaveCSS('opacity', '0', {
    timeout: 2000,
  });
  await expect(popup!.locator('#external-root')).toHaveCSS('opacity', '1', {
    timeout: 2000,
  });
  return popup!;
}

export async function approve(
  context: BrowserContext,
  page: Page,
  id: number,
  capture?: (popup: Page) => Promise<void>
) {
  const popup = await popupFor(context, page, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await rpcObservation(page, id))?.settled || popup.isClosed()) break;
    const button = popup
      .getByRole('button', {
        name: /(?:^|\s)(confirm|sign|approve|connect|add(?: network)?|switch(?: network)?|proceed)$/i,
      })
      .last();
    await expect(button).toBeVisible({ timeout: 10_000 });
    await expect(button).toBeEnabled({ timeout: 10_000 });
    await capture?.(popup);
    await clickClosingPopup({
      click: () => button.click(),
      isClosed: () => popup.isClosed(),
    });
    // Second untrusted-site confirmation may replace the first button.
    await expect
      .poll(
        async () => {
          if (popup.isClosed() || (await rpcObservation(page, id))?.settled)
            return true;
          return popup
            .getByRole('button', {
              name: /(?:^|\s)(confirm|connect|proceed)$/i,
            })
            .last()
            .isEnabled()
            .catch(() => false);
        },
        { timeout: 15_000 }
      )
      .toBe(true);
    if (popup.isClosed() || (await rpcObservation(page, id))?.settled) break;
  }
  const result = await settle(page, id, 30_000);
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
}

export async function closeApprovalPopups(context: BrowserContext) {
  for (const page of context.pages()) {
    if (page.url().includes('/external')) await page.close();
  }
}
