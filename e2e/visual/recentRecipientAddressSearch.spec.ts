import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { Interface, dnsEncode, getAddress, namehash } from 'ethers';
import fs from 'fs';
import http from 'http';
import path from 'path';

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
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Real extension/UI,
// ordinary explorer history normalization, real ethers ENS ABI and real cache
// publication. Only HTTP replies are synthetic. Never clicks Next or Confirm.
const RPC = 'https://ethereum-rpc.publicnode.com/';
const EXPLORER =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const RECENT = `0x${'33'.repeat(20)}`;
const ENS_NAME = 'friend.eth';
const RESOLVER = '0x000000000000000000000000000000000000ed92';
const UNIVERSAL = '0xeeeeeeee14d718c2b47d9923deab1335e144eeee';
const DNS_NAME = dnsEncode(ENS_NAME);
const NODE = namehash(ENS_NAME);
const ROWS = '.sender-custom-input button';
const universal = new Interface([
  'function reverse(bytes name,uint256 coinType) view returns (string primary,address resolver,address reverseResolver)',
  'function requireResolver(bytes) view returns ((bytes name,uint256 offset,bytes32 node,address resolver,bool extended))',
  'function resolve(bytes name,bytes data) view returns (bytes result,address resolver)',
  'error ResolverNotFound(bytes name)',
]);
const resolver = new Interface([
  'function resolve(bytes name,bytes data) view returns (bytes result)',
  'function addr(bytes32) view returns (address)',
  'function addr(bytes32,uint256) view returns (bytes)',
]);
type RpcCall = {
  id: number | string;
  jsonrpc: string;
  method: string;
  params: any[];
};
type Read = {
  address?: string;
  at: number;
  direction?: string;
  method: string;
  name?: string;
  selector?: string;
  target?: string;
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release, arrivals: 0 };
}

