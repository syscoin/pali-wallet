import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityReceiptReader } from '../src/activity/receiptReader.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const HASH = `0x${'a'.repeat(64)}`;
const BLOCK = `0x${'b'.repeat(64)}`;
const FINAL_BLOCK = `0x${'c'.repeat(64)}`;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
const signal = () => new AbortController().signal;
const tx = (fields: Record<string, unknown> = {}) => ({ hash: HASH, from: OWNER, to: OTHER, value: '0x64', nonce: '0x1',
  blockHash: BLOCK, blockNumber: '0x50', transactionIndex: '0x2', ...fields });
const log = (fields: Record<string, unknown> = {}) => ({ address: TOKEN, transactionHash: HASH, blockHash: BLOCK,
  blockNumber: '0x50', transactionIndex: '0x2', logIndex: '0x3', removed: false,
  topics: [TRANSFER, topic(OTHER), topic(OWNER)], data: `0x${'0'.repeat(60)}abcd`, ...fields });
const receipt = (fields: Record<string, unknown> = {}) => ({ transactionHash: HASH, from: OWNER, to: OTHER,
  blockHash: BLOCK, blockNumber: '0x50', transactionIndex: '0x2', status: '0x1', logs: [],
  gasUsed: '0x5208', effectiveGasPrice: '0xa', ...fields });
