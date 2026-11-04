import assert from 'node:assert/strict';
import test from 'node:test';
import { bech32 } from 'bech32';
import { ACCOUNT_SELECTION_KEY, PUBLIC_ACCOUNTS_KEY, createPublicAccountStorage, type WatchRecordSnapshot } from '../src/core/publicAccountStorage.ts';
import { createWatchAccountCodec, snapshotWatchRecords, type PublicBip84ValidationPort, type StoredWatchAccount } from '../src/core/watchAccountCodec.ts';
import { createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import type { Bip84DiscoveryCursor } from '../src/core/bip84Discovery.ts';

// Deliberately synthetic identifiers: this port models SDK contract behavior,
// not Base58 validation, real derivation or native qualification of SDK2.1.
const KEY = 'zpub' + 'A'.repeat(107), ALIAS = 'xpub' + 'A'.repeat(107), OTHER = 'zpub' + 'B'.repeat(107);
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', SYS = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
const publicAddress = createEvmWatchAccount('mapped', 'Mapped account', '0x52908400098527886E0F7030069857D2E4169EE7');
const addressRecord: StoredWatchAccount = { kind: 'address', ...publicAddress };
const keyRecord = (id = 'watch_key', accountKey = KEY): StoredWatchAccount => ({ kind: 'bip84-public', id, name: 'Public account', networkId: 'bitcoin', policy: 'bip84-p2wpkh', accountKey, checkpoint: null });
const document = (records: readonly unknown[] = [addressRecord]) => JSON.stringify({ version: 1, records });
const checkpoint = (id = 'watch_key', n = 20): Bip84DiscoveryCursor => ({ version: 1, scope: { networkId: 'bitcoin', sourceId: id }, branches: [{ nextIndex: n, lastUsedIndex: -1 }, { nextIndex: n, lastUsedIndex: -1 }] });
const port = (): PublicBip84ValidationPort => ({
  canonicalize(request) {
    assert.ok(Object.isFrozen(request));
    if (![KEY, ALIAS, OTHER].includes(request.accountKey)) throw Error('SDK rejects unrecognized fixture');
    return { canonicalKey: request.accountKey === ALIAS ? KEY : request.accountKey };
  },
  deriveFirstReceive(request) { assert.ok(Object.isFrozen(request)); return { address: request.networkId === 'bitcoin' ? BTC : SYS }; },
});
function fixture(raw: string | null = document(), adapter = port()) {
  const data: Record<string, string> = raw === null ? {} : { [PUBLIC_ACCOUNTS_KEY]: raw };
  const writes: { key: string; value: string }[] = [];
  const repository = createPublicAccountStorage({ get: async (key) => data[key] ?? null, async set(key, value) { writes.push({ key, value }); data[key] = value; } }, adapter);
  return { data, writes, repository, records: repository.records! };
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

test('address-only host exposes the canonical records facade but rejects unvalidated account keys', async () => {
  let raw = document([keyRecord()]), writes = 0;
  const repository = createPublicAccountStorage({ get: async () => raw, set: async (_key, value) => { raw = value; writes++; } });
  assert.ok(repository.records);
  await assert.rejects(repository.records.load());
  await assert.rejects(repository.loadAccounts());
  await assert.rejects(repository.compareAndSetAccounts([], [publicAddress]));
  assert.equal(raw, document([keyRecord()])); assert.equal(writes, 0);
});

test('canonical addresses open without writes, SDK calls or loss of explicit network mappings', async () => {
  let called = 0; const raw = JSON.stringify({ records: [addressRecord], version: 1 }, null, 2);
  const f = fixture(raw, { canonicalize() { called++; throw Error(); }, deriveFirstReceive() { called++; throw Error(); } });
  const loaded = await f.records.load();
  assert.equal(loaded.version, 1); assert.deepEqual(loaded.records, [addressRecord]); assert.deepEqual(loaded.accounts, [publicAddress]);
  assert.equal(called, 0); assert.equal(f.writes.length, 0); assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], raw);
  assert.ok(Object.isFrozen(loaded) && Object.isFrozen(loaded.records) && Object.isFrozen(loaded.accounts));
});

