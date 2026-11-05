import assert from 'node:assert/strict';
import test from 'node:test';
import { createWatchAccount, createEvmWatchAccount, validatePublicAccounts, WatchOnlyAuthority, type BalanceReader } from '../src/core/watchOnlyAuthority.ts';
import { WatchAccounts } from '../src/core/watchAccounts.ts';
import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { getUtxoNetwork, type UtxoNetworkId } from '../src/core/utxoNetworks.ts';
import type { UtxoBalance } from '../src/core/utxoBalanceReader.ts';

const ETH = '0x52908400098527886E0F7030069857D2E4169EE7';
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SYS = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
const mapped = { id: 'mapped', name: 'Mapped account', addresses: { ethereum: ETH, base: '0x1111111111111111111111111111111111111111' } };
const sys = createWatchAccount('sys', 'Syscoin watch', SYS, 'syscoin');
const btc = createWatchAccount('btc', 'Bitcoin watch', BTC, 'bitcoin');
const observation = (network: UtxoNetworkId): UtxoBalance => ({ networkId: network, kind: 'utxo', chainId: getUtxoNetwork(network).chainId,
  genesisHash: getUtxoNetwork(network).genesisHash, confirmedUnits: '9007199254740993', pendingDeltaUnits: '-123', unconfirmedTransactions: 2, observedHeight: 123 });
