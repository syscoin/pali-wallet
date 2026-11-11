import { UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIdentity, nativeAccountSelection, parseAccountSelection, projectAccounts } from '../src/core/accountDirectory.ts';
import { WatchAccounts } from '../src/core/watchAccounts.ts';
import { createEvmWatchAccount, WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import type { PublicAccount } from '../src/core/types.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';
import { NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { createWatchAccountCodec, type StoredWatchAccount } from '../src/core/watchAccountCodec.ts';
import { XPUB, KEY } from './publicWatchFixtures.ts';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const OTHER = '0x1111111111111111111111111111111111111111';
const account = createEvmWatchAccount('public_1', 'Public account', ADDRESS);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
function storage(initial: readonly PublicAccount[] = [account], beforeWrite?: () => Promise<void>) {
  const codec = createWatchAccountCodec();
  let raw = codec.encode(codec.validate(initial.map((entry) => ({ kind: 'address', ...entry }))).records);
  const writes: readonly PublicAccount[][] = [];
  let readFailure = false;
  let writeFailure = false;
  const repository = createPublicAccountStorage({
    async get(key) { if (key !== PUBLIC_ACCOUNTS_KEY) return null; if (readFailure) throw Error('storage read failure'); return raw; },
    async set(_key, next) {
      await beforeWrite?.();
      if (writeFailure) throw Error('storage write failure');
      raw = next;
      (writes as PublicAccount[][]).push([...codec.decode(raw).accounts]);
    },
  });
  const model = new WatchAccounts(repository.records);
  return {
    model, writes, repository,
    get saved() { return codec.decode(raw).accounts; },
    get records() { return codec.decode(raw).records; },
    set readFailure(value: boolean) { readFailure = value; },
    set writeFailure(value: boolean) { writeFailure = value; },
  };
}

test('public chooser keeps authorities distinct even when local IDs and addresses collide', () => {
  const catalogue: NativeWalletCatalogueSnapshot = {
    revision: 0, networks: NATIVE_NETWORKS, utxoNetworks: UTXO_NETWORKS,
    active: { accountId: 'hd:60:0', networkId: 'ethereum' },
    accounts: [{ id: 'hd:60:0', type: 'HDAccount', slip44: 60, index: 0, label: 'Wallet', address: ADDRESS }],
  };
  // The projector never assumes its two independent inputs share an ID namespace.
  const collidingPublic = { ...account, id: 'hd:60:0' };
  const entries = projectAccounts(catalogue, [collidingPublic]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.address, entries[1]!.address);
  assert.notEqual(entries[0]!.identity, entries[1]!.identity);
  assert.equal(entries[0]!.identity, 'hd/hd:60:0');
  assert.equal(entries[1]!.identity, 'watch/hd:60:0');
  assert.equal(entries[0]!.capabilities.signing, 'native-unlock-required');
  assert.equal(entries[1]!.capabilities.signing, 'unavailable');
  assert.equal(entries[1]!.capabilities.recovery, 'unavailable');
  assert.equal(accountIdentity({ kind: 'watch', id: 'same' }), 'watch/same');
  assert.equal(Object.isFrozen(entries), true);
});

test('persisted selection is bounded navigation data, never capability or keyring state', () => {
  assert.deepEqual(parseAccountSelection({ kind: 'hd', id: 'hd:60:0' }), { kind: 'hd', id: 'hd:60:0' });
  assert.deepEqual(parseAccountSelection({ kind: 'watch', id: account.id }), { kind: 'watch', id: account.id });
  assert.equal(parseAccountSelection(null), null);
  for (const value of [undefined, [], {}, { kind: ['watch'], id: 'watch_1' },
    { kind: ['hd'], id: 'hd:60:0' }, { kind: 1, id: 'watch_1' }, { kind: 'HDAccount', id: 'hd:60:0' },
    { kind: 'hd', id: 'hd:60:0', unlocked: true }, { kind: 'watch', id: 'x'.repeat(65) },
    { kind: 'watch', id: '__proto__', capabilities: { signing: true } }, { kind: 'hd', id: 'hd:60:-1' }]) {
    assert.throws(() => parseAccountSelection(value));
  }
});

test('Trezor chooser identity stays hardware-specific without granting signing authority', () => {
  const catalogue: NativeWalletCatalogueSnapshot = {
    revision: 0, networks: NATIVE_NETWORKS, utxoNetworks: UTXO_NETWORKS,
    active: { accountId: 'trezor:60:0', networkId: 'ethereum' },
    accounts: [{ id: 'trezor:60:0', type: 'Trezor', slip44: 60, index: 0, label: 'Hardware', address: ADDRESS }],
  };
  const entry = projectAccounts(catalogue, [])[0]!;
  assert.deepEqual(entry.selection, { kind: 'trezor', id: 'trezor:60:0' });
  assert.deepEqual(nativeAccountSelection('trezor:60:0'), entry.selection);
  assert.deepEqual(parseAccountSelection(entry.selection), entry.selection);
  assert.equal(entry.capabilities.signing, 'hardware-connection-required');
  assert.throws(() => parseAccountSelection({ kind: 'smart', id: 'trezor:60:0' }));
  assert.throws(() => parseAccountSelection({ kind: 'trezor', id: 'hd:60:0' }));
});

test('a public storage read failure preserves known accounts and cannot overwrite them with an empty replacement', async () => {
  const f = storage();
  await f.model.load();
  f.readFailure = true;
  await assert.rejects(f.model.load(), /Nothing has been replaced/);
  assert.equal(f.model.getSnapshot().status, 'unavailable');
  assert.deepEqual(f.model.getSnapshot().accounts, [account]);
  await assert.rejects(f.model.change({ kind: 'add', id: 'new', name: 'New', address: OTHER }), /Reopen/);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.saved, [account]);
  f.readFailure = false;
  await f.model.load();
  assert.equal(f.model.getSnapshot().status, 'ready');
});

test('first-read failure never admits a mutation against the initial empty display', async () => {
  const f = storage();
  f.readFailure = true;
  await assert.rejects(f.model.load());
  assert.equal(f.model.getSnapshot().accounts.length, 0);
  await assert.rejects(f.model.change({ kind: 'remove', id: account.id }), /Reopen/);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.saved, [account]);
});

