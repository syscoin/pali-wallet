import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { Interface } from 'ethers';
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

// Real Send regression. Amount remains zero: no successful Next,
// confirmation preview, gas estimate, asset import, approval or signing occurs.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RPC = 'https://rpc.tanenbaum.io/';
const API = 'https://explorer.tanenbaum.io/api';
const MAINNET_RPC = 'https://ethereum-rpc.publicnode.com/';
const UNIVERSAL = '0xeeeeeeee14d718c2b47d9923deab1335e144eeee';
const RECEIVER = '#send-form .sender-custom-input input';
const AMOUNT = '#with-max-button';
const MALFORMED = 'not-an-address';
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
      ? 'http://send-receiver-denied.invalid/'
      : 'send-receiver-denied.invalid:443';
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
        `${method} ${target} HTTP/1.0\r\nHost: send-receiver-denied.invalid\r\nConnection: close\r\n\r\n`
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
      ensMainnet: {
        chainId: live.vaultGlobal.networks.ethereum[1].chainId,
        kind: live.vaultGlobal.networks.ethereum[1].kind,
        url: live.vaultGlobal.networks.ethereum[1].url,
      },
      ensNames: Object.entries(live.vaultGlobal.ensCache || {})
        .map(([address, entry]: [string, any]) => ({
          address,
          name: entry.name,
        }))
        .sort((a, b) => a.address.localeCompare(b.address)),
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

const fieldEvidence = async (page: Page, selector: string) => {
  const input = page.locator(selector);
  await expect(input).toHaveCount(1);
  const dom = await input.evaluate((node) => {
    const field = node as HTMLInputElement;
    const item = field.closest('.ant-form-item')!;
    const content = item.querySelector('.ant-form-item-control-input-content');
    const wrapper = content?.firstElementChild;
    const visible = (element: Element) => {
      const r = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      return (
        r.width > 0 &&
        r.height > 0 &&
        css.display !== 'none' &&
        css.visibility !== 'hidden'
      );
    };
    const attributes = (element: Element) => ({
      tag: element.tagName,
      id: element.id,
      invalid: element.getAttribute('aria-invalid'),
      required: element.getAttribute('aria-required'),
      describedBy: element.getAttribute('aria-describedby'),
      errorMessage: element.getAttribute('aria-errormessage'),
    });
    return {
      ...attributes(field),
      value: field.value,
      type: field.type,
      placeholder: field.placeholder,
      labels: Array.from(field.labels || []).map((label) =>
        label.textContent?.trim()
      ),
      wrapper: wrapper ? attributes(wrapper) : null,
      box: field.getBoundingClientRect().toJSON(),
      nearbyText: (item as HTMLElement).innerText,
      references: ['aria-describedby', 'aria-errormessage'].flatMap(
        (attribute) =>
          (field.getAttribute(attribute) || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => {
              const element = document.getElementById(id);
              return {
                attribute,
                id,
                text: element?.textContent?.trim() || '',
                visible: !!element && visible(element),
              };
            })
      ),
      liveNodes: Array.from(item.querySelectorAll('[role="alert"],[aria-live]'))
        .filter(visible)
        .map((element) => ({
          role: element.getAttribute('role'),
          live: element.getAttribute('aria-live'),
          text: element.textContent?.trim() || '',
        })),
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
    const field = nodes.find(
      (node) =>
        ['textbox', 'spinbutton'].includes(String(node.role?.value)) &&
        !node.ignored
    );
    expect(field).toBeDefined();
    return {
      dom,
      native: {
        role: field!.role?.value,
        name: field!.name?.value || '',
        description: field!.description?.value || '',
        properties: Object.fromEntries(
          (field!.properties || []).map((property) => [
            property.name,
            property.value?.value ?? null,
          ])
        ),
      },
    };
  } finally {
    await cdp.detach();
  }
};
const feedbackGeometry = (target: Locator) =>
  target.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const css = getComputedStyle(node),
        box = node.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          box.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          box.top + node.clientTop + node.clientHeight
        );
      }
    }
    const footer = document
      .querySelector('#send-eth-next-btn')
      ?.closest('.fixed');
    if (footer)
      clip.bottom = Math.min(clip.bottom, footer.getBoundingClientRect().top);
    const center = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    return {
      box: r.toJSON(),
      clip,
      visible:
        r.width > 0 &&
        r.height > 0 &&
        r.left >= clip.left - 0.5 &&
        r.right <= clip.right + 0.5 &&
        r.top >= clip.top - 0.5 &&
        r.bottom <= clip.bottom + 0.5 &&
        !!center &&
        (center === element || element.contains(center)),
    };
  });
