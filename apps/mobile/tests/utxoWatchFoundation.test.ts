import assert from 'node:assert/strict';
import test from 'node:test';
import { bech32, bech32m } from 'bech32';
import { UTXO_NETWORKS, getUtxoNetwork, type UtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { normalizeUtxoAddress } from '../src/core/utxoAddresses.ts';
import { createUtxoBalanceReader, UtxoBalanceError, type UtxoBalanceErrorCode } from '../src/core/utxoBalanceReader.ts';
import { getNetwork } from '../src/core/networks.ts';
import { getDefaultUTXONetworks } from '../../../source/utils/defaultNetworks.ts';
import { UTXO_ADDRESSES, XPUB, metadata } from './publicWatchFixtures.ts';

// Public BIP173 witness-program vector; no keys are generated or read.
const PROGRAM = Uint8Array.from(Buffer.from('751e76e8199196d454941c45d1b3a323f1433bd6', 'hex'));
const { bitcoin: BTC, syscoin: SYS, 'utxo:5700': TSYS } = UTXO_ADDRESSES;
const addressFor = (network: UtxoNetworkId) => UTXO_ADDRESSES[network as keyof typeof UTXO_ADDRESSES];
const signal = () => new AbortController().signal;
const statusFor = metadata;
const balanceFor = (network: UtxoNetworkId) => ({ address: addressFor(network), balance: '9007199254740993', unconfirmedBalance: '-123', unconfirmedTxs: 2 });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const code = (expected: UtxoBalanceErrorCode) => (error: unknown) => {
  assert.ok(error instanceof UtxoBalanceError);
  assert.equal(error.code, expected);
  assert.equal(Object.values(UTXO_ADDRESSES).some((address) => error.message.includes(address)) || error.message.includes('https:'), false);
  return true;
};
function responses(network: UtxoNetworkId, values?: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const bodies = values ?? [statusFor(network), { blockHash: getUtxoNetwork(network).genesisHash }, balanceFor(network)];
  return { calls, fetch: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const value = bodies[calls.length - 1];
    return value instanceof Response || value && typeof value === 'object' && 'headers' in value && value.headers instanceof Headers
      ? value as Response : json(value);
  } };
}

