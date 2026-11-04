import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicAccountStorage } from '../src/core/publicAccountStorage.ts';
import { WatchOnlyAuthority, createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { createUtxoBalanceReader } from '../src/core/utxoBalanceReader.ts';
import { getUtxoNetwork, type UtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { type StoredWatchAccount } from '../src/core/watchAccountCodec.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { XPUB, keyRecord, deferred, json, metadata } from './publicWatchFixtures.ts';
function fixture(records: readonly StoredWatchAccount[] = [keyRecord()]) {
  let raw = JSON.stringify({ version: 1, records }), fail = false, gate: Promise<void> | undefined;
  const entered = deferred<void>(), calls: { url: string; signal?: AbortSignal | null }[] = [], writes: string[] = [];
  const storage = createPublicAccountStorage({ async get() { if (fail) throw Error('unavailable'); return raw; }, async set(_key, value) { writes.push(value); raw = value; } });
  const balance = createUtxoBalanceReader({ async fetch(url, init) {
    calls.push({ url, signal: init.signal });
    const id: UtxoNetworkId = url.startsWith(getUtxoNetwork('bitcoin').endpoint) ? 'bitcoin' : 'syscoin';
    if (url.endsWith('/api/')) return json(metadata(id));
    if (url.includes('/block-index/')) return json({ blockHash: getUtxoNetwork(id).genesisHash });
    entered.resolve(); if (gate) await gate;
    const address = decodeURIComponent(url.split('/xpub/')[1]!.split('?')[0]!);
    return json({ address, balance: '12345678901234567890', unconfirmedBalance: '-23', unconfirmedTxs: 1 });
  } });
  const options = { repository: storage.records, reader: { readBalance: async () => ({ chainId: 1, units: '7' }), readUtxoAccount: balance.readAccount }, signal: new AbortController().signal };
  return { options, calls, writes, entered, set gate(value: Promise<void> | undefined) { gate = value; }, set fail(value: boolean) { fail = value; }, get raw() { return raw; }, set raw(value: string) { raw = value; } };
}
for (const id of ['bitcoin', 'syscoin'] as const) {
  test(`${id} account refresh uses actual SJS xpub query once and exact Blockbook aggregate balance`, async () => {
    const f = fixture([keyRecord('key', id)]), owner = await WatchOnlyAuthority.openRecords(f.options);
    assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); owner.unlock(); await owner.refresh();
    const observed = owner.getSnapshot().balance;
    assert.deepEqual(observed, { status: 'available', kind: 'utxo', units: '12345678901234567890', pendingDeltaUnits: '-23', unconfirmedTransactions: 1, observedHeight: 123, updatedAt: observed.status === 'available' ? observed.updatedAt : 0 });
    const identifier = parseUtxoPublicIdentifier(XPUB, id).identifier;
    assert.equal(f.calls[2]?.url, `${getUtxoNetwork(id).endpoint}/api/v2/xpub/${identifier}?details=tokenBalances&tokens=nonzero`);
    assert.equal(f.calls.length, 3); assert.equal(f.writes.length, 0);
    assert.ok(!JSON.stringify(owner.getSnapshot()).includes(identifier));
    assert.equal(owner.getSnapshot().capabilities.send, false);
    await assert.rejects(owner.prepareTransfer({ recipient: owner.getSnapshot().accounts[0]!.addresses[id]!, amount: '1' }), /SIGNING_UNAVAILABLE/);
  });
}
test('public descriptor passes to existing Blockbook route without changing its script or path', async () => {
  const identifier = `sh(wpkh(${XPUB}/0/*))`, f = fixture([keyRecord('descriptor', 'bitcoin', identifier)]);
  const owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); await owner.refresh();
  assert.equal(f.calls[2]?.url, `${getUtxoNetwork('bitcoin').endpoint}/api/v2/xpub/${encodeURIComponent(identifier)}?details=tokenBalances&tokens=nonzero`);
  assert.equal(owner.getSnapshot().balance.status, 'available');
});
test('opening cancellation and corrupt storage dispatch no account query and do not write', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(WatchOnlyAuthority.openRecords({ ...f.options, signal: abort.signal }), /cancelled/);
  f.fail = true; await assert.rejects(WatchOnlyAuthority.openRecords(f.options));
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});
test('forged public projection fails before any read', async () => {
  const f = fixture(), record = keyRecord(), fake = createEvmWatchAccount('key', 'key', '0x1111111111111111111111111111111111111111');
  await assert.rejects(WatchOnlyAuthority.openRecords({ ...f.options, repository: { load: async () => ({ version: 1, records: [record], accounts: [fake] }) } }));
  assert.equal(f.calls.length, 0);
});
test('changed persisted source is rejected before disclosing the previous account key', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  f.raw = JSON.stringify({ version: 1, records: [keyRecord('key', 'bitcoin', `pkh(${XPUB}/0/*)`)] });
  await owner.refresh(); assert.equal(owner.getSnapshot().balance.status, 'error'); assert.equal(f.calls.length, 0);
});
test('observer lock at loading prevents even metadata dispatch', async () => {
  const f = fixture(), owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock();
  owner.subscribe((snapshot) => { if (snapshot.balance.status === 'loading') owner.lock(); });
  await owner.refresh(); assert.equal(owner.getSnapshot().status, 'locked'); assert.equal(f.calls.length, 0);
});
for (const action of ['lock', 'cancel', 'account-switch'] as const) {
  test(`${action} cancels pending account response with no stale aggregate or persistence`, async () => {
    const evm = createEvmWatchAccount('evm', 'EVM', '0x1111111111111111111111111111111111111111');
    const f = fixture([keyRecord(), { kind: 'address', ...evm }]), gate = deferred<void>(); f.gate = gate.promise;
    const owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); const pending = owner.refresh(); await f.entered.promise;
    if (action === 'lock') owner.lock(); else if (action === 'cancel') owner.cancelRefresh(); else { owner.selectAccount('evm'); owner.selectAccount('key'); }
    gate.resolve(); await pending;
    assert.equal(owner.getSnapshot().balance.status, 'unknown'); assert.equal(f.writes.length, 0); assert.ok(f.calls.every((call) => call.signal?.aborted));
  });
}
test('superseding refresh discards old results and retains newest account balance', async () => {
  const f = fixture(), gate = deferred<void>(); f.gate = gate.promise;
  const owner = await WatchOnlyAuthority.openRecords(f.options); owner.unlock(); const first = owner.refresh(); await f.entered.promise;
  f.gate = undefined; await owner.refresh(); gate.resolve(); await first;
  assert.equal(owner.getSnapshot().balance.status, 'available'); assert.equal(f.calls.length, 6); assert.equal(f.writes.length, 0);
});
test('the address constructor remains address-only and does not gain account signing authority', async () => {
  let read = 0; const account = createEvmWatchAccount('public', 'Public', '0x1111111111111111111111111111111111111111');
  const owner = new WatchOnlyAuthority([account], { readBalance: async () => { read++; return { chainId: 1, units: '0' }; } });
  owner.unlock(); await owner.refresh(); assert.equal(read, 1); assert.equal('accountObservation' in owner.getSnapshot(), false); assert.equal(owner.getSnapshot().capabilities.send, false);
});