test('explicit mixed-record save uses the same canonical format and projects no key or checkpoint', async () => {
  const f = fixture(), initial = await f.records.load();
  const saved = await f.records.compareAndSet(initial, [addressRecord, keyRecord('watch_key', ALIAS)]);
  assert.equal(saved.version, 1); assert.equal(saved.records[1]?.kind, 'bip84-public');
  assert.equal(saved.records[1]?.kind === 'bip84-public' && saved.records[1].accountKey, KEY);
  assert.deepEqual(saved.accounts[1], { id: 'watch_key', name: 'Public account', addresses: { bitcoin: BTC } });
  for (const publicData of [saved.accounts, saved.accounts[1]]) {
    const serialized = JSON.stringify(publicData); assert.ok(!serialized.includes(KEY) && !serialized.includes(ALIAS) && !serialized.includes('checkpoint'));
  }
  assert.deepEqual(Object.keys(f.data), [PUBLIC_ACCOUNTS_KEY]); assert.equal(f.writes.length, 1);
  await assert.rejects(f.repository.loadAccounts());
  await assert.rejects(f.repository.compareAndSetAccounts(saved.accounts, []));
  assert.equal(f.writes.length, 1);
});

test('every account-key read revalidates all keys and aliases canonicalize without an eager rewrite', async () => {
  const raw = document([keyRecord('watch_key', ALIAS)]); let parses = 0, derives = 0;
  const adapter = port(); const f = fixture(raw, { canonicalize(r) { parses++; return adapter.canonicalize(r); }, deriveFirstReceive(r) { derives++; return adapter.deriveFirstReceive(r); } });
  for (let i = 0; i < 2; i++) {
    const loaded = await f.records.load(); assert.equal(loaded.records[0]?.kind === 'bip84-public' && loaded.records[0].accountKey, KEY);
  }
  assert.equal(parses, 4); assert.equal(derives, 2); assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], raw); assert.equal(f.writes.length, 0);
});

test('canonical alias duplicates reject while Bitcoin and Syscoin scopes remain distinct', () => {
  const codec = createWatchAccountCodec(port());
  assert.throws(() => codec.validate([keyRecord('a', KEY), keyRecord('b', ALIAS)]));
  const syscoin = { ...keyRecord('syscoin'), networkId: 'syscoin' };
  const value = codec.validate([keyRecord(), syscoin]);
  assert.deepEqual(value.accounts.map((a) => a.addresses), [{ bitcoin: BTC }, { syscoin: SYS }]);
});

test('missing, corrupt, unknown and oversized documents preserve exact bytes and refuse writes', async () => {
  for (const raw of ['bad json ' + KEY, 'null', '[]', JSON.stringify({ version: 3, records: [] }),
    JSON.stringify({ version: 1, accounts: [] }), JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 1, records: [], complete: true }), document([{ ...keyRecord(), trusted: true }]),
    document([{ ...keyRecord(), accountKey: 'xprv-not-public' }]), document([{ ...keyRecord(), networkId: 'ethereum' }]), ' '.repeat(32769)]) {
    const f = fixture(raw); await assert.rejects(f.records.load(), (error: Error) => !error.message.includes(KEY));
    assert.equal(f.writes.length, 0); assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], raw);
  }
  const empty = fixture(null); assert.deepEqual((await empty.records.load()).records, []); assert.equal(empty.writes.length, 0);
});

test('record limit accepts twenty and refuses twenty-one with no truncation', () => {
  const codec = createWatchAccountCodec(port());
  const twenty = Array.from({ length: 20 }, (_, i) => ({ ...addressRecord, id: 'address_' + i }));
  assert.equal(codec.validate(twenty).records.length, 20);
  assert.throws(() => codec.validate([...twenty, { ...addressRecord, id: 'extra' }]));
  assert.throws(() => codec.decode(document([{ ...keyRecord(), name: 'é'.repeat(20000) }])));
});

