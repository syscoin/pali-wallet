import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicAccountStorage } from '../src/core/publicAccountStorage.ts';
import { createWatchAccountCodec, snapshotWatchRecords } from '../src/core/watchAccountCodec.ts';
import { createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { XPUB, KEY, keyRecord, deferred } from './publicWatchFixtures.ts';
const address = createEvmWatchAccount('address', 'Address', '0x1111111111111111111111111111111111111111');
const addressRecord = { kind: 'address' as const, ...address };
const doc = (records: readonly unknown[]) => JSON.stringify({ version: 1, records });
function fixture(initial: string | null = doc([addressRecord])) {
  let raw = initial; const writes: string[] = [];
  const storage = createPublicAccountStorage({ get: async () => raw, set: async (_key, value) => { raw = value; writes.push(value); } });
  return { storage, writes, get raw() { return raw; }, set raw(value) { raw = value; } };
}
test('canonical mixed records preserve account keys internally and expose only first addresses', async () => {
  const f = fixture(), before = await f.storage.records.load();
  const saved = await f.storage.records.compareAndSet(before, [addressRecord, keyRecord()]);
  assert.equal(saved.records[1]!.kind, 'utxo-public');
  assert.equal(saved.records[1]!.kind === 'utxo-public' && saved.records[1]!.identifier, KEY);
  assert.deepEqual(saved.accounts[1]?.addresses, { bitcoin: parseUtxoPublicIdentifier(XPUB, 'bitcoin').address });
  assert.ok(!JSON.stringify(saved.accounts).includes(KEY));
  assert.deepEqual(await f.storage.loadAccounts(), saved.accounts);
  assert.equal(f.writes.length, 1); assert.deepEqual(Object.keys(JSON.parse(f.raw!)), ['version', 'records']);
});
test('existing public SDK handles aliases and supported descriptor scripts without a mobile derivation engine', () => {
  for (const descriptor of [`wpkh(${XPUB}/0/*)`, `pkh(${XPUB}/0/*)`, `sh(wpkh(${XPUB}/0/*))`, `tr(${XPUB}/0/*)`]) {
    const value = createWatchAccountCodec().validate([keyRecord('descriptor', 'bitcoin', descriptor)]);
    assert.equal(value.records[0]?.kind === 'utxo-public' && value.records[0].identifier, descriptor);
    assert.equal(value.accounts[0]?.addresses.bitcoin, parseUtxoPublicIdentifier(descriptor, 'bitcoin').address);
  }
  assert.throws(() => createWatchAccountCodec().validate([keyRecord('a', 'bitcoin', XPUB), keyRecord('b', 'bitcoin', KEY)]));
  assert.equal(createWatchAccountCodec().validate([keyRecord('a'), keyRecord('b', 'syscoin')]).records.length, 2);
});
test('absent is empty; malformed, old experimental and private records preserve bytes and never write', async () => {
  for (const raw of ['bad json', 'null', '[]', JSON.stringify({ version: 2, records: [] }), JSON.stringify({ version: 1, accounts: [] }),
    doc([{ ...keyRecord(), checkpoint: null }]), doc([{ ...keyRecord(), kind: 'bip84-public' }]), doc([{ ...keyRecord(), identifier: 'xprv-secret' }]),
    doc([{ ...keyRecord(), networkId: 'ethereum' }]), ' '.repeat(32769)]) {
    const f = fixture(raw); await assert.rejects(f.storage.records.load()); assert.equal(f.raw, raw); assert.equal(f.writes.length, 0);
  }
  assert.deepEqual((await fixture(null).storage.records.load()).records, []);
});
test('record limits fail without truncation and getters are never invoked', () => {
  const codec = createWatchAccountCodec();
  const twenty = Array.from({ length: 20 }, (_, i) => ({ ...addressRecord, id: `address_${i}` }));
  assert.equal(codec.validate(twenty).records.length, 20); assert.throws(() => codec.validate([...twenty, { ...addressRecord, id: 'extra' }]));
  let called = 0; const accessor = { ...keyRecord() }; Object.defineProperty(accessor, 'identifier', { enumerable: true, get() { called++; return XPUB; } });
  assert.throws(() => snapshotWatchRecords([accessor])); assert.equal(called, 0);
  assert.throws(() => codec.validate([{ ...keyRecord(), identifier: 'wpkh(' + 'a'.repeat(32000) + ')' }]));
});
test('renaming and explicit removal preserve other source keys; source identity cannot be replaced', async () => {
  const f = fixture(doc([keyRecord(), addressRecord])); const before = await f.storage.records.load();
  await assert.rejects(f.storage.records.compareAndSet(before, [{ ...keyRecord(), identifier: `pkh(${XPUB}/0/*)` }, addressRecord]), /identity/);
  const renamed = await f.storage.records.compareAndSet(before, before.records.map((r) => ({ ...r, name: 'Renamed' })));
  assert.equal(renamed.records[0]?.kind === 'utxo-public' && renamed.records[0].identifier, KEY);
  const removed = await f.storage.records.compareAndSet(renamed, renamed.records.filter((r) => r.id !== 'address'));
  assert.equal(removed.records.length, 1); assert.equal(removed.records[0]?.id, 'key');
});
test('snapshots are repository-issued, single-use and stale saves cannot replace changed source data', async () => {
  const f = fixture(), other = fixture(); const before = await f.storage.records.load();
  await assert.rejects(other.storage.records.compareAndSet(before, []));
  await assert.rejects(f.storage.records.compareAndSet({ ...before }, []));
  await f.storage.records.compareAndSet(before, [addressRecord, keyRecord()]);
  await assert.rejects(f.storage.records.compareAndSet(before, []));
  const current = await f.storage.records.load(); f.raw = doc([]);
  await assert.rejects(f.storage.records.compareAndSet(current, []), /changed/); assert.equal(f.raw, doc([]));
});
test('input is detached before queued saves and acknowledged writes require exact readback', async () => {
  const gate = deferred<void>(); let raw = doc([addressRecord]), reads = 0;
  const repo = createPublicAccountStorage({ async get() { if (++reads === 2) await gate.promise; return raw; }, async set(_key, value) { raw = value; } });
  const first = await repo.records.load(); const next = [{ ...keyRecord() }];
  const pending = repo.records.compareAndSet(first, next); next[0]!.name = 'Mutated'; gate.resolve();
  assert.equal((await pending).records[0]?.name, 'key');
  for (const behavior of ['ignore', 'wrong', 'throw']) {
    let data = doc([addressRecord]);
    const broken = createPublicAccountStorage({ get: async () => data, async set() { if (behavior === 'wrong') data = doc([]); if (behavior === 'throw') throw Error('ACK lost'); } });
    const loaded = await broken.records.load(); await assert.rejects(broken.records.compareAndSet(loaded, [keyRecord()]));
    await assert.rejects(broken.records.compareAndSet(loaded, []));
  }
});
