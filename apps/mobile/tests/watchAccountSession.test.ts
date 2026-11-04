import assert from 'node:assert/strict';
import test from 'node:test';
import { bech32 } from 'bech32';
import { createPublicAccountStorage } from '../src/core/publicAccountStorage.ts';
import { WatchOnlyAuthority, createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { createUtxoAddressUsageReader } from '../src/core/utxoAddressUsage.ts';
import { getUtxoNetwork, type UtxoNetworkId } from '../src/core/utxoNetworks.ts';
import type { StoredWatchAccount, PublicBip84ValidationPort } from '../src/core/watchAccountCodec.ts';

// Synthetic public derivation fixture; no SDK or key material is generated.
const KEY = 'zpub' + 'A'.repeat(107), OTHER = 'zpub' + 'B'.repeat(107), HASH = 'a'.repeat(64);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
function derive(network: UtxoNetworkId, key: string, branch: 0 | 1, index: number) {
  const bytes = new Uint8Array(20); bytes[0] = key === KEY ? 1 : 2; bytes[1] = branch; bytes[2] = index >> 8; bytes[3] = index & 255;
  return { branch, index, address: bech32.encode(getUtxoNetwork(network).addressHrp, [0, ...bech32.toWords(bytes)]) };
}
const adapter: PublicBip84ValidationPort = { canonicalize({ accountKey }) { if (![KEY, OTHER].includes(accountKey)) throw Error('unknown fixture'); return { canonicalKey: accountKey }; }, deriveFirstReceive({ networkId, canonicalKey }) { return { address: derive(networkId, canonicalKey, 0, 0).address }; } };
const record = (id = 'key', networkId: UtxoNetworkId = 'bitcoin', key = KEY): StoredWatchAccount => ({ kind: 'bip84-public', id, name: id, networkId, policy: 'bip84-p2wpkh', accountKey: key, checkpoint: null });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function fixture(records: readonly StoredWatchAccount[] = [record()]) {
  let raw = JSON.stringify({ version: 2, records }), used = false, error = false, failAck = false, reads = 0;
  let blockReadAt: number | undefined, blockFetchAt: number | undefined;
  let readGate: Promise<void> | undefined, writeGate: Promise<void> | undefined, fetchGate: Promise<void> | undefined;
  const readEntered = deferred<void>(), writeEntered = deferred<void>(), fetchEntered = deferred<void>();
  const calls: { url: string; signal?: AbortSignal | null }[] = [], writes: string[] = [];
  const repository = createPublicAccountStorage({ async get() { reads++; if (readGate && (blockReadAt === undefined || reads === blockReadAt)) { readEntered.resolve(); await readGate; } if (error) throw Error('storage unavailable'); return raw; }, async set(_key, value) { writes.push(value); writeEntered.resolve(); if (writeGate) await writeGate; raw = value; if (failAck) throw Error('lost ACK'); } }, adapter);
  const usageReader = createUtxoAddressUsageReader({ async fetch(url, init) {
    calls.push({ url, signal: init.signal });
    if (fetchGate && (blockFetchAt === undefined || calls.length === blockFetchAt)) { fetchEntered.resolve(); await fetchGate; }
    const network = url.startsWith(getUtxoNetwork('bitcoin').endpoint) ? getUtxoNetwork('bitcoin') : getUtxoNetwork('syscoin');
    if (url.endsWith('/api/')) return json({ blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 123 }, backend: { chain: 'main' } });
    if (url.includes('/block-index/')) return json({ blockHash: url.endsWith('/0') ? network.genesisHash : HASH });
    const address = decodeURIComponent(url.split('/address/')[1]!.split('?')[0]!);
    return json({ address, balance: used ? '4' : '0', unconfirmedBalance: used ? '-1' : '0', txs: used ? 1 : 0, unconfirmedTxs: 0 });
  } });
  const options = { repository: repository.records!, reader: { readBalance: async () => ({ chainId: 1, units: '7' }) }, usageReader,
    bindPublicAccount({ networkId, canonicalKey }: { networkId: UtxoNetworkId; canonicalKey: string }) { return { derive: ({ branch, index }: { branch: 0 | 1; index: number }) => derive(networkId, canonicalKey, branch, index) }; }, signal: new AbortController().signal };
  return { repository, options, calls, writes, readEntered, writeEntered, fetchEntered,
    get raw() { return raw; }, set raw(value: string) { raw = value; },
    set used(value: boolean) { used = value; }, set error(value: boolean) { error = value; }, set failAck(value: boolean) { failAck = value; },
    set blockReadAt(value: number) { blockReadAt = value; }, set blockFetchAt(value: number) { blockFetchAt = value; },
    set readGate(value: Promise<void> | undefined) { readGate = value; }, set writeGate(value: Promise<void> | undefined) { writeGate = value; }, set fetchGate(value: Promise<void> | undefined) { fetchGate = value; } };
}