test('input detachment rejects accessors, sparse/custom arrays, symbols, private fields and custom serialization before port calls', () => {
  let calls = 0;
  const codec = createWatchAccountCodec({ canonicalize() { calls++; return { canonicalKey: KEY }; }, deriveFirstReceive() { calls++; return { address: BTC }; } });
  const getter = { ...keyRecord() }; Object.defineProperty(getter, 'accountKey', { enumerable: true, get() { throw Error('getter invoked'); } });
  const checkpointGetter = checkpoint(); Object.defineProperty(checkpointGetter.branches[0], 'nextIndex', { enumerable: true, get() { throw Error('getter invoked'); } });
  const symbol = { ...keyRecord(), [Symbol('hidden')]: true };
  const hidden = { ...keyRecord() }; Object.defineProperty(hidden, 'hidden', { value: true });
  const weirdArray = [keyRecord()]; Object.defineProperty(weirdArray, 'extra', { value: true });
  for (const bad of [[getter], [symbol], [hidden], weirdArray, [, keyRecord()], [{ ...keyRecord(), checkpoint: checkpointGetter }],
    [{ ...keyRecord(), toJSON() { throw Error('serializer invoked'); } }], [Object.assign(Object.create({ inherited: true }), keyRecord())]]) assert.throws(() => codec.validate(bad));
  assert.equal(calls, 0);
});

