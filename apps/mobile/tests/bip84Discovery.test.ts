import assert from 'node:assert/strict';
import test from 'node:test';
import { bech32 } from 'bech32';
import { Bip84Discovery, Bip84DiscoveryError, parseBip84DiscoveryCursor, type PublicBip84Deriver } from '../src/core/bip84Discovery.ts';
import type { UtxoAddressUsage, UtxoAddressUsageReader, UtxoAddressUsageSession } from '../src/core/utxoAddressUsage.ts';

const scope = { networkId: 'bitcoin', sourceId: 'public-fixture:0' } as const;
const hash = 'a'.repeat(64);
// Synthetic public witness programs exercise host orchestration, not SDK derivation.
const derive: PublicBip84Deriver = ({ branch, index }) => {
  const bytes = new Uint8Array(20); bytes[0] = branch; bytes[1] = index >> 8; bytes[2] = index & 255;
  return { branch, index, address: bech32.encode('bc', [0, ...bech32.toWords(bytes)]) };
};
const usage = (address: string, overrides: Partial<UtxoAddressUsage> = {}): UtxoAddressUsage =>
  ({ address, confirmedUnits: '0', pendingDeltaUnits: '0', historicalTransactions: 0, unconfirmedTransactions: 0, used: false, ...overrides });
function fixture(read: (address: string) => Promise<UtxoAddressUsage> = async (address) => usage(address)) {
  const calls: string[] = []; let closes = 0, opens = 0, active = 0, peak = 0;
  const reader: UtxoAddressUsageReader = { async open(_network, signal) {
    opens++;
    return { observedHeight: 12, anchorHash: hash, consumedBytes: () => 0,
      async readAddress(address) { calls.push(address); active++; peak = Math.max(peak, active); try { return await read(address); } finally { active--; } },
      async verifyAnchor() { assert.equal(signal.aborted, false); return 13; }, close() { closes++; } };
  } };
  return { calls, reader, get closes() { return closes; }, get opens() { return opens; }, get peak() { return peak; } };
}
const rejects = (code: string) => (error: unknown) => { assert.ok(error instanceof Bip84DiscoveryError); assert.equal(error.code, code); return true; };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

 test('two sequential branch workers stop at a gap of twenty and produce immutable advisory totals', async () => {
  const f = fixture(), requests: [number, number][] = [];
  const d = new Bip84Discovery({ scope, reader: f.reader, assertCurrent() {}, derive(request) { requests.push([request.branch, request.index]); return derive(request); } });
  const result = await d.scan();
  assert.equal(result.status, 'gap-reached'); assert.equal(result.observedAddresses, 40); assert.equal(f.closes, 1); assert.equal(f.peak, 2);
  assert.deepEqual(result.totals, { confirmedUnits: '0', pendingDeltaUnits: '0' });
  assert.deepEqual(result.cursor.branches, [{ nextIndex: 20, lastUsedIndex: -1 }, { nextIndex: 20, lastUsedIndex: -1 }]);
  for (const branch of [0, 1]) assert.deepEqual(requests.filter(([b]) => b === branch).map(([, index]) => index), Array.from({ length: 20 }, (_, i) => i));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.cursor.branches) && Object.isFrozen(result.totals));
  assert.deepEqual(result.anchor, { height: 12, hash, endHeight: 13 });
});

for (const kind of ['spent', 'pending', 'balance'] as const) test(`${kind} usage resets the gap even with zero confirmed balance`, async () => {
  const target = derive({ networkId: 'bitcoin', branch: 0, index: 19 }).address;
  const f = fixture(async (address) => usage(address, address !== target ? {} : kind === 'spent'
    ? { used: true, historicalTransactions: 1 } : kind === 'pending'
      ? { used: true, unconfirmedTransactions: 1, pendingDeltaUnits: '-2' } : { used: true, confirmedUnits: '9007199254740993' }));
  const result = await new Bip84Discovery({ scope, derive, reader: f.reader, assertCurrent() {} }).scan();
  assert.equal(result.status, 'gap-reached'); assert.equal(result.observedAddresses, 60);
  assert.deepEqual(result.cursor.branches[0], { nextIndex: 40, lastUsedIndex: 19 });
  assert.equal(result.totals?.confirmedUnits, kind === 'balance' ? '9007199254740993' : '0');
  assert.equal(result.totals?.pendingDeltaUnits, kind === 'pending' ? '-2' : '0');
});

