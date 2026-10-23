import { expect, test, type Locator, type Page } from '@playwright/test';
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

const IDS = [5, 11155111] as const;
const chainIdentity = (chainId: number) =>
  `EVM · ${en.settings.chainNumber.replace('{{chainId}}', String(chainId))}`;
const fullIdentity = (label: string, chainId: number) =>
  `${label} (${chainIdentity(chainId)})`;
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

// Normalize only parameter ordering and account-address case. Endpoint and
// complete parameter membership remain part of the read-only allowlist.
const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return `${url.origin}${url.pathname}${query.size ? `?${query}` : ''}`;
};

// Same narrow HTTP registration boundary as networkRemovalConfirmation. It
// accepts only identity reads at two local endpoints and never forwards traffic.
async function startRegistrationFixture() {
  let origin = '';
  const reads: Array<{ chainId: number; method: string; path: string }> = [];
  const forbidden: string[] = [];
  const blocked: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
    const chainId =
      url.origin === origin && IDS.find((id) => url.pathname === `/rpc-${id}`);
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
    if (chainId && request.method === 'OPTIONS' && !url.search) {
      response.writeHead(204, headers).end();
      return;
    }
    if (!chainId || request.method !== 'POST' || url.search) {
      // Chromium's pre-routing clock probe is platform traffic, not a wallet
      // request. Refuse it too, but keep its exact origin/path/query boundary
      // separate from the wallet's unexpected-request gate.
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
            !Array.isArray(call.params) ||
            call.params.length !== 0 ||
            !['eth_chainId', 'net_version', 'eth_blockNumber'].includes(
              call.method
            )
          ) {
            forbidden.push(String(call?.method));
            return {
              jsonrpc: '2.0',
              id: call?.id,
              error: {
                code: -32601,
                message: 'Read-only registration fixture',
              },
            };
          }
          reads.push({ chainId, method: call.method, path: url.pathname });
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
          .end(JSON.stringify(Array.isArray(payload) ? replies : replies[0]));
      } catch {
        forbidden.push('Malformed JSON body');
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const publicRegistry = (page: Page) =>
  page.evaluate(async (fields) => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const stored = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? Object.fromEntries(
            fields.map((field) => [field, network[field] ?? null])
          )
        : null;
    const networks = (value: any) =>
      Object.fromEntries(
        ['syscoin', 'ethereum'].map((family) => [
          family,
          Object.fromEntries(
            Object.entries(value?.vaultGlobal?.networks?.[family] || {}).map(
              ([id, network]) => [id, project(network)]
            )
          ),
        ])
      );
    return {
      live: networks(current),
      saved: networks(stored.state),
      active: project(current.vault.activeNetwork),
      activeSlip44: current.vaultGlobal.activeSlip44,
      account: current.vault.activeAccount,
    };
  }, PUBLIC_NETWORK_FIELDS);

async function visibleIdentity(target: Locator) {
  return {
    ariaSnapshot: await target.ariaSnapshot(),
    dom: await target.evaluate((element) => ({
      text: (element as HTMLElement).innerText,
      title: element.getAttribute('title'),
      label: element.getAttribute('aria-label'),
      description: element.getAttribute('aria-description'),
      describedBy: element.getAttribute('aria-describedby'),
      labelledBy: element.getAttribute('aria-labelledby'),
      descendantCues: Array.from(
        element.querySelectorAll(
          '[title], [aria-label], [aria-description], [aria-describedby], [aria-labelledby], img, svg title, svg desc'
        )
      ).map((node) => ({
        tag: node.tagName,
        text: node.textContent,
        title: node.getAttribute('title'),
        label: node.getAttribute('aria-label'),
        description: node.getAttribute('aria-description'),
        alt: node.getAttribute('alt'),
      })),
      glyphs: Array.from(element.querySelectorAll('svg')).map(
        (svg) => svg.outerHTML
      ),
    })),
  };
}