test('UTXO watch registrations share all extension defaults, SDK metadata and valid zero identity', () => {
  const defaults = getDefaultUTXONetworks();
  assert.equal(UTXO_NETWORKS.length, Object.keys(defaults).length);
  assert.deepEqual(UTXO_NETWORKS.map((n) => [n.id, n.chainId, n.slip44, n.addressNetwork.bech32, n.blockbookCoin, n.symbol, n.backendChain]), [
    ['syscoin', 57, 57, 'sys', 'Syscoin', 'SYS', 'main'],
    ['bitcoin', 0, 0, 'bc', 'Bitcoin', 'BTC', 'main'],
    ['utxo:5700', 5700, 1, 'tsys', 'Syscoin Testnet', 'tSYS', 'test'],
  ]);
  assert.equal(getUtxoNetwork('syscoin').genesisHash, '0000022642db0346b6e01c2a397471f4f12e65d4f4251ec96c1f85367a61a7ab');
  assert.equal(getUtxoNetwork('bitcoin').genesisHash, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
  assert.equal(getUtxoNetwork('utxo:5700').genesisHash, '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222');
  assert.equal(Object.isFrozen(UTXO_NETWORKS), true);
  for (const network of UTXO_NETWORKS) {
    assert.equal(Object.isFrozen(network), true);
    assert.equal(network.endpoint + '/', defaults[network.chainId]!.url);
    assert.equal(network.explorer, defaults[network.chainId]!.explorer);
    assert.equal(network.backendChain, defaults[network.chainId]!.utxoBackendChain);
    assert.equal(network.name, defaults[network.chainId]!.label);
    assert.equal(getNetwork(network.id).canWatch, true);
  }
  for (const id of ['ethereum', 'syscoin-nevm', 'utxo:0', 'utxo:57', 'utxo:1', '5700', '0', 0, {}, null])
    assert.throws(() => getUtxoNetwork(id));
  const evmTestnet = getNetwork('syscoin-nevm-testnet');
  assert.equal(evmTestnet.kind, 'evm');
  assert.equal(evmTestnet.chainId, getUtxoNetwork('utxo:5700').chainId);
});

test('P2WPKH parser accepts fixed public vectors, normalizes uppercase and binds HRP', () => {
  assert.equal(bech32.encode('bc', [0, ...bech32.toWords(PROGRAM)]), BTC);
  assert.equal(bech32.encode('sys', [0, ...bech32.toWords(PROGRAM)]), SYS);
  assert.equal(bech32.encode('tsys', [0, ...bech32.toWords(PROGRAM)]), TSYS);
  for (const network of UTXO_NETWORKS) {
    const address = addressFor(network.id);
    assert.equal(normalizeUtxoAddress(address, network.id), address);
    assert.equal(normalizeUtxoAddress(address.toUpperCase(), network.id), address);
  }
  assert.throws(() => normalizeUtxoAddress(BTC, 'syscoin'));
  assert.throws(() => normalizeUtxoAddress(SYS, 'bitcoin'));
  assert.throws(() => normalizeUtxoAddress(SYS, 'utxo:5700'));
  assert.throws(() => normalizeUtxoAddress(TSYS, 'syscoin'));
});

test('parser rejects bad checksums/case/padding and private or descriptor inputs', () => {
  const words = [0, ...bech32.toWords(PROGRAM)];
  for (const invalid of [
    '', null, undefined, 1, [], {}, ` ${BTC}`, `${BTC}\n`, BTC.slice(0, -1) + 'q', 'bC' + BTC.slice(2),
    bech32.encode('tb', words), bech32.encode('tsys', words),
    bech32.encode('bc', [1, ...bech32.toWords(PROGRAM)]), bech32m.encode('bc', words),
    bech32.encode('bc', [...words, 1]), 'bc1' + 'q'.repeat(100),
    'xpub-public-key', 'xprv-private-key', '0x' + '11'.repeat(32), `wpkh(${BTC})`,
  ]) assert.throws(() => normalizeUtxoAddress(invalid, 'bitcoin'));
});

test('SDK address codec preserves supported P2PKH, P2SH and P2WSH scripts', () => {
  for (const address of ['1BoatSLRHtKNngkdXEeobR76b53LETtpyT', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', bech32.encode('bc', [0, ...bech32.toWords(new Uint8Array(32))])]) assert.equal(normalizeUtxoAddress(address, 'bitcoin'), address);
});

test('owned UTXO balance reads every SPT holding from the shared account inventory', async () => {
  for (const id of ['syscoin', 'utxo:5700', 'bitcoin'] as const) {
    const network = getUtxoNetwork(id);
    const fixture = responses(id, [statusFor(id), { blockHash: network.genesisHash }, {
      ...balanceFor(id),
      tokensAsset: [
        { assetGuid: '123456', symbol: 'SYSX', decimals: 8, balance: '9007199254740993', unconfirmedBalance: '-2' },
        { assetGuid: '123456', decimals: 8, balance: '9', unconfirmedBalance: '1' },
        { assetGuid: '123457', decimals: 8, balance: '900', symbol: 'SYSX' },
      ],
    }]);
    const result = await createUtxoBalanceReader(fixture).readBalance(id, addressFor(id), signal());
    assert.equal(result.confirmedUnits, '9007199254740993');
    assert.deepEqual(result.assets, id === 'bitcoin' ? undefined : [
      { assetGuid: '123456', symbol: 'SYSX', decimals: 8, confirmedUnits: '9007199254741002', pendingDeltaUnits: '-1' },
      { assetGuid: '123457', symbol: 'SYSX', decimals: 8, confirmedUnits: '900', pendingDeltaUnits: '0' },
    ]);
    assert.equal(fixture.calls.length, 3);
  }
});

test('an unavailable SYSX inventory stays distinct from verified zero and does not erase SYS balance', async () => {
  const id = 'syscoin';
  const { genesisHash } = getUtxoNetwork(id);
  for (const [assetResponse, expected] of [
    [{ tokensAsset: [] }, undefined],
    [{ txs: 0, tokensAsset: [] }, []],
    [{ txs: 0 }, []],
    [{}, undefined],
    [{ tokensAsset: null }, undefined],
    [{ tokensAsset: [{ assetGuid: '123456', decimals: 3, balance: '1', symbol: 'THREE' }] }, [{assetGuid:'123456',decimals:3,confirmedUnits:'1',pendingDeltaUnits:'0',symbol:'THREE'}]],
    [{ tokensAsset: [{ assetGuid: '123456\n', decimals: 8, balance: '1' }] }, undefined],
    [{ tokensAsset: [{ assetGuid: '123456', decimals: 8, balance: '9'.repeat(79) }] }, undefined],
  ] as const) {
    const fixture = responses(id, [statusFor(id), { blockHash: genesisHash }, {
      ...balanceFor(id), ...assetResponse,
    }]);
    const result = await createUtxoBalanceReader(fixture).readBalance(id, addressFor(id), signal());
    assert.equal(result.confirmedUnits, '9007199254740993');
    assert.deepEqual(result.assets, expected);
    assert.equal(fixture.calls.length, 3);
  }
});

test('parser rejects Unicode before Bech32 case conversion', () => {
  const kelvin = 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4';
  assert.equal(kelvin.toLowerCase(), BTC);
  assert.throws(() => normalizeUtxoAddress(kelvin, 'bitcoin'));
  assert.equal(normalizeUtxoAddress(BTC.toUpperCase(), 'bitcoin'), BTC);
  assert.equal(normalizeUtxoAddress(BTC, 'bitcoin'), BTC);
});

for (const network of ['syscoin', 'bitcoin', 'utxo:5700'] as const) {
  test(`${network} reader checks metadata and genesis before its one-address summary`, async () => {
    const fixture = responses(network), definition = getUtxoNetwork(network);
    const result = await createUtxoBalanceReader(fixture).readBalance(network, addressFor(network).toUpperCase(), signal());
    assert.deepEqual(result, { networkId: network, kind: 'utxo', chainId: definition.chainId,
      genesisHash: definition.genesisHash, confirmedUnits: '9007199254740993', pendingDeltaUnits: '-123', unconfirmedTransactions: 2, observedHeight: 123 });
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(fixture.calls.map(({ url }) => url), [`${definition.endpoint}/api/v2/`,
      `${definition.endpoint}/api/v2/block-index/0`, `${definition.endpoint}/api/v2/address/${addressFor(network)}?details=tokenBalances&tokens=nonzero`]);
    for (const { init } of fixture.calls) {
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.body, undefined);
      assert.equal(init.signal?.aborted, true);
    }
  });
}

test('testnet rejects mainnet status or genesis and never sends the public account key on redirect', async () => {
  const network = 'utxo:5700';
  const mismatchedFinalUrl = json(statusFor(network));
  Object.defineProperty(mismatchedFinalUrl, 'url', { value: `${getUtxoNetwork(network).endpoint}/api/v2` });
  for (const [bodies, expectedReads] of [
    [[statusFor('syscoin')], 1],
    [[mismatchedFinalUrl], 1],
    [[statusFor(network), { blockHash: getUtxoNetwork('syscoin').genesisHash }], 2],
  ] as const) {
    const fixture = responses(network, [...bodies]);
    await assert.rejects(createUtxoBalanceReader(fixture).readAccount(network, XPUB, signal()), code('NETWORK_MISMATCH'));
    assert.equal(fixture.calls.length, expectedReads);
    assert.ok(fixture.calls.every(({ url, init }) => !url.includes('/xpub/') && init.redirect === 'error'));
  }
});

test('valid zero and positive pending delta remain separate; unrelated asset data never enters results', async () => {
  for (const pending of ['0', '123', '-123']) {
    const body = { ...balanceFor('bitcoin'), balance: '0', unconfirmedBalance: pending,
      tokens: [{ arbitrary: 'asset metadata' }], transactions: ['ignored'] };
    const result = await createUtxoBalanceReader(responses('bitcoin', [statusFor('bitcoin'),
      { blockHash: getUtxoNetwork('bitcoin').genesisHash }, body])).readBalance('bitcoin', BTC, signal());
    assert.equal(result.confirmedUnits, '0'); assert.equal(result.pendingDeltaUnits, pending);
    assert.equal('tokens' in result, false); assert.equal('transactions' in result, false);
  }
});

test('reader rejects unsupported network/address before any transport', async () => {
  let calls = 0;
  const reader = createUtxoBalanceReader({ fetch: async () => { calls++; throw Error('no'); } });
  for (const [network, address] of [['bitcoin', SYS], ['syscoin', BTC], ['ethereum', BTC], ['bitcoin', 'bad']])
    await assert.rejects(reader.readBalance(network as UtxoNetworkId, address!, signal()), code('INVALID_INPUT'));
  assert.equal(calls, 0);
});

test('metadata mismatch or malformed/error records never disclose the address', async () => {
  const good = statusFor('bitcoin');
  for (const body of [null, [], {}, { error: 'private backend detail' },
    { ...good, backend: { chain: 'test' } }, { ...good, backend: { chain: 'main', error: 'private backend detail' } },
    { ...good, blockbook: { ...good.blockbook, coin: 'Syscoin' } },
    { ...good, blockbook: { ...good.blockbook, network: 'SYS' } },
    { ...good, blockbook: { ...good.blockbook, decimals: 18 } },
    { ...good, blockbook: { ...good.blockbook, bestHeight: -1 } },
  ]) {
    const fixture = responses('bitcoin', [body]);
    await assert.rejects(createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, signal()), UtxoBalanceError);
    assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0]!.url.includes(BTC), false);
  }
});