test('per-branch limit is exactly 100; explicit resume and refresh preserve their distinct meanings', async () => {
  let allUsed = true;
  const f = fixture(async (address) => usage(address, allUsed ? { used: true, historicalTransactions: 1 } : {}));
  const d = new Bip84Discovery({ scope, derive, reader: f.reader, assertCurrent() {} });
  const first = await d.scan(); assert.equal(first.status, 'partial'); assert.equal(first.reason, 'pass-limit'); assert.equal(first.observedAddresses, 200);
  allUsed = false;
  const second = await d.scan('resume'); assert.equal(second.status, 'gap-reached'); assert.equal(second.observedThisPass, 40);
  assert.equal(second.observationsSpanPasses, true); assert.equal(second.observedAddresses, 240);
  assert.equal(second.cursor.branches[0]?.nextIndex, 120);
  const refresh = await d.scan('refresh'); assert.equal(refresh.observedAddresses, 40); assert.equal(refresh.observationsSpanPasses, false);
  assert.equal(refresh.cursor.branches[0]?.nextIndex, 20);
});

test('index 4095 is the last derivation and exhausted range is never described as a complete account', async () => {
  let highest = -1;
  const f = fixture(async (address) => usage(address, { used: true, historicalTransactions: 1 }));
  const d = new Bip84Discovery({ scope, reader: f.reader, assertCurrent() {}, derive(request) { highest = Math.max(highest, request.index); return derive(request); } });
  for (let i = 0; i < 41; i++) await d.scan(i === 0 ? 'refresh' : 'resume');
  const result = d.getSnapshot(); assert.equal(highest, 4095); assert.equal(result.reason, 'index-limit'); assert.equal(result.status, 'partial');
  assert.equal(result.observedAddresses, 8192); assert.equal(result.cursor.branches[1]?.nextIndex, 4096);
  await d.scan('resume'); assert.equal(f.calls.length, 8192);
});

test('restored cursor is an advisory hint only; a new instance starts at zero', async () => {
  const restoredCursor = { version: 1, scope, branches: [{ nextIndex: 4000, lastUsedIndex: 3999 }, { nextIndex: 3000, lastUsedIndex: 2999 }] };
  const f = fixture(), first: number[] = [];
  const d = new Bip84Discovery({ scope, restoredCursor, reader: f.reader, assertCurrent() {}, derive(request) { first.push(request.index); return derive(request); } });
  restoredCursor.branches[0]!.nextIndex = 1;
  const result = await d.scan('resume'); assert.deepEqual(first.slice(0, 2), [0, 0]);
  assert.equal(result.restoredHint?.branches[0]?.nextIndex, 4000); assert.equal(result.observedAddresses, 40);
});

test('cursor rejects missing, extra, accessor, sparse, cross-scope and out-of-range fields without invoking accessors', () => {
  const valid = () => ({ version: 1, scope, branches: [{ nextIndex: 0, lastUsedIndex: -1 }, { nextIndex: 4096, lastUsedIndex: 4095 }] });
  const accessor = valid(); Object.defineProperty(accessor.branches[0], 'nextIndex', { enumerable: true, get() { throw Error('getter invoked'); } });
  for (const raw of [null, [], { ...valid(), complete: true }, { ...valid(), version: 2 }, { ...valid(), scope: { ...scope, networkId: 'syscoin' } },
    { ...valid(), branches: [, valid().branches[1]] }, { ...valid(), branches: [{ nextIndex: 4097, lastUsedIndex: 4095 }, valid().branches[1]] },
    { ...valid(), branches: [{ nextIndex: 0, lastUsedIndex: 0 }, valid().branches[1]] }, accessor,
    Object.assign(Object.create({ inherited: true }), valid())]) assert.throws(() => parseBip84DiscoveryCursor(raw, scope), rejects('INVALID_INPUT'));
  assert.equal(parseBip84DiscoveryCursor(valid(), scope).branches[1]?.nextIndex, 4096);
});

test('duplicate address detection covers concurrent branches before a second read', async () => {
  const f = fixture(); const one = derive({ networkId: 'bitcoin', branch: 0, index: 0 }).address;
  const d = new Bip84Discovery({ scope, reader: f.reader, assertCurrent() {}, derive: (request) => ({ ...request, address: one }) });
  await assert.rejects(d.scan(), rejects('INVALID_INPUT')); assert.ok(f.calls.length <= 1); assert.equal(d.getSnapshot().totals, null);
});

test('wrong derivation tuple, malformed usage and async derivation cannot create progress', async () => {
  const wrong: PublicBip84Deriver = (request) => ({ ...derive(request), index: request.index + 1 });
  const asyncDerive = (() => Promise.reject(Error('not a synchronous derivation'))) as unknown as PublicBip84Deriver;
  for (const derivation of [wrong, asyncDerive]) {
    const d = new Bip84Discovery({ scope, derive: derivation, reader: fixture().reader, assertCurrent() {} });
    await assert.rejects(d.scan(), rejects('INVALID_INPUT')); assert.equal(d.getSnapshot().cursor.branches[0]?.nextIndex, 0);
  }
  for (const override of [{ used: true }, { confirmedUnits: '01' }, { unconfirmedTransactions: -1 }, { pendingDeltaUnits: undefined }]) {
    const d = new Bip84Discovery({ scope, derive, reader: fixture(async (address) => usage(address, override as Partial<UtxoAddressUsage>)).reader, assertCurrent() {} });
    await assert.rejects(d.scan()); assert.equal(d.getSnapshot().totals, null); assert.equal(d.getSnapshot().observedAddresses, 0);
  }
});

