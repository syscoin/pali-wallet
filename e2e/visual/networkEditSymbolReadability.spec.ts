import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';
import { isDeepStrictEqual } from 'util';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Exercise the genuine network editor with disposable synthetic accounts and
// finite responses behind a launch-time nonforwarding network fence.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const CHAIN_ID = 5700;
const EVM_LABEL = 'Syscoin NEVM Testnet';
const LONG_SYMBOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF';
const scenarios = [
  {
    symbol: 'XPAY',
    viewport: { width: 400, height: 620 },
    role: 'short-control',
  },
  {
    symbol: 'XPAY',
    viewport: { width: 320, height: 360 },
    role: 'short-symbol-narrow',
  },
  {
    symbol: LONG_SYMBOL,
    viewport: { width: 480, height: 620 },
    role: 'wide-control',
  },
  {
    symbol: LONG_SYMBOL,
    viewport: { width: 400, height: 620 },
    role: 'normal',
  },
  {
    symbol: LONG_SYMBOL,
    viewport: { width: 320, height: 360 },
    role: 'narrow-short',
  },
] as const;
const feeds = new Map<string, unknown>([
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
  // The edit card does not consume autocomplete results. This is a finite
  // normal HTTP read, not a replaced getChainData/controller response.
  ['https://chainlist.org/rpcs.json', []],
]);
const accountQueries = new Set([
  'details=basic',
  'details=basic&pageSize=0',
  'details=tokenBalances&tokens=used',
  'details=tokenBalances&tokens=nonzero',
  'details=txsummary&pageSize=30',
  'details=txslight&pageSize=30',
  'tokens=used&details=tokens',
]);
const digest = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

// Exercise the actual loopback proxy sockets, before Chromium starts. No
// public DNS/socket connection is made; the destination is request text only.
const proxyDenial = async (
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) => {
  const proxy = new URL(server.url);
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
  const before = server.blocked.length;
  const response = await new Promise<{ closed: boolean; status: number }>(
    (resolve, reject) => {
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
        fail(new Error('Loopback denial probe timed out'))
      );
      socket.once('error', fail);
      socket.once('connect', () =>
        socket.write(
          `${method} ${
            method === 'GET'
              ? 'http://network-symbol-denied.invalid/'
              : 'network-symbol-denied.invalid:443'
          } HTTP/1.0\r\nHost: network-symbol-denied.invalid\r\nConnection: close\r\n\r\n`
        )
      );
      socket.on('data', (chunk: Buffer) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 4096)
          fail(new Error('Unexpected denial response size'));
      });
      socket.once('end', () => {
        ended = true;
      });
      socket.once('close', (hadError) => {
        if (settled) return;
        settled = true;
        try {
          const text = bytes.toString('utf8'),
            separator = text.indexOf('\r\n\r\n');
          expect(hadError).toBe(false);
          expect(ended).toBe(true);
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
          resolve({ closed: true, status: 403 });
        } catch (error) {
          reject(error);
        }
      });
    }
  );
  const blockedDelta = server.blocked.slice(before);
  expect(blockedDelta).toEqual([method]);
  return { method, ...response, blockedDelta };
};

// Return only public identities, asset inventory, registrations and grants.
// Never return seed/private material or the unprojected storage state.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const keys = [
      'state',
      'state-vault-0',
      'state-vault-1',
      'state-vault-57',
      'state-vault-60',
    ];
    const disk = await chrome.storage.local.get(keys);
    const clone = (value: any) => JSON.parse(JSON.stringify(value ?? null));
    const vault = (value: any) =>
      value
        ? {
            active: clone(value.activeAccount),
            network: clone(value.activeNetwork),
            accounts: Object.entries(value.accounts || {})
              .flatMap(([kind, group]) =>
                Object.values(group || {}).map((account: any) => ({
                  kind,
                  id: account.id,
                  label: account.label,
                  address: account.address,
                  xpub: account.xpub ?? null,
                }))
              )
              .sort((a, b) =>
                (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
              ),
            assets: clone(value.accountAssets || {}),
          }
        : null;
    return {
      liveNetworks: clone(state.vaultGlobal.networks),
      savedNetworks: clone(disk.state?.vaultGlobal?.networks),
      activeSlip44: state.vaultGlobal.activeSlip44,
      liveVault: vault(state.vault),
      savedVaults: Object.fromEntries(
        keys
          .filter((key) => key !== 'state')
          .map((key) => [key, vault(disk[key])])
      ),
      grants: clone(state.dapp?.dapps || {}),
      savedGrants: clone(disk.state?.dapp?.dapps || {}),
    };
  });