test('unsynchronized metadata and missing mempool status are unavailable before disclosure', async () => {
  for (const flags of [{ initialSync: true }, { inSync: false }, { inSyncMempool: false }, { inSyncMempool: undefined }]) {
    const good = statusFor('syscoin'), fixture = responses('syscoin', [{ ...good, blockbook: { ...good.blockbook, ...flags } }]);
    await assert.rejects(createUtxoBalanceReader(fixture).readBalance('syscoin', SYS, signal()), code('UNAVAILABLE'));
    assert.equal(fixture.calls.length, 1);
  }
});

test('empty backend error is tolerated but wrong or missing genesis prevents address disclosure', async () => {
  const good = statusFor('bitcoin');
  for (const genesis of [{}, { blockHash: '0'.repeat(64) }, { blockHash: getUtxoNetwork('syscoin').genesisHash }, { error: 'private detail' }]) {
    const fixture = responses('bitcoin', [{ ...good, backend: { chain: 'main', error: '' } }, genesis]);
    await assert.rejects(createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, signal()), UtxoBalanceError);
    assert.equal(fixture.calls.length, 2); assert.equal(fixture.calls.some(({ url }) => url.includes(BTC)), false);
  }
});

test('missing pending is unknown, not zero; malformed monetary and count fields always reject', async () => {
  const base = balanceFor('bitcoin');
  for (const summary of [{ ...base, unconfirmedBalance: undefined }, { ...base, balance: undefined },
    { ...base, address: SYS }, { ...base, error: 'private detail' },
    ...[0, 1.1, null, '', '-1', '01', '1e8', '1.0', '9'.repeat(79)].map((balance) => ({ ...base, balance })),
    ...[0, null, '-0', '+1', '01', '1e2', '9'.repeat(79)].map((unconfirmedBalance) => ({ ...base, unconfirmedBalance })),
    ...[-1, 1.1, '2', Number.MAX_SAFE_INTEGER + 1, null].map((unconfirmedTxs) => ({ ...base, unconfirmedTxs })),
  ]) {
    const fixture = responses('bitcoin', [statusFor('bitcoin'), { blockHash: getUtxoNetwork('bitcoin').genesisHash }, summary]);
    await assert.rejects(createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, signal()), code('INVALID_RESPONSE'));
  }
});

