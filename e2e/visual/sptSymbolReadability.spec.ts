import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
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
import {
  fixtureRead,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Normal-UI symbol readability regression. The same synthetic
// asset has a short or source-valid 32-ASCII symbol in separate fresh profiles:
// the real background metadata cache lasts 24 hours. No cache/state/controller,
// focus/scroll setter, import, signature or broadcast operation is substituted.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const GUID = '223456';
const LONG = 'W'.repeat(32);
const NETWORK = 'Syscoin Testnet';
const RPC = 'https://rpc.tanenbaum.io';
const keyOf = (url: URL) => {
  const query = new URLSearchParams(url.search);
  query.sort();
  return url.origin + url.pathname + (query.size ? '?' + query : '');
};
const sha = (file: string) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Public projections only. Never serialize the raw vault, credentials or seed.
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

// Exact reviewed physical proxy check: this is Node-owned GET/CONNECT traffic,
// not a fabricated Playwright route result. The fixture never forwards traffic.
async function physicalDenial(
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
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

async function settle(page: Page, header: Locator) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))
    );
  });
  await expect
    .poll(() =>
      header.evaluate((element) => {
        for (
          let current: Element | null = element;
          current;
          current = current.parentElement
        )
          if (
            current
              .getAnimations()
              .some(
                (animation) =>
                  animation.playState === 'running' || animation.pending
              )
          )
            return false;
        return true;
      })
    )
    .toBe(true);
}

// Normal wheel input only, inside the actual owner, to reveal the header's two
// lines vertically. Horizontal clipping is deliberately not scrolled away.
async function revealHeader(page: Page, header: Locator, pane: Locator) {
  for (let gesture = 0; gesture < 8; gesture++) {
    const geometry = await header.evaluate((element) => {
      const owner = element.closest(
        '[data-navigation-scroll="asset-details"]'
      )!;
      const box = element.getBoundingClientRect(),
        parent = owner.getBoundingClientRect();
      const top = Math.max(0, parent.top + owner.clientTop),
        bottom = Math.min(
          innerHeight,
          parent.top + owner.clientTop + owner.clientHeight
        );
      const x = Math.max(
        8,
        Math.min(
          innerWidth - 8,
          parent.left + owner.clientLeft + owner.clientWidth / 2
        )
      );
      const y = Math.max(top + 4, Math.min(bottom - 4, (top + bottom) / 2));
      const hit = document.elementFromPoint(x, y);
      return {
        revealed: box.top >= top + 4 && box.bottom <= bottom - 4,
        fits: box.height <= bottom - top - 8,
        delta:
          box.top < top + 4 ? box.top - top - 12 : box.bottom - bottom + 12,
        x,
        y,
        ownerHit: !!hit && (hit === owner || owner.contains(hit)),
        scrollTop: owner.scrollTop,
      };
    });
    if (geometry.revealed) return;
    expect(
      geometry.fits,
      'healthy vertical header can fit its real scroll owner'
    ).toBe(true);
    expect(
      geometry.ownerHit,
      'physical wheel point belongs to the real pane'
    ).toBe(true);
    await page.mouse.move(geometry.x, geometry.y);
    await page.mouse.wheel(0, geometry.delta);
    await expect
      .poll(() => pane.evaluate((element) => element.scrollTop))
      .not.toBe(geometry.scrollTop);
  }
  throw new Error(
    'Header could not be physically revealed within eight ordinary wheel gestures'
  );
}