test('account-key adapter is captured once, synchronous and strict about every output shape', async () => {
  const addressOnly = createWatchAccountCodec();
  assert.equal(addressOnly.validate([addressRecord]).records.length, 1);
  assert.throws(() => addressOnly.validate([keyRecord()]));
  for (const bad of [{}, { ...port(), validated: true }, { canonicalize: 1, deriveFirstReceive: () => ({ address: BTC }) }]) assert.throws(() => createWatchAccountCodec(bad as PublicBip84ValidationPort));
  const accessor = { ...port() }; Object.defineProperty(accessor, 'canonicalize', { get() { throw Error('getter invoked'); } }); assert.throws(() => createWatchAccountCodec(accessor));
  for (const output of [null, [], { canonicalKey: KEY, valid: true }, { canonicalKey: KEY, then() {} }, Promise.reject(Error('async')), Object.create({ canonicalKey: KEY })]) {
    const codec = createWatchAccountCodec({ ...port(), canonicalize: (() => output) as PublicBip84ValidationPort['canonicalize'] });
    assert.throws(() => codec.validate([keyRecord()]));
  }
  for (const canonicalKey of ['xprv' + 'A'.repeat(107), ALIAS, 'zpubbad', 'zpub' + '0'.repeat(107)]) assert.throws(() => createWatchAccountCodec({ ...port(), canonicalize: () => ({ canonicalKey }) }).validate([keyRecord()]));
  const badOutput = Object.defineProperty({}, 'canonicalKey', { enumerable: true, get() { throw Error('getter invoked'); } });
  assert.throws(() => createWatchAccountCodec({ ...port(), canonicalize: (() => badOutput) as unknown as PublicBip84ValidationPort['canonicalize'] }).validate([keyRecord()]));
  for (const output of [{ address: BTC, trusted: true }, { address: SYS }, Promise.resolve({ address: BTC })]) assert.throws(() => createWatchAccountCodec({ ...port(), deriveFirstReceive: (() => output) as PublicBip84ValidationPort['deriveFirstReceive'] }).validate([keyRecord()]));
  assert.throws(() => createWatchAccountCodec({ ...port(), canonicalize() { throw Error(KEY); } }).validate([keyRecord()]), (error: Error) => !error.message.includes(KEY));
  const mutable = { ...port() }, codec = createWatchAccountCodec(mutable); mutable.canonicalize = () => { throw Error('mutated'); };
  assert.equal(codec.validate([keyRecord()]).records.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
});

test('canonicalization must be idempotent before any key is accepted', () => {
  let calls = 0;
  assert.throws(() => createWatchAccountCodec({ ...port(), canonicalize() { return { canonicalKey: ++calls === 1 ? KEY : OTHER }; } }).validate([keyRecord()]));
});

test('key, network, kind and address source cannot change for a retained ID', async () => {
  const f = fixture(document([addressRecord, keyRecord()]));
  for (const changed of [{ ...keyRecord(), accountKey: OTHER }, { ...keyRecord(), networkId: 'syscoin' }, { ...addressRecord, id: 'watch_key' },
    { ...addressRecord, addresses: { ethereum: '0x1111111111111111111111111111111111111111' } }]) {
    const loaded = await f.records.load();
    await assert.rejects(f.records.compareAndSet(loaded, changed.id === 'mapped' ? [changed, keyRecord()] : [addressRecord, changed]), /identity cannot change/);
  }
  assert.equal(f.writes.length, 0);
});

test('rename and checkpoint preserve canonical source and all sibling records', async () => {
  const f = fixture(document([addressRecord, keyRecord()]));
  let loaded = await f.records.load();
  loaded = await f.records.compareAndSet(loaded, loaded.records.map((r) => r.id === 'watch_key' ? { ...r, name: 'Renamed' } : r));
  const saved = await f.records.saveCheckpoint(loaded, 'watch_key', checkpoint());
  assert.deepEqual(saved.records[0], addressRecord);
  assert.deepEqual(saved.records[1], { ...keyRecord(), name: 'Renamed', checkpoint: checkpoint() });
  assert.equal(f.writes.length, 2);
});

test('checkpoint parser rejects cross-source/network, extra completion/amounts and out of bounds without writes', async () => {
  const f = fixture(document([keyRecord()]));
  for (const cursor of [checkpoint('other'), { ...checkpoint(), scope: { networkId: 'syscoin', sourceId: 'watch_key' } },
    { ...checkpoint(), complete: true }, { ...checkpoint(), balance: '0' }, checkpoint('watch_key', 4097)]) {
    const loaded = await f.records.load(); await assert.rejects(async () => f.records.saveCheckpoint(loaded, 'watch_key', cursor as Bip84DiscoveryCursor));
  }
  assert.equal(f.writes.length, 0);
});

test('full raw-document CAS rejects even semantically equivalent external changes', async () => {
  const f = fixture(document([keyRecord()])), loaded = await f.records.load();
  f.data[PUBLIC_ACCOUNTS_KEY] = JSON.stringify(JSON.parse(f.data[PUBLIC_ACCOUNTS_KEY]!), null, 2);
  const externallyChanged = f.data[PUBLIC_ACCOUNTS_KEY];
  await assert.rejects(f.records.saveCheckpoint(loaded, 'watch_key', checkpoint()), /changed/);
  assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], externallyChanged); assert.equal(f.writes.length, 0);
});

test('queued checkpoint cannot overwrite a rename or recreate a deleted account', async () => {
  for (const remove of [false, true]) {
    const f = fixture(document([addressRecord, keyRecord()])), loaded = await f.records.load();
    const change = f.records.compareAndSet(loaded, remove ? [addressRecord] : loaded.records.map((r) => ({ ...r, name: 'Renamed' })));
    const stale = f.records.saveCheckpoint(loaded, 'watch_key', checkpoint());
    await change; await assert.rejects(stale, /Reopen/);
    const final = await f.records.load(); assert.equal(final.records.length, remove ? 1 : 2); assert.equal(f.writes.length, 1);
    if (!remove) assert.equal(final.records[1]?.name, 'Renamed');
  }
});

