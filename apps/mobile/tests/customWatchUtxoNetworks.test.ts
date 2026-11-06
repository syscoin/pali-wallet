import assert from 'node:assert/strict';
import test from 'node:test';

import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';

import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY, WATCH_UTXO_NETWORKS_KEY, WatchUtxoNetworkReloadRequiredError } from '../src/core/publicAccountStorage.ts';
import { createUtxoActivityReader } from '../src/core/utxoActivity.ts';
import { createUtxoBalanceReader } from '../src/core/utxoBalanceReader.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { getUtxoNetwork, isCustomUtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { WatchAccounts } from '../src/core/watchAccounts.ts';
import { WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import { deferred, json, KEY, XPUB } from './publicWatchFixtures.ts';

const ltc = findUtxoCoinByRegistration({ chainId: 2, slip44: 2 })!;
const btc = findUtxoCoinByRegistration({ chainId: 0, slip44: 0 })!;
const bitcoin = getUtxoNetwork('bitcoin');
const alternativeBitcoin = 'https://bitcoin-alternate.invalid/blockbook';
const first = 'https://ltc-one.invalid/blockbook';
const second = 'https://ltc-two.invalid/blockbook';
const stale = 'https://ltc-stale.invalid/blockbook';
const signal = () => new AbortController().signal;
const draft = (endpoint: string) => ({ endpoint, explorer: '', name: '' });
const txid = 'a'.repeat(64);
const summary = { txid, blockHeight: 100, blockHash: 'b'.repeat(64), blockTime: 1700000000, confirmations: 2,
  fees: '10', addressValueIn: '0', addressValueOut: '100', vin: [], vout: [] };

function fixture() {
  const raw = new Map<string, string>();
  const calls: string[] = [];
  let metadataGate: { endpoint: string; entered(): void; release: Promise<void> } | undefined;
  let badGenesis = false, backendChain = 'main';
  let details: { entered(): void; release: Promise<void>; subscribe(): void } | undefined;
  const fetch = async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(init.method, 'GET');
    const endpoint = [first, second, stale, alternativeBitcoin, bitcoin.endpoint].find((base) => url.startsWith(base + '/api/v2/'));
    assert.ok(endpoint);
    const coin = endpoint === bitcoin.endpoint || endpoint === alternativeBitcoin ? btc : ltc;
    if (url === endpoint + '/api/v2/') {
      const gate = metadataGate;
      if (gate?.endpoint === endpoint) { gate.entered(); await gate.release; }
      return json({ blockbook: { coin: coin.coinShortcut, network: coin.coinShortcut.toLowerCase(), decimals: coin.decimals,
        initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 123 },
      backend: { chain: backendChain } });
    }
    if (url === endpoint + '/api/v2/block-index/0') return json({ blockHash: badGenesis ? '0'.repeat(64) : coin.hashGenesisBlock });
    if (url === endpoint + '/api/v2/tx/' + txid && details) {
      details.entered();
      await details.release;
      return json(summary);
    }
    const account = new URL(url).pathname.split('/xpub/')[1];
    assert.ok(account);
    const address = decodeURIComponent(account);
    if (new URL(url).searchParams.get('details') === 'tokenBalances')
      return json({ address, balance: '9007199254740993', unconfirmedBalance: '-11', unconfirmedTxs: 1 });
    return json({ address, txs: details ? 1 : 0, unconfirmedTxs: 0, page: 1, totalPages: 1, transactions: details ? [summary] : [] });
  };
  const port = { get: async (key: string) => raw.get(key) ?? null, set: async (key: string, value: string) => { raw.set(key, value); } };
  const storage = createPublicAccountStorage(port, fetch);
  const balance = createUtxoBalanceReader({ fetch });
  const reader = { readBalance: async () => ({ chainId: 1, units: '7' }), readUtxoBalance: balance.readBalance, readUtxoAccount: balance.readAccount };
  const history = createUtxoActivityReader({ fetch });
  const historyReader = { ...history, readDetail(...args: Parameters<typeof history.readDetail>) {
    const request = history.readDetail(...args);
    details?.subscribe();
    return request;
  } };
  const open = (repository = storage.records) => WatchOnlyAuthority.openRecords({ repository, reader, historyReader, signal: signal() });
  return { raw, calls, port, fetch, storage, open,
    holdDetail() {
      const entered = deferred<void>(), release = deferred<void>(), secondViewer = deferred<void>();
      let viewers = 0;
      details = { entered: entered.resolve, release: release.promise, subscribe: () => { if (++viewers === 2) secondViewer.resolve(); } };
      return { entered: entered.promise, secondViewer: secondViewer.promise, release: release.resolve };
    },
    wrongGenesis() { badGenesis = true; },
    switchBackend() { backendChain = 'unexpected'; },
    hold(endpoint: string) {
      const entered = deferred<void>(), release = deferred<void>();
      metadataGate = { endpoint, entered: entered.resolve, release: release.promise };
      return { entered: entered.promise, release: () => { metadataGate = undefined; release.resolve(); } };
    },
  };
}