const document = (accounts: readonly unknown[]) => ({ version: 1, records: accounts.map((account) => ({ kind: 'address', ...(account as object) })) });
function fixture(raw = JSON.stringify(document([mapped])), loseAck = false) {
  let saved = raw;
  let writes = 0;
  const repository = createPublicAccountStorage({ async get(key) { return key === PUBLIC_ACCOUNTS_KEY ? saved : null; },
    async set(key, value) { assert.equal(key, PUBLIC_ACCOUNTS_KEY); saved = value; writes++; if (loseAck) { loseAck = false; throw Error('Lost acknowledgement'); } } });
  const accounts = new WatchAccounts(repository.records);
  return { repository, accounts, get raw() { return saved; }, get writes() { return writes; }, replace(value: string) { saved = value; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }

test('public projection admits EVM mappings or a single fixed UTXO address without changing its shape', () => {
  const rows = validatePublicAccounts([mapped, sys, btc]);
  assert.deepEqual(rows, [mapped, sys, btc]);
  assert.deepEqual(Object.keys(sys), ['id', 'name', 'addresses']);
  assert.deepEqual(Object.keys(sys.addresses), ['syscoin']); assert.deepEqual(Object.keys(btc.addresses), ['bitcoin']);
  assert.equal(Object.isFrozen(sys.addresses), true);
  assert.deepEqual(createWatchAccount('evm', 'EVM', ETH), createEvmWatchAccount('evm', 'EVM', ETH));
  assert.equal(createWatchAccount('upper', 'Bitcoin', BTC.toUpperCase(), 'bitcoin').addresses.bitcoin, BTC);
});

test('mixed families, multiple UTXO mappings, mismatched addresses and private fields are rejected', () => {
  for (const addresses of [{ syscoin: SYS, bitcoin: BTC }, { ethereum: ETH, syscoin: SYS }, { bitcoin: ETH },
    { bitcoin: SYS }, { bitcoin: BTC, unknown: BTC }, { 'syscoin-nevm': SYS }])
    assert.throws(() => validatePublicAccounts([{ id: 'bad', name: 'Bad', addresses }]));
  for (const secret of ['privateKey', 'xprv', 'envelope', 'accountType'])
    assert.throws(() => validatePublicAccounts([{ ...sys, [secret]: 'not public data' }]));
  assert.throws(() => createWatchAccount('bad', 'Bad', BTC, 'syscoin'));
  assert.throws(() => createWatchAccount('bad', 'Bad', SYS, 'bitcoin'));
  assert.throws(() => createWatchAccount('bad', 'Bad', SYS, 'unknown' as UtxoNetworkId));
});

test('untrusted public records reject accessors and nonenumerable/symbol data without evaluating it', () => {
  let reads = 0;
  const addressGetter = { bitcoin: BTC };
  Object.defineProperty(addressGetter, 'bitcoin', { enumerable: true, get() { reads++; return BTC; } });
  assert.throws(() => validatePublicAccounts([{ ...btc, addresses: addressGetter }]));
  const record = { ...btc };
  Object.defineProperty(record, 'id', { enumerable: false, get() { reads++; return 'btc'; } });
  assert.throws(() => validatePublicAccounts([record]));
  assert.throws(() => validatePublicAccounts([{ ...btc, [Symbol('hidden')]: 'data' }]));
  assert.equal(reads, 0);
});

test('existing repository/controller retains canonical rows and writes both UTXO families', async () => {
  const raw = JSON.stringify(document([mapped]), null, 2);
  const f = fixture(raw); await f.accounts.load();
  assert.equal(f.raw, raw); assert.equal(f.writes, 0);
  await f.accounts.change({ kind: 'add', id: sys.id, name: sys.name, address: SYS, network: 'syscoin' });
  await f.accounts.change({ kind: 'add', id: btc.id, name: btc.name, address: BTC, network: 'bitcoin' });
  assert.deepEqual(JSON.parse(f.raw), document([mapped, sys, btc]));
  assert.deepEqual(await f.repository.loadAccounts(), [mapped, sys, btc]);
  assert.equal(f.accounts.getSnapshot().status, 'ready');
  assert.equal(f.raw.includes('privateKey'), false);
  await f.accounts.change({ kind: 'rename', id: sys.id, name: 'Renamed SYS' });
  await f.accounts.change({ kind: 'remove', id: btc.id });
  assert.deepEqual((await f.repository.loadAccounts())[0], mapped);
  assert.equal((await f.repository.loadAccounts())[1]!.name, 'Renamed SYS');
});

test('duplicate checks bind address to its actual network mapping and preserve mapped EVM subsets', async () => {
  const f = fixture(); await f.accounts.load();
  await assert.rejects(f.accounts.change({ kind: 'add', id: 'dup-evm', name: 'Duplicate', address: mapped.addresses.base }), /already/);
  await f.accounts.change({ kind: 'add', id: sys.id, name: sys.name, address: SYS, network: 'syscoin' });
  const before = f.raw;
  await assert.rejects(f.accounts.change({ kind: 'add', id: 'dup-sys', name: 'Duplicate', address: SYS.toUpperCase(), network: 'syscoin' }), /already/);
  assert.equal(f.raw, before);
  await f.accounts.change({ kind: 'add', id: btc.id, name: btc.name, address: BTC, network: 'bitcoin' });
  assert.equal(f.accounts.getSnapshot().accounts.length, 3);
});

test('malformed saved mixed-family data cannot be dropped or overwritten', async () => {
  const raw = JSON.stringify(document([{ ...sys, addresses: { ...sys.addresses, ethereum: ETH } }]));
  const f = fixture(raw); await assert.rejects(f.accounts.load());
  assert.equal(f.accounts.getSnapshot().status, 'unavailable');
  await assert.rejects(f.accounts.change({ kind: 'add', id: 'new', name: 'New', address: BTC, network: 'bitcoin' }), /Reopen/);
  assert.equal(f.raw, raw); assert.equal(f.writes, 0);
});

test('lost public write acknowledgement requires reopening and recovers committed UTXO data', async () => {
  const f = fixture(undefined, true); await f.accounts.load();
  await assert.rejects(f.accounts.change({ kind: 'add', id: sys.id, name: sys.name, address: SYS, network: 'syscoin' }), /verified/);
  assert.equal(f.accounts.getSnapshot().status, 'unavailable');
  await assert.rejects(f.accounts.change({ kind: 'remove', id: 'mapped' }), /Reopen/);
  assert.equal(f.writes, 1);
  await f.accounts.load(); assert.deepEqual(f.accounts.getSnapshot().accounts, [mapped, sys]);
});

test('external record changes and competing saves cannot be silently replaced by a stale UTXO snapshot', async () => {
  const f = fixture(); await f.accounts.load(); const expected = await f.repository.records.load();
  f.replace(JSON.stringify(document([mapped, btc])));
  await assert.rejects(f.accounts.change({ kind: 'add', id: sys.id, name: sys.name, address: SYS, network: 'syscoin' }), /verified/);
  assert.equal(f.writes, 0); assert.deepEqual(await f.repository.loadAccounts(), [mapped, btc]);
  await assert.rejects(f.repository.records.compareAndSet(expected, [{ kind: 'address', ...mapped }, { kind: 'address', ...sys }]), /Reopen|changed/);
});

test('optional add-network input rejects coercion, getters and private fields before storage', async () => {
  const f = fixture(); await f.accounts.load(); let reads = 0;
  const input = { kind: 'add' as const, id: 'new', name: 'New', address: SYS, network: 'syscoin' as const };
  const getter = { ...input }; Object.defineProperty(getter, 'network', { enumerable: true, get() { reads++; return 'syscoin'; } });
  const hiddenKind = { ...input }; Object.defineProperty(hiddenKind, 'kind', { enumerable: false, get() { reads++; return 'add'; } });
  for (const bad of [getter, hiddenKind, { ...input, network: {} }, { ...input, privateKey: 'private' }, { ...input, network: 'bitcoin' }])
    await assert.rejects(f.accounts.change(bad as typeof input));
  assert.equal(reads, 0); assert.equal(f.writes, 0); assert.equal(f.accounts.getSnapshot().status, 'ready');
});

test('one watch authority routes EVM and UTXO separately and retains confirmed versus pending units', async () => {
  const calls: string[] = [];
  const reader: BalanceReader = { async readBalance(n) { calls.push(n); return { chainId: 1, units: '0' }; },
    async readUtxoBalance(n, address) { calls.push(n); assert.equal(address, n === 'syscoin' ? SYS : BTC); return observation(n); } };
  const authority = new WatchOnlyAuthority([mapped, sys, btc], reader, () => 500);
  authority.unlock(); await authority.refresh(); assert.deepEqual(authority.getSnapshot().balance, { status: 'available', units: '0', updatedAt: 500 });
  for (const account of [sys, btc]) {
    authority.selectAccount(account.id); await authority.refresh();
    const balance = authority.getSnapshot().balance;
    assert.deepEqual(balance, { status: 'available', kind: 'utxo', units: '9007199254740993', pendingDeltaUnits: '-123', unconfirmedTransactions: 2, observedHeight: 123, updatedAt: 500 });
    assert.equal(authority.getSnapshot().capabilities.send, false);
    await assert.rejects(authority.prepareTransfer({ recipient: ETH, amount: '1' }), /SIGNING_UNAVAILABLE/);
  }
  assert.deepEqual(calls, ['ethereum', 'syscoin', 'bitcoin']);
});

test('missing UTXO adapter and malformed/forged observations remain unavailable rather than zero', async () => {
  const missing = new WatchOnlyAuthority([btc], { async readBalance() { throw Error('EVM must not run'); } });
  missing.unlock(); await missing.refresh(); assert.equal(missing.getSnapshot().balance.status, 'error');
  const good = observation('bitcoin');
  for (const value of [undefined, { ...good, networkId: 'syscoin' }, { ...good, chainId: 57 }, { ...good, genesisHash: '0'.repeat(64) },
    { ...good, pendingDeltaUnits: undefined }, { ...good, pendingDeltaUnits: 0 }, { ...good, pendingDeltaUnits: '-0' },
    { ...good, confirmedUnits: '-1' }, { ...good, confirmedUnits: '1e8' }, { ...good, confirmedUnits: '9'.repeat(78) },
    { ...good, unconfirmedTransactions: -1 }, { ...good, observedHeight: NaN }, { ...good, privateKey: 'private' }]) {
    const authority = new WatchOnlyAuthority([btc], { async readBalance() { throw Error('not EVM'); }, async readUtxoBalance() { return value as UtxoBalance; } });
    authority.unlock(); await authority.refresh(); assert.equal(authority.getSnapshot().balance.status, 'error');
  }
});

test('valid UTXO zero remains known while its signed pending delta is preserved', async () => {
  const authority = new WatchOnlyAuthority([sys], { async readBalance() { throw Error('not EVM'); },
    async readUtxoBalance() { return { ...observation('syscoin'), confirmedUnits: '0', pendingDeltaUnits: '17' }; } });
  authority.unlock(); await authority.refresh();
  const result = authority.getSnapshot().balance;
  assert.equal(result.status, 'available');
  if (result.status === 'available' && 'kind' in result) { assert.equal(result.units, '0'); assert.equal(result.pendingDeltaUnits, '17'); }
  else assert.fail('Missing typed UTXO observation');
});

test('nonenumerable UTXO observation accessors cannot execute in the public controller', async () => {
  let reads = 0;
  const value = observation('bitcoin');
  Object.defineProperty(value, 'kind', { enumerable: false, get() { reads++; return 'utxo'; } });
  const authority = new WatchOnlyAuthority([btc], { async readBalance() { throw Error('not EVM'); }, async readUtxoBalance() { return value; } });
  authority.unlock(); await authority.refresh();
  assert.equal(authority.getSnapshot().balance.status, 'error'); assert.equal(reads, 0);
});

test('account A-B-A and privacy lock discard late UTXO results and revoke receive', async () => {
  const late = deferred<UtxoBalance>(); const signals: AbortSignal[] = [];
  const authority = new WatchOnlyAuthority([sys, btc], { async readBalance() { throw Error('not EVM'); },
    readUtxoBalance(n, _address, signal) { signals.push(signal); return n === 'syscoin' ? late.promise : Promise.resolve(observation('bitcoin')); } });
  authority.unlock(); const pending = authority.refresh();
  authority.selectAccount('btc'); await authority.refresh(); authority.selectAccount('sys');
  late.resolve(observation('syscoin')); await pending;
  assert.equal(signals[0]!.aborted, true); assert.equal(authority.getSnapshot().balance.status, 'unknown');
  const locked = deferred<UtxoBalance>();
  const other = new WatchOnlyAuthority([sys], { async readBalance() { throw Error('not EVM'); }, readUtxoBalance: () => locked.promise });
  other.unlock(); const request = other.refresh(); other.lock(); locked.resolve(observation('syscoin')); await request;
  assert.equal(other.getSnapshot().status, 'locked'); assert.equal(other.getSnapshot().balance.status, 'unknown');
  assert.equal(other.getSnapshot().capabilities.receive, false);
});
