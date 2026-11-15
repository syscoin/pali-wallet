import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDappRpcReadHost } from '../src/custody/dappRpcReads.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { classifyDappRpcMethod, executeDappRpcRequest, normalizeDappRpcRequest } from '../../../source/shared/dappRpcReads.ts';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum.js';
import { Wallet } from 'ethers/wallet';
import { Signature } from 'ethers/crypto';
import { getBytes } from 'ethers/utils';

const registration = createNativeNetwork({ id: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: '1', slip44: 60, rpcUrl: 'https://rpc.example', symbol: 'ETH', decimals: 18, testnet: false });
const json = (id: number, value: Record<string, unknown>) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...value }), { headers: { 'content-type': 'application/json' } });
const HASH = `0x${'22'.repeat(32)}`;
const NODE_PUBLIC_CASES = [
  ['eth_coinbase', [], `0x${'33'.repeat(20)}`], ['web3_sha3', ['0Xabcd'], HASH],
  ['eth_getFilterChanges', ['0x0000aBcD'], []], ['eth_getFilterLogs', ['opaque-filter-ID'], []],
  ['eth_newBlockFilter', [], 'opaque-block-filter'], ['eth_newFilter', [{ topics: [null] }], '0x0000aBcD'],
  ['eth_newPendingTransactionFilter', [true], 'opaque-pending-filter'], ['eth_uninstallFilter', ['0x0000aBcD'], false],
  ['eth_getWork', [], [HASH, HASH, HASH, '0x1']], ['eth_hashrate', [], '0x0'], ['eth_mining', [], false],
  ['eth_submitHashrate', [`0x${'00'.repeat(31)}01`, HASH], false],
  ['eth_submitWork', ['0x0000000000000001', HASH, HASH], false],
] as const;
test('public reads use the saved endpoint and a bounded verified identity lease', async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  let checks = 0;
  const host = createNativeDappRpcReadHost({ verifyPersonalMessage() { throw new Error('RPC reads must not invoke recovery'); }, registration: () => registration, async fetch(url, init) {
    assert.equal(url, registration.rpcUrl); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const request = JSON.parse(init.body as string); calls.push(request);
    return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
  } });
  assert.equal(await host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => { checks++; }), '0x42');
  assert.deepEqual(calls.map(value => value.method), ['eth_chainId', 'eth_blockNumber']);
  assert(checks >= 4);
});
test('RPC execution errors retain the exact revert code, message and hex data', async () => {
  const host = createNativeDappRpcReadHost({ verifyPersonalMessage() { throw new Error('RPC reads must not invoke recovery'); }, registration: () => registration, async fetch(_url, init) {
    const request = JSON.parse(init.body as string);
    return json(request.id, request.method === 'eth_chainId' ? { result: '0x1' } : { error: { code: 3, message: 'execution reverted', data: '0x1234' } });
  } });
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_call', [{ to: `0x${'11'.repeat(20)}` }]), new AbortController().signal, () => {}), { code: 3, message: 'execution reverted', data: '0x1234' });
});

test('twenty valid RPC reverts preserve the verified identity lease', async () => {
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      return json(request.id, request.method === 'eth_chainId' ? { result: '0x1' }
        : { error: { code: 3, message: 'execution reverted', data: '0x1234' } });
    } });
  const request = normalizeDappRpcRequest('eth_call', [{ to: `0x${'11'.repeat(20)}` }]);
  for (let index = 0; index < 20; index++)
    await assert.rejects(host.read(request, new AbortController().signal, () => {}), { code: 3, message: 'execution reverted', data: '0x1234' });
  assert.equal(calls.filter(method => method === 'eth_chainId').length, 1);
  assert.equal(calls.filter(method => method === 'eth_call').length, 20);
});

