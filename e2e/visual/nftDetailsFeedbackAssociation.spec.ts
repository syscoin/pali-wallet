import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { HDNodeWallet, Interface } from 'ethers';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Exploratory normal-UI NFT feedback association diagnostic. A finding is
// not inferred from source or an abbreviated ariaSnapshot. Exact DOM relations,
// primary Chrome AX descriptions and genuine pixels are recorded only after
// real HTTP-owned preview production; no asset import or ownerOf is requested.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const sha = (file: string) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const requestKey = (url: URL) => {
  const query = new URLSearchParams(
    [...url.searchParams].map(([key, value]) => [
      key,
      key === 'address' ? value.toLowerCase() : value,
    ])
  );
  query.sort();
  return `${url.origin}${url.pathname}${query.size ? `?${query}` : ''}`;
};

async function physicalDenial(
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) {
  const proxy = new URL(server.url),
    before = server.blocked.length;
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  const result = await new Promise<{ closed: boolean; statusCode: number }>(
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
      socket.setTimeout(2000, () => fail(new Error('Deny canary timed out')));
      socket.once('error', fail);
      socket.once('connect', () =>
        socket.write(
          `${method} ${
            method === 'GET'
              ? 'http://nft-feedback-denied.invalid/'
              : 'nft-feedback-denied.invalid:443'
          } HTTP/1.0\r\nHost: nft-feedback-denied.invalid\r\nConnection: close\r\n\r\n`
        )
      );
      socket.on('data', (chunk: Buffer) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 4096) fail(new Error('Deny response too large'));
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
            split = text.indexOf('\r\n\r\n');
          expect(split).toBeGreaterThanOrEqual(0);
          expect(text.slice(0, split).split('\r\n')[0]).toMatch(
            /^HTTP\/1\.[01] 403 Forbidden$/
          );
          expect(text.slice(0, split)).toMatch(
            /\r\nConnection: close(?:\r\n|$)/i
          );
          expect(text.slice(split + 4)).toBe(
            method === 'GET' ? 'Offline fixture only' : ''
          );
          resolve({ closed: true, statusCode: 403 });
        } catch (error) {
          reject(error);
        }
      });
    }
  );
  expect(server.blocked.slice(before)).toEqual([method]);
  return { method, ...result };
}

const publicScope = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get(['state', key]);
    const network = (value: any) =>
      value && {
        kind: value.kind,
        chainId: value.chainId,
        slip44: value.slip44,
        label: value.label,
        currency: value.currency,
        url: value.url,
        apiUrl: value.apiUrl,
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
    const accounts = (value: any) =>
      Object.entries(value?.accounts || {})
        .flatMap(([type, group]) =>
          Object.entries(group || {}).map(([id, account]: [string, any]) => ({
            type,
            id,
            label: account.label,
            address: account.address,
          }))
        )
        .sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id));
    const assets = (value: any) =>
      Object.entries(value?.accountAssets || {})
        .flatMap(([type, group]) =>
          Object.entries(group || {}).flatMap(([id, families]: [string, any]) =>
            Object.entries(families || {}).map(([family, rows]) => ({
              type,
              id,
              family,
              count: Array.isArray(rows) ? rows.length : -1,
            }))
          )
        )
        .sort((a, b) =>
          (a.type + a.id + a.family).localeCompare(b.type + b.id + b.family)
        );
    const preferences = (value: any) => ({
      refresh: value?.refresh,
      autolock: value?.autolock,
    });
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
        .sort((a, b) => String(a.host).localeCompare(String(b.host)));
    return {
      ready:
        state.vaultGlobal.networkStatus === 'idle' &&
        !state.vaultGlobal.isPostNetworkSwitchLoading &&
        !state.vaultGlobal.isSwitchingAccount &&
        !state.vaultGlobal.loadingStates?.isLoadingBalances,
      stable: {
        active: state.vault.activeAccount,
        savedActive: disk[key]?.activeAccount,
        network: network(state.vault.activeNetwork),
        savedNetwork: network(disk[key]?.activeNetwork),
        slip44: state.vaultGlobal.activeSlip44,
        networks: networks(state.vaultGlobal.networks),
        savedNetworks: networks(disk.state?.vaultGlobal?.networks),
        accounts: accounts(state.vault),
        savedAccounts: accounts(disk[key]),
        assets: assets(state.vault),
        savedAssets: assets(disk[key]),
        preferences: preferences(state.vaultGlobal.advancedSettings),
        savedPreferences: preferences(
          disk.state?.vaultGlobal?.advancedSettings
        ),
        grants: grants(state.dapp?.dapps),
        savedGrants: grants(disk.state?.dapp?.dapps),
      },
    };
  });

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))
    );
  });
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