test('legacy constructor omits observation metadata and keeps single-address behavior', async () => {
  const account = createEvmWatchAccount('old', 'Old', '0x1111111111111111111111111111111111111111');
  const owner = new WatchOnlyAuthority([account], { readBalance: async () => ({ chainId: 1, units: '0' }) });
  owner.unlock(); await owner.refresh(); assert.equal('accountObservation' in owner.getSnapshot(), false);
  assert.equal(owner.getSnapshot().balance.status, 'available'); await assert.rejects(owner.continueDiscovery(), /unavailable/);
});

for (const network of ['bitcoin', 'syscoin'] as const) test(`${network} admission performs no network; explicit refresh observes both branches and saves before publish`, async () => {
  const f = fixture([record('key', network)]), owner = await WatchOnlyAuthority.openRecords(f.options);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(owner.getSnapshot().status, 'locked');
  const events: string[] = []; owner.subscribe((state) => { const data = JSON.stringify(state); assert.ok(!data.includes(KEY) && !data.includes('derive') && !data.includes('checkpoint')); events.push(state.accountObservation?.status ?? 'none'); });
  owner.unlock(); const run = owner.refresh(); assert.equal(owner.getSnapshot().accountObservation?.status, 'loading'); await run;
  const state = owner.getSnapshot(), seen = state.accountObservation!;
  assert.equal(state.balance.status, 'unknown'); assert.equal(seen.status, 'gap-reached'); assert.deepEqual(seen.totals, { confirmedUnits: '0', pendingDeltaUnits: '0' });
  assert.equal(seen.observedAddresses, 40); assert.equal(f.calls.length, 45); assert.equal(f.writes.length, 1);
  assert.ok(f.calls.every(({ signal }) => signal?.aborted)); assert.equal(seen.canContinue, false); assert.ok(events.includes('loading'));
});

test('partial Continue uses live prefix; Refresh starts over; persisted cursor never grants cold resume', async () => {
  const f = fixture(); f.used = true; const owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  await owner.refresh(); let value = owner.getSnapshot().accountObservation!;
  assert.equal(value.status, 'partial'); assert.equal(value.observedAddresses, 200); assert.equal(value.canContinue, true); assert.equal(value.totals?.pendingDeltaUnits, '-200');
  f.used = false; await owner.continueDiscovery(); value = owner.getSnapshot().accountObservation!;
  assert.equal(value.status, 'gap-reached'); assert.equal(value.observedAddresses, 240); assert.equal(value.observationsSpanPasses, true);
  await owner.refresh(); assert.equal(owner.getSnapshot().accountObservation?.observedAddresses, 40);
  const reopened = await WatchOnlyAuthority.openRecords(f.options); reopened.unlock(); await assert.rejects(reopened.continueDiscovery(), /No live/);
  const count = f.calls.length; await reopened.refresh(); assert.equal(f.calls.length - count, 45);
});

test('factory rejects bad storage distinctly from a legitimate empty store', async () => {
  const empty = fixture([]), opened = await WatchOnlyAuthority.openRecords(empty.options); assert.equal(opened.getSnapshot().status, 'empty');
  const f = fixture(); f.error = true; await assert.rejects(WatchOnlyAuthority.openRecords(f.options), /could not be opened/); assert.equal(f.calls.length, 0);
});