// Public route identity only; never write navigation, history or page state.
const publicNavigationState = (page: Page) =>
  page.evaluate(() => ({
    url: window.location.href,
    hash: window.location.hash,
    historyIndex:
      typeof window.history.state?.idx === 'number'
        ? window.history.state.idx
        : null,
    historyKey:
      typeof window.history.state?.key === 'string'
        ? window.history.state.key
        : null,
  }));
const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
const settle = async (page: Page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity
        )
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
  await frame(page);
};
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 24; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};
const controlGeometry = (target: Locator) =>
  target.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      points: [
        [r.left + 2, r.top + r.height / 2],
        [r.right - 2, r.top + r.height / 2],
        [r.left + r.width / 2, r.top + 2],
        [r.left + r.width / 2, r.bottom - 2],
        [r.left + r.width / 2, r.top + r.height / 2],
      ].map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          reachesControl: !!hit && (hit === node || node.contains(hit)),
        };
      }),
    };
  });
const measureLine = (line: Locator) =>
  line.evaluate((node) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const card = node.parentElement?.parentElement;
    if (!card?.classList.contains('custom-input-normal'))
      throw new Error('Missing actual Edit identity card');
    const cardBox = box(card),
      cardStyle = getComputedStyle(card);
    const pageContent = card.closest('.page-content');
    if (!pageContent) throw new Error('Missing actual page content wrapper');
    const pageBox = box(pageContent),
      pageStyle = getComputedStyle(pageContent);
    const layoutContent = {
      left: pageBox.left + parseFloat(pageStyle.paddingLeft),
      right: pageBox.right - parseFloat(pageStyle.paddingRight),
    };
    const iconHolder = card.firstElementChild;
    if (!iconHolder) throw new Error('Missing actual chain icon wrapper');
    const iconBox = box(iconHolder);
    const cardContent = {
      left: cardBox.left + card.clientLeft + parseFloat(cardStyle.paddingLeft),
      right:
        cardBox.left +
        card.clientLeft +
        card.clientWidth -
        parseFloat(cardStyle.paddingRight),
    };
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const ancestors: any[] = [];
    for (
      let element: Element | null = node;
      element;
      element = element.parentElement
    ) {
      const r = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      ancestors.push({
        tag: element.tagName,
        role: element.getAttribute('role'),
        box: box(element),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      });
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, r.left + element.clientLeft);
        clip.right = Math.min(
          clip.right,
          r.left + element.clientLeft + element.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, r.top + element.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          r.top + element.clientTop + element.clientHeight
        );
      }
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT),
      glyphs: any[] = [];
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const data = text.textContent || '';
      for (let index = 0; index < data.length; index += 1) {
        if (/\s/.test(data[index])) continue;
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        for (const r of [...range.getClientRects()].filter(
          (value) => value.width > 0 && value.height > 0
        )) {
          const x = (r.left + r.right) / 2,
            y = (r.top + r.bottom) / 2;
          const hit = document.elementFromPoint(x, y);
          glyphs.push({
            character: data[index],
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            centerHit: !!hit && (hit === node || node.contains(hit)),
          });
        }
      }
    }
    const tolerance = 0.5;
    return {
      text: node.textContent,
      viewport: { width: innerWidth, height: innerHeight },
      fontStatus: document.fonts.status,
      font: getComputedStyle(node).font,
      line: box(node),
      card: {
        ...cardBox,
        clientWidth: card.clientWidth,
        scrollWidth: card.scrollWidth,
      },
      cardContent,
      layoutContent,
      icon: iconBox,
      clip,
      ancestors,
      glyphs,
      verticalVisible:
        glyphs.length > 0 &&
        glyphs.every(
          (r) =>
            r.top >= clip.top - tolerance && r.bottom <= clip.bottom + tolerance
        ),
      noGlyphClip:
        glyphs.length > 0 &&
        glyphs.every(
          (r) =>
            r.left >= clip.left - tolerance &&
            r.right <= clip.right + tolerance &&
            r.top >= clip.top - tolerance &&
            r.bottom <= clip.bottom + tolerance
        ),
      allGlyphsInsideCard:
        glyphs.length > 0 &&
        glyphs.every(
          (r) =>
            r.left >= cardContent.left - tolerance &&
            r.right <= cardContent.right + tolerance
        ),
      noGlyphOcclusion: glyphs.length > 0 && glyphs.every((r) => r.centerHit),
      noHorizontalOverflow: ancestors.every(
        (item) => item.scrollWidth <= item.clientWidth + 1
      ),
      cardInsideLayout:
        cardBox.left >= layoutContent.left - tolerance &&
        cardBox.right <= layoutContent.right + tolerance,
      iconInsideCard:
        iconBox.left >= cardContent.left - tolerance &&
        iconBox.right <= cardContent.right + tolerance &&
        iconBox.top >= cardBox.top - tolerance &&
        iconBox.bottom <= cardBox.bottom + tolerance,
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
    };
  });