test('add, rename, and remove commit the existing public store and survive a new controller', async () => {
  const f = storage();
  await f.model.load();
  await f.model.change({ kind: 'add', id: 'public_2', name: '  Savings  ', address: OTHER });
  assert.equal(f.saved[1]!.name, 'Savings');
  assert.equal(f.saved[1]!.addresses.ethereum, OTHER);
  await f.model.change({ kind: 'rename', id: 'public_2', name: '  Renamed savings  ' });
  assert.equal(f.saved[1]!.name, 'Renamed savings');
  await f.model.change({ kind: 'remove', id: account.id });
  const reopened = new WatchAccounts(f.repository.records);
  await reopened.load();
  assert.deepEqual(reopened.getSnapshot().accounts.map(({ id, name }) => ({ id, name })), [{ id: 'public_2', name: 'Renamed savings' }]);
  assert.equal(f.writes.length, 3);
});

test('write failure quarantines public mutations until the persisted snapshot is reloaded', async () => {
  const f = storage();
  await f.model.load();
  f.writeFailure = true;
  await assert.rejects(f.model.change({ kind: 'rename', id: account.id, name: 'New name' }), /could not be verified/);
  assert.equal(f.model.getSnapshot().status, 'unavailable');
  assert.deepEqual(f.model.getSnapshot().accounts, [account]);
  f.writeFailure = false;
  await assert.rejects(f.model.change({ kind: 'remove', id: account.id }), /Reopen/);
  await f.model.load();
  await f.model.change({ kind: 'rename', id: account.id, name: 'New name' });
  assert.equal(f.saved[0]!.name, 'New name');
});

test('simultaneous mutations cannot race their compare-and-set or admit a stale rename', async () => {
  const gate = deferred<void>();
  const f = storage([account], () => gate.promise);
  const model = f.model;
  await model.load();
  const rename = model.change({ kind: 'rename', id: account.id, name: 'New name' });
  assert.equal(model.getSnapshot().busy, true);
  await assert.rejects(model.change({ kind: 'remove', id: account.id }), /still saving/);
  await assert.rejects(model.load(), /still saving/);
  gate.resolve();
  await rename;
  assert.equal(f.writes.length, 1);
  assert.equal(model.getSnapshot().accounts[0]!.name, 'New name');
});

test('adding, renaming and reopening a public account key retains its canonical source record', async () => {
  const f = storage();
  await f.model.load();
  await f.model.change({ kind: 'add', id: 'public_key', name: '  Bitcoin account  ', address: XPUB, network: 'bitcoin' });
  const source = f.records[1] as Extract<StoredWatchAccount, { kind: 'utxo-public' }>;
  assert.equal(source.kind, 'utxo-public');
  assert.equal(source.identifier, KEY);
  assert.equal(source.networkId, 'bitcoin');
  assert.ok(f.saved[1]!.addresses.bitcoin);
  assert.ok(!JSON.stringify(f.saved).includes(KEY));
  await f.model.change({ kind: 'rename', id: source.id, name: '  Cold wallet  ' });
  assert.deepEqual(f.records[1], { ...source, name: 'Cold wallet' });
  const reopened = new WatchAccounts(f.repository.records);
  await reopened.load();
  assert.equal(reopened.getSnapshot().accounts[1]!.name, 'Cold wallet');
  await reopened.change({ kind: 'remove', id: account.id });
  assert.deepEqual(f.records, [{ ...source, name: 'Cold wallet' }]);
});