async function addWatchAccount(f: ReturnType<typeof fixture>) {
  const registry = f.storage.utxoNetworkSettings;
  const saved = await registry.save(await registry.load(), draft(first), signal());
  const id = saved.networks.find(({ endpoint }) => endpoint === first)!.id;
  assert.ok(isCustomUtxoNetworkId(id));
  const watches = new WatchAccounts(f.storage.records);
  await watches.load();
  await watches.change({ kind: 'add', id: 'ltc', name: 'LTC watch', network: id, address: XPUB });
  return { saved, watches, registry, id };
}

test('registers non-default SDK Litecoin and reopens the exact watch balance and activity scope', async () => {
  const f = fixture();
  const { saved, id } = await addWatchAccount(f);
  assert.deepEqual(f.calls, [first + '/api/v2/', first + '/api/v2/block-index/0']);
  const network = getUtxoNetwork(id, saved.networks);
  assert.equal(network.genesisHash, ltc.hashGenesisBlock);
  const identifier = parseUtxoPublicIdentifier(XPUB, network);
  assert.match(identifier.address, /^ltc1/);
  const reopened = createPublicAccountStorage(f.port, f.fetch);
  const owner = await f.open(reopened.records);
  owner.unlock();
  assert.equal(owner.getNetwork(id).symbol, 'LTC');
  assert.equal(owner.getSnapshot().accounts[0]?.addresses[id], identifier.address);
  assert.equal(owner.getSnapshot().capabilities.send, false);
  await owner.refresh();
  const balance = owner.getSnapshot().balance;
  assert.equal(balance.status === 'available' ? balance.units : '', '9007199254740993');
  assert.match(f.calls.at(-1)!, new RegExp('/api/v2/xpub/' + KEY));
  assert.deepEqual((await owner.readUtxoActivityPage({ page: 1 }, signal())).rows, []);
  assert.match(f.calls.at(-1)!, new RegExp('/api/v2/xpub/' + KEY));
  assert.deepEqual(Object.keys(JSON.parse(f.raw.get(PUBLIC_ACCOUNTS_KEY)!)), ['version', 'records']);
  assert.equal(JSON.stringify(owner.getSnapshot()).includes(KEY), false);

  const beforeMismatch = f.calls.length;
  f.wrongGenesis();
  await owner.refresh();
  assert.equal(owner.getSnapshot().balance.status, 'error');
  assert.deepEqual(f.calls.slice(beforeMismatch), [first + '/api/v2/', first + '/api/v2/block-index/0']);

  f.raw.delete(WATCH_UTXO_NETWORKS_KEY);
  const beforeMissing = f.calls.length;
  await assert.rejects(f.open(reopened.records), /could not be opened/);
  assert.equal(f.calls.length, beforeMissing);
});