// Generated aria-labelledby/describedby IDs are retained in the evidence but
// are not user-readable identity. Their resolved names are in ariaSnapshot.
const readableIdentity = (
  value: Awaited<ReturnType<typeof visibleIdentity>>
) => ({
  ariaSnapshot: value.ariaSnapshot,
  text: value.dom.text,
  title: value.dom.title,
  label: value.dom.label,
  description: value.dom.description,
  descendantCues: value.dom.descendantCues,
  glyphs: value.dom.glyphs,
});

async function settleMotion(target: Locator) {
  await target.evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime)
        )
        .map((animation) => animation.finished.catch(() => undefined))
    );
    await new Promise(requestAnimationFrame);
  });
}

async function exposedGeometry(target: Locator) {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + node.clientTop + node.clientHeight
        );
      }
    }
    const points = [
      [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + 2, box.top + box.height / 2],
      [box.right - 2, box.top + box.height / 2],
    ];
    return {
      bounds: box.toJSON(),
      clip,
      contained:
        box.width > 0 &&
        box.height > 0 &&
        box.left >= clip.left - 0.5 &&
        box.right <= clip.right + 0.5 &&
        box.top >= clip.top - 0.5 &&
        box.bottom <= clip.bottom + 0.5,
      hitPoints: points.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (element === hit || element.contains(hit)));
      }),
    };
  });
}

async function rowGeometry(row: Locator, expectedChain: string) {
  return row.evaluate((element, identity) => {
    const label = element.querySelector<HTMLElement>('[title]');
    const chain = Array.from(
      element.querySelectorAll<HTMLElement>('span')
    ).find((node) => node.textContent === identity);
    const icon = element.querySelector('svg');
    const actions = Array.from(element.querySelectorAll('button'));
    if (!label || !chain || !icon || actions.length !== 2)
      throw new Error('Missing actual network row identity or action');
    const bounds = (node: Element) => node.getBoundingClientRect().toJSON();
    return {
      row: bounds(element),
      label: bounds(label),
      chain: bounds(chain),
      icon: bounds(icon),
      actions: actions.map(bounds),
      chainScrollWidth: chain.scrollWidth,
      chainClientWidth: chain.clientWidth,
      actionHits: actions.map((action) => {
        const box = action.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        );
        return Boolean(hit && (action === hit || action.contains(hit)));
      }),
    };
  }, expectedChain);
}