async function startEnsRpc(owners: string[]) {
  const reads: Read[] = [],
    unsupported: Read[] = [];
  const deniedWrites: string[] = [];
  const reverseGate = gate();
  const knownAddress = (value: unknown) =>
    [...owners, RECENT].some(
      (address) => address.toLowerCase() === String(value).toLowerCase()
    );
  const respond = async (call: RpcCall) => {
    const audit: Read = { at: Date.now(), method: call?.method };
    const error = (message: string, code = -32601, data?: string) => ({
      jsonrpc: '2.0',
      id: call?.id,
      error: { code, message, ...(data ? { data } : {}) },
    });
    if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params)) {
      unsupported.push(audit);
      return error('Invalid synthetic RPC envelope');
    }
    if (
      /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
        call.method
      )
    ) {
      deniedWrites.push(call.method);
      return error('Signing and writes forbidden');
    }
    let result: unknown;
    switch (call.method) {
      case 'eth_chainId':
        result = '0x1';
        break;
      case 'net_version':
        result = '1';
        break;
      case 'eth_blockNumber':
        result = '0x2b';
        break;
      case 'eth_getBalance':
        if (knownAddress(call.params[0]))
          result =
            String(call.params[0]).toLowerCase() === owners[0].toLowerCase()
              ? '0x8ac7230489e80000'
              : '0x0';
        break;
      case 'eth_getTransactionCount':
        if (knownAddress(call.params[0]))
          result =
            String(call.params[0]).toLowerCase() === owners[0].toLowerCase()
              ? '0x1'
              : '0x0';
        break;
      case 'eth_getCode':
        if (knownAddress(call.params[0])) result = '0x';
        else if (
          [RESOLVER, UNIVERSAL].includes(String(call.params[0]).toLowerCase())
        )
          result = '0x60006000fd';
        break;
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        result = '0x3b9aca00';
        break;
      case 'eth_getLogs':
        result = [];
        break;
      case 'eth_feeHistory':
        result = {
          oldestBlock: '0x2a',
          baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
          gasUsedRatio: [0.5],
          reward: [['0x3b9aca00']],
        };
        break;
      case 'eth_getBlockByNumber': {
        const number =
          call.params[0] === 'latest' ? 43 : Number(call.params[0]);
        if (Number.isInteger(number) && number >= 0 && number <= 43)
          result = {
            number: `0x${number.toString(16)}`,
            hash: `0x${number.toString(16).padStart(64, '0')}`,
            parentHash: `0x${Math.max(0, number - 1)
              .toString(16)
              .padStart(64, '0')}`,
            nonce: '0x0000000000000000',
            timestamp: '0x65000000',
            difficulty: '0x0',
            gasLimit: '0x1c9c380',
            gasUsed: '0x0',
            miner: `0x${'00'.repeat(20)}`,
            extraData: '0x',
            transactions: [],
            baseFeePerGas: '0x3b9aca00',
          };
        break;
      }
      case 'eth_call': {
        const target = String(call.params[0]?.to).toLowerCase();
        const data = String(call.params[0]?.data).toLowerCase();
        Object.assign(audit, { target, selector: data.slice(0, 10) });
        if (!['latest', 'pending'].includes(call.params[1])) break;
        if (
          target === UNIVERSAL &&
          data.slice(0, 10) === universal.getFunction('reverse')!.selector
        ) {
          // ethers 6.17 passes the 20-byte EVM address, NOT an addr.reverse DNS name.
          const [address, coinType] = universal.decodeFunctionData(
            'reverse',
            data
          );
          if (
            !knownAddress(address) ||
            coinType !== BigInt(60) ||
            universal.encodeFunctionData('reverse', [address, coinType]) !==
              data
          )
            break;
          Object.assign(audit, {
            direction: 'reverse',
            address,
            name: address === RECENT ? ENS_NAME : undefined,
          });
          reads.push(audit);
          if (String(address).toLowerCase() !== RECENT) {
            // Explicit genuine negative reverse lookup for a local account.
            return error(
              'execution reverted',
              3,
              universal.encodeErrorResult('ResolverNotFound', [address])
            );
          }
          reverseGate.arrivals++;
          await reverseGate.promise;
          return {
            jsonrpc: '2.0',
            id: call.id,
            result: universal.encodeFunctionResult('reverse', [
              ENS_NAME,
              RESOLVER,
              RESOLVER,
            ]),
          };
        }
        if (
          target === UNIVERSAL &&
          data.slice(0, 10) ===
            universal.getFunction('requireResolver')!.selector
        ) {
          const [name] = universal.decodeFunctionData('requireResolver', data);
          if (
            name !== DNS_NAME ||
            universal.encodeFunctionData('requireResolver', [name]) !== data
          )
            break;
          Object.assign(audit, {
            direction: 'require-forward-resolver',
            name: ENS_NAME,
          });
          result = universal.encodeFunctionResult('requireResolver', [
            [DNS_NAME, 0, NODE, RESOLVER, true],
          ]);
        } else if (
          [RESOLVER, UNIVERSAL].includes(target) &&
          data.slice(0, 10) === universal.getFunction('resolve')!.selector
        ) {
          const outer = target === UNIVERSAL ? universal : resolver;
          const [name, subcall] = outer.decodeFunctionData('resolve', data);
          if (
            name !== DNS_NAME ||
            outer.encodeFunctionData('resolve', [name, subcall]) !== data
          )
            break;
          const inner = resolver.parseTransaction({ data: subcall });
          if (
            !inner ||
            !['addr(bytes32)', 'addr(bytes32,uint256)'].includes(
              inner.signature
            ) ||
            inner.args[0] !== NODE ||
            (inner.signature === 'addr(bytes32,uint256)' &&
              inner.args[1] !== BigInt(60)) ||
            resolver.encodeFunctionData(
              inner.fragment,
              Array.from(inner.args)
            ) !== subcall
          )
            break;
          const innerResult = resolver.encodeFunctionResult(inner.fragment, [
            RECENT,
          ]);
          Object.assign(audit, {
            direction: 'forward',
            name: ENS_NAME,
            address: RECENT,
          });
          result = outer.encodeFunctionResult(
            'resolve',
            target === UNIVERSAL ? [innerResult, RESOLVER] : [innerResult]
          );
        }
        break;
      }
    }
    if (result === undefined) {
      unsupported.push(audit);
      return error('Unsupported synthetic mainnet read');
    }
    reads.push(audit);
    return { jsonrpc: '2.0', id: call.id, result };
  };
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/rpc') {
      response.writeHead(403).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error('Oversize fixture request');
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const replies = await Promise.all(
        (Array.isArray(body) ? body : [body]).map(respond)
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local RPC port');
  return {
    url: `http://127.0.0.1:${address.port}/rpc`,
    reads,
    unsupported,
    deniedWrites,
    reverseGate,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const publicState = (page: Page) =>
  page.evaluate(async (recent) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount,
      network = state.vault.activeNetwork;
    const account = state.vault.accounts[ref.type][ref.id];
    return {
      active: {
        id: ref.id,
        type: ref.type,
        address: account.address,
        label: account.label,
      },
      network: {
        chainId: network.chainId,
        kind: network.kind,
        url: network.url,
        apiUrl: network.apiUrl,
      },
      cache: state.vaultGlobal.ensCache?.[recent] ?? null,
      history: (
        state.vault.accountTransactions[ref.type]?.[ref.id]?.ethereum?.[
          network.chainId
        ] || []
      ).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        input: tx.input,
        blockNumber: tx.blockNumber,
        confirmations: tx.confirmations,
        historySource: tx.historySource,
        isError: tx.isError,
        receiptStatus: tx.txreceipt_status,
      })),
    };
  }, RECENT);

