import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createKeyringHost,
  KeyringAccountType,
  SoftwareKeyring,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { convertExtendedKeyVersion } from '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js';
import { getNetworkConfig } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { HDNodeWallet } from 'ethers/wallet';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';

import {
  UTXO_SIGNED_RECORD_KEY,
  UtxoSignedRecords,
} from '../../../source/wallet/utxoSignedRecords.ts';
import { createNativeUtxoSend } from '../src/custody/utxoSend.ts';
import { getUtxoNetwork, getUtxoSdkNetwork, projectUtxoRegistration, UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { HdKeyExportFlow, keyExportRegistrationHash } from '../src/custody/hdKeyExport.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { createUtxoBalanceReader } from '../src/core/utxoBalanceReader.ts';
import { findWifAddressType, UTXO_IMPORT_TYPES, type UtxoImportAddressType } from '../src/core/utxoAddresses.ts';
import { WALLET_CATALOGUE_KEY, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { metadata } from './publicWatchFixtures.ts';

const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const bitcoin = syscoinUtils.bitcoinjs;

const litecoinEndpoint = 'https://offline-ltc.invalid/blockbook';
const litecoinRegistration = projectUtxoRegistration({
  id: 'utxo:custom:0123456789abcdef0123456789abcdef', chainId: 2, slip44: 2,
  backendChain: 'Provider-main_2', endpoint: litecoinEndpoint, name: 'Litecoin fixture', explorer: litecoinEndpoint,
});
for (const network of [getUtxoNetwork('bitcoin'), litecoinRegistration])
test(`real native SDK ${network.symbol} HD quote, signed bytes, SQLite admission and exact ACK use the same scoped route`, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pali-utxo-signed-'));
  const file = join(directory, 'wallet.sqlite');
  const db = nodeConnection(file);
  const storage = await SqliteWalletStorage.open(
    db.connection,
    digest,
    INSTALLATION,
    true
  );
  const ring = new SoftwareKeyring(createKeyringHost(storage.keyringStorage), {
    captureEvmSubmission: null,
  });
  try {
    const sdkNetwork = getUtxoSdkNetwork(network);
    const state = {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: sdkNetwork,
      accounts: {
        HDAccount: {} as Record<
          number,
          Awaited<ReturnType<typeof ring.initializeWalletSecurely>>
        >,
        Imported: {},
        Ledger: {},
        Trezor: {},
        SmartAccount: {},
      },
    };
    ring.setVaultStateGetter(() => state);
    const account = await ring.initializeWalletSecurely(
      phrase,
      'synthetic fixture password'
    );
    state.accounts.HDAccount[0] = account;
    const profileId = await ring.getPrivateRecordProfileId();
    const evmRoot = HDNodeWallet.fromPhrase(phrase);
    let active = true;
    const assertCurrent = () => {
      if (!active) throw new Error('CANCELLED');
    };
    await storage.recovery!.bindIdentity(
      await storage.getWalletFingerprint(),
      {
        address: evmRoot.address,
        publicKey: evmRoot.publicKey,
        profileId,
      },
      assertCurrent
    );
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32, 7), 0);
    previous.addOutput(
      bitcoin.address.toOutputScript(account.address, network.addressNetwork),
      100000n
    );
    const previousId = previous.getId();
    const recipient = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 8),
      network: network.addressNetwork,
    }).address;
    const records = new UtxoSignedRecords(storage.utxoSignedRecords!, storage.utxoSignedRecords!);
    const calls: string[] = [];
    let published: string | undefined;
    let ackId: string | undefined;
    const reply = (url: string, data: unknown) => {
      const response = Response.json(data);
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      assert.equal(typeof input, 'string');
      const url = String(input),
        path = url.slice(network.endpoint.length);
      calls.push(`${init?.method} ${path}`);
      if (path === '/api/v2/') return reply(url, metadata(network));
      if (path === '/api/v2/block-index/0') return reply(url, { blockHash: network.genesisHash });
      if (path === '/api/v2/estimatefee/1')
        return reply(url, { result: '0.00001024' });
      if (path === `/api/v2/xpub/${account.xpub}?tokens=used&details=tokens`)
        return reply(url, { tokens: [] });
      if (path === `/api/v2/utxo/${account.xpub}`)
        return reply(url, [
          {
            txid: previousId,
            vout: 0,
            value: '100000',
            address: account.address,
            confirmations: 10,
            path: `m/84'/${network.slip44}'/0'/0/0`,
          },
        ]);
      if (path === `/api/v2/tx/${previousId}`)
        return reply(url, { hex: previous.toHex() });
      if (path === '/api/v2/sendtx/' && init?.method === 'POST') {
        published = init.body as string;
        const tx = bitcoin.Transaction.fromHex(published);
        const signedId: string = tx.getId();
        ackId = signedId;
        const retained = await records.readExact(
          { keyring: ring, assertCurrent },
          {
            chainId: network.chainId,
            slip44: network.slip44,
            genesisHash: network.genesisHash,
            account: { id: 0, type: 'HDAccount', xpub: account.xpub },
          },
          signedId
        );
        assert.equal(retained?.rawTransaction, published);
        return reply(url, { result: ackId });
      }
      if (ackId && path === `/api/v2/tx/${ackId}`)
        return reply(url, {
          txid: ackId,
          hex: published,
          confirmations: 1,
          blockHash: 'a'.repeat(64),
        });
      throw new Error(`Unexpected offline fixture route ${path}`);
    };
    const send = createNativeUtxoSend(
      network,
      {
        profileId,
        account: {
          id: 0,
          type: 'HDAccount',
          address: account.address,
          xpub: account.xpub,
        },
        network: {
          kind: 'syscoin',
          chainId: network.chainId,
          slip44: network.slip44,
          currency: sdkNetwork.currency,
          genesisHash: network.genesisHash,
          url: network.endpoint,
        },
      },
      { keyring: ring, assertCurrent },
      ring.syscoinTransaction,
      records,
      fetcher
    );
    let review = await send.prepare({ amount: '0.0004', recipient });
    assert.equal(review.outputs[0]?.address, recipient);
    assert.equal(review.outputs[0]?.amountSatoshis, '40000');
    const change = review.outputs[1];
    assert(change && change.address !== account.address && change.address !== recipient);
    assert.equal(bitcoin.address.fromOutputScript(bitcoin.address.toOutputScript(change.address, network.addressNetwork), network.addressNetwork), change.address);
    assert(BigInt(review.feeSatoshis) > 0n);
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 0);
    await assert.rejects(send.confirm({ ...review }), /NOT_READY/);
    const originalSign = ring.syscoinTransaction.signPSBT.bind(ring.syscoinTransaction);
    const dishonestSign = t.mock.method(ring.syscoinTransaction, 'signPSBT', async (...args: Parameters<typeof originalSign>) => {
      const signed = await originalSign(...args);
      const psbt = PsbtUtils.fromPali(signed, sdkNetwork);
      const witness = psbt.data.inputs[0]?.witnessUtxo;
      assert(witness);
      witness.value += 1n;
      return PsbtUtils.toPali(psbt);
    });
    await assert.rejects(send.confirm(review), {
      code: 'UTXO_QUOTE_FEE_CHANGED',
      transactionNotBroadcast: true,
    });
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 0);
    assert.equal((await send.list()).length, 0);
    dishonestSign.mock.restore();
    review = await send.prepare({ amount: '0.0004', recipient });
    const { txid } = await send.confirm(review);
    assert.equal(txid, ackId);
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 1);
    assert.equal(await send.check(txid), 'confirmed');
    const persisted = (await storage.recovery!.readSnapshot()).records.find(
      (entry) => entry.key === UTXO_SIGNED_RECORD_KEY
    );
    assert(persisted && !persisted.value.includes(published!));
    active = false;
    await assert.rejects(
      send.prepare({ amount: '0.0004', recipient }),
      /CANCELLED/
    );
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 1);
  } finally {
    await ring.destroy();
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('native custody combines shared-default WIF and BIP84 accounts with verified custom UTXO registration', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Ambient network forbidden'); });
  const directory = await mkdtemp(join(tmpdir(), 'pali-utxo-wif-'));
  const file = join(directory, 'wallet.sqlite');
  const password = 'PUBLIC WIF fixture password 1!';
  let initialized = false;
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let network = getUtxoNetwork('bitcoin');
  let hdXpub = '';
  let backendDrift = false;
  let blockBroadcast = false;
  const endpoint = litecoinEndpoint;
  const unsupportedEndpoint = 'https://offline-zec.invalid/blockbook';
  const zec = findUtxoCoinByRegistration({ chainId: 133, slip44: 133 })!;
  assert.equal(zec.segwit, false);
  const registration = litecoinRegistration;
  let address = '';
  let lookup = '';
  let fundingAddress = '';
  let lastExtendedKey = '';
  let holdCatalogueUpdate: (() => Promise<void>) | undefined;
  let previous = new bitcoin.Transaction();
  let confirmed = false;
  const calls: string[] = [];
  const posts: string[] = [];
  const reply = (url: string, data: unknown) => {
    const response = Response.json(data);
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    assert.equal(typeof input, 'string');
    const url = String(input);
    if (url.startsWith(unsupportedEndpoint + '/')) {
      const path = url.slice(unsupportedEndpoint.length);
      calls.push(`${init?.method} ${path}`);
      assert.equal(init?.method, 'GET');
      if (path === '/api/v2/') return reply(url, {
        blockbook: { coin: zec.coinLabel, network: zec.coinShortcut, decimals: zec.decimals },
        backend: { chain: 'main' },
      });
      assert.equal(path, '/api/v2/block-index/0');
      return reply(url, { blockHash: zec.hashGenesisBlock });
    }
    const path = url.slice(network.endpoint.length);
    calls.push(`${init?.method} ${path}`);
    assert(url.startsWith(network.endpoint));
    if (path === '/api/v2/') {
      const status = metadata(network);
      if (backendDrift || (blockBroadcast && (await storage.recovery.readSnapshot()).records.some((row) => row.key === UTXO_SIGNED_RECORD_KEY)))
        status.backend.chain = 'mismatched-backend';
      return reply(url, status);
    }
    if (path === `/api/v2/xpub/${hdXpub}?details=tokenBalances&tokens=nonzero`)
      return reply(url, { address: hdXpub, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    if (path === '/api/v2/block-index/0') return reply(url, { blockHash: network.genesisHash });
    if (path === `/api/v2/address/${address}?details=tokenBalances&tokens=nonzero`)
      return reply(url, { address, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    if (lookup !== address && path === `/api/v2/xpub/${lookup}?details=tokenBalances&tokens=nonzero`)
      return reply(url, { address: lookup, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    if (lookup !== address && path === `/api/v2/xpub/${lookup}?tokens=used&details=tokens`)
      return reply(url, { tokens: [] });
    if (path === '/api/v2/estimatefee/1') return reply(url, { result: '0.00001024' });
    if (path === `/api/v2/utxo/${lookup}`) return reply(url, [{
      txid: previous.getId(), vout: 0, value: '100000', address: fundingAddress, confirmations: 10,
      ...(lookup !== address && { path: `m/84'/${network.slip44}'/7'/0/4` }),
    }]);
    if (path === `/api/v2/tx/${previous.getId()}`) return reply(url, { hex: previous.toHex() });
    if (path === '/api/v2/sendtx/' && init?.method === 'POST') {
      assert.equal(typeof init.body, 'string');
      const raw = init.body as string, txid = bitcoin.Transaction.fromHex(raw).getId();
      const persisted = (await storage.recovery.readSnapshot()).records.find((row) => row.key === UTXO_SIGNED_RECORD_KEY);
      assert(persisted && persisted.value.includes(txid) && !persisted.value.includes(raw));
      posts.push(raw);
      return reply(url, { result: txid });
    }
    const latest = posts.at(-1);
    if (latest && path === `/api/v2/tx/${bitcoin.Transaction.fromHex(latest).getId()}`)
      return reply(url, { txid: bitcoin.Transaction.fromHex(latest).getId(), hex: latest,
        confirmations: confirmed ? 1 : 0, ...(confirmed && { blockHash: 'a'.repeat(64) }) });
    throw new Error(`Unexpected fixture route ${path}`);
  };
  const openStorage = async () => {
    const { connection } = nodeConnection(file, {
      after: async (kind, sql) => {
        if (kind === 'run' && sql.startsWith('UPDATE keyring_records SET value') && holdCatalogueUpdate) {
          const hold = holdCatalogueUpdate;
          holdCatalogueUpdate = undefined;
          await hold();
        }
      },
    });
    storage = await SqliteWalletStorage.open(connection, digest, INSTALLATION, !initialized);
    initialized = true;
    return storage;
  };
  const reader = createUtxoBalanceReader({ fetch: fetcher });
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  let interceptExport: ((key: string) => Promise<string>) | undefined;
  let exports = 0;
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => undefined,
    openStorage,
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: class extends sdk.SoftwareKeyring {
      constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
        super(...args);
        const unwrap = this.getPrivateKeyByAccountId;
        this.getPrivateKeyByAccountId = async (...input) => {
          exports++;
          const key = await unwrap(...input);
          return interceptExport ? interceptExport(key) : key;
        };
      }
    } }),
    utxoFetch: fetcher,
    readUtxoAccount: reader.readAccount,
    readUtxoBalance: reader.readBalance,
  });
  const newOwner = () => new NativeCustodyAuthority({ async open() {
    runtime = await factory.open() as KeyringRuntime;
    return runtime;
  } });
  let owner = newOwner();
  const current = () => undefined;
  const selectNetwork = () => owner.selectNetwork(network.id, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
  const selectAccount = (id: string) => owner.manageAccounts({ kind: 'select', id }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
  const removeAccount = (id: string, credential = password) => owner.manageAccounts({ kind: 'remove', id, password: credential }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
  const preview = (privateKey: string, utxoAddressType?: UtxoImportAddressType) => owner.previewUtxoImport(
    { privateKey, ...(utxoAddressType && { utxoAddressType }) }, owner.getSnapshot().revision, owner.getCatalogue()!.revision, current
  );
  const submit = (privateKey: string, utxoAddressType: UtxoImportAddressType | undefined, expectedAddress: string) => owner.importAccount(
    { privateKey, ...(utxoAddressType && { utxoAddressType }), expectedAddress, label: `Imported ${utxoAddressType ?? 'BIP84'}` },
    password, owner.getSnapshot().revision, owner.getCatalogue()!.revision
  );
  try {
    await owner.initialize();
    await owner.importPhrase(phrase, password);
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    await owner.refreshAuthenticatedMetadata();
    assert.equal(owner.getCatalogue()!.active.accountId, 'hd:60:0');

    const beforeUnsupported = owner.getCatalogue()!;
    const priorUnsupportedRequests = calls.length;
    await assert.rejects(owner.addUtxoNetwork({ endpoint: unsupportedEndpoint, name: '', explorer: '' },
      owner.getSnapshot().revision, beforeUnsupported.revision, new AbortController().signal));
    assert.deepEqual(calls.slice(priorUnsupportedRequests), ['GET /api/v2/', 'GET /api/v2/block-index/0']);
    assert.equal(owner.getCatalogue(), beforeUnsupported);
    await assert.rejects(owner.manageNetwork({ kind: 'add-utxo-network' }, owner.getSnapshot().revision,
      beforeUnsupported.revision), { code: 'CANCELLED' });
    assert.equal(owner.getCatalogue(), beforeUnsupported);
    network = registration;
    const oldCatalogue = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const lifetime = new AbortController();
    holdCatalogueUpdate = () => { entered.resolve(); return release.promise; };
    const rejected = assert.rejects(owner.addUtxoNetwork({ endpoint, name: '', explorer: '' },
      owner.getSnapshot().revision, beforeUnsupported.revision, lifetime.signal));
    await Promise.race([entered.promise, rejected.then(() => { throw new Error('Registration did not reach SQLite'); })]);
    lifetime.abort();
    release.resolve();
    await rejected;
    assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), oldCatalogue);
    await owner.unlock(password);
    const beforeAdd = calls.length;
    await owner.addUtxoNetwork({ endpoint, name: registration.name, explorer: '' },
      owner.getSnapshot().revision, owner.getCatalogue()!.revision, new AbortController().signal);
    assert.deepEqual(calls.slice(beforeAdd), ['GET /api/v2/', 'GET /api/v2/block-index/0']);
    const custom = owner.getCatalogue()!.utxoNetworks.find((candidate) => candidate.endpoint === endpoint)!;
    assert.equal(custom.backendChain, registration.backendChain);
    const beforeDuplicate = owner.getCatalogue()!;
    await assert.rejects(owner.addUtxoNetwork({ endpoint, name: 'Duplicate', explorer: '' },
      owner.getSnapshot().revision, beforeDuplicate.revision, new AbortController().signal));
    assert.equal(owner.getCatalogue(), beforeDuplicate);
    for (const target of [custom, ...UTXO_NETWORKS]) {
      network = target;
      await selectNetwork();
      if (target === custom) {
        const saved = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
        const hd = saved.groups.find((entry) => entry.key === '2')!.accounts.HDAccount[0]!;
        assert.match(hd.address, /^ltc1/);
        hdXpub = hd.xpub;
        const beforeBalance = calls.length;
        backendDrift = true;
        await assert.rejects(runtime.readUtxoBalance!(custom.id, hd.address, new AbortController().signal));
        backendDrift = false;
        assert.deepEqual(calls.slice(beforeBalance), ['GET /api/v2/']);
        assert.equal((await runtime.readUtxoBalance!(custom.id, hd.address, new AbortController().signal)).confirmedUnits, '100000');
        assert.match(calls.at(-1)!, /^GET \/api\/v2\/xpub\/zpub/);
      }
      const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network: network.addressNetwork });
      const wif = key.toWIF();
      const cfg = getNetworkConfig(network.slip44, getUtxoSdkNetwork(network).currency);
      const versions = cfg.types.zPubType as (NonNullable<typeof cfg.types.zPubType> & {
        testnet: { vprv: string };
      }) | undefined;
      assert(versions);
      const accountNode = bitcoin.bip32.fromSeed(Buffer.alloc(32, 9), network.addressNetwork)
        .derivePath(`m/84'/${network.slip44}'/7'`);
      const zPrivate = convertExtendedKeyVersion(accountNode.toBase58(),
        network.testnet ? versions.testnet.vprv : versions.mainnet.zprv);
      const accountAddress = (change: number, index: number) => bitcoin.payments.p2wpkh({
        pubkey: accountNode.derive(change).derive(index).publicKey,
        network: network.addressNetwork,
      }).address!;
      const scripts = target === custom ? ['p2wpkh'] as const : [...UTXO_IMPORT_TYPES, undefined];
      for (const [index, script] of scripts.entries()) {
        const options = { network: network.addressNetwork };
        const secret = script ? wif : zPrivate;
        address = !script ? accountAddress(0, 0) : (script === 'p2tr'
          ? bitcoin.payments.p2tr({ ...options, internalPubkey: key.publicKey.slice(1) })
          : bitcoin.payments[script]({ ...options, pubkey: key.publicKey })).address!;
        lookup = script ? address : convertExtendedKeyVersion(accountNode.neutered().toBase58(), network.publicKeyVersion);
        fundingAddress = script ? address : accountAddress(0, 4);
        if (script) assert.equal(findWifAddressType(address, network), script);
        const before = JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY));
        const callsBefore = calls.length;
        assert.equal(await preview(secret, script), address);
        assert.equal(JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)), before);
        assert.equal(calls.length, callsBefore);
        if (target === UTXO_NETWORKS[0] && index === 0) {
          const wrongChecksum = wif.slice(0, -1) + (wif.endsWith('1') ? '2' : '1');
          await assert.rejects(preview(wrongChecksum, script), { code: 'INVALID_INPUT' });
          await assert.rejects(preview('zprv' + 'A'.repeat(107), script), { code: 'INVALID_INPUT' });
          await assert.rejects(preview('0x' + '11'.repeat(32), script), { code: 'INVALID_INPUT' });
          await assert.rejects(submit(wif, 'p2pkh', address), { code: 'INVALID_INPUT' });
          await owner.unlock(password);
          assert.equal(JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)), before);

          const oldContext = owner.getSnapshot().revision, oldCatalogue = owner.getCatalogue()!.revision;
          await owner.selectNetwork('ethereum', oldContext, oldCatalogue);
          await assert.rejects(owner.importAccount(
            { privateKey: wif, utxoAddressType: script, expectedAddress: address, label: 'Revoked review' },
            password, oldContext, oldCatalogue
          ), { code: 'CANCELLED' });
          await selectNetwork();
        }
        if (!script) {
          lastExtendedKey = secret;
          const wrongClass = convertExtendedKeyVersion(accountNode.toBase58(),
            network.testnet ? versions.mainnet.zprv : versions.testnet.vprv);
          await assert.rejects(preview(wrongClass), { code: 'INVALID_INPUT' });
          await assert.rejects(preview(accountNode.toBase58()), { code: 'INVALID_INPUT' });
          await assert.rejects(preview(secret, 'p2pkh'), { code: 'INVALID_INPUT' });
          if (target === UTXO_NETWORKS[0]) {
            await assert.rejects(submit(secret, undefined, fundingAddress), { code: 'INVALID_INPUT' });
            await owner.unlock(password);
            const updated = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            holdCatalogueUpdate = () => { updated.resolve(); return release.promise; };
            const pending = submit(secret, undefined, address);
            const rejected = assert.rejects(pending, { code: 'CANCELLED' });
            try {
              await Promise.race([updated.promise, pending]);
              assert.equal(holdCatalogueUpdate, undefined);
              owner.lock();
            } finally { release.resolve(); }
            await rejected;
            assert.equal(JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)), before);
            await owner.unlock(password);
          }
        }
        await submit(secret, script, address);
        const accountId = `imported:${network.slip44}:${index}`;
        assert.equal(owner.getCatalogue()!.active.accountId, accountId);
        assert.equal(owner.getSnapshot().account?.address, address);
        const saved = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
        const group = saved.groups.find((entry) => entry.activeNetwork.slip44 === network.slip44)!;
        assert.equal(group.accounts.Imported[index]?.xpub, lookup);
        assert.equal(owner.getCatalogue()!.accounts.find(({ id }) => id === accountId)?.utxoExtended, script ? undefined : true);
        assert.equal(saved.recovery.find((entry) => entry.identity.address === address)?.identity.slip44, network.slip44);
        assert.equal(JSON.stringify(saved).includes(secret), false);
        assert.equal(JSON.stringify(owner.getCatalogue()).includes('xprv'), false);
        const keyFlow = new HdKeyExportFlow(owner, () => runtime.keyExport);
        try {
          const callsBeforeReveal = calls.length;
          const shown = await keyFlow.begin(password);
          assert.equal(shown.privateKey, secret);
          assert.equal(shown.address, address);
          assert.equal(shown.accountId, accountId);
          assert.equal(keyFlow.isCurrent(shown.id), true);
          assert.equal(calls.length, callsBeforeReveal);
          assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), saved);
          assert.equal(JSON.stringify(owner.getSnapshot()).includes(secret), false);
          keyFlow.cancel();
          assert.equal(keyFlow.isCurrent(shown.id), false);
          if (target === UTXO_NETWORKS[0] && index === 0) {
            const beforeExport = exports;
            const catalogue = owner.getCatalogue()!;
            const scope = { authorityRevision: owner.getSnapshot().revision, catalogueRevision: catalogue.revision,
              accountId, index, address, networkId: network.id,
              registrationHash: keyExportRegistrationHash(network.id, catalogue) };
            await assert.rejects(runtime.keyExport!.readSelected({ ...scope, registrationHash: `0x${'f'.repeat(64)}` }, password, current), /CANCELLED/);
            assert.equal(exports, beforeExport);
            owner.lock(); await owner.unlock(password);
            await assert.rejects(keyFlow.begin('wrong password'), /INVALID_CREDENTIAL/);
            assert.equal(exports, beforeExport);
            await owner.unlock(password);

            const anotherNetwork = UTXO_NETWORKS.find((candidate) => candidate.addressNetwork.wif !== network.addressNetwork.wif)!;
            for (const forged of [
              `${wif.slice(0, -1)}${wif.endsWith('1') ? '2' : '1'}`,
              bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 14), { network: network.addressNetwork }).toWIF(),
              bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network: anotherNetwork.addressNetwork }).toWIF(),
            ]) {
              interceptExport = async () => forged;
              await assert.rejects(keyFlow.begin(password), { message: 'KEY_EXPORT_UNAVAILABLE' });
              await owner.unlock(password);
            }
            const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
            interceptExport = async (raw) => { entered.resolve(); await release.promise; return raw; };
            const pending = keyFlow.begin(password);
            const rejection = assert.rejects(pending, { message: 'CANCELLED' });
            await entered.promise;
            owner.lock(); release.resolve();
            await rejection;
            interceptExport = undefined;
            await owner.unlock(password);
            await selectAccount(`hd:${network.slip44}:0`);
            const beforeHd = exports;
            const extended = await keyFlow.begin(password);
            assert.equal(extended.accountId, `hd:${network.slip44}:0`);
            assert(extended.privateKey.startsWith(network.testnet ? 'vprv' : 'zprv'));
            assert.equal(exports, beforeHd + 1);
            await selectAccount(accountId);
            assert.equal(keyFlow.isCurrent(extended.id), false);
            assert.equal(calls.length, callsBeforeReveal);
          }
        } finally { keyFlow.dispose(); }
        if (index === 0 || !script) {
          const beforeDuplicate = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
          const revision = owner.getSnapshot().revision;
          await assert.rejects(preview(secret, script), { code: 'DUPLICATE_ACCOUNT' });
          assert.equal(owner.getSnapshot().revision, revision);
          assert.equal(owner.getSnapshot().phase, 'ready');
          assert.equal(owner.getCatalogue()!.active.accountId, accountId);
          assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), beforeDuplicate);
          await assert.rejects(submit(secret, script, address), { code: 'DUPLICATE_ACCOUNT' });
        }
        assert.equal((await runtime.readUtxoBalance!(network.id, address, new AbortController().signal)).confirmedUnits, '100000');

        previous = new bitcoin.Transaction();
        previous.addInput(Buffer.alloc(32, network.slip44 + index + 2), 0);
        previous.addOutput(bitcoin.address.toOutputScript(fundingAddress, network.addressNetwork), 100000n);
        const recipient = bitcoin.payments.p2wpkh({ ...options, hash: Buffer.alloc(20, 19) }).address!;
        let send = await runtime.openUtxoSend!(current);
        const max = await send.prepare({ amount: '', recipient, max: true });
        assert.equal(max.outputs.length, 1);
        assert.equal(max.outputs[0]?.address, recipient);
        assert.equal(BigInt(max.outputs[0]!.amountSatoshis) + BigInt(max.feeSatoshis), 100000n);
        const review = await send.prepare({ amount: '0.0004', recipient });
        assert.deepEqual(review.outputs[0], { address: recipient, amountSatoshis: '40000' });
        assert.equal(review.outputs[1]?.address, script ? address : accountAddress(1, 0));
        assert(BigInt(review.feeSatoshis) > 0n);
        let txid: string, raw: string | undefined;
        if (target === custom) {
          blockBroadcast = true;
          const beforePosts = posts.length;
          await assert.rejects(send.confirm(review), { code: 'UTXO_SUBMISSION_NOT_DISPATCHED', transactionNotBroadcast: true });
          assert.equal(posts.length, beforePosts);
          const [retained] = await send.list();
          assert(retained);
          assert.equal(retained.accepted, false);
          txid = retained.txid;
          blockBroadcast = false;
        } else {
          ({ txid } = await send.confirm(review));
          raw = posts.at(-1)!;
        }

        if (target === UTXO_NETWORKS[0] && index === 0) {
          await selectAccount(`hd:${network.slip44}:0`);
          await assert.rejects(removeAccount(accountId), { code: 'PENDING_TRANSFER' });
          await owner.unlock(password);
          assert(owner.getCatalogue()!.accounts.some((entry) => entry.id === accountId));
          await selectAccount(accountId);
        }
        await owner.dispose();
        owner = newOwner();
        await owner.initialize();
        await owner.unlock(password);
        assert.equal(owner.getCatalogue()!.active.accountId, accountId);
        assert.equal(owner.getSnapshot().account?.address, address);
        send = await runtime.openUtxoSend!(current);
        assert.deepEqual((await send.list()).map((entry) => entry.txid), [txid]);
        assert.equal((await send.confirm(await send.prepareRetry(txid))).txid, txid);
        if (raw) assert.equal(posts.at(-1), raw);
        else assert.equal(bitcoin.Transaction.fromHex(posts.at(-1)!).getId(), txid);
        confirmed = true;
        assert.equal(await send.check(txid), 'confirmed');
        confirmed = false;
        const laneRequests = calls.slice(callsBefore);
        assert.equal(laneRequests.some((entry) => entry.includes('/xpub/')), !script);
        assert.equal(laneRequests.some((entry) => entry.includes(secret)), false);
      }
    }
    assert.equal(posts.length, UTXO_NETWORKS.length * (UTXO_IMPORT_TYPES.length + 1) * 2 + 1);
    await selectAccount(`hd:${network.slip44}:0`);
    await removeAccount(`imported:${network.slip44}:0`);
    assert.equal(owner.getCatalogue()!.accounts.some((account) => account.id === `imported:${network.slip44}:0`), false);

    const beforeReset = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    const nextPassword = 'PUBLIC changed WIF fixture password 2!';
    owner.lock();
    const recovery = new NativeRecoveryCoordinator({
      owner, retireControllers() {}, ensureCryptoReady: async () => undefined, openStorage,
    });
    try {
      const proof = await recovery.prepare(phrase, nextPassword, current);
      assert.equal(await recovery.commit(proof), 'committed-locked');
    } finally {
      await recovery.dispose();
    }
    await owner.dispose();
    owner = newOwner();
    await owner.initialize();
    await owner.unlock(nextPassword);
    const afterReset = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.deepEqual(afterReset.recovery, beforeReset.recovery);
    for (const previousGroup of beforeReset.groups) {
      const group = afterReset.groups.find((entry) => entry.key === previousGroup.key)!;
      for (const account of Object.values(previousGroup.accounts.Imported)) {
        const restored = group.accounts.Imported[account.id]!;
        assert.equal(restored.address, account.address);
        assert.equal(restored.xpub, account.xpub);
        assert.notEqual(restored.xprv, account.xprv);
      }
    }
    const restoredId = `imported:${network.slip44}:${UTXO_IMPORT_TYPES.length}`;
    await selectAccount(restoredId);
    const keyFlow = new HdKeyExportFlow(owner, () => runtime.keyExport);
    try {
      const shown = await keyFlow.begin(nextPassword);
      assert.equal(shown.privateKey, lastExtendedKey);
      assert.equal(shown.accountId, restoredId);
    } finally { keyFlow.dispose(); }
    const restored = await runtime.openUtxoSend!(current);
    const [previousSend] = await restored.list();
    assert(previousSend);
    const oldRaw = posts.at(-1);
    assert.equal((await restored.confirm(await restored.prepareRetry(previousSend.txid))).txid, previousSend.txid);
    assert.equal(posts.at(-1), oldRaw);
  } finally {
    await owner.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