test('each refresh revalidates identity and does not reuse a prior address or network result', async () => {
  const calls: string[] = [];
  const reader = createUtxoBalanceReader({ fetch: async (url) => {
    calls.push(url); const n = url.startsWith(getUtxoNetwork('bitcoin').endpoint) ? 'bitcoin' : 'syscoin';
    return json(url.endsWith('/api/v2/') ? statusFor(n) : url.endsWith('/0') ? { blockHash: getUtxoNetwork(n).genesisHash } : balanceFor(n));
  } });
  for (const n of ['bitcoin', 'syscoin', 'bitcoin'] as const) await reader.readBalance(n, addressFor(n), signal());
  assert.equal(calls.length, 9); assert.equal(calls.filter((url) => url.endsWith('/api/v2/')).length, 3);
});

test('transport refuses redirects, unexpected final URLs, HTTP errors, non-JSON and malformed JSON', async () => {
  const redirected = json(statusFor('bitcoin')); Object.defineProperty(redirected, 'redirected', { value: true });
  const wrongUrl = json(statusFor('bitcoin')); Object.defineProperty(wrongUrl, 'url', { value: 'https://elsewhere.invalid/api/v2/' });
  for (const response of [redirected, wrongUrl, new Response('redirect', { status: 302 }),
    new Response('private error', { status: 500 }), new Response('{}', { headers: { 'content-type': 'text/html' } }), new Response('{')]) {
    const fixture = responses('bitcoin', [response]);
    await assert.rejects(createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, signal()), UtxoBalanceError);
    assert.equal(fixture.calls.length, 1);
  }
});

