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
function fixture(override?: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const reader = new ActivityReceiptReader({ fetch: async (url, init) => {
    assert.equal(url, getNativeNetwork('ethereum').rpcUrl);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const input = JSON.parse(String(init.body));
    const call = { method: input.method, params: input.params, signal: init.signal } as Call;
    calls.push(call);
    assert(['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber'].includes(call.method));
    let result = override ? await override(call) : undefined;
    if (result instanceof Response) return result;
    if (result === undefined) {
      if (call.method === 'eth_chainId') result = '0x1';
      else if (call.method === 'eth_getTransactionByHash') result = tx();
      else if (call.method === 'eth_getTransactionReceipt') result = receipt();
      else if (call.method === 'eth_getBlockByNumber') result = call.params[0] === 'finalized' || call.params[0] === '0x60'
        ? { number: '0x60', hash: FINAL_BLOCK, timestamp: '0x6553f164' }
        : { number: call.params[0], hash: BLOCK, timestamp: '0x6553f100' };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  return { reader, calls };
}

test('Activity returns exact direct ETH observations, canonical timestamp and finality using only registered read methods', async () => {
  const f = fixture();
  const result = await f.reader.read(HASH.toUpperCase().replace('0X', '0x'), OWNER, signal(), () => undefined);
  assert.deepEqual(result, { hash: HASH, from: OWNER, to: OTHER, valueUnits: '100', nonce: '1',
    block: { hash: BLOCK, number: '80' }, timestamp: 1700000000000, status: 'finalized', events: [], feeUnits: '210000' });
  assert.equal(f.calls[0]?.method, 'eth_chainId');
  assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
  assert.equal(f.calls.filter((call) => call.method === 'eth_getTransactionReceipt').length, 2);
});

test('canonical included and reverted receipts remain distinct from finalized outcomes', async () => {
  for (const [final, status, expected] of [['0x40', '0x1', 'included'], ['0x40', '0x0', 'reverted'], ['0x60', '0x0', 'finalized-reverted']] as const) {
    const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ status }) :
      call.method === 'eth_getBlockByNumber' && (call.params[0] === 'finalized' || call.params[0] === final)
        ? { number: final, hash: FINAL_BLOCK } : undefined);
    assert.equal((await f.reader.read(HASH, OWNER, signal(), () => undefined))?.status, expected);
  }
});

test('ERC20 receipt identity retains identical transfers at different indices and deduplicates a repeated log', async () => {
  const events = [log(), log({ logIndex: '0x4' }), log()];
  const f = fixture((call) => call.method === 'eth_getTransactionByHash' ? tx({ from: OTHER, to: TOKEN, value: '0x0' }) :
    call.method === 'eth_getTransactionReceipt' ? receipt({ from: OTHER, to: TOKEN, logs: events }) : undefined);
  const result = await f.reader.read(HASH, OWNER, signal(), () => undefined);
  assert.equal(result?.events.length, 2);
  assert.deepEqual(result?.events.map((event) => [event.id, event.amountUnits]), [[`${HASH}:3`, '43981'], [`${HASH}:4`, '43981']]);
});

test('zero-value events stay exact, self transfers occur once and unrelated/ERC721 logs are not ERC20 events', async () => {
  const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ logs: [
    log({ topics: [TRANSFER, topic(OWNER), topic(OWNER)], data: `0x${'0'.repeat(64)}` }),
    log({ logIndex: '0x4', topics: [TRANSFER, topic(OTHER), topic(TOKEN)] }),
    log({ logIndex: '0x5', topics: [TRANSFER, topic(OTHER), topic(OWNER), `0x${'0'.repeat(64)}`], data: '0x' }),
  ] }) : undefined);
  const result = await f.reader.read(HASH, OWNER, signal(), () => undefined);
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
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'INVALID_RESPONSE' });
  }
});

test('reverted receipts cannot carry token logs and candidates must involve the selected owner', async () => {
  const reverted = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ status: '0x0', logs: [log()] }) : undefined);
  await assert.rejects(reverted.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'INVALID_RESPONSE' });
  const unrelated = fixture((call) => call.method === 'eth_getTransactionByHash' ? tx({ from: OTHER, to: TOKEN }) :
    call.method === 'eth_getTransactionReceipt' ? receipt({ from: OTHER, to: TOKEN }) : undefined);
  await assert.rejects(unrelated.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'IRRELEVANT' });
});