test('factory cancellation only owns admission and removes the listener after success or failure', async () => {
  const f = fixture(), controller = new AbortController(); let adds = 0, removes = 0;
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args: Parameters<typeof add>) => { adds++; add(...args); }; controller.signal.removeEventListener = (...args: Parameters<typeof remove>) => { removes++; remove(...args); };
  const owner = await WatchOnlyAuthority.openRecords({ ...f.options, signal: controller.signal }); assert.equal(adds, removes);
  owner.unlock(); controller.abort(); assert.equal(owner.getSnapshot().status, 'ready'); await owner.refresh();
  const other = fixture(), wait = deferred<void>(), stop = new AbortController(); other.readGate = wait.promise;
  const pending = WatchOnlyAuthority.openRecords({ ...other.options, signal: stop.signal }); await other.readEntered.promise; stop.abort(); await assert.rejects(pending, /cancelled/);
  wait.resolve(); assert.equal(other.calls.length, 0);
});

test('binding output must be synchronous, own-data and agree with stored first address', async () => {
  for (const mode of ['promise', 'getter', 'mismatch', 'index', 'throw']) {
    const f = fixture(); const options = { ...f.options, bindPublicAccount: (() => {
      if (mode === 'promise') return Promise.reject(Error(KEY));
      if (mode === 'getter') return Object.defineProperty({}, 'derive', { enumerable: true, get() { throw Error('getter invoked'); } });
      if (mode === 'throw') throw Error(KEY);
      return { derive: () => mode === 'index' ? { ...derive('bitcoin', KEY, 0, 0), index: 1 } : derive('bitcoin', OTHER, 0, 0) };
    }) as unknown as typeof f.options.bindPublicAccount };
    await assert.rejects(WatchOnlyAuthority.openRecords(options), (error: Error) => !error.message.includes(KEY)); assert.equal(f.calls.length, 0);
  }
  await new Promise((r) => setImmediate(r));
});

test('duplicate/reentrant discovery is reserved before observers and retains one in-flight scan', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); let nested: Promise<void> | undefined;
  owner.subscribe((state) => { if (state.accountObservation?.status === 'loading' && !nested) { nested = owner.refresh(); void nested.catch(() => undefined); } });
  await owner.refresh(); await assert.rejects(nested!, /already in progress/); assert.equal(f.calls.length, 45);
});

test('observer lock at loading prevents any read or checkpoint dispatch', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  owner.subscribe((state) => { if (state.accountObservation?.status === 'loading') owner.lock(); });
  await owner.refresh(); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(owner.getSnapshot().accountObservation?.totals, null);
});

test('account A-B-A, network/context changes and cancel discard in-flight reads and continuation', async () => {
  const f = fixture([record('a'), record('b', 'syscoin', OTHER)]), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  const hold = deferred<void>(); f.fetchGate = hold.promise; const run = owner.refresh(); await f.fetchEntered.promise;
  owner.selectAccount('b'); owner.selectAccount('a'); hold.resolve(); await run;
  assert.equal(owner.getSnapshot().selectedAccountId, 'a'); assert.equal(owner.getSnapshot().accountObservation?.status, 'unknown'); assert.equal(f.writes.length, 0);
  f.fetchGate = undefined; f.used = true; await owner.refresh(); assert.equal(owner.getSnapshot().accountObservation?.canContinue, true);
  owner.cancelRefresh(); assert.equal(owner.getSnapshot().accountObservation?.status, 'unknown'); await assert.rejects(owner.continueDiscovery(), /No live/);
});

test('mixed address and key accounts keep EVM balance separate from account observations', async () => {
  const evm = createEvmWatchAccount('evm', 'EVM', '0x1111111111111111111111111111111111111111');
  const f = fixture([record(), { kind: 'address', ...evm }]), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  await owner.refresh(); owner.selectAccount('evm'); await owner.refresh();
  assert.equal(owner.getSnapshot().balance.status, 'available'); assert.equal('accountObservation' in owner.getSnapshot(), false);
  owner.selectAccount('key'); assert.equal(owner.getSnapshot().balance.status, 'unknown'); assert.equal(owner.getSnapshot().accountObservation?.totals, null);
});

test('rename/removal/full-record changes require reopening and never become empty accounts', async () => {
  for (const mutation of ['rename', 'remove', 'checkpoint']) {
    const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); const doc = JSON.parse(f.raw);
    if (mutation === 'rename') doc.records[0].name = 'renamed'; else if (mutation === 'remove') doc.records = []; else doc.records[0].checkpoint = { version: 1, scope: { networkId: 'bitcoin', sourceId: 'key' }, branches: [{ nextIndex: 20, lastUsedIndex: -1 }, { nextIndex: 20, lastUsedIndex: -1 }] };
    f.raw = JSON.stringify(doc); await owner.refresh(); assert.equal(owner.getSnapshot().accountObservation?.status, 'unavailable'); assert.equal(owner.getSnapshot().accounts.length, 1);
    assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  }
});