test('reentrancy is reserved before guard callbacks and non-synchronous guards fail closed', async () => {
  let nested: Promise<unknown> | undefined, once = false;
  const d = new Bip84Discovery({ scope, derive, reader: fixture().reader, assertCurrent() { if (!once) { once = true; nested = d.scan(); void nested.catch(() => undefined); } } });
  await d.scan(); await assert.rejects(nested!, rejects('BUSY'));
  const bad = new Bip84Discovery({ scope, derive, reader: fixture().reader, assertCurrent: (() => Promise.reject(Error('async guard'))) as () => void });
  await assert.rejects(bad.scan(), rejects('CANCELLED'));
});

test('cancel drains an unresponsive open, closes its late result and permits a fresh scan', async () => {
  const opening = deferred<UtxoAddressUsageSession>(), f = fixture(); let first = true, lateClosed = 0;
  const d = new Bip84Discovery({ scope, derive, assertCurrent() {}, reader: { open: (network, signal) => first ? (first = false, opening.promise) : f.reader.open(network, signal) } });
  const pending = d.scan(); d.cancel(); await assert.rejects(pending, rejects('CANCELLED'));
  const fresh = await d.scan(); assert.equal(fresh.status, 'gap-reached');
  opening.resolve({ observedHeight: 1, anchorHash: hash, consumedBytes: () => 0, readAddress: async (a) => usage(a), verifyAnchor: async () => 1, close() { lateClosed++; } });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(lateClosed, 1); assert.equal(d.getSnapshot(), fresh);
});

test('A-B-A generation guard, hanging address read and hanging anchor cannot publish late observations', async () => {
  for (const stage of ['read', 'anchor'] as const) {
    const entered = deferred<void>(), wait = deferred<UtxoAddressUsage>(); let generation = 1; const captured = generation;
    const f = fixture(async (address) => { if (stage === 'read') { entered.resolve(); return wait.promise; } return usage(address); });
    const reader: UtxoAddressUsageReader = { async open(n, s) { const session = await f.reader.open(n, s); return { ...session,
      async verifyAnchor() { entered.resolve(); return new Promise<number>(() => undefined); } }; } };
    const d = new Bip84Discovery({ scope, derive, reader, assertCurrent() { if (generation !== captured) throw Error('stale'); } });
    const pending = d.scan(); await entered.promise; generation = 2; generation = 3; d.cancel();
    await assert.rejects(pending, rejects('CANCELLED')); wait.resolve(usage('late'));
    assert.equal(d.getSnapshot().totals, null); assert.equal(d.getSnapshot().observedAddresses, 0); assert.equal(f.closes, 1);
  }
});

test('failed pass retains only previous verified progress for explicit retry, without displaying it as fresh', async () => {
  let failRead = false;
  const f = fixture(async (address) => { if (failRead) throw Error('unknown'); return usage(address, { used: true, historicalTransactions: 1 }); });
  const d = new Bip84Discovery({ scope, derive, reader: f.reader, assertCurrent() {} });
  await d.scan(); failRead = true; await assert.rejects(d.scan('resume'), rejects('UNAVAILABLE'));
  assert.equal(d.getSnapshot().totals, null); assert.equal(d.getSnapshot().cursor.branches[0]?.nextIndex, 100);
  failRead = false; const retry = await d.scan('resume'); assert.equal(retry.observedThisPass, 200); assert.equal(retry.cursor.branches[0]?.nextIndex, 200);
});

test('new pass and cancel synchronously hide previously verified totals', async () => {
  const f = fixture(); const d = new Bip84Discovery({ scope, derive, reader: f.reader, assertCurrent() {} });
  await d.scan(); assert.notEqual(d.getSnapshot().totals, null);
  const next = d.scan(); assert.equal(d.getSnapshot().status, 'loading'); assert.equal(d.getSnapshot().totals, null);
  d.cancel(); assert.equal(d.getSnapshot().status, 'unavailable'); assert.equal(d.getSnapshot().totals, null);
  await assert.rejects(next, rejects('CANCELLED'));
});

test('30 second pass deadline bounds an unresponsive injected reader', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = new Bip84Discovery({ scope, derive, assertCurrent() {}, reader: { open: () => new Promise(() => undefined) } });
  const pending = d.scan(); t.mock.timers.tick(29999); assert.equal(d.getSnapshot().status, 'loading');
  t.mock.timers.tick(1); await assert.rejects(pending, rejects('CANCELLED')); assert.equal(d.getSnapshot().totals, null);
});