const fieldPaint = (target: Locator) =>
  target.evaluate((element) => {
    const input = element as HTMLInputElement;
    const style = getComputedStyle(element),
      selection = getComputedStyle(element, '::selection'),
      box = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let owner = element.parentElement;
      owner;
      owner = owner.parentElement
    ) {
      const current = getComputedStyle(owner),
        bounds = owner.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(current.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + owner.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + owner.clientLeft + owner.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(current.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + owner.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + owner.clientTop + owner.clientHeight
        );
      }
    }
    let selected:
      | { end: number | null; start: number | null }
      | { unsupported: true };
    try {
      selected = { start: input.selectionStart, end: input.selectionEnd };
    } catch {
      selected = { unsupported: true };
    }
    return {
      tag: element.tagName,
      id: element.id,
      value: input.value,
      focused: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      selection: selected,
      documentSelectedText: getSelection()?.toString().slice(0, 128) || '',
      // Pseudo colors are style metadata, not proof a selection actually exists.
      selectionPseudoStyle: {
        color: selection.color,
        background: selection.backgroundColor,
      },
      colors: {
        color: style.color,
        background: style.backgroundColor,
        caret: style.caretColor,
      },
      outline: {
        color: style.outlineColor,
        style: style.outlineStyle,
        width: style.outlineWidth,
        offset: style.outlineOffset,
      },
      borders: {
        top: style.borderTop,
        right: style.borderRight,
        bottom: style.borderBottom,
        left: style.borderLeft,
      },
      boxShadow: style.boxShadow,
      bounds: box.toJSON(),
      clip,
      contained:
        box.left >= clip.left - 0.5 &&
        box.top >= clip.top - 0.5 &&
        box.right <= clip.right + 0.5 &&
        box.bottom <= clip.bottom + 0.5,
      hits: [0.2, 0.5, 0.8].map((fraction) => {
        const hit = document.elementFromPoint(
          box.left + box.width * fraction,
          box.top + box.height / 2
        );
        return !!hit && (hit === element || element.contains(hit));
      }),
    };
  });

