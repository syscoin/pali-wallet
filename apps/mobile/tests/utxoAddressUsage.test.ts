import assert from 'node:assert/strict';
import test from 'node:test';
import { createUtxoAddressUsageReader } from '../src/core/utxoAddressUsage.ts';
import { createUtxoBalanceReader, UtxoBalanceError } from '../src/core/utxoBalanceReader.ts';
import { Bip84Discovery } from '../src/core/bip84Discovery.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { bech32 } from 'bech32';
const network = getUtxoNetwork('bitcoin'), address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', anchor = 'a'.repeat(64);
const status = () => ({ blockbook: { coin: 'Bitcoin', network: 'BTC', decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'main' } });
const summary = () => ({ address, balance: '0', unconfirmedBalance: '0', txs: 0, unconfirmedTxs: 0 });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const coded = (code: string) => (error: unknown) => { assert.ok(error instanceof UtxoBalanceError); assert.equal(error.code, code); return true; };
function fixture(replace?: (url: string, n: number) => Response | undefined) {
  const calls: { url: string; init: RequestInit }[] = [];
  return { calls, async fetch(url: string, init: RequestInit) {
    calls.push({ url, init });
    return replace?.(url, calls.length) ?? json(url.endsWith('/api/') ? status() : url.endsWith('/0') ? { blockHash: network.genesisHash } : url.includes('/block-index/') ? { blockHash: anchor } : summary());
  } };
}
test('usage checks identity/genesis/anchor before disclosure and repeats anchor after reads', async () => {
  const f = fixture(), s = await createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal);
  assert.equal(f.calls.length, 3); assert.equal(f.calls.some(({ url }) => url.includes('/address/')), false);
  assert.deepEqual(await s.readAddress(address.toUpperCase()), { address, confirmedUnits: '0', pendingDeltaUnits: '0', historicalTransactions: 0, unconfirmedTransactions: 0, used: false });
  assert.equal(await s.verifyAnchor(), 200); s.close();
  assert.deepEqual(f.calls.map(({ url }) => url.slice(network.endpoint.length)), ['/api/', '/api/v2/block-index/0', '/api/v2/block-index/200', `/api/v2/address/${address}?details=tokens`, '/api/v2/block-index/200', '/api/']);
  assert.ok(f.calls.every(({ init }) => init.signal?.aborted && init.redirect === 'error' && init.credentials === 'omit'));
});
test('historical, pending and nonzero balance all count as use, with signed pending separate', async () => {
  for (const changed of [{ txs: 3 }, { unconfirmedTxs: 1 }, { balance: '9007199254740993' }, { unconfirmedBalance: '-5' }]) {
    const f = fixture((url) => url.includes('/address/') ? json({ ...summary(), ...changed, tokens: ['ignored'] }) : undefined);
    const s = await createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal);
    const result = await s.readAddress(address); assert.equal(result.used, true); assert.equal('tokens' in result, false); s.close();
  }
});
test('identity, genesis and anchor failures never disclose addresses', async () => {
  for (const [n, value] of [[1, { ...status(), backend: { chain: 'test' } }], [2, { blockHash: 'f'.repeat(64) }], [3, { blockHash: 'BAD' }]] as const) {
    const f = fixture((_url, call) => call === n ? json(value) : undefined);
    await assert.rejects(createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal), UtxoBalanceError);
    assert.equal(f.calls.some(({ url }) => url.includes('/address/')), false); assert.ok(f.calls.every(({ init }) => init.signal?.aborted));
  }
});
test('repeat anchor mismatch, head regression or unsynced mempool invalidate observations', async () => {
  for (const change of ['anchor', 'height', 'sync']) {
    const f = fixture((url, n) => n === 4 && change === 'anchor' ? json({ blockHash: 'b'.repeat(64) }) : n === 5 && url.endsWith('/api/') ? json({ ...status(), blockbook: { ...status().blockbook, ...(change === 'height' ? { bestHeight: 199 } : change === 'sync' ? { inSyncMempool: false } : {}) } }) : undefined);
    const s = await createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal);
    await assert.rejects(s.verifyAnchor(), UtxoBalanceError); s.close();
  }
});
test('missing or malformed usage fields fail instead of appearing unused', async () => {
  for (const field of ['txs', 'unconfirmedTxs', 'balance', 'unconfirmedBalance']) for (const value of [undefined, null, -1, '01']) {
    const f = fixture((url) => url.includes('/address/') ? json({ ...summary(), [field]: value }) : undefined);
    const s = await createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal);
    await assert.rejects(s.readAddress(address), coded('INVALID_RESPONSE')); assert.ok(f.calls.every(({ init }) => init.signal?.aborted));
  }
});
test('32 KiB body and 512 KiB aggregate consumed limits are exact including ignored padding', async () => {
  let nextSize = 32768;
  const f = fixture((url) => { if (!url.includes('/address/')) return undefined; const raw = { ...summary(), padding: '' }; raw.padding = 'x'.repeat(nextSize - JSON.stringify(raw).length); return json(raw); });
  const s = await createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal), openingBytes = s.consumedBytes();
  for (let i = 0; i < 15; i++) await s.readAddress(address);
  nextSize = 512 * 1024 - openingBytes - 15 * 32768;
  await s.readAddress(address); assert.equal(s.consumedBytes(), 512 * 1024); nextSize = 256;
  await assert.rejects(s.readAddress(address), coded('RESPONSE_TOO_LARGE')); assert.ok(f.calls.every(({ init }) => init.signal?.aborted));
  const tooLarge = fixture((url) => url.includes('/address/') ? new Response('x'.repeat(32769), { headers: { 'content-type': 'application/json' } }) : undefined);
  const other = await createUtxoAddressUsageReader(tooLarge).open('bitcoin', new AbortController().signal);
  await assert.rejects(other.readAddress(address), coded('RESPONSE_TOO_LARGE'));
});
test('aggregate budget is shared by simultaneous reads and overflow cancels both readers', async () => {
  let nextSize = 32768, cancelled = 0;
  const f = fixture((url) => {
    if (!url.includes('/address/')) return undefined;
    const raw = { ...summary(), padding: '' }; raw.padding = 'x'.repeat(nextSize - JSON.stringify(raw).length);
    const encoded = new TextEncoder().encode(JSON.stringify(raw)); let sent = false;
    return { ok: true, redirected: false, url, headers: new Headers(), body: { getReader: () => ({ async read() { if (sent) return { done: true }; sent = true; return { done: false, value: encoded }; }, async cancel() { cancelled++; } }) } } as unknown as Response;
  });
  const s = await createUtxoAddressUsageReader(f).open('bitcoin', new AbortController().signal);
  for (let i = 0; i < 15; i++) await s.readAddress(address);
  nextSize = 20000;
  const results = await Promise.allSettled([s.readAddress(address), s.readAddress(address)]);
  assert.ok(results.some((r) => r.status === 'rejected' && r.reason instanceof UtxoBalanceError && r.reason.code === 'RESPONSE_TOO_LARGE'));
  assert.ok(s.consumedBytes() <= 512 * 1024); assert.equal(cancelled, 17); assert.ok(f.calls.every(({ init }) => init.signal?.aborted));
});
test('timeout cancels unresponsive transport and discards its late response', async () => {
  let finish!: (r: Response) => void, canceled = 0;
  const reader = createUtxoAddressUsageReader({ timeoutMs: 5, fetch: () => new Promise((r) => { finish = r; }) });
  await assert.rejects(reader.open('bitcoin', new AbortController().signal), coded('CANCELLED'));
  finish({ body: { async cancel() { canceled++; } } } as Response);
  await new Promise((r) => setImmediate(r)); assert.equal(canceled, 1);
});
test('fetch port is mandatory and unsupported family never sends a request', async () => {
  for (const options of [undefined, {}, { fetch: 1 }]) assert.throws(() => createUtxoAddressUsageReader(options as never), /explicit UTXO fetch port/);
  let calls = 0;
  await assert.rejects(createUtxoAddressUsageReader({ fetch: async () => { calls++; return json({}); } }).open('ethereum' as never, new AbortController().signal), coded('INVALID_INPUT'));
  assert.equal(calls, 0);
});
test('real scanner composes with reader and disclosed addresses only follow chain checks', async () => {
  const calls: string[] = [];
  const reader = createUtxoAddressUsageReader({ async fetch(url) {
    calls.push(url);
    if (url.includes('/address/')) return json({ ...summary(), address: decodeURIComponent(url.split('/address/')[1]!.split('?')[0]!) });
    return json(url.endsWith('/api/') ? status() : { blockHash: url.endsWith('/0') ? network.genesisHash : anchor });
  } });
  const d = new Bip84Discovery({ scope: { networkId: 'bitcoin', sourceId: 'integration' }, reader, assertCurrent() {}, derive({ branch, index }) {
    const bytes = new Uint8Array(20); bytes[0] = branch; bytes[1] = index;
    return { branch, index, address: bech32.encode('bc', [0, ...bech32.toWords(bytes)]) };
  } });
  const result = await d.scan(); assert.equal(result.status, 'gap-reached'); assert.equal(calls.length, 45); assert.equal(calls.findIndex((url) => url.includes('/address/')), 3);
  assert.equal(result.observedAddresses, 40); assert.equal(result.totals?.confirmedUnits, '0');
});
test('existing balance reader keeps its unsampled three-request API', async () => {
  const f = fixture(); const result = await createUtxoBalanceReader(f).readBalance('bitcoin', address, new AbortController().signal);
  assert.equal(result.kind, 'utxo'); assert.equal(f.calls.length, 3); assert.equal(result.observedHeight, 200);
});
