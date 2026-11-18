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

import { withoutSignatures } from './utxoSignedBinding';
import * as signedBundle from './utxoSignedBundle';
import {
  inspectUtxoSignedBundle,
  UtxoSignedRecords,
  type UtxoDurableSubmission,
  type UtxoRecordSession,
} from './utxoSignedRecords';
import {
  createUtxoSubmissionDisposition,
  observeRetainedUtxo,
  reconcileRetainedUtxo,
  submitReviewedUtxo,
} from './utxoSubmission';

const bitcoin = syscoinUtils.bitcoinjs;
const endpoint = 'https://offline.invalid';
const url = `${endpoint}/api/v2/sendtx/`;
const btcGenesis =
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const owner = {
  chainId: 0,
  slip44: 0,
  genesisHash: btcGenesis,
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

function record(sequence = 0xfffffffd, fee = 1000): UtxoDurableSubmission {
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
  psbt.addOutput({ script: address.output, value: BigInt(10000 - fee) });
  psbt.signInput(0, key).finalizeAllInputs();
  const signed = psbt.extractTransaction();
  return {
    owner,
    operation: 'wallet',
    url,
    rawTransaction: signed.toHex(),
    txid: signed.getId(),
    virtualSize: signed.virtualSize(),
    feeSatoshis: String(fee),
    outpoints: utxoInputOutpoints(signed.ins),
  };
}

function unsignedRecord({
  rawTransaction,
  ...metadata
}: UtxoDurableSubmission) {
  return {
    ...metadata,
    version: 2 as const,
    unsignedTransaction: withoutSignatures(
      bitcoin.Transaction.fromHex(rawTransaction)
    ),
    signedDigest: signedBundle.digest(rawTransaction),
  };
}

it('tracks only the exact validated POST and never resets or adopts a second transaction', async () => {
  const tracker = createUtxoSubmissionDisposition();
  const expected = record();
  const fetch = jest.fn(async () => {
    throw new Error('Reply lost');
  });
  const post = tracker.trackPost(expected, fetch);
  expect(tracker.read()).toEqual({ transactionNotBroadcast: true });
  expect(() => post(expected.url, { method: 'GET' })).toThrow(
    'Invalid owned UTXO POST'
  );
  expect(() =>
    post(expected.url, { method: 'POST', body: expected.rawTransaction + '00' })
  ).toThrow('Invalid owned UTXO POST');
  expect(tracker.read()).toEqual({ transactionNotBroadcast: true });
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    post(expected.url, { method: 'POST', body: expected.rawTransaction })
  ).rejects.toThrow('Reply lost');
  expect(tracker.read()).toEqual({
    transactionNotBroadcast: false,
    txid: expected.txid,
  });
  const successor = record(0xffffffff);
  const second = tracker.trackPost(successor, fetch);
  expect(() =>
    second(successor.url, { method: 'POST', body: successor.rawTransaction })
  ).toThrow('Invalid owned UTXO POST');
  expect(tracker.read()).toEqual({
    transactionNotBroadcast: false,
    txid: expected.txid,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

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
  const records = new UtxoSignedRecords(storage, storage);
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
          utxoBackendChain: 'main',
        },
      } as never),
    {},
    () => guard,
    'session',
    guard
  );
  const response = (txid: string) => {
    const reply = Response.json({ result: txid });
    Object.defineProperty(reply, 'url', { value: url });
    return reply;
  };
  return { session, sender, records, cas, storage, response };
}

it('rejects dispatching a previously retained transaction as a new transfer', async () => {
  const c = context();
  const transaction = record();
  await c.records.persist(c.session, transaction);
  const fetch = jest.fn(async () => c.response(transaction.txid));
  const request = { ...c, record: transaction, fetch };
  await expect(submitReviewedUtxo(request)).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('submits one reviewed replacement and keeps exact custody for its next fee bump', async () => {
  const c = context();
  const original = record();
  await c.records.persist(c.session, original);
  await expect(
    c.records.replacementCandidate(c.session, owner, original.txid)
  ).resolves.toBeUndefined();
  await c.records.acknowledge(c.session, owner, original.txid);
  await expect(
    c.records.replacementCandidate(c.session, owner, original.txid)
  ).resolves.toEqual(unsignedRecord(original));
  const replacement = {
    ...record(0xfffffffd, 1200),
    replacementOf: original.txid,
  };
  const competing = {
    ...record(0xfffffffd, 1250),
    replacementOf: original.txid,
  };
  const fetch = jest.fn(async () => c.response(replacement.txid));
  const [a, b] = await Promise.allSettled([
    submitReviewedUtxo({ ...c, record: replacement, fetch }),
    submitReviewedUtxo({ ...c, record: competing, fetch }),
  ]);
  expect(a).toEqual({ status: 'fulfilled', value: { txid: replacement.txid } });
  expect(b).toMatchObject({
    status: 'rejected',
    reason: {
      code: 'UTXO_SIGNED_REPLACEMENT_CHANGED',
      transactionNotBroadcast: true,
    },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await c.records.readExact(c.session, owner, replacement.txid)).toEqual(
    unsignedRecord(replacement)
  );
  await c.records.acknowledge(c.session, owner, replacement.txid);
  const third = {
    ...record(0xfffffffd, 1400),
    replacementOf: replacement.txid,
  };
  await c.records.persist(c.session, third);
  await expect(
    c.records.replacementCandidate(c.session, owner, original.txid)
  ).resolves.toBeUndefined();
  await expect(
    c.records.replacementCandidate(c.session, owner, replacement.txid)
  ).resolves.toBeUndefined();
  await c.records.observeRetained(
    c.session,
    owner,
    replacement.txid,
    async () => ({
      txid: replacement.txid,
      hex: replacement.rawTransaction,
      confirmations: 1,
      blockHash: 'ab'.repeat(32),
    })
  );
  expect(await c.records.list(c.session, owner)).toEqual([]);
  expect(
    await c.records.readExact(c.session, owner, original.txid)
  ).toBeDefined();
  // Reorg observations restore the reservation. The newer signed candidate
  // still owns the group until its status can be determined.
  await c.records.observeRetained(
    c.session,
    owner,
    replacement.txid,
    async () => ({
      txid: replacement.txid,
      hex: replacement.rawTransaction,
      confirmations: 0,
    })
  );
  expect(await c.records.list(c.session, owner)).toHaveLength(3);
});

it('rejects replacement admission if the predecessor opted out, the bytes changed, or the fee fell', async () => {
  const c = context();
  const original = record();
  await c.records.persist(c.session, original);
  await c.records.acknowledge(c.session, owner, original.txid);
  for (const changed of [
    record(0xfffffffd, 950),
    record(0xffffffff, 1200),
    { ...record(0xfffffffd, 1200), url: url.replace('offline', 'changed') },
  ]) {
    await expect(
      c.records.persist(c.session, { ...changed, replacementOf: original.txid })
    ).rejects.toThrow('UTXO_SIGNED_REPLACEMENT_CHANGED');
  }
  const other = context();
  const nonreplaceable = record(0xffffffff);
  await other.records.persist(other.session, nonreplaceable);
  await other.records.acknowledge(other.session, owner, nonreplaceable.txid);
  await expect(
    other.records.replacementCandidate(
      other.session,
      owner,
      nonreplaceable.txid
    )
  ).resolves.toBeUndefined();
  await expect(
    other.records.persist(other.session, {
      ...record(0xffffffff, 1200),
      replacementOf: nonreplaceable.txid,
    })
  ).rejects.toThrow('UTXO_SIGNED_REPLACEMENT_CHANGED');
  await expect(
    c.records.observeRetained(c.session, owner, original.txid, async () => ({
      txid: original.txid,
      hex: original.rawTransaction,
      confirmations: 1,
    }))
  ).resolves.toBe('unknown');
});

it.each(['Ledger', 'Trezor'])(
  'admits a replacement only in the original %s account',
  async (type) => {
    const c = context();
    const deviceOwner = { ...owner, account: { ...owner.account, type } };
    const original = { ...record(), owner: deviceOwner };
    await c.records.persist(c.session, original);
    await c.records.acknowledge(c.session, deviceOwner, original.txid);
    await expect(
      c.records.replacementCandidate(c.session, owner, original.txid)
    ).resolves.toBeUndefined();
    await expect(
      c.records.replacementCandidate(c.session, deviceOwner, original.txid)
    ).resolves.toEqual(unsignedRecord(original));

    const replacement = {
      ...record(0xfffffffd, 1200),
      replacementOf: original.txid,
    };
    await expect(c.records.persist(c.session, replacement)).rejects.toThrow(
      'UTXO_SIGNED_REPLACEMENT_CHANGED'
    );
    await c.records.persist(c.session, { ...replacement, owner: deviceOwner });
    await expect(
      c.records.readExact(c.session, deviceOwner, replacement.txid)
    ).resolves.toEqual(unsignedRecord({ ...replacement, owner: deviceOwner }));
  }
);

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
    unsignedRecord(transaction)
  );
  finishMarker.finish();
});

