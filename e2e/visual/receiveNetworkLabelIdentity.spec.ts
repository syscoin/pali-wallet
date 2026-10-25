import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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

// Real Receive-context regression with a distinct-label healthy control.
// Registration/switching/Home Receive use the ordinary UI and exact HTTP-only
// fixture from the qualified header probe. No controller/store/runtime reply,
// QR value, address, clock, or DOM state is replaced. A wrapper observes the
// original native clipboard write; it does not substitute success or contents.
const IDS = [5, 11155111] as const;
// Match useUtils.ts's existing module-wide success-message lifecycle. A toast
// can leave the DOM before this interval ends; no application clock is changed.
const COPY_SUCCESS_DEDUP_MS = 2000;
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

const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return `${url.origin}${url.pathname}${query.size ? `?${query}` : ''}`;
};

// The existing registration fixture's local endpoint boundary, extended only
// with owner-bound ordinary account reads so each real switch can finish.
async function startRegistrationFixture(owner: string) {
  let origin = '';
  const reads: Array<{ chainId: number; method: string; path: string }> = [];
  const forbidden: string[] = [];
  const blocked: string[] = [];
  const rpcResult = (chainId: number, call: any): unknown | undefined => {
    if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params))
      return undefined;
    const params = call.params;
    const ownAccountRead =
      params.length === 2 &&
      typeof params[0] === 'string' &&
      params[0].toLowerCase() === owner.toLowerCase() &&
      ['latest', 'pending'].includes(params[1]);
    switch (call.method) {
      case 'eth_chainId':
        return params.length === 0 ? `0x${chainId.toString(16)}` : undefined;
      case 'net_version':
        return params.length === 0 ? String(chainId) : undefined;
      case 'eth_blockNumber':
        return params.length === 0 ? '0x1' : undefined;
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return params.length === 0 ? '0x3b9aca00' : undefined;
      case 'eth_getBalance':
      case 'eth_getTransactionCount':
        return ownAccountRead ? '0x0' : undefined;
      case 'eth_getCode':
        return ownAccountRead ? '0x' : undefined;
      case 'eth_getBlockByNumber':
        return params.length === 2 &&
          ['latest', '0x0', '0x1'].includes(params[0]) &&
          (params[1] === false ||
            (params[1] === true && ['0x0', '0x1'].includes(params[0])))
          ? {
              number: params[0] === '0x0' ? '0x0' : '0x1',
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
            }
          : undefined;
      default:
        return undefined;
    }
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
    const chainId =
      url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      IDS.find((id) => url.pathname === `/rpc-${id}`);
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
      !url.search &&
      !url.username &&
      !url.password &&
      !url.hash
    ) {
      response.writeHead(200, headers).end('{}');
      return;
    }
    if (chainId && request.method === 'OPTIONS' && !url.search) {
      response.writeHead(204, headers).end();
      return;
    }
    if (!chainId || request.method !== 'POST' || url.search) {
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
          const result = rpcResult(chainId, call);
          if (result === undefined) {
            forbidden.push(String(call?.method));
            return {
              jsonrpc: '2.0',
              id: call?.id,
              error: {
                code: -32601,
                message: 'Read-only owner-scoped fixture',
              },
            };
          }
          reads.push({ chainId, method: call.method, path: url.pathname });
          return { jsonrpc: '2.0', id: call.id, result };
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

const publicState = (page: Page) =>
  page.evaluate(async (fields) => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const key = 'state-vault-' + current.vaultGlobal.activeSlip44;
    const saved = await chrome.storage.local.get(['state', key]);
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
    const account = (vault: any) => {
      const ref = vault?.activeAccount;
      const entry = ref && vault?.accounts?.[ref.type]?.[ref.id];
      return ref && entry
        ? { id: ref.id, type: ref.type, address: entry.address }
        : null;
    };
    return {
      live: networks(current),
      saved: networks(saved.state),
      active: project(current.vault.activeNetwork),
      savedActive: project(saved[key]?.activeNetwork),
      activeSlip44: current.vaultGlobal.activeSlip44,
      account: account(current.vault),
      savedAccount: account(saved[key]),
      grants: Object.keys(current.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(saved.state?.dapp?.dapps || {}).sort(),
      readiness: {
        networkStatus: current.vaultGlobal.networkStatus,
        postLoading: current.vaultGlobal.isPostNetworkSwitchLoading,
        switchingAccount: current.vaultGlobal.isSwitchingAccount,
      },
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
const geometry = (target: Locator) =>
  target.evaluate((element) => {
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
      hitPoints: [0.25, 0.5, 0.75].map((fraction) => {
        const hit = document.elementFromPoint(
          box.left + box.width * fraction,
          box.top + box.height / 2
        );
        return Boolean(hit && (element === hit || element.contains(hit)));
      }),
    };
  });

const qrPaths = (address: string) =>
  Array.from(
    renderToStaticMarkup(
      React.createElement(QRCodeSVG, { value: address })
    ).matchAll(/\bd="([^"]+)"/g),
    (match) => match[1]
  );

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

// Ordinary wheel reveal, with actual scroll-settlement reads. Never assign
// scrollTop, call focus(), scrollIntoView(), or replace the layout to expose it.
const revealReceiveTarget = async (page: Page, target: Locator) => {
  const gestures: Array<Record<string, unknown>> = [];
  const port = page.locator('[data-navigation-scroll="wallet-layout"]');
  await expect(port).toHaveCount(1);
  for (let count = 0; count < 4; count += 1) {
    const before = await target.boundingBox();
    expect(before).not.toBeNull();
    const viewport = page.viewportSize()!;
    if (before!.y >= 16 && before!.y + before!.height <= viewport.height - 16)
      break;
    const delta =
      before!.y < 16
        ? Math.floor(before!.y - 16)
        : Math.ceil(before!.y + before!.height - (viewport.height - 16));
    const scroll = await port.evaluate((element) => ({
      top: element.scrollTop,
      max: element.scrollHeight - element.clientHeight,
    }));
    const expectedTop = Math.max(0, Math.min(scroll.max, scroll.top + delta));
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, delta);
    await expect
      .poll(async () =>
        Math.abs(
          (await port.evaluate((element) => element.scrollTop)) - expectedTop
        )
      )
      .toBeLessThanOrEqual(1);
    await frame(page);
    gestures.push({ delta, before, scroll, expectedTop });
  }
  await page.mouse.move(2, 2);
  await frame(page);
  const measured = await geometry(target);
  expect(measured.contained).toBe(true);
  expect(measured.hitPoints).toEqual([true, true, true]);
  return { gestures, geometry: measured };
};

const focusReceiveCopyWithKeyboard = async (page: Page, copy: Locator) => {
  for (let count = 0; count < 40; count += 1) {
    if (await copy.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press('Tab');
  }
  await expect(copy).toBeFocused();
};

const observeNativeClipboard = () => {
  if ((window as any).__receiveIdentityClipboardObserved) return;
  const write = navigator.clipboard.writeText.bind(navigator.clipboard);
  (window as any).__receiveIdentityCopies = [];
  (window as any).__receiveIdentityClipboardObserved = true;
  navigator.clipboard.writeText = async (text) => {
    await write(text);
    (window as any).__receiveIdentityCopies.push(text);
  };
};

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
  test(`Receive retains readable selected-network context for ${scenario.name}`, async ({}, info) => {
    expect(process.version).toBe('v23.11.1');
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
    const emptyInventory = {
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
    const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
    const addRead = (url: string, body: unknown) =>
      auxiliary.set(requestKey(new URL(url)), body);
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addRead(origin + '/api/v2/tickers/currency', {
        ts: 1,
        rates: { usd: 1 },
      });
    for (const query of [
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ])
      addRead(
        'https://blockbook.syscoin.org/api/v2/xpub/' +
          initialXpub +
          '?' +
          query,
        emptyInventory
      );
    addRead('https://api.coingecko.com/api/v3/asset_platforms', []);
    addRead(
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
      addRead(url.href, {
        status: action === 'tokenlist' ? '1' : '0',
        message: action === 'tokenlist' ? 'OK' : 'No transactions found',
        result: [],
      });
    }
    const server = await startRegistrationFixture(owner);
    addRead(
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
      password: 'ReceiveNetworkIdentitySynthetic!2026',
      rpcUrl: server.origin,
    });
    const reads: Array<{ method: string; url: string }> = [];
    const unexpectedWalletHttpFailures: Array<{ method: string; url: string }> =
      [];
    const forbiddenRequests: string[] = [],
      pageErrors: string[] = [];
    const observations: Record<string, any> = {
      scenario,
      runtime,
      sourceSha256,
      chooserIdentities: [],
      switches: [],
      receives: [],
    };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let lastCopySuccessObservedAt: number | undefined;
    const evidence = () => ({
      status,
      observations,
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
      runtimeMessagesManufactured: false,
      reduxOrDOMReplaced: false,
      cacheOrAlarmModified: false,
      signingOrBroadcastRequested: false,
      removalConfirmed: false,
      connectionGranted: false,
      qrOrAddressReplaced: false,
      nativeClipboardWriteObservedWithoutSubstitution: true,
    });
    try {
      wallet = await PaliWallet.launch(
        `receive-network-identity-${scenario.name}`,
        {
          offlineHttpProxy: server.origin,
          // Match the existing registration journey, then inspect and switch
          // at the case's actual narrow/short viewport below.
          viewport: { width: 400, height: 620 },
        }
      );
      const page = wallet.page;
      await wallet.context.addInitScript(observeNativeClipboard);
      // The existing initial document is already loaded at launch.
      await page.evaluate(observeNativeClipboard);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('page', (newPage) =>
        newPage.on('pageerror', (error) => pageErrors.push(error.message))
      );
      // Audits precede the first deny handler; auxiliary GETs are installed
      // atomically with it so startup feeds cannot race later route setup.
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          reads.push({ method: request.method(), url: request.url() });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname))
          forbiddenRequests.push('sendtx');
        try {
          const payload = request.postDataJSON();
          for (const call of Array.isArray(payload) ? payload : [payload])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          /* Ordinary GETs have no JSON body. */
        }
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          unexpectedWalletHttpFailures.push({
            method: request.method(),
            url: request.url(),
          });
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.origin,
        (url) =>
          !url.username && !url.password && !url.hash
            ? auxiliary.get(requestKey(url))
            : undefined
      );
      await wallet.context.route(`${server.origin}/**`, (route) => {
        const request = route.request(),
          url = new URL(request.url());
        const exactLocal =
          url.origin === server.origin &&
          !url.username &&
          !url.password &&
          !url.hash &&
          !url.search;
        return exactLocal &&
          ((IDS.some((id) => url.pathname === `/rpc-${id}`) &&
            ['POST', 'OPTIONS'].includes(request.method())) ||
            (url.pathname === '/' && request.method() === 'GET'))
          ? route.continue()
          : route.fallback();
      });
      const step: PaliWallet['step'] = (name, action) =>
        wallet!.step(`${scenario.name}: ${name}`, action);
      const trigger = () =>
        page
          .getByRole('button')
          .filter({ hasText: /UTXO|EVM/ })
          .first();
      const openMenu = async () => {
        await expect(page).toHaveURL(/#\/home$/);
        await revealReceiveTarget(page, trigger());
        await trigger().click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        await expect(menu).toBeFocused();
        return menu;
      };
      const evmGroup = async () => {
        const menu = await openMenu();
        const toggle = menu.getByRole('menuitem', {
          name: en.networkMenu.evmNetworks,
          exact: true,
        });
        if ((await toggle.getAttribute('aria-expanded')) !== 'true')
          await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        return {
          menu,
          group: menu.getByRole('group', {
            name: en.networkMenu.evmNetworks,
            exact: true,
          }),
        };
      };
      const targetChoice = (group: Locator, index: number) => {
        const matches = group.getByRole('menuitem').filter({
          has: page.getByText(scenario.labels[index], { exact: true }),
        });
        return scenario.labels[0] === scenario.labels[1]
          ? matches.nth(index)
          : matches;
      };
      const assertUnchangedRegistry = async (stable: any) => {
        const current = await publicState(page);
        expect(current.live).toEqual(stable.live);
        expect(current.saved).toEqual(stable.saved);
        expect(current.live).toEqual(current.saved);
        expect(current.account).toEqual(stable.account);
        expect(current.savedAccount).toEqual(stable.account);
        expect(current.grants).toEqual([]);
        expect(current.savedGrants).toEqual([]);
        return current;
      };
      const settleCommittedNetwork = async (expected: any, stable: any) => {
        await expect
          .poll(async () => {
            const current = await publicState(page);
            return {
              active: current.active,
              savedActive: current.savedActive,
              readiness: current.readiness,
              account: current.account,
              savedAccount: current.savedAccount,
              activeSlip44: current.activeSlip44,
              grants: current.grants,
              savedGrants: current.savedGrants,
            };
          })
          .toEqual({
            active: expected,
            savedActive: expected,
            readiness: {
              networkStatus: 'idle',
              postLoading: false,
              switchingAccount: false,
            },
            account: stable.account,
            savedAccount: stable.account,
            activeSlip44: 60,
            grants: [],
            savedGrants: [],
          });
        await expect(page.locator('#home-balance')).toBeVisible();
        await expect(trigger()).toBeVisible();
        return assertUnchangedRegistry(stable);
      };
      const focusChoiceWithKeyboard = async (
        menu: Locator,
        choice: Locator
      ) => {
        const id = await choice.getAttribute('id');
        expect(id).toBeTruthy();
        await page.keyboard.press('Home');
        for (let count = 0; count < 40; count += 1) {
          if ((await menu.getAttribute('aria-activedescendant')) === id) break;
          await page.keyboard.press('ArrowDown');
        }
        await expect(menu).toBeFocused();
        await expect(menu).toHaveAttribute('aria-activedescendant', id!);
        // Headless UI scrolls the newly active item on its next animation
        // frame. Wait for that native scroll before inspecting its geometry.
        await expect
          .poll(async () => (await geometry(choice)).contained)
          .toBe(true);
      };
      const activateWithKeyboard = async (menu: Locator, choice: Locator) => {
        await focusChoiceWithKeyboard(menu, choice);
        await page.keyboard.press('Enter');
      };
      await step(
        'verify worker and ordinary import on an unrelated active network',
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
          observations.initial = await publicState(page);
          expect(observations.initial.active).toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
            url: 'https://rpc.tanenbaum.io',
          });
          expect(observations.initial.account).toEqual({
            id: 0,
            type: 'HDAccount',
            address: owner,
          });
          expect(observations.initial.grants).toEqual([]);
          expect(observations.initial.savedGrants).toEqual([]);
          for (const id of IDS)
            expect(observations.initial.live.ethereum[id]).toBeUndefined();
        }
      );
      await step(
        'ordinary Custom RPC header Close leaves public settings unchanged',
        async () => {
          const before = await publicState(page);
          const menu = await openMenu();
          await menu
            .getByRole('menuitem', {
              name: en.networkMenu.customRpc,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          await page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
          expect(await publicState(page)).toEqual(before);
        }
      );
      for (const [index, chainId] of IDS.entries()) {
        await step(
          `register ${chainId} with normal Custom RPC Save`,
          async () => {
            const menu = await openMenu();
            await menu
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
                    await publicState(page)
                  ).saved.ethereum[chainId]?.label
              )
              .toBe(scenario.labels[index]);
            const state = await publicState(page);
            expect(state.live).toEqual(state.saved);
            expect(state.live.ethereum[chainId]).toMatchObject({
              chainId,
              kind: 'ethereum',
              url: `${server.origin}/rpc-${chainId}`,
              label: scenario.labels[index],
              currency: 'eth',
              default: false,
            });
            expect(state.active).toEqual(observations.initial.active);
            observations[`registered-${chainId}`] = state;
          }
        );
      }
      const stable = await publicState(page);
      await step(
        'set the actual Receive viewport without changing wallet identity',
        async () => {
          await page.setViewportSize(scenario.viewport);
          expect(await publicState(page)).toEqual(stable);
        }
      );
      await step(
        'inspect both inactive exact chooser identities and native Escape cancellation',
        async (capture) => {
          const { menu, group } = await evmGroup();
          for (const index of [0, 1]) {
            const choice = targetChoice(group, index);
            await expect(choice).toHaveCount(1);
            await expect(choice).toBeEnabled();
            expect(await choice.getAttribute('aria-current')).not.toBe('true');
            // Native menu navigation exposes the item; never script scrolling
            // to make the geometry or identity observation pass.
            await focusChoiceWithKeyboard(menu, choice);
            const bounds = await geometry(choice);
            expect(bounds.contained).toBe(true);
            expect(bounds.hitPoints).toEqual([true, true, true]);
            observations.chooserIdentities.push({
              chainId: IDS[index],
              identity: await visibleIdentity(choice),
              geometry: bounds,
            });
          }
          // Capture the actual chooser, not a manager row or a manufactured label.
          await capture(page);
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
          await expect(trigger()).toBeFocused();
          expect(await publicState(page)).toEqual(stable);
          observations.menuEscapeCancelled = true;
        }
      );
      for (const method of ['pointer', 'keyboard'] as const) {
        for (const [index, chainId] of IDS.entries()) {
          let receiveRecord: any;
          await step(
            `${method} selects exact chain ${chainId} and retains public account identity`,
            async (capture) => {
              const { menu, group } = await evmGroup();
              const choice = targetChoice(group, index);
              await expect(choice).toHaveCount(1);
              await expect(choice).toBeEnabled();
              if (method === 'pointer') await choice.click();
              else await activateWithKeyboard(menu, choice);
              await expect(menu).toBeHidden();
              const state = await settleCommittedNetwork(
                stable.live.ethereum[chainId],
                stable
              );
              expect(state.active?.chainId).toBe(chainId);
              expect(state.active?.url).toBe(`${server.origin}/rpc-${chainId}`);
              observations.switches.push({ method, chainId, state });
              await capture(page);
            }
          );
          await step(
            `${method} chain ${chainId}: ordinary Home Receive exposes its current context`,
            async (capture) => {
              const receiveButton = page.locator('#receive-btn');
              const homeReceiveReveal = await revealReceiveTarget(
                page,
                receiveButton
              );
              await receiveButton.click();
              await expect(page).toHaveURL(/#\/receive$/);
              await expect(page.locator('#qr-code')).toHaveCount(1);
              await expect(page.locator('#qr-code + div p')).toHaveText(owner);
              await expect(
                page.getByText(en.receive.addressUnavailable, { exact: true })
              ).toHaveCount(0);
              // This context check is not a slow-banner or unavailable-worker case.
              await expect(page.getByRole('status')).toHaveCount(0);
              const copy = page.locator('#copy-address-receive-btn button');
              await expect(copy).toHaveCount(1);
              await expect(copy).toBeEnabled();
              const state = await assertUnchangedRegistry(stable);
              expect(state.active).toEqual(stable.live.ethereum[chainId]);
              expect(state.savedActive).toEqual(stable.live.ethereum[chainId]);
              expect(state.active?.chainId).toBe(chainId);
              expect(state.active?.url).toBe(`${server.origin}/rpc-${chainId}`);
              const pill = page
                .locator('#qr-code')
                .locator('xpath=preceding-sibling::div[1]');
              await expect(pill).toContainText(scenario.labels[index]);
              const reveal = await revealReceiveTarget(page, pill);
              const pillIdentity = await visibleIdentity(pill);
              const headerIdentity = await visibleIdentity(trigger());
              const headerGeometry = await geometry(trigger());
              const headerVisible =
                headerGeometry.contained &&
                headerGeometry.hitPoints.every(Boolean);
              receiveRecord = {
                method,
                chainId,
                state,
                homeReceiveReveal,
                pill: { identity: pillIdentity, reveal },
                header: {
                  identity: headerIdentity,
                  geometry: headerGeometry,
                  visible: headerVisible,
                },
                // Only actual visible context contributes to the comparison.
                // An offscreen header, hidden URL or correct handler is no cue.
                context: {
                  visibleText: JSON.stringify({
                    pill: pillIdentity.dom.text,
                    header: headerVisible ? headerIdentity.dom.text : null,
                  }),
                  accessibleNames: JSON.stringify({
                    pill: pillIdentity.ariaSnapshot,
                    header: headerVisible ? headerIdentity.ariaSnapshot : null,
                  }),
                  readableCues: JSON.stringify({
                    pill: readableIdentity(pillIdentity),
                    header: headerVisible
                      ? readableIdentity(headerIdentity)
                      : null,
                  }),
                },
              };
              observations.receives.push(receiveRecord);
              await capture(page);
            }
          );
          await step(
            `${method} chain ${chainId}: rendered QR encodes the canonical public payment address`,
            async (capture) => {
              const qr = page.locator('#qr-code');
              const reveal = await revealReceiveTarget(page, qr);
              const paths = await page
                .locator('#qr-code svg path')
                .evaluateAll((elements) =>
                  elements.map((element) => element.getAttribute('d'))
                );
              const expectedPaths = qrPaths(owner);
              expect(expectedPaths.length).toBeGreaterThan(0);
              expect(paths).toEqual(expectedPaths);
              await expect(page.locator('#qr-code + div p')).toHaveText(owner);
              receiveRecord.qr = {
                address: owner,
                reveal,
                pathCount: paths.length,
                pathsSha256: createHash('sha256')
                  .update(JSON.stringify(paths))
                  .digest('hex'),
              };
              await assertUnchangedRegistry(stable);
              await capture(page);
            }
          );
          await step(
            `${method} chain ${chainId}: native Copy activation retains exactly the displayed address`,
            async (capture) => {
              const copy = page.locator('#copy-address-receive-btn button');
              await expect(copy).toBeEnabled();
              await focusReceiveCopyWithKeyboard(page, copy);
              const reveal = await revealReceiveTarget(page, copy);
              await expect(copy).toBeFocused();
              const before = await page.evaluate(
                () => (window as any).__receiveIdentityCopies as string[]
              );
              const precedingCopySuccessObservedAt = lastCopySuccessObservedAt;
              if (precedingCopySuccessObservedAt !== undefined) {
                await expect
                  .poll(() => Date.now() - precedingCopySuccessObservedAt)
                  .toBeGreaterThanOrEqual(COPY_SUCCESS_DEDUP_MS);
              }
              const activatedAt = Date.now();
              // The previous toast observation is later than its dedup start,
              // so this is a conservative wait on the existing lifecycle, not
              // a change to toast, clipboard, context, or test timeouts.
              await page.keyboard.press('Enter');
              await expect
                .poll(() =>
                  page.evaluate(
                    () => (window as any).__receiveIdentityCopies as string[]
                  )
                )
                .toEqual([...before, owner]);
              await expect(
                page.getByText(en.home.addressCopied, { exact: true })
              ).toBeVisible();
              lastCopySuccessObservedAt = Date.now();
              await expect(
                page.getByText(en.transactions.copyFailed, { exact: true })
              ).toHaveCount(0);
              receiveRecord.copy = {
                reveal,
                key: 'Enter',
                before,
                after: await page.evaluate(
                  () => (window as any).__receiveIdentityCopies as string[]
                ),
                nativeWriteSucceeded: true,
                precedingCopySuccessObservedAt,
                activatedAt,
                successObservedAt: lastCopySuccessObservedAt,
                successDedupMs: COPY_SUCCESS_DEDUP_MS,
              };
              await assertUnchangedRegistry(stable);
              await capture(page);
            }
          );
          await step(
            `${method} chain ${chainId}: real Receive ${
              method === 'pointer' ? 'Back' : 'Close'
            } preserves public state`,
            async () => {
              const before = await publicState(page);
              const leave = page.getByRole('button', {
                name: method === 'pointer' ? en.buttons.back : en.buttons.close,
                exact: true,
              });
              await expect(leave).toHaveCount(1);
              receiveRecord.leaveReveal = await revealReceiveTarget(
                page,
                leave
              );
              await leave.click();
              await expect(page).toHaveURL(/#\/home$/);
              expect(await publicState(page)).toEqual(before);
              // Wait for the real two-second copy toast to dismiss naturally;
              // it must not cover the next menu or contaminate context images.
              await expect(
                page.getByText(en.home.addressCopied, { exact: true })
              ).toHaveCount(0);
              receiveRecord.leave = method === 'pointer' ? 'Back' : 'Close';
            }
          );
          await step(
            `${method} chain ${chainId}: return normally to the separate active network`,
            async () => {
              const { menu, group } = await evmGroup();
              const original = group.getByRole('menuitem').filter({
                has: page.getByText('Syscoin NEVM Testnet', { exact: true }),
              });
              await expect(original).toHaveCount(1);
              await original.click();
              await expect(menu).toBeHidden();
              await settleCommittedNetwork(stable.active, stable);
            }
          );
        }
      }
      observations.copiesBeforeReload = await page.evaluate(
        () => (window as any).__receiveIdentityCopies as string[]
      );
      expect(observations.copiesBeforeReload).toEqual([
        owner,
        owner,
        owner,
        owner,
      ]);
      await step(
        'reload and retain exact saved registrations and original active account',
        async () => {
          await page.reload();
          await wallet!.waitAppReady();
          await wallet!.ensureOnHome();
          const state = await settleCommittedNetwork(stable.active, stable);
          expect(state.live.ethereum[5]).toEqual(stable.live.ethereum[5]);
          expect(state.live.ethereum[11155111]).toEqual(
            stable.live.ethereum[11155111]
          );
          observations.afterReload = state;
        }
      );
      await step(
        'complete exact target and strict no-signing runtime HTTP audits',
        async () => {
          observations.finalWorkerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.finalWorkerIdentity = value;
            }
          );
          expect(
            observations.switches.map(
              ({ method, chainId }: any) => `${method}:${chainId}`
            )
          ).toEqual([
            'pointer:5',
            'pointer:11155111',
            'keyboard:5',
            'keyboard:11155111',
          ]);
          expect(
            observations.receives.map(
              ({ method, chainId }: any) => `${method}:${chainId}`
            )
          ).toEqual([
            'pointer:5',
            'pointer:11155111',
            'keyboard:5',
            'keyboard:11155111',
          ]);
          for (const receive of observations.receives) {
            expect(receive.qr.address).toBe(owner);
            expect(receive.copy.after.at(-1)).toBe(owner);
            expect(receive.copy.nativeWriteSucceeded).toBe(true);
            expect(receive.state.grants).toEqual([]);
            expect(receive.state.savedGrants).toEqual([]);
          }
          for (const chainId of IDS)
            expect(
              server.reads.some(
                (read) =>
                  read.chainId === chainId && read.method === 'eth_getBalance'
              )
            ).toBe(true);
          await assertUnchangedRegistry(stable);
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
          observations.distinctCounts = ['pointer', 'keyboard'].map(
            (method) => {
              const contexts = observations.receives
                .filter((receive: any) => receive.method === method)
                .map((receive: any) => receive.context);
              expect(contexts).toHaveLength(2);
              return {
                method,
                visibleText: new Set(
                  contexts.map((context: any) => context.visibleText)
                ).size,
                accessibleNames: new Set(
                  contexts.map((context: any) => context.accessibleNames)
                ).size,
                readableCues: new Set(
                  contexts.map((context: any) => context.readableCues)
                ).size,
              };
            }
          );
          await info.attach('receive-network-identity-before-assertion', {
            contentType: 'application/json',
            body: JSON.stringify(evidence(), null, 2),
          });
        }
      );
      await step(
        'require distinguishable visible and accessible Receive context after all controls',
        async () => {
          // Equal public addresses across these EVM chains are expected. The
          // regression concerns network context only, after exact switches,
          // native Copy/QR, real Back/Close/Escape, reload and every fence.
          expect(observations.distinctCounts).toEqual([
            {
              method: 'pointer',
              visibleText: 2,
              accessibleNames: 2,
              readableCues: 2,
            },
            {
              method: 'keyboard',
              visibleText: 2,
              accessibleNames: 2,
              readableCues: 2,
            },
          ]);
        }
      );
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        await info.attach('receive-network-identity-final', {
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
