import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createKeyringHost, KeyringAccountType, SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { HDNodeWallet } from 'ethers/wallet';
import { HostKeyring } from '@sidhujag/sysweb3-keyring/cjs/host-keyring.js';
import { createLedgerHardware } from '@sidhujag/sysweb3-keyring/cjs/ledger-hardware.js';
import { createNativeLedgerHost } from '../src/hardware/ledgerHost.ts';
import { withOwnedLedgerConnection } from '../src/hardware/withOwnedLedgerConnection.ts';
import type { NativeLedgerTransport } from '../src/hardware/ownedLedgerTransport.ts';
import { createOwnedUtxoBlockbookRead } from '../../../source/wallet/utxoBlockbookReads.ts';
import { UtxoSignedRecords } from '../../../source/wallet/utxoSignedRecords.ts';
import { submitRetainedUtxo } from '../../../source/wallet/utxoSubmission.ts';
import { prepareNativeDappPsbt } from '../src/custody/dappPsbt.ts';
import { getUtxoNetwork, getUtxoSdkNetwork } from '../src/core/utxoNetworks.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { metadata } from './publicWatchFixtures.ts';

const bitcoin = syscoinUtils.bitcoinjs;
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'synthetic external PSBT fixture password';
const origin = 'https://exact-origin.example';