const revealFeedback = async (page: Page, target: Locator) => {
  await settle(page);
  for (let count = 0; count < 16; count += 1) {
    const current = await feedbackGeometry(target);
    if (current.visible) return current;
    const viewport = page.viewportSize()!;
    const delta = current.box.top < current.clip.top ? -80 : 80;
    const point = await page.evaluate(() => {
      const owner = document.querySelector(
        '[data-navigation-scroll="wallet-layout"]'
      );
      const x = innerWidth - 8,
        y = innerHeight / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        owned: !!owner && !!hit && (hit === owner || owner.contains(hit)),
      };
    });
    expect(point.owned).toBe(true);
    expect(point.x).toBeLessThan(viewport.width);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, delta);
    await settle(page);
  }
  const geometry = await feedbackGeometry(target);
  expect(geometry.visible).toBe(true);
  return geometry;
};

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`ordinary EVM recipient errors describe the actual native field at ${viewport.width}x${viewport.height}`, async ({}, info) => {
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
    for (const hash of Object.values(runtime.bundleHashes))
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const ownerAddress = fixture.evmAddresses[0],
      owner = ownerAddress.toLowerCase();
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
    const universal = new Interface([
      'function reverse(bytes name,uint256 coinType) view returns (string primary,address resolver,address reverseResolver)',
      'error ResolverNotFound(bytes name)',
    ]);
    const reverseData = universal
      .encodeFunctionData('reverse', [owner, 60])
      .toLowerCase();
    const reverseError = universal.encodeErrorResult('ResolverNotFound', [
      owner,
    ]);
    const block = {
      number: '0x1',
      hash: '0x' + '11'.repeat(32),
      parentHash: '0x' + '00'.repeat(32),
      nonce: '0x0000000000000000',
      timestamp: '0x65000000',
      difficulty: '0x0',
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      miner: '0x' + '00'.repeat(20),
      extraData: '0x',
      transactions: [],
      baseFeePerGas: '0x3b9aca00',
    };
    const rpcReads: any[] = [],
      httpReads: any[] = [],
      unsupported: any[] = [];
    const writes: string[] = [],
      httpFailures: any[] = [],
      pageErrors: string[] = [];
    const denialCanaries: any[] = [];
    let fulfilledNegativeReverses = 0;
    const observations: Record<string, any> = {
      runtime,
      sourceSha256,
      viewport,
      fields: [],
      originals: [],
      routes: [],
      receiverSelector: RECEIVER,
      amountSelector: AMOUNT,
      nativeENSNegativeOnly: {
        origin: MAINNET_RPC,
        target: UNIVERSAL,
        reverseData,
        reverseError,
      },
    };
    let wallet: PaliWallet | undefined;
    let baseline!: Awaited<ReturnType<typeof publicState>>;
    let status: 'passed' | 'failed' = 'failed';
    const server = await startUtxoFixtureServer();
    try {
      expect(server.blocked).toEqual([]);
      denialCanaries.push(await proxyDenial(server, 'GET'));
      denialCanaries.push(await proxyDenial(server, 'CONNECT'));
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'SendReceiverFeedbackSynthetic!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: 'Syscoin NEVM Testnet',
      });
      wallet = await PaliWallet.launch(
        `send-receiver-feedback-${viewport.width}x${viewport.height}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      await wallet.context.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol))
          return route.continue();
        if (url.username || url.password || url.hash) {
          unsupported.push({ kind: 'url', url: url.href });
          return route.abort('blockedbyclient');
        }
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* ordinary GET */
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
          writes.push('attempted-write:' + url.href);
          return route.abort('blockedbyclient');
        }
        if ([RPC, MAINNET_RPC].includes(url.href)) {
          if (
            request.method() !== 'POST' ||
            !calls.length ||
            calls.length > 20
          ) {
            unsupported.push({
              kind: 'rpc-envelope',
              method: request.method(),
              url: url.href,
            });
            return route.abort('blockedbyclient');
          }
          const replies = calls.map((call: any) => {
            const valid =
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
            if (!valid) {
              unsupported.push({ kind: 'rpc-envelope' });
              return undefined;
            }
            const params = call.params;
            let result: unknown,
              error:
                | { code: number; data: string; message: string }
                | undefined;
            if (url.href === MAINNET_RPC) {
              // Source constants + MainController getEnsMainnetProvider choose
              // this exact origin. The one ordinary local-owner negative lookup
              // never requests forward resolution or publishes an ENS name.
              if (call.method === 'eth_chainId' && params.length === 0)
                result = '0x1';
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
                params[0].to.toLowerCase() === UNIVERSAL &&
                typeof params[0].data === 'string' &&
                params[0].data.toLowerCase() === reverseData
              )
                error = {
                  code: 3,
                  message: 'execution reverted',
                  data: reverseError,
                };
            } else {
              if (params.length === 0) {
                if (call.method === 'eth_chainId') result = '0x1644';
                if (call.method === 'net_version') result = '5700';
                if (call.method === 'eth_blockNumber') result = '0x1';
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
                typeof params[0] === 'string' &&
                params[0].toLowerCase() === owner &&
                params[1] === 'latest'
              )
                result = '0x0';
              // Successful empty ordinary history scans fixed tip1 blocks0/1.
              if (
                call.method === 'eth_getBlockByNumber' &&
                params.length === 2 &&
                ['0x0', '0x1'].includes(params[0]) &&
                params[1] === true
              )
                result = {
                  number: params[0],
                  timestamp: '0x1',
                  transactions: [],
                };
              // Successful Send fee prefetch only: gasPrice -> latest block ->
              // priorityFee. No estimateGas, feeHistory or token reads admitted.
              if (
                call.method === 'eth_getBlockByNumber' &&
                params.length === 2 &&
                params[0] === 'latest' &&
                params[1] === false
              )
                result = block;
            }
            if (result === undefined && error === undefined) {
              unsupported.push({
                kind: 'rpc-read',
                url: url.href,
                method: call.method,
                params,
              });
              return undefined;
            }
            rpcReads.push({
              url: url.href,
              method: call.method,
              params,
              expectedNegativeReverse: !!error,
            });
            return {
              jsonrpc: '2.0',
              id: call.id,
              ...(error ? { error } : { result }),
            };
          });
          if (replies.some((reply: any) => reply === undefined))
            return route.abort('blockedbyclient');
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
          });
          // Count only successfully fulfilled wire responses, not request
          // arrival. This is transport evidence, not a replaced controller ack.
          if (url.href === MAINNET_RPC)
            fulfilledNegativeReverses += replies.filter(
              (reply: any) => reply?.error?.data === reverseError
            ).length;
          return;
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
          const action = url.searchParams.get('action') || '',
            pending = action === 'pendingtxlist';
          if (
            ['txlist', 'tokentx', 'pendingtxlist'].includes(action) &&
            url.searchParams.get('module') === 'account' &&
            url.searchParams.get('address')?.toLowerCase() === owner &&
            (pending || url.searchParams.get('sort') === 'desc') &&
            exactKeys([
              'module',
              'action',
              'address',
              ...(pending ? [] : ['sort']),
            ])
          )
            body = {
              status: '0',
              message: 'No transactions found',
              result: [],
            };
          if (
            action === 'tokenlist' &&
            url.searchParams.get('module') === 'account' &&
            url.searchParams.get('address')?.toLowerCase() === owner &&
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
            body = { status: '1', message: 'OK', result: '0x1' };
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
      page.on('framenavigated', (navigationFrame) => {
        if (navigationFrame === page.mainFrame())
          observations.routes.push(new URL(navigationFrame.url()).hash);
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          httpFailures.push({ method: request.method(), url: request.url() });
      });
      const receiver = page.locator(RECEIVER),
        amount = page.locator(AMOUNT);
      const next = page.locator('#send-eth-next-btn');
      const unchanged = async () =>
        expect(await publicState(page)).toEqual(baseline);
      const negativeCount = () => fulfilledNegativeReverses;
      const screenshot = async (label: string) => {
        await page.mouse.move(2, 2);
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
      const requireZeroAmount = async () => {
        await expect(amount).toHaveValue('0');
        await expect(page).toHaveURL(/#\/send\/eth(?:\?.*)?$/);
      };
      const triggerInvalidNext = async () => {
        await requireZeroAmount();
        await expect(next).toBeEnabled();
        await next.click();
        await requireZeroAmount();
      };
      const observeError = async (phase: string, message: string) => {
        const feedback = page.getByText(message, { exact: true });
        await expect(feedback).toHaveCount(1);
        await expect(feedback).toBeVisible();
        const geometry = await revealFeedback(page, feedback);
        const observed = {
          phase,
          message,
          receiver: await fieldEvidence(page, RECEIVER),
          amount: await fieldEvidence(page, AMOUNT),
          geometry,
        };
        expect(observed.receiver.dom.nearbyText).toContain(message);
        expect(observed.receiver.dom.value).toBe(
          phase === 'required' ? '' : MALFORMED
        );
        expect(observed.amount.dom.value).toBe('0');
        observations.fields.push(observed);
        await screenshot(phase + '-receiver-error-and-native-field');
        await unchanged();
        return observed;
      };
      await wallet.step(
        `${viewport.width}x${viewport.height} genuine onboarding network and Send entry establish empty public inventory and untouched field state`,
        async () => {
          // The harness masks only the seed field as existing secret sanitation.
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await expect
            .poll(async () => {
              const current = await publicState(page);
              return (
                current.history.length === 0 &&
                current.savedHistory.length === 0 &&
                JSON.stringify(current.accounts) ===
                  JSON.stringify(current.savedAccounts) &&
                JSON.stringify(current.assets) ===
                  JSON.stringify(current.savedAssets)
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
          expect(baseline.ensMainnet).toEqual({
            chainId: 1,
            kind: 'ethereum',
            url: MAINNET_RPC.slice(0, -1),
          });
          expect(baseline.accounts).toHaveLength(1);
          expect(baseline.accounts[0].address.toLowerCase()).toBe(owner);
          expect(baseline.savedAccounts).toEqual(baseline.accounts);
          expect(baseline.savedAssets).toEqual(baseline.assets);
          for (const family of baseline.assets)
            expect(family.assets).toEqual([]);
          expect(baseline.grants).toEqual([]);
          expect(baseline.savedGrants).toEqual([]);
          expect(baseline.ensNames).toEqual([]);
          expect(baseline.currency).toBe('usd');
          expect(baseline.savedCurrency).toBe('usd');
          expect(baseline.language).toBe('en');
          observations.baseline = baseline;
          observations.workerBefore = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (identity) => {
              observations.workerBefore = identity;
            }
          );
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/eth(?:\?.*)?$/);
          await expect(receiver).toHaveCount(1);
          await expect(amount).toHaveCount(1);
          await expect(next).toBeEnabled();
          await page.setViewportSize(viewport);
          await settle(page);
          observations.fresh = {
            receiver: await fieldEvidence(page, RECEIVER),
            amount: await fieldEvidence(page, AMOUNT),
          };
          expect(observations.fresh.receiver.dom.value).toBe('');
          expect(observations.fresh.receiver.dom.invalid).not.toBe('true');
          expect(observations.fresh.amount.dom.invalid).not.toBe('true');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} malformed nonENS receiver stays blocked and direct Amount proves the primary native AX extractor`,
        async () => {
          await receiver.fill(MALFORMED);
          await amount.fill('0');
          await triggerInvalidNext();
          await expect(
            page.getByText(en.send.invalidAmount, { exact: true })
          ).toBeVisible();
          const observed = await observeError(
            'malformed',
            en.send.invalidEthAddress
          );
          // Same actual Send form, same native CDP query, positive associated
          // Amount control: missing receiver description is never inferred from
          // an ariaSnapshot serializer's omission.
          expect(observed.amount.dom.invalid).toBe('true');
          expect(
            observed.amount.dom.references.some(
              (ref: any) =>
                ref.visible && ref.text.includes(en.send.invalidAmount)
            )
          ).toBe(true);
          expect(observed.amount.native.description).toContain(
            en.send.invalidAmount
          );
          expect(observed.amount.native.properties.invalid).toBe('true');
          expect(negativeCount()).toBe(0);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} native required-empty validation remains visible without progressing to preview`,
        async () => {
          await receiver.fill('');
          await triggerInvalidNext();
          await observeError('required', en.send.addressRequired);
          expect(negativeCount()).toBe(0);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} ordinary Tab and Enter choose the exact local account then complete the real finite negative reverse lookup`,
        async () => {
          await receiver.click();
          const label =
            baseline.accounts[0].label || baseline.accounts[0].address;
          const choice = page.getByRole('button', {
            name: `${label}, ${ownerAddress}, ${en.transactions.account}`,
            exact: true,
          });
          await expect(choice).toHaveCount(1);
          await tabTo(page, choice);
          await page.keyboard.press('Enter');
          await expect(receiver).toHaveValue(ownerAddress);
          await expect(page.locator('.sender-custom-input button')).toHaveCount(
            0
          );
          await expect(
            page.getByText(en.send.addressRequired, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(en.send.invalidEthAddress, { exact: true })
          ).toHaveCount(0);
          // Do not race Close against the source's600ms timer. This exact real
          // negative response must arrive; no ENS name is injected or published.
          await expect.poll(() => negativeCount()).toBeGreaterThanOrEqual(1);
          observations.corrected = await fieldEvidence(page, RECEIVER);
          expect(observations.corrected.dom.value).toBe(ownerAddress);
          expect(observations.corrected.dom.invalid).not.toBe('true');
          await requireZeroAmount();
          await screenshot('native-local-account-correction');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} genuine Close and Send reopening remain usable with current malformed input and zero amount`,
        async () => {
          const close = page.getByRole('button', {
            name: en.buttons.close,
            exact: true,
          });
          await expect(close).toHaveCount(1);
          await close.click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged();
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/eth(?:\?.*)?$/);
          await expect(next).toBeEnabled();
          observations.reopenedBeforeEditing = {
            receiver: await receiver.inputValue(),
            amount: await amount.inputValue(),
          };
          // Observe current draft behavior honestly, then use ordinary input to
          // establish this phase. No different draft-restoration policy is assumed.
          await receiver.fill(MALFORMED);
          await amount.fill('0');
          await triggerInvalidNext();
          await observeError('reentered-malformed', en.send.invalidEthAddress);
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} all exact public scope worker source finite-wire and no-write gates precede receiver association candidate`,
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
          expect(observations.fields).toHaveLength(3);
          expect(denialCanaries).toHaveLength(2);
          expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
          expect(
            server.blocked.every(
              (method) => method === 'GET' || method === 'CONNECT'
            )
          ).toBe(true);
          expect(unsupported).toEqual([]);
          expect(writes).toEqual([]);
          expect(httpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(
            observations.routes.some((route: string) =>
              /\/send\/confirm/.test(route)
            )
          ).toBe(false);
          expect(
            rpcReads.some((read) => read.method === 'eth_estimateGas')
          ).toBe(false);
          for (const method of ['eth_gasPrice', 'eth_maxPriorityFeePerGas'])
            expect(
              rpcReads.some(
                (read) =>
                  read.url === RPC &&
                  read.method === method &&
                  read.params.length === 0
              )
            ).toBe(true);
          expect(
            rpcReads.some(
              (read) =>
                read.url === RPC &&
                read.method === 'eth_getBlockByNumber' &&
                read.params[0] === 'latest' &&
                read.params[1] === false
            )
          ).toBe(true);
          expect(negativeCount()).toBeGreaterThanOrEqual(1);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height} actual invalid recipient input exposes its current visible guidance as native field description`,
        async () => {
          for (const observed of observations.fields) {
            expect(
              observed.receiver.dom.references.some(
                (ref: any) => ref.visible && ref.text.includes(observed.message)
              )
            ).toBe(true);
            expect(observed.receiver.native.description).toContain(
              observed.message
            );
            expect(observed.receiver.dom.invalid).toBe('true');
            expect(observed.receiver.native.properties.invalid).toBe('true');
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('send-recipient-native-feedback-observations', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            rpcReads,
            httpReads,
            unsupported,
            writes,
            negativeReverseResponsesFulfilled: fulfilledNegativeReverses,
            httpFailures,
            pageErrors,
            denialCanaries,
            proxyDeniedMethods: server.blocked,
            syntheticHttpOnly: true,
            controllerOrStoreOrRepliesReplaced: false,
            runtimeTransportReplaced: false,
            assetImportRequested: false,
            signingApprovalOrBroadcastRequested: false,
            connectionGranted: false,
            successfulNextOrPreviewRequested: false,
            gasEstimateRequested: false,
            amountAlwaysZeroWhenNextActivated: true,
            focusScrollSelectionClockRouteOrStyleSetterUsed: false,
            inheritedOnboardingMask:
              'existing seed-field secret sanitation only',
            primaryAXDescriptionReadDirectly: true,
            auditoryScreenReaderClaim: false,
            originals:
              'explicit fullPage:false caret:initial natural frames; legacy step captures separate',
            nativeFieldMetadataMeasured: true,
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