for (const { symbol, viewport, role } of scenarios) {
  test(`ordinary reopened network Edit preserves its ${symbol.length}-letter native symbol at ${viewport.width}x${viewport.height} ${role}`, async ({}, info) => {
    expect(process.version).toBe('v26.12.1');
    expect(info.config.workers).toBe(1);
    expect(info.config.fullyParallel).toBe(false);
    expect(info.retry).toBe(0);
    expect(info.project.timeout).toBe(8 * 60 * 1000);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const sourceSha256 = digest(fs.readFileSync(info.file));
    const repositoryRoot = path.resolve(path.dirname(info.file), '../..');
    const probePath = 'e2e/visual/networkEditSymbolReadability.spec.ts';
    expect(path.resolve(info.file)).toBe(path.join(repositoryRoot, probePath));
    const diagnosticMode = process.env.PALI_DIAGNOSTIC_OLD_RUNTIME;
    const diagnosticSha256 = process.env.PALI_NETWORK_SYMBOL_PROBE_SHA256;
    expect([undefined, '1']).toContain(diagnosticMode);
    let expectedSourceSha256: string;
    if (diagnosticMode === '1') {
      // A reviewed dirty/proposed test may run only with an explicit mode and
      // independently pinned digest. Ordinary CI must use its committed blob.
      expect(diagnosticSha256).toMatch(/^[a-f0-9]{64}$/);
      expectedSourceSha256 = diagnosticSha256!;
    } else {
      expect(diagnosticSha256).toBeUndefined();
      const options = { cwd: repositoryRoot, encoding: 'utf8' as const };
      expect(execFileSync('git', ['rev-parse', 'HEAD'], options).trim()).toBe(
        process.env.PALI_TEST_DAPP_REVISION
      );
      expectedSourceSha256 = digest(
        execFileSync('git', ['show', `HEAD:${probePath}`], {
          cwd: repositoryRoot,
          maxBuffer: 1024 * 1024,
        })
      );
    }
    expect(sourceSha256).toBe(expectedSourceSha256);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(runtime.version).toBe(packageJson.version);
    const prefix = `${symbol.length}-${viewport.width}x${viewport.height}-${role}`;
    const main = getNetworkConfig(57, 'sys');
    const mainSigner = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      main.networks,
      57,
      main.types.zPubType,
      84
    );
    const initialXpub = mainSigner.getAccountXpub();
    const signer = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
    const testXpub = signer.getAccountXpub();
    const testAddress = sys.bitcoinjs.payments.p2wpkh({
      pubkey: signer.deriveKeypair("m/84'/1'/0'/0/0").publicKey,
      network: sys.syscoinNetworks.testnet,
    }).address!;
    const publicIdentifiers = new Set([testXpub, testAddress]);
    const reads: any[] = [],
      unsupported: any[] = [],
      forbidden: any[] = [],
      failedRequests: any[] = [],
      pageErrors: string[] = [];
    const observations: Record<string, any> = {
      symbol,
      viewport,
      role,
      runtime,
      sourceSha256,
      geometries: [],
      gestures: [],
      controls: {},
      screenshots: [],
    };
    const cleanup = {
      contextClosed: false,
      serverClosed: false,
      configRestored: false,
    };
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const localRpc = 'https://network-edit.synthetic.invalid/';
    let wallet: PaliWallet | undefined,
      status: 'passed' | 'failed' = 'failed';
    let revealed: Awaited<ReturnType<typeof measureLine>> | undefined;
    try {
      try {
        expect(server.blocked).toEqual([]);
        observations.denialCanaries = [
          await proxyDenial(server, 'GET'),
          await proxyDenial(server, 'CONNECT'),
        ];
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'ReopenedNetworkSymbolSynthetic!2026',
          rpcUrl: server.url,
        });
        wallet = await PaliWallet.launch(`reopened-network-symbol-${prefix}`, {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        });
        await wallet.context.route('**/*', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (!['http:', 'https:'].includes(url.protocol))
            return route.continue();
          let payload: any;
          try {
            payload = request.postDataJSON();
          } catch {
            /* Ordinary HTTP GET. */
          }
          const calls = Array.isArray(payload) ? payload : [payload];
          const record = {
            method: request.method(),
            url: url.href,
            rpc: calls.filter(Boolean).map((call) => ({
              jsonrpc: call.jsonrpc,
              id: call.id,
              method: call.method,
              params: call.params,
            })),
          };
          if (
            /\/sendtx(?:\/|$)/i.test(url.pathname) ||
            calls.some((call) =>
              /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
          ) {
            forbidden.push(record);
            return route.abort('blockedbyclient');
          }
          if (url.username || url.password || url.hash) {
            unsupported.push(record);
            return route.abort('blockedbyclient');
          }
          // Only the actual locked getEthRpc validation call is admitted. No
          // EVM switch, balance/contract/log reads or wildcard params are needed.
          if (
            request.url() === localRpc &&
            request.method() === 'POST' &&
            payload &&
            !Array.isArray(payload) &&
            JSON.stringify(Object.keys(payload).sort()) ===
              '["id","jsonrpc","method","params"]' &&
            payload.jsonrpc === '2.0' &&
            payload.id === 1 &&
            payload.method === 'eth_chainId' &&
            Array.isArray(payload.params) &&
            payload.params.length === 0
          ) {
            reads.push({
              ...record,
              family: 'ethereum',
              chainId: CHAIN_ID,
              result: '0x1644',
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1644' }),
            });
          }
          if (
            request.url() === localRpc &&
            request.method() === 'OPTIONS' &&
            request.headers()['access-control-request-method'] === 'POST'
          ) {
            reads.push({ ...record, family: 'cors-preflight' });
            return route.fulfill({
              status: 204,
              headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': 'content-type',
                'access-control-allow-methods': 'POST',
              },
            });
          }
          if (request.method() !== 'GET') {
            unsupported.push(record);
            return route.abort('blockedbyclient');
          }
          let body: unknown = feeds.get(url.href);
          if (
            [
              'https://blockbook.syscoin.org/api/v2/tickers/currency',
              'https://blockbook-dev.syscoin.org/api/v2/tickers/currency',
            ].includes(url.href)
          )
            body = { ts: 1, rates: { usd: 1 } };
          const testOrigin = [
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin);
          if (
            testOrigin &&
            ['/api/v2', '/api/v2/'].includes(url.pathname) &&
            !url.search
          )
            body = {
              blockbook: {
                coin: 'Syscoin Testnet',
                inSync: true,
                bestHeight: 1,
              },
              backend: { chain: 'test', blocks: 1 },
            };
          const match = url.pathname.match(
            /^\/api\/v2\/(xpub|address|utxo)\/([^/]+)$/
          );
          if (match) {
            const identifier = decodeURIComponent(match[2]);
            const initial =
              url.origin === 'https://blockbook.syscoin.org' &&
              match[1] === 'xpub' &&
              identifier === initialXpub;
            if (
              (initial || (testOrigin && publicIdentifiers.has(identifier))) &&
              ((match[1] === 'utxo' && !url.search) ||
                (match[1] !== 'utxo' &&
                  accountQueries.has(url.searchParams.toString())))
            )
              body =
                match[1] === 'utxo'
                  ? []
                  : {
                      address: identifier,
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
          }
          if (
            url.origin === 'https://api.coingecko.com' &&
            url.pathname === '/api/v3/simple/price' &&
            [...url.searchParams.keys()].length === 3 &&
            ['ids', 'vs_currencies', 'include_24hr_change'].every(
              (key) => url.searchParams.getAll(key).length === 1
            ) &&
            url.searchParams.get('ids') === 'syscoin' &&
            url.searchParams.get('vs_currencies') === 'usd' &&
            url.searchParams.get('include_24hr_change') === 'true'
          )
            body = { syscoin: { usd: 1, ['usd_24h_change']: 0 } };
          if (body === undefined) {
            unsupported.push(record);
            return route.abort('blockedbyclient');
          }
          reads.push({ ...record, family: 'http-get' });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(body),
          });
        });
        const page = wallet.page;
        page.on('pageerror', (error) => pageErrors.push(error.message));
        wallet.context.on('requestfailed', (request) => {
          if (/^https?:/.test(request.url()))
            failedRequests.push({
              method: request.method(),
              url: request.url(),
            });
        });
        await wallet.step(
          `${prefix} normal onboarding establishes unchanged public identity inventory and registry`,
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
            await wallet!.ensureOnHome();
            await expect
              .poll(async () => {
                const state = await publicState(page);
                observations.lastOnboardingPublicState = state;
                return (
                  isDeepStrictEqual(
                    state.savedVaults['state-vault-1'],
                    state.liveVault
                  ) &&
                  isDeepStrictEqual(state.liveNetworks, state.savedNetworks)
                );
              })
              .toBe(true);
            observations.before = await publicState(page);
            const before = observations.before;
            expect(before.activeSlip44).toBe(1);
            expect(before.liveVault.active).toEqual({
              id: 0,
              type: 'HDAccount',
            });
            expect(before.liveVault.accounts).toEqual([
              {
                kind: 'HDAccount',
                id: 0,
                label: 'SYS-T 1',
                address: testAddress,
                xpub: testXpub,
              },
            ]);
            const inventory = Object.entries(before.liveVault.assets).flatMap(
              ([kind, group]) =>
                Object.entries(group as Record<string, any>).map(
                  ([id, value]) => ({
                    kind,
                    id: Number(id),
                    ethereum: value.ethereum || [],
                    syscoin: value.syscoin || [],
                    nfts: value.nfts || [],
                  })
                )
            );
            expect(inventory).toEqual([
              { kind: 'HDAccount', id: 0, ethereum: [], syscoin: [], nfts: [] },
            ]);
            expect(before.savedVaults['state-vault-1']).toEqual(
              before.liveVault
            );
            expect(before.liveNetworks).toEqual(before.savedNetworks);
            expect(before.grants).toEqual({});
            expect(before.savedGrants).toEqual({});
            expect(before.liveNetworks.ethereum[CHAIN_ID]).toMatchObject({
              chainId: CHAIN_ID,
              label: EVM_LABEL,
              currency: 'tsys',
              kind: 'ethereum',
              default: false,
            });
          }
        );
        const manager = page.locator(
          '[data-navigation-scroll="settings-manage-networks"]'
        );
        const chainName = en.settings.chainNumber.replace(
          '{{chainId}}',
          String(CHAIN_ID)
        );
        const editName = `${en.buttons.edit}: ${EVM_LABEL} (EVM · ${chainName})`;
        const edit = manager.getByRole('button', {
          name: editName,
          exact: true,
        });
        await wallet.step(
          `${prefix} normal network menu Manage then exact named Edit saves only the selected public entry`,
          async () => {
            await page
              .getByRole('button')
              .filter({ hasText: /UTXO|EVM/ })
              .first()
              .click();
            await expect(
              page.getByRole('menuitem', {
                name: en.networkMenu.manageNetworks,
                exact: true,
              })
            ).toHaveCount(1);
            await page.keyboard.press('End');
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
            await expect(edit).toHaveCount(1);
            await edit.click();
            await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
            await expect(page.locator('input#rpc_chainId')).toHaveValue(
              String(CHAIN_ID)
            );
            await expect(page.locator('input#rpc_symbol')).toHaveValue('TSYS');
            await page.locator('input#rpc_symbol').fill(symbol);
            await page.locator('input#rpc_url').fill(localRpc);
            await page.locator('input#rpc_explorer').fill(localRpc);
            await page.locator('input#rpc_apiUrl').fill('');
            await page.locator('input#rpc_url').click();
            await page.locator('input#rpc_url').press('Tab');
            await expect
              .poll(
                () => reads.filter((read) => read.family === 'ethereum').length
              )
              .toBeGreaterThan(0);
            const original =
              observations.before.liveNetworks.ethereum[CHAIN_ID];
            const target = {
              url: localRpc,
              default: original.default,
              label: original.label,
              apiUrl: '',
              explorer: localRpc,
              currency: symbol.toLowerCase(),
              chainId: CHAIN_ID,
              slip44: 60,
              kind: 'ethereum',
              ...(original.key && { key: original.key }),
              ...(original.coingeckoId && {
                coingeckoId: original.coingeckoId,
              }),
              ...(original.coingeckoPlatformId && {
                coingeckoPlatformId: original.coingeckoPlatformId,
              }),
            };
            const accepted = JSON.parse(JSON.stringify(observations.before));
            accepted.liveNetworks.ethereum[CHAIN_ID] = target;
            accepted.savedNetworks.ethereum[CHAIN_ID] = target;
            observations.accepted = accepted;
            const save = page.getByRole('button', {
              name: en.buttons.save,
              exact: true,
            });
            await expect(save).toBeEnabled();
            await save.click();
            await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
            await expect(manager).toBeVisible();
            await expect.poll(() => publicState(page)).toEqual(accepted);
          }
        );
        const family = en.settings.networkFamilyLabel.replace(
          '{{family}}',
          'EVM'
        );
        const identityText = `$${symbol} • ${family}`;
        const line = page.getByText(identityText, { exact: true });
        await wallet.step(
          `${prefix} native keyboard Save Cancel and unsaved draft preserve the stored symbol`,
          async () => {
            await edit.click();
            await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
            await page.setViewportSize(viewport);
            await expect(page.locator('input#rpc_symbol')).toHaveValue(symbol);
            await expect(page.locator('input#rpc_url')).toHaveValue(localRpc);
            expect(await publicState(page)).toEqual(observations.accepted);
            const symbolInput = page.locator('input#rpc_symbol');
            const save = page.getByRole('button', {
              name: en.buttons.save,
              exact: true,
            });
            const cancel = page.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            });
            await tabTo(page, symbolInput);
            await expect(symbolInput).toBeFocused();
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.type('DRAFT');
            await expect(symbolInput).toHaveValue('DRAFT');
            await tabTo(page, save);
            await expect(save).toBeFocused();
            await expect(save).toBeEnabled();
            await tabTo(page, cancel);
            await expect(cancel).toBeFocused();
            for (const [name, control] of [
              ['Save', save],
              ['Cancel', cancel],
            ] as const) {
              const geometry = await controlGeometry(control);
              observations.controls[name] = geometry;
              // Normal shared Button size md is h-10 (40px), not the separate
              // account-created dialog's 44px controls.
              expect(geometry.width).toBeGreaterThanOrEqual(40);
              expect(geometry.height).toBeGreaterThanOrEqual(40);
              expect(
                geometry.points.every((point) => point.reachesControl)
              ).toBe(true);
            }
            expect(await publicState(page)).toEqual(observations.accepted);
            await page.keyboard.press('Enter');
            await expect(manager).toBeVisible();
            expect(await publicState(page)).toEqual(observations.accepted);
            await edit.click();
            await expect(page.locator('input#rpc_symbol')).toHaveValue(symbol);
            await expect(line).toHaveText(identityText);
            await tabTo(
              page,
              page.getByRole('button', { name: en.buttons.cancel, exact: true })
            );
            await page.keyboard.press('Enter');
            await expect(manager).toBeVisible();
            expect(await publicState(page)).toEqual(observations.accepted);
          }
        );
        await wallet.step(
          `${prefix} actual reopened Edit identity is physically revealed and captured without layout injection`,
          async () => {
            observations.priorManagerRoute = await publicNavigationState(page);
            expect(observations.priorManagerRoute.hash).toBe(
              '#/settings/networks/edit'
            );
            expect(observations.priorManagerRoute.historyIndex).not.toBeNull();
            expect(observations.priorManagerRoute.historyKey).not.toBeNull();
            await edit.click();
            await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
            await expect(page.locator('input#rpc_symbol')).toHaveValue(symbol);
            await expect(page.locator('input#rpc_url')).toHaveValue(localRpc);
            expect(await publicState(page)).toEqual(observations.accepted);
            await page.setViewportSize(viewport);
            await settle(page);
            expect(
              await page.evaluate(() => ({
                view: document.documentElement.getAttribute('data-pali-view'),
                width: innerWidth,
                height: innerHeight,
              }))
            ).toEqual({ view: 'standalone', ...viewport });
            await expect(line).toHaveCount(1);
            await expect(line).toHaveText(identityText);
            observations.customRpcRoute = await publicNavigationState(page);
            expect(observations.customRpcRoute.hash).toBe(
              '#/settings/networks/custom-rpc'
            );
            expect(observations.customRpcRoute.historyIndex).toBe(
              observations.priorManagerRoute.historyIndex + 1
            );
            expect(observations.customRpcRoute.historyKey).not.toBeNull();
            expect(observations.customRpcRoute.historyKey).not.toBe(
              observations.priorManagerRoute.historyKey
            );
            observations.geometries.push({
              mode: 'initial-reopened',
              geometry: await measureLine(line),
            });
            const scroller = page.locator(
              '[data-navigation-scroll="wallet-layout"]'
            );
            const wheel = async (
              gesture: { x: number; y: number },
              point: { x: number; y: number },
              mode: string
            ) => {
              const hit = await scroller.evaluate((node, p) => {
                const target = document.elementFromPoint(p.x, p.y);
                return !!target && node.contains(target);
              }, point);
              expect(hit).toBe(true);
              await page.mouse.move(point.x, point.y);
              await page.mouse.wheel(gesture.x, gesture.y);
              let previousSignature = '',
                stable = 0;
              await expect
                .poll(async () => {
                  await frame(page);
                  const value = await line.evaluate((node) => {
                    const positions: number[] = [];
                    for (
                      let parent: Element | null = node;
                      parent;
                      parent = parent.parentElement
                    )
                      positions.push(parent.scrollLeft, parent.scrollTop);
                    return JSON.stringify(positions);
                  });
                  stable = value === previousSignature ? stable + 1 : 0;
                  previousSignature = value;
                  return stable >= 2;
                })
                .toBe(true);
              observations.gestures.push({ gesture, point, hit, mode });
              observations.geometries.push({
                mode,
                geometry: await measureLine(line),
              });
            };
            // Always perform a real vertical wheel, even when the initial card
            // was already visible. This cannot manufacture a horizontal fit.
            await wheel(
              { x: 0, y: -384 },
              { x: viewport.width / 2, y: viewport.height / 2 },
              'physical-top-wheel'
            );
            for (let count = 0; count < 8; count += 1) {
              const geometry = await measureLine(line);
              if (geometry.verticalVisible) break;
              const gesture = {
                x: 0,
                y: geometry.line.top < geometry.clip.top ? -144 : 144,
              };
              const point = { x: viewport.width / 2, y: viewport.height / 2 };
              await wheel(gesture, point, `vertical-reveal-${count}`);
            }
            await page.mouse.move(2, 2);
            await settle(page);
            revealed = await measureLine(line);
            observations.geometries.push({
              mode: 'physically-revealed',
              geometry: revealed,
            });
            // A vertical setup/control failure is not this horizontal candidate.
            expect(revealed.verticalVisible).toBe(true);
            expect(revealed.fontStatus).toBe('loaded');
            expect(
              revealed.glyphs.map((glyph) => glyph.character).join('')
            ).toBe(identityText.replace(/\s/g, ''));
            const screenshot = async (phase: string) => {
              const file = path.join(
                E2E_CONFIG.artifactsDir,
                'screenshots',
                `reopened-network-symbol-${prefix}-${phase}.png`
              );
              fs.mkdirSync(path.dirname(file), { recursive: true });
              expect(fs.existsSync(file)).toBe(false);
              await page.screenshot({
                path: file,
                animations: 'disabled',
                fullPage: false,
              });
              const png = fs.readFileSync(file);
              expect(png.subarray(1, 4).toString()).toBe('PNG');
              expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
                viewport.width,
                viewport.height,
              ]);
              observations.screenshots.push({
                phase,
                path: path.relative(E2E_CONFIG.artifactsDir, file),
                sha256: digest(png),
                width: viewport.width,
                height: viewport.height,
              });
              await info.attach(
                `genuine-reopened-network-symbol-${prefix}-${phase}`,
                { path: file, contentType: 'image/png' }
              );
            };
            await screenshot('vertical-revealed');
            for (const deltaX of [240, -240]) {
              expect(await publicNavigationState(page)).toEqual(
                observations.customRpcRoute
              );
              const geometry = await measureLine(line);
              const point = {
                x: Math.max(
                  geometry.clip.left + 4,
                  Math.min(
                    geometry.clip.right - 4,
                    (geometry.line.left + geometry.line.right) / 2
                  )
                ),
                y: Math.max(
                  geometry.clip.top + 4,
                  Math.min(
                    geometry.clip.bottom - 4,
                    (geometry.line.top + geometry.line.bottom) / 2
                  )
                ),
              };
              const cardHit = await line.evaluate((node, p) => {
                const target = document.elementFromPoint(p.x, p.y);
                return (
                  !!target &&
                  !!node.parentElement?.parentElement?.contains(target)
                );
              }, point);
              expect(cardHit).toBe(true);
              await wheel(
                { x: deltaX, y: 0 },
                point,
                `horizontal-reveal-${deltaX}`
              );
              expect(await publicState(page)).toEqual(observations.accepted);
            }
            await page.mouse.move(2, 2);
            await settle(page);
            const afterWheels = await publicNavigationState(page);
            const remainedInEditor = isDeepStrictEqual(
              afterWheels,
              observations.customRpcRoute
            );
            const traversedToExactPriorManager = isDeepStrictEqual(
              afterWheels,
              observations.priorManagerRoute
            );
            observations.navigationAfterWheels = {
              before: observations.customRpcRoute,
              priorManager: observations.priorManagerRoute,
              after: afterWheels,
              remainedInEditor,
              traversedToExactPriorManager,
            };
            // Native horizontal history navigation may restore only the exact
            // preceding manager entry; never ignore a different route or state.
            expect(remainedInEditor || traversedToExactPriorManager).toBe(true);
            if (remainedInEditor) {
              await expect(line).toHaveText(identityText);
              await expect(page.locator('input#rpc_symbol')).toHaveValue(
                symbol
              );
            } else {
              await expect(manager).toBeVisible();
              await expect(edit).toHaveCount(1);
              await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
            }
            await screenshot('after-horizontal-wheels');
            expect(await publicState(page)).toEqual(observations.accepted);
          }
        );
        await wallet.step(
          `${prefix} exact scope source runtime worker and deny controls finish before the candidate`,
          async () => {
            expect(await publicState(page)).toEqual(observations.accepted);
            observations.workerAfter = await verifyExecutingWorker(
              wallet!.context,
              wallet!.extensionId,
              E2E_CONFIG.extensionPath,
              (value) => {
                observations.workerAfter = value;
              }
            );
            expect(
              reads.filter((read) => read.family === 'ethereum').length
            ).toBeGreaterThan(0);
            for (const read of reads.filter(
              (item) => item.family === 'ethereum'
            )) {
              expect(read.url).toBe(localRpc);
              expect(read.chainId).toBe(CHAIN_ID);
              expect(read.rpc).toEqual([
                { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
              ]);
            }
            expect(unsupported).toEqual([]);
            expect(forbidden).toEqual([]);
            expect(failedRequests).toEqual([]);
            expect(pageErrors).toEqual([]);
            expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
            expect(
              server.blocked.every(
                (method) => method === 'GET' || method === 'CONNECT'
              )
            ).toBe(true);
            expect(extensionEvidence()).toEqual(runtime);
            expect(digest(fs.readFileSync(info.file))).toBe(sourceSha256);
          }
        );
      } finally {
        // Explicit context close instead of dispose so final candidate and
        // summary status are decided only after all cleanup has succeeded.
        try {
          if (wallet) {
            await wallet.context.close();
            cleanup.contextClosed = true;
          }
        } finally {
          try {
            await server.close();
            cleanup.serverClosed = true;
          } finally {
            Object.assign(E2E_CONFIG, previous);
            cleanup.configRestored = true;
          }
        }
      }
      expect(cleanup).toEqual({
        contextClosed: true,
        serverClosed: true,
        configRestored: true,
      });
      expect(wallet!.context.pages()).toHaveLength(0);
      expect(E2E_CONFIG).toEqual(previous);
      expect(unsupported).toEqual([]);
      expect(forbidden).toEqual([]);
      expect(failedRequests).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(observations.denialCanaries).toHaveLength(2);
      expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
      expect(
        server.blocked.every(
          (method) => method === 'GET' || method === 'CONNECT'
        )
      ).toBe(true);
      expect(extensionEvidence()).toEqual(runtime);
      expect(digest(fs.readFileSync(info.file))).toBe(sourceSha256);
      expect(revealed).toBeDefined();
      const presentation =
        revealed!.noGlyphClip &&
        revealed!.allGlyphsInsideCard &&
        revealed!.noGlyphOcclusion &&
        revealed!.noHorizontalOverflow &&
        revealed!.cardInsideLayout &&
        revealed!.iconInsideCard;
      const finalName = `${prefix} complete reopened native identity stays readable inside its card without horizontal overflow`;
      try {
        // Sole candidate predicate. All ordinary producer, persistence, keyboard,
        // physical-reveal, deny, worker and cleanup controls have finished.
        expect(
          presentation,
          JSON.stringify({ revealed, screenshots: observations.screenshots })
        ).toBe(true);
        wallet!.summary.addStep({
          durationMs: 0,
          name: finalName,
          status: 'passed',
        });
      } catch (error) {
        wallet!.summary.addStep({
          durationMs: 0,
          name: finalName,
          status: 'failed',
          note: 'Only final presentation predicate failed; inspect original PNG and per-character geometry.',
        });
        throw error;
      }
      status = 'passed';
    } finally {
      try {
        await info.attach('reopened-network-symbol-diagnostic-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            runtime,
            sourceSha256,
            localRpc,
            observations,
            cleanup,
            reads,
            unsupported,
            forbidden,
            failedRequests,
            pageErrors,
            proxyDeniedConnections: server.blocked.length,
            proxyBlockedMethods: server.blocked,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            targetDomOrStyleInjected: false,
            focusOrScrollSetterUsed: false,
            signingOrBroadcastRequested: false,
            privateKeyImportOrRevealRequested: false,
            tracesAndVideosDisabled: true,
          }),
        });
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        wallet?.summary.finish(status);
      }
    }
  });
}