test('watch lifecycle revocation aborts balances and late completions cannot restore a visible account or signing', async () => {
  const result = deferred<{ chainId: number; units: string }>();
  let signal: AbortSignal | undefined;
  const authority = new WatchOnlyAuthority([account], { readBalance: async (_network, _address, current) => { signal = current; return result.promise; } });
  authority.unlock();
  const pending = authority.refresh();
  authority.lock();
  assert.equal(signal!.aborted, true);
  result.resolve({ chainId: 1, units: '1000000000000000000' });
  await pending;
  assert.equal(authority.getSnapshot().status, 'locked');
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
  assert.equal(authority.getSnapshot().capabilities.send, false);
  await assert.rejects(authority.prepareTransfer({ recipient: OTHER, amount: '1' }), /SIGNING_UNAVAILABLE/);
  await assert.rejects(authority.confirmTransfer({} as never), /SIGNING_UNAVAILABLE/);
});

test('restored public selection remains locked with no balance query or native capability', async () => {
  let queries = 0;
  const second = createEvmWatchAccount('public_2', 'Second', OTHER);
  const authority = new WatchOnlyAuthority([account, second], { async readBalance() { queries++; return { chainId: 1, units: '0' }; } });
  authority.restoreSelection(second.id);
  assert.equal(authority.getSnapshot().status, 'locked');
  assert.equal(authority.getSnapshot().selectedAccountId, second.id);
  assert.equal(authority.getSnapshot().capabilities.receive, false);
  assert.equal(authority.getSnapshot().capabilities.send, false);
  assert.equal(queries, 0);
  await assert.rejects(authority.refresh(), /locked/);
  await assert.rejects(authority.prepareTransfer({ recipient: ADDRESS, amount: '1' }), /SIGNING_UNAVAILABLE/);
  authority.unlock();
  assert.throws(() => authority.restoreSelection(account.id));
});

test('a reentrant privacy lock never delivers the superseded ready snapshot to later observers', () => {
  const authority = new WatchOnlyAuthority([account], { async readBalance() { return { chainId: 1, units: '0' }; } });
  const later: string[] = [];
  authority.subscribe((snapshot) => { if (snapshot.status === 'ready') authority.lock(); });
  authority.subscribe((snapshot) => later.push(snapshot.status));
  authority.unlock();
  assert.deepEqual(later, ['locked']);
  assert.equal(authority.getSnapshot().status, 'locked');
});

test('Imported selection is advisory, kind-bound and separate from watch and HD identities', () => {
  const imported = parseAccountSelection({ kind: 'imported', id: 'imported:60:0' });
  assert.deepEqual(imported, { kind: 'imported', id: 'imported:60:0' });
  for (const kind of ['hd', 'imported'] as const) {
    const selection = { kind, id: `${kind}:60:4096` };
    assert.deepEqual(parseAccountSelection(selection), selection);
  }
  for (const selection of [{ kind: 'hd', id: 'imported:60:0' }, { kind: 'imported', id: 'hd:60:0' },
    { kind: 'imported', id: 'imported:60:9007199254740992' }, { kind: 'imported', id: 'imported:60:00' }])
    assert.throws(() => parseAccountSelection(selection));
});


test('smart accounts retain a distinct picker identity and receive-only capability', () => {
  const smart = { id: 'smart:60:0', index: 0, type: 'SmartAccount', slip44: 60, label: 'Smart', address: '0x1111111111111111111111111111111111111111', smartAccount: { chainId: 1, isDeployed: false, managementAddress: '0x2222222222222222222222222222222222222222' } } as const;
  const catalogue = { accounts: [smart] } as unknown as import('../src/custody/walletCatalogue.ts').NativeWalletCatalogueSnapshot;
  const entry = projectAccounts(catalogue, [])[0]!;
  assert.deepEqual(entry.selection, { kind: 'smart', id: smart.id });
  assert.equal(entry.identity, 'smart/smart:60:0');
  assert.equal(entry.capabilities.signing, 'unavailable');
  assert.deepEqual(parseAccountSelection(entry.selection), entry.selection);
  assert.throws(() => parseAccountSelection({ kind: 'hd', id: smart.id }));
  assert.throws(() => parseAccountSelection({ kind: 'imported', id: smart.id }));
});