async function reveal(page: Page, target: Locator) {
  const observations: unknown[] = [];
  for (let count = 0; count < 12; count++) {
    const value = await target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      let scroller: HTMLElement | null = null;
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const css = getComputedStyle(parent),
          bounds = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
          clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
          clip.right = Math.min(
            clip.right,
            bounds.left + parent.clientLeft + parent.clientWidth
          );
        }
        if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
          clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
          clip.bottom = Math.min(
            clip.bottom,
            bounds.top + parent.clientTop + parent.clientHeight
          );
        }
        if (
          !scroller &&
          /auto|scroll/.test(css.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 1
        )
          scroller = parent;
      }
      scroller ||= element.closest(
        '[data-navigation-scroll="wallet-layout"]'
      ) as HTMLElement | null;
      if (!scroller) throw Error('Missing real navigation scroll owner');
      const owner = scroller.getBoundingClientRect();
      const top = Math.max(0, owner.top + scroller.clientTop);
      const bottom = Math.min(
        innerHeight,
        owner.top + scroller.clientTop + scroller.clientHeight
      );
      const hits = [0.2, 0.5, 0.8].map((fraction) => {
        const hit = document.elementFromPoint(
          box.left + box.width * fraction,
          box.top + box.height / 2
        );
        return !!hit && (hit === element || element.contains(hit));
      });
      const x = Math.max(
        4,
        Math.min(innerWidth - 4, owner.left + owner.width / 2)
      );
      const y = Math.max(top + 4, Math.min(bottom - 4, (top + bottom) / 2));
      const hit = document.elementFromPoint(x, y);
      return {
        shown:
          box.left >= clip.left - 0.5 &&
          box.right <= clip.right + 0.5 &&
          box.top >= clip.top + 4 &&
          box.bottom <= clip.bottom - 4 &&
          hits.every(Boolean),
        fits: box.height <= clip.bottom - clip.top - 8,
        delta: box.top < clip.top + 4 ? -80 : 80,
        ownerHit: !!hit && (hit === scroller || scroller.contains(hit)),
        x,
        y,
        scrollTop: scroller.scrollTop,
        bounds: box.toJSON(),
        clip,
        hits,
      };
    });
    observations.push(value);
    if (value.shown) return observations;
    expect(value.fits).toBe(true);
    expect(value.ownerHit).toBe(true);
    await page.mouse.move(value.x, value.y);
    await page.mouse.wheel(0, value.delta);
    await settle(page);
  }
  throw Error('Ordinary wheel could not reveal the real control');
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 60; count++) {
    if (await target.evaluate((element) => document.activeElement === element))
      break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

const CONTRACT = '0x000000000000000000000000000000000000e721';
const SYMBOL = 'AX721';
const NAME = 'Synthetic readable collection';
const RPC = 'https://rpc.tanenbaum.io';
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
]);