test('snapshots are owner-bound and caller changes are detached before awaiting storage', async () => {
  const f = fixture(), elsewhere = fixture(); const loaded = await f.records.load();
  await assert.rejects(elsewhere.records.compareAndSet(loaded, []), /Reopen/);
  await assert.rejects(f.records.compareAndSet({ ...loaded } as WatchRecordSnapshot, []), /Reopen/);
  const proposed = [{ ...addressRecord, name: 'Saved name' }]; const pending = f.records.compareAndSet(loaded, proposed); proposed[0]!.name = 'Mutated';
  assert.equal((await pending).records[0]?.name, 'Saved name');
});

test('lost write ACK poisons mutation until reread and never compensates or replays', async () => {
  let raw = document(), writes = 0, loseAck = true;
  const repo = createPublicAccountStorage({ get: async () => raw, async set(_key, value) { writes++; raw = value; if (loseAck) throw Error('lost acknowledgement'); } }, port());
  const store = repo.records!, first = await store.load(), competing = await store.load();
  await assert.rejects(store.compareAndSet(first, [addressRecord, keyRecord()]));
  await assert.rejects(store.compareAndSet(competing, []), /unavailable/);
  await assert.rejects(repo.compareAndSetAccounts([publicAddress], []), /unavailable/);
  assert.equal(writes, 1); assert.equal(JSON.parse(raw).version, 1);
  loseAck = false; const recovered = await store.load(); assert.equal(recovered.records.length, 2);
  await store.saveCheckpoint(recovered, 'watch_key', checkpoint()); assert.equal(writes, 2);
});

test('missing, wrong and unreadable readback refuse success and retain write ambiguity', async () => {
  for (const mode of ['missing', 'wrong', 'read-error']) {
    let raw: string | null = document(), written = false, writes = 0;
    const repo = createPublicAccountStorage({ async get() { if (written && mode === 'read-error') throw Error('offline'); return raw; }, async set() { writes++; written = true; if (mode === 'missing') raw = null; if (mode === 'wrong') raw = document([]); } }, port());
    const first = await repo.records!.load(); await assert.rejects(repo.records!.compareAndSet(first, [addressRecord, keyRecord()]));
    await assert.rejects(repo.records!.compareAndSet(first, [])); assert.equal(writes, 1);
  }
});

test('record and selection operations share one serial queue without a competing writer', async () => {
  const gate = deferred<void>(), entered = deferred<void>(); const events: string[] = []; let raw = document(), selection: string | null = null;
  const repo = createPublicAccountStorage({ async get(key) { return key === PUBLIC_ACCOUNTS_KEY ? raw : selection; }, async set(key, value) {
    events.push(key); if (key === PUBLIC_ACCOUNTS_KEY) { entered.resolve(); await gate.promise; raw = value; } else selection = value;
  } }, port());
  const loaded = await repo.records!.load(); const recordSave = repo.records!.compareAndSet(loaded, [addressRecord, keyRecord()]); await entered.promise;
  const selectionSave = repo.saveSelection({ kind: 'watch', id: 'watch_key' }); assert.deepEqual(events, [PUBLIC_ACCOUNTS_KEY]);
  gate.resolve(); await recordSave; await selectionSave; assert.deepEqual(events, [PUBLIC_ACCOUNTS_KEY, ACCOUNT_SELECTION_KEY]);
  assert.deepEqual(await repo.loadSelection(), { kind: 'watch', id: 'watch_key' });
});

test('pure snapshot retains only bounded record data and cannot persist an inferred complete flag', () => {
  const value = snapshotWatchRecords([keyRecord()]); assert.ok(Object.isFrozen(value) && Object.isFrozen(value[0]));
  assert.throws(() => snapshotWatchRecords([{ ...keyRecord(), complete: true }]));
});

test('address-only save refuses account-key records even without a prior load, with or without an adapter', async () => {
  for (const adapter of [undefined, port()]) {
    const raw = document([{ ...keyRecord(), checkpoint: checkpoint() }]); let current = raw, writes = 0;
    const repo = createPublicAccountStorage({ get: async () => current, async set(_key, value) { writes++; current = value; } }, adapter);
    await assert.rejects(repo.compareAndSetAccounts([], [publicAddress]));
    assert.equal(writes, 0); assert.equal(current, raw);
  }
});

