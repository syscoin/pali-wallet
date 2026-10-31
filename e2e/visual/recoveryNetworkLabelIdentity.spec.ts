import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { createIsolatedVaultFixture } from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { UTXO_FIXTURE_SEED } from '../harness/utxoFixture';

// Normal-UI recovery network chooser identity regression. The initial active5700 is
// healthy. Only after ordinary registration and a healthy switch to5 does its
// exact HD0/latest balance wire return an RPC error. No route, controller,
// renderer/store result, focus or scroll state is replaced. Both candidates
// must actually be inactive when their visible/accessible cues are compared.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const IDS = [5, 11155111] as const;
const DEFAULT_RPC = 'https://rpc.tanenbaum.io';
const sha = (file: string) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

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

// Finite identity, owned native-balance, owned pagination-hint and empty
// block-history reads only. No gas, code, call, signing or write method.
function rpcResult(chainId: number, owner: string, call: any) {
  const envelope =
    call &&
    typeof call === 'object' &&
    !Array.isArray(call) &&
    call.jsonrpc === '2.0' &&
    Number.isSafeInteger(call.id) &&
    call.id >= 0 &&
    Object.keys(call).every((key) =>
      ['id', 'jsonrpc', 'method', 'params'].includes(key)
    ) &&
    Array.isArray(call.params);
  if (!envelope) return undefined;
  const params = call.params;
  if (params.length === 0) {
    if (call.method === 'eth_chainId') return '0x' + chainId.toString(16);
    if (call.method === 'net_version') return String(chainId);
    if (call.method === 'eth_blockNumber') return '0x1';
  }
  if (
    ['eth_getBalance', 'eth_getTransactionCount'].includes(call.method) &&
    params.length === 2 &&
    typeof params[0] === 'string' &&
    params[0].toLowerCase() === owner.toLowerCase() &&
    params[1] === 'latest'
  )
    return '0x0';
  if (
    call.method === 'eth_getBlockByNumber' &&
    params.length === 2 &&
    ['0x0', '0x1'].includes(params[0]) &&
    params[1] === true
  )
    return {
      number: params[0],
      hash: '0x' + (params[0] === '0x0' ? '11' : '12').repeat(32),
      parentHash: '0x' + (params[0] === '0x0' ? '00' : '11').repeat(32),
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
  return undefined;
}

async function startRegistrationFixture(owner: string) {
  let origin = '';
  const reads: any[] = [],
    forbidden: unknown[] = [],
    blocked: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
    const exact =
      url.origin === origin &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    const chainId = exact && IDS.find((id) => url.pathname === '/rpc-' + id);
    const headers = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (exact && url.pathname === '/' && request.method === 'GET') {
      response.writeHead(200, headers).end('{}');
      return;
    }
    if (chainId && request.method === 'OPTIONS') {
      response.writeHead(204, headers).end();
      return;
    }
    if (!chainId || request.method !== 'POST') {
      blocked.push('GET');
      response
        .writeHead(403, { 'content-type': 'text/plain', connection: 'close' })
        .end('Offline fixture only');
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 65536) request.destroy();
    });
    request.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const calls = Array.isArray(payload) ? payload : [payload];
        const results = calls.map((call: any) =>
          rpcResult(chainId, owner, call)
        );
        if (!calls.length || results.some((value) => value === undefined)) {
          forbidden.push({
            path: url.pathname,
            calls: calls.map((call: any) => ({
              method: call?.method,
              params: call?.params,
              keys: call && typeof call === 'object' ? Object.keys(call) : [],
            })),
          });
          response.writeHead(400, headers).end('{}');
          return;
        }
        const replies = calls.map((call: any, index: number) => {
          reads.push({ chainId, method: call.method, params: call.params });
          return { jsonrpc: '2.0', id: call.id, result: results[index] };
        });
        response
          .writeHead(200, headers)
          .end(JSON.stringify(Array.isArray(payload) ? replies : replies[0]));
      } catch {
        forbidden.push({ malformed: true, path: url.pathname });
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
  if (!address || typeof address === 'string') throw new Error('Missing port');
  origin = 'http://127.0.0.1:' + address.port;
  return {
    url: origin,
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

const publicScope = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state']);
    const network = (value: any) =>
      value && {
        kind: value.kind,
        chainId: value.chainId,
        slip44: value.slip44,
        url: value.url,
        label: value.label,
        currency: value.currency,
        explorer: value.explorer,
        apiUrl: value.apiUrl,
        key: value.key,
        default: value.default,
        coingeckoId: value.coingeckoId,
        coingeckoPlatformId: value.coingeckoPlatformId,
      };
    const networks = (value: any) =>
      Object.entries(value || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, item]) => ({
            kind,
            id,
            network: network(item),
          }))
        )
        .sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
          }))
        )
        .sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).flatMap(([id, families]: [string, any]) =>
            Object.entries(families || {}).map(([family, values]) => ({
              kind,
              id,
              family,
              values: (values as any[]).map((asset: any) => ({
                id: asset.id,
                assetGuid: asset.assetGuid,
                chainId: asset.chainId,
                symbol: asset.symbol || asset.tokenSymbol,
                balance: asset.balance,
                decimals: asset.decimals,
                address: asset.contractAddress || asset.contract,
                standard: asset.tokenStandard,
                tokenId: asset.tokenId,
                isNft: asset.isNft,
              })),
            }))
          )
        )
        .sort((a, b) =>
          (a.kind + a.id + a.family).localeCompare(b.kind + b.id + b.family)
        );
    const grants = (value: any) =>
      Object.values(value || {})
        .map((grant: any) => ({
          host: grant.host,
          accountId: grant.accountId,
          accountType: grant.accountType,
          chain: grant.chain,
          chainId: grant.chainId,
          date: grant.date,
        }))
        .sort((a, b) => a.host.localeCompare(b.host));
    return {
      ready:
        !state.vaultGlobal.isPostNetworkSwitchLoading &&
        !state.vaultGlobal.isSwitchingAccount &&
        !state.vaultGlobal.loadingStates?.isLoadingBalances,
      active: state.vault.activeAccount,
      savedActive: disk[key]?.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      network: network(state.vault.activeNetwork),
      savedNetwork: network(disk[key]?.activeNetwork),
      liveNetworks: networks(state.vaultGlobal.networks),
      savedNetworks: networks(disk.state?.vaultGlobal?.networks),
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(disk[key]),
      liveAssets: assets(state.vault),
      savedAssets: assets(disk[key]),
      liveGrants: grants(state.dapp?.dapps),
      savedGrants: grants(disk.state?.dapp?.dapps),
    };
  });

