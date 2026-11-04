import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createNativeHttpFetch, type WalletHttpFetch } from '../src/platform/httpPolicy.ts';
import { createBalanceReader } from '../src/platformRpc.ts';
import { ActivityExplorerReader } from '../src/activity/explorerReader.ts';
import { createActivityScope } from '../src/activity/types.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new NodeURL(path, import.meta.url), 'utf8');
function evaluate(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(source, { module, exports: module.exports, require(name: string) {
    assert(Object.hasOwn(dependencies, name), `unexpected import ${name}`); return dependencies[name];
  }, Headers, Request, Response, TextEncoder, TextDecoder, URLSearchParams, Blob, FormData, ReadableStream, AbortController, console, ...globals });
  return module.exports;
}

/** Execute installed Expo fetch/normalizers with only the native bridge substituted. */
function expoFixture() {
  const calls: { url: string; init: any; body: Uint8Array | null }[] = [];
  let cancelled = 0;
  class ResponseStub {
    aborted = false;
    abort() { this.aborted = true; }
  }
  class RequestStub {
    async start(url: string, init: unknown, body: Uint8Array | null) { calls.push({ url, init, body }); }
    cancel() { cancelled++; }
  }
  const utils = evaluate('../node_modules/expo/src/winter/fetch/RequestUtils.ts', {
    '../../utils/blobUtils': { blobToArrayBufferAsync: () => assert.fail('unexpected blob') },
    './convertFormData': { convertFormDataAsync: () => assert.fail('unexpected form') },
  });
  const errors = evaluate('../node_modules/expo/src/winter/fetch/FetchErrors.ts', {});
  const actual = evaluate('../node_modules/expo/src/winter/fetch/fetch.ts', {
    './ExpoFetchModule': { ExpoFetchModule: { NativeRequest: RequestStub } },
    './FetchResponse': { FetchResponse: ResponseStub }, './RequestUtils': utils, './FetchErrors': errors,
  });
  const native = evaluate('../src/platform/http.native.ts', {
    'expo/fetch': actual, './httpPolicy.ts': { createNativeHttpFetch },
  });
  return { calls, fetch: native.walletFetch as WalletHttpFetch, cancelled: () => cancelled };
}

test('installed RN Request rewrites GET and drops redirect policy; native Expo forwards exact URL and policy', async () => {
  const polyfill = require('whatwg-fetch');
  const url = 'https://public.example/api/address/0x1111111111111111111111111111111111111111?details=basic';
  const legacy = new polyfill.Request(url, { method: 'GET', cache: 'no-store', redirect: 'error' });
  assert.notEqual(legacy.url, url); assert.match(legacy.url, /[?&]_=/); assert.equal(legacy.redirect, undefined);
  const f = expoFixture(); const signal = new AbortController();
  await f.fetch(url, { method: 'GET', cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'include', redirect: 'follow', signal: signal.signal });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.url, url);
  assert.equal(f.calls[0]!.init.credentials, 'omit'); assert.equal(f.calls[0]!.init.redirect, 'error');
  assert.equal(f.calls[0]!.init.headers.find(([key]: string[]) => key === 'cache-control')[1], 'no-store, no-cache');
  assert.equal(f.calls[0]!.init.headers.find(([key]: string[]) => key === 'pragma')[1], 'no-cache');
  assert.equal(Object.hasOwn(f.calls[0]!.init, 'cache'), false); assert.equal(Object.hasOwn(f.calls[0]!.init, 'referrerPolicy'), false);
  signal.abort(); assert.equal(f.cancelled(), 1);
});

test('native wrapper preserves POST bytes, snapshots headers and rejects Request/URL objects before dispatch', async () => {
  const f = expoFixture(), headers = new Headers({ Accept: 'application/json', 'Cache-Control': 'public' });
  const body = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":3}';
  await f.fetch('http://127.0.0.1:1234/rpc?fixed=1', { method: 'POST', body, headers });
  assert.equal(new TextDecoder().decode(f.calls[0]!.body!), body);
  assert.equal(headers.get('Cache-Control'), 'public');
  assert.equal(f.calls[0]!.url, 'http://127.0.0.1:1234/rpc?fixed=1');
  for (const input of [new URL('https://public.example/'), new Request('https://public.example/'), ''])
    await assert.rejects(f.fetch(input as string, {}), /Invalid wallet request URL/);
  assert.equal(f.calls.length, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.fetch('https://public.example/', { signal: abort.signal }));
  assert.equal(f.calls.length, 1);
});