type Call = { method: string; params: unknown[]; signal: AbortSignal };
function fixture(override?: (call: Call) => unknown | Promise<unknown>, timeoutMs?: number, network = getNativeNetwork('ethereum')) {
  const calls: Call[] = [];
  const reader = new ActivityReceiptReader({ timeoutMs, fetch: async (url, init) => {
    assert.equal(url, network.rpcUrl);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const input = JSON.parse(String(init.body));
    const call = { method: input.method, params: input.params, signal: init.signal } as Call;
    calls.push(call);
    assert(['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber'].includes(call.method));
    let result = override ? await override(call) : undefined;
    if (result instanceof Response) return result;
    if (result === undefined) {
      if (call.method === 'eth_chainId') result = `0x${BigInt(network.chainId).toString(16)}`;
      else if (call.method === 'eth_getTransactionByHash') result = tx();
      else if (call.method === 'eth_getTransactionReceipt') result = receipt();
      else if (call.method === 'eth_getBlockByNumber') result = call.params[0] === 'finalized' || call.params[0] === '0x60'
        ? { number: '0x60', hash: FINAL_BLOCK, timestamp: '0x6553f164' }
        : { number: call.params[0], hash: BLOCK, timestamp: '0x6553f100', gasLimit: '0x1c9c380' };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  return { reader, calls };
}

test('Activity returns exact direct ETH observations, canonical timestamp and immediate confirmation using only registered read methods', async () => {
  const f = fixture();
  const result = await f.reader.read(HASH.toUpperCase().replace('0X', '0x'), OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
  assert.deepEqual(result, { hash: HASH, from: OWNER, to: OTHER, valueUnits: '100', nonce: '1',
    block: { hash: BLOCK, number: '80' }, timestamp: 1700000000000, status: 'confirmed', events: [], feeUnits: '210000' });
  assert.equal(f.calls[0]?.method, 'eth_chainId');
  assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
  assert.equal(f.calls.filter((call) => call.method === 'eth_getTransactionReceipt').length, 1);
});

test('canonical success and revert are observed without finalized RPC calls', async () => {
  for (const [status, expected] of [['0x1', 'confirmed'], ['0x0', 'reverted']] as const) {
    const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ status }) : undefined);
    assert.equal((await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')))?.status, expected);
    assert.equal(f.calls.some((call) => call.params.includes('finalized')), false);
  }
});

test('historical root receipts retain canonical placement and fee without an invented execution outcome', async () => {
  const stateRoot = `0x${'d'.repeat(64)}`;
  const historical = receipt({ status: undefined, root: stateRoot, blockNumber: '0x2dc6c0', effectiveGasPrice: '0x3b9aca00' });
  const f = fixture(call => call.method === 'eth_getTransactionReceipt' ? historical :
    call.method === 'eth_getTransactionByHash' ? tx({ blockNumber: historical.blockNumber }) : undefined);
  const result = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
  assert.equal(result?.status, 'unknown');
  assert.deepEqual(result?.block, { hash: BLOCK, number: '3000000' });
  assert.equal(result?.feeUnits, '21000000000000');
  assert.equal(formatBaseUnits(result!.feeUnits!, 18), '0.000021');
  assert.equal(f.calls.length, 5);
  const legacy = fixture(call => call.method === 'eth_getTransactionReceipt' ? receipt({ status: undefined, root: stateRoot, type: '0x0' }) : undefined);
  assert.equal((await legacy.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')))?.status, 'unknown');
  for (const type of ['0x1', '0x2', '0x3', '0x4', null]) {
    const typed = fixture(call => call.method === 'eth_getTransactionReceipt' ? receipt({ status: undefined, root: stateRoot, type }) : undefined);
    await assert.rejects(typed.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
  }
  for (const root of [undefined, null, '0x1234', `0x${'z'.repeat(64)}`]) {
    const invalid = fixture(call => call.method === 'eth_getTransactionReceipt' ? receipt({ status: undefined, root }) : undefined);
    await assert.rejects(invalid.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
  }
  const reorg = fixture(call => call.method === 'eth_getTransactionReceipt' ? historical :
    call.method === 'eth_getTransactionByHash' ? tx({ blockNumber: historical.blockNumber }) :
    call.method === 'eth_getBlockByNumber' ? { number: historical.blockNumber, hash: FINAL_BLOCK } : undefined);
  await assert.rejects(reorg.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'CONTEXT_CHANGED' });
});

test('only a canonical block containing the exact receipt hash supplies sibling inclusion evidence', async () => {
  for (const transactions of [undefined, [], [HASH], [BLOCK, FINAL_BLOCK, HASH], [BLOCK, FINAL_BLOCK, BLOCK]]) {
    const f = fixture(call => call.method === 'eth_getBlockByNumber'
      ? { number: '0x50', hash: BLOCK, timestamp: '0x6553f100', transactions } : undefined);
    const observed = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
    assert.equal(observed?.status, 'confirmed', 'its own canonical receipt remains displayable');
    assert.equal(observed?.transactionIndex, transactions?.[2] === HASH ? 2 : undefined);
    assert.equal(f.calls.filter(call => call.method === 'eth_getBlockByNumber').length, 1);
  }
});

test('ERC20 receipt identity retains identical transfers at different indices and deduplicates a repeated log', async () => {
  const events = [log(), log({ logIndex: '0x4' }), log()];
  const f = fixture((call) => call.method === 'eth_getTransactionByHash' ? tx({ from: OTHER, to: TOKEN, value: '0x0' }) :
    call.method === 'eth_getTransactionReceipt' ? receipt({ from: OTHER, to: TOKEN, logs: events }) : undefined);
  const result = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
  assert.equal(result?.events.length, 2);
  assert.deepEqual(result?.events.map((event) => [event.id, event.amountUnits]), [[`${HASH}:3`, '43981'], [`${HASH}:4`, '43981']]);
});

test('zero-value events stay exact, self transfers occur once and unrelated/ERC721 logs are not ERC20 events', async () => {
  const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ logs: [
    log({ topics: [TRANSFER, topic(OWNER), topic(OWNER)], data: `0x${'0'.repeat(64)}` }),
    log({ logIndex: '0x4', topics: [TRANSFER, topic(OTHER), topic(TOKEN)] }),
    log({ logIndex: '0x5', topics: [TRANSFER, topic(OTHER), topic(OWNER), `0x${'0'.repeat(64)}`], data: '0x' }),
  ] }) : undefined);
  const result = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
  assert.equal(result?.events.length, 1);
  assert.equal(result?.events[0]?.amountUnits, '0');
  assert.equal(result?.events[0]?.from, result?.events[0]?.to);
});

test('conflicting log identities, malformed event encoding and excess logs reject the observation', async () => {
  for (const logs of [
    [log(), log({ data: `0x${'0'.repeat(64)}` })],
    [log({ topics: [TRANSFER, `0x1${'0'.repeat(63)}`, topic(OWNER)] })],
    [log({ data: '0x01' })],
    Array.from({ length: 513 }, (_, index) => log({ logIndex: `0x${index.toString(16)}`, topics: [], data: '0x' })),
  ]) {
    const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ logs }) : undefined);
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
  }
});

test('reverted receipts cannot carry token logs and candidates must involve the selected owner', async () => {
  const reverted = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ status: '0x0', logs: [log()] }) : undefined);
  await assert.rejects(reverted.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
  const unrelated = fixture((call) => call.method === 'eth_getTransactionByHash' ? tx({ from: OTHER, to: TOKEN }) :
    call.method === 'eth_getTransactionReceipt' ? receipt({ from: OTHER, to: TOKEN }) : undefined);
  await assert.rejects(unrelated.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'IRRELEVANT' });
});