test('bounds every response, including lying content length, multibyte native text and ignored assets', async () => {
  const native = { ok: true, redirected: false, url: '', headers: new Headers(), body: null,
    text: async () => 'é'.repeat(16385) } as unknown as Response;
  for (const oversized of [new Response('x'.repeat(32769), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '32769' } }),
    new Response('x'.repeat(32769), { headers: { 'content-type': 'application/json', 'content-length': '2' } }), native]) {
    await assert.rejects(createUtxoBalanceReader(responses('bitcoin', [oversized])).readBalance('bitcoin', BTC, signal()), code('RESPONSE_TOO_LARGE'));
  }
  const fixture = responses('syscoin', [statusFor('syscoin'), { blockHash: getUtxoNetwork('syscoin').genesisHash },
    { ...balanceFor('syscoin'), tokens: ['x'.repeat(32768)] }]);
  await assert.rejects(createUtxoBalanceReader(fixture).readBalance('syscoin', SYS, signal()), code('RESPONSE_TOO_LARGE'));
  const genesis = responses('bitcoin', [statusFor('bitcoin'), { blockHash: getUtxoNetwork('bitcoin').genesisHash, padding: 'x'.repeat(32768) }]);
  await assert.rejects(createUtxoBalanceReader(genesis).readBalance('bitcoin', BTC, signal()), code('RESPONSE_TOO_LARGE'));
  assert.equal(genesis.calls.length, 2);
});

test('the exact response-byte boundary remains readable', async () => {
  const body = { ...statusFor('bitcoin'), padding: '' };
  body.padding = 'x'.repeat(32768 - JSON.stringify(body).length);
  assert.equal(new TextEncoder().encode(JSON.stringify(body)).length, 32768);
  const fixture = responses('bitcoin', [body, { blockHash: getUtxoNetwork('bitcoin').genesisHash }, balanceFor('bitcoin')]);
  assert.equal((await createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, signal())).confirmedUnits, '9007199254740993');
});