async function fieldEvidence(
  page: Page,
  selector: '#custom-token-contract' | '#nft-details-token-id'
) {
  const input = page.locator(selector);
  await expect(input).toHaveCount(1);
  const dom = await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    const region = field.parentElement!.parentElement!;
    const visible = (node: Element) => {
      const bounds = node.getBoundingClientRect(),
        css = getComputedStyle(node);
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        css.display !== 'none' &&
        css.visibility !== 'hidden'
      );
    };
    return {
      value: field.value,
      focused: document.activeElement === field,
      invalid: field.getAttribute('aria-invalid'),
      busy: field.getAttribute('aria-busy'),
      label: Array.from(field.labels || []).map(
        (label) => label.textContent?.trim() || ''
      ),
      references: ['aria-describedby', 'aria-errormessage'].flatMap(
        (attribute) =>
          (field.getAttribute(attribute) || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => {
              const node = document.getElementById(id);
              return {
                attribute,
                id,
                text: node?.textContent?.trim() || '',
                visible: !!node && visible(node),
              };
            })
      ),
      messages: Array.from(region.querySelectorAll('p'))
        .filter(visible)
        .map((node) => node.textContent?.trim() || ''),
      liveNodes: Array.from(
        region.querySelectorAll('[role="alert"],[aria-live]')
      )
        .filter(visible)
        .map((node) => ({
          role: node.getAttribute('role'),
          live: node.getAttribute('aria-live'),
          text: node.textContent?.trim() || '',
        })),
      ariaSnapshotIsSupplementaryOnly: true,
    };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    expect(nodeId).toBeGreaterThan(0);
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    });
    const node = nodes.find(
      (value) => value.role?.value === 'textbox' && !value.ignored
    );
    expect(node).toBeDefined();
    return {
      dom,
      native: {
        role: node!.role!.value,
        name: node!.name?.value || '',
        description: node!.description?.value || '',
        properties: Object.fromEntries(
          (node!.properties || [])
            .filter((property) =>
              [
                'invalid',
                'busy',
                'live',
                'atomic',
                'relevant',
                'describedby',
                'errormessage',
              ].includes(property.name)
            )
            .map((property) => [property.name, property.value.value ?? null])
        ),
      },
      supplementarySnapshot: await input.ariaSnapshot(),
    };
  } finally {
    await cdp.detach();
  }
}

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`NFT collection detail feedback stays natively associated through malformed input and correction at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    test.setTimeout(180_000);
    expect(process.version).toBe('v23.11.1');
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
    // Raw builds may include late-emitted build metadata absent from the ZIP.
    // Pin every actual member via the artifact hash and retain worker checks.
    expect(runtime.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.bundleHashes).toEqual({
      background: expect.stringMatching(/^[a-f0-9]{64}$/),
      external: expect.stringMatching(/^[a-f0-9]{64}$/),
      inpage: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const owner = HDNodeWallet.fromPhrase(
      UTXO_FIXTURE_SEED,
      undefined,
      "m/44'/60'/0'/0/0"
    ).address.toLowerCase();
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
    const emptyInventory = {
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
    const http = new Map<string, unknown>([
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
      ['https://api.coingecko.com/api/v3/asset_platforms', []],
    ]);
    const addGet = (url: string, body: unknown) =>
      http.set(requestKey(new URL(url)), body);
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addGet(origin + '/api/v2/tickers/currency', { ts: 1, rates: { usd: 1 } });
    for (const query of [
      'details=tokenBalances&tokens=used',
      'details=tokenBalances&tokens=nonzero',
      'details=txsummary&pageSize=30',
      'details=txslight&pageSize=30',
    ])
      addGet(
        'https://blockbook.syscoin.org/api/v2/xpub/' + xpub + '?' + query,
        emptyInventory
      );
    addGet(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      {
        // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
        syscoin: { usd: 1, usd_24h_change: 0 },
      }
    );
    const ownedRow = {
      contractAddress: CONTRACT,
      name: NAME,
      symbol: SYMBOL,
      type: 'ERC-721',
      decimals: '0',
      balance: '1',
    };
    for (const action of ['tokenlist', 'txlist', 'pendingtxlist', 'tokentx']) {
      const url = new URL('https://explorer.tanenbaum.io/api');
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', action);
      url.searchParams.set('address', owner);
      if (action === 'txlist' || action === 'tokentx')
        url.searchParams.set('sort', 'desc');
      addGet(url.href, {
        status: action === 'tokenlist' ? '1' : '0',
        message: action === 'tokenlist' ? 'OK' : 'No transactions found',
        result: action === 'tokenlist' ? [ownedRow] : [],
      });
    }
    const nftReplies = new Map<string, string>([
      [
        abi
          .encodeFunctionData('supportsInterface', ['0x780e9d63'])
          .toLowerCase(),
        abi.encodeFunctionResult('supportsInterface', [true]),
      ],
      [
        abi.encodeFunctionData('balanceOf', [owner]).toLowerCase(),
        abi.encodeFunctionResult('balanceOf', [1]),
      ],
      [
        abi.encodeFunctionData('tokenOfOwnerByIndex', [owner, 0]).toLowerCase(),
        abi.encodeFunctionResult('tokenOfOwnerByIndex', [7]),
      ],
    ]);
    const server = await startUtxoFixtureServer();
    const physicalCanaries: unknown[] = [],
      httpReads: string[] = [],
      rpcReads: Array<{ method: string; params: unknown[]; phase: string }> =
        [];
    const unsupported: unknown[] = [],
      writes: string[] = [],
      pageErrors: string[] = [],
      httpFailures: string[] = [];
    const observations: Record<string, any> = {
      viewport,
      runtime,
      sourceSha256,
      physicalCanaries,
      states: [],
      candidateUnconfirmedUntilRootPixels: true,
    };
    let phase = 'setup',
      status: 'passed' | 'failed' = 'failed',
      wallet: PaliWallet | undefined;
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NftFeedbackSynthetic!2026',
      rpcUrl: server.url,
    });
    try {
      physicalCanaries.push(await physicalDenial(server, 'GET'));
      physicalCanaries.push(await physicalDenial(server, 'CONNECT'));
      wallet = await PaliWallet.launch(
        `nft-details-feedback-${viewport.width}x${viewport.height}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url())) {
          const url = new URL(request.url());
          httpFailures.push(request.method() + ' ' + url.origin + url.pathname);
        }
      });
      await wallet.context.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol))
          return route.continue();
        const clean = !url.username && !url.password && !url.hash;
        if (url.origin !== RPC) {
          const body =
            request.method() === 'GET' && clean
              ? http.get(requestKey(url))
              : undefined;
          if (body !== undefined) {
            httpReads.push(requestKey(url));
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(body),
            });
          }
          if (
            request.method() !== 'GET' ||
            /\/sendtx(?:\/|$)/i.test(url.pathname)
          )
            writes.push(request.method() + ' ' + url.origin + url.pathname);
          unsupported.push({
            method: request.method(),
            origin: url.origin,
            path: url.pathname,
          });
          return route.abort('blockedbyclient');
        }
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          unsupported.push('Malformed RPC JSON');
          return route.abort('blockedbyclient');
        }
        const calls = Array.isArray(payload) ? payload : [payload],
          replies: any[] = [];
        let valid =
          request.method() === 'POST' &&
          clean &&
          url.pathname === '/' &&
          !url.search &&
          calls.length > 0;
        for (const call of calls) {
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
          if (!envelope) {
            valid = false;
            continue;
          }
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call.method
            )
          )
            writes.push(call.method);
          const p = call.params;
          let result: unknown;
          if (p.length === 0) {
            if (call.method === 'eth_chainId') result = '0x1644';
            if (call.method === 'net_version') result = '5700';
            if (call.method === 'eth_blockNumber') result = '0x1';
          }
          if (
            ['eth_getBalance', 'eth_getTransactionCount'].includes(
              call.method
            ) &&
            p.length === 2 &&
            typeof p[0] === 'string' &&
            p[0].toLowerCase() === owner &&
            p[1] === 'latest'
          )
            result = '0x0';
          if (
            call.method === 'eth_getBlockByNumber' &&
            p.length === 2 &&
            ['0x0', '0x1'].includes(p[0]) &&
            p[1] === true
          )
            result = { number: p[0], timestamp: '0x1', transactions: [] };
          if (
            call.method === 'eth_call' &&
            p.length === 2 &&
            p[1] === 'latest' &&
            p[0] &&
            typeof p[0] === 'object' &&
            !Array.isArray(p[0]) &&
            Object.keys(p[0]).every((key) => ['to', 'data'].includes(key)) &&
            typeof p[0].to === 'string' &&
            p[0].to.toLowerCase() === CONTRACT &&
            typeof p[0].data === 'string'
          )
            result = nftReplies.get(p[0].data.toLowerCase());
          if (result === undefined) valid = false;
          replies.push({ jsonrpc: '2.0', id: call.id, result });
        }
        if (!valid || replies.length !== calls.length) {
          unsupported.push({
            method: request.method(),
            origin: url.origin,
            path: url.pathname,
            calls: calls.map((call: any) => ({
              method: call?.method,
              params: call?.params,
            })),
          });
          return route.abort('blockedbyclient');
        }
        rpcReads.push(
          ...calls.map((call: any) => ({
            method: call.method,
            params: call.params,
            phase,
          }))
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
        });
      });
      const step: PaliWallet['step'] = (name, action) =>
        wallet!.step(`${viewport.width}x${viewport.height}: ${name}`, action);
      const nftInput = page.locator('#nft-details-token-id');
      const region = (field: Locator) => field.locator('..').locator('..');
      const nftCalls = () =>
        rpcReads.filter((read) => read.method === 'eth_call');
      const assertScope = async () => {
        await expect
          .poll(async () => (await publicScope(page)).ready)
          .toBe(true);
        expect((await publicScope(page)).stable).toEqual(observations.baseline);
      };
      const capture = async (
        name: string,
        field: Locator,
        selector: '#custom-token-contract' | '#nft-details-token-id'
      ) => {
        const wheel = await reveal(page, region(field));
        await page.mouse.move(2, 2);
        await settle(page);
        const paint = await fieldPaint(field),
          evidence = await fieldEvidence(page, selector);
        const file = path.join(
          E2E_CONFIG.artifactsDir,
          'screenshots',
          `nft-feedback-${viewport.width}x${viewport.height}-${name}.png`
        );
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const png = await page.screenshot({
          path: file,
          fullPage: false,
          caret: 'initial',
        });
        expect({
          width: png.readUInt32BE(16),
          height: png.readUInt32BE(20),
        }).toEqual(viewport);
        expect(paint.contained).toBe(true);
        expect(paint.hits).toEqual([true, true, true]);
        const state = {
          name,
          wheel,
          paint,
          evidence,
          screenshot: {
            path: file,
            sha256: createHash('sha256').update(png).digest('hex'),
            width: viewport.width,
            height: viewport.height,
            fullPage: false,
            caret: 'initial',
          },
        };
        observations.states.push(state);
        return state;
      };
      const openImport = async () => {
        await expect(page).toHaveURL(/#\/home$/);
        await page.locator('#assets-btn').click();
        const add = page.getByRole('button', {
          name: en.home.importToken,
          exact: true,
        });
        await reveal(page, add);
        await add.click();
        await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
        await expect(
          page.getByRole('button', { name: en.tokens.yourTokens, exact: true })
        ).toBeVisible();
      };
      const details = () =>
        page.getByRole('button', {
          name: en.tokens.viewTokenDetails.replace('{{symbol}}', SYMBOL),
          exact: true,
        });
      const collection = () =>
        page.getByRole('button', {
          name: en.send.viewCollectionItems,
          exact: true,
        });
      const openPreview = async () => {
        await expect(details()).toHaveCount(1);
        await reveal(page, details());
        await details().click();
        await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
        await expect(collection()).toHaveCount(1);
        await reveal(page, collection());
        await collection().click();
        await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
        await expect(nftInput).toBeEnabled();
        await expect(nftInput).toHaveValue('');
        await expect(
          page.getByRole('button', { name: '#7', exact: true })
        ).toBeVisible();
        await expect(nftInput).toHaveAccessibleName(en.send.tokenId + ':');
      };
      await step(
        'ordinary onboarding and exact default testnet EVM choice keep empty live and saved inventories',
        async () => {
          observations.workerBefore = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerBefore = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await expect
            .poll(async () => (await publicScope(page)).ready)
            .toBe(true);
          observations.baseline = (await publicScope(page)).stable;
          expect(observations.baseline.active).toEqual({
            type: 'HDAccount',
            id: 0,
          });
          expect(observations.baseline.savedActive).toEqual(
            observations.baseline.active
          );
          expect(observations.baseline.network).toMatchObject({
            kind: 'ethereum',
            chainId: 5700,
            slip44: 60,
            url: RPC,
            apiUrl: 'https://explorer.tanenbaum.io/api',
          });
          expect(observations.baseline.savedNetwork).toEqual(
            observations.baseline.network
          );
          expect(observations.baseline.accounts).toEqual(
            observations.baseline.savedAccounts
          );
          expect(observations.baseline.accounts).toHaveLength(1);
          expect(observations.baseline.accounts[0].address.toLowerCase()).toBe(
            owner
          );
          expect(
            observations.baseline.assets.every(
              (entry: any) => entry.count === 0
            )
          ).toBe(true);
          expect(observations.baseline.savedAssets).toEqual(
            observations.baseline.assets
          );
          expect(observations.baseline.preferences).toEqual({
            refresh: false,
            autolock: 0,
          });
          expect(observations.baseline.savedPreferences).toEqual(
            observations.baseline.preferences
          );
          expect(observations.baseline.grants).toEqual([]);
          expect(observations.baseline.savedGrants).toEqual([]);
          await openImport();
          await page.setViewportSize(viewport);
          await assertScope();
        }
      );
      phase = 'positive-description-control';
      await step(
        'real existing contract feedback is a positive DOM and primary AX description control',
        async () => {
          const custom = page.getByRole('button', {
            name: en.tokens.addCustomTab,
            exact: true,
          });
          await custom.click();
          const field = page.locator('#custom-token-contract');
          await expect(field).toBeEnabled();
          await field.fill('0x123');
          await expect(region(field).getByRole('alert')).toHaveText(
            en.send.invalidEthAddress
          );
          observations.positiveDescription = await capture(
            'positive-contract-description',
            field,
            '#custom-token-contract'
          );
          const evidence = observations.positiveDescription.evidence;
          expect(
            evidence.dom.references.some(
              (ref: any) =>
                ref.visible && ref.text === en.send.invalidEthAddress
            )
          ).toBe(true);
          expect(evidence.native.description).toContain(
            en.send.invalidEthAddress
          );
          expect(evidence.native.properties.invalid).toBe('true');
          expect(
            evidence.dom.liveNodes.some(
              (node: any) =>
                node.text === en.send.invalidEthAddress && node.role === 'alert'
            )
          ).toBe(true);
          expect(nftCalls()).toEqual([]);
          await field.fill('');
          await expect(region(field).getByRole('alert')).toHaveCount(0);
          await page
            .getByRole('button', { name: en.tokens.yourTokens, exact: true })
            .click();
          await expect(details()).toBeVisible();
          await assertScope();
        }
      );
      phase = 'collection-discovery';
      await step(
        'the real HTTP-owned preview and enumerable token7 provide the healthy native field',
        async () => {
          await openPreview();
          observations.empty = await capture(
            'collection-empty-manual',
            nftInput,
            '#nft-details-token-id'
          );
          expect(observations.empty.evidence.native.role).toBe('textbox');
          expect(observations.empty.evidence.native.name).toBe(
            en.send.tokenId + ':'
          );
          expect(observations.empty.evidence.dom.invalid).not.toBe('true');
          const positive = page.getByRole('button', {
            name: '#7',
            exact: true,
          });
          await positive.click();
          await expect(nftInput).toHaveValue('');
          await expect(region(nftInput).locator('p')).toContainText([
            en.send.selectTokenIdOrTryDifferent,
          ]);
          await tabTo(page, nftInput);
          await page.keyboard.press('Shift+Tab');
          await expect(positive).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(nftInput).toBeFocused();
          observations.healthy = await capture(
            'collection-healthy-native-field',
            nftInput,
            '#nft-details-token-id'
          );
          expect(observations.healthy.evidence.dom.value).toBe('');
          expect(observations.healthy.evidence.dom.messages).toContain(
            en.send.selectTokenIdOrTryDifferent
          );
          const data = nftCalls().map((read) =>
            String((read.params[0] as any).data).toLowerCase()
          );
          for (const call of nftReplies.keys()) expect(data).toContain(call);
          await assertScope();
        }
      );
      phase = 'malformed-manual';
      await step(
        'ordinary malformed abc completes current visible feedback without any new NFT RPC',
        async () => {
          const before = nftCalls().length;
          await nftInput.fill('abc');
          observations.pendingOrAlreadyCompleted = await fieldEvidence(
            page,
            '#nft-details-token-id'
          );
          await expect(
            region(nftInput)
              .locator('p')
              .filter({ hasText: en.send.invalidTokenId })
          ).toBeVisible();
          await expect(
            region(nftInput).getByRole('img', { name: 'loading', exact: true })
          ).toHaveCount(0);
          await tabTo(page, nftInput);
          observations.malformed = await capture(
            'collection-malformed-current-feedback',
            nftInput,
            '#nft-details-token-id'
          );
          expect(observations.malformed.evidence.dom.value).toBe('abc');
          expect(
            observations.malformed.evidence.dom.messages.some(
              (message: string) => message.includes(en.send.invalidTokenId)
            )
          ).toBe(true);
          expect(nftCalls().length).toBe(before);
          observations.malformedAddedNftRpc = nftCalls().length - before;
          await assertScope();
        }
      );
      phase = 'correction-and-reentry';
      await step(
        'clear and real discovered chip correction then Back Close and preview re-entry preserve public scope',
        async () => {
          const before = nftCalls().length;
          await nftInput.fill('');
          await expect(
            region(nftInput)
              .locator('p')
              .filter({ hasText: en.send.invalidTokenId })
          ).toHaveCount(0);
          await page.getByRole('button', { name: '#7', exact: true }).click();
          await expect(nftInput).toHaveValue('');
          observations.corrected = await capture(
            'collection-corrected-empty-manual',
            nftInput,
            '#nft-details-token-id'
          );
          expect(nftCalls().length).toBe(before);
          await assertScope();
          const back = page.getByRole('button', {
            name: en.buttons.back,
            exact: true,
          });
          await tabTo(page, back);
          await page.keyboard.press('Enter');
          await expect(collection()).toBeVisible();
          await expect(nftInput).toHaveCount(0);
          const footerClose = page
            .locator('#details-view-content')
            .getByRole('button', { name: en.buttons.close, exact: true });
          await reveal(page, footerClose);
          await footerClose.click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
          await expect(details()).toBeVisible();
          await assertScope();
          const close = page.getByLabel(en.buttons.close, { exact: true });
          await expect(close).toHaveCount(1);
          await close.click();
          await expect(page).toHaveURL(/#\/home$/);
          await assertScope();
          await openImport();
          await openPreview();
          observations.reopened = await capture(
            'collection-reopened-healthy',
            nftInput,
            '#nft-details-token-id'
          );
          expect(observations.reopened.evidence.dom.messages).toContain(
            en.send.selectTokenIdOrTryDifferent
          );
          await assertScope();
        }
      );
      await step(
        'finish all worker source finite read public state and physical fence controls before the candidate gate',
        async () => {
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerAfter = value;
            }
          );
          await assertScope();
          expect(
            httpReads.some((url) => url.includes('/api/v2/xpub/' + xpub))
          ).toBe(true);
          expect(
            httpReads.some(
              (url) =>
                url.includes('action=tokenlist') &&
                url.includes('address=' + owner)
            )
          ).toBe(true);
          expect(unsupported).toEqual([]);
          expect(writes).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(httpFailures).toEqual([]);
          expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
          expect(
            server.blocked.every((method) =>
              ['GET', 'CONNECT'].includes(method)
            )
          ).toBe(true);
          expect(extensionEvidence()).toEqual(runtime);
          expect(sha(info.file)).toBe(sourceSha256);
          expect(observations.malformedAddedNftRpc).toBe(0);
          expect(observations.states.map((state: any) => state.name)).toEqual([
            'positive-contract-description',
            'collection-empty-manual',
            'collection-healthy-native-field',
            'collection-malformed-current-feedback',
            'collection-corrected-empty-manual',
            'collection-reopened-healthy',
          ]);
        }
      );
      await step(
        'current NFT helper and completed malformed feedback are associated with the actual native field',
        async () => {
          // This is last, after every healthy/scope/fixture/worker guard above.
          // Native AX metadata is not a claim about actual spoken AT behavior.
          const healthy = observations.healthy.evidence,
            bad = observations.malformed.evidence;
          expect(
            healthy.dom.references.some(
              (ref: any) =>
                ref.visible &&
                ref.text.includes(en.send.selectTokenIdOrTryDifferent)
            )
          ).toBe(true);
          expect(healthy.native.description).toContain(
            en.send.selectTokenIdOrTryDifferent
          );
          expect(
            bad.dom.references.some(
              (ref: any) =>
                ref.visible && ref.text.includes(en.send.invalidTokenId)
            )
          ).toBe(true);
          expect(bad.native.description).toContain(en.send.invalidTokenId);
          expect(bad.dom.invalid).toBe('true');
          expect(bad.native.properties.invalid).toBe('true');
          expect(
            bad.dom.liveNodes.some(
              (node: any) =>
                node.text.includes(en.send.invalidTokenId) &&
                (node.role === 'alert' ||
                  ['polite', 'assertive'].includes(node.live))
            )
          ).toBe(true);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('nft-details-native-feedback-observations', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              status,
              observations,
              httpReads,
              rpcReads,
              unsupported,
              writes,
              httpFailures,
              pageErrors,
              proxyDeniedMethods: server.blocked,
              proxyCountsArePlatformEvidenceOnly: true,
              assetImportRequested: false,
              settingsSaveRequested: false,
              controllerResultsReplaced: false,
              rendererOrStoreReplaced: false,
              focusScrollSelectionOrCaretSettersUsed: false,
              signingOrBroadcastRequested: false,
              connectionGranted: false,
              auditoryScreenReaderClaim: false,
            },
            null,
            2
          ),
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
