import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createKeyringHost, KeyringAccountType, SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { HDNodeWallet } from 'ethers/wallet';
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

test('native custody adapter uses the installed SDK, encrypted SQLite admission and original-route saved-byte replay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pali-native-psbt-'));
  const storage = await SqliteWalletStorage.open(nodeConnection(join(directory, 'wallet.sqlite')).connection, digest, INSTALLATION, true);
  const ring = new SoftwareKeyring(createKeyringHost(storage.keyringStorage), { captureEvmSubmission: null });
  const network = getUtxoNetwork('bitcoin'), sdkNetwork = getUtxoSdkNetwork(network);
  const state = { activeAccount: { id: 0, type: KeyringAccountType.HDAccount }, activeNetwork: sdkNetwork,
    accounts: { HDAccount: {} as Record<number, Awaited<ReturnType<typeof ring.initializeWalletSecurely>>>, Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {} } };
  ring.setVaultStateGetter(() => state);
  const lifetime = new AbortController();
  let current = true, failAck = true, retainedRaw = '', postCount = 0;
  const reads: string[] = [];
  try {
    const account = await ring.initializeWalletSecurely(phrase, password); state.accounts.HDAccount[0] = account;
    const profileId = await ring.getPrivateRecordProfileId();
    const root = HDNodeWallet.fromPhrase(phrase);
    const identity = await storage.recovery!.readIdentity(); assert(identity);
    await storage.recovery!.bindIdentity(identity.pairFingerprint, {
      address: root.address, publicKey: root.publicKey, profileId,
    }, () => { if (!current) throw Error('CONTEXT_CHANGED'); });
    const guard = () => { if (!current) throw Error('CONTEXT_CHANGED'); };
    const session = { keyring: ring, assertCurrent: guard };
    const owner = { chainId: network.chainId, slip44: network.slip44, genesisHash: network.genesisHash,
      account: { id: 0, type: 'HDAccount' as const, xpub: account.xpub } };
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
      session, sdk: ring.syscoinTransaction, records, fetch: fetcher, collateral: null, sentry: null };
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
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally {
    lifetime.abort(); current = false;
    await ring.destroy(); await storage.close(); await rm(directory, { recursive: true, force: true });
  }
});