test('native policy strips explicit cookies/referrer, preserves caller headers and rejects invalid options asynchronously', async () => {
  const f = expoFixture();
  const headers = { Cookie: 'fixture-cookie', cookie2: 'fixture-cookie2', Referer: 'https://fixture.invalid/private', Authorization: 'fixture-api-key' };
  await f.fetch('https://public.example/', { headers });
  const sent = new Headers(f.calls[0]!.init.headers);
  for (const key of ['Cookie', 'Cookie2', 'Referer']) assert.equal(sent.has(key), false);
  assert.equal(sent.get('Authorization'), 'fixture-api-key');
  assert.equal(headers.Cookie, 'fixture-cookie');
  await assert.rejects(f.fetch('https://public.example/', null as unknown as RequestInit), /Invalid wallet request options/);
  await assert.rejects(f.fetch('https://public.example/', { headers: { 'bad\nname': 'fixture' } }), /Invalid wallet request headers/);
  assert.equal(f.calls.length, 1);
});

for (const mode of ['success', 'status', 'oversized', 'invalid', 'read-failure'] as const) {
  test(`balance and Activity terminate owned native signals on ${mode}, keeping caller live`, async () => {
    for (const kind of ['balance', 'activity']) {
      const signals: AbortSignal[] = [];
      const transport: WalletHttpFetch = async (_url, init) => {
        signals.push(init.signal!); const request = JSON.parse(String(init.body));
        if (mode === 'status') return new Response('', { status: 503 });
        if (mode === 'oversized') return new Response('x', { headers: { 'content-length': '9999999' } });
        if (mode === 'invalid') return new Response('{');
        if (mode === 'read-failure') return new Response(new ReadableStream({ start(c) { c.error(Error('body failed')); } }));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x1' : '0x0' }), { headers: { 'content-type': 'application/json' } });
      };
      const caller = new AbortController();
      const promise = kind === 'balance'
        ? createBalanceReader({ fetch: createNativeHttpFetch(transport) }).readBalance('ethereum', '0x1111111111111111111111111111111111111111', caller.signal)
        : new ActivityExplorerReader(createNativeHttpFetch(transport)).head(createActivityScope('a'.repeat(64), 'hd:60:0', '0x1111111111111111111111111111111111111111', 'ethereum'), caller.signal, () => undefined);
      if (mode === 'success') await promise; else await assert.rejects(promise);
      assert(signals.length > 0 && signals.every((signal) => signal.aborted));
      assert.equal(caller.signal.aborted, false);
    }
  });
}

test('owned native transport propagates fetch rejection without retry or fallback', async () => {
  const error = Error('redirect refused'); let calls = 0;
  const fetcher = createNativeHttpFetch(async () => { calls++; throw error; });
  await assert.rejects(fetcher('https://public.example/rpc', {}), (caught) => caught === error);
  assert.equal(calls, 1);
});

test('native factory explicitly wires one owned transport to all network consumers', () => {
  const captures: Record<string, any[]> = {};
  const retired: string[] = [];
  const capture = (name: string) => class { view = {}; constructor(...args: any[]) { (captures[name] ??= []).push(args); } dispose() { retired.push(name); } };
  const fetcher: WalletHttpFetch = async () => { throw Error('no HTTP in wiring test'); };
  const balance = { readBalance() {} };
  const factory = evaluate('../src/platform/nativeFactory.native.ts', {
    '../custody/authority.ts': { NativeCustodyAuthority: capture('authority') },
    '../custody/keyringRuntime.ts': { createKeyringRuntimeFactory: () => ({ open() {} }) },
    '../custody/recovery.ts': { NativeRecoveryCoordinator: capture('recovery') },
    '../custody/seedBackup.ts': { SeedBackupFlow: capture('backup') },
    '../custody/hdKeyExport.ts': { HdKeyExportFlow: capture('key') },
    '../custody/transfers.ts': { NativeTransfers: capture('transfers') },
    '../portfolio/nativeTokens.ts': { NativeTokens: capture('tokens') },
    '../activity/nativeActivity.ts': { NativeActivity: capture('activity') },
    '../activity/explorerReader.ts': { ActivityExplorerReader: capture('explorer') },
    '../activity/receiptReader.ts': { ActivityReceiptReader: capture('receipt') },
    '../portfolio/erc20ReadRpc.ts': { createErc20Reader: (options: unknown) => { captures.erc20 = [options]; return 'token-reader'; } },
    '../platformRpc.ts': { createBalanceReader: (options: unknown) => { captures.balance = [options]; return balance; } },
    '../storage/native': { openNativeWalletStorage() { assert.fail('unexpected open'); } },
    './cryptoBootstrap': { ensureNativeCryptoReady() { assert.fail('unexpected crypto'); } },
    './http': { walletFetch: fetcher },
  });
  const bundle = factory.createNativeWalletControllers();
  assert.equal(bundle.balanceReader, balance);
  for (const options of [captures.balance![0], captures.erc20![0], captures.transfers![0][2], captures.receipt![0][0]]) assert.equal(options.fetch, fetcher);
  assert.equal(captures.explorer![0][0], fetcher);
  assert.equal(captures.tokens![0][2], 'token-reader');
  assert.equal(captures.activity![0].length, 4);
  factory.createNativeRecoveryCoordinator(bundle);
  const recovery = captures.recovery![0][0];
  assert.equal(recovery.owner, bundle.authority);
  assert.equal(typeof recovery.openStorage, 'function');
  recovery.retireControllers();
  assert.deepEqual(retired, ['tokens', 'transfers', 'key', 'backup']);
});