it('atomically replaces a legacy encrypted transaction with unsigned recovery metadata', async () => {
  const { records, session, storage } = context();
  const transaction = record();
  const profile = await session.keyring.getPrivateRecordProfileId();
  await records.persist(session, transaction);
  await records.acknowledge(session, owner, transaction.txid);

  const modernRaw = (await storage.read())!;
  const modern = inspectUtxoSignedBundle(modernRaw, profile);
  const [entry] = modern.entries;
  const legacyEntries = [
    {
      ...entry,
      chunks: [
        await session.keyring.encryptPrivateRecord({
          domain: signedBundle.CHUNK_DOMAIN,
          recordId: `${entry.key}/0`,
          plaintext: new TextEncoder().encode(JSON.stringify(transaction)),
        }),
      ],
    },
  ];
  const legacyRoot = await session.keyring.encryptPrivateRecord({
    domain: signedBundle.ROOT_DOMAIN,
    recordId: 'manifest',
    plaintext: new TextEncoder().encode(
      JSON.stringify([
        modern.revision,
        signedBundle.entriesDigest(legacyEntries),
      ])
    ),
  });
  const legacyRaw = JSON.stringify({
    ...modern,
    version: 1,
    root: legacyRoot,
    entries: legacyEntries,
  });
  await storage.compareAndSet(profile, modernRaw, legacyRaw, guard);
  const reopened = new UtxoSignedRecords(storage, storage);
  await reopened.validate(session);
  expect(await storage.read()).toBe(legacyRaw);
  await reopened.migrate(session);
  const migrated = inspectUtxoSignedBundle((await storage.read())!, profile);
  expect(migrated.version).toBe(2);
  expect(migrated.revision).toBe(modern.revision + 1);
  expect(migrated.entries[0].phase).toBe('submitted');
  const retained = await session.keyring.decryptPrivateRecord({
    domain: signedBundle.CHUNK_DOMAIN,
    recordId: `${entry.key}/0`,
    envelope: migrated.entries[0].chunks[0]!,
  });
  const plaintext = JSON.parse(new TextDecoder().decode(retained));
  expect({
    ...plaintext,
    txid: transaction.txid,
    outpoints: transaction.outpoints,
  }).toEqual(unsignedRecord(transaction));
  expect(plaintext).not.toHaveProperty('rawTransaction');
  expect(await reopened.readExact(session, owner, transaction.txid)).toEqual(
    unsignedRecord(transaction)
  );
});

