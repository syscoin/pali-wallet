import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { Interface } from 'ethers';
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
import { sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Normal malformed ERC-1155 ID guidance with healthy quantity and read-recovery
// controls. The synthetic collection is never imported. Only source-backed HTTP
// replies vary; no controller/renderer/state, entropy, focus or scroll setter,
// signing, approval, Next or token mutation is used.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'READ1155';
const QUANTITY = '9007199254740993';
const MALFORMED = 'not-a-uint256';
const RPC = 'https://rpc.tanenbaum.io';
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'function symbol() view returns (string)',
]);

const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return url.origin + url.pathname + (query.size ? '?' + query : '');
};

const publicScope = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state']);
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
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, families]: [string, any]) => ({
            kind,
            id: Number(id),
            families: Object.entries(families || {}).map(
              ([family, values]) => ({
                family,
                values: (values as any[]).map((asset: any) => ({
                  id: asset.id,
                  address: asset.contractAddress,
                  chainId: asset.chainId,
                  symbol: asset.tokenSymbol || asset.symbol,
                  balance: asset.balance,
                  decimals: asset.decimals,
                  standard: asset.tokenStandard,
                  tokenId: asset.tokenId,
                  isNft: asset.isNft,
                })),
              })
            ),
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
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
      active: state.vault.activeAccount,
      savedActive: disk[key]?.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
        platform: state.vault.activeNetwork.coingeckoPlatformId || null,
      },
      slip44: state.vaultGlobal.activeSlip44,
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(disk[key]),
      liveAssets: assets(state.vault),
      savedAssets: assets(disk[key]),
      liveGrants: grants(state.dapp?.dapps),
      savedGrants: grants(disk.state?.dapp?.dapps),
    };
  });

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

const tabTo = async (page: Page, target: Locator, reverse = false) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 32; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
};

async function fieldEvidence(page: Page, input: Locator) {
  const dom = await input.evaluate((node) => {
    const field = node as HTMLInputElement;
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        css.display !== 'none' &&
        css.visibility !== 'hidden'
      );
    };
    const referenced = ['aria-describedby', 'aria-errormessage'].flatMap(
      (attribute) =>
        (field.getAttribute(attribute) || '')
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => {
            const element = document.getElementById(id);
            const rect = element?.getBoundingClientRect();
            return {
              attribute,
              id,
              text: element?.textContent?.trim() || '',
              visible: !!element && visible(element),
              fullyVisible:
                !!rect &&
                rect.top >= 0 &&
                rect.left >= 0 &&
                rect.bottom <= innerHeight &&
                rect.right <= innerWidth,
            };
          })
    );
    const container = field.parentElement!.parentElement!;
    return {
      value: field.value,
      invalid: field.getAttribute('aria-invalid'),
      referenced,
      label: Array.from(field.labels || []).map((label) =>
        label.textContent?.trim()
      ),
      box: field.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      nearbyText: container.innerText,
      images: Array.from(container.querySelectorAll('[role="img"]')).map(
        (icon) => ({
          name: icon.getAttribute('aria-label'),
          title: icon.getAttribute('title'),
        })
      ),
      alerts: Array.from(container.querySelectorAll('[role="alert"]'))
        .filter(visible)
        .map((alert) => alert.textContent?.trim() || ''),
    };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#custom-token-id',
    });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    });
    const field = nodes.find(
      (node) => node.role?.value === 'textbox' && !node.ignored
    );
    expect(field).toBeDefined();
    return {
      ...dom,
      native: {
        role: field!.role!.value,
        name: field!.name?.value || '',
        description: field!.description?.value || '',
        invalid:
          field!.properties?.find((property) => property.name === 'invalid')
            ?.value?.value ?? null,
      },
    };
  } finally {
    await cdp.detach();
  }
}