async function physicalDenial(
  server: Awaited<ReturnType<typeof startRegistrationFixture>>,
  method: 'GET' | 'CONNECT'
) {
  const proxy = new URL(server.url),
    before = server.blocked.length;
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  const receipt = await new Promise<{
    connectionClosed: boolean;
    statusCode: number;
  }>((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0),
      ended = false,
      settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2000, () =>
      fail(new Error('Physical deny-proxy canary timed out'))
    );
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(
        `${method} ${
          method === 'GET'
            ? 'http://token-feedback-denied.invalid/'
            : 'token-feedback-denied.invalid:443'
        } HTTP/1.0\r\nHost: token-feedback-denied.invalid\r\nConnection: close\r\n\r\n`
      )
    );
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Physical canary response too large'));
    });
    socket.once('end', () => {
      ended = true;
    });
    socket.once('close', (hadError) => {
      if (settled) return;
      settled = true;
      try {
        expect(hadError).toBe(false);
        expect(ended).toBe(true);
        const text = bytes.toString('utf8'),
          separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        expect(text.slice(0, separator).split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(text.slice(0, separator)).toMatch(
          /\r\nConnection: close(?:\r\n|$)/i
        );
        expect(text.slice(separator + 4)).toBe(
          method === 'GET' ? 'Offline fixture only' : ''
        );
        resolve({ connectionClosed: true, statusCode: 403 });
      } catch (error) {
        reject(error);
      }
    });
  });
  expect(server.blocked.slice(before)).toEqual([method]);
  return { method, ...receipt };
}