test('storage and network errors clear totals and require revalidation before another scan', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); await owner.refresh();
  f.error = true; await owner.refresh(); assert.equal(owner.getSnapshot().accountObservation?.totals, null); assert.equal(owner.getSnapshot().accounts.length, 1);
  f.error = false; const before = f.calls.length; await owner.refresh(); assert.equal(f.calls.length - before, 45); assert.equal(owner.getSnapshot().accountObservation?.status, 'gap-reached');
});

test('checkpoint ACK gates observation publication; already dispatched cancellation drains and never republishes', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); const gate = deferred<void>(); f.writeGate = gate.promise;
  const run = owner.refresh(); await f.writeEntered.promise; assert.equal(owner.getSnapshot().accountObservation?.status, 'loading'); assert.equal(owner.getSnapshot().accountObservation?.totals, null);
  owner.lock(); owner.unlock(); await assert.rejects(owner.refresh(), /already in progress/); gate.resolve(); await run;
  assert.equal(owner.getSnapshot().accountObservation?.status, 'unknown'); assert.equal(owner.getSnapshot().accountObservation?.totals, null); assert.equal(f.writes.length, 1);
});

test('lost checkpoint ACK remains unavailable and does not reuse the old scan or silently replay', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); f.failAck = true; await owner.refresh();
  assert.equal(owner.getSnapshot().accountObservation?.status, 'unavailable'); assert.equal(owner.getSnapshot().accountObservation?.totals, null); assert.equal(f.writes.length, 1);
  f.failAck = false; await owner.refresh(); assert.equal(f.writes.length, 1); assert.equal(owner.getSnapshot().accountObservation?.status, 'unavailable');
  const reopened = await WatchOnlyAuthority.openRecords(f.options); reopened.unlock(); await reopened.refresh(); assert.equal(reopened.getSnapshot().accountObservation?.status, 'gap-reached');
});

test('repository guard checks after an awaited read and cancels without poisoning or writing', async () => {
  const f = fixture(), snapshot = await f.repository.records!.load(), gate = deferred<void>(); f.readGate = gate.promise; let current = true;
  const cursor = { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' }, branches: [{ nextIndex: 20, lastUsedIndex: -1 }, { nextIndex: 20, lastUsedIndex: -1 }] };
  const run = f.repository.records!.saveCheckpoint(snapshot, 'key', cursor, () => { if (!current) throw Error('stale'); }); await f.readEntered.promise; current = false; gate.resolve();
  await assert.rejects(run, { name: 'CheckpointCancelledError' }); assert.equal(f.writes.length, 0); f.readGate = undefined;
  const fresh = await f.repository.records!.load(); await f.repository.records!.saveCheckpoint(fresh, 'key', cursor); assert.equal(f.writes.length, 1);
  await assert.rejects(f.repository.records!.saveCheckpoint(snapshot, 'key', cursor), /Reopen/);
});

test('queued checkpoint guard is synchronous and rejects async/nonfunction admission', async () => {
  const f = fixture(), cursor = { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' }, branches: [{ nextIndex: 0, lastUsedIndex: -1 }, { nextIndex: 0, lastUsedIndex: -1 }] };
  const snapshot = await f.repository.records!.load();
  await assert.rejects(f.repository.records!.saveCheckpoint(snapshot, 'key', cursor, (() => Promise.reject(Error('async'))) as () => void), { name: 'CheckpointCancelledError' });
  const fresh = await f.repository.records!.load(); await assert.rejects(f.repository.records!.saveCheckpoint(fresh, 'key', cursor, 1 as unknown as () => void)); assert.equal(f.writes.length, 0);
});

test('authority lock while checkpoint pre-read is waiting prevents dispatch and permits a fresh retry', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options), gate = deferred<void>(); owner.unlock();
  f.blockReadAt = 3; f.readGate = gate.promise;
  const run = owner.refresh(); await f.readEntered.promise; owner.lock(); gate.resolve(); await run;
  assert.equal(f.writes.length, 0); assert.equal(owner.getSnapshot().accountObservation?.totals, null);
  f.readGate = undefined; owner.unlock(); await owner.refresh(); assert.equal(owner.getSnapshot().accountObservation?.status, 'gap-reached'); assert.equal(f.writes.length, 1);
});