test('a valid control error preserves an existing query identity lease', async () => {
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      return json(request.id, request.method === 'eth_newBlockFilter'
        ? { error: { code: -32601, message: 'Method unavailable on this node' } }
        : { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const request = normalizeDappRpcRequest('eth_blockNumber', []);
  await host.read(request, new AbortController().signal, () => {});
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_newBlockFilter', []), new AbortController().signal, () => {}), { code: -32601 });
  assert.equal(await host.read(request, new AbortController().signal, () => {}), '0x42');
  assert.deepEqual(calls, ['eth_chainId', 'eth_blockNumber', 'eth_chainId', 'eth_newBlockFilter', 'eth_blockNumber']);
});

for (const lane of ['query', 'control'] as const) test(`a malformed ${lane} response invalidates the identity lease`, async () => {
  let malformed = false;
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      if (malformed && request.method !== 'eth_chainId') return json(request.id + 1, { result: '0x42' });
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const query = normalizeDappRpcRequest('eth_blockNumber', []);
  await host.read(query, new AbortController().signal, () => {});
  malformed = true;
  await assert.rejects(host.read(lane === 'query' ? query : normalizeDappRpcRequest('eth_newBlockFilter', []), new AbortController().signal, () => {}));
  malformed = false;
  const before = calls.length;
  assert.equal(await host.read(query, new AbortController().signal, () => {}), '0x42');
  assert.deepEqual(calls.slice(before), ['eth_chainId', 'eth_blockNumber']);
});

test('a control chain-probe RPC error invalidates a warm identity lease', async () => {
  let failChain = false;
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      return json(request.id, failChain && request.method === 'eth_chainId'
        ? { error: { code: -32601, message: 'Method unavailable on this node' } }
        : { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const query = normalizeDappRpcRequest('eth_blockNumber', []);
  await host.read(query, new AbortController().signal, () => {});
  failChain = true;
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_newBlockFilter', []), new AbortController().signal, () => {}));
  await assert.rejects(host.read(query, new AbortController().signal, () => {}));
  assert.deepEqual(calls, ['eth_chainId', 'eth_blockNumber', 'eth_chainId', 'eth_chainId']);
});

for (const lane of ['query', 'control'] as const) test(`cancelled ${lane} work preserves the current identity lease`, async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const lifetime = new AbortController();
  const calls: string[] = [];
  let held = false;
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      if (held && request.method !== 'eth_chainId') { entered.resolve(); await release.promise; }
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const query = normalizeDappRpcRequest('eth_blockNumber', []);
  await host.read(query, new AbortController().signal, () => {});
  held = true;
  const stopped = host.read(lane === 'query' ? query : normalizeDappRpcRequest('eth_newBlockFilter', []), lifetime.signal, () => {});
  const rejected = assert.rejects(stopped);
  await entered.promise; lifetime.abort(); await rejected;
  held = false; release.resolve(); await new Promise(resolve => setImmediate(resolve));
  const before = calls.length;
  assert.equal(await host.read(query, new AbortController().signal, () => {}), '0x42');
  assert.deepEqual(calls.slice(before), ['eth_blockNumber']);
});
for (const fault of ['chain', 'registration', 'redirect', 'bytes', 'guard', 'abort']) test(`public reads fail closed on ${fault}`, async () => {
  let selected = registration, valid = true;
  const controller = new AbortController();
  const host = createNativeDappRpcReadHost({ verifyPersonalMessage() { throw new Error('RPC reads must not invoke recovery'); }, registration: () => selected, async fetch(_url, init) {
    const request = JSON.parse(init.body as string);
    if (request.method !== 'eth_chainId') {
      if (fault === 'registration') selected = { ...registration, registrationHash: `0x${'22'.repeat(32)}` };
      if (fault === 'guard') valid = false;
      if (fault === 'abort') controller.abort();
    }
    const response = json(request.id, { result: request.method === 'eth_chainId' ? fault === 'chain' ? '0x2' : '0x1' : fault === 'bytes' ? 'x'.repeat(1024 * 1024 + 1) : '0x42' });
    if (fault === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    return response;
  } });
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_blockNumber', []), controller.signal, () => { if (!valid) throw new Error('STALE'); }));
});
test('a read deadline aborts a provider that never settles without extending other wallet read limits', async () => {
  const rpc = new EvmTransferReadRpc(registration, { timeoutMs: 1, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(rpc.dappRequest(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {}));
});

for (const [method, params, result] of [
  ['eth_getLogs', [{ address: `0x${'11'.repeat(20)}`, topics: [null, [`0x${'22'.repeat(32)}`, null]], fromBlock: 'earliest', toBlock: 'pending' }], []],
  ['eth_getProof', [`0x${'11'.repeat(20)}`, ['0XABC', '0x', `0x${'00'.repeat(32)}`], null], { storageProof: [] }],
  ['web3_clientVersion', [], 'Example/v1'], ['net_listening', [], false], ['net_peerCount', [], '0x0'],
  ...NODE_PUBLIC_CASES,
] as const) test(`${method} uses the common execution request with its public-read identity policy`, async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Must not verify'); }, async fetch(_url, init) {
      const request = JSON.parse(init.body as string); calls.push(request);
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : result });
    } });
  const request = normalizeDappRpcRequest(method, params);
  assert.deepEqual(await host.read(request, new AbortController().signal, () => {}), result);
  assert.deepEqual(calls.map(value => value.method), classifyDappRpcMethod(method) === 'node-query' ? ['eth_chainId', method] : ['eth_chainId', method, 'eth_chainId']);
  assert.deepEqual(calls[1]!.params, request.params);
});