test('public platform and native Portfolio fallback bind platform-owned fetch; NativeWallet passes the explicit reader', () => {
  const fetcher = async () => { throw Error('no HTTP in wiring test'); }; const seen: unknown[] = [];
  evaluate('../src/platform.ts', {
    'react-native': { Platform: { OS: 'ios' } }, 'expo-secure-store': {},
    './core/publicAccountStorage.ts': { createPublicAccountStorage: () => ({}) },
    './platformRpc.ts': { createBalanceReader: (options: unknown) => { seen.push(options); return {}; } },
    './core/utxoBalanceReader.ts': { createUtxoBalanceReader: (options: unknown) => { seen.push(options); return {}; } },
    './platform/http': { walletFetch: fetcher },
  });
  assert.equal(seen.length, 2);
  for (const options of seen) assert.equal((options as any).fetch, fetcher);
  const source = read('../src/screens/NativePortfolio.tsx');
  const dependencies: Record<string, unknown> = Object.fromEntries([...source.matchAll(/from '([^']+)'/g)].map((match) => [match[1]!, {}]));
  const fallback = { readBalance() {} }, explicit = { readBalance() {} }, readers: unknown[] = [];
  const react = { createElement: (...args: unknown[]) => args, useMemo: (work: () => unknown) => work(),
    useLayoutEffect() {}, useSyncExternalStore: () => ({ account: null }) };
  dependencies.react = { ...react, default: react };
  dependencies['react-native'] = { StyleSheet: { create: (value: unknown) => value } };
  dependencies['../ui'] = { colors: {} };
  dependencies['../platform/http'] = { walletFetch: fetcher };
  dependencies['../platformRpc'] = { createBalanceReader: (options: any) => { assert.equal(options.fetch, fetcher); return fallback; } };
  dependencies['../portfolio/nativePortfolio'] = { NativePortfolioController: class { constructor(_source: unknown, reader: unknown) { readers.push(reader); } } };
  const { NativePortfolio } = evaluate('../src/screens/NativePortfolio.tsx', dependencies);
  NativePortfolio({ source: {} }); NativePortfolio({ source: {}, reader: explicit });
  assert.deepEqual(readers, [fallback, explicit]);
  assert.match(read('../src/screens/NativeWallet.native.tsx'), /reader=\{balanceReader \?\? undefined\}/);
  assert.match(read('../src/screens/NativeWallet.native.tsx'), /setBalanceReader\(local\.balanceReader\)/);
});

test('NativeTransfers creates per-network RPCs with the injected native transport and preserves fixed context', async () => {
  let state: CustodySnapshot = { phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { address: '0x1111111111111111111111111111111111111111', network: 'ethereum' }, error: null };
  const listeners = new Set<(state: CustodySnapshot) => void>();
  const calls: string[] = [];
  const runtime = { async journal() { return { async load() { return null; } }; } };
  const transfers = new NativeTransfers({ getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, lock() {} }, () => runtime as any, {
    fetch: async (url, init) => { calls.push(url); assert.equal(init.redirect, 'error'); throw Error('stop before signing'); },
  });
  try {
    for (const network of ['ethereum', 'syscoin-nevm-testnet', 'ethereum'] as const) {
      state = { ...state, revision: state.revision + 1, account: { ...state.account!, network } };
      for (const listener of listeners) listener(state);
      await assert.rejects(transfers.prepare('0x2222222222222222222222222222222222222222', '0.01'));
    }
    assert.equal(calls.length, 3); assert.equal(calls[0], calls[2]); assert.notEqual(calls[0], calls[1]);
  } finally { transfers.dispose(); }
});