for (const scenario of [
  { name: 'distinct labels', labels: ['Goerli control', 'Sepolia control'] },
  {
    name: 'same label',
    labels: ['Shared test network', 'Shared test network'],
  },
] as const) {
  test(`network manager exposes distinct registration identities for ${scenario.name}`, async ({}, info) => {
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
    addAuxiliary('https://api.coingecko.com/api/v3/asset_platforms', []);
    addAuxiliary(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
      { syscoin: { usd: 1, usd_24h_change: 0 } }
    );
    const owner = fixture.evmAddresses[0];
    for (const action of ['tokenlist', 'txlist', 'pendingtxlist', 'tokentx']) {
      const url = new URL('https://explorer.tanenbaum.io/api');
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', action);
      url.searchParams.set('address', owner);
      if (action === 'txlist' || action === 'tokentx')
        url.searchParams.set('sort', 'desc');
      addAuxiliary(url.href, {
        status: action === 'tokenlist' ? '1' : '0',
        message: action === 'tokenlist' ? 'OK' : 'No transactions found',
        result: [],
      });
    }
    const server = await startRegistrationFixture();
    addAuxiliary(
      'https://chainlist.org/rpcs.json',
      IDS.map((chainId, index) => ({
        name: index === 0 ? 'Goerli' : 'Sepolia',
        chainId,
        networkId: chainId,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpc: [
          {
            url: `${server.origin}/rpc-${chainId}`,
            tracking: 'none',
            isOpenSource: true,
          },
        ],
        explorers: [
          {
            name: 'Synthetic explorer',
            url: `${server.origin}/explorer-${chainId}`,
          },
        ],
      }))
    );
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NetworkIdentitySynthetic!2026',
      rpcUrl: server.origin,
    });
    const reads: Array<{ method: string; url: string }> = [];
    const unexpectedWalletHttpFailures: Array<{ method: string; url: string }> =
      [];
    const forbiddenRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = {
      scenario,
      runtime,
      sourceSha256,
      widths: [],
      milestones: {},
    };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const evidence = () => ({
      observations,
      status,
      reads,
      rpcReads: server.reads,
      unexpectedWalletHttpFailures,
      forbiddenRequests,
      pageErrors,
      fixtureReads: routes?.reads || [],
      deniedWrites: routes?.deniedWrites || [],
      forbiddenLocalRequests: server.forbidden,
      proxyBlockedConnections: server.blocked.length,
      proxyCountIsPlatformEvidenceOnly: true,
      walletStateReplaced: false,
      controllerResultsReplaced: false,
      signingOrBroadcastRequested: false,
      removalConfirmed: false,
    });
    try {
      wallet = await PaliWallet.launch(
        `network-identity-${scenario.name.replace(/ /g, '-')}`,
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
          reads.push({ method: request.method(), url: request.url() });
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
          unexpectedWalletHttpFailures.push({
            method: request.method(),
            url: request.url(),
          });
      });
      await wallet.context.route(`${server.origin}/**`, (route) => {
        const request = route.request(),
          url = new URL(request.url());
        return (!url.search &&
          IDS.some((id) => url.pathname === `/rpc-${id}`) &&
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
        wallet!.step(`${scenario.name}: ${name}`, action);
      await step(
        'verify worker and open the ordinary wallet on a separate active network',
        async () => {
          observations.workerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerIdentity = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          observations.initial = await publicRegistry(page);
          expect(observations.initial.active.chainId).toBe(5700);
          for (const id of IDS)
            expect(observations.initial.live.ethereum[id]).toBeUndefined();
        }
      );
      const openNetworkMenu = async () => {
        await page
          .getByRole('button')
          .filter({ hasText: /UTXO|EVM/ })
          .first()
          .click();
      };
      for (const [index, chainId] of IDS.entries()) {
        await step(
          `register ${chainId} through the normal custom RPC form`,
          async () => {
            await openNetworkMenu();
            await page
              .getByRole('menuitem', {
                name: en.networkMenu.customRpc,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
            await page
              .getByRole('combobox', { name: en.settings.label, exact: true })
              .fill(scenario.labels[index]);
            await page.locator('#rpc_symbol').fill('ETH');
            await page.locator('#rpc_chainId').fill(String(chainId));
            await page
              .locator('#rpc_explorer')
              .fill(`${server.origin}/explorer-${chainId}`);
            await page
              .locator('#rpc_url')
              .fill(`${server.origin}/rpc-${chainId}`);
            await page.locator('#rpc_url').press('Tab');
            await expect
              .poll(() =>
                server.reads.some(
                  (read) =>
                    read.chainId === chainId && read.method === 'eth_chainId'
                )
              )
              .toBe(true);
            await page
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/home$/);
            await expect
              .poll(
                async () =>
                  (
                    await publicRegistry(page)
                  ).saved.ethereum[chainId]?.label
              )
              .toBe(scenario.labels[index]);
            const snapshot = await publicRegistry(page);
            expect(snapshot.live).toEqual(snapshot.saved);
            expect(snapshot.live.ethereum[chainId]).toMatchObject({
              chainId,
              kind: 'ethereum',
              url: `${server.origin}/rpc-${chainId}`,
              label: scenario.labels[index],
              currency: 'eth',
              default: false,
            });
            expect(snapshot.active).toEqual(observations.initial.active);
            observations[`registered-${chainId}`] = snapshot;
          }
        );
      }
      const stable = await publicRegistry(page);
      const manager = page.locator(
        '[data-navigation-scroll="settings-manage-networks"]'
      );
      const targetRows = () =>
        manager.locator('li').filter({
          has: page.getByText(new RegExp(`^(?:${scenario.labels.join('|')})$`)),
        });
      await step('open Manage Networks using its real menu entry', async () => {
        await openNetworkMenu();
        await page
          .getByRole('menuitem', {
            name: en.networkMenu.manageNetworks,
            exact: true,
          })
          .click();
        await expect(manager).toBeVisible();
        await expect(targetRows()).toHaveCount(2);
        observations.milestones.ordinaryRegistration = true;
      });
      for (const width of [400, 320]) {
        const identities: Array<Record<string, unknown>> = [];
        observations.widths.push({ width, identities });
        await step(
          `set ${width}px and keep both custom registrations inactive`,
          async () => {
            await page.setViewportSize({ width, height: 620 });
            expect(await publicRegistry(page)).toEqual(stable);
            await expect(targetRows()).toHaveCount(2);
          }
        );
        for (const [index, chainId] of IDS.entries()) {
          await step(
            `${width}px ${chainId}: inspect identity, exact Edit route and removal Cancel`,
            async (capture) => {
              let row = targetRows().nth(index);
              await row.scrollIntoViewIfNeeded();
              await expect(
                row.getByText(en.components.activeStatus, { exact: true })
              ).toHaveCount(0);
              const rowIdentity = await visibleIdentity(row);
              const identity = fullIdentity(scenario.labels[index], chainId);
              const chainText = chainIdentity(chainId);
              await expect(
                row.getByText(chainText, { exact: true })
              ).toBeVisible();
              await expect(row.locator('[title]')).toHaveAttribute(
                'title',
                identity
              );
              const edit = row.getByRole('button', {
                name: `${en.buttons.edit}: ${identity}`,
                exact: true,
              });
              const remove = row.getByRole('button', {
                name: `${en.buttons.remove}: ${identity}`,
                exact: true,
              });
              await expect(edit).toBeEnabled();
              await expect(remove).toBeEnabled();
              await expect(edit).toHaveAccessibleName(
                `${en.buttons.edit}: ${identity}`
              );
              await expect(remove).toHaveAccessibleName(
                `${en.buttons.remove}: ${identity}`
              );
              const geometry = await rowGeometry(row, chainText);
              expect(geometry.row.left).toBeGreaterThanOrEqual(0);
              expect(geometry.row.right).toBeLessThanOrEqual(width);
              expect(geometry.icon.right).toBeLessThanOrEqual(
                geometry.label.left + 0.5
              );
              expect(geometry.icon.right).toBeLessThanOrEqual(
                geometry.chain.left + 0.5
              );
              expect(geometry.label.right).toBeLessThanOrEqual(
                geometry.actions[0].left + 0.5
              );
              expect(geometry.chain.right).toBeLessThanOrEqual(
                geometry.actions[0].left + 0.5
              );
              expect(geometry.chainScrollWidth).toBeLessThanOrEqual(
                geometry.chainClientWidth + 1
              );
              expect(geometry.actions[0].right).toBeLessThanOrEqual(
                geometry.actions[1].left + 0.5
              );
              expect(geometry.actions[1].right).toBeLessThanOrEqual(
                geometry.row.right + 0.5
              );
              expect(geometry.actionHits).toEqual([true, true]);
              await edit.click();
              await expect(page).toHaveURL(
                /#\/settings\/networks\/custom-rpc$/
              );
              await expect(page.locator('#rpc_chainId')).toHaveValue(
                String(chainId)
              );
              await expect(page.locator('#rpc_url')).toHaveValue(
                `${server.origin}/rpc-${chainId}`
              );
              const route = await page.evaluate(() => ({
                selected: {
                  chainId: history.state?.usr?.selected?.chainId,
                  kind: history.state?.usr?.selected?.kind,
                  key: history.state?.usr?.selected?.key ?? null,
                },
                chain: history.state?.usr?.chain,
                isEditing: history.state?.usr?.isEditing,
              }));
              expect(route.selected).toEqual({
                chainId,
                kind: 'ethereum',
                key: null,
              });
              expect(route.chain).toBe('ethereum');
              expect(route.isEditing).toBe(true);
              await page
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click();
              await expect(manager).toBeVisible();
              expect(await publicRegistry(page)).toEqual(stable);
              row = targetRows().nth(index);
              await row
                .getByRole('button', {
                  name: `${en.buttons.remove}: ${identity}`,
                  exact: true,
                })
                .click();
              const dialog = page.getByRole('dialog');
              await expect(dialog).toBeVisible();
              await expect(dialog).toHaveAccessibleName(
                en.settings.confirmRemoveNetwork.replace(
                  '{{networkName}}',
                  identity
                )
              );
              await expect(
                dialog.getByText(chainText, { exact: true })
              ).toBeVisible();
              const dialogIdentity = await visibleIdentity(dialog);
              await capture(page);
              const cancel = dialog.getByRole('button', {
                name: en.buttons.cancel,
                exact: true,
              });
              if (index === 0) await cancel.click();
              else {
                await cancel.focus();
                await expect(cancel).toBeFocused();
                await page.keyboard.press('Enter');
              }
              await expect(dialog).toHaveCount(0);
              expect(await publicRegistry(page)).toEqual(stable);
              identities.push({
                expectedChainId: chainId,
                row: rowIdentity,
                dialog: dialogIdentity,
                editTarget: route,
                geometry,
              });
            }
          );
        }
      }
      await step(
        '320x360 confirmation keeps exact identity and both actions reachable',
        async (capture) => {
          await page.setViewportSize({ width: 320, height: 360 });
          observations.shortConfirmations = [];
          for (const [index, chainId] of IDS.entries()) {
            const row = targetRows().nth(index);
            await row.scrollIntoViewIfNeeded();
            const identity = fullIdentity(scenario.labels[index], chainId);
            await row
              .getByRole('button', {
                name: `${en.buttons.remove}: ${identity}`,
                exact: true,
              })
              .click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toHaveAccessibleName(
              en.settings.confirmRemoveNetwork.replace(
                '{{networkName}}',
                identity
              )
            );
            await settleMotion(dialog);
            const shortIdentity = dialog.getByText(chainIdentity(chainId), {
              exact: true,
            });
            await expect(shortIdentity).toBeVisible();
            const identityGeometry = await exposedGeometry(shortIdentity);
            expect(identityGeometry.contained).toBe(true);
            expect(identityGeometry.hitPoints).toEqual([true, true, true]);
            const actionGeometry = [];
            for (const actionName of [en.buttons.cancel, en.buttons.remove]) {
              const action = dialog.getByRole('button', {
                name: actionName,
                exact: true,
              });
              await expect(action).toBeEnabled();
              const geometry = await exposedGeometry(action);
              expect(geometry.contained).toBe(true);
              expect(geometry.hitPoints).toEqual([true, true, true]);
              actionGeometry.push({ actionName, geometry });
            }
            observations.shortConfirmations.push({
              chainId,
              identityGeometry,
              actionGeometry,
              identity: await visibleIdentity(dialog),
            });
            await capture(page);
            // Remove is only inspected, never activated in this regression.
            await dialog
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click();
            await expect(dialog).toHaveCount(0);
            expect(await publicRegistry(page)).toEqual(stable);
          }
        }
      );
      await step(
        'verify all exact targets, cancellation and read-only audit gates',
        async () => {
          expect(await publicRegistry(page)).toEqual(stable);
          for (const id of IDS)
            expect(server.reads.some((read) => read.chainId === id)).toBe(true);
          expect(routes!.deniedWrites).toEqual([]);
          expect(server.forbidden).toEqual([]);
          expect(forbiddenRequests).toEqual([]);
          expect(unexpectedWalletHttpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
          observations.milestones.exactEditCancelAndSafety = true;
          await info.attach('network-label-identity-before-assertion', {
            contentType: 'application/json',
            body: JSON.stringify(evidence(), null, 2),
          });
        }
      );
      await step(
        'require two distinguishable registration identities at both widths',
        async () => {
          // Route targets and row positions prove handler correctness, not a
          // user-visible identity cue. Compare only actual visible/ARIA content.
          const distinctCounts = observations.widths.map(
            ({ identities }: any) =>
              new Set(
                identities.map(({ row, dialog }: any) =>
                  JSON.stringify({
                    row: readableIdentity(row),
                    dialog: readableIdentity(dialog),
                  })
                )
              ).size
          );
          expect(distinctCounts).toEqual([2, 2]);
        }
      );
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        await info.attach('network-label-identity-final', {
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
