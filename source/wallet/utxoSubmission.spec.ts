jest.unmock('syscoinjs-lib');

import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { SyscoinTransactionsCore } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js';
import { webcrypto } from 'crypto';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { utxoInputOutpoints } from '../utils/utxoAcknowledgedInputs';

import * as signedBundle from './utxoSignedBundle';
import {
  inspectUtxoSignedBundle,
  UtxoSignedRecords,
  type UtxoDurableSubmission,
  type UtxoRecordSession,
} from './utxoSignedRecords';
import { submitReviewedUtxo } from './utxoSubmission';

const bitcoin = syscoinUtils.bitcoinjs;
const endpoint = 'https://offline.invalid';
const url = `${endpoint}/api/v2/sendtx/`;
const owner = {
  chainId: 0,
  slip44: 0,
  genesisHash: 'a'.repeat(64),
  account: { id: 0, type: 'HDAccount', xpub: 'public-fixture-xpub' },
};
const guard = () => undefined;
const deferred = () => {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { finish, promise };
};

function record(sequence = 0xfffffffd): UtxoDurableSubmission {
  const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 3));
  const address = bitcoin.payments.p2wpkh({ pubkey: key.publicKey });
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 4), 0);
  previous.addOutput(address.output, BigInt(10000));
  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: previous.getHash(),
    index: 0,
    sequence,
    witnessUtxo: { value: BigInt(10000), script: address.output },
  });
  psbt.addOutput({ script: address.output, value: BigInt(9000) });
  psbt.signInput(0, key).finalizeAllInputs();
  const signed = psbt.extractTransaction();
  return {
    owner,
    operation: 'wallet',
    url,
    rawTransaction: signed.toHex(),
    txid: signed.getId(),
    virtualSize: signed.virtualSize(),
    feeSatoshis: '1000',
    outpoints: utxoInputOutpoints(signed.ins),
  };
}

function context() {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const secret = new Uint8Array(32).fill(42);
  const session: UtxoRecordSession = {
    assertCurrent: guard,
    keyring: {
      getPrivateRecordProfileId: () => privateRecordProfileId(secret, guard),
      encryptPrivateRecord: (params) =>
        encryptPrivateRecordBytes(secret, params, guard),
      decryptPrivateRecord: (params) =>
        decryptPrivateRecordBytes(secret, params, guard),
    },
  };
  let disk: string | undefined;
  const cas = jest.fn(
    async (
      _profile: string,
      expected: string | undefined,
      next: string,
      current: () => void
    ) => {
      current();
      if (disk !== expected) return false;
      disk = next;
      return true;
    }
  );
  const storage = { read: async () => disk, compareAndSet: cas };
  const records = new UtxoSignedRecords(storage);
  const unavailable = () => {
    throw new Error('An already signed submission cannot request a signer');
  };
  const sender = new SyscoinTransactionsCore(
    unavailable,
    unavailable,
    () =>
      ({
        activeAccountId: 0,
        activeAccountType: 'HDAccount',
        accounts: {
          HDAccount: {
            0: { address: 'public-fixture-address', xpub: owner.account.xpub },
          },
        },
        activeNetwork: {
          kind: 'syscoin',
          chainId: 0,
          slip44: 0,
          url: endpoint,
          currency: 'btc',
        },
      } as never),
    {},
    () => guard
  );
  const response = (txid: string) => {
    const reply = Response.json({ result: txid });
    Object.defineProperty(reply, 'url', { value: url });
    return reply;
  };
  return { session, sender, records, cas, storage, response };
}

