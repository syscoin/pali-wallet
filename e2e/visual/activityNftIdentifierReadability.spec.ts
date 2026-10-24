import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, Interface, id } from 'ethers';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { createIsolatedVaultFixture } from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Ordinary-history presentation regression. Only public HTTP/RPC read
// replies are synthetic. No transaction is signed, sent, imported or approved.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RPC = 'https://rpc.tanenbaum.io/';
const API = 'https://explorer.tanenbaum.io/api';
const CONTRACT = '0x' + '33'.repeat(20);
const RECIPIENT = '0x' + '44'.repeat(20);
const SYMBOL = 'ART';
const LONG_ID_SEED = 'Pali disposable synthetic ERC721 artwork identifier';
const LONG_ID = BigInt(id(LONG_ID_SEED)).toString();
const IDS = ['7', LONG_ID] as const;
const HASHES = ['0x' + 'b1'.repeat(32), '0x' + 'b2'.repeat(32)];
const BLOCK_HASH = '0x' + '42'.repeat(32);
const VALUE_SELECTOR =
  '#details-view-content > div:first-child > p:nth-of-type(2)';
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
      ? 'http://activity-nft-header-denied.invalid/'
      : 'activity-nft-header-denied.invalid:443';
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
        `${method} ${target} HTTP/1.0\r\nHost: activity-nft-header-denied.invalid\r\nConnection: close\r\n\r\n`
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
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().every((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            timing?.iterations === Infinity ||
            (animation.playState !== 'running' && !animation.pending)
          );
        })
      )
    )
    .toBe(true);
  await frame(page);
};
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 80; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};
const routeTuple = (page: Page) =>
  page.evaluate(() => ({
    url: location.href,
    idx: history.state?.idx ?? null,
    key: history.state?.key ?? null,
  }));
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const live = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const disk = await chrome.storage.local.get([
      'state-vault-' + live.vaultGlobal.activeSlip44,
      'state',
      'language',
    ]);
    const saved = disk['state-vault-' + live.vaultGlobal.activeSlip44];
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
          Object.entries(group || {}).flatMap(
            ([accountId, families]: [string, any]) =>
              Object.entries(families || {}).map(
                ([family, entries]: [string, any]) => ({
                  kind,
                  accountId: Number(accountId),
                  family,
                  assets: (entries || []).map((asset: any) => ({
                    id: asset.id,
                    contractAddress: asset.contractAddress ?? null,
                    chainId: asset.chainId ?? null,
                    isNft: asset.isNft ?? false,
                    tokenStandard: asset.tokenStandard ?? null,
                    symbol: asset.tokenSymbol ?? asset.symbol ?? null,
                  })),
                })
              )
          )
        )
        .sort((a, b) =>
          (a.kind + ':' + a.accountId + ':' + a.family).localeCompare(
            b.kind + ':' + b.accountId + ':' + b.family
          )
        );
    const network = (vault: any) => ({
      kind: vault?.activeNetwork?.kind,
      chainId: vault?.activeNetwork?.chainId,
      url: vault?.activeNetwork?.url,
      apiUrl: vault?.activeNetwork?.apiUrl,
    });
    const historyRows = (vault: any) =>
      (
        vault?.accountTransactions?.[live.vault.activeAccount.type]?.[
          live.vault.activeAccount.id
        ]?.ethereum?.[5700] || []
      )
        .map((row: any) => ({
          hash: row.hash,
          from: row.from?.toLowerCase(),
          to: row.to?.toLowerCase(),
          input: row.input,
          value: String(row.value),
          nonce: row.nonce,
          chainId: row.chainId,
          blockNumber: row.blockNumber ?? null,
          historySource: row.historySource,
        }))
        .sort((a: any, b: any) => a.hash.localeCompare(b.hash));
    return {
      active: live.vault.activeAccount,
      savedActive: saved?.activeAccount,
      slip44: live.vaultGlobal.activeSlip44,
      network: network(live.vault),
      savedNetwork: network(saved),
      accounts: accounts(live.vault),
      savedAccounts: accounts(saved),
      assets: assets(live.vault),
      savedAssets: assets(saved),
      grants: Object.keys(live.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
      language: disk.language || 'en',
      currency: live.price.fiat.asset,
      savedCurrency: disk.state?.price?.fiat?.asset,
      history: historyRows(live.vault),
      savedHistory: historyRows(saved),
    };
  });