test('missing data stays absent, pending or unknown without fabricated receipt details', async () => {
  const absent = fixture((call) => ['eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(call.method) ? null : undefined);
  assert.equal(await absent.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), null);
  for (const mined of [false, true]) {
    const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? null :
      call.method === 'eth_getTransactionByHash' && !mined ? tx({ blockHash: null, blockNumber: null, transactionIndex: null }) : undefined);
    const result = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
    assert.equal(result?.status, mined ? 'unknown' : 'pending');
    assert.equal(result?.block, null); assert.equal(result?.timestamp, null); assert.equal(result?.feeUnits, null);
  }
});

test('receipt arriving after a pending body rereads the transaction and contract creation accepts null to', async () => {
  let reads = 0;
  const f = fixture((call) => call.method === 'eth_getTransactionByHash' ? tx({ to: null, ...(++reads === 1 ? { blockHash: null, blockNumber: null, transactionIndex: null } : {}) }) :
    call.method === 'eth_getTransactionReceipt' ? receipt({ to: null }) : undefined);
  assert.equal((await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')))?.to, null);
  assert.equal(reads, 2);
});

test('wrong chain, mismatched receipts, canonical reorgs and removed logs never succeed', async () => {
  const overrides: ((call: Call) => unknown)[] = [
    (call) => call.method === 'eth_chainId' ? '0x2' : undefined,
    (call) => call.method === 'eth_getTransactionReceipt' ? receipt({ to: TOKEN }) : undefined,
    (call) => call.method === 'eth_getBlockByNumber' && call.params[0] === '0x50' ? { number: '0x50', hash: HASH } : undefined,
    (call) => call.method === 'eth_getTransactionReceipt' ? receipt({ logs: [log({ removed: true })] }) : undefined,
  ];
  for (const override of overrides) {
    const f = fixture(override);
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'CONTEXT_CHANGED' });
  }
  let receipts = 0;
  const changed = fixture((call) => call.method === 'eth_getTransactionReceipt' && ++receipts === 2 ? receipt({ status: '0x0' }) : undefined);
  assert.equal((await changed.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')))?.status, 'confirmed');
  assert.equal((await changed.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')))?.status, 'reverted');
});

test('malformed RPC envelopes, quantities, content types and oversized receipt bodies fail closed', async () => {
  for (const override of [
    (call: Call) => call.method === 'eth_chainId' ? new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x1' })) : undefined,
    (call: Call) => call.method === 'eth_chainId' ? new Response('{bad', { headers: { 'content-type': 'application/json' } }) : undefined,
    (call: Call) => call.method === 'eth_chainId' ? new Response('{}', { headers: { 'content-type': 'text/html' } }) : undefined,
    (call: Call) => call.method === 'eth_getTransactionByHash' ? tx({ value: '0x01' }) : undefined,
  ]) {
    const f = fixture(override);
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
  }
  const huge = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ padding: 'x'.repeat(256 * 1024) }) : undefined);
  await assert.rejects(huge.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'UNAVAILABLE' });
});