test('keeps a custom Bitcoin provider separate from the unchanged preset and requires read authority', async () => {
  const f = fixture(), registry = f.storage.utxoNetworkSettings;
  const settings = await registry.save(await registry.load(), draft(alternativeBitcoin), signal());
  const custom = settings.networks.find(({ endpoint }) => endpoint === alternativeBitcoin)!;
  assert.equal(custom.name, 'Bitcoin');
  assert.ok(isCustomUtxoNetworkId(custom.id));
  assert.equal(custom.chainId, bitcoin.chainId);
  assert.equal(custom.genesisHash, bitcoin.genesisHash);
  assert.equal(getUtxoNetwork('bitcoin', settings.networks), bitcoin);

  const directReader = createUtxoBalanceReader({ fetch: f.fetch });
  const beforeUnowned = f.calls.length;
  await assert.rejects(directReader.readAccount(custom, XPUB, signal()), { code: 'INVALID_INPUT' });
  assert.equal(f.calls.length, beforeUnowned);

  const watches = new WatchAccounts(f.storage.records);
  await watches.load();
  await watches.change({ kind: 'add', id: 'custom', name: 'Custom Bitcoin', network: custom.id, address: XPUB });
  await watches.change({ kind: 'add', id: 'preset', name: 'Preset Bitcoin', network: 'bitcoin', address: XPUB });
  const owner = await f.open();
  owner.unlock();
  await owner.refresh();
  assert.ok(f.calls.at(-1)?.startsWith(alternativeBitcoin + '/api/v2/xpub/'));
  owner.selectAccount('preset');
  await owner.refresh();
  assert.ok(f.calls.at(-1)?.startsWith(bitcoin.endpoint + '/api/v2/xpub/'));
  const [, presetAccount] = owner.getSnapshot().accounts;
  assert.ok(presetAccount?.addresses.bitcoin);
  assert.equal(owner.getSnapshot().accounts[0]?.addresses[custom.id], presetAccount.addresses.bitcoin);

  await assert.rejects(WatchOnlyAuthority.openRecords({
    repository: { load: f.storage.records.load } as typeof f.storage.records,
    reader: { readBalance: async () => ({ chainId: 1, units: '0' }) },
    signal: signal(),
  }));
});

test('rejects a wrong genesis without persisting or looking up any account', async () => {
  const f = fixture(), registry = f.storage.utxoNetworkSettings;
  f.wrongGenesis();
  await assert.rejects(registry.save(await registry.load(), draft(first), signal()), /does not match/);
  assert.deepEqual(f.calls, [first + '/api/v2/', first + '/api/v2/block-index/0']);
  assert.equal(f.raw.size, 0);
});

for (const fault of ['write', 'readback'] as const) {
  test(`an uncertain network ${fault} retires its snapshot until a read-only reload`, async () => {
    const f = fixture();
    let writes = 0;
    let failRead = false;
    const registry = createPublicAccountStorage({
      async get(key) {
        if (key === WATCH_UTXO_NETWORKS_KEY && failRead) {
          failRead = false;
          throw Error('Unavailable network readback');
        }
        return f.port.get(key);
      },
      async set(key, value) {
        assert.equal(key, WATCH_UTXO_NETWORKS_KEY);
        const firstWrite = ++writes === 1;
        if (firstWrite && fault === 'write') throw Error('Unavailable network write');
        await f.port.set(key, value);
        failRead = firstWrite && fault === 'readback';
      },
    }, f.fetch).utxoNetworkSettings;
    const old = await registry.load();
    await assert.rejects(registry.save(old, draft(first), signal()), WatchUtxoNetworkReloadRequiredError);
    const probes = [...f.calls];
    await assert.rejects(registry.save(old, draft(first), signal()), WatchUtxoNetworkReloadRequiredError);
    const current = await registry.load();
    assert.equal(writes, 1);
    assert.deepEqual(f.calls, probes);

    if (fault === 'write') {
      assert.equal(current.networks.some(({ endpoint }) => endpoint === first), false);
      const saved = await registry.save(current, draft(first), signal());
      assert.equal(writes, 2);
      assert.equal(saved.networks.filter(({ endpoint }) => endpoint === first).length, 1);
    } else {
      assert.equal(current.networks.filter(({ endpoint }) => endpoint === first).length, 1);
      await assert.rejects(registry.save(current, draft(first), signal()), /already saved/);
      assert.equal(writes, 1);
    }
  });
}

test('custom Activity captures the synchronous registry owner before metadata dispatch', async () => {
  const f = fixture(), { saved, id } = await addWatchAccount(f);
  const registration = getUtxoNetwork(id, saved.networks);
  const { address, identifier } = parseUtxoPublicIdentifier(XPUB, registration);
  const activity = createUtxoActivityReader({ fetch: f.fetch });
  const owner = { accountId: 'ltc', networkId: id, address, generation: 1 };
  const before = f.calls.length;
  await assert.rejects(activity.readPage({
    context: owner, identifier, isAccount: true, registration,
    assertCurrent: async () => { throw Error('Asynchronous owner'); },
  }, { page: 1 }, signal()), { code: 'CANCELLED' });
  assert.equal(f.calls.length, before);

  let revoked = false;
  const source = { context: owner, identifier, isAccount: true, registration, assertCurrent() {
    if (revoked) throw Error('Retired owner');
  } };
  const gate = f.hold(first);
  const result = activity.readPage(source, { page: 1 }, signal());
  const rejected = assert.rejects(result);
  await gate.entered;
  revoked = true;
  source.assertCurrent = () => {};
  gate.release();
  await rejected;
  assert.deepEqual(f.calls.slice(before), [first + '/api/v2/']);
});