for (const custody of ['HDAccount', 'Ledger'] as const) test(`${custody} native custody uses the installed SDK, encrypted SQLite admission and original-route saved-byte replay`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pali-native-psbt-'));
  const storage = await SqliteWalletStorage.open(nodeConnection(join(directory, 'wallet.sqlite')).connection, digest, INSTALLATION, true);
  let deviceCalls = 0;
  const unavailable = async () => { throw Error('Unexpected device method'); };
  let transport: NativeLedgerTransport | undefined = {
    host: { getStatus: () => ({ connected: true }), subscribeStatus: () => () => undefined, beginDeviceSelection: () => unavailable, connect: unavailable, disconnect: unavailable,
      retire: async () => () => undefined, evm: {} as never,
      utxo: { getXpub: unavailable, getAddress: unavailable, getAccount: unavailable, signMessage: unavailable,
        async signPsbt(request, authority) {
          authority.assertCurrent(); deviceCalls++;
          const candidate = bitcoin.Psbt.fromBase64(request.psbtBase64);
          const hd = new syscoinUtils.HDSigner(phrase, '', false);
          candidate.signInput(0, hd.deriveKeypair("m/84'/0'/0'/0/0"));
          const partial = candidate.data.inputs[0]!.partialSig![0]!;
          return { fingerprint: Buffer.from(hd.getMasterFingerprint()).toString('hex'), signatures: [{ inputIndex: 0,
            pubkeyHex: Buffer.from(partial.pubkey).toString('hex'), signatureHex: Buffer.from(partial.signature).toString('hex') }] };
        } },
    } as NativeLedgerTransport['host'], observeDevices: unavailable, dispose: async () => undefined,
  };
  const ring = custody === 'Ledger'
    ? new HostKeyring(createKeyringHost(storage.keyringStorage), { captureEvmSubmission: null },
        () => createLedgerHardware(createNativeLedgerHost(() => transport)))
    : new SoftwareKeyring(createKeyringHost(storage.keyringStorage), { captureEvmSubmission: null });
  const network = getUtxoNetwork('bitcoin'), sdkNetwork = getUtxoSdkNetwork(network);
  const state = { activeAccount: { id: 0, type: KeyringAccountType.HDAccount }, activeNetwork: sdkNetwork,
    accounts: { HDAccount: {} as Record<number, Awaited<ReturnType<typeof ring.initializeWalletSecurely>>>, Imported: {}, Ledger: {} as Record<number, Awaited<ReturnType<typeof ring.initializeWalletSecurely>>>, Trezor: {}, SmartAccount: {} } };
  ring.setVaultStateGetter(() => state);
  const lifetime = new AbortController();
  let current = true, failAck = true, retainedRaw = '', postCount = 0;
  const reads: string[] = [];
  try {
    const account = await ring.initializeWalletSecurely(phrase, password); state.accounts.HDAccount[0] = account;
    if (custody === 'Ledger') { state.accounts.Ledger[0] = { ...account, xprv: '', isLedgerWallet: true }; state.activeAccount.type = KeyringAccountType.Ledger; }
    const profileId = await ring.getPrivateRecordProfileId();
    const root = HDNodeWallet.fromPhrase(phrase);
    const identity = await storage.recovery!.readIdentity(); assert(identity);
    await storage.recovery!.bindIdentity(identity.pairFingerprint, {
      address: root.address, publicKey: root.publicKey, profileId,
    }, () => { if (!current) throw Error('CONTEXT_CHANGED'); });
    const guard = () => { if (!current) throw Error('CONTEXT_CHANGED'); };
    const session = { keyring: ring, assertCurrent: guard };
    const owner = { chainId: network.chainId, slip44: network.slip44, genesisHash: network.genesisHash,
      account: { id: 0, type: custody, xpub: account.xpub } };
    const records = new UtxoSignedRecords(storage.utxoSignedRecords!, storage.utxoSignedRecords!);
    const previous = new bitcoin.Transaction(); previous.addInput(Buffer.alloc(32, 7), 0);
    previous.addOutput(bitcoin.address.toOutputScript(account.address, network.addressNetwork), BigInt(100000));
    const recipient = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 8), network: network.addressNetwork }).address;
    const reply = (url: string, value: unknown) => { const result = Response.json(value); Object.defineProperty(result, 'url', { value: url }); return result; };
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const url = String(input); assert(url.startsWith(network.endpoint + '/'));
      const path = url.slice(network.endpoint.length); reads.push(`${init?.method} ${path}`);
      if (path === '/api/v2/') return reply(url, metadata(network));
      if (path === '/api/v2/block-index/0') return reply(url, { blockHash: network.genesisHash });
      if (path === '/api/v2/estimatefee/1') return reply(url, { result: '0.00001024' });
      if (path === `/api/v2/xpub/${account.xpub}?tokens=used&details=tokens`) return reply(url, { tokens: [] });
      if (path === `/api/v2/utxo/${account.xpub}`) return reply(url, [{ txid: previous.getId(), vout: 0,
        value: '100000', address: account.address, confirmations: 10, path: "m/84'/0'/0'/0/0" }]);
      if (path === `/api/v2/tx/${previous.getId()}`) return reply(url, { hex: previous.toHex() });
      if (path === '/api/v2/sendtx/' && init?.method === 'POST') {
        postCount++; const raw = init.body as string, txid = bitcoin.Transaction.fromHex(raw).getId();
        const retained = await records.readExact(session, owner, txid);
        assert.equal(retained?.operation, 'external'); assert.equal(retained?.rawTransaction, raw);
        if (retainedRaw) assert.equal(raw, retainedRaw); else retainedRaw = raw;
        if (failAck) { failAck = false; throw Error('Synthetic lost ACK'); }
        return reply(url, { result: txid });
      }
      if (retainedRaw && path === `/api/v2/tx/${bitcoin.Transaction.fromHex(retainedRaw).getId()}`) return reply(url, {});
      throw Error(`Unexpected owned route: ${path}`);
    };
    const read = createOwnedUtxoBlockbookRead({ kind: 'wallet', xpub: account.xpub, address: account.address, url: network.endpoint }, lifetime.signal, guard, fetcher);
    const quote = await ring.syscoinTransaction.getEstimateSysTransactionFee({ amount: '0.0005', receivingAddress: recipient, txOptions: { rbf: true } }, read);
    const ports = { network, scope: { profileId, account: { ...owner.account, address: account.address },
      network: { kind: 'syscoin' as const, currency: sdkNetwork.currency, chainId: sdkNetwork.chainId,
        slip44: sdkNetwork.slip44, genesisHash: network.genesisHash, url: sdkNetwork.url } },
      session, sdk: { decodeRawTransaction: ring.syscoinTransaction.decodeRawTransaction, sendTransaction: ring.syscoinTransaction.sendTransaction,
        signPSBT: (...args: Parameters<typeof ring.syscoinTransaction.signPSBT>) => custody === 'Ledger'
          ? withOwnedLedgerConnection({ signal: lifetime.signal, assertCurrent: guard, connected: () => !!transport,
              current: () => transport, retire: async () => { const previous = transport; transport = undefined; await previous?.dispose(); } },
            () => ring.syscoinTransaction.signPSBT(...args))
          : ring.syscoinTransaction.signPSBT(...args) }, records, fetch: fetcher, collateral: null, sentry: null };
    const sign = t.mock.method(ring.syscoinTransaction, 'signPSBT');
    const signing = await prepareNativeDappPsbt({ method: 'sys_sign', origin, psbt: quote.psbt }, lifetime.signal, ports);
    assert.equal(sign.mock.callCount(), 0); assert.equal(postCount, 0);
    assert.equal(signing.review.origin, origin); assert(signing.review.outputs.some(output => output.address === recipient));
    const signed = await signing.approve(); assert('psbt' in signed);
    assert.deepEqual(Object.keys(signed).sort(), ['assets', 'psbt']);
    assert(PsbtUtils.fromPali(signed, sdkNetwork).extractTransaction().getId());
    assert.equal(sign.mock.callCount(), 1); assert.equal(postCount, 0);
    assert.deepEqual(signing.disposition(), { transactionNotBroadcast: true }); signing.dispose();
    const sending = await prepareNativeDappPsbt({ method: 'sys_signAndSend', origin, psbt: quote.psbt }, lifetime.signal, ports);
    assert.equal(sign.mock.callCount(), 1); assert.equal(postCount, 0);
    await assert.rejects(sending.approve(), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'UTXO_SUBMISSION_UNKNOWN');
    const txid = bitcoin.Transaction.fromHex(retainedRaw).getId();
    assert.deepEqual(sending.disposition(), { transactionNotBroadcast: false, txid });
    assert.equal(postCount, 1); assert.equal(sign.mock.callCount(), 2); sending.dispose();
    const retained = await records.readExact(session, owner, txid); assert(retained);
    const replay = await submitRetainedUtxo({ record: retained, records, session, sender: ring.syscoinTransaction, fetch: fetcher });
    assert.equal(replay.txid, txid); assert.equal(postCount, 2); assert.equal(sign.mock.callCount(), 2);
    assert(reads.every(path => !path.includes('http')));
    const calls = reads.length; current = false;
    await assert.rejects(prepareNativeDappPsbt({ method: 'sys_sign', origin, psbt: quote.psbt }, lifetime.signal, ports));
    assert.equal(reads.length, calls); assert.equal(sign.mock.callCount(), 2);
    assert.equal(deviceCalls, custody === 'Ledger' ? 2 : 0);
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally {
    lifetime.abort(); current = false;
    await ring.destroy(); await storage.close(); await rm(directory, { recursive: true, force: true });
  }
});