test('derived fees stay within the shared display amount domain', async () => {
  const maximum = `0x${'f'.repeat(64)}`;
  for (const effectiveGasPrice of ['0x2', maximum]) {
    const overflow = fixture((call) => call.method === 'eth_getTransactionReceipt'
      ? receipt({ gasUsed: maximum, effectiveGasPrice }) : undefined);
    await assert.rejects(overflow.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
  }
  for (const gasUsed of ['0x0', '0x1']) {
    const bounded = fixture((call) => call.method === 'eth_getTransactionReceipt'
      ? receipt({ gasUsed, effectiveGasPrice: maximum }) : undefined);
    const result = await bounded.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
    assert.equal(result?.feeUnits, (BigInt(gasUsed) * BigInt(maximum)).toString());
    assert.doesNotThrow(() => formatBaseUnits(result!.feeUnits!, 18));
  }
});

test('guards revoke reads before address disclosure and after an A-B-A change; asynchronous guards reject', async () => {
  const before = fixture();
  await assert.rejects(before.reader.read(HASH, OWNER, signal(), () => { throw Error('locked'); }, getNativeNetwork('ethereum')), { code: 'CANCELLED' });
  assert.equal(before.calls.length, 0);
  const asyncGuard = fixture();
  await assert.rejects(asyncGuard.reader.read(HASH, OWNER, signal(), (async () => undefined) as () => void, getNativeNetwork('ethereum')), { code: 'CANCELLED' });
  assert.equal(asyncGuard.calls.length, 0);
  let revision = 0;
  const after = fixture((call) => { if (call.method === 'eth_getTransactionReceipt') revision += 2; });
  await assert.rejects(after.reader.read(HASH, OWNER, signal(), () => { if (revision !== 0) throw Error('changed'); }, getNativeNetwork('ethereum')), { code: 'CANCELLED' });
});

test('external cancellation and a bounded deadline reject a fetch that never settles', async () => {
  const abort = new AbortController();
  const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? new Promise(() => undefined) : undefined);
  const pending = f.reader.read(HASH, OWNER, abort.signal, () => undefined, getNativeNetwork('ethereum'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  const timed = new ActivityReceiptReader({ timeoutMs: 5, fetch: async () => new Promise(() => undefined) });
  await assert.rejects(timed.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'CANCELLED' });
});

test('an overlapping retained observation and details share the exact receipt graph', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, timestamp: '0x6553f100', gasLimit: '0x1c9c380' };
    return undefined;
  });
  const expected = { chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' };
  const automatic = f.reader.observe(expected, signal(), () => undefined, getNativeNetwork('ethereum'), 'wallet/account/generation');
  await started.promise;
  const detail = f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'wallet/account/generation');
  held.resolve();
  const [observed, details] = await Promise.all([automatic, detail]);
  assert.equal(observed.status, 'mined'); assert.equal(details?.status, 'confirmed');
  assert.deepEqual(f.calls.map(call => call.method), ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_chainId']);
  await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'wallet/account/generation');
  assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 2, 'a completed observation cannot authorize a new detail read');
});

for (const cancel of ['automatic', 'detail'] as const)
test(`receipt sharing keeps the other subscriber when ${cancel} cancels`, async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, timestamp: '0x6553f100', gasLimit: '0x1c9c380' };
    return undefined;
  });
  const a = new AbortController(), b = new AbortController();
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, a.signal, () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  const detail = f.reader.read(HASH, OWNER, b.signal, () => undefined, getNativeNetwork('ethereum'), 'scope');
  const rejected = assert.rejects(cancel === 'automatic' ? automatic : detail, { code: 'CANCELLED' });
  (cancel === 'automatic' ? a : b).abort(); await rejected;
  assert.equal(f.calls.find(call => call.method === 'eth_getTransactionReceipt')!.signal.aborted, false);
  held.resolve(); await (cancel === 'automatic' ? detail : automatic);
  assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 1);
});