test('canceling one custom Activity detail viewer preserves its live shared follower', async () => {
  const f = fixture();
  await addWatchAccount(f);
  const owner = await f.open();
  owner.unlock();
  const gate = f.holdDetail();
  assert.equal((await owner.readUtxoActivityPage({ page: 1 }, signal())).rows[0]?.txid, txid);

  const firstViewer = new AbortController();
  const first = owner.readUtxoActivityDetail({ txid }, firstViewer.signal);
  const cancelled = assert.rejects(first);
  await gate.entered;
  const second = owner.readUtxoActivityDetail({ txid }, signal());
  await gate.secondViewer;
  firstViewer.abort();
  gate.release();
  await cancelled;
  assert.equal((await second).txid, txid);
  assert.equal(f.calls.filter((url) => url.endsWith('/api/v2/tx/' + txid)).length, 1);
});

test('an edit keeps the original backend token and rejects a backend swap', async () => {
  const f = fixture(), { registry, saved, id } = await addWatchAccount(f);
  const raw = f.raw.get(WATCH_UTXO_NETWORKS_KEY);
  f.switchBackend();
  await assert.rejects(registry.save(saved, draft(second), signal(), id), /does not match/);
  assert.equal(f.raw.get(WATCH_UTXO_NETWORKS_KEY), raw);
});

test('retired endpoint reads cannot disclose a key after edit and a referenced network cannot be removed', async () => {
  const f = fixture(), { saved, registry, watches, id } = await addWatchAccount(f);
  const before = await f.open();
  before.unlock();
  const gate = f.hold(first);
  const refresh = before.refresh();
  await gate.entered;
  const edited = await registry.save(saved, draft(second), signal(), id);
  gate.release();
  await refresh;
  assert.equal(before.getSnapshot().balance.status, 'error');
  assert.equal(f.calls.some((url) => url.startsWith(first) && url.includes('/xpub/')), false);
  await assert.rejects(registry.remove(edited, id, signal()), /using this network/);
  const after = await f.open();
  after.unlock();
  await after.refresh();
  assert.ok(f.calls.at(-1)?.startsWith(second + '/api/v2/xpub/'));

  await watches.load();
  await watches.change({ kind: 'remove', id: 'ltc' });
  await registry.remove(edited, id, signal());
  await assert.rejects(registry.save(edited, draft(first), signal(), id), /changed/);
  assert.throws(() => getUtxoNetwork(id, []));
});

test('a held stale edit cannot keep probing or overwrite a newer saved endpoint', async () => {
  const f = fixture(), { registry, saved, id } = await addWatchAccount(f);
  const gate = f.hold(stale);
  const held = registry.save(saved, draft(stale), signal(), id);
  const rejected = assert.rejects(held, /cancelled|changed/i);
  await gate.entered;
  const current = await registry.save(saved, draft(second), signal(), id);
  gate.release();
  await rejected;
  assert.equal(getUtxoNetwork(id, current.networks).endpoint, second);
  assert.equal(getUtxoNetwork(id, (await registry.load()).networks).endpoint, second);
  assert.deepEqual(f.calls.filter((url) => url.startsWith(stale)), [stale + '/api/v2/']);
});

test('cancelled verification performs no later identity read or save', async () => {
  const f = fixture(), registry = f.storage.utxoNetworkSettings;
  const gate = f.hold(stale), controller = new AbortController();
  const saving = registry.save(await registry.load(), draft(stale), controller.signal);
  const cancelled = assert.rejects(saving, /cancelled|aborted/i);
  await gate.entered;
  controller.abort();
  gate.release();
  await cancelled;
  assert.deepEqual(f.calls, [stale + '/api/v2/']);
  assert.equal(f.raw.size, 0);
});