for (const [method, params] of NODE_PUBLIC_CASES) test(`${method} preserves node errors without an implicit retry`, async () => {
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Must not verify'); }, async fetch(_url, init) {
      const request = JSON.parse(init.body as string); calls.push(request.method);
      return json(request.id, request.method === 'eth_chainId' ? { result: '0x1' } : { error: { code: -32601, message: 'Method unavailable on this node' } });
    } });
  await assert.rejects(host.read(normalizeDappRpcRequest(method, params), new AbortController().signal, () => {}), { code: -32601, message: 'Method unavailable on this node' });
  assert.equal(calls.filter(value => value === method).length, 1);
});
for (const [method, params, result] of NODE_PUBLIC_CASES) test(`${method} retains selected-source and cancellation fences after a node operation`, async () => {
  for (const change of ['source', 'abort'] as const) {
    let selected = registration, attempts = 0;
    const lifetime = new AbortController();
    const host = createNativeDappRpcReadHost({ registration: () => selected,
      verifyPersonalMessage() { throw Error('Must not verify'); }, async fetch(_url, init) {
        const request = JSON.parse(init.body as string);
        if (request.method !== 'eth_chainId') {
          attempts++;
          if (change === 'source') selected = { ...registration, registrationHash: `0x${'ff'.repeat(32)}` };
          else lifetime.abort();
        }
        return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : result });
      } });
    await assert.rejects(host.read(normalizeDappRpcRequest(method, params), lifetime.signal, () => {}));
    assert.equal(attempts, 1);
  }
});

test('actual published SDK recovery vectors share exact text/hex decoding and checksum without keys, devices or RPC', async () => {
  const unavailable = (): never => { throw Error('Public recovery must not access wallet/network/signing state'); };
  const sdk = new EthereumTransactions(unavailable, unavailable, unavailable, undefined, undefined, unavailable, null);
  const wallet = new Wallet(`0x${'11'.repeat(32)}`);
  let rpcCalls = 0;
  const verifyPersonalMessage = (message: string, signature: string) => sdk.verifyPersonalMessage(message, signature);
  const host = createNativeDappRpcReadHost({ registration: () => registration, verifyPersonalMessage,
    async fetch() { rpcCalls++; throw Error('Recovery must not call RPC'); } });
  for (const [message, signedMessage] of [['', ''], ['public ✓', 'public ✓'], ['0xabc', getBytes('0x0abc')]] as const) {
    const signature = await wallet.signMessage(signedMessage);
    for (const encoded of [signature, Signature.from(signature).compactSerialized, signature.slice(0, -2) + '00' + signature.slice(-2)]) {
      const request = normalizeDappRpcRequest('personal_ecRecover', [message, encoded]);
      const extensionResult = await executeDappRpcRequest(request, { assertCurrent() {}, verifyPersonalMessage,
        async request() { throw Error('Recovery must not call remote execution'); } });
      assert.equal(extensionResult, wallet.address);
      assert.equal(await host.read(request, new AbortController().signal, () => {}), extensionResult);
    }
  }
  assert.equal(rpcCalls, 0);
  await assert.rejects(host.read(normalizeDappRpcRequest('personal_ecRecover', ['public', 'invalid']), new AbortController().signal, () => {}));
});

test('local recovery retains source/abort guards and cannot leak onto the HTTP-only port', async () => {
  const lifetime = new AbortController(); let current = true;
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { current = false; return `0x${'11'.repeat(20)}`; },
    async fetch() { throw Error('Must not fetch'); } });
  const request = normalizeDappRpcRequest('personal_ecRecover', ['text', 'signature']);
  await assert.rejects(host.read(request, lifetime.signal, () => { if (!current) throw Error('STALE'); }), /STALE/);
  current = true; lifetime.abort();
  await assert.rejects(host.read(request, lifetime.signal, () => {}), /CONTEXT_CHANGED/);
  await assert.rejects(new EvmTransferReadRpc(registration, { fetch: async () => { throw Error('Must not fetch'); } })
    .dappRequest(request, new AbortController().signal, () => {}), /INVALID_INPUT/);
});