// Atomic route + DOM read: a genuine native history gesture may leave Details.
// A Home result is reported honestly with no fabricated missing-header geometry.
const measureValue = (page: Page) =>
  page.evaluate((selector) => {
    const route = {
      url: location.href,
      idx: history.state?.idx ?? null,
      key: history.state?.key ?? null,
    };
    const root = document.querySelector(selector) as HTMLElement | null;
    if (!root) return { route, value: null };
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
    for (let node: HTMLElement | null = root; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      ancestors.push({
        tag: node.tagName,
        id: node.id,
        box: box(node),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
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
    const glyphs: any[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walk.nextNode())) {
      const text = textNode.textContent || '';
      for (let index = 0; index < text.length; index += 1) {
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const r = range.getBoundingClientRect();
        const x = r.left + r.width / 2,
          y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        const collapsedWhitespace =
          text[index] === ' ' &&
          r.width === 0 &&
          getComputedStyle(root).whiteSpace === 'normal';
        glyphs.push({
          char: text[index],
          box: {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          },
          collapsedWhitespace,
          centerHit: !!hit && (hit === root || root.contains(hit)),
          horizontalFit:
            (r.width > 0 || collapsedWhitespace) &&
            r.height > 0 &&
            r.left >= clip.left - 0.5 &&
            r.right <= clip.right + 0.5,
        });
      }
    }
    const style = getComputedStyle(root);
    return {
      route,
      value: {
        text: root.textContent,
        box: box(root),
        clip,
        fontStatus: document.fonts.status,
        viewport: { width: innerWidth, height: innerHeight },
        style: {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          whiteSpace: style.whiteSpace,
          wordBreak: style.wordBreak,
          overflowWrap: style.overflowWrap,
        },
        ancestors,
        glyphs,
        allGlyphsHorizontallyFit:
          glyphs.length > 0 && glyphs.every((glyph) => glyph.horizontalFit),
        visibleCharacters: glyphs
          .filter((glyph) => glyph.horizontalFit && glyph.centerHit)
          .map((glyph) => glyph.char)
          .join(''),
      },
    };
  }, VALUE_SELECTOR);

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`NFT Activity detail identifiers remain readable after normal history and native navigation at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    test.setTimeout(240_000);
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
    expect(runtime.version).toBe(packageJson.version);
    expect(runtime.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(runtime.bundleHashes).sort()).toEqual([
      'background',
      'external',
      'inpage',
    ]);
    for (const value of Object.values(runtime.bundleHashes))
      expect(value).toMatch(/^[a-f0-9]{64}$/);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const owner = fixture.evmAddresses[0].toLowerCase();
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
    const nft = new Interface([
      'function safeTransferFrom(address from,address to,uint256 tokenId)',
      'function supportsInterface(bytes4 interfaceId) view returns (bool)',
      'function name() view returns (string)',
      'function symbol() view returns (string)',
    ]);
    const abi = AbiCoder.defaultAbiCoder();
    const timestamp = Math.floor(Date.now() / 1000) - 600;
    const txs = IDS.map((tokenId, index) => {
      const input = nft.encodeFunctionData(
        'safeTransferFrom(address,address,uint256)',
        [owner, RECIPIENT, tokenId]
      );
      const explorer = {
        hash: HASHES[index],
        from: owner,
        to: CONTRACT,
        input,
        value: '0',
        nonce: String(index + 1),
        blockNumber: '42',
        blockHash: BLOCK_HASH,
        timeStamp: String(timestamp + index),
        confirmations: '1',
        type: '0',
        gas: '60000',
        gasUsed: '50000',
        gasPrice: '1000000000',
        isError: '0',
        // eslint-disable-next-line camelcase -- Explorer wire field.
        txreceipt_status: '1',
      };
      const transaction = {
        hash: HASHES[index],
        from: owner,
        to: CONTRACT,
        input,
        value: '0x0',
        nonce: '0x' + (index + 1).toString(16),
        gas: '0xea60',
        gasPrice: '0x3b9aca00',
        blockNumber: '0x2a',
        blockHash: BLOCK_HASH,
        transactionIndex: '0x' + index.toString(16),
        chainId: '0x1644',
        type: '0x0',
        r: '0x' + '01'.repeat(32),
        s: '0x' + '02'.repeat(32),
        v: '0x1b',
      };
      const log = {
        address: CONTRACT,
        topics: [
          id('Transfer(address,address,uint256)'),
          abi.encode(['address'], [owner]),
          abi.encode(['address'], [RECIPIENT]),
          abi.encode(['uint256'], [tokenId]),
        ],
        data: '0x',
        blockNumber: '0x2a',
        blockHash: BLOCK_HASH,
        transactionHash: HASHES[index],
        transactionIndex: '0x' + index.toString(16),
        logIndex: '0x' + index.toString(16),
        removed: false,
      };
      const receipt = {
        transactionHash: HASHES[index],
        transactionIndex: transaction.transactionIndex,
        blockHash: BLOCK_HASH,
        blockNumber: '0x2a',
        from: owner,
        to: CONTRACT,
        cumulativeGasUsed: '0xc350',
        gasUsed: '0xc350',
        effectiveGasPrice: '0x3b9aca00',
        logs: [log],
        logsBloom: '0x' + '00'.repeat(256),
        status: '0x1',
        type: '0x0',
        contractAddress: null,
      };
      return { tokenId, explorer, transaction, receipt };
    });
    expect(LONG_ID.length).toBeGreaterThanOrEqual(76);
    expect(BigInt(LONG_ID)).toBeLessThan(BigInt(1) << BigInt(256));
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
      longIdSeed: LONG_ID_SEED,
      longId: LONG_ID,
      initialHeaders: [],
      horizontalRecovery: [],
      originals: [],
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
        password: 'ActivityNftIdentifierSynthetic!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: 'Syscoin NEVM Testnet',
      });
      wallet = await PaliWallet.launch(
        `activity-nft-identifier-${viewport.width}x${viewport.height}`,
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
            const envelope =
              call &&
              typeof call === 'object' &&
              !Array.isArray(call) &&
              call.jsonrpc === '2.0' &&
              typeof call.method === 'string' &&
              Number.isSafeInteger(call.id) &&
              call.id >= 0 &&
              Object.keys(call).every((key) =>
                ['id', 'jsonrpc', 'method', 'params'].includes(key)
              ) &&
              Array.isArray(call.params);
            if (!envelope) {
              unsupported.push({ kind: 'rpc-envelope' });
              return undefined;
            }
            const params = call.params;
            let result: unknown;
            if (params.length === 0) {
              if (call.method === 'eth_chainId') result = '0x1644';
              if (call.method === 'net_version') result = '5700';
              if (call.method === 'eth_blockNumber') result = '0x2a';
            }
            if (
              ['eth_getBalance', 'eth_getTransactionCount'].includes(
                call.method
              ) &&
              params.length === 2 &&
              typeof params[0] === 'string' &&
              params[0].toLowerCase() === owner &&
              params[1] === 'latest'
            )
              result = call.method === 'eth_getBalance' ? '0x0' : '0x3';
            if (
              call.method === 'eth_getCode' &&
              params.length === 2 &&
              typeof params[0] === 'string' &&
              params[0].toLowerCase() === CONTRACT &&
              params[1] === 'latest'
            )
              result = '0x60006000fd';
            if (
              call.method === 'eth_call' &&
              params.length === 2 &&
              params[1] === 'latest' &&
              params[0] &&
              typeof params[0] === 'object' &&
              !Array.isArray(params[0]) &&
              Object.keys(params[0]).length === 2 &&
              Object.keys(params[0]).every((key) =>
                ['to', 'data'].includes(key)
              ) &&
              typeof params[0].to === 'string' &&
              params[0].to.toLowerCase() === CONTRACT &&
              typeof params[0].data === 'string'
            ) {
              const data = params[0].data.toLowerCase();
              if (
                data ===
                nft
                  .encodeFunctionData('supportsInterface', ['0x80ac58cd'])
                  .toLowerCase()
              )
                result = nft.encodeFunctionResult('supportsInterface', [true]);
              if (data === nft.encodeFunctionData('name'))
                result = nft.encodeFunctionResult('name', [
                  'Synthetic Artwork',
                ]);
              if (data === nft.encodeFunctionData('symbol'))
                result = nft.encodeFunctionResult('symbol', [SYMBOL]);
            }
            if (
              [
                'eth_getTransactionByHash',
                'eth_getTransactionReceipt',
              ].includes(call.method) &&
              params.length === 1 &&
              HASHES.includes(params[0])
            ) {
              const row = txs[HASHES.indexOf(params[0])];
              result =
                call.method === 'eth_getTransactionByHash'
                  ? row.transaction
                  : row.receipt;
            }
            // MainController.getEvmTransactionFromProvider reads only the mined
            // receipt's exact block42 for timestamp after these exact hashes.
            if (
              call.method === 'eth_getBlockByNumber' &&
              params.length === 2 &&
              params[0] === '0x2a' &&
              params[1] === false
            )
              result = {
                number: '0x2a',
                hash: BLOCK_HASH,
                parentHash: '0x' + '41'.repeat(32),
                nonce: '0x0000000000000000',
                timestamp: '0x' + timestamp.toString(16),
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x186a0',
                miner: '0x' + '00'.repeat(20),
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
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
        const exactKeys = (keys: string[]) =>
          [...url.searchParams.keys()].length === keys.length &&
          keys.every((key) => url.searchParams.getAll(key).length === 1);
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
          const pending = action === 'pendingtxlist';
          const paged = url.searchParams.has('page');
          if (
            ['txlist', 'tokentx', 'pendingtxlist'].includes(action) &&
            url.searchParams.get('address')?.toLowerCase() === owner &&
            url.searchParams.get('module') === 'account' &&
            (pending || url.searchParams.get('sort') === 'desc') &&
            (!paged ||
              (url.searchParams.get('page') === '1' &&
                url.searchParams.get('offset') === '30')) &&
            exactKeys([
              'module',
              'action',
              'address',
              ...(pending ? [] : ['sort']),
              ...(paged ? ['page', 'offset'] : []),
            ])
          ) {
            const rows =
              action === 'txlist'
                ? txs.map((row) => row.explorer).reverse()
                : [];
            body = {
              status: rows.length ? '1' : '0',
              message: rows.length ? 'OK' : 'No transactions found',
              result: rows,
            };
          }
          if (
            action === 'tokenlist' &&
            url.searchParams.get('module') === 'account' &&
            url.searchParams.get('address')?.toLowerCase() === owner &&
            exactKeys(['module', 'action', 'address'])
          )
            body = { status: '0', message: 'No tokens found', result: [] };
          if (
            action === 'gettxinfo' &&
            url.searchParams.get('module') === 'transaction' &&
            HASHES.includes(url.searchParams.get('txhash') || '') &&
            exactKeys(['module', 'action', 'txhash'])
          )
            body = {
              status: '0',
              message: 'Unsupported gettxinfo fixture; use real provider read',
              result: null,
            };
          if (
            exactKeys(['module', 'action']) &&
            ((action === 'eth_block_number' &&
              url.searchParams.get('module') === 'block') ||
              (action === 'eth_blockNumber' &&
                url.searchParams.get('module') === 'proxy'))
          )
            body = { status: '1', message: 'OK', result: '0x2a' };
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
      const value = page.locator(VALUE_SELECTOR);
      const back = page.getByRole('button', {
        name: en.buttons.back,
        exact: true,
      });
      const listLabel = (tokenId: string) =>
        'NFT #' + (tokenId.length > 8 ? tokenId.slice(0, 6) + '...' : tokenId);
      const detailButton = (tokenId: string) =>
        activity
          .getByText(listLabel(tokenId), { exact: true })
          .locator(
            'xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," border-b ")][1]'
          )
          .getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          });
      const unchanged = async () =>
        expect(await publicState(page)).toEqual(baseline);
      const screenshot = async (label: string) => {
        await settle(page);
        const file = info.outputPath(
          `${viewport.width}x${viewport.height}-${label}.png`
        );
        await page.screenshot({
          path: file,
          fullPage: false,
          caret: 'initial',
        });
        observations.originals.push({ label, path: file, viewport });
      };
      const expectedText = (tokenId: string) => `1 ${SYMBOL} #${tokenId}`;
      const readyDetails = async (index: number) => {
        await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
        await expect(value).toHaveText(expectedText(IDS[index]));
        await expect
          .poll(() =>
            rpcReads.some(
              (read) =>
                read.method === 'eth_getTransactionByHash' &&
                read.params[0] === HASHES[index]
            )
          )
          .toBe(true);
        await expect
          .poll(() =>
            rpcReads.some(
              (read) =>
                read.method === 'eth_getTransactionReceipt' &&
                read.params[0] === HASHES[index]
            )
          )
          .toBe(true);
        // mapApiTx deliberately omits gasUsed. This exact rendered field
        // therefore proves provider/receipt enrichment settled, not merely that
        // an RPC request started while the header still used its summary.
        const gasUsedRow = page
          .locator('#details-view-content')
          .getByText(en.transactionDisplay.gasUsed, { exact: true })
          .locator('..');
        const gasUsedText = await page.evaluate(() => (50000).toLocaleString());
        await expect(gasUsedRow).toHaveCount(1);
        await expect(
          gasUsedRow.getByText(gasUsedText, { exact: true })
        ).toHaveCount(1);
        observations.providerEnrichment ??= [];
        observations.providerEnrichment.push({
          hash: HASHES[index],
          label: en.transactionDisplay.gasUsed,
          gasUsedText,
        });
        // Ordinary pointer movement dismisses the source row's hover tooltip;
        // no tooltip DOM, focus, scroll position or animation is manufactured.
        await page.mouse.move(2, 2);
        await settle(page);
        const observed = await measureValue(page);
        expect(observed.value?.text).toBe(expectedText(IDS[index]));
        expect(observed.value?.fontStatus).toBe('loaded');
        return observed;
      };
      const revealValue = async () => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const bounds = await value.boundingBox();
          expect(bounds).not.toBeNull();
          if (bounds!.y >= 0 && bounds!.y + bounds!.height <= viewport.height)
            break;
          const dy = bounds!.y < 0 ? -64 : 64;
          await page.mouse.move(viewport.width / 2, viewport.height / 2);
          await page.mouse.wheel(0, dy);
          await frame(page);
        }
        const bounds = await value.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
        await settle(page);
      };
      await wallet.step(
        `${viewport.width}x${viewport.height} normal explorer Activity supplies two genuine outgoing NFT calldata rows without importing an asset`,
        async () => {
          // The harness's existing seed-field text-security mask is secret
          // sanitation only, not a candidate layout/style alteration.
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page.locator('#activity-btn').click();
          for (const tokenId of IDS)
            await expect(detailButton(tokenId)).toHaveCount(1);
          await expect(
            activity.getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            })
          ).toHaveCount(2);
          await expect
            .poll(async () => {
              const state = await publicState(page);
              return (
                state.history.length === 2 &&
                JSON.stringify(state.history) ===
                  JSON.stringify(state.savedHistory)
              );
            })
            .toBe(true);
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
          expect(baseline.savedNetwork).toEqual(baseline.network);
          expect(
            baseline.accounts
              .find(
                (account) => account.kind === 'HDAccount' && account.id === 0
              )
              ?.address.toLowerCase()
          ).toBe(owner);
          expect(baseline.savedAccounts).toEqual(baseline.accounts);
          expect(baseline.savedAssets).toEqual(baseline.assets);
          for (const family of baseline.assets)
            expect(family.assets).toEqual([]);
          expect(baseline.grants).toEqual([]);
          expect(baseline.savedGrants).toEqual([]);
          expect(baseline.currency).toBe('usd');
          expect(baseline.savedCurrency).toBe('usd');
          expect(baseline.language).toBe('en');
          expect(baseline.history).toEqual(
            txs
              .map((row, index) => ({
                hash: HASHES[index],
                from: owner,
                to: CONTRACT,
                input: row.explorer.input,
                value: '0',
                nonce: index + 1,
                chainId: 5700,
                blockNumber: 42,
                historySource: 'explorer-txlist',
              }))
              .sort((a, b) => a.hash.localeCompare(b.hash))
          );
          observations.baseline = baseline;
          observations.workerBefore = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (identity) => {
              observations.workerBefore = identity;
            }
          );
          await page.setViewportSize(viewport);
          await settle(page);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} short token7 is the healthy real pointer Details control with exact provider enrichment`,
        async () => {
          const button = detailButton('7');
          await expect(button).toHaveAttribute('type', 'button');
          await button.click();
          await readyDetails(0);
          await revealValue();
          const geometry = await measureValue(page);
          observations.initialHeaders.push({ tokenId: IDS[0], geometry });
          await screenshot('short-token7-initial-header');
          expect(geometry.value?.allGlyphsHorizontallyFit).toBe(true);
          expect(
            geometry.value?.glyphs.every(
              (glyph: any) => glyph.collapsedWhitespace || glyph.centerHit
            )
          ).toBe(true);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} genuine Tab and Enter on Back restore the exact unchanged Activity rows`,
        async () => {
          await tabTo(page, back);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          for (const tokenId of IDS)
            await expect(detailButton(tokenId)).toHaveCount(1);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} hash-derived uint256 identifier enters the real Details header without rounding`,
        async () => {
          await detailButton(LONG_ID).click();
          await readyDetails(1);
          await revealValue();
          observations.initialHeaders.push({
            tokenId: LONG_ID,
            geometry: await measureValue(page),
          });
          await screenshot('hash-derived-token-initial-header');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} native Back and keyboard Details reentry both retain the selected NFT identity before any horizontal gesture`,
        async () => {
          await back.click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          for (const tokenId of IDS)
            await expect(detailButton(tokenId)).toHaveCount(1);
          await unchanged();
          observations.priorActivity = await routeTuple(page);
          await tabTo(page, detailButton(LONG_ID));
          await page.keyboard.press('Enter');
          await readyDetails(1);
          await revealValue();
          observations.detailsEntry = await routeTuple(page);
          expect(observations.detailsEntry.idx).toBe(
            observations.priorActivity.idx + 1
          );
          expect(observations.detailsEntry.key).not.toBe(
            observations.priorActivity.key
          );
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} ordinary horizontal wheel recovery records real header or exact native prior-entry traversal without manufacturing data loss`,
        async () => {
          let prior = observations.priorActivity;
          let entry = observations.detailsEntry;
          for (const deltaX of [240, -240]) {
            // A previous genuine wheel may have traversed native browser history.
            // Reopen only by the actual existing Activity Details control, never
            // by a route/history setter, before delivering the next gesture.
            if ((await page.locator(VALUE_SELECTOR).count()) === 0) {
              expect(await routeTuple(page)).toEqual(prior);
              await unchanged();
              prior = await routeTuple(page);
              await detailButton(LONG_ID).click();
              await readyDetails(1);
              await revealValue();
              entry = await routeTuple(page);
              expect(entry.idx).toBe(prior.idx + 1);
              expect(entry.key).not.toBe(prior.key);
            } else {
              expect(await routeTuple(page)).toEqual(entry);
            }
            const point = await page.evaluate((selector) => {
              const node = document.querySelector(
                selector
              ) as HTMLElement | null;
              const detailsOwner = document.querySelector(
                '#details-view-content'
              );
              if (!node || !detailsOwner) return null;
              const rect = node.getBoundingClientRect();
              const x = innerWidth / 2;
              const y = Math.max(
                1,
                Math.min(innerHeight - 1, rect.top + rect.height / 2)
              );
              const hit = document.elementFromPoint(x, y);
              return {
                x,
                y,
                reachesDetails:
                  !!hit && (hit === detailsOwner || detailsOwner.contains(hit)),
              };
            }, VALUE_SELECTOR);
            expect(point?.reachesDetails).toBe(true);
            await page.mouse.move(point!.x, point!.y);
            await page.mouse.wheel(deltaX, 0);
            await frame(page);
            await page.mouse.move(2, 2);
            await settle(page);
            const geometry = await measureValue(page);
            const atDetails =
              JSON.stringify(geometry.route) === JSON.stringify(entry);
            const atExactPrior =
              JSON.stringify(geometry.route) === JSON.stringify(prior);
            expect(atDetails || atExactPrior).toBe(true);
            if (atDetails)
              expect(geometry.value?.text).toBe(expectedText(LONG_ID));
            else expect(geometry.value).toBeNull();
            observations.horizontalRecovery.push({
              deltaX,
              point,
              prior,
              entry,
              atDetails,
              atExactPrior,
              geometry,
            });
            await screenshot(
              `hash-derived-token-wheel-${deltaX > 0 ? 'positive' : 'negative'}`
            );
            await unchanged();
          }
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} exact source worker public live and saved scope plus strict no-write network fences precede any presentation candidate`,
        async () => {
          await unchanged();
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (identity) => {
              observations.workerAfter = identity;
            }
          );
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
          expect(observations.initialHeaders).toHaveLength(2);
          expect(observations.horizontalRecovery).toHaveLength(2);
          for (const hash of HASHES) {
            expect(
              rpcReads.some(
                (read) =>
                  read.method === 'eth_getTransactionByHash' &&
                  read.params[0] === hash
              )
            ).toBe(true);
            expect(
              rpcReads.some(
                (read) =>
                  read.method === 'eth_getTransactionReceipt' &&
                  read.params[0] === hash
              )
            ).toBe(true);
          }
          for (const method of ['name', 'symbol', 'supportsInterface']) {
            const data =
              method === 'supportsInterface'
                ? nft.encodeFunctionData(method, ['0x80ac58cd'])
                : nft.encodeFunctionData(method);
            expect(
              rpcReads.some(
                (read) =>
                  read.method === 'eth_call' &&
                  read.params[0].data.toLowerCase() === data.toLowerCase()
              )
            ).toBe(true);
          }
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} complete NFT header glyphs fit horizontally at the initial natural state after all healthy controls`,
        async () => {
          for (const observed of observations.initialHeaders) {
            expect(observed.geometry.value?.fontStatus).toBe('loaded');
            expect(observed.geometry.value?.text).toBe(
              expectedText(observed.tokenId)
            );
            expect(observed.geometry.value?.allGlyphsHorizontallyFit).toBe(
              true
            );
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('activity-nft-identifier-readability-evidence', {
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
            assetImported: false,
            controllerStateOrRepliesReplaced: false,
            runtimeTransportReplaced: false,
            candidateDOMStyleScrollFocusOrSelectionInjected: false,
            inheritedOnboardingMask:
              'existing seed-field secret sanitation only',
            signingApprovalDeploymentOrBroadcastRequested: false,
            originals:
              'explicit fullPage:false caret:initial natural frames; legacy step captures separate',
            noDataLossOrOnChainOwnershipClaim: true,
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
