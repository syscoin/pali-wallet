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
import { HDNodeWallet } from 'ethers/wallet';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  UTXO_SIGNED_RECORD_KEY,
  UtxoSignedRecords,
} from '../../../source/wallet/utxoSignedRecords.ts';
import { createNativeUtxoSend } from '../src/custody/utxoSend.ts';
import { getUtxoNetwork, getUtxoSdkNetwork } from '../src/core/utxoNetworks.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const bitcoin = syscoinUtils.bitcoinjs;

test('real native SDK HD quote, signed bytes, SQLite admission and exact ACK use the same scoped route', async () => {
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
    const network = getUtxoNetwork('bitcoin');
    const sdkNetwork = getUtxoSdkNetwork(network.id);
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
            path: "m/84'/0'/0'/0/0",
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
    const review = await send.prepare({ amount: '0.0004', recipient });
    assert.equal(review.outputs[0]?.address, recipient);
    assert.equal(review.outputs[0]?.amountSatoshis, '40000');
    assert(BigInt(review.feeSatoshis) > 0n);
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 0);
    await assert.rejects(send.confirm({ ...review }), /NOT_READY/);
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