async function nativeRows(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: ROWS,
    });
    const names: string[] = [];
    for (const nodeId of nodeIds) {
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      });
      const row = nodes.find(
        (node) => !node.ignored && node.role?.value === 'button'
      );
      expect(row).toBeDefined();
      names.push(String(row!.name?.value));
    }
    return names;
  } finally {
    await cdp.detach();
  }
}

test('recent recipients remain searchable by public address after genuine ENS cache population', async ({}, info) => {
  test.setTimeout(120_000);
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
  expect(
    fixture.evmAddresses.map((address) => address.toLowerCase())
  ).not.toContain(RECENT);
  const proxy = await startUtxoFixtureServer();
  const rpc = await startEnsRpc(fixture.evmAddresses);
  const hash = `0x${'a7'.repeat(32)}`;
  const transaction = {
    hash,
    from: fixture.evmAddresses[0],
    to: RECENT,
    value: '1000000000000000',
    input: '0x',
    nonce: '0',
    blockNumber: '42',
    blockHash: `0x${'2a'.padStart(64, '0')}`,
    timeStamp: String(Math.floor(Date.now() / 1000) - 86400),
    confirmations: '2',
    chainId: '1',
    type: '2',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '1000000000',
    isError: '0',
    // eslint-disable-next-line camelcase -- Explorer wire field.
    txreceipt_status: '1',
  };
  const historyReads: Array<{
    action: string;
    address: string | null;
    at: number;
  }> = [];
  const unsupportedHttp: string[] = [],
    attemptedWrites: string[] = [],
    pageErrors: string[] = [];
  const observations: Record<string, any> = {
    runtime,
    sourceSha256,
    selections: [],
    queries: [],
  };
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RecipientSearchSynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: proxy.url,
  });
  try {
    wallet = await PaliWallet.launch('recent-recipient-address-search', {
      offlineHttpProxy: proxy.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      proxy.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerIdentity = identity;
      }
    );
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(request.url()))
        attemptedWrites.push('sendtx');
      try {
        const body = request.postDataJSON();
        for (const call of Array.isArray(body) ? body : [body])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            attemptedWrites.push(call.method);
      } catch {
        /* Ordinary REST. */
      }
    });
    await wallet.context.route(RPC, async (route) => {
      if (route.request().method() !== 'POST') {
        unsupportedHttp.push('non-POST mainnet RPC');
        await route.abort('blockedbyclient');
        return;
      }
      const response = await fetch(rpc.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: route.request().postData() || '',
      });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
    await wallet.context.route(`${EXPLORER}**`, async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action') || '',
        address = url.searchParams.get('address');
      const accountAction = [
        'txlist',
        'tokentx',
        'pendingtxlist',
        'tokenlist',
      ].includes(action);
      if (
        route.request().method() !== 'GET' ||
        (accountAction &&
          !fixture.evmAddresses.some(
            (owner) => owner.toLowerCase() === String(address).toLowerCase()
          )) ||
        (!accountAction &&
          !['eth_block_number', 'eth_blockNumber'].includes(action))
      ) {
        unsupportedHttp.push(
          `explorer:${route.request().method()}:${url.href}`
        );
        await route.abort('blockedbyclient');
        return;
      }
      historyReads.push({ action, address, at: Date.now() });
      const result = !accountAction
        ? '0x2b'
        : action === 'txlist' &&
          String(address).toLowerCase() ===
            fixture.evmAddresses[0].toLowerCase()
        ? [transaction]
        : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: '1', message: 'OK', result }),
      });
    });
    // The actual mainnet token-discovery consumer uses Routescan holdings,
    // rather than the legacy tokenlist action. Keep this normal empty-asset
    // read healthy without adding fake tokens or bypassing the controller.
    await wallet.context.route(
      'https://api.routescan.io/v2/network/mainnet/evm/1/address/**',
      async (route) => {
        const url = new URL(route.request().url());
        const match = url.pathname.match(
          /^\/v2\/network\/mainnet\/evm\/1\/address\/(0x[0-9a-fA-F]{40})\/(erc20|erc721|erc1155)-holdings$/
        );
        if (
          route.request().method() !== 'GET' ||
          !match ||
          !fixture.evmAddresses.some(
            (owner) => owner.toLowerCase() === match[1].toLowerCase()
          ) ||
          url.searchParams.get('limit') !== '100' ||
          [...url.searchParams.keys()].some((key) => key !== 'limit')
        ) {
          unsupportedHttp.push(
            `holdings:${route.request().method()}:${url.href}`
          );
          await route.abort('blockedbyclient');
          return;
        }
        historyReads.push({
          action: `${match[2]}-holdings`,
          address: match[1],
          at: Date.now(),
        });
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ items: [] }),
        });
      }
    );
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      async (route) => {
        const url = new URL(route.request().url());
        const asset = url.searchParams.get('ids');
        if (
          route.request().method() !== 'GET' ||
          url.pathname !== '/api/v3/simple/price' ||
          !['syscoin', 'ethereum'].includes(asset || '') ||
          url.searchParams.get('vs_currencies') !== 'usd' ||
          url.searchParams.get('include_24hr_change') !== 'true'
        ) {
          unsupportedHttp.push(`quote:${route.request().method()}:${url.href}`);
          await route.abort('blockedbyclient');
          return;
        }
        await route.fulfill({
          contentType: 'application/json',
          // eslint-disable-next-line camelcase -- CoinGecko wire field.
          body: JSON.stringify({ [asset!]: { usd: 1, usd_24h_change: 0 } }),
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const receiver = page.getByPlaceholder(en.send.receiver, { exact: true });
    const choose = async (
      query: string,
      label: string,
      address: string,
      source: string,
      keyboard: boolean,
      soft = false
    ) => {
      await receiver.fill(query);
      const name = `${label}, ${address}, ${source}`;
      const row = page
        .locator(ROWS)
        .and(page.getByRole('button', { name, exact: true }));
      if (soft)
        await expect
          .soft(
            row,
            `Cached recent recipient must match address query ${query}`
          )
          .toHaveCount(1);
      else await expect(row).toHaveCount(1);
      const found = (await row.count()) === 1;
      const names = await nativeRows(wallet!.context, page);
      observations.queries.push({
        query,
        expectedName: name,
        found,
        nativeNames: names,
        cache: (await publicState(page)).cache,
      });
      if (!found) return;
      expect(names).toContain(name);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('title', address);
      if (keyboard) {
        await row.focus();
        await expect(row).toBeFocused();
        await page.keyboard.press('Enter');
      } else await row.click();
      await expect(receiver).toHaveValue(address);
      await expect(page.locator(ROWS)).toHaveCount(0);
      await expect(page).toHaveURL(/#\/send\/eth$/);
      observations.selections.push({
        query,
        address: await receiver.inputValue(),
        activation: keyboard ? 'native Enter' : 'pointer',
      });
    };
    await wallet.step(
      'ordinary wallet, configured mainnet and canonical outbound explorer history',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('10');
        await expect
          .poll(async () => (await publicState(page)).history)
          .toEqual([
            {
              hash,
              from: fixture.evmAddresses[0],
              to: RECENT,
              input: '0x',
              blockNumber: 42,
              confirmations: 2,
              historySource: 'explorer-txlist',
              isError: '0',
              receiptStatus: '1',
            },
          ]);
        observations.initial = await publicState(page);
        expect(observations.initial.active).toMatchObject({
          id: 0,
          type: 'HDAccount',
          address: fixture.evmAddresses[0],
        });
        expect(observations.initial.network).toEqual({
          chainId: 1,
          kind: 'ethereum',
          url: RPC.replace(/\/$/, ''),
          apiUrl: EXPLORER,
        });
        expect(observations.initial.cache).toBeNull();
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/eth$/);
        await page.locator('#send-form').evaluate((form) => {
          (window as any).__recipientSearchSubmits = 0;
          form.addEventListener('submit', () => {
            (window as any).__recipientSearchSubmits++;
          });
        });
      }
    );
    await wallet.step(
      'uncached address prefix chooses exact recent bytes before a real reverse lookup',
      async () => {
        await choose(
          RECENT.slice(0, 10),
          RECENT,
          RECENT,
          en.send.recentRecipient,
          false
        );
        await expect.poll(() => rpc.reverseGate.arrivals).toBeGreaterThan(0);
        expect((await publicState(page)).cache).toBeNull();
        rpc.reverseGate.release();
        await expect
          .poll(async () => (await publicState(page)).cache?.name)
          .toBe(ENS_NAME);
        expect(
          rpc.reads.some(
            (read) => read.direction === 'reverse' && read.address === RECENT
          )
        ).toBe(true);
        expect(
          rpc.reads.some(
            (read) =>
              read.direction === 'forward' &&
              read.address === RECENT &&
              read.name === ENS_NAME
          )
        ).toBe(true);
        observations.cacheAfterRealReads = await publicState(page);
      }
    );
    await wallet.step(
      'cached name search retains the same exact recipient as a healthy keyboard control',
      async () => {
        await choose('friend', ENS_NAME, RECENT, en.send.recentRecipient, true);
      }
    );
    await wallet.step(
      'cached recent remains searchable by hexadecimal prefix and full address',
      async () => {
        // Soft discovery failures retain the following healthy local-account control.
        await choose(
          RECENT.slice(0, 10),
          ENS_NAME,
          RECENT,
          en.send.recentRecipient,
          true,
          true
        );
        await choose(
          RECENT,
          ENS_NAME,
          RECENT,
          en.send.recentRecipient,
          false,
          true
        );
      }
    );
    await wallet.step(
      'local account address search and exact selection remain unchanged',
      async () => {
        const local = (await publicState(page)).active;
        await choose(
          local.address.slice(0, 10),
          local.label,
          local.address,
          en.transactions.account,
          true
        );
        expect(getAddress(await receiver.inputValue())).toBe(
          getAddress(fixture.evmAddresses[0])
        );
        expect(
          await page.evaluate(() => (window as any).__recipientSearchSubmits)
        ).toBe(0);
        await expect(
          page.getByPlaceholder(en.send.amount, { exact: true })
        ).toHaveValue('');
        await expect(page).toHaveURL(/#\/send\/eth$/);
      }
    );
    expect(attemptedWrites).toEqual([]);
    expect(rpc.deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(rpc.unsupported).toEqual([]);
    expect(unsupportedHttp).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    rpc.reverseGate.release();
    observations.status = status;
    observations.rpcReads = rpc.reads;
    observations.unsupportedRpc = rpc.unsupported;
    observations.historyReads = historyReads;
    observations.unsupportedHttp = unsupportedHttp;
    observations.attemptedWrites = attemptedWrites;
    observations.deniedWrites = rpc.deniedWrites;
    observations.baseDeniedWrites = routes?.deniedWrites || [];
    observations.pageErrors = pageErrors;
    await info.attach('recent-recipient-address-search', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
    await wallet?.dispose(status);
    await rpc.close();
    await proxy.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