test('twenty sequential display queries share one identity check and expiry refreshes it', async () => {
  let time = 1, chains = 0, queries = 0;
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => time,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (request.method === 'eth_chainId') chains++; else queries++;
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const request = normalizeDappRpcRequest('eth_getBalance', [`0x${'11'.repeat(20)}`, 'latest']);
  for (let index = 0; index < 20; index++) assert.equal(await host.read(request, new AbortController().signal, () => {}), '0x42');
  assert.equal(chains, 1); assert.equal(queries, 20);
  time += 30001;
  await host.read(request, new AbortController().signal, () => {});
  assert.equal(chains, 2);
  host.reset!();
  await host.read(request, new AbortController().signal, () => {});
  assert.equal(chains, 3);
});

test('identical concurrent queries share transport with independent cancellation', async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let queries = 0, signal: AbortSignal | undefined;
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (request.method === 'eth_chainId') return json(request.id, { result: '0x1' });
      queries++; signal = init.signal as AbortSignal; entered.resolve(); await release.promise;
      return json(request.id, { result: { records: [1] } });
    } });
  const request = normalizeDappRpcRequest('eth_getLogs', [{}]);
  const first = new AbortController();
  const a = host.read(request, first.signal, () => {}), b = host.read(request, new AbortController().signal, () => {});
  const rejected = assert.rejects(a);
  await entered.promise; first.abort(); await rejected;
  assert.equal(signal!.aborted, false); release.resolve();
  assert.deepEqual(await b, { records: [1] }); assert.equal(queries, 1);
});

test('sixteen different reads keep four physical requests active across owner replacement', async () => {
  let context = 'first', active = 0, peak = 0;
  const releases: (() => void)[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, context: () => context,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (Array.isArray(request)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch not supported' } });
      if (request.method === 'eth_chainId') return json(request.id, { result: '0x1' });
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(() => { active--; resolve(); }));
      return json(request.id, { result: '0x42' });
    } });
  const tasks = Array.from({ length: 16 }, (_, index) => host.read(normalizeDappRpcRequest('eth_getBalance', [`0x${(index + 1).toString(16).padStart(40, '0')}`, 'latest']), new AbortController().signal, () => {}));
  const completed = Promise.allSettled(tasks);
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(active, 4); context = 'second'; host.reset!();
  await completed;
  const next = host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {});
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(active, 4);
  releases.splice(0).forEach(release => release());
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  releases.splice(0).forEach(release => release());
  assert.equal(await next, '0x42'); assert(peak <= 4);
});

test('controls never join and context replacement retires the identity lease', async () => {
  let context = 'a', chains = 0, controls = 0;
  const host = createNativeDappRpcReadHost({ registration: () => registration, context: () => context,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (request.method === 'eth_chainId') chains++; else controls++;
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const control = normalizeDappRpcRequest('eth_newBlockFilter', []);
  await Promise.all([host.read(control, new AbortController().signal, () => {}), host.read(control, new AbortController().signal, () => {})]);
  assert.equal(controls, 2); assert.equal(chains, 4);
  const read = normalizeDappRpcRequest('eth_blockNumber', []);
  await host.read(read, new AbortController().signal, () => {}); assert.equal(chains, 5);
  context = 'b'; await host.read(read, new AbortController().signal, () => {}); assert.equal(chains, 6);
  context = 'a'; await host.read(read, new AbortController().signal, () => {}); assert.equal(chains, 7);
});

test('one cancelled query does not cancel shared identity verification needed by another query', async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let chains = 0, verificationSignal: AbortSignal | undefined;
  const methods: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); methods.push(request.method);
      if (request.method === 'eth_chainId') {
        chains++; verificationSignal = init.signal as AbortSignal;
        entered.resolve(); await release.promise;
      }
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const first = new AbortController();
  const a = host.read(normalizeDappRpcRequest('eth_blockNumber', []), first.signal, () => {});
  const rejected = assert.rejects(a);
  const b = host.read(normalizeDappRpcRequest('eth_gasPrice', []), new AbortController().signal, () => {});
  await entered.promise;
  first.abort(); await rejected;
  assert.equal(verificationSignal!.aborted, false);
  release.resolve();
  assert.equal(await b, '0x42');
  assert.equal(chains, 1);
  assert.deepEqual(methods, ['eth_chainId', 'eth_gasPrice']);
});