test('transport rejection exposes no provider payload and never retries another endpoint', async () => {
  let calls = 0;
  const reader = createUtxoBalanceReader({ fetch: async () => { calls++; throw new Error(`private provider payload ${BTC}`); } });
  await assert.rejects(reader.readBalance('bitcoin', BTC, signal()), code('UNAVAILABLE'));
  assert.equal(calls, 1);
});

test('abort before dispatch and abort after metadata prevent later requests', async () => {
  const controller = new AbortController(), fixture = responses('bitcoin');
  controller.abort(); await assert.rejects(createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, controller.signal), code('CANCELLED'));
  assert.equal(fixture.calls.length, 0);
  const next = new AbortController(); let calls = 0;
  const reader = createUtxoBalanceReader({ fetch: async () => { calls++; next.abort(); return json(statusFor('bitcoin')); } });
  await assert.rejects(reader.readBalance('bitcoin', BTC, next.signal), code('CANCELLED')); assert.equal(calls, 1);
  const beforeMicrotask = new AbortController(); let dispatched = false;
  const pending = createUtxoBalanceReader({ fetch: async () => { dispatched = true; return json({}); } }).readBalance('bitcoin', BTC, beforeMicrotask.signal);
  beforeMicrotask.abort(); await assert.rejects(pending, code('CANCELLED')); assert.equal(dispatched, false);
});

test('deadline rejects an abort-ignoring fetch; late transport completion cannot produce a balance', async () => {
  let release!: (response: Response) => void;
  let called!: () => void;
  const started = new Promise<void>((resolve) => { called = resolve; });
  const reader = createUtxoBalanceReader({ timeoutMs: 10, fetch: () => { called(); return new Promise((resolve) => { release = resolve; }); } });
  const pending = reader.readBalance('bitcoin', BTC, signal());
  await started; await assert.rejects(pending, code('CANCELLED'));
  release(json(statusFor('bitcoin'))); await Promise.resolve();
});

test('abort cancels an in-progress streamed body and does not advance to another endpoint', async () => {
  const controller = new AbortController(); let cancel = 0, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const response = { ok: true, redirected: false, url: '', headers: new Headers(), body: { getReader: () => ({
    read: () => { entered(); return new Promise(() => undefined); }, cancel: async () => { cancel++; },
  }) } } as unknown as Response;
  const fixture = responses('bitcoin', [response]);
  const pending = createUtxoBalanceReader(fixture).readBalance('bitcoin', BTC, controller.signal);
  await started; controller.abort(); await assert.rejects(pending, code('CANCELLED'));
  assert.equal(cancel, 1); assert.equal(fixture.calls.length, 1);
});

test('one request cancellation does not poison another independent read', async () => {
  const controller = new AbortController(), healthy = responses('syscoin');
  const reader = createUtxoBalanceReader({ fetch: (url, init) => url.startsWith(getUtxoNetwork('bitcoin').endpoint)
    ? new Promise(() => undefined) : healthy.fetch(url, init) });
  const cancelled = reader.readBalance('bitcoin', BTC, controller.signal); controller.abort();
  await assert.rejects(cancelled, code('CANCELLED'));
  assert.equal((await reader.readBalance('syscoin', SYS, signal())).networkId, 'syscoin');
});

test('invalid timeout configuration fails before any work', () => {
  for (const timeoutMs of [0, -1, 0.5, Infinity, NaN, 30001]) assert.throws(() => createUtxoBalanceReader({ fetch: async () => json({}), timeoutMs }));
});

test('reader requires an explicit function port and never falls back to ambient fetch', () => {
  let calls = 0, getterCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return json({}); };
  const accessor = { get fetch() { getterCalls++; return globalThis.fetch; } };
  try {
    for (const invalid of [undefined, null, {}, [], { fetch: undefined }, { fetch: null }, { fetch: 1 }, { fetch: {} }, accessor])
      assert.throws(() => createUtxoBalanceReader(invalid as never), /explicit UTXO fetch port/);
    createUtxoBalanceReader({ fetch: async () => { calls++; return json({}); } });
    assert.equal(calls, 0); assert.equal(getterCalls, 0);
  } finally { globalThis.fetch = original; }
});
