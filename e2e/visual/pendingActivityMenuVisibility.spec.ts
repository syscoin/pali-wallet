import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
import { E2E_CONFIG } from '../harness/config';
import { createIsolatedVaultFixture } from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Public synthetic HTTP rows enter the real ordinary history pipeline;
// no transaction is created, signed, broadcast or replaced by this probe.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RPC = 'https://rpc.tanenbaum.io/';
const API = 'https://explorer.tanenbaum.io/api';
const PENDING_HASH = '0x' + 'ac'.repeat(32);
const CONFIRMED_HASH = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + '44'.repeat(20);
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
]);

// As in the existing transactionGasDisplay fixture, both checks connect only
// to the run-owned loopback deny proxy. No .invalid host is resolved/contacted.
const proxyDenial = async (
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) => {
  const proxy = new URL(server.url);
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
  const before = server.blocked.length;
  const target =
    method === 'GET'
      ? 'http://pending-menu-denied.invalid/'
      : 'pending-menu-denied.invalid:443';
  const result = await new Promise<{
    body: string;
    connectionClosed: boolean;
    statusCode: number;
  }>((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0);
    let ended = false;
    let settled = false;
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
    socket.once('connect', () => {
      socket.write(
        `${method} ${target} HTTP/1.0\r\nHost: pending-menu-denied.invalid\r\nConnection: close\r\n\r\n`
      );
    });
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Unexpectedly large denial response'));
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
        const text = bytes.toString('utf8');
        const separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        const header = text.slice(0, separator);
        expect(header.split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(header).toMatch(/\r\nConnection: close(?:\r\n|$)/i);
        const body = text.slice(separator + 4);
        expect(body).toBe(method === 'GET' ? 'Offline fixture only' : '');
        resolve({ statusCode: 403, body, connectionClosed: true });
      } catch (error) {
        reject(error);
      }
    });
  });
  const blockedDelta = server.blocked.slice(before);
  expect(blockedDelta).toEqual([method]);
  return { method, ...result, blockedDelta };
};

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state', 'language']);
    const saved = disk[key];
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
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
        );
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, families]: [string, any]) => ({
            kind,
            id: Number(id),
            ethereum: families?.ethereum || [],
            syscoin: families?.syscoin || [],
            nfts: families?.nfts || [],
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const active = state.vault.activeAccount;
    const history =
      state.vault.accountTransactions[active.type]?.[active.id]?.ethereum?.[
        state.vault.activeNetwork.chainId
      ] || [];
    return {
      active,
      savedActive: saved?.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
        apiUrl: state.vault.activeNetwork.apiUrl,
      },
      language: disk.language || 'en',
      liveCurrency: state.price.fiat.asset,
      savedCurrency: disk.state?.price?.fiat?.asset,
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(saved),
      liveAssets: assets(state.vault),
      savedAssets: assets(saved),
      grants: Object.keys(state.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
      history: history
        .map((row: any) => ({
          hash: row.hash,
          from: row.from?.toLowerCase(),
          to: row.to?.toLowerCase(),
          value: String(row.value),
          nonce: row.nonce,
          chainId: row.chainId,
          blockNumber: row.blockNumber ?? null,
          historySource: row.historySource,
        }))
        .sort((a: any, b: any) => a.hash.localeCompare(b.hash)),
    };
  });

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 56; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};
const activeItem = async (menu: Locator, item: Locator) =>
  (await menu.getAttribute('aria-activedescendant')) ===
  (await item.getAttribute('id'));