const phase = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return {
      networkStatus: state.vaultGlobal.networkStatus,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
      switchingAccount: state.vaultGlobal.isSwitchingAccount,
    };
  });

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))
    );
  });
  // Observe the rows' CSS hover transitions reaching their natural end;
  // unrelated looping animations must not prevent an ordinary capture.
  // Never fast-forward or cancel animations to manufacture comparison pixels.
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .every(
            (animation) =>
              animation.playState !== 'running' && !animation.pending
          )
      )
    )
    .toBe(true);
}
async function focusWithTab(page: Page, target: Locator) {
  for (let count = 0; count < 80; count++) {
    if (await target.evaluate((element) => document.activeElement === element))
      break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
async function reveal(page: Page, target: Locator) {
  for (let count = 0; count < 12; count++) {
    const value = await target.evaluate((element) => {
      const owner = element.closest(
        '[data-navigation-scroll="network-picker"]'
      ) as HTMLElement | null;
      if (!owner) throw new Error('Missing real recovery scroll owner');
      const box = element.getBoundingClientRect(),
        parent = owner.getBoundingClientRect();
      const top = Math.max(0, parent.top + owner.clientTop),
        bottom = Math.min(
          innerHeight,
          parent.top + owner.clientTop + owner.clientHeight
        );
      const x = Math.max(
          4,
          Math.min(innerWidth - 4, parent.left + parent.width / 2)
        ),
        y = Math.max(top + 4, Math.min(bottom - 4, (top + bottom) / 2));
      const hit = document.elementFromPoint(x, y);
      return {
        shown: box.top >= top + 4 && box.bottom <= bottom - 4,
        fits: box.height <= bottom - top - 8,
        delta: box.top < top + 4 ? -96 : 96,
        ownerHit: !!hit && (hit === owner || owner.contains(hit)),
        x,
        y,
        scrollTop: owner.scrollTop,
      };
    });
    if (value.shown) return;
    expect(value.fits).toBe(true);
    expect(value.ownerHit).toBe(true);
    await page.mouse.move(value.x, value.y);
    await page.mouse.wheel(0, value.delta);
    await settle(page);
  }
  throw new Error('Real native wheel did not reveal recovery control');
}
async function identity(row: Locator) {
  const ax = await row.ariaSnapshot();
  const dom = await row.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node),
        bounds = node.getBoundingClientRect();
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
    const cues = Array.from(
      element.querySelectorAll(
        '[title], [aria-label], [aria-description], img, svg title, svg desc'
      )
    ).map((node) => ({
      tag: node.tagName,
      text:
        node.tagName.toLowerCase() === 'title' ||
        node.tagName.toLowerCase() === 'desc'
          ? node.textContent
          : null,
      title: node.getAttribute('title'),
      label: node.getAttribute('aria-label'),
      description: node.getAttribute('aria-description'),
      alt: node.getAttribute('alt'),
      image: node.tagName === 'IMG' ? node.getAttribute('src') : null,
    }));
    // Include real icon shapes, not unique DOM IDs or React object identity.
    const icons = Array.from(element.querySelectorAll('svg')).map((svg) => ({
      viewBox: svg.getAttribute('viewBox'),
      shapes: Array.from(
        svg.querySelectorAll('path,polygon,polyline,circle,rect,ellipse,line')
      ).map((shape) => ({
        tag: shape.tagName,
        attributes: Object.fromEntries(
          [
            'd',
            'points',
            'cx',
            'cy',
            'r',
            'rx',
            'ry',
            'x',
            'y',
            'x1',
            'x2',
            'y1',
            'y2',
            'width',
            'height',
            'fill',
            'stroke',
          ].map((key) => [key, shape.getAttribute(key)])
        ),
      })),
    }));
    return {
      text: (element as HTMLElement).innerText,
      title: element.getAttribute('title'),
      label: element.getAttribute('aria-label'),
      description: element.getAttribute('aria-description'),
      pressed: element.getAttribute('aria-pressed'),
      cues,
      icons,
      bounds: box.toJSON(),
      clip,
      contained:
        box.left >= clip.left - 0.5 &&
        box.right <= clip.right + 0.5 &&
        box.top >= clip.top - 0.5 &&
        box.bottom <= clip.bottom + 0.5,
      hits: [0.25, 0.5, 0.75].map((fraction) => {
        const hit = document.elementFromPoint(
          box.left + box.width * fraction,
          box.top + box.height / 2
        );
        return !!hit && (hit === element || element.contains(hit));
      }),
    };
  });
  return {
    ax,
    dom,
    readable: {
      ax,
      text: dom.text,
      title: dom.title,
      label: dom.label,
      description: dom.description,
      cues: dom.cues,
      icons: dom.icons,
    },
  };
}