it('retains a trusted acknowledgment for the same owner after reopening', async () => {
  const c = context();
  const transaction = record();
  await expect(
    submitReviewedUtxo({
      ...c,
      record: transaction,
      fetch: async () => c.response(transaction.txid),
    })
  ).resolves.toEqual({ txid: transaction.txid });
  // Join the same admission queue after the detached acknowledgment writer.
  await expect(
    c.records.hasUnresolvedForAccount(c.session, owner.slip44, owner.account)
  ).resolves.toBe(true);
  const reopened = new UtxoSignedRecords(c.storage, c.storage);
  const outpoints = [{ txid: transaction.outpoints[0].slice(0, 64), vout: 0 }];
  expect(await reopened.fundingExclusions(c.session, owner)).toEqual({
    outpoints,
    submitted: new Set(transaction.outpoints),
  });
  expect(
    await reopened.fundingExclusions(c.session, {
      ...owner,
      account: { ...owner.account, id: owner.account.id + 1 },
    })
  ).toEqual({ outpoints, submitted: new Set() });
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

it('releases only a fresh reservation when the dispatch closes without POST', async () => {
  const c = context();
  const transaction = record();
  let latePost: (() => Promise<Response>) | undefined;
  const fetch = jest.fn(async () => c.response(transaction.txid));
  type Sender = Parameters<typeof submitReviewedUtxo>[0]['sender'];
  const sender: Sender = {
    async sendTransaction(raw, authority) {
      await authority.prepare({
        url,
        txid: transaction.txid,
        rawTransaction: raw,
      });
      latePost = () =>
        authority.fetch(url, {
          method: 'POST',
          signal: authority.signal,
          body: raw,
        });
      throw new Error('SDK stopped before dispatch');
    },
  };
  await expect(
    submitReviewedUtxo({ ...c, sender, record: transaction, fetch })
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  await expect(latePost!()).rejects.toThrow('Invalid owned UTXO POST');
  expect(fetch).not.toHaveBeenCalled();
  expect(await c.records.list(c.session, owner)).toEqual([]);
  expect(
    (await c.records.fundingExclusions(c.session, owner)).outpoints
  ).toEqual([]);
  const replacement = record(0xfffffffc);
  await expect(
    c.records.persist(c.session, replacement)
  ).resolves.toBeUndefined();

  await expect(
    submitReviewedUtxo({ ...c, record: replacement, fetch })
  ).rejects.toMatchObject({ code: 'UTXO_SIGNED_RECORD_ALREADY_RETAINED' });
  expect(await c.records.readExact(c.session, owner, replacement.txid)).toEqual(
    unsignedRecord(replacement)
  );
});

it('waits for an unjoined prepare before releasing an undispatched reservation', async () => {
  const c = context();
  const transaction = record();
  const entered = deferred();
  const resume = deferred();
  const commit = c.cas.getMockImplementation()!;
  c.cas.mockImplementationOnce(async (...args) => {
    entered.finish();
    await resume.promise;
    return commit(...args);
  });
  type Sender = Parameters<typeof submitReviewedUtxo>[0]['sender'];
  const sender: Sender = {
    async sendTransaction(raw, authority) {
      void authority.prepare({
        url,
        txid: transaction.txid,
        rawTransaction: raw,
      });
      await entered.promise;
      throw new Error('SDK stopped with preparation in progress');
    },
  };
  const fetch = jest.fn(async () => c.response(transaction.txid));
  const pending = submitReviewedUtxo({
    ...c,
    sender,
    record: transaction,
    fetch,
  });
  await entered.promise;
  resume.finish();
  await expect(pending).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(await c.records.list(c.session, owner)).toEqual([]);
  expect(c.cas).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['failed CAS', 'external PSBT'] as const)(
  'preserves a fresh reservation without POST for %s',
  async (reason) => {
    const c = context();
    const transaction = {
      ...record(),
      operation:
        reason === 'external PSBT'
          ? ('external' as const)
          : ('wallet' as const),
    };
    const commit = c.cas.getMockImplementation()!;
    if (reason === 'failed CAS')
      c.cas
        .mockImplementation(async () => false)
        .mockImplementationOnce(commit);
    type Sender = Parameters<typeof submitReviewedUtxo>[0]['sender'];
    const sender: Sender = {
      async sendTransaction(raw, authority) {
        await authority.prepare({
          url,
          txid: transaction.txid,
          rawTransaction: raw,
        });
        throw new Error('SDK stopped before dispatch');
      },
    };
    const fetch = jest.fn(async () => c.response(transaction.txid));
    await expect(
      submitReviewedUtxo({ ...c, sender, record: transaction, fetch })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(
      await c.records.readExact(c.session, owner, transaction.txid)
    ).toEqual(unsignedRecord(transaction));
    expect(c.cas).toHaveBeenCalledTimes(reason === 'failed CAS' ? 4 : 1);
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('retains unknown transaction metadata, fences ordinary overlap and permits separately authorized RBF', async () => {
  const c = context(),
    transaction = record(),
    replacement = record(0xfffffffc);
  const fetch = jest.fn(async () => c.response('b'.repeat(64)));
  await expect(
    submitReviewedUtxo({ ...c, record: transaction, fetch })
  ).rejects.toMatchObject({
    code: 'UTXO_SUBMISSION_UNKNOWN',
    transactionNotBroadcast: false,
    txid: transaction.txid,
  });
  const reopened = new UtxoSignedRecords(c.storage, c.storage);
  expect(await reopened.readExact(c.session, owner, transaction.txid)).toEqual(
    unsignedRecord(transaction)
  );
  expect(await reopened.fundingExclusions(c.session, owner)).toEqual({
    outpoints: [{ txid: transaction.outpoints[0].slice(0, 64), vout: 0 }],
    submitted: new Set(),
  });
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
    c.records.observeRetained(c.session, owner, transaction.txid, async () => ({
      ...observed,
      hex: 'bad',
    }))
  ).resolves.toBe('unknown');
  expect(await storedPhase()).toBe('pending');
  await expect(
    c.records.observeRetained(
      c.session,
      owner,
      transaction.txid,
      async () => observed
    )
  ).resolves.toBe('confirmed');
  expect(await storedPhase()).toBe('confirmed');
  await expect(
    c.records.observeRetained(c.session, owner, transaction.txid, async () => ({
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
  const older = c.records.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => {
      entered.finish();
      await finish.promise;
      return observed;
    }
  );
  const superseded = expect(older).rejects.toThrow('UTXO observation changed');
  await entered.promise;
  await expect(
    c.records.observeRetained(c.session, owner, transaction.txid, async () => ({
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

it('retains previously confirmed metadata when their current owned observation is unknown', async () => {
  const capacity = jest.replaceProperty(
    signedBundle as { MAX_RECORDS: number },
    'MAX_RECORDS',
    1
  );
  try {
    const c = context();
    const transaction = record();
    await c.records.persist(c.session, transaction);
    await expect(
      c.records.observeRetained(
        c.session,
        owner,
        transaction.txid,
        async () => ({
          txid: transaction.txid,
          hex: transaction.rawTransaction,
          confirmations: 1,
          blockHash: 'f'.repeat(64),
        })
      )
    ).resolves.toBe('confirmed');

    const fetchMissing = jest.fn(async () => null);
    await expect(
      c.records.observeRetained(
        c.session,
        { ...owner, account: { ...owner.account, id: 1 } },
        transaction.txid,
        fetchMissing
      )
    ).resolves.toBe('unknown');
    expect(fetchMissing).not.toHaveBeenCalled();
    expect(
      (await c.records.fundingExclusions(c.session, owner)).outpoints
    ).toEqual([]);

    await expect(
      c.records.observeRetained(
        c.session,
        owner,
        transaction.txid,
        fetchMissing
      )
    ).resolves.toBe('unknown');
    const reopened = new UtxoSignedRecords(c.storage, c.storage);
    await expect(
      reopened.persist(c.session, {
        ...record(0xfffffffa),
        operation: 'external',
      })
    ).rejects.toThrow('UTXO_SIGNED_RECORD_CAPACITY');
    expect(
      (await reopened.fundingExclusions(c.session, owner)).outpoints
    ).toEqual([{ txid: transaction.outpoints[0]!.slice(0, 64), vout: 0 }]);
    expect(
      await reopened.readExact(c.session, owner, transaction.txid)
    ).toEqual(unsignedRecord(transaction));
  } finally {
    capacity.restore();
  }
});

it('protects exact previously confirmed identity after a current Blockbook read rejects', async () => {
  const capacity = jest.replaceProperty(
    signedBundle as { MAX_RECORDS: number },
    'MAX_RECORDS',
    1
  );
  try {
    const c = context();
    const transaction = record();
    await c.records.persist(c.session, transaction);
    await c.records.observeRetained(
      c.session,
      owner,
      transaction.txid,
      async () => ({
        txid: transaction.txid,
        hex: transaction.rawTransaction,
        confirmations: 1,
        blockHash: 'f'.repeat(64),
      })
    );

    const fetch = jest.fn(async () => {
      throw new TypeError('Blockbook network connection failed');
    });
    const observation = await c.records
      .observeRetained(c.session, owner, transaction.txid, fetch)
      .catch((error) => error);
    const reopened = new UtxoSignedRecords(c.storage, c.storage);
    await expect(
      reopened.persist(c.session, {
        ...record(0xfffffffa),
        operation: 'external',
      })
    ).rejects.toThrow('UTXO_SIGNED_RECORD_CAPACITY');
    expect(observation).toBe('unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await reopened.readExact(c.session, owner, transaction.txid)
    ).toEqual(unsignedRecord(transaction));
  } finally {
    capacity.restore();
  }
});

it('does not write an observation if its owner was revoked during a failed read', async () => {
  const c = context();
  const transaction = record();
  await c.records.persist(c.session, transaction);
  await c.records.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => ({
      txid: transaction.txid,
      hex: transaction.rawTransaction,
      confirmations: 1,
      blockHash: 'f'.repeat(64),
    })
  );
  const before = await c.storage.read();
  const controller = new AbortController();
  const cancelled = new Error('Wallet owner revoked');
  const session = {
    ...c.session,
    assertCurrent: () => {
      if (controller.signal.aborted) throw cancelled;
    },
  };
  await expect(
    c.records.observeRetained(session, owner, transaction.txid, async () => {
      controller.abort();
      throw new Error('Request aborted');
    })
  ).rejects.toBe(cancelled);
  expect(await c.storage.read()).toBe(before);
});

it('propagates a storage failure when retiring an unverifiable confirmation', async () => {
  const c = context();
  const transaction = record();
  await c.records.persist(c.session, transaction);
  await c.records.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => ({
      txid: transaction.txid,
      hex: transaction.rawTransaction,
      confirmations: 1,
      blockHash: 'f'.repeat(64),
    })
  );
  c.cas.mockRejectedValueOnce(new Error('STORAGE_REOPEN_REQUIRED'));
  await expect(
    c.records.observeRetained(c.session, owner, transaction.txid, async () => {
      throw new Error('Network unavailable');
    })
  ).rejects.toThrow('UTXO_SIGNED_RECORD_REOPEN_REQUIRED');
  expect(c.records.requiresReopen).toBe(true);
});

it('does not erase an existing submission acknowledgment on an unknown observation', async () => {
  const c = context();
  const transaction = record();
  await c.records.persist(c.session, transaction);
  await c.records.acknowledge(c.session, owner, transaction.txid);
  const writes = c.cas.mock.calls.length;
  await expect(
    c.records.observeRetained(
      c.session,
      owner,
      transaction.txid,
      async () => null
    )
  ).resolves.toBe('unknown');
  expect(c.cas).toHaveBeenCalledTimes(writes);
  expect(await c.records.list(c.session, owner)).toEqual([
    { txid: transaction.txid, accepted: true },
  ]);
});

it('keeps a newer confirmation when an older unknown observation loses ownership before commit', async () => {
  const c = context();
  const transaction = record();
  const confirmed = {
    txid: transaction.txid,
    hex: transaction.rawTransaction,
    confirmations: 1,
    blockHash: 'f'.repeat(64),
  };
  await c.records.persist(c.session, transaction);
  await c.records.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => confirmed
  );
  const entered = deferred();
  const resume = deferred();
  const commit = c.cas.getMockImplementation()!;
  c.cas.mockImplementationOnce(async (...args) => {
    entered.finish();
    await resume.promise;
    return commit(...args);
  });
  const obsolete = c.records.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => null
  );
  const rejected = expect(obsolete).rejects.toThrow('UTXO observation changed');
  await entered.promise;
  const reopened = new UtxoSignedRecords(c.storage, c.storage);
  const newer = reopened.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => confirmed
  );
  resume.finish();
  await rejected;
  await expect(newer).resolves.toBe('confirmed');
  expect(
    (await reopened.fundingExclusions(c.session, owner)).outpoints
  ).toEqual([]);
});

const savedBase = 'https://previous.invalid/wallet/chain';
const savedStatus = savedBase + '/api/v2/';
const savedGenesis = savedStatus + 'block-index/0';
const savedPost = savedStatus + 'sendtx/';
function identityResponse(
  responseUrl: string,
  body: unknown,
  redirected = false
): Response {
  const response = Response.json(body);
  Object.defineProperties(response, {
    url: { value: responseUrl },
    redirected: { value: redirected },
  });
  return response;
}

async function retainedFixture() {
  const c = context();
  const transaction = {
    ...record(),
    owner: { ...owner, genesisHash: btcGenesis },
    url: savedPost,
  };
  await c.records.persist(c.session, transaction);
  const transport: typeof globalThis.fetch = async (requestUrl, init) => {
    if (requestUrl === savedStatus && init?.method === 'GET')
      return identityResponse(savedStatus, {
        blockbook: { coin: 'Bitcoin', network: 'BTC', decimals: 8 },
        backend: { chain: 'main' },
      });
    if (requestUrl === savedGenesis && init?.method === 'GET')
      return identityResponse(savedGenesis, { blockHash: btcGenesis });
    if (
      requestUrl === savedStatus + 'tx/' + transaction.txid &&
      init?.method === 'GET'
    )
      return identityResponse(requestUrl, {
        txid: transaction.txid,
        hex: transaction.rawTransaction,
        confirmations: 1,
        blockHash: 'f'.repeat(64),
      });
    throw new Error('Unexpected saved transfer request');
  };
  const fetch = jest.fn(transport);
  return { ...c, transaction, fetch };
}

function savedStatusRequest(
  c: Awaited<ReturnType<typeof retainedFixture>>,
  signal = new AbortController().signal
) {
  return {
    ...c,
    backendChain: 'main',
    owner: c.transaction.owner,
    txid: c.transaction.txid,
    signal,
  };
}

it('reads a saved transfer only from its authenticated original route and never submits it', async () => {
  const c = await retainedFixture();
  const request = savedStatusRequest(c);
  await expect(
    observeRetainedUtxo({
      ...request,
      owner: { ...request.owner, account: { ...request.owner.account, id: 1 } },
    })
  ).resolves.toBe('unknown');
  expect(c.fetch).not.toHaveBeenCalled();
  await expect(observeRetainedUtxo(request)).resolves.toBe('confirmed');
  expect(
    c.fetch.mock.calls.map(([target, init]) => [target, init?.method])
  ).toEqual([
    [savedStatus, 'GET'],
    [savedGenesis, 'GET'],
    [savedStatus + 'tx/' + c.transaction.txid, 'GET'],
  ]);
  expect(
    await c.records.fundingExclusions(c.session, c.transaction.owner)
  ).toEqual({ outpoints: [], submitted: new Set() });
});

it('protects the confirmed record during an old-provider check and after an identity failure', async () => {
  const c = await retainedFixture();
  const request = savedStatusRequest(c);
  await expect(observeRetainedUtxo(request)).resolves.toBe('confirmed');
  const capacity = jest.replaceProperty(
    signedBundle as { MAX_RECORDS: number },
    'MAX_RECORDS',
    1
  );
  const entered = deferred(),
    release = deferred();
  c.fetch.mockClear().mockImplementationOnce(async () => {
    entered.finish();
    await release.promise;
    return identityResponse(savedStatus, {
      blockbook: { coin: 'Bitcoin' },
      backend: { chain: 'test' },
    });
  });
  const pending = observeRetainedUtxo(request);
  const competing = {
    ...record(0xfffffffa),
    owner: c.transaction.owner,
    operation: 'external',
  } as const;
  try {
    await Promise.race([entered.promise, pending]);
    await expect(c.records.persist(c.session, competing)).rejects.toThrow(
      'UTXO_SIGNED_RECORD_CAPACITY'
    );
    release.finish();
    await expect(pending).resolves.toBe('unknown');
    expect(c.fetch.mock.calls.map(([target]) => target)).toEqual([savedStatus]);
    await expect(c.records.persist(c.session, competing)).rejects.toThrow(
      'UTXO_SIGNED_RECORD_CAPACITY'
    );
    expect(
      await c.records.readExact(
        c.session,
        c.transaction.owner,
        c.transaction.txid
      )
    ).toEqual(unsignedRecord(c.transaction));
  } finally {
    release.finish();
    capacity.restore();
  }
});

it('keeps the prior confirmed state if the original route check loses its owner', async () => {
  const c = await retainedFixture();
  await expect(observeRetainedUtxo(savedStatusRequest(c))).resolves.toBe(
    'confirmed'
  );
  const before = await c.storage.read();
  const controller = new AbortController();
  const entered = deferred(),
    release = deferred();
  const transport = c.fetch.getMockImplementation()!;
  c.fetch.mockClear().mockImplementationOnce(async (...args) => {
    entered.finish();
    await release.promise;
    return transport(...args);
  });
  const pending = observeRetainedUtxo(savedStatusRequest(c, controller.signal));
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  try {
    await Promise.race([entered.promise, pending]);
    controller.abort();
  } finally {
    release.finish();
  }
  await rejected;
  expect(c.fetch.mock.calls.map(([target]) => target)).toEqual([savedStatus]);
  expect(await c.storage.read()).toBe(before);
});

it('refuses streamless saved-route metadata without buffering its text', async () => {
  const c = await retainedFixture();
  const response = identityResponse(savedStatus, {});
  const text = jest.spyOn(response, 'text');
  Object.defineProperty(response, 'body', { value: null });
  c.fetch.mockResolvedValueOnce(response);
  await expect(observeRetainedUtxo(savedStatusRequest(c))).resolves.toBe(
    'unknown'
  );
  expect(text).not.toHaveBeenCalled();
  expect(c.fetch).toHaveBeenCalledTimes(1);
});

it.each(['manifest', 'CAS'] as const)(
  'preserves transaction metadata when a status check starts after reclamation selection at %s',
  async (barrier) => {
    const c = await retainedFixture();
    const request = savedStatusRequest(c);
    await expect(observeRetainedUtxo(request)).resolves.toBe('confirmed');
    const capacity = jest.replaceProperty(
      signedBundle as { MAX_RECORDS: number },
      'MAX_RECORDS',
      1
    );
    const selected = deferred(),
      resumeWrite = deferred(),
      observing = deferred(),
      resumeRead = deferred();
    const hold = async () => {
      selected.finish();
      await resumeWrite.promise;
    };
    const encrypt = c.session.keyring.encryptPrivateRecord;
    const session = {
      ...c.session,
      keyring: {
        ...c.session.keyring,
        async encryptPrivateRecord(input: Parameters<typeof encrypt>[0]) {
          if (barrier === 'manifest' && input.recordId === 'manifest')
            await hold();
          return encrypt(input);
        },
      },
    };
    if (barrier === 'CAS') {
      const commit = c.cas.getMockImplementation()!;
      c.cas.mockImplementationOnce(async (...args) => {
        await hold();
        try {
          return await commit(...args);
        } catch {
          // The native adapter normalizes a caller guard rejection after rollback.
          throw new Error('STORAGE_UNAVAILABLE');
        }
      });
    }
    const competing = {
      ...record(0xfffffffa),
      owner: c.transaction.owner,
      operation: 'external',
    } as const;
    const post = jest.fn(async () => c.response(competing.txid));
    const send = submitReviewedUtxo({
      ...c,
      session,
      sender: context().sender,
      record: competing,
      fetch: post,
    });
    const rejected = expect(send).rejects.toMatchObject({
      code: 'UTXO_SIGNED_RECORD_CAPACITY',
      transactionNotBroadcast: true,
    });
    try {
      await Promise.race([selected.promise, send]);
      c.fetch.mockClear().mockImplementationOnce(async () => {
        observing.finish();
        await resumeRead.promise;
        return identityResponse(savedStatus, {
          blockbook: { coin: 'Bitcoin' },
          backend: { chain: 'test' },
        });
      });
      const status = observeRetainedUtxo(request);
      void status.catch(() => undefined);
      await Promise.race([observing.promise, status]);
      resumeWrite.finish();
      await rejected;
      expect(post).not.toHaveBeenCalled();
      resumeRead.finish();
      await expect(status).resolves.toBe('unknown');
      expect(
        await c.records.readExact(
          c.session,
          c.transaction.owner,
          c.transaction.txid
        )
      ).toEqual(unsignedRecord(c.transaction));
      expect(
        await c.records.readExact(c.session, competing.owner, competing.txid)
      ).toBeUndefined();
    } finally {
      resumeWrite.finish();
      resumeRead.finish();
      capacity.restore();
    }
  }
);

it('reclaims an unobserved confirmed record when the journal needs space', async () => {
  const c = await retainedFixture();
  await expect(observeRetainedUtxo(savedStatusRequest(c))).resolves.toBe(
    'confirmed'
  );
  const capacity = jest.replaceProperty(
    signedBundle as { MAX_RECORDS: number },
    'MAX_RECORDS',
    1
  );
  const competing = {
    ...record(0xfffffffa),
    owner: c.transaction.owner,
    operation: 'external',
  } as const;
  try {
    await expect(
      c.records.persist(c.session, competing)
    ).resolves.toBeUndefined();
    expect(
      await c.records.readExact(
        c.session,
        c.transaction.owner,
        c.transaction.txid
      )
    ).toBeUndefined();
    expect(
      await c.records.readExact(c.session, competing.owner, competing.txid)
    ).toEqual(unsignedRecord(competing));
  } finally {
    capacity.restore();
  }
});

it('hides confirmed recovery rows, retains their metadata, and restores them after a reorg and reopen', async () => {
  const c = await retainedFixture();
  await reconcileRetainedUtxo(savedStatusRequest(c));
  expect(await c.records.list(c.session, c.transaction.owner)).toEqual([]);
  expect(
    await c.records.readExact(
      c.session,
      c.transaction.owner,
      c.transaction.txid
    )
  ).toEqual(unsignedRecord(c.transaction));
  const reopened = new UtxoSignedRecords(c.storage, c.storage);
  const transport = c.fetch.getMockImplementation()!;
  c.fetch.mockImplementation(async (target, init) =>
    target === savedStatus + 'tx/' + c.transaction.txid
      ? identityResponse(String(target), {
          txid: c.transaction.txid,
          hex: c.transaction.rawTransaction,
          confirmations: 0,
        })
      : transport(target, init)
  );
  await reconcileRetainedUtxo({ ...savedStatusRequest(c), records: reopened });
  expect(await reopened.list(c.session, c.transaction.owner)).toEqual([
    { txid: c.transaction.txid, accepted: true },
  ]);
  expect(
    (
      await reopened.fundingExclusions(c.session, c.transaction.owner)
    ).outpoints.map(({ txid, vout }) => `${txid}:${vout}`)
  ).toEqual(c.transaction.outpoints);
  c.fetch.mockImplementation(transport);
  await reconcileRetainedUtxo({ ...savedStatusRequest(c), records: reopened });
  expect(await reopened.list(c.session, c.transaction.owner)).toEqual([]);
  expect(c.fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(
    true
  );
});

it('keeps recovery available when automatic original-route verification fails', async () => {
  const c = await retainedFixture();
  c.fetch.mockResolvedValue(
    identityResponse(savedStatus, {
      blockbook: { coin: 'Bitcoin', network: 'BTC', decimals: 8 },
      backend: { chain: 'test' },
    })
  );
  await reconcileRetainedUtxo(savedStatusRequest(c));
  expect(await c.records.list(c.session, c.transaction.owner)).toEqual([
    { txid: c.transaction.txid, accepted: false },
  ]);
  expect(
    await c.records.readExact(
      c.session,
      c.transaction.owner,
      c.transaction.txid
    )
  ).toEqual(unsignedRecord(c.transaction));
  expect(c.fetch.mock.calls.map(([target]) => target)).toEqual([savedStatus]);
});

it('rotates bounded reconciliation across both unresolved and confirmed records', async () => {
  const c = context();
  const records = Array.from({ length: 6 }, (_, index) => ({
    ...record(0xfffffff0 + index),
    operation: 'external' as const,
  }));
  for (const transaction of records)
    await c.records.persist(c.session, transaction);
  for (const transaction of records.slice(3))
    await c.records.observeRetained(
      c.session,
      owner,
      transaction.txid,
      async () => ({
        txid: transaction.txid,
        hex: transaction.rawTransaction,
        confirmations: 1,
        blockHash: 'f'.repeat(64),
      })
    );
  const seen: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const start = seen.length;
    await c.records.reconcile(c.session, owner, async (txid) => {
      seen.push(txid);
    });
    expect(seen.length - start).toBe(2);
    expect(records.slice(0, 3).some((item) => item.txid === seen[start])).toBe(
      true
    );
    expect(records.slice(3).some((item) => item.txid === seen[start + 1])).toBe(
      true
    );
  }
  expect(new Set(seen)).toEqual(new Set(records.map((item) => item.txid)));
});

it('coalesces overlapping reconciliation for the same wallet and account', async () => {
  const c = context();
  await c.records.persist(c.session, record());
  const entered = deferred(),
    release = deferred();
  const observe = jest.fn(async () => {
    entered.finish();
    await release.promise;
  });
  const first = c.records.reconcile(c.session, owner, observe);
  await entered.promise;
  const second = c.records.reconcile(c.session, owner, observe);
  await Promise.resolve();
  release.finish();
  await Promise.all([first, second]);
  expect(observe).toHaveBeenCalledTimes(1);
});

it('admits a fresh session after an overlapping old refresh is cancelled', async () => {
  const c = context();
  await c.records.persist(c.session, record());
  const entered = deferred(),
    release = deferred();
  let active = true;
  const old = {
    ...c.session,
    assertCurrent() {
      if (!active) throw Error('Old view closed');
    },
  };
  const first = c.records.reconcile(old, owner, async () => {
    entered.finish();
    await release.promise;
    old.assertCurrent();
  });
  const rejected = expect(first).rejects.toThrow('Old view closed');
  await entered.promise;
  const observe = jest.fn(async () => undefined);
  const next = c.records.reconcile(c.session, owner, observe);
  active = false;
  release.finish();
  await rejected;
  await next;
  expect(observe).toHaveBeenCalledTimes(1);
});

it('rejects an already aborted empty refresh before reading the wallet record key', async () => {
  const c = context();
  const readKey = jest.spyOn(c.session.keyring, 'getPrivateRecordProfileId');
  const controller = new AbortController();
  controller.abort();
  const fetch = jest.fn();
  await expect(
    reconcileRetainedUtxo({
      ...c,
      owner,
      backendChain: 'main',
      fetch,
      signal: controller.signal,
    })
  ).rejects.toThrow();
  expect(readKey).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('checks a joined view again before accessing its record key', async () => {
  const c = context();
  await c.records.persist(c.session, record());
  const entered = deferred(),
    release = deferred();
  const first = c.records.reconcile(c.session, owner, async () => {
    entered.finish();
    await release.promise;
  });
  await entered.promise;
  const key = jest.spyOn(c.session.keyring, 'getPrivateRecordProfileId');
  const controller = new AbortController();
  const joined = reconcileRetainedUtxo({
    ...c,
    owner,
    backendChain: 'main',
    fetch: jest.fn(),
    signal: controller.signal,
  });
  const rejected = expect(joined).rejects.toThrow();
  controller.abort();
  release.finish();
  await first;
  await rejected;
  expect(key).not.toHaveBeenCalled();
});

it('does not let background reconciliation supersede an explicit status check', async () => {
  const c = context(),
    transaction = record();
  await c.records.persist(c.session, transaction);
  const entered = deferred(),
    release = deferred();
  const explicit = c.records.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => {
      entered.finish();
      await release.promise;
      return {
        txid: transaction.txid,
        hex: transaction.rawTransaction,
        confirmations: 1,
        blockHash: 'f'.repeat(64),
      };
    }
  );
  await entered.promise;
  const background = jest.fn(async () => undefined);
  await c.records.reconcile(c.session, owner, background);
  expect(background).not.toHaveBeenCalled();
  release.finish();
  await expect(explicit).resolves.toBe('confirmed');
  expect(await c.records.list(c.session, owner)).toEqual([]);
});

it('lets a newer explicit status check retire an older background observation', async () => {
  const c = context(),
    transaction = record();
  await c.records.persist(c.session, transaction);
  const entered = deferred(),
    release = deferred();
  const background = c.records.reconcile(c.session, owner, (txid) =>
    c.records.observeRetained(c.session, owner, txid, async () => {
      entered.finish();
      await release.promise;
      return null;
    })
  );
  const rejected = expect(background).rejects.toThrow(
    'UTXO observation changed'
  );
  await entered.promise;
  await expect(
    c.records.observeRetained(c.session, owner, transaction.txid, async () => ({
      txid: transaction.txid,
      hex: transaction.rawTransaction,
      confirmations: 1,
      blockHash: 'f'.repeat(64),
    }))
  ).resolves.toBe('confirmed');
  release.finish();
  await rejected;
  expect(await c.records.list(c.session, owner)).toEqual([]);
});

it('cannot publish automatic reconciliation after the wallet context changes', async () => {
  const c = await retainedFixture();
  const entered = deferred(),
    release = deferred();
  const transport = c.fetch.getMockImplementation()!;
  c.fetch.mockImplementationOnce(async (...args) => {
    entered.finish();
    await release.promise;
    return transport(...args);
  });
  let current = true;
  const pending = reconcileRetainedUtxo({
    ...savedStatusRequest(c),
    session: {
      ...c.session,
      assertCurrent() {
        if (!current) throw Error('Wallet changed');
      },
    },
  });
  const rejected = expect(pending).rejects.toThrow('Wallet changed');
  await entered.promise;
  current = false;
  release.finish();
  await rejected;
  expect(c.fetch).toHaveBeenCalledTimes(1);
  expect(c.cas).toHaveBeenCalledTimes(1);
  expect(await c.records.list(c.session, c.transaction.owner)).toEqual([
    { txid: c.transaction.txid, accepted: false },
  ]);
});

it('does not make automatic requests for a different owner or an empty journal', async () => {
  const c = await retainedFixture();
  await reconcileRetainedUtxo({
    ...savedStatusRequest(c),
    owner: { ...owner, account: { ...owner.account, id: 1 } },
  });
  const empty = context();
  await reconcileRetainedUtxo({
    ...savedStatusRequest(c),
    records: empty.records,
    session: empty.session,
  });
  expect(c.fetch).not.toHaveBeenCalled();
});

const discoverySelection = (
  previous?: Readonly<{ changeIndex: number; receivingIndex: number }>
) => {
  const state = previous ?? { receivingIndex: 0, changeIndex: 0 };
  const key = bitcoin.ECPair.fromPrivateKey(
    Buffer.alloc(32, 3 + state.changeIndex)
  );
  const payment = bitcoin.payments.p2wpkh({ pubkey: key.publicKey });
  return {
    state,
    issued: {
      branch: 1 as const,
      index: state.changeIndex,
      address: payment.address,
      path: `m/84'/0'/0'/1/${state.changeIndex}`,
      script: Buffer.from(payment.output).toString('hex'),
    },
  };
};

it('durably repeats an issued change address across quotes, restart and independent account/chain owners', async () => {
  const f = context();
  const first = await f.records
    .addressDiscovery(f.session, owner)
    .allocateUtxoAddress(discoverySelection);
  const retained = await f.storage.read();
  expect(first.index).toBe(0);
  expect(retained).toBeDefined();
  expect(
    await f.records
      .addressDiscovery(f.session, owner)
      .allocateUtxoAddress(discoverySelection)
  ).toEqual(first);
  expect(await f.storage.read()).toBe(retained);
  const reopened = new UtxoSignedRecords(f.storage, f.storage);
  expect(
    await reopened
      .addressDiscovery(f.session, owner)
      .allocateUtxoAddress(discoverySelection)
  ).toEqual(first);
  for (const other of [
    {
      ...owner,
      account: { ...owner.account, id: 1, xpub: 'different-public-xpub' },
    },
    { ...owner, chainId: 5700, slip44: 57, genesisHash: '1'.repeat(64) },
  ]) {
    const select = jest.fn(discoverySelection);
    await reopened
      .addressDiscovery(f.session, other)
      .allocateUtxoAddress(select);
    expect(select).toHaveBeenCalledWith(undefined);
  }
  expect(
    await reopened
      .addressDiscovery(f.session, owner)
      .allocateUtxoAddress(discoverySelection)
  ).toEqual(first);
});

it('serializes concurrent owner allocations without consuming another change index', async () => {
  const f = context(),
    entered = deferred(),
    release = deferred();
  const original = f.cas.getMockImplementation()!;
  f.cas.mockImplementationOnce(async (...args) => {
    entered.finish();
    await release.promise;
    return original(...args);
  });
  const first = f.records
    .addressDiscovery(f.session, owner)
    .allocateUtxoAddress(discoverySelection);
  await entered.promise;
  const secondRecords = new UtxoSignedRecords(f.storage, f.storage);
  const second = secondRecords
    .addressDiscovery(f.session, owner)
    .allocateUtxoAddress(discoverySelection);
  release.finish();
  const [one, two] = await Promise.all([first, second]);
  expect(one).toEqual(two);
  expect(one.index).toBe(0);
  expect(f.cas).toHaveBeenCalledTimes(1);
});

it('reloads an authenticated allocation after another writer wins the physical CAS', async () => {
  const f = context(),
    original = f.cas.getMockImplementation()!;
  f.cas.mockImplementationOnce(async (...args) => {
    // An independently admitted writer wins the physical storage race. The
    // following original expectation then loses its exact-byte comparison.
    await original(...args);
    return original(...args);
  });
  const select = jest.fn(discoverySelection);
  expect(
    (
      await f.records
        .addressDiscovery(f.session, owner)
        .allocateUtxoAddress(select)
    ).index
  ).toBe(0);
  expect(select.mock.calls.map(([state]) => state?.changeIndex)).toEqual([
    undefined,
    0,
  ]);
});

it('refuses altered public discovery metadata whose authenticated root was not rewritten', async () => {
  const f = context();
  await f.records
    .addressDiscovery(f.session, owner)
    .allocateUtxoAddress(discoverySelection);
  const before = (await f.storage.read())!;
  const parsed = JSON.parse(before);
  parsed.discovery[0].state.changeIndex = 1;
  const altered = JSON.stringify(parsed);
  await f.cas(parsed.profileId, before, altered, guard);
  const reopened = new UtxoSignedRecords(f.storage, f.storage),
    select = jest.fn(discoverySelection);
  await expect(
    reopened.addressDiscovery(f.session, owner).allocateUtxoAddress(select)
  ).rejects.toThrow();
  expect(select).not.toHaveBeenCalled();
  expect(await f.storage.read()).toBe(altered);
});

it('never publishes an allocation after failed storage or cancellation and retains a committed path after lost acknowledgement', async () => {
  const f = context();
  f.cas.mockRejectedValueOnce(Error('Storage unavailable'));
  await expect(
    f.records
      .addressDiscovery(f.session, owner)
      .allocateUtxoAddress(discoverySelection)
  ).rejects.toThrow('Storage unavailable');
  expect(await f.storage.read()).toBeUndefined();
  let current = true;
  const session = {
    ...f.session,
    assertCurrent() {
      if (!current) throw Error('Retired allocation');
    },
  };
  const original = f.cas.getMockImplementation()!;
  f.cas.mockImplementationOnce(async (...args) => {
    current = false;
    return original(...args);
  });
  await expect(
    f.records
      .addressDiscovery(session, owner)
      .allocateUtxoAddress(discoverySelection)
  ).rejects.toThrow('Retired allocation');
  expect(await f.storage.read()).toBeUndefined();
  current = true;
  f.cas.mockImplementationOnce(async (...args) => {
    await original(...args);
    throw Error('Acknowledgement lost');
  });
  await expect(
    f.records
      .addressDiscovery(session, owner)
      .allocateUtxoAddress(discoverySelection)
  ).rejects.toThrow('Acknowledgement lost');
  const reopened = new UtxoSignedRecords(f.storage, f.storage);
  const select = jest.fn(discoverySelection);
  expect(
    (
      await reopened
        .addressDiscovery(f.session, owner)
        .allocateUtxoAddress(select)
    ).index
  ).toBe(0);
  expect(select).toHaveBeenCalledWith({ receivingIndex: 0, changeIndex: 0 });
});

it('binds issued paths to the exact transaction and advances only their matching confirmed change once', async () => {
  const f = context(),
    signed = record();
  const issued = await f.records
    .addressDiscovery(f.session, owner)
    .allocateUtxoAddress(discoverySelection);
  await f.records.persist(f.session, signed);
  const reopened = new UtxoSignedRecords(f.storage, f.storage);
  expect(
    (await reopened.readExact(f.session, owner, signed.txid))?.issuedPaths
  ).toEqual([issued]);
  const current = async () =>
    (
      await reopened
        .addressDiscovery(f.session, owner)
        .allocateUtxoAddress(discoverySelection)
    ).index;
  await reopened.acknowledge(f.session, owner, signed.txid);
  expect(await current()).toBe(0);
  expect(
    await reopened.observeRetained(f.session, owner, signed.txid, async () => ({
      txid: signed.txid,
      hex: signed.rawTransaction,
      confirmations: 0,
    }))
  ).toBe('seen');
  expect(await current()).toBe(0);
  expect(
    await reopened.observeRetained(f.session, owner, signed.txid, async () => ({
      txid: '0'.repeat(64),
      hex: signed.rawTransaction,
      confirmations: 9,
      blockHash: 'a'.repeat(64),
    }))
  ).toBe('unknown');
  expect(await current()).toBe(0);
  const observed = {
    txid: signed.txid,
    hex: signed.rawTransaction,
    confirmations: 1,
    blockHash: 'a'.repeat(64),
  };
  expect(
    await reopened.observeRetained(
      f.session,
      owner,
      signed.txid,
      async () => observed
    )
  ).toBe('confirmed');
  expect(await current()).toBe(1);
  expect(
    await reopened.observeRetained(
      f.session,
      owner,
      signed.txid,
      async () => observed
    )
  ).toBe('confirmed');
  expect(await current()).toBe(1);
  expect(
    (await reopened.readExact(f.session, owner, signed.txid))
      ?.unsignedTransaction
  ).toBe(unsignedRecord(signed).unsignedTransaction);
  expect(
    (await reopened.readExact(f.session, owner, signed.txid))?.issuedPaths
  ).toEqual([issued]);
});