test('manual ERC1155 token ID guidance distinguishes malformed input from healthy quantities and failed reads', async ({}, info) => {
  test.setTimeout(180_000); // Same bounded carrier budget as tokenImportTabSelection.
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
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG },
    fixture = createIsolatedVaultFixture();
  const owner = fixture.evmAddresses[0].toLowerCase();
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
  const auxiliary = new Map<string, unknown>([
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
  const addRead = (url: string, body: unknown) =>
    auxiliary.set(requestKey(new URL(url)), body);
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
  for (const origin of [
    'https://blockbook.syscoin.org',
    'https://blockbook-dev.syscoin.org',
  ])
    addRead(origin + '/api/v2/tickers/currency', {
      ts: 1,
      rates: { usd: 1, eur: 0.2 },
    });
  for (const query of [
    'details=tokenBalances&tokens=used',
    'details=txsummary&pageSize=30',
    'details=tokenBalances&tokens=nonzero',
    'details=txslight&pageSize=30',
  ])
    addRead(
      'https://blockbook.syscoin.org/api/v2/xpub/' + initialXpub + '?' + query,
      emptyInventory
    );
  addRead(
    'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
    {
      // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
      syscoin: { usd: 0.125, usd_24h_change: 0 },
    }
  );
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
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenFeedbackSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  type OwnershipPhase = {
    batchCalls: number;
    detectorId: string | null;
    failed: boolean;
    hold: boolean;
    id: '7' | '8' | '9';
    individualCalls: number;
    label: string;
  };
  let phase: OwnershipPhase | null = null;
  const ownershipPhases: OwnershipPhase[] = [];
  const ownershipReads: {
    failed: boolean;
    id: string;
    kind: 'detector' | 'batch' | 'individual';
    phase: string;
  }[] = [];
  const held: (() => void)[] = [];
  const arm = (
    label: string,
    id: '7' | '8' | '9',
    failed = false,
    hold = false
  ) => {
    expect(held).toHaveLength(0);
    phase = {
      batchCalls: 0,
      detectorId: null,
      failed,
      hold,
      id,
      individualCalls: 0,
      label,
    };
    ownershipPhases.push(phase);
  };
  const reads: { method: string; params: unknown[] }[] = [];
  const unsupported: unknown[] = [],
    writes: string[] = [],
    pageErrors: string[] = [];
  const observations: Record<string, any> = {
    runtime,
    testSourceSha256,
    states: [],
  };
  const release = () => {
    if (phase) phase.hold = false;
    held.splice(0).forEach((done) => done());
  };
  try {
    observations.physicalCanaries = [
      await physicalDenial(server, 'GET'),
      await physicalDenial(server, 'CONNECT'),
    ];
    wallet = await PaliWallet.launch('erc1155-token-id-guidance', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url,
      (url) => auxiliary.get(requestKey(url))
    );
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => pageErrors.push(error.message))
    );
    // Last registered => evaluated before the legacy method-only EVM fixture.
    await wallet.context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.fallback();
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
      if (url.origin !== RPC) {
        const recognized =
          request.method() === 'GET' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          (auxiliary.has(requestKey(url)) ||
            sptFixtureRead(fixture.utxo, request.url(), request.method()) !==
              undefined);
        if (recognized) return route.fallback();
        unsupported.push({
          method: request.method(),
          origin: url.origin,
          path: url.pathname,
        });
        return route.abort('blockedbyclient');
      }
      const replies: any[] = [];
      let valid =
        request.method() === 'POST' &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password &&
        calls.length > 0;
      for (const call of calls) {
        let result: unknown;
        let readError = false;
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
        const params = call.params;
        if (params.length === 0) {
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'net_version') result = '5700';
          if (call.method === 'eth_blockNumber') result = '0x1';
        }
        // MainController's ordinary background history refresh still scans
        // empty EOAs after an empty explorer result. With the fixed tip0x1,
        // transactions/utils.ts requests only these two full empty blocks.
        if (
          call.method === 'eth_getBlockByNumber' &&
          params.length === 2 &&
          ['0x0', '0x1'].includes(params[0]) &&
          params[1] === true
        )
          result = { number: params[0], timestamp: '0x1', transactions: [] };
        if (
          ['eth_getBalance', 'eth_getTransactionCount'].includes(call.method) &&
          params.length === 2 &&
          typeof params[0] === 'string' &&
          params[0].toLowerCase() === owner &&
          params[1] === 'latest'
        )
          result = '0x0';
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
          Object.keys(params[0]).every((key) => ['to', 'data'].includes(key)) &&
          String(params[0].to).toLowerCase() === CONTRACT &&
          typeof params[0].data === 'string'
        ) {
          const data = params[0].data.toLowerCase();
          if (
            data === abi.encodeFunctionData('supportsInterface', ['0x80ac58cd'])
          )
            result = abi.encodeFunctionResult('supportsInterface', [false]);
          if (
            data === abi.encodeFunctionData('supportsInterface', ['0xd9b67a26'])
          )
            result = abi.encodeFunctionResult('supportsInterface', [true]);
          if (data === abi.encodeFunctionData('name'))
            result = abi.encodeFunctionResult('name', [
              'Synthetic Read Editions',
            ]);
          if (data === abi.encodeFunctionData('symbol'))
            result = abi.encodeFunctionResult('symbol', [SYMBOL]);

          // nft-utils.ts uses one real entropy-generated uint256 negative probe
          // before the requested batch. No entropy/result replacement is used.
          // Admit that one canonical owner-only balance read per armed UI phase,
          // not arbitrary selectors, owners, contract targets or repeated IDs.
          const decoded = (() => {
            try {
              return abi.parseTransaction({ data });
            } catch {
              return null;
            }
          })();
          if (phase && decoded?.name === 'balanceOf') {
            const account = String(decoded.args[0]).toLowerCase();
            const id = decoded.args[1].toString();
            const canonical = abi
              .encodeFunctionData('balanceOf', [account, id])
              .toLowerCase();
            if (account === owner && data === canonical) {
              if (
                id !== phase.id &&
                !['7', '8'].includes(id) &&
                phase.detectorId === null &&
                phase.batchCalls === 0 &&
                phase.individualCalls === 0
              ) {
                phase.detectorId = id;
                ownershipReads.push({
                  failed: false,
                  id,
                  kind: 'detector',
                  phase: phase.label,
                });
                result = abi.encodeFunctionResult('balanceOf', [0]);
              } else if (
                id === phase.id &&
                phase.failed &&
                phase.detectorId !== null &&
                phase.batchCalls === 1 &&
                phase.individualCalls === 0
              ) {
                phase.individualCalls += 1;
                ownershipReads.push({
                  failed: true,
                  id,
                  kind: 'individual',
                  phase: phase.label,
                });
                result = abi.encodeFunctionResult('balanceOf', [0]);
                readError = true;
              }
            }
          }
          if (phase && decoded?.name === 'balanceOfBatch') {
            const accounts = Array.from(decoded.args[0], String);
            const ids = Array.from(decoded.args[1], String);
            const canonical = abi
              .encodeFunctionData('balanceOfBatch', [accounts, ids])
              .toLowerCase();
            if (
              accounts.length === 1 &&
              accounts[0].toLowerCase() === owner &&
              ids.length === 1 &&
              ids[0] === phase.id &&
              data === canonical &&
              phase.detectorId !== null &&
              phase.batchCalls === 0 &&
              phase.individualCalls === 0
            ) {
              const current = phase;
              current.batchCalls += 1;
              ownershipReads.push({
                failed: current.failed,
                id: current.id,
                kind: 'batch',
                phase: current.label,
              });
              if (current.hold)
                await new Promise<void>((done) => held.push(done));
              result = abi.encodeFunctionResult('balanceOfBatch', [
                [current.id === '9' ? '0' : QUANTITY],
              ]);
              readError = current.failed;
            }
          }
        }
        if (result === undefined) valid = false;
        replies.push(
          readError
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: {
                  code: -32000,
                  message: 'Synthetic ownership read unavailable',
                },
              }
            : { jsonrpc: '2.0', id: call.id, result }
        );
      }
      if (!valid || replies.length !== calls.length) {
        unsupported.push({
          method: request.method(),
          origin: url.origin,
          path: url.pathname,
          methods: calls.map((call: any) => call?.method || null),
          blockReadShapes: calls
            .filter((call: any) => call?.method === 'eth_getBlockByNumber')
            .map((call: any) => ({
              keys: Object.keys(call).sort(),
              params:
                Array.isArray(call.params) &&
                call.params.length === 2 &&
                typeof call.params[0] === 'string' &&
                /^(?:latest|pending|earliest|0x[a-f0-9]{1,16})$/i.test(
                  call.params[0]
                ) &&
                typeof call.params[1] === 'boolean'
                  ? call.params
                  : 'redacted unsupported shape',
            })),
        });
        return route.abort('blockedbyclient');
      }
      reads.push(
        ...calls.map((call: any) => ({
          method: call.method,
          params: call.params,
        }))
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    observations.workerBefore = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerBefore = identity;
      }
    );
    const page = wallet.page;
    const contract = page.locator('#custom-token-contract');
    const input = page.locator('#custom-token-id');
    const importControl = page.getByRole('button', {
      name: `Import ${SYMBOL} token`,
      exact: true,
    });
    const close = page.getByRole('button', {
      name: en.buttons.close,
      exact: true,
    });
    const retry = page.getByRole('button', {
      name: en.receive.retry,
      exact: true,
    });
    const exactBalance = en.tokens.balanceForTokenId.replace(
      '{{balance}}',
      QUANTITY
    );
    const openCustom = async () => {
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.home.importToken, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/tokens\/add(?:\?.*)?$/);
      const custom = page
        .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
        .and(page.locator('button[aria-pressed]'));
      await expect(custom).toHaveCount(1);
      await custom.click();
      await expect(custom).toHaveAttribute('aria-pressed', 'true');
      await expect(contract).toHaveAccessibleName(en.settings.contractAddress);
      await contract.fill(CONTRACT);
      await expect(input).toHaveAccessibleName(en.send.tokenId);
      await expect(input).toHaveValue('');
      await input.click();
      await expect(input).toBeFocused();
    };
    const settle = async () => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        );
      });
    };
    const record = async (
      state: string,
      capture: (target: Page) => Promise<void>
    ) => {
      await settle();
      const evidence = await fieldEvidence(page, input);
      observations.states.push({ state, ...evidence });
      expect(await publicScope(page)).toEqual(observations.baseline);
      await capture(page);
      return evidence;
    };
    const noError = async () => {
      const evidence = await fieldEvidence(page, input);
      expect(evidence.invalid).not.toBe('true');
      expect(evidence.images.some((icon) => icon.name === 'close-circle')).toBe(
        false
      );
      expect(evidence.alerts).toEqual([]);
      expect(
        evidence.referenced.filter((entry) => entry.visible && entry.text)
      ).toEqual([]);
      return evidence;
    };
    await wallet.step(
      'normal onboarding and exact public baseline before ERC1155 preview',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        const baseline = await publicScope(page);
        expect(baseline.liveAccounts).toEqual(baseline.savedAccounts);
        expect(baseline.liveAssets).toEqual(baseline.savedAssets);
        expect(baseline.liveGrants).toEqual([]);
        expect(baseline.savedGrants).toEqual([]);
        expect(baseline).toMatchObject({
          active: { type: 'HDAccount', id: 0 },
          savedActive: { type: 'HDAccount', id: 0 },
          slip44: 60,
          network: {
            kind: 'ethereum',
            chainId: 5700,
            url: RPC,
            platform: null,
          },
        });
        expect(baseline.liveAccounts).toHaveLength(1);
        expect(baseline.liveAccounts[0].address.toLowerCase()).toBe(owner);
        observations.baseline = baseline;
      }
    );
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      const label = `${viewport.width}x${viewport.height}`;
      await wallet.step(
        `${label}: real ERC1155 detection leaves empty Token ID without an error`,
        async (capture) => {
          await page.setViewportSize(viewport);
          phase = null;
          await openCustom();
          await expect(importControl).toHaveCount(0);
          await noError();
          await record('empty', capture);
        }
      );
      await wallet.step(
        `${label}: held actual ownership read is pending then positive ID8 is actionable`,
        async (capture) => {
          arm(label + ':positive8', '8', false, true);
          await input.fill('8');
          await expect.poll(() => held.length).toBe(1);
          await expect(importControl).toHaveCount(0);
          await expect(
            input
              .locator('..')
              .getByRole('img', { name: 'loading', exact: true })
          ).toHaveCount(1);
          await noError();
          await record('pending', capture);
          release();
          await expect(importControl).toBeEnabled();
          await expect(
            page.getByTitle(exactBalance, { exact: true })
          ).toBeVisible();
          await noError();
          await record('healthy-positive', capture);
        }
      );
      await wallet.step(
        `${label}: verified zero ID9 remains a healthy importable watch quantity`,
        async (capture) => {
          arm(label + ':zero9', '9');
          await input.fill('9');
          await expect(importControl).toBeEnabled();
          await expect(
            page.getByText(en.tokens.erc1155ZeroBalanceNote, { exact: true })
          ).toBeVisible();
          await expect(retry).toHaveCount(0);
          await noError();
          await record('healthy-zero', capture);
        }
      );
      await wallet.step(
        `${label}: real batch and individual ID7 failures are not format-invalid and Retry recovers`,
        async (capture) => {
          arm(label + ':unavailable7', '7', true);
          await input.fill('7');
          await expect.poll(() => phase!.individualCalls).toBe(1);
          await expect(importControl).toHaveCount(0);
          await expect(
            page.getByTitle(en.send.invalidTokenId, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(en.send.unableToLoad, { exact: true })
          ).toBeVisible();
          await expect(retry).toBeEnabled();
          expect((await fieldEvidence(page, input)).invalid).not.toBe('true');
          await record('valid-id-read-failure', capture);
          arm(label + ':retry7', '7');
          await retry.click();
          await expect(input).toHaveValue('7');
          await expect(importControl).toBeEnabled();
          await expect(
            page.getByTitle(exactBalance, { exact: true })
          ).toBeVisible();
          await expect(retry).toHaveCount(0);
          await noError();
          await record('recovered-same-id', capture);
        }
      );
      await wallet.step(
        `${label}: malformed Token ID records real settled visible and native feedback after Tab`,
        async (capture) => {
          phase = null;
          const before = ownershipReads.length;
          await input.fill(MALFORMED);
          await expect(input).toHaveValue(MALFORMED);
          await expect(
            input
              .locator('..')
              .getByRole('img', { name: 'loading', exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByTitle(en.send.invalidTokenId, { exact: true })
          ).toBeVisible();
          await expect(importControl).toHaveCount(0);
          await expect(retry).toHaveCount(0);
          await input.press('Tab');
          await tabTo(page, input, true);
          if (viewport.height === 360) {
            // Read below the field using an ordinary wheel in the short
            // popup. Without guidance there may be no overflow to scroll;
            // the final feedback assertion owns its actual visibility.
            const box = await input.boundingBox();
            expect(box).not.toBeNull();
            await page.mouse.move(
              box!.x + box!.width / 2,
              box!.y + box!.height / 2
            );
            await page.mouse.wheel(0, 96);
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                  )
                )
            );
          }
          expect(ownershipReads).toHaveLength(before);
          await record('malformed', capture);
        }
      );
      await wallet.step(
        `${label}: correction empty reset native Close and actual re-entry remain healthy`,
        async (capture) => {
          arm(label + ':correction8', '8');
          await input.fill('8');
          await expect(importControl).toBeEnabled();
          await noError();
          phase = null;
          await input.fill('');
          await expect(input).toHaveValue('');
          await expect(importControl).toHaveCount(0);
          await noError();
          await tabTo(page, close);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home$/);
          expect(await publicScope(page)).toEqual(observations.baseline);
          await openCustom();
          (observations.reopenedValues ||= []).push({
            viewport,
            value: await input.inputValue(),
          });
          await noError();
          arm(label + ':reentered8', '8');
          await input.fill('8');
          await expect(importControl).toBeEnabled();
          await noError();
          await record('reentered-healthy', capture);
          await close.click();
          await expect(page).toHaveURL(/#\/home$/);
          phase = null;
          expect(await publicScope(page)).toEqual(observations.baseline);
        }
      );
    }
    observations.workerAfter = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerAfter = identity;
      }
    );
    expect(unsupported).toEqual([]);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
    expect(
      server.blocked.every((method) => method === 'GET' || method === 'CONNECT')
    ).toBe(true);
    expect(reads.some((read) => read.method === 'eth_getCode')).toBe(true);
    expect(ownershipPhases).toHaveLength(12);
    for (const completed of ownershipPhases) {
      expect(completed.detectorId).not.toBeNull();
      expect(completed.batchCalls).toBe(1);
      expect(completed.individualCalls).toBe(completed.failed ? 1 : 0);
    }
    observations.ownershipPhases = ownershipPhases;
    observations.ownershipReads = ownershipReads;
    expect(await publicScope(page)).toEqual(observations.baseline);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(testSourceSha256);
    await wallet.step(
      'malformed Token ID guidance is associated after all healthy read-recovery scope and fence controls',
      async () => {
        const malformed = observations.states.filter(
          (state: any) => state.state === 'malformed'
        );
        expect(malformed).toHaveLength(2);
        for (const state of malformed) {
          expect(
            state.invalid,
            `${state.viewport.width}: field invalid state`
          ).toBe('true');
          expect(
            state.referenced.some(
              (entry: any) =>
                entry.visible &&
                entry.fullyVisible &&
                entry.text === en.send.invalidTokenId
            ),
            `${state.viewport.width}: visible associated guidance`
          ).toBe(true);
          expect(
            state.native.description,
            `${state.viewport.width}: native field description`
          ).toContain(en.send.invalidTokenId);
          expect(
            String(state.native.invalid),
            `${state.viewport.width}: native invalid state`
          ).toBe('true');
        }
      }
    );
    status = 'passed';
  } finally {
    release();
    try {
      await info.attach('erc1155-malformed-token-id-feedback-evidence', {
        body: JSON.stringify(
          {
            status,
            observations,
            ownershipPhases,
            ownershipReads,
            reads,
            unsupported,
            writes,
            pageErrors,
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedMethods: server.blocked.slice(),
            syntheticHttpOnly: true,
            controllerOrApiReplaced: false,
            tokenImportActivated: false,
            signaturesOrBroadcastsRequested: false,
          },
          null,
          2
        ),
        contentType: 'application/json',
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