it('persists before the first POST and returns the exact ACK while its marker is held', async () => {
  const c = context(),
    transaction = record();
  const entered = deferred(),
    commit = deferred(),
    marker = deferred(),
    finishMarker = deferred();
  const persist = c.cas.getMockImplementation()!;
  c.cas.mockImplementationOnce(async (...args) => {
    entered.finish();
    await commit.promise;
    return persist(...args);
  });
  c.cas.mockImplementationOnce(async (...args) => {
    marker.finish();
    await finishMarker.promise;
    return persist(...args);
  });
  const fetch = jest.fn(async () => c.response(transaction.txid));
  const sending = submitReviewedUtxo({
    ...c,
    record: transaction,
    intent: 'initial',
    fetch,
  });
  await entered.promise;
  expect(fetch).not.toHaveBeenCalled();
  commit.finish();
  await expect(sending).resolves.toEqual({ txid: transaction.txid });
  await marker.promise;
  expect(fetch).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      method: 'POST',
      body: transaction.rawTransaction,
    })
  );
  expect(await c.records.readExact(c.session, owner, transaction.txid)).toEqual(
    transaction
  );
  finishMarker.finish();
});

it('never POSTs when authority is revoked before the durable commit', async () => {
  const c = context(),
    transaction = record(),
    entered = deferred(),
    resume = deferred();
  let active = true;
  const session = {
    ...c.session,
    assertCurrent() {
      if (!active) throw new Error('revoked');
    },
  };
  const persist = c.cas.getMockImplementation()!;
  c.cas.mockImplementationOnce(async (...args) => {
    entered.finish();
    await resume.promise;
    return persist(...args);
  });
  const fetch = jest.fn(async () => c.response(transaction.txid));
  const pending = submitReviewedUtxo({
    ...c,
    session,
    record: transaction,
    intent: 'initial',
    fetch,
  });
  const rejected = expect(pending).rejects.toMatchObject({
    code: 'UTXO_SUBMISSION_NOT_DISPATCHED',
    transactionNotBroadcast: true,
  });
  await entered.promise;
  active = false;
  resume.finish();
  await rejected;
  expect(fetch).not.toHaveBeenCalled();
  expect(await c.storage.read()).toBeUndefined();
});

it('retains unknown bytes, fences ordinary overlap and permits separately authorized RBF', async () => {
  const c = context(),
    transaction = record(),
    replacement = record(0xfffffffc);
  const fetch = jest.fn(async () => c.response('b'.repeat(64)));
  await expect(
    submitReviewedUtxo({ ...c, record: transaction, intent: 'initial', fetch })
  ).rejects.toMatchObject({
    code: 'UTXO_SUBMISSION_UNKNOWN',
    transactionNotBroadcast: false,
    txid: transaction.txid,
  });
  const reopened = new UtxoSignedRecords(c.storage);
  expect(await reopened.readExact(c.session, owner, transaction.txid)).toEqual(
    transaction
  );
  expect(await reopened.excludedOutpoints(c.session, owner)).toEqual([
    { txid: transaction.outpoints[0].slice(0, 64), vout: 0 },
  ]);
  await expect(reopened.persist(c.session, replacement)).rejects.toThrow(
    'UTXO_SIGNED_OUTPOINT_PENDING'
  );
  await expect(
    reopened.persist(c.session, { ...replacement, operation: 'external' })
  ).resolves.toBeUndefined();
  const sameGenesisOtherChain = { ...owner, chainId: 156, slip44: 156 };
  await expect(
    reopened.persist(c.session, {
      ...transaction,
      owner: sameGenesisOtherChain,
    })
  ).resolves.toBeUndefined();
  expect(await reopened.list(c.session, sameGenesisOtherChain)).toEqual([
    { txid: transaction.txid, accepted: false },
  ]);
});