test('joined query subscribers receive independently mutable result copies', async () => {
  const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  let queries = 0;
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (request.method === 'eth_chainId') return json(request.id, { result: '0x1' });
      queries++; entered.resolve(); await release.promise;
      return json(request.id, { result: [{ topics: ['original'] }] });
    } });
  const request = normalizeDappRpcRequest('eth_getLogs', [{}]);
  const first = host.read(request, new AbortController().signal, () => {});
  const second = host.read(request, new AbortController().signal, () => {});
  await entered.promise; release.resolve();
  const [a, b] = await Promise.all([first, second]) as { topics: string[] }[][];
  assert(a && b);
  a[0]!.topics[0] = 'changed';
  assert.equal(b[0]!.topics[0], 'original');
  assert.notEqual(a, b); assert.notEqual(a[0], b[0]); assert.equal(queries, 1);
});

test('expired identity refuses wrong-chain reads and retries verification before serving again', async () => {
  let time = 1000, chain = '0x1', chains = 0, queries = 0;
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => time,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (request.method === 'eth_chainId') chains++; else queries++;
      return json(request.id, { result: request.method === 'eth_chainId' ? chain : '0x42' });
    } });
  const request = normalizeDappRpcRequest('eth_blockNumber', []);
  await host.read(request, new AbortController().signal, () => {});
  time += 30001; chain = '0x2';
  await assert.rejects(host.read(request, new AbortController().signal, () => {}));
  assert.equal(queries, 1);
  chain = '0x1';
  assert.equal(await host.read(request, new AbortController().signal, () => {}), '0x42');
  assert.equal(chains, 3); assert.equal(queries, 2);
});

test('a failed control retires the warm identity lease before the next query', async () => {
  let chain = '0x1';
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      return json(request.id, { result: request.method === 'eth_chainId' ? chain : '0x42' });
    } });
  const query = normalizeDappRpcRequest('eth_blockNumber', []);
  assert.equal(await host.read(query, new AbortController().signal, () => {}), '0x42');
  chain = '0x2';
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_newBlockFilter', []), new AbortController().signal, () => {}));
  await assert.rejects(host.read(query, new AbortController().signal, () => {}));
  assert.deepEqual(calls, ['eth_chainId', 'eth_blockNumber', 'eth_chainId', 'eth_chainId']);
});

test('a late failed control cannot retire the replacement owner identity lease', async () => {
  let context = 'first';
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, context: () => context, now: () => 1000,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      if (request.method === 'eth_newBlockFilter') {
        entered.resolve(); await release.promise;
        return json(request.id, { error: { code: -32601, message: 'Control unavailable' } });
      }
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
    } });
  const query = normalizeDappRpcRequest('eth_blockNumber', []);
  const old = host.read(normalizeDappRpcRequest('eth_newBlockFilter', []), new AbortController().signal, () => {});
  const rejected = assert.rejects(old);
  await entered.promise;
  context = 'second';
  assert.equal(await host.read(query, new AbortController().signal, () => {}), '0x42');
  release.resolve(); await rejected;
  assert.equal(await host.read(query, new AbortController().signal, () => {}), '0x42');
  assert.deepEqual(calls, ['eth_chainId', 'eth_newBlockFilter', 'eth_chainId', 'eth_blockNumber', 'eth_blockNumber']);
});

test('owner replacement waits for four held body cancellations before new physical reads', async () => {
  let context = 'first', physical = 0, peak = 0, entered = 0;
  const allEntered = Promise.withResolvers<void>();
  const releaseBodies: (() => void)[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, context: () => context,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const request = JSON.parse(String(init.body));
      if (Array.isArray(request)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch not supported' } });
      if (request.method === 'eth_chainId') return json(request.id, { result: '0x1' });
      if (context === 'second') return json(request.id, { result: '0x42' });
      physical++; peak = Math.max(peak, physical);
      const cleanup = Promise.withResolvers<void>();
      releaseBodies.push(() => { physical--; cleanup.resolve(); });
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
        text: () => { throw Error('Streaming response must use its reader'); },
        body: { cancel: () => cleanup.promise, getReader: () => ({
          read: () => { entered++; if (entered === 4) allEntered.resolve(); return new Promise(() => {}); },
          cancel: () => cleanup.promise, releaseLock() {},
        }) },
      } as unknown as Response;
    } });
  const first = Promise.allSettled(Array.from({ length: 4 }, (_, index) => host.read(
    normalizeDappRpcRequest('eth_getBalance', [`0x${(index + 1).toString(16).padStart(40, '0')}`, 'latest']),
    new AbortController().signal, () => {})));
  await allEntered.promise;
  context = 'second'; host.reset!(); await first;
  let complete = false;
  const second = host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {}).then(value => { complete = true; return value; });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(physical, 4); assert.equal(complete, false);
  releaseBodies.forEach(release => release());
  assert.equal(await second, '0x42'); assert.equal(physical, 0); assert.equal(peak, 4);
});


