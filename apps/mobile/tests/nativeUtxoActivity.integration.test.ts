import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { convertExtendedKeyVersion } from '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js';
import { utils } from 'syscoinjs-lib';
import { createUtxoActivityReader, UtxoActivity } from '../src/core/utxoActivity.ts';
import { exactUtxoResponseFetch } from '../src/core/utxoReadSession.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { createNativeUtxoActivity } from '../src/custody/utxoActivity.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { deferred, metadata } from './publicWatchFixtures.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public activity fixture password 1!';
const TXID = 'a'.repeat(64), BLOCK = 'b'.repeat(64);
const statusPath = '/api/v2/', genesisPath = '/api/v2/block-index/0';

test('seeded UTXO Activity reuses bounded Blockbook history and retires old rows and details', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('Ambient network forbidden'); });
  const directory = await mkdtemp(join(tmpdir(), 'pali-native-utxo-activity-'));
  const connection = nodeConnection(join(directory, 'wallet.sqlite')).connection;
  const { bitcoinjs: bitcoin } = utils;
  const network = getUtxoNetwork('bitcoin');
  const calls: string[] = [];
  let held: { detail: ReturnType<typeof deferred<AbortSignal>>; release: ReturnType<typeof deferred<void>> } | undefined;
  const holdNextDetail = () => held = { detail: deferred<AbortSignal>(), release: deferred<void>() };
  let badGenesis = false, disclose = false;
  const fetch = exactUtxoResponseFetch(async (url, init) => {
    assert.ok(url.startsWith(network.endpoint + '/'));
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    const path = url.slice(network.endpoint.length);
    calls.push(path);
    let body: unknown;
    const tx = { txid: TXID, blockHash: BLOCK, blockHeight: 119, confirmations: 5, blockTime: 1700000000,
      value: '2000', fees: '10', addressValueIn: '0', addressValueOut: '2000',
      vin: [{ value: '2010' }], vout: [{ value: '2000', isOwn: true }] };
    if (path === statusPath) body = metadata(network);
    else if (path === genesisPath) body = { blockHash: badGenesis ? 'f'.repeat(64) : network.genesisHash };
    else if (path === `/api/v2/tx/${TXID}`) {
      if (held) {
        const request = held;
        request.detail.resolve(init.signal!);
        await request.release.promise;
      }
      body = tx;
    } else {
      assert.ok(disclose, 'network pin must be verified before identifier lookup');
      const match = /^\/api\/v2\/(?:xpub|address)\/([^?]+)\?details=txsummary&page=1&pageSize=20$/.exec(path);
      assert.ok(match);
      body = { address: match[1], txs: 1, unconfirmedTxs: 0, page: 1, totalPages: 1, itemsOnPage: 20, transactions: [tx] };
    }
    const response = Response.json(body);
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  const factory = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null, ensureCryptoReady: async () => undefined,
    openStorage: () => SqliteWalletStorage.open(connection, digest, INSTALLATION, true),
    async utxoFetch() { throw Error('Activity does not use signing transport'); },
    async readUtxoBalance() { throw Error('Activity does not fetch balances'); },
  });
  let runtime: KeyringRuntime | undefined;
  const authority = new NativeCustodyAuthority({ async open() {
    runtime = await factory.open() as KeyringRuntime;
    return runtime;
  } });
  const activity = createNativeUtxoActivity(authority, () => runtime, createUtxoActivityReader({ fetch }));
  const model = new UtxoActivity(activity, () => true);
  const select = (id: string) => authority.manageAccounts({ kind: 'select', id }, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
  const submit = async (privateKey: string, utxoAddressType?: 'p2wpkh') => {
    const input = { privateKey, ...(utxoAddressType && { utxoAddressType }) };
    const expectedAddress = await authority.previewUtxoImport(input, authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => undefined);
    await authority.importAccount({ ...input, expectedAddress, label: 'Public fixture' }, PASSWORD,
      authority.getSnapshot().revision, authority.getCatalogue()!.revision);
    return expectedAddress;
  };
  const settle = async () => {
    for (let i = 0; i < 100 && model.getSnapshot().status === 'loading'; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const readPage = () => activity.readUtxoActivityPage({ page: 1 }, new AbortController().signal);
  try {
    await authority.initialize();
    await authority.importPhrase(PHRASE, PASSWORD);
    await runtime!.backup.confirm(await runtime!.backup.fingerprint());
    await authority.refreshAuthenticatedMetadata();
    assert.equal(activity.getUtxoActivityContext(), null);
    await authority.selectNetwork(network.id, authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => {});

    badGenesis = true;
    await assert.rejects(readPage(), { code: 'UNAVAILABLE' });
    assert.deepEqual(calls, [statusPath, genesisPath]);
    badGenesis = false;
    disclose = true;
    const hd = await readPage();
    assert.deepEqual(calls.slice(2, 4), [statusPath, genesisPath]);
    assert.match(calls[4]!, /^\/api\/v2\/xpub\/zpub/);
    assert.equal(hd.context.accountId, 'hd:0:0');
    assert.equal(hd.rows[0]?.netUnits, '2000');
    assert.equal(JSON.stringify(hd).includes('zpub'), false);

    const account = bitcoin.bip32.fromSeed(Buffer.alloc(32, 9), network.addressNetwork).derivePath("m/84'/0'/7'");
    const zprv = convertExtendedKeyVersion(account.toBase58(), '04b2430c');
    const zpub = convertExtendedKeyVersion(account.neutered().toBase58(), network.publicKeyVersion);
    await submit(zprv);
    await assert.rejects(activity.readUtxoActivityDetail({ txid: TXID }, new AbortController().signal));
    const bip84 = await readPage();
    assert.ok(calls.at(-1)?.startsWith(`/api/v2/xpub/${zpub}?`));
    assert.equal(bip84.context.accountId, 'imported:0:0');

    const wif = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network: network.addressNetwork }).toWIF();
    const address = await submit(wif, 'p2wpkh');
    model.activate();
    await settle();
    assert.equal(model.getSnapshot().status, 'ready');
    assert.ok(calls.at(-1)?.startsWith(`/api/v2/address/${address}?`));

    const switching = holdNextDetail();
    const oldDetail = model.selectDetail(TXID);
    const signal = await Promise.race([switching.detail.promise, oldDetail.then(() => { throw Error('Detail request did not start'); })]);
    await select('hd:0:0');
    assert.ok(signal.aborted);
    switching.release.resolve();
    held = undefined;
    await oldDetail;
    await settle();
    assert.equal(model.getSnapshot().context?.accountId, 'hd:0:0');
    assert.equal(model.getSnapshot().detail, null);
    await model.selectDetail(TXID);
    assert.equal(model.getSnapshot().detail?.status, 'ready');
    assert.equal(model.getSnapshot().detail?.readSentryNode, undefined);

    model.revoke();
    await model.load();
    const locking = holdNextDetail();
    const lockedDetail = model.selectDetail(TXID);
    const lockSignal = await Promise.race([locking.detail.promise, lockedDetail.then(() => { throw Error('Refreshed detail request did not start'); })]);
    authority.lock();
    assert.ok(lockSignal.aborted);
    locking.release.resolve();
    held = undefined;
    await lockedDetail;
    assert.equal(activity.getUtxoActivityContext(), null);
    assert.equal(model.getSnapshot().detail, null);
    const before = calls.length;
    await assert.rejects(readPage());
    assert.equal(calls.length, before);
    assert.equal(calls.some((path) => path.includes(wif) || path.includes(zprv)), false);
  } finally {
    held?.release.resolve();
    model.dispose();
    await authority.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