const measureMenu = (menu: Locator) =>
  menu.evaluate((root) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const ancestors: any[] = [];
    for (
      let node: Element | null = root.parentElement;
      node;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      ancestors.push({
        tag: node.tagName,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        box: box(node),
      });
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, r.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          r.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, r.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          r.top + node.clientTop + node.clientHeight
        );
      }
    }
    const text = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        }));
    };
    const tolerance = 0.5;
    const items = Array.from(root.querySelectorAll('[role="menuitem"]')).map(
      (item) => {
        const label = item.querySelector('span');
        const icon = item.querySelector('svg,img');
        const bounds = box(item);
        const ranges = label ? text(label) : [];
        const points = [
          [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
          [bounds.left + 2, bounds.top + bounds.height / 2],
          [bounds.right - 2, bounds.top + bounds.height / 2],
        ].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return {
            x,
            y,
            reachesItem: !!hit && (hit === item || item.contains(hit)),
          };
        });
        return {
          name: item.textContent?.trim(),
          tag: item.tagName,
          box: bounds,
          textRanges: ranges,
          icon: icon ? box(icon) : null,
          points,
          noHorizontalTextClip:
            ranges.length > 0 &&
            ranges.every(
              (r) =>
                r.left >= clip.left - tolerance &&
                r.right <= clip.right + tolerance
            ),
        };
      }
    );
    const heading = root.querySelector('h1');
    const headingRanges = heading ? text(heading) : [];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      fontStatus: document.fonts.status,
      root: box(root),
      clip,
      ancestors,
      heading: heading?.textContent,
      headingRanges,
      items,
      noHorizontalTextClip:
        headingRanges.length > 0 &&
        headingRanges.every(
          (r) =>
            r.left >= clip.left - tolerance && r.right <= clip.right + tolerance
        ) &&
        items.every((item) => item.noHorizontalTextClip),
    };
  });

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`pending Activity options remain readable with ordinary pointer and keyboard use at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    expect(process.version).toBe('v23.11.1');
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(typeof runtime.version).toBe('string');
    expect(runtime.version).toBe(packageJson.version);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const owner = fixture.evmAddresses[0].toLowerCase();
    const owners = fixture.evmAddresses.map((value) => value.toLowerCase());
    const mainnet = getNetworkConfig(57, 'sys');
    const signer = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      mainnet.networks,
      57,
      mainnet.types.zPubType,
      84
    );
    const initialXpub = signer.getAccountXpub();
    const initialQueries = new Set([
      'details=tokenBalances&tokens=used',
      'details=tokenBalances&tokens=nonzero',
      'details=txsummary&pageSize=30',
      'details=txslight&pageSize=30',
    ]);
    const codeTargets = new Set([
      ...owners,
      ...getPaliInfrastructureContracts(5700).map((value) =>
        value.address.toLowerCase()
      ),
      PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase(),
      PALI_MULTICALL3_CANONICAL_ADDRESS.toLowerCase(),
    ]);
    const timestamp = Math.floor(Date.now() / 1000);
    const confirmed = {
      hash: CONFIRMED_HASH,
      from: OTHER,
      to: owner,
      value: '1000000000000000000',
      input: '0x',
      nonce: '8',
      blockNumber: '100',
      blockHash: '0x' + 'bd'.repeat(32),
      timeStamp: String(timestamp - 60),
      confirmations: '1',
      type: '2',
      gas: '21000',
      gasUsed: '21000',
      gasPrice: '1000000000',
      isError: '0',
      // eslint-disable-next-line camelcase -- Explorer wire field.
      txreceipt_status: '1',
    };
    const pending = {
      ...confirmed,
      hash: PENDING_HASH,
      from: owner,
      to: OTHER,
      value: '250000000000000000',
      nonce: '9',
      blockNumber: null,
      blockHash: null,
      timeStamp: String(timestamp),
      confirmations: '0',
      gasUsed: null,
    };
    const rpcReads: any[] = [],
      httpReads: any[] = [],
      unsupported: any[] = [];
    const forbidden: string[] = [],
      unknownHttpFailures: any[] = [],
      pageErrors: string[] = [];
    const denialCanaries: any[] = [];
    const observations: Record<string, any> = {
      runtime,
      sourceSha256,
      viewport,
      menus: [],
    };
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let baseline!: Awaited<ReturnType<typeof publicState>>;
    const server = await startUtxoFixtureServer();
    try {
      expect(server.blocked).toEqual([]);
      denialCanaries.push(await proxyDenial(server, 'GET'));
      denialCanaries.push(await proxyDenial(server, 'CONNECT'));
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'PendingMenuSynthetic!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: 'Syscoin NEVM Testnet',
      });
      // Both cases have their own fresh profile. Onboarding uses the normal
      // toolbar geometry; only the actual settled Activity view is resized.
      wallet = await PaliWallet.launch(
        `pending-activity-menu-${viewport.width}x${viewport.height}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      await wallet.context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol))
          return route.continue();
        if (url.username || url.password || url.hash) {
          unsupported.push({ kind: 'http-url', url: url.href });
          return route.abort('blockedbyclient');
        }
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* GET/static input. */
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        if (
          /\/sendtx(?:\/|$)/i.test(url.pathname) ||
          calls.some((call) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          forbidden.push('attempted-write:' + url.href);
          return route.abort('blockedbyclient');
        }
        if (url.href === RPC) {
          if (
            request.method() !== 'POST' ||
            !calls.length ||
            calls.length > 20
          ) {
            unsupported.push({
              kind: 'rpc-method-envelope',
              method: request.method(),
            });
            return route.abort('blockedbyclient');
          }
          const replies = calls.map((call: any) => {
            if (
              !call ||
              call.jsonrpc !== '2.0' ||
              !Array.isArray(call.params) ||
              !['number', 'string'].includes(typeof call.id)
            ) {
              unsupported.push({ kind: 'rpc-envelope' });
              return undefined;
            }
            const params = call.params;
            let result: unknown;
            if (params.length === 0) {
              if (call.method === 'eth_chainId') result = '0x1644';
              if (call.method === 'net_version') result = '5700';
              if (call.method === 'eth_blockNumber') result = '0x64';
              if (
                ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(
                  call.method
                )
              )
                result = '0x3b9aca00';
            }
            if (
              ['eth_getBalance', 'eth_getTransactionCount'].includes(
                call.method
              ) &&
              params.length === 2 &&
              owners.includes(String(params[0]).toLowerCase()) &&
              ['latest', 'pending'].includes(params[1])
            ) {
              result =
                call.method === 'eth_getBalance'
                  ? '0xde0b6b3a7640000'
                  : String(params[0]).toLowerCase() === owner
                  ? '0x9'
                  : '0x0';
            }
            if (
              call.method === 'eth_getCode' &&
              params.length === 2 &&
              params[1] === 'latest' &&
              codeTargets.has(String(params[0]).toLowerCase())
            )
              result = '0x';
            if (
              call.method === 'eth_getBlockByNumber' &&
              params.length === 2 &&
              ['latest', 'pending', '0x64'].includes(params[0]) &&
              params[1] === false
            ) {
              result = {
                number: '0x64',
                hash: confirmed.blockHash,
                parentHash: '0x' + 'bc'.repeat(32),
                nonce: '0x0000000000000000',
                timestamp: '0x' + timestamp.toString(16),
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x5208',
                miner: '0x' + '00'.repeat(20),
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
            }
            if (result === undefined) {
              unsupported.push({
                kind: 'rpc-read',
                method: call.method,
                params,
              });
              return undefined;
            }
            rpcReads.push({ method: call.method, params });
            return { jsonrpc: '2.0', id: call.id, result };
          });
          if (replies.some((reply: any) => reply === undefined))
            return route.abort('blockedbyclient');
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
          });
        }
        if (request.method() !== 'GET') {
          unsupported.push({
            kind: 'http-method',
            method: request.method(),
            url: url.href,
          });
          return route.abort('blockedbyclient');
        }
        let body: unknown;
        if (feeds.has(url.href)) body = feeds.get(url.href);
        if (
          url.href === 'https://blockbook.syscoin.org/api/v2/tickers/currency'
        )
          body = { ts: 1, rates: { usd: 1 } };
        if (
          url.origin === 'https://blockbook.syscoin.org' &&
          url.pathname === '/api/v2/xpub/' + initialXpub &&
          initialQueries.has(url.searchParams.toString())
        )
          body = {
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
        const exactKeys = (keys: string[]) =>
          [...url.searchParams.keys()].length === keys.length &&
          keys.every((key) => url.searchParams.getAll(key).length === 1);
        if (
          url.origin === 'https://api.coingecko.com' &&
          url.pathname === '/api/v3/simple/price' &&
          exactKeys(['ids', 'vs_currencies', 'include_24hr_change']) &&
          url.searchParams.get('ids') === 'syscoin' &&
          url.searchParams.get('vs_currencies') === 'usd' &&
          url.searchParams.get('include_24hr_change') === 'true'
        )
          body = { syscoin: { usd: 1, ['usd_24h_change']: 0 } };
        if (
          url.origin === 'https://explorer.tanenbaum.io' &&
          url.pathname === '/api'
        ) {
          const action = url.searchParams.get('action') || '';
          const address = (url.searchParams.get('address') || '').toLowerCase();
          const pendingAction = action === 'pendingtxlist';
          const paged = url.searchParams.has('page');
          if (
            ['txlist', 'tokentx', 'pendingtxlist'].includes(action) &&
            owners.includes(address) &&
            url.searchParams.get('module') === 'account' &&
            (pendingAction || url.searchParams.get('sort') === 'desc') &&
            (!paged ||
              (url.searchParams.get('page') === '1' &&
                url.searchParams.get('offset') === '30')) &&
            exactKeys([
              'module',
              'action',
              'address',
              ...(pendingAction ? [] : ['sort']),
              ...(paged ? ['page', 'offset'] : []),
            ])
          ) {
            const rows =
              address === owner
                ? action === 'txlist'
                  ? [confirmed]
                  : action === 'pendingtxlist'
                  ? [pending]
                  : []
                : [];
            body = {
              status: rows.length ? '1' : '0',
              message: rows.length ? 'OK' : 'No transactions found',
              result: rows,
            };
          }
          if (
            action === 'tokenlist' &&
            owners.includes(address) &&
            url.searchParams.get('module') === 'account' &&
            exactKeys(['module', 'action', 'address'])
          )
            body = { status: '0', message: 'No tokens found', result: [] };
          if (
            exactKeys(['module', 'action']) &&
            ((action === 'eth_block_number' &&
              url.searchParams.get('module') === 'block') ||
              (action === 'eth_blockNumber' &&
                url.searchParams.get('module') === 'proxy'))
          )
            body = { status: '1', message: 'OK', result: '0x64' };
        }
        if (body === undefined) {
          unsupported.push({ kind: 'http-read', url: url.href });
          return route.abort('blockedbyclient');
        }
        httpReads.push({ url: url.href });
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
          unknownHttpFailures.push({
            method: request.method(),
            url: request.url(),
          });
      });
      const activity = page.locator('#activity-panel-list');
      const trigger = activity.locator('#transaction-options button');
      const menu = page.getByRole('menu');
      const itemNames = [
        en.transactions.seeDetails,
        en.transactions.seeOnBlockExplorer,
        en.header.speedUp,
        en.buttons.cancel,
      ];
      // Registry images may contribute an alt name to a menuitem. Match its
      // actual exact visible label instead of assuming that label is its
      // complete accessible name; require a unique actual menuitem below.
      const item = (index: number) =>
        menu
          .getByRole('menuitem')
          .filter({ has: page.getByText(itemNames[index], { exact: true }) });
      const unchanged = async () =>
        expect(await publicState(page)).toEqual(baseline);
      await wallet.step(
        `${viewport.width}x${viewport.height} first ordinary explorer load supplies one confirmed and one pending Activity row`,
        async () => {
          // This existing helper's seed-field text-security mask is secret
          // sanitation only; no candidate layout or viewport style is altered.
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page.locator('#activity-btn').click();
          await expect(
            activity.getByText(en.send.confirmed, { exact: true })
          ).toHaveCount(1);
          await expect(
            activity.getByText(en.send.pending, { exact: true })
          ).toHaveCount(1);
          await expect(trigger).toHaveCount(1);
          // The mined healthy row uses Details instead of a pending menu.
          const nativeControl = activity.getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          });
          await expect(nativeControl).toHaveCount(1);
          await expect(nativeControl).toHaveAttribute('type', 'button');
          observations.nativeControl = await nativeControl.evaluate((node) => ({
            tag: node.tagName,
            label: node.getAttribute('aria-label'),
          }));
          expect(observations.nativeControl).toEqual({
            tag: 'BUTTON',
            label: en.notifications.clickToView,
          });
          await expect
            .poll(async () =>
              (await publicState(page)).history.map((row: any) => row.hash)
            )
            .toEqual([CONFIRMED_HASH, PENDING_HASH].sort());
          baseline = await publicState(page);
          expect(baseline.active).toEqual({ id: 0, type: 'HDAccount' });
          expect(baseline.savedActive).toEqual(baseline.active);
          expect(baseline.slip44).toBe(60);
          expect(baseline.network).toEqual({
            kind: 'ethereum',
            chainId: 5700,
            url: RPC.slice(0, -1),
            apiUrl: API,
          });
          expect(
            baseline.liveAccounts
              .find(
                (account) => account.kind === 'HDAccount' && account.id === 0
              )
              ?.address.toLowerCase()
          ).toBe(owner);
          expect(baseline.savedAccounts).toEqual(baseline.liveAccounts);
          expect(baseline.liveAssets).toEqual(baseline.savedAssets);
          for (const group of baseline.liveAssets) {
            expect(group.ethereum).toEqual([]);
            expect(group.syscoin).toEqual([]);
            expect(group.nfts).toEqual([]);
          }
          expect(baseline.grants).toEqual([]);
          expect(baseline.savedGrants).toEqual([]);
          expect(baseline.liveCurrency).toBe('usd');
          expect(baseline.savedCurrency).toBe('usd');
          expect(baseline.history).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                hash: PENDING_HASH,
                from: owner,
                nonce: 9,
                blockNumber: null,
                chainId: 5700,
                historySource: 'explorer-pendingtxlist',
              }),
              expect.objectContaining({
                hash: CONFIRMED_HASH,
                to: owner,
                nonce: 8,
                blockNumber: 100,
                chainId: 5700,
                historySource: 'explorer-txlist',
              }),
            ])
          );
          expect(
            httpReads.some(
              (read) =>
                new URL(read.url).searchParams.get('action') === 'pendingtxlist'
            )
          ).toBe(true);
          await page.setViewportSize(viewport);
          await frame(page);
          await unchanged();
        }
      );
      const readyMenu = async () => {
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(4);
        for (let index = 0; index < itemNames.length; index += 1)
          await expect(item(index)).toHaveCount(1);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await frame(page);
      };
      const revealMenu = async () => {
        // Reveal vertical overflow with ordinary scrolling before comparing
        // horizontal clipping. Never adjust DOM scroll/style/focus state.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const bounds = await menu.boundingBox();
          expect(bounds).not.toBeNull();
          if (bounds!.y >= 0 && bounds!.y + bounds!.height <= viewport.height)
            break;
          await page.mouse.move(viewport.width / 2, viewport.height - 32);
          await page.mouse.wheel(0, 32);
          await frame(page);
        }
        await expect
          .poll(async () => {
            const bounds = await menu.boundingBox();
            return (
              !!bounds &&
              bounds.y >= 0 &&
              bounds.y + bounds.height <= viewport.height
            );
          })
          .toBe(true);
        await frame(page);
      };
      await wallet.step(
        `${viewport.width}x${viewport.height} ordinary pointer opens the actual pending options then Escape returns focus`,
        async (capture) => {
          await trigger.click();
          await readyMenu();
          await revealMenu();
          observations.menus.push({
            mode: 'pointer',
            geometry: await measureMenu(menu),
          });
          await unchanged();
          await capture(page);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(trigger).toBeFocused();
          await page.keyboard.press('Tab');
          expect(
            await page.evaluate(
              () => document.activeElement?.getAttribute('role') === 'menuitem'
            )
          ).toBe(false);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} ordinary keyboard reaches all four pending actions without activating any transaction operation`,
        async (capture) => {
          await tabTo(page, trigger);
          await page.keyboard.press('Enter');
          await readyMenu();
          await expect(menu).toBeFocused();
          await expect.poll(() => activeItem(menu, item(0))).toBe(true);
          await page.keyboard.press('Home');
          await expect.poll(() => activeItem(menu, item(0))).toBe(true);
          await page.keyboard.press('ArrowDown');
          await expect.poll(() => activeItem(menu, item(1))).toBe(true);
          await page.keyboard.press('ArrowDown');
          await expect.poll(() => activeItem(menu, item(2))).toBe(true);
          await page.keyboard.press('End');
          await expect.poll(() => activeItem(menu, item(3))).toBe(true);
          await revealMenu();
          // Arrow navigation may perform native reveal scrolling. No operation
          // is clicked: in particular, Speed Up, Cancel and explorer stay idle.
          observations.menus.push({
            mode: 'keyboard',
            geometry: await measureMenu(menu),
          });
          await unchanged();
          await capture(page);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(trigger).toBeFocused();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} all public identity history worker runtime and no-write fences precede the layout candidate`,
        async () => {
          await unchanged();
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerAfter = value;
            }
          );
          expect(observations.menus).toHaveLength(2);
          expect(denialCanaries).toHaveLength(2);
          expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
          expect(
            server.blocked.every(
              (method) => method === 'GET' || method === 'CONNECT'
            )
          ).toBe(true);
          expect(unsupported).toEqual([]);
          expect(forbidden).toEqual([]);
          expect(unknownHttpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} actual pending menu heading and all four action labels remain horizontally readable after healthy controls`,
        async () => {
          for (const observed of observations.menus) {
            expect(observed.geometry.fontStatus).toBe('loaded');
            expect(observed.geometry.heading).toBe(
              en.transactions.pendingTransaction
            );
            expect(
              observed.geometry.items.map((entry: any) => entry.name)
            ).toEqual(itemNames);
            expect(observed.geometry.noHorizontalTextClip).toBe(true);
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('pending-activity-menu-visibility-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            rpcReads,
            httpReads,
            unsupported,
            forbidden,
            unknownHttpFailures,
            pageErrors,
            denialCanaries,
            proxyDeniedMethods: server.blocked,
            syntheticHttpOnly: true,
            directHistoryRefreshRequested: false,
            controllerStateReplaced: false,
            controllerRepliesReplaced: false,
            runtimeTransportReplaced: false,
            candidateDOMStyleScrollOrFocusInjected: false,
            inheritedOnboardingMask:
              'existing seed-field secret sanitation only',
            signingDeploymentOrBroadcastRequested: false,
            operationMenuItemsActivated: false,
            candidateNotConfirmedUntilActualPixelReview: true,
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
}