const glyphGeometry = (header: Locator) =>
  header.evaluate((element) => {
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let owner: Element | null = element;
      owner;
      owner = owner.parentElement
    ) {
      const css = getComputedStyle(owner),
        box = owner.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, box.left + owner.clientLeft);
        clip.right = Math.min(
          clip.right,
          box.left + owner.clientLeft + owner.clientWidth
        );
      }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, box.top + owner.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          box.top + owner.clientTop + owner.clientHeight
        );
      }
    }
    const lines = Array.from(element.children).map((span) => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const glyphs: {
        box: object;
        centerHit: boolean;
        char: string;
        collapsedWhitespace: boolean;
        painted: boolean;
      }[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < (node.textContent || '').length; index++) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const box = range.getBoundingClientRect();
          const x = (box.left + box.right) / 2,
            y = (box.top + box.bottom) / 2;
          const target = document.elementFromPoint(x, y);
          const centerHit =
            !!target && (target === span || span.contains(target));
          const char = (node.textContent || '')[index];
          // A normal line break can collapse an ASCII space to zero width.
          // Retain the same clip/hit gates and require width for visible glyphs.
          const collapsedWhitespace =
            char === ' ' &&
            box.width === 0 &&
            getComputedStyle(span).whiteSpace === 'normal';
          glyphs.push({
            char,
            box: box.toJSON(),
            centerHit,
            collapsedWhitespace,
            painted:
              (box.width > 0 || collapsedWhitespace) &&
              box.height > 0 &&
              box.left >= clip.left - 0.5 &&
              box.right <= clip.right + 0.5 &&
              box.top >= clip.top - 0.5 &&
              box.bottom <= clip.bottom + 0.5 &&
              centerHit,
          });
        }
      }
      const css = getComputedStyle(span);
      return {
        text: span.textContent || '',
        box: span.getBoundingClientRect().toJSON(),
        glyphs,
        allGlyphsPainted:
          glyphs.length > 0 && glyphs.every((glyph) => glyph.painted),
        style: {
          font: css.font,
          lineHeight: css.lineHeight,
          overflowWrap: css.overflowWrap,
          wordBreak: css.wordBreak,
          textOverflow: css.textOverflow,
        },
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: element.getBoundingClientRect().toJSON(),
      clip,
      lines,
      allGlyphsPainted:
        lines.length === 2 && lines.every((line) => line.allGlyphsPainted),
      body: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
    };
  });

// Unlike the original header control, a wrapped Balance row can be below the
// physical viewport. Wheel inside its real pane, allowing native bubbling to
// the actual scrollable ancestor; observe all ancestor offsets, never set them.
async function revealBalance(page: Page, row: Locator) {
  for (let gesture = 0; gesture < 8; gesture++) {
    const state = await row.evaluate((element) => {
      const pane = element.closest('[data-navigation-scroll="asset-details"]')!;
      const box = element.getBoundingClientRect(),
        parent = pane.getBoundingClientRect();
      const clip = { top: 0, bottom: innerHeight };
      const offsets: number[] = [];
      for (
        let owner: Element | null = element.parentElement;
        owner;
        owner = owner.parentElement
      ) {
        offsets.push(owner.scrollTop);
        if (
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(owner).overflowY)
        ) {
          const bounds = owner.getBoundingClientRect();
          clip.top = Math.max(clip.top, bounds.top + owner.clientTop);
          clip.bottom = Math.min(
            clip.bottom,
            bounds.top + owner.clientTop + owner.clientHeight
          );
        }
      }
      offsets.push(scrollY);
      const x = Math.max(
        8,
        Math.min(
          innerWidth - 8,
          parent.left + pane.clientLeft + pane.clientWidth / 2
        )
      );
      const y =
        (Math.max(clip.top, parent.top) +
          Math.min(clip.bottom, parent.bottom)) /
        2;
      const hit = document.elementFromPoint(x, y);
      return {
        revealed: box.top >= clip.top + 4 && box.bottom <= clip.bottom - 4,
        fits: box.height <= clip.bottom - clip.top - 8,
        delta:
          box.top < clip.top + 4
            ? box.top - clip.top - 12
            : box.bottom - clip.bottom + 12,
        x,
        y,
        offsets,
        ownerHit: !!hit && (hit === pane || pane.contains(hit)),
      };
    });
    if (state.revealed) return;
    expect(state.fits, 'Balance row can fit its effective vertical clip').toBe(
      true
    );
    expect(
      state.ownerHit,
      'Balance wheel point belongs to the actual pane'
    ).toBe(true);
    await page.mouse.move(state.x, state.y);
    await page.mouse.wheel(0, state.delta);
    await expect
      .poll(() =>
        row.evaluate((element) => {
          const offsets: number[] = [];
          for (
            let owner: Element | null = element.parentElement;
            owner;
            owner = owner.parentElement
          )
            offsets.push(owner.scrollTop);
          offsets.push(scrollY);
          return offsets;
        })
      )
      .not.toEqual(state.offsets);
  }
  throw new Error(
    'Balance row could not be revealed within eight normal wheel gestures'
  );
}

