import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvmWatchAccount, getWatchNetworks, validatePublicAccounts, WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const SECOND_ADDRESS = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const NETWORK_IDS = ['arbitrum', 'base', 'ethereum', 'rollux', 'syscoin-nevm', 'syscoin-nevm-testnet', 'zksys-testnet'];

test('a new EVM watch account can select every offered registered network without signing authority', () => {
  const account = createEvmWatchAccount('watch_fixture', 'Observed account', ADDRESS.toLowerCase());
  assert.deepEqual(getWatchNetworks(account).map((network) => network.id).sort(), NETWORK_IDS);
  assert.equal(new Set(Object.values(account.addresses)).size, 1);
  assert.equal(account.addresses.ethereum, ADDRESS);
  let calls = 0;
  const authority = new WatchOnlyAuthority([account], { readBalance: async () => { calls++; throw new Error('No RPC expected'); } });
  assert.equal(authority.getSnapshot().selectedNetworkId, 'ethereum');
  authority.unlock();
  for (const network of getWatchNetworks(account)) {
    authority.selectNetwork(network.id);
    assert.equal(authority.getSnapshot().selectedNetworkId, network.id);
    assert.equal(authority.getSnapshot().capabilities.send, false);
    assert.equal(authority.getSnapshot().capabilities.receive, true);
  }
  assert.equal(calls, 0);
});

test('legacy subset records expose only their actual mappings without changing saved addresses', () => {
  const stored = { id: 'legacy', name: 'Existing account', addresses: { ethereum: ADDRESS, base: SECOND_ADDRESS } };
  const original = JSON.stringify(stored);
  const account = validatePublicAccounts([stored])[0]!;
  assert.deepEqual(getWatchNetworks(account).map((network) => network.id), ['ethereum', 'base']);
  assert.equal(account.addresses.base, SECOND_ADDRESS);
  assert.equal(JSON.stringify(stored), original);
  assert.equal(Object.keys(account.addresses).length, 2);
  assert.deepEqual(getWatchNetworks(undefined), []);
  const authority = new WatchOnlyAuthority([account], { readBalance: async () => { throw new Error('No RPC expected'); } });
  authority.unlock();
  const before = authority.getSnapshot();
  assert.throws(() => authority.selectNetwork('rollux'), /no address/);
  assert.equal(authority.getSnapshot().selectedNetworkId, before.selectedNetworkId);
  assert.equal(authority.getSnapshot().generation, before.generation);
});

test('new public account creation rejects invalid identifiers before any record is returned', () => {
  for (const value of ['0x' + '0'.repeat(40), '0x529084', 'abandon '.repeat(11) + 'about', ` ${ADDRESS}`]) {
    assert.throws(() => createEvmWatchAccount('watch_fixture', 'Observed account', value));
  }
  assert.throws(() => createEvmWatchAccount('invalid/id', 'Observed account', ADDRESS));
  assert.throws(() => createEvmWatchAccount('watch_fixture', ' ', ADDRESS));
});