test('queued checkpoint cancellation consumes its attempt without poisoning durable records', async () => {
  const f = fixture(), loaded = await f.repository.records!.load(), gate = deferred<void>();
  f.readGate = gate.promise; const blocker = f.repository.records!.load(); await f.readEntered.promise;
  let current = true;
  const cursor = { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' }, branches: [{ nextIndex: 0, lastUsedIndex: -1 }, { nextIndex: 0, lastUsedIndex: -1 }] };
  const save = f.repository.records!.saveCheckpoint(loaded, 'key', cursor, () => { if (!current) throw Error('stale'); });
  current = false; gate.resolve(); await blocker; await assert.rejects(save, { name: 'CheckpointCancelledError' });
  assert.equal(f.writes.length, 0); f.readGate = undefined;
  const fresh = await f.repository.records!.load(); await f.repository.records!.saveCheckpoint(fresh, 'key', cursor); assert.equal(f.writes.length, 1);
});

test('repeat-anchor A-B-A cancellation cannot save a checkpoint', async () => {
  const f = fixture([record('a'), record('b', 'syscoin', OTHER)]), owner = await WatchOnlyAuthority.openRecords(f.options), gate = deferred<void>(); owner.unlock();
  f.blockFetchAt = 44; f.fetchGate = gate.promise; const run = owner.refresh(); await f.fetchEntered.promise;
  owner.selectAccount('b'); owner.selectAccount('a'); gate.resolve(); await run;
  assert.equal(f.writes.length, 0); assert.equal(owner.getSnapshot().accountObservation?.totals, null);
});

test('an old cancelled response cannot overwrite a later successful refresh', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options), gate = deferred<void>(); owner.unlock();
  f.fetchGate = gate.promise; const old = owner.refresh(); await f.fetchEntered.promise; owner.cancelRefresh(); await old;
  f.fetchGate = undefined; await owner.refresh(); const current = owner.getSnapshot(); gate.resolve();
  await new Promise((r) => setImmediate(r)); assert.equal(owner.getSnapshot(), current); assert.equal(f.writes.length, 1);
});

test('late derived-index mismatch invalidates the entire observation without a checkpoint', async () => {
  const f = fixture(); const owner = await WatchOnlyAuthority.openRecords({ ...f.options, bindPublicAccount({ networkId, canonicalKey }) {
    return { derive({ branch, index }) { return { ...derive(networkId, canonicalKey, branch, index), index: index ? index + 1 : index }; } };
  } }); owner.unlock(); await owner.refresh();
  assert.equal(owner.getSnapshot().accountObservation?.status, 'unavailable'); assert.equal(f.writes.length, 0);
});

test('cancellation inside a validation callback stops later callbacks and the guarded write', async () => {
  let raw = JSON.stringify({ version: 2, records: [record()] }), active = true, armed = false, calls = 0, writes = 0;
  const repository = createPublicAccountStorage({ get: async () => raw, async set(_key, value) { writes++; raw = value; } }, {
    canonicalize(request) { calls++; if (armed) active = false; return adapter.canonicalize(request); },
    deriveFirstReceive(request) { calls++; return adapter.deriveFirstReceive(request); },
  });
  const snapshot = await repository.records!.load(), before = calls; armed = true;
  const cursor = { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' }, branches: [{ nextIndex: 0, lastUsedIndex: -1 }, { nextIndex: 0, lastUsedIndex: -1 }] };
  await assert.rejects(repository.records!.saveCheckpoint(snapshot, 'key', cursor, () => { if (!active) throw Error('stale'); }), { name: 'CheckpointCancelledError' });
  assert.equal(calls - before, 1); assert.equal(writes, 0);
});

test('fixed BIP84 network rejects incompatible selection without changing context', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  const before = owner.getSnapshot(); assert.throws(() => owner.selectNetwork('syscoin'));
  assert.equal(owner.getSnapshot(), before); assert.equal(f.calls.length, 0);
});