test('shared observations reject altered retained identity and keep unrelated owners separate', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const expected = { chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' };
  const automatic = f.reader.observe(expected, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  await assert.rejects(f.reader.observe({ ...expected, nonce: '2' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  await assert.rejects(f.reader.observe({ ...expected, to: TOKEN }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  const unrelated = f.reader.read(HASH, TOKEN, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  const rejected = assert.rejects(unrelated, { code: 'IRRELEVANT' });
  held.resolve(); await Promise.all([automatic, rejected]);
  assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 2);
});

test('an unavailable detail body does not discard a healthy automatic receipt', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getTransactionByHash') throw Error('offline');
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  const failed = assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'UNAVAILABLE' });
  held.resolve();
  assert.equal((await automatic).status, 'mined'); await failed;
  assert.equal(f.calls.length, 5);
});

test('cancelled detail consumers neither start nor retain extra body work', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const bodyStarted = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getTransactionByHash') { bodyStarted.resolve(); return new Promise(() => undefined); }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.reader.read(HASH, OWNER, cancelled.signal, () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CANCELLED' });
  assert.equal(f.calls.some(call => call.method === 'eth_getTransactionByHash'), false);
  const detail = new AbortController();
  const rejected = assert.rejects(f.reader.read(HASH, OWNER, detail.signal, () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CANCELLED' });
  await bodyStarted.promise;
  detail.abort(); await rejected;
  const body = f.calls.find(call => call.method === 'eth_getTransactionByHash')!;
  assert.equal(body.signal.aborted, true);
  assert.equal(f.calls.find(call => call.method === 'eth_getTransactionReceipt')!.signal.aborted, false);
  held.resolve(); assert.equal((await automatic).status, 'mined');
});

test('shared final identity failure rejects all live consumers', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let chains = 0;
  const f = fixture(async call => {
    if (call.method === 'eth_chainId') return ++chains === 1 ? '0x1' : '0x2';
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = assert.rejects(f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  await started.promise;
  const detail = assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  held.resolve(); await Promise.all([automatic, detail]);
  assert.equal(f.calls.length, 5);
});

test('replacement work starts fresh after all shared subscribers cancel', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let receiptReads = 0;
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt' && ++receiptReads === 1) { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const expected = { chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' };
  const cancelled = new AbortController();
  const first = f.reader.observe(expected, cancelled.signal, () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  const rejected = assert.rejects(first, { code: 'CANCELLED' });
  cancelled.abort();
  const second = f.reader.observe(expected, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await rejected;
  assert.equal((await second).status, 'mined');
  assert.equal(receiptReads, 2);
  assert.equal(f.calls.find(call => call.method === 'eth_getTransactionReceipt')!.signal.aborted, true);
  held.resolve();
});

test('rejected observer owners disclose no addresses and create no pending work', async () => {
  const f = fixture(), expected = { chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' };
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.reader.observe(expected, cancelled.signal, () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CANCELLED' });
  assert.throws(() => f.reader.observe(expected, signal(), () => { throw Error('retired'); }, getNativeNetwork('ethereum'), 'scope'), { code: 'CANCELLED' });
  assert.equal(f.calls.length, 0);
});

test('shared details refresh a pending body when the concurrent receipt becomes mined', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let bodies = 0;
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionReceipt') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getTransactionByHash' && ++bodies === 1)
      return tx({ blockHash: null, blockNumber: null, transactionIndex: null });
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  const detail = f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  held.resolve();
  const [observed, full] = await Promise.all([automatic, detail]);
  assert.equal(observed.status, 'mined'); assert.equal(full?.status, 'confirmed');
  assert.equal(bodies, 2);
  assert.equal(f.calls.length, 8);
  assert.equal(f.calls.filter(call => call.method === 'eth_getBlockByNumber').length, 2);
  assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
});

for (const join of ['immediate', 'held-chain'] as const)
test(`shared details wait for accepted initial identity (${join})`, async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_chainId') { started.resolve(); await held.promise; return '0x2'; }
  });
  const automatic = assert.rejects(f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  if (join === 'held-chain') await started.promise;
  const detail = assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  const pendingMethods = f.calls.map(call => call.method);
  held.resolve();
  await Promise.all([automatic, detail]);
  assert.deepEqual(pendingMethods, ['eth_chainId'], 'no hash or account request precedes accepted identity');
  assert.deepEqual(f.calls.map(call => call.method), ['eth_chainId']);
});

test('an immediate detail subscriber starts its five-call graph after identity succeeds', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let identities = 0;
  const f = fixture(async call => {
    if (call.method === 'eth_chainId' && ++identities === 1) { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  const detail = f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  assert.deepEqual(f.calls.map(call => call.method), ['eth_chainId']);
  held.resolve();
  const [observed, full] = await Promise.all([automatic, detail]);
  assert.equal(observed.status, 'mined');
  assert.equal(full?.status, 'confirmed');
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
});

test('a held optional body does not delay the canonical automatic receipt', async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionByHash') { started.resolve(); await held.promise; }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  const detail = f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  const timeout = Symbol('timeout');
  const observed = await Promise.race([automatic, new Promise(resolve => setTimeout(() => resolve(timeout), 30))]);
  held.resolve();
  await detail;
  assert.notEqual(observed, timeout, 'automatic receipt must complete before optional body release');
  assert.equal((observed as { status: string }).status, 'mined');
  assert.equal(f.calls.filter(call => call.method === 'eth_getBlockByNumber').length, 2);
  assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
});


test('optional body timeout affects only details after automatic receipt completion', async () => {
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionByHash') return new Promise(() => undefined);
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  }, 40);
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  const detail = assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CANCELLED' });
  assert.equal((await automatic).status, 'mined');
  await detail;
  assert.equal(f.calls.find(call => call.method === 'eth_getTransactionByHash')!.signal.aborted, true);
});

for (const failure of ['canonical', 'identity'] as const)
test(`delayed details revalidate ${failure} after automatic receipt completion`, async () => {
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  let blocks = 0, identities = 0;
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionByHash') { started.resolve(); await held.promise; }
    if (call.method === 'eth_chainId') return ++identities === 3 && failure === 'identity' ? '0x2' : '0x1';
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: ++blocks === 2 && failure === 'canonical' ? FINAL_BLOCK : BLOCK, gasLimit: '0x1c9c380' };
  });
  const automatic = f.reader.observe({ chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  const detail = assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'), { code: 'CONTEXT_CHANGED' });
  await started.promise;
  assert.equal((await automatic).status, 'mined');
  held.resolve();
  await detail;
  assert.equal(blocks, 2);
});