test('codec serialization accepts only its own already validated immutable list', () => {
  const codec = createWatchAccountCodec(port()), validated = codec.validate([keyRecord()]);
  assert.equal(codec.encode(validated.records), document([keyRecord()]));
  assert.throws(() => codec.encode([keyRecord()]));
  assert.throws(() => createWatchAccountCodec(port()).encode(validated.records));
});

test('reread after an ambiguous attempt cannot reactivate any older snapshot', async () => {
  let raw = document(), fail = true, writes = 0;
  const repo = createPublicAccountStorage({ get: async () => raw, async set(_key, value) { writes++; if (fail) throw Error(KEY); raw = value; } }, port());
  const first = await repo.records!.load(), held = await repo.records!.load();
  await assert.rejects(repo.records!.compareAndSet(first, [addressRecord, keyRecord()]), (e: Error) => !e.message.includes(KEY));
  const fresh = await repo.records!.load(); fail = false;
  await assert.rejects(repo.records!.compareAndSet(held, []), /Reopen/);
  await repo.records!.compareAndSet(fresh, [addressRecord, keyRecord()]); assert.equal(writes, 2);
});

test('changed adapter output cannot retarget a captured source or pass inconsistent readback', async () => {
  const otherAddress = bech32.encode('bc', [0, ...bech32.toWords(new Uint8Array(20).fill(1))]);
  for (const changeAt of ['before-write', 'readback']) {
    let wrong = false, raw = document([keyRecord()]), writes = 0;
    const repo = createPublicAccountStorage({ get: async () => raw, async set(_key, value) { writes++; raw = value; if (changeAt === 'readback') wrong = true; } },
      { ...port(), deriveFirstReceive: () => ({ address: wrong ? otherAddress : BTC }) });
    const snapshot = await repo.records!.load(); if (changeAt === 'before-write') wrong = true;
    await assert.rejects(repo.records!.saveCheckpoint(snapshot, 'watch_key', checkpoint()));
    assert.equal(writes, changeAt === 'readback' ? 1 : 0);
  }
});

test('validation callbacks cannot jump ahead of their reserved record write', async () => {
  let raw = document(), selection: string | null = null, queued: Promise<void> | undefined;
  const events: string[] = []; let repo!: ReturnType<typeof createPublicAccountStorage>;
  const base = port();
  repo = createPublicAccountStorage({ get: async (key) => key === PUBLIC_ACCOUNTS_KEY ? raw : selection,
    async set(key, value) { events.push(key); if (key === PUBLIC_ACCOUNTS_KEY) raw = value; else selection = value; } },
    { ...base, canonicalize(request) { queued ??= repo.saveSelection({ kind: 'watch', id: 'watch_key' }); return base.canonicalize(request); } });
  const initial = await repo.records!.load(); await repo.records!.compareAndSet(initial, [addressRecord, keyRecord()]); await queued;
  assert.deepEqual(events, [PUBLIC_ACCOUNTS_KEY, ACCOUNT_SELECTION_KEY]);
});

test('raw document byte ceiling accepts exactly 32KiB and rejects one byte more before adapter work', async () => {
  const body = document([keyRecord()]), exact = body + ' '.repeat(32768 - Buffer.byteLength(body));
  const accepted = fixture(exact); assert.equal((await accepted.records.load()).records.length, 1); assert.equal(accepted.writes.length, 0);
  let calls = 0; const rejected = fixture(exact + ' ', { ...port(), canonicalize() { calls++; return { canonicalKey: KEY }; } });
  await assert.rejects(rejected.records.load()); assert.equal(calls, 0); assert.equal(rejected.writes.length, 0); assert.equal(rejected.data[PUBLIC_ACCOUNTS_KEY], exact + ' ');
});