test('ordinary SPT preview preserves source-valid symbol readability', async ({}, info) => {
  test.setTimeout(180_000); // Existing bounded tokenImportTabSelection carrier budget.
  expect(process.version).toBe('v26.12.1');
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence(),
    sourceSha256 = sha(info.file),
    previous = { ...E2E_CONFIG };
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const observations: Record<string, any>[] = [];
  const profileDirs: string[] = [];
  try {
    for (const [label, symbol] of [
      ['short', 'TSPT'],
      ['long32', LONG],
    ] as const) {
      const fixture = createIsolatedVaultFixture(),
        server = await startUtxoFixtureServer();
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
      const reads: string[] = [],
        unsupported: unknown[] = [],
        writes: string[] = [],
        pageErrors: string[] = [];
      const row: Record<string, any> = {
        label,
        symbol,
        states: [],
        runtime,
        sourceSha256,
      };
      observations.push(row);
      const replies = new Map<string, unknown>();
      const add = (url: string, body: unknown) =>
        replies.set(keyOf(new URL(url)), body);
      for (const url of [
        'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
        'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
        'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
        'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
      ])
        add(url, []);
      add(
        'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
        { blacklist: [], whitelist: [], fuzzylist: [] }
      );
      add(
        'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
        {
          // eslint-disable-next-line camelcase -- Canonical CoinGecko wire field.
          syscoin: { usd: 0.125, usd_24h_change: 0 },
        }
      );
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
      // Fixed source-backed account requests: Pali's balances/assets/history,
      // rapid basic poll and the keyring's next-address scan, not arbitrary query
      // keys or identifiers. No Send/fee/UTXO/transaction endpoint is admitted.
      const queries = [
        'details=tokenBalances&tokens=used',
        'details=tokenBalances&tokens=nonzero',
        'details=txsummary&pageSize=30',
        'details=txslight&pageSize=30',
        'details=basic&pageSize=0',
        'details=tokens&tokens=used',
      ];
      for (const query of queries) {
        add(
          'https://blockbook.syscoin.org/api/v2/xpub/' +
            initialXpub +
            '?' +
            query,
          emptyInventory
        );
        for (const origin of [
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ]) {
          const url =
            origin + '/api/v2/xpub/' + fixture.utxo.userXpub + '?' + query;
          const body = fixtureRead(fixture.utxo, url, 'GET') as object;
          expect(body).toBeDefined();
          add(url, { ...body, tokensAsset: [] });
        }
      }
      for (const origin of [
        'https://blockbook.syscoin.org',
        'https://blockbook-dev.syscoin.org',
      ])
        add(origin + '/api/v2/tickers/currency', {
          ts: 1,
          rates: { usd: 1, eur: 0.2 },
        });
      // JSON metadata follows Blockbook's bridge ERC20 shape (precision8).
      // This is not evidence that this synthetic asset exists on a live chain.
      const metadata = {
        assetGuid: GUID,
        symbol,
        name: 'Synthetic symbol readability control',
        type: 'SPTAllocated',
        assetType: 'ERC20',
        contract: '0x1111111111111111111111111111111111111111',
        originDecimals: 18,
        decimals: 8,
        maxSupply: '0',
        balance: '0',
        totalReceived: '0',
        totalSent: '0',
        transfers: 0,
      };
      for (const origin of [
        'https://blockbook-dev.syscoin.org',
        'https://explorer-blockbook-dev.syscoin.org',
      ]) {
        add(
          origin + '/api/v2/',
          fixtureRead(fixture.utxo, origin + '/api/v2/', 'GET')
        );
        add(
          origin + '/api/v2',
          fixtureRead(fixture.utxo, origin + '/api/v2', 'GET')
        );
        add(origin + '/api/v2/asset/' + GUID + '?details=basic', {
          asset: metadata,
        });
      }
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'SptSymbolSyntheticOnly!2026',
        chainId: 5700,
        networkLabel: NETWORK,
        rpcUrl: server.url,
      });
      let wallet: PaliWallet | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      try {
        row.physicalCanaries = [
          await physicalDenial(server, 'GET'),
          await physicalDenial(server, 'CONNECT'),
        ];
        wallet = await PaliWallet.launch('spt-symbol-' + label, {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        });
        expect(profileDirs).not.toContain(wallet.profileDir);
        profileDirs.push(wallet.profileDir);
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url,
          (url) => replies.get(keyOf(url))
        );
        wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
        wallet.context.on('page', (page) =>
          page.on('pageerror', (error) => pageErrors.push(error.message))
        );
        // Shadow the shared method-only EVM fallback. Unknown HTTP/RPC always
        // aborts and remains a hard guard failure, never an empty healthy reply.
        await wallet.context.route('**/*', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (!['http:', 'https:'].includes(url.protocol))
            return route.fallback();
          let payload: any;
          try {
            payload = request.postDataJSON();
          } catch {
            /* Ordinary GET. */
          }
          const calls = Array.isArray(payload) ? payload : [payload];
          for (const call of calls)
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              writes.push(call.method);
          if (/\/sendtx(?:\/|$)/i.test(url.pathname)) writes.push('sendtx');
          if (
            request.method() === 'GET' &&
            !url.username &&
            !url.password &&
            !url.hash &&
            replies.has(keyOf(url))
          ) {
            reads.push('GET ' + keyOf(url));
            return route.fallback();
          }
          const valid =
            request.method() === 'POST' &&
            url.origin === RPC &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash &&
            !url.username &&
            !url.password &&
            calls.length > 0 &&
            calls.every(
              (call) =>
                call &&
                typeof call === 'object' &&
                !Array.isArray(call) &&
                call.jsonrpc === '2.0' &&
                Number.isSafeInteger(call.id) &&
                call.id >= 0 &&
                Object.keys(call).every((key) =>
                  ['id', 'jsonrpc', 'method', 'params'].includes(key)
                ) &&
                call.method === 'eth_chainId' &&
                Array.isArray(call.params) &&
                call.params.length === 0
            );
          if (valid) {
            reads.push(...calls.map(() => 'RPC eth_chainId []'));
            const values = calls.map((call) => ({
              jsonrpc: '2.0',
              id: call.id,
              result: '0x1644',
            }));
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(payload) ? values : values[0]),
            });
          }
          unsupported.push({
            method: request.method(),
            origin: url.origin,
            path: url.pathname,
            query: url.search,
            rpcMethods: calls.map((call) =>
              typeof call?.method === 'string' ? call.method : null
            ),
          });
          return route.abort('blockedbyclient');
        });
        row.workerBefore = await verifyExecutingWorker(
          wallet.context,
          wallet.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            row.workerBefore = value;
          }
        );
        const page = wallet.page;
        await wallet.step(
          label + ' onboard and select the ordinary default UTXO network',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork(NETWORK, 'UTXO');
            await wallet!.ensureOnHome();
            await expect(page.locator('#home-balance')).toHaveText('0.001');
            await expect
              .poll(async () => {
                const value = await publicScope(page);
                return (
                  value.ready &&
                  value.slip44 === 1 &&
                  value.network?.kind === 'syscoin' &&
                  value.network?.chainId === 5700 &&
                  JSON.stringify(value.active) ===
                    JSON.stringify(value.savedActive) &&
                  JSON.stringify(value.network) ===
                    JSON.stringify(value.savedNetwork) &&
                  JSON.stringify(value.liveAccounts) ===
                    JSON.stringify(value.savedAccounts) &&
                  JSON.stringify(value.liveAssets) ===
                    JSON.stringify(value.savedAssets) &&
                  JSON.stringify(value.liveNetworks) ===
                    JSON.stringify(value.savedNetworks)
                );
              })
              .toBe(true);
            row.baseline = await publicScope(page);
            expect(row.baseline.liveGrants).toEqual([]);
            expect(row.baseline.savedGrants).toEqual([]);
            expect(
              row.baseline.liveAssets
                .flatMap((asset: any) => asset.values)
                .some((asset: any) => String(asset.assetGuid) === GUID)
            ).toBe(false);
          }
        );
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          await wallet.step(
            `${label} ${viewport.width}x${viewport.height} genuine ordinary GUID preview`,
            async () => {
              await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
              await page.locator('#assets-btn').click();
              await page
                .getByRole('button', { name: en.home.importToken, exact: true })
                .click();
              const custom = page.getByRole('button', {
                name: en.tokens.addCustomTab,
                exact: true,
              });
              await expect(custom).toHaveCount(1);
              await custom.click();
              const input = page.locator('#custom-spt-guid');
              await input.fill(GUID);
              const details = page.getByRole('button', {
                name: `View details for ${symbol} token`,
                exact: true,
              });
              await expect(details).toHaveCount(1);
              await expect(details).toBeEnabled();
              await expect(
                page.getByRole('button', {
                  name: `Import ${symbol} token`,
                  exact: true,
                })
              ).toBeEnabled();
              await details.click();
              await expect(page).toHaveURL(/#\/home\/details(?:\?.*)?$/);
              const context = page.getByText(`${symbol} (${NETWORK})`, {
                exact: true,
              });
              await expect(context).toHaveCount(1);
              const header = context.locator('..'),
                pane = page.locator('[data-navigation-scroll="asset-details"]');
              await expect(header.locator(':scope > span')).toHaveCount(2);
              await expect(header.locator(':scope > span').nth(0)).toHaveText(
                symbol
              );
              await settle(page, header);
              await revealHeader(page, header, pane);
              await settle(page, header);
              const geometry = await glyphGeometry(header);
              const screenshot = path.join(
                E2E_CONFIG.artifactsDir,
                'screenshots',
                `spt-symbol-${label}-${viewport.width}x${viewport.height}-actual-header.png`
              );
              fs.mkdirSync(path.dirname(screenshot), { recursive: true });
              await page.screenshot({ path: screenshot, fullPage: false });
              row.states.push({ ...geometry, screenshot });
              // The short producer is the hard control; do not reinterpret a
              // vertical/font/fixture failure here as a long-symbol product bug.
              if (label === 'short')
                expect(geometry.allGlyphsPainted).toBe(true);
              const balanceLabel = page.getByText(en.send.balance, {
                exact: true,
              });
              await expect(balanceLabel).toHaveCount(1);
              const balanceRow = balanceLabel.locator('..');
              expect(
                await balanceRow.evaluate((element) => element.tagName)
              ).toBe('LI');
              await expect(balanceRow.locator(':scope > p')).toHaveCount(2);
              const value = balanceRow.locator(':scope > p').nth(1);
              await expect(value.locator(':scope > span')).toHaveCount(2);
              await expect(
                value.locator(':scope > span').nth(0)
              ).toHaveAttribute('title', '0');
              await revealBalance(page, balanceRow);
              await settle(page, balanceRow);
              const rowGeometry = await glyphGeometry(balanceRow),
                valueGeometry = await glyphGeometry(value);
              const labelRight = Math.max(
                ...rowGeometry.lines[0].glyphs.map(
                  (glyph: any) => glyph.box.right
                )
              );
              const valueLeft = Math.min(
                ...valueGeometry.lines.flatMap((line) =>
                  line.glyphs.map((glyph: any) => glyph.box.left)
                )
              );
              const amountRight = Math.max(
                ...valueGeometry.lines[0].glyphs.map(
                  (glyph: any) => glyph.box.right
                )
              );
              const symbolLeft = Math.min(
                ...valueGeometry.lines[1].glyphs.map(
                  (glyph: any) => glyph.box.left
                )
              );
              const balance = {
                row: rowGeometry,
                value: valueGeometry,
                labelValueGap: valueLeft - labelRight,
                amountSymbolGap: symbolLeft - amountRight,
                allGlyphsPainted:
                  rowGeometry.allGlyphsPainted &&
                  valueGeometry.allGlyphsPainted,
              };
              expect(valueGeometry.lines.map((line) => line.text)).toEqual([
                '0',
                symbol,
              ]);
              if (label === 'short') {
                expect(balance.allGlyphsPainted).toBe(true);
                expect(balance.labelValueGap).toBeGreaterThanOrEqual(11.5);
                expect(balance.amountSymbolGap).toBeGreaterThanOrEqual(5.5);
              }
              const balanceScreenshot = path.join(
                E2E_CONFIG.artifactsDir,
                'screenshots',
                `spt-symbol-${label}-${viewport.width}x${viewport.height}-actual-balance.png`
              );
              await page.screenshot({
                path: balanceScreenshot,
                fullPage: false,
              });
              Object.assign(row.states[row.states.length - 1], {
                balance,
                balanceScreenshot,
              });
              expect(await publicScope(page)).toEqual(row.baseline);
              const close = page
                .getByRole('button', { name: en.buttons.close, exact: true })
                .filter({ hasText: en.buttons.close });
              await expect(close).toHaveCount(1);
              await close.click();
              await expect(page).toHaveURL(/#\/tokens\/add(?:\?.*)?$/);
              await expect(input).toHaveValue(GUID);
              const leave = page.getByRole('button', {
                name: en.buttons.close,
                exact: true,
              });
              await expect(leave).toHaveCount(1);
              await leave.click();
              await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
              expect(await publicScope(page)).toEqual(row.baseline);
            }
          );
        }
        row.workerAfter = await verifyExecutingWorker(
          wallet.context,
          wallet.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            row.workerAfter = value;
          }
        );
        expect(unsupported).toEqual([]);
        expect(writes).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
        expect(
          server.blocked.every(
            (method) => method === 'GET' || method === 'CONNECT'
          )
        ).toBe(true);
        expect(
          reads.filter((read) =>
            read.includes('/api/v2/asset/' + GUID + '?details=basic')
          )
        ).toHaveLength(1);
        expect(await publicScope(page)).toEqual(row.baseline);
        expect(extensionEvidence()).toEqual(runtime);
        expect(sha(info.file)).toBe(sourceSha256);
        expect(row.states).toHaveLength(2);
        if (label === 'long32') {
          // Candidate deliberately last: all healthy journeys, native Close,
          // exact public durable scope, strict wire and actual worker checks ran.
          await wallet.step(
            'long32 candidate only after both session controls and all safety guards',
            async () => {
              expect(observations).toHaveLength(2);
              expect(
                observations[0].states.every(
                  (state: any) => state.allGlyphsPainted
                )
              ).toBe(true);
              for (const state of row.states) {
                expect(
                  state.allGlyphsPainted,
                  `${state.viewport.width}: complete symbol and network-context glyph paint`
                ).toBe(true);
                expect(
                  state.balance.allGlyphsPainted,
                  `${state.viewport.width}: complete Balance label, exact amount and symbol glyph paint`
                ).toBe(true);
                expect(
                  state.balance.labelValueGap,
                  `${state.viewport.width}: visible label/value separation`
                ).toBeGreaterThanOrEqual(11.5);
                expect(
                  state.balance.amountSymbolGap,
                  `${state.viewport.width}: amount/symbol spacing`
                ).toBeGreaterThanOrEqual(5.5);
              }
            }
          );
        }
        status = 'passed';
      } finally {
        row.status = status;
        row.reads = reads;
        row.unsupported = unsupported;
        row.writes = writes;
        row.pageErrors = pageErrors;
        row.deniedWrites = routes?.deniedWrites || [];
        row.proxyDeniedMethods = server.blocked.slice();
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
        }
      }
    }
  } finally {
    try {
      await info.attach('spt-symbol-readability-evidence', {
        body: JSON.stringify(
          {
            runtime,
            sourceSha256,
            observations,
            syntheticHttpOnly: true,
            controllerOrStateReplaced: false,
            assetImportActivated: false,
            signaturesOrBroadcastsRequested: false,
            separateFreshProfiles:
              profileDirs.length === 2 && profileDirs[0] !== profileDirs[1],
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } finally {
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