test('a high restored checkpoint remains a hint and cold refresh starts at zero', async () => {
  const initial = { ...record(), checkpoint: { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' }, branches: [{ nextIndex: 4000, lastUsedIndex: 3999 }, { nextIndex: 3000, lastUsedIndex: 2999 }] } };
  const f = fixture([initial]), indices: number[] = [];
  const owner = await WatchOnlyAuthority.openRecords({ ...f.options, bindPublicAccount({ networkId, canonicalKey }) {
    return { derive({ branch, index }) { indices.push(index); return derive(networkId, canonicalKey, branch, index); } };
  } }); owner.unlock(); await owner.refresh();
  assert.deepEqual(indices.slice(0, 3), [0, 0, 0]); // admission plus both branches
  assert.equal(owner.getSnapshot().accountObservation?.observedAddresses, 40);
});

test('factory cancellation during binding rejects admission without retaining a listener', async () => {
  const f = fixture(), abort = new AbortController();
  await assert.rejects(WatchOnlyAuthority.openRecords({ ...f.options, signal: abort.signal, bindPublicAccount(request) {
    abort.abort(); return f.options.bindPublicAccount(request);
  } }), /cancelled/);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});

for (const callback of ['first canonicalization', 'second canonicalization', 'first address'] as const) {
  test(`exceptional callback cancellation during ${callback} keeps unchanged sibling records usable`, async () => {
    let raw = JSON.stringify({ version: 2, records: [record()] });
    const original = raw;
    let reads = 0, writes = 0, canonicalizations = 0, active = true, armed = true;
    const revokeAndThrow = () => { armed = false; active = false; throw Error('fixture callback failed after cancellation'); };
    const repository = createPublicAccountStorage({
      async get() { reads++; canonicalizations = 0; return raw; },
      async set(_key, value) { writes++; raw = value; },
    }, {
      canonicalize(request) {
        canonicalizations++;
        if (armed && reads === 3 && (callback === 'first canonicalization' && canonicalizations === 1 ||
            callback === 'second canonicalization' && canonicalizations === 2)) revokeAndThrow();
        return adapter.canonicalize(request);
      },
      deriveFirstReceive(request) {
        if (armed && reads === 3 && callback === 'first address') revokeAndThrow();
        return adapter.deriveFirstReceive(request);
      },
    }).records!;
    const first = await repository.load(), sibling = await repository.load();
    const cursor = { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' },
      branches: [{ nextIndex: 20, lastUsedIndex: -1 }, { nextIndex: 20, lastUsedIndex: -1 }] };
    await assert.rejects(repository.saveCheckpoint(first, 'key', cursor, () => {
      if (!active) throw Error('cancelled');
    }), { name: 'CheckpointCancelledError' });
    assert.equal(writes, 0); assert.equal(raw, original);
    active = true;
    await repository.saveCheckpoint(sibling, 'key', cursor);
    assert.equal(writes, 1);
    await assert.rejects(repository.saveCheckpoint(first, 'key', cursor), /Reopen/);
    assert.equal(writes, 1);
  });
}

test('a validation callback failure while current still refuses all writes until reread', async () => {
  let raw = JSON.stringify({ version: 2, records: [record()] }), reads = 0, writes = 0, armed = true;
  const repository = createPublicAccountStorage({
    async get() { reads++; return raw; },
    async set(_key, value) { writes++; raw = value; },
  }, {
    ...adapter,
    canonicalize(request) {
      if (armed && reads === 3) { armed = false; throw Error('fixture validation failed'); }
      return adapter.canonicalize(request);
    },
  }).records!;
  const first = await repository.load(), sibling = await repository.load();
  const cursor = { version: 1 as const, scope: { networkId: 'bitcoin' as const, sourceId: 'key' },
    branches: [{ nextIndex: 20, lastUsedIndex: -1 }, { nextIndex: 20, lastUsedIndex: -1 }] };
  await assert.rejects(repository.saveCheckpoint(first, 'key', cursor, () => undefined), /Invalid saved watch account records/);
  await assert.rejects(repository.saveCheckpoint(sibling, 'key', cursor), /unavailable/);
  assert.equal(writes, 0);
  await repository.saveCheckpoint(await repository.load(), 'key', cursor);
  assert.equal(writes, 1);
});