test('missing data stays absent, pending or unknown without fabricated receipt details', async () => {
  const absent = fixture((call) => ['eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(call.method) ? null : undefined);
  assert.equal(await absent.reader.read(HASH, OWNER, signal(), () => undefined), null);
  for (const mined of [false, true]) {
    const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? null :
      call.method === 'eth_getTransactionByHash' && !mined ? tx({ blockHash: null, blockNumber: null, transactionIndex: null }) : undefined);
    const result = await f.reader.read(HASH, OWNER, signal(), () => undefined);
    assert.equal(result?.status, mined ? 'unknown' : 'pending');
    assert.equal(result?.block, null); assert.equal(result?.timestamp, null); assert.equal(result?.feeUnits, null);
  }
});

test('receipt arriving after a pending body rereads the transaction and contract creation accepts null to', async () => {
  let reads = 0;
  const f = fixture((call) => call.method === 'eth_getTransactionByHash' ? tx({ to: null, ...(++reads === 1 ? { blockHash: null, blockNumber: null, transactionIndex: null } : {}) }) :
    call.method === 'eth_getTransactionReceipt' ? receipt({ to: null }) : undefined);
  assert.equal((await f.reader.read(HASH, OWNER, signal(), () => undefined))?.to, null);
  assert.equal(reads, 2);
});

test('wrong chain, mismatched receipts, canonical reorgs and changed finalized observations never succeed', async () => {
  const overrides: ((call: Call) => unknown)[] = [
    (call) => call.method === 'eth_chainId' ? '0x2' : undefined,
    (call) => call.method === 'eth_getTransactionReceipt' ? receipt({ to: TOKEN }) : undefined,
    (call) => call.method === 'eth_getBlockByNumber' && call.params[0] === '0x50' ? { number: '0x50', hash: HASH } : undefined,
    (call) => call.method === 'eth_getBlockByNumber' && call.params[0] === '0x60' ? { number: '0x60', hash: HASH } : undefined,
    (call) => call.method === 'eth_getTransactionReceipt' ? receipt({ logs: [log({ removed: true })] }) : undefined,
  ];
  for (const override of overrides) {
    const f = fixture(override);
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'CONTEXT_CHANGED' });
  }
  let receipts = 0;
  const changed = fixture((call) => call.method === 'eth_getTransactionReceipt' && ++receipts === 2 ? receipt({ status: '0x0' }) : undefined);
  await assert.rejects(changed.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'CONTEXT_CHANGED' });
});

test('malformed RPC envelopes, quantities, content types and oversized receipt bodies fail closed', async () => {
  for (const override of [
    (call: Call) => call.method === 'eth_chainId' ? new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x1' })) : undefined,
    (call: Call) => call.method === 'eth_chainId' ? new Response('{bad', { headers: { 'content-type': 'application/json' } }) : undefined,
    (call: Call) => call.method === 'eth_chainId' ? new Response('{}', { headers: { 'content-type': 'text/html' } }) : undefined,
    (call: Call) => call.method === 'eth_getTransactionByHash' ? tx({ value: '0x01' }) : undefined,
  ]) {
    const f = fixture(override);
    await assert.rejects(f.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'INVALID_RESPONSE' });
  }
  const huge = fixture((call) => call.method === 'eth_getTransactionReceipt' ? receipt({ padding: 'x'.repeat(256 * 1024) }) : undefined);
  await assert.rejects(huge.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'UNAVAILABLE' });
});

test('derived fees stay within the shared display amount domain', async () => {
  const maximum = `0x${'f'.repeat(64)}`;
  for (const effectiveGasPrice of ['0x2', maximum]) {
    const overflow = fixture((call) => call.method === 'eth_getTransactionReceipt'
      ? receipt({ gasUsed: maximum, effectiveGasPrice }) : undefined);
    await assert.rejects(overflow.reader.read(HASH, OWNER, signal(), () => undefined), { code: 'INVALID_RESPONSE' });
  }
  for (const gasUsed of ['0x0', '0x1']) {
    const bounded = fixture((call) => call.method === 'eth_getTransactionReceipt'
      ? receipt({ gasUsed, effectiveGasPrice: maximum }) : undefined);
    const result = await bounded.reader.read(HASH, OWNER, signal(), () => undefined);
    assert.equal(result?.feeUnits, (BigInt(gasUsed) * BigInt(maximum)).toString());
    assert.doesNotThrow(() => formatBaseUnits(result!.feeUnits!, 18));
  }
});

test('guards revoke reads before address disclosure and after an A-B-A change; asynchronous guards reject', async () => {
  const before = fixture();
  await assert.rejects(before.reader.read(HASH, OWNER, signal(), () => { throw Error('locked'); }), { code: 'CANCELLED' });
  assert.equal(before.calls.length, 0);
  const asyncGuard = fixture();
  await assert.rejects(asyncGuard.reader.read(HASH, OWNER, signal(), (async () => undefined) as () => void), { code: 'CANCELLED' });
  assert.equal(asyncGuard.calls.length, 0);
  let revision = 0;
  const after = fixture((call) => { if (call.method === 'eth_getTransactionReceipt') revision += 2; });
  await assert.rejects(after.reader.read(HASH, OWNER, signal(), () => { if (revision !== 0) throw Error('changed'); }), { code: 'CANCELLED' });
});

test('external cancellation and a bounded deadline reject a fetch that never settles', async () => {
  const abort = new AbortController();
  const f = fixture((call) => call.method === 'eth_getTransactionReceipt' ? new Promise(() => undefined) : undefined);
  const pending = f.reader.read(HASH, OWNER, abort.signal, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  const timed = new ActivityReceiptReader({ timeoutMs: 5, fetch: async () => new Promise(() => undefined) });
  await assert.rejects(timed.read(HASH, OWNER, signal(), () => undefined), { code: 'CANCELLED' });
});