test('last detail cancellation after automatic completion releases its owned body and permits fresh reads', async () => {
  const started = Promise.withResolvers<void>();
  let bodies = 0;
  const f = fixture(async call => {
    if (call.method === 'eth_getTransactionByHash' && ++bodies === 1) {
      started.resolve();
      return new Promise(() => undefined);
    }
    if (call.method === 'eth_getBlockByNumber') return { number: '0x50', hash: BLOCK, gasLimit: '0x1c9c380' };
  });
  const expected = { chainId: '1', from: OWNER, to: OTHER, hash: HASH, nonce: '1' };
  const automatic = f.reader.observe(expected, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope');
  const cancelled = new AbortController();
  const detail = f.reader.read(HASH, OWNER, cancelled.signal, () => undefined, getNativeNetwork('ethereum'), 'scope');
  await started.promise;
  assert.equal((await automatic).status, 'mined');
  const rejected = assert.rejects(detail, { code: 'CANCELLED' });
  cancelled.abort();
  await rejected;
  assert.equal(f.calls.find(call => call.method === 'eth_getTransactionByHash')!.signal.aborted, true);
  assert.equal((await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'), 'scope'))?.status, 'confirmed');
  assert.equal(bodies, 2);
  assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 2);
});

test('Base details and retained observations include verified L1 fee without extra reads', async () => {
  const network = getNativeNetwork('base');
  for (const [fields, total] of [
    [{ l1Fee: '0x186a0' }, '310000'],
    [{ l1Fee: '0x0' }, '210000'],
    [{ l1Fee: 'invalid' }, null],
    [{ l1Fee: '0x186a0', operatorFeeScalar: '0x1' }, null],
  ] as const) {
    const f = fixture(call => call.method === 'eth_getTransactionReceipt' ? receipt(fields) : undefined, undefined, network);
    const detail = await f.reader.read(HASH, OWNER, signal(), () => {}, network);
    assert.equal(detail?.status, 'confirmed');
    assert.equal(detail?.feeUnits, total);
    const observed = await f.reader.observe({ chainId: network.chainId, from: OWNER, to: OTHER, hash: HASH, nonce: '1' }, signal(), () => {}, network, 'owner');
    assert.equal(observed.status, 'mined');
    if (observed.status === 'mined') assert.equal(observed.feeUnits, total ?? undefined);
  }
});

test('actual receipt details include blob charges on success and revert with the ordinary five-method graph', async () => {
  for (const [status, gasUsed, expectedFee] of [
    ['0x1', '0x5208', '152072000000000'],
    ['0x0', '0xc350', '181072000000000'],
  ] as const) {
    const f = fixture(call => call.method === 'eth_getTransactionReceipt'
      ? receipt({ type: '0x3', status, gasUsed, effectiveGasPrice: '0x3b9aca00', blobGasUsed: '0x20000', blobGasPrice: '0x3b9aca00' }) : undefined);
    const detail = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
    assert.equal(detail?.status, status === '0x1' ? 'confirmed' : 'reverted');
    assert.equal(detail?.feeUnits, expectedFee);
    assert.equal(formatBaseUnits(detail!.feeUnits!, 18), status === '0x1' ? '0.000152072' : '0.000181072');
    assert.deepEqual(f.calls.map(call => call.method), ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_chainId']);
  }
  for (const [id, fields, expectedFee] of [
    ['ethereum', {}, '21000000000000'],
    ['base', { l1Fee: '0x5af3107a4000' }, '121000000000000'],
  ] as const) {
    const network = getNativeNetwork(id);
    const f = fixture(call => call.method === 'eth_getTransactionReceipt'
      ? receipt({ type: '0x2', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', ...fields }) : undefined, undefined, network);
    const detail = await f.reader.read(HASH, OWNER, signal(), () => undefined, network);
    assert.equal(detail?.status, 'confirmed');
    assert.equal(detail?.feeUnits, expectedFee);
    assert.equal(f.calls.length, 5);
  }
});

test('blob receipts with incomplete or malformed fee components retain outcomes with an unavailable total', async () => {
  for (const fields of [
    { blobGasUsed: undefined }, { blobGasPrice: undefined },
    { blobGasUsed: undefined, blobGasPrice: undefined },
    { blobGasUsed: '0x0' }, { blobGasPrice: '0x0' },
    { blobGasUsed: '0x1' }, { blobGasUsed: '0x020000' },
    { blobGasPrice: null }, { blobGasUsed: 131072 },
    { blobGasPrice: '0x1' + '0'.repeat(64) },
  ]) {
    const f = fixture(call => call.method === 'eth_getTransactionReceipt'
      ? receipt({ type: '0x3', blobGasUsed: '0x20000', blobGasPrice: '0x3b9aca00', ...fields }) : undefined);
    const detail = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
    assert.equal(detail?.status, 'confirmed');
    assert.equal(detail?.feeUnits, null);
    assert.equal(f.calls.length, 5);
  }
});

test('overflowing blob charges cannot produce a partial or truncated Activity fee', async () => {
  const maximum = '0x' + 'f'.repeat(64);
  const fees = { type: '0x3', blobGasUsed: '0x20000', blobGasPrice: '0x3b9aca00' };
  for (const fields of [
    { blobGasPrice: maximum },
    { gasUsed: '0x1', effectiveGasPrice: maximum, blobGasPrice: '0x1' },
  ]) {
    const f = fixture(call => call.method === 'eth_getTransactionReceipt'
      ? receipt({ ...fees, ...fields }) : undefined);
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum')), { code: 'INVALID_RESPONSE' });
    assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 1);
    assert.equal(f.calls.some(call => call.method === 'eth_getBlockByNumber'), false);
  }
});

test('retired Activity reads keep physical slots until an ignored abort drains', async () => {
  const held = Promise.withResolvers<void>(), fourStarted = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    if (calls === 4) fourStarted.resolve();
    if (calls <= 4) await held.promise;
  });
  const registration = getNativeNetwork('ethereum');
  const old = Array.from({ length: 4 }, () => new AbortController());
  const retired = old.map(owner => assert.rejects(
    f.reader.read(HASH, OWNER, owner.signal, () => {}, registration), { code: 'CANCELLED' }
  ));
  await fourStarted.promise;
  old.forEach(owner => owner.abort());
  await Promise.all(retired);
  const next = f.reader.read(HASH, OWNER, signal(), () => {}, registration);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 4);
  } finally { held.resolve(); }
  assert.equal((await next)?.status, 'confirmed');
});

test('privacy pool detail retains the observed transfer value and fee', async () => {
  const pool = '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936';
  const f = fixture(call => call.method === 'eth_getTransactionByHash'
    ? tx({ to: pool, value: '0x0', input: '0x21a0adb6' + '0'.repeat(64) })
    : call.method === 'eth_getTransactionReceipt' ? receipt({ to: pool }) : undefined);
  const result = await f.reader.read(HASH, OWNER, signal(), () => undefined, getNativeNetwork('ethereum'));
  assert.deepEqual(result?.privacyActivity, { kind: 'withdrawal', amount: '1' });
  assert.equal(result?.valueUnits, '0');
  assert.equal(result?.feeUnits, '210000');
  assert.equal(Object.hasOwn(result!, 'input'), false);
});