for (const scenario of [
  {
    name: 'distinct-label-control-400x620',
    labels: ['Goerli control', 'Sepolia control'],
    viewport: { width: 400, height: 620 },
  },
  {
    name: 'same-label-400x620',
    labels: ['Shared test network', 'Shared test network'],
    viewport: { width: 400, height: 620 },
  },
  {
    name: 'same-label-320x360',
    labels: ['Shared test network', 'Shared test network'],
    viewport: { width: 320, height: 360 },
  },
] as const) {
  test(
    'recovery network chooser exposes exact readable identity for ' +
      scenario.name,
    async ({}, info) => {
      test.setTimeout(8 * 60_000);
      expect(process.version).toBe('v26.12.1');
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const runtime = extensionEvidence(),
        sourceSha256 = sha(info.file);
      expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
      // The raw build also contains late-emitted asset-manifest.json; the ZIP
      // does not. Bind the actual complete artifact and executing worker, not
      // an incidental member count from one packaging path.
      expect(runtime.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(runtime.bundleHashes).toEqual({
        background: expect.stringMatching(/^[a-f0-9]{64}$/),
        external: expect.stringMatching(/^[a-f0-9]{64}$/),
        inpage: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const previous = { ...E2E_CONFIG },
        fixture = createIsolatedVaultFixture();
      const owner = fixture.evmAddresses[0],
        server = await startRegistrationFixture(owner);
      const reads: unknown[] = [],
        unsupported: unknown[] = [],
        writes: string[] = [],
        httpFailures: unknown[] = [],
        pageErrors: string[] = [],
        expectedBalanceFailures: unknown[] = [];
      const observations: any = {
        scenario,
        runtime,
        sourceSha256,
        identities: [],
        switches: [],
      };
      let wallet: PaliWallet | undefined,
        status: 'passed' | 'failed' = 'failed';
      let fail5700Balance = false;
      const evidence = () => ({
        status,
        observations,
        reads,
        unsupported,
        writes,
        httpFailures,
        pageErrors,
        localRpcReads: server.reads,
        localForbidden: server.forbidden,
        expectedBalanceFailures,
        blockedProxyCount: server.blocked.length,
        proxyCountIsPlatformEvidenceOnly: true,
        controllerResultsReplaced: false,
        rendererOrStoreReplaced: false,
        routeOrHistoryInjected: false,
        focusOrScrollSetterUsed: false,
        signingOrBroadcastRequested: false,
        connectionGranted: false,
      });
      try {
        const config = getNetworkConfig(57, 'sys');
        const xpub = new sys.HDSigner(
          UTXO_FIXTURE_SEED,
          '',
          false,
          config.networks,
          57,
          config.types.zPubType,
          84
        ).getAccountXpub();
        const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
        const add = (url: string, value: unknown) =>
          auxiliary.set(requestKey(new URL(url)), value);
        const empty = {
          address: xpub,
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
        for (const query of [
          'details=tokenBalances&tokens=used',
          'details=txsummary&pageSize=30',
          'details=tokenBalances&tokens=nonzero',
          'details=txslight&pageSize=30',
        ])
          add(
            'https://blockbook.syscoin.org/api/v2/xpub/' + xpub + '?' + query,
            empty
          );
        for (const origin of [
          'https://blockbook.syscoin.org',
          'https://blockbook-dev.syscoin.org',
        ])
          add(origin + '/api/v2/tickers/currency', {
            ts: 1,
            rates: { usd: 1 },
          });
        add('https://api.coingecko.com/api/v3/asset_platforms', []);
        add(
          'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
          // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
          { syscoin: { usd: 1, usd_24h_change: 0 } }
        );
        for (const action of [
          'tokenlist',
          'txlist',
          'pendingtxlist',
          'tokentx',
        ]) {
          const url = new URL('https://explorer.tanenbaum.io/api');
          url.searchParams.set('module', 'account');
          url.searchParams.set('action', action);
          url.searchParams.set('address', owner);
          if (action === 'txlist' || action === 'tokentx')
            url.searchParams.set('sort', 'desc');
          add(url.href, {
            status: action === 'tokenlist' ? '1' : '0',
            message: action === 'tokenlist' ? 'OK' : 'No transactions found',
            result: [],
          });
        }
        add(
          'https://chainlist.org/rpcs.json',
          IDS.map((chainId, index) => ({
            name: index === 0 ? 'Goerli' : 'Sepolia',
            chainId,
            networkId: chainId,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpc: [
              {
                url: server.url + '/rpc-' + chainId,
                tracking: 'none',
                isOpenSource: true,
              },
            ],
            explorers: [
              {
                name: 'Synthetic explorer',
                url: server.url + '/explorer-' + chainId,
              },
            ],
          }))
        );
        observations.physicalCanaries = [
          await physicalDenial(server, 'GET'),
          await physicalDenial(server, 'CONNECT'),
        ];
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'RecoveryChooserSynthetic!2026',
          rpcUrl: server.url,
        });
        wallet = await PaliWallet.launch(
          'recovery-network-identity-' + scenario.name,
          {
            offlineHttpProxy: server.url,
            recordVideo: false,
            // Registration keeps its established healthy viewport; recovery is
            // actually inspected/operated at the case viewport below.
            viewport: { width: 400, height: 620 },
          }
        );
        const page = wallet.page;
        const onPage = (value: Page) =>
          value.on('pageerror', (error) => pageErrors.push(error.message));
        onPage(page);
        wallet.context.on('page', onPage);
        wallet.context.on('request', (request) => {
          const url = new URL(request.url());
          if (!['http:', 'https:'].includes(url.protocol)) return;
          reads.push({ method: request.method(), url: url.href });
          if (/\/sendtx(?:\/|$)/i.test(url.pathname)) writes.push('sendtx');
          try {
            const payload = request.postDataJSON();
            for (const call of Array.isArray(payload) ? payload : [payload])
              if (
                /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                  call?.method || ''
                )
              )
                writes.push(call.method);
          } catch {
            /* Ordinary GET. */
          }
        });
        wallet.context.on('requestfailed', (request) => {
          if (/^https?:/.test(request.url()))
            httpFailures.push({ method: request.method(), url: request.url() });
        });
        // One complete top-level HTTP gate, not a fallback into a method-only
        // legacy fixture. Custom RPCs physically reach the strict local server.
        await wallet.context.route('**/*', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (!['http:', 'https:'].includes(url.protocol))
            return route.continue();
          const clean = !url.username && !url.password && !url.hash;
          if (
            clean &&
            request.method() === 'GET' &&
            auxiliary.has(requestKey(url))
          )
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(auxiliary.get(requestKey(url))),
            });
          if (
            clean &&
            url.origin === server.url &&
            !url.search &&
            ((url.pathname === '/' && request.method() === 'GET') ||
              (IDS.some((id) => url.pathname === '/rpc-' + id) &&
                ['POST', 'OPTIONS'].includes(request.method())))
          )
            return route.continue();
          let payload: any;
          try {
            payload = request.postDataJSON();
          } catch {
            /* Rejected below. */
          }
          const calls = Array.isArray(payload) ? payload : [payload];
          const results = calls.map((call: any) =>
            rpcResult(5700, owner, call)
          );
          if (
            clean &&
            url.origin === DEFAULT_RPC &&
            url.pathname === '/' &&
            !url.search &&
            request.method() === 'POST' &&
            calls.length &&
            results.every((value) => value !== undefined)
          ) {
            const replies = calls.map((call: any, index: number) => {
              if (fail5700Balance && call.method === 'eth_getBalance') {
                expectedBalanceFailures.push({
                  chainId: 5700,
                  method: call.method,
                  params: call.params,
                });
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  error: {
                    code: -32000,
                    message: 'Synthetic owned balance endpoint unavailable',
                  },
                };
              }
              return { jsonrpc: '2.0', id: call.id, result: results[index] };
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(
                Array.isArray(payload) ? replies : replies[0]
              ),
            });
          }
          unsupported.push({
            method: request.method(),
            url: url.href,
            calls: calls.map((call: any) => ({
              method: call?.method,
              params: call?.params,
              keys: call && typeof call === 'object' ? Object.keys(call) : [],
            })),
          });
          return route.abort('blockedbyclient');
        });
        const step: PaliWallet['step'] = (name, action) =>
          wallet!.step(scenario.name + ': ' + name, action);
        const trigger = () =>
          page
            .getByRole('button')
            .filter({ hasText: /UTXO|EVM/ })
            .first();
        const openMenu = async () => {
          await expect(page).toHaveURL(/#\/home$/);
          await trigger().click();
          const menu = page.getByRole('menu');
          await expect(menu).toBeVisible();
          return menu;
        };
        const chooseHeader = async (label: string) => {
          const menu = await openMenu(),
            toggle = menu.getByRole('menuitem', {
              name: en.networkMenu.evmNetworks,
              exact: true,
            });
          if ((await toggle.getAttribute('aria-expanded')) !== 'true')
            await toggle.click();
          const group = menu.getByRole('group', {
            name: en.networkMenu.evmNetworks,
            exact: true,
          });
          const matches = group
            .getByRole('menuitem')
            .filter({ has: page.getByText(label, { exact: true }) });
          return { menu, matches };
        };
        const assertScope = async (network: any) => {
          const current = await publicScope(page);
          expect(current).toEqual({
            ...stable,
            network,
            savedNetwork: network,
            ready: true,
          });
          return current;
        };
        const waitNetwork = async (network: any, expectedStatus = 'idle') => {
          await expect
            .poll(async () => {
              const current = await publicScope(page);
              return {
                network: current.network,
                saved: current.savedNetwork,
                ready: current.ready,
                phase: await phase(page),
              };
            })
            .toEqual({
              network,
              saved: network,
              ready: true,
              phase: {
                networkStatus: expectedStatus,
                postLoading: false,
                switchingAccount: false,
              },
            });
          return assertScope(network);
        };
        await step(
          'onboard normally and establish healthy separate active5700',
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
            await expect
              .poll(async () => (await phase(page)).networkStatus)
              .toBe('idle');
            observations.initial = await publicScope(page);
            expect(observations.initial.network).toMatchObject({
              kind: 'ethereum',
              chainId: 5700,
              url: DEFAULT_RPC,
            });
            expect(observations.initial.network).toEqual(
              observations.initial.savedNetwork
            );
            expect(observations.initial.liveAccounts).toEqual(
              observations.initial.savedAccounts
            );
            expect(observations.initial.liveAccounts).toHaveLength(1);
            expect(
              observations.initial.liveAccounts[0].address.toLowerCase()
            ).toBe(owner.toLowerCase());
            expect(observations.initial.liveAssets).toEqual(
              observations.initial.savedAssets
            );
            expect(
              observations.initial.liveAssets.every(
                (entry: any) => entry.values.length === 0
              )
            ).toBe(true);
            expect(observations.initial.liveGrants).toEqual([]);
            expect(observations.initial.savedGrants).toEqual([]);
            for (const id of IDS)
              expect(
                observations.initial.liveNetworks.some(
                  (entry: any) =>
                    entry.kind === 'ethereum' && Number(entry.id) === id
                )
              ).toBe(false);
          }
        );
        for (const [index, chainId] of IDS.entries())
          await step(
            'register chain' + chainId + ' using ordinary CustomRPC Save',
            async () => {
              const menu = await openMenu();
              await menu
                .getByRole('menuitem', {
                  name: en.networkMenu.customRpc,
                  exact: true,
                })
                .click();
              await expect(page).toHaveURL(
                /#\/settings\/networks\/custom-rpc$/
              );
              await page
                .getByRole('combobox', { name: en.settings.label, exact: true })
                .fill(scenario.labels[index]);
              await page.locator('#rpc_symbol').fill('ETH');
              await page.locator('#rpc_chainId').fill(String(chainId));
              await page
                .locator('#rpc_explorer')
                .fill(server.url + '/explorer-' + chainId);
              await page
                .locator('#rpc_url')
                .fill(server.url + '/rpc-' + chainId);
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
                      await publicScope(page)
                    ).savedNetworks.find(
                      (entry: any) =>
                        entry.kind === 'ethereum' &&
                        Number(entry.id) === chainId
                    )?.network?.label
                )
                .toBe(scenario.labels[index]);
              const current = await publicScope(page);
              expect(current.liveNetworks).toEqual(current.savedNetworks);
              expect(current.network).toEqual(observations.initial.network);
              expect(current.liveAccounts).toEqual(
                observations.initial.liveAccounts
              );
              expect(current.savedAccounts).toEqual(
                observations.initial.savedAccounts
              );
              expect(current.liveAssets).toEqual(
                observations.initial.liveAssets
              );
              expect(current.savedAssets).toEqual(
                observations.initial.savedAssets
              );
              expect(current.liveGrants).toEqual([]);
              expect(current.savedGrants).toEqual([]);
            }
          );
        const stable = await publicScope(page);
        const network = (id: number) =>
          stable.liveNetworks.find(
            (entry: any) => entry.kind === 'ethereum' && Number(entry.id) === id
          )!.network;
        for (const [index, id] of IDS.entries())
          expect(network(id)).toMatchObject({
            kind: 'ethereum',
            chainId: id,
            label: scenario.labels[index],
            url: server.url + '/rpc-' + id,
            currency: 'eth',
            default: false,
          });
        await step(
          'healthy pointer switch proves first registered endpoint before failure',
          async () => {
            const { menu, matches } = await chooseHeader(scenario.labels[0]);
            await (scenario.labels[0] === scenario.labels[1]
              ? matches.nth(0)
              : matches
            ).click();
            await expect(menu).toBeHidden();
            await waitNetwork(network(5));
            expect(
              server.reads.some(
                (read) => read.chainId === 5 && read.method === 'eth_getBalance'
              )
            ).toBe(true);
          }
        );
        await page.setViewportSize(scenario.viewport);
        const row = (index: number) => {
          const matches = page
            .locator(
              '[data-navigation-scroll="network-picker"] button[aria-pressed][title]'
            )
            .filter({
              has: page.getByText(scenario.labels[index], { exact: true }),
            });
          return scenario.labels[0] === scenario.labels[1]
            ? matches.nth(index)
            : matches;
        };
        const enterRecovery = async () => {
          // Current network is one candidate, so selecting5700 is not the
          // Header's same-active short circuit. Only its owned balance wire fails.
          fail5700Balance = true;
          const before = expectedBalanceFailures.length;
          const { menu, matches } = await chooseHeader('Syscoin NEVM Testnet');
          await expect(matches).toHaveCount(1);
          await matches.click();
          await expect(menu).toBeHidden();
          await expect
            .poll(() => expectedBalanceFailures.length)
            .toBeGreaterThan(before);
          await waitNetwork(stable.network, 'error');
          const indicator = page.getByRole('button', {
            name: en.networkConnection.networkError,
            exact: true,
          });
          await expect(indicator).toHaveCount(1);
          await expect(indicator.locator('span')).toHaveClass(/bg-red-600/);
          await expect(indicator).toBeEnabled();
          expect(await indicator.getAttribute('aria-label')).toBeTruthy();
          await indicator.click();
          await expect(page).toHaveURL(/#\/chain-fail-to-connect$/);
          await page
            .getByRole('button', {
              name: en.chainError.goToAnotherNetwork,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/switch-network$/);
          await expect(
            page.getByRole('button', { name: 'EVM', exact: true })
          ).toHaveAttribute('aria-pressed', 'true');
          await assertScope(stable.network);
          for (const index of [0, 1]) {
            await expect(row(index)).toHaveCount(1);
            await expect(row(index)).toHaveAttribute('aria-pressed', 'false');
            await expect(
              row(index).getByText('(' + en.components.activeStatus + ')', {
                exact: true,
              })
            ).toHaveCount(0);
          }
        };
        for (const [method, id] of [
          ['pointer', 5],
          ['pointer', 11155111],
          ['keyboard', 5],
          ['keyboard', 11155111],
        ] as const) {
          await step(
            method +
              ' chain' +
              id +
              ': genuine error indicator and Go to another network',
            enterRecovery
          );
          if (observations.identities.length === 0)
            for (const index of [0, 1])
              await step(
                'inactive chain' +
                  IDS[index] +
                  ': inspect actual recovery row and all visible/AX/icon cues',
                async (capture) => {
                  await reveal(page, row(index));
                  await page.mouse.move(2, 2);
                  await settle(page);
                  const value = await identity(row(index));
                  expect(value.dom.pressed).toBe('false');
                  expect(value.dom.contained).toBe(true);
                  expect(value.dom.hits).toEqual([true, true, true]);
                  const viewportPath = path.join(
                    E2E_CONFIG.artifactsDir,
                    'screenshots',
                    [
                      'recovery-network-identity',
                      scenario.name,
                      'inactive',
                      IDS[index],
                      'viewport.png',
                    ].join('-')
                  );
                  fs.mkdirSync(path.dirname(viewportPath), {
                    recursive: true,
                  });
                  // This exact-viewport PNG is separate from the retained
                  // PaliWallet.step full-page capture below.
                  const viewportImage = await page.screenshot({
                    fullPage: false,
                    path: viewportPath,
                  });
                  const viewportCapture = {
                    bytes: viewportImage.length,
                    fullPage: false,
                    height: viewportImage.readUInt32BE(20),
                    path: viewportPath,
                    sha256: createHash('sha256')
                      .update(viewportImage)
                      .digest('hex'),
                    width: viewportImage.readUInt32BE(16),
                  };
                  expect({
                    width: viewportCapture.width,
                    height: viewportCapture.height,
                  }).toEqual(scenario.viewport);
                  observations.identities.push({
                    chainId: IDS[index],
                    identity: value,
                    viewportCapture,
                  });
                  await capture(page);
                  await assertScope(stable.network);
                }
              );
          await step(
            method +
              ' chain' +
              id +
              ': select the exact keyed row and Connect normally',
            async () => {
              const index = IDS.indexOf(id);
              if (method === 'pointer') {
                await reveal(page, row(index));
                await row(index).click();
              } else {
                await focusWithTab(page, row(index));
                await page.keyboard.press('Enter');
              }
              await expect(row(index)).toHaveAttribute('aria-pressed', 'true');
              await expect(row(index === 0 ? 1 : 0)).toHaveAttribute(
                'aria-pressed',
                'false'
              );
              await assertScope(stable.network);
              const connect = page.getByRole('button', {
                name: en.buttons.connect,
                exact: true,
              });
              if (method === 'pointer') {
                await reveal(page, connect);
                await connect.click();
              } else {
                await focusWithTab(page, connect);
                await page.keyboard.press('Enter');
              }
              await expect(page).toHaveURL(/#\/home$/);
              observations.switches.push({
                method,
                chainId: id,
                scope: await waitNetwork(network(id)),
              });
            }
          );
        }
        await step(
          'reload preserves exact last network, account, registry, empty inventory and grants',
          async () => {
            await page.reload();
            await wallet!.waitAppReady();
            await wallet!.ensureOnHome();
            observations.afterReload = await waitNetwork(network(11155111));
          }
        );
        await step(
          'complete strict physical worker, source, request and public scope gates before candidate',
          async () => {
            observations.finalWorker = await verifyExecutingWorker(
              wallet!.context,
              wallet!.extensionId,
              E2E_CONFIG.extensionPath,
              (value) => {
                observations.finalWorker = value;
              }
            );
            expect(
              observations.switches.map(
                (value: any) => value.method + ':' + value.chainId
              )
            ).toEqual([
              'pointer:5',
              'pointer:11155111',
              'keyboard:5',
              'keyboard:11155111',
            ]);
            for (const id of IDS)
              expect(
                server.reads.some(
                  (read) =>
                    read.chainId === id && read.method === 'eth_getBalance'
                )
              ).toBe(true);
            expect(expectedBalanceFailures.length).toBeGreaterThanOrEqual(4);
            await assertScope(network(11155111));
            expect(unsupported).toEqual([]);
            expect(server.forbidden).toEqual([]);
            expect(writes).toEqual([]);
            expect(httpFailures).toEqual([]);
            expect(pageErrors).toEqual([]);
            expect(extensionEvidence()).toEqual(runtime);
            expect(sha(info.file)).toBe(sourceSha256);
            const values = observations.identities.map(
              (entry: any) => entry.identity
            );
            observations.distinctCounts = {
              visibleText: new Set(values.map((value: any) => value.dom.text))
                .size,
              accessibleSnapshots: new Set(values.map((value: any) => value.ax))
                .size,
              allReadableCues: new Set(
                values.map((value: any) => JSON.stringify(value.readable))
              ).size,
            };
            await info.attach('recovery-network-identity-before-candidate', {
              contentType: 'application/json',
              body: JSON.stringify(evidence(), null, 2),
            });
          }
        );
        await step(
          'require a readable distinction only after the healthy real selection and scope controls',
          async () => {
            // Both visible text and native AX identity must distinguish the
            // choices; a hidden title or tooltip cannot replace either one.
            // Exact keyed selection already passed before this presentation gate.
            expect(observations.distinctCounts.visibleText).toBe(2);
            expect(observations.distinctCounts.accessibleSnapshots).toBe(2);
            expect(observations.distinctCounts.allReadableCues).toBe(2);
          }
        );
        status = info.errors.length ? 'failed' : 'passed';
      } finally {
        try {
          await info.attach('recovery-network-identity-final', {
            contentType: 'application/json',
            body: JSON.stringify(evidence(), null, 2),
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
    }
  );
}