test('twenty distinct concurrent public reads use one bounded batch after identity verification', async () => {
  const envelopes: unknown[][] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => 1,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const input = JSON.parse(String(init.body));
      const requests = Array.isArray(input) ? input : [input];
      envelopes.push(requests);
      const responses = requests.map(request => ({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'eth_chainId' ? '0x1' : request.params[0] }));
      return Response.json(Array.isArray(input) ? responses.reverse() : responses[0]);
    } });
  const addresses = Array.from({ length: 20 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`);
  const results = await Promise.all(addresses.map(address => host.read(
    normalizeDappRpcRequest('eth_getBalance', [address, 'latest']), new AbortController().signal, () => {})));
  assert.deepEqual(results, addresses);
  assert.deepEqual(envelopes.map(rows => rows.length), [1, 20]);
});

test('a public batch rechecks an identity lease that expires while its response is pending', async () => {
  let time = 1, chain = '0x1';
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration, now: () => time,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const input = JSON.parse(String(init.body));
      const requests = Array.isArray(input) ? input : [input];
      calls.push(...requests.map(request => request.method));
      if (requests[0].method !== 'eth_chainId') { entered.resolve(); await release.promise; }
      const responses = requests.map(request => ({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'eth_chainId' ? chain : '0x42' }));
      return Response.json(Array.isArray(input) ? responses : responses[0]);
    } });
  const pending = host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {});
  const rejected = assert.rejects(pending);
  await entered.promise; time = 30002; chain = '0x2'; release.resolve(); await rejected;
  assert.deepEqual(calls, ['eth_chainId', 'eth_blockNumber', 'eth_chainId']);
});


test('one invalid-chain simulation does not reject a healthy sibling query', async () => {
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const input = JSON.parse(String(init.body));
      const requests = Array.isArray(input) ? input : [input];
      calls.push(...requests.map(request => request.method));
      const responses = requests.map(request => ({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'eth_chainId' ? '0x1' : '0x42' }));
      return Response.json(Array.isArray(input) ? responses : responses[0]);
    } });
  const wrong = host.read(normalizeDappRpcRequest('eth_call', [{ chainId: '0x2', to: `0x${'11'.repeat(20)}` }]), new AbortController().signal, () => {});
  const good = host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {});
  await assert.rejects(wrong, { code: -32602 });
  assert.equal(await good, '0x42');
  assert.deepEqual(calls, ['eth_chainId', 'eth_blockNumber']);
});

test('one oversized logical result rejects only that batch member', async () => {
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const input = JSON.parse(String(init.body));
      const requests = Array.isArray(input) ? input : [input];
      const responses = requests.map(request => ({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'eth_chainId' ? '0x1' : request.method === 'eth_getLogs' ? Array(10001).fill(0) : '0x42' }));
      return Response.json(Array.isArray(input) ? responses : responses[0]);
    } });
  const oversized = host.read(normalizeDappRpcRequest('eth_getLogs', [{}]), new AbortController().signal, () => {});
  const good = host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {});
  await assert.rejects(oversized);
  assert.equal(await good, '0x42');
});

test('cancelling one batch member preserves its sibling and the warm identity lease', async () => {
  let chains = 0;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Unexpected recovery'); }, async fetch(_url, init) {
      const input = JSON.parse(String(init.body));
      const requests = Array.isArray(input) ? input : [input];
      if (requests[0].method === 'eth_chainId') chains++;
      else if (Array.isArray(input)) { entered.resolve(); await release.promise; }
      const responses = requests.map(request => ({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'eth_chainId' ? '0x1' : '0x42' }));
      return Response.json(Array.isArray(input) ? responses : responses[0]);
    } });
  const lifetime = new AbortController();
  const a = host.read(normalizeDappRpcRequest('eth_blockNumber', []), lifetime.signal, () => {});
  const rejected = assert.rejects(a);
  const b = host.read(normalizeDappRpcRequest('eth_gasPrice', []), new AbortController().signal, () => {});
  await entered.promise; lifetime.abort(); await rejected; release.resolve();
  assert.equal(await b, '0x42');
  await host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {});
  assert.equal(chains, 1);
});