it('keeps the replay record through synchronous POST while confirmed-only reclaim waits', async () => {
  const capacity = jest.replaceProperty(signedBundle, 'MAX_RECORDS', 2);
  const c = context(),
    transaction = record();
  await c.records.persist(c.session, transaction);
  await c.records.observe(
    c.session,
    owner,
    transaction.txid,
    url,
    async () => ({
      txid: transaction.txid,
      hex: transaction.rawTransaction,
      confirmations: 1,
      blockHash: 'f'.repeat(64),
    })
  );
  const another = {
    ...transaction,
    owner: { ...owner, chainId: 156, slip44: 156 },
  };
  await c.records.persist(c.session, another);
  const entered = deferred(),
    resume = deferred(),
    posted = deferred(),
    reply = deferred();
  const original = c.session.keyring.decryptPrivateRecord;
  const session = {
    ...c.session,
    keyring: {
      ...c.session.keyring,
      async decryptPrivateRecord(params: Parameters<typeof original>[0]) {
        if (params.recordId.endsWith('/0')) {
          entered.finish();
          await resume.promise;
        }
        return original(params);
      },
    },
  };
  const fetch = jest.fn(async () => {
    posted.finish();
    await reply.promise;
    return c.response(transaction.txid);
  });
  const sending = submitReviewedUtxo({
    ...c,
    record: transaction,
    session,
    intent: 'replay',
    fetch,
  });
  await entered.promise;
  const competing = new UtxoSignedRecords(c.storage).persist(c.session, {
    ...record(0xfffffffc),
    operation: 'external',
  });
  try {
    expect(c.cas).toHaveBeenCalledTimes(3);
    resume.finish();
    await posted.promise;
    await expect(competing).resolves.toBeUndefined();
    expect(
      await c.records.readExact(c.session, owner, transaction.txid)
    ).toBeUndefined();
    expect(
      await c.records.readExact(c.session, another.owner, another.txid)
    ).toEqual(another);
    reply.finish();
    await expect(sending).resolves.toEqual({ txid: transaction.txid });
  } finally {
    resume.finish();
    reply.finish();
    capacity.restore();
  }
});

it('uses only a matching exact-raw observation to mark a confirmation and can observe a reorg', async () => {
  const c = context(),
    transaction = record();
  await c.records.persist(c.session, transaction);
  const profile = await c.session.keyring.getPrivateRecordProfileId();
  const storedPhase = async () =>
    inspectUtxoSignedBundle((await c.storage.read())!, profile).entries[0]
      .phase;
  const observed = {
    txid: transaction.txid,
    hex: transaction.rawTransaction,
    confirmations: 1,
    blockHash: 'f'.repeat(64),
  };
  await expect(
    c.records.observe(c.session, owner, transaction.txid, url, async () => ({
      ...observed,
      hex: 'bad',
    }))
  ).resolves.toBe('unknown');
  expect(await storedPhase()).toBe('pending');
  await expect(
    c.records.observe(
      c.session,
      owner,
      transaction.txid,
      url,
      async () => observed
    )
  ).resolves.toBe('confirmed');
  expect(await storedPhase()).toBe('confirmed');
  await expect(
    c.records.observe(c.session, owner, transaction.txid, url, async () => ({
      ...observed,
      confirmations: 0,
    }))
  ).resolves.toBe('seen');
  expect(await storedPhase()).toBe('submitted');
});

it('cannot re-mark a later reorg as confirmed with an older held observation', async () => {
  const c = context(),
    transaction = record(),
    entered = deferred(),
    finish = deferred();
  await c.records.persist(c.session, transaction);
  const observed = {
    txid: transaction.txid,
    hex: transaction.rawTransaction,
    confirmations: 1,
    blockHash: 'f'.repeat(64),
  };
  const older = c.records.observe(
    c.session,
    owner,
    transaction.txid,
    url,
    async () => {
      entered.finish();
      await finish.promise;
      return observed;
    }
  );
  const superseded = expect(older).rejects.toThrow('UTXO observation changed');
  await entered.promise;
  await expect(
    c.records.observe(c.session, owner, transaction.txid, url, async () => ({
      ...observed,
      confirmations: 0,
    }))
  ).resolves.toBe('seen');
  finish.finish();
  await superseded;
  const profile = await c.session.keyring.getPrivateRecordProfileId();
  expect(
    inspectUtxoSignedBundle((await c.storage.read())!, profile).entries[0].phase
  ).toBe('submitted');
});
