jest.unmock('syscoinjs-lib');

import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { SyscoinTransactionsCore } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js';
import { verifyOwnedUtxoRpc } from '@sidhujag/sysweb3-network/cjs/ownedUtxoRpc.js';
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
import {
  createUtxoSubmissionDisposition,
  observeRetainedUtxo,
  submitRetainedUtxo,
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
    () => guard
  );
  const response = (txid: string) => {
    const reply = Response.json({ result: txid });
    Object.defineProperty(reply, 'url', { value: url });
    return reply;
  };
  return { session, sender, records, cas, storage, response };
}

function replayFixtureFetch(
  post: typeof globalThis.fetch
): typeof globalThis.fetch {
  return async (requestUrl, init) => {
    if (init?.method !== 'GET') return post(requestUrl, init);
    const status = `${endpoint}/api/v2/`;
    if (requestUrl === status)
      return identityResponse(status, {
        blockbook: { coin: 'Bitcoin', network: 'BTC', decimals: 8 },
        backend: { chain: 'main' },
      });
    const genesis = status + 'block-index/0';
    if (requestUrl === genesis)
      return identityResponse(genesis, { blockHash: btcGenesis });
    throw new Error('Unexpected retry request');
  };
}

it('requires the retained route even if an initial caller injects a replay mode', async () => {
  const c = context();
  const transaction = record();
  await c.records.persist(c.session, transaction);
  const fetch = jest.fn(async () => c.response(transaction.txid));
  const request = { ...c, record: transaction, fetch, intent: 'replay' };
  await expect(submitReviewedUtxo(request)).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

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
    transaction
  );
  finishMarker.finish();
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

it('retains unknown bytes, fences ordinary overlap and permits separately authorized RBF', async () => {
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
    transaction
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

it('keeps the replay record through synchronous POST while confirmed-only reclaim waits', async () => {
  const capacity = jest.replaceProperty(
    signedBundle as { MAX_RECORDS: number },
    'MAX_RECORDS',
    2
  );
  const c = context(),
    transaction = record();
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
  const another = {
    ...record(0xfffffffa),
    operation: 'external',
  } as const;
  await c.records.persist(c.session, another);
  await c.records.observeRetained(c.session, owner, another.txid, async () => ({
    txid: another.txid,
    hex: another.rawTransaction,
    confirmations: 1,
    blockHash: 'f'.repeat(64),
  }));
  const entered = deferred(),
    resume = deferred(),
    posted = deferred(),
    reply = deferred();
  const original = c.session.keyring.decryptPrivateRecord;
  let reads = 0;
  const session = {
    ...c.session,
    keyring: {
      ...c.session.keyring,
      async decryptPrivateRecord(params: Parameters<typeof original>[0]) {
        // The first read reauthenticates before GET. Hold the second under admission.
        if (params.recordId.endsWith('/0') && ++reads === 2) {
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
    return c.response('d'.repeat(64));
  });
  const sending = submitRetainedUtxo({
    ...c,
    record: transaction,
    session,
    fetch: replayFixtureFetch(fetch),
  });
  const unknown = expect(sending).rejects.toMatchObject({
    code: 'UTXO_SUBMISSION_UNKNOWN',
    transactionNotBroadcast: false,
    txid: transaction.txid,
  });
  await Promise.race([entered.promise, sending]);
  const competing = new UtxoSignedRecords(c.storage, c.storage).persist(
    c.session,
    {
      ...record(0xfffffffc),
      operation: 'external',
    }
  );
  try {
    expect(c.cas).toHaveBeenCalledTimes(4);
    resume.finish();
    await Promise.race([posted.promise, sending]);
    await expect(competing).resolves.toBeUndefined();
    expect(
      await c.records.readExact(c.session, owner, transaction.txid)
    ).toEqual(transaction);
    expect(
      await c.records.readExact(c.session, another.owner, another.txid)
    ).toBeUndefined();
    reply.finish();
    await unknown;
  } finally {
    resume.finish();
    reply.finish();
    capacity.restore();
  }
});

it('cannot restore terminal eviction authority from an observation held across replay', async () => {
  const c = context();
  const transaction = record();
  const result = {
    txid: transaction.txid,
    hex: transaction.rawTransaction,
    confirmations: 1,
    blockHash: 'f'.repeat(64),
  };
  const check = new UtxoSignedRecords(c.storage, c.storage);
  await c.records.persist(c.session, transaction);
  await check.observeRetained(
    c.session,
    owner,
    transaction.txid,
    async () => result
  );
  const observed = deferred(),
    finishObservation = deferred(),
    posted = deferred(),
    reply = deferred();
  const stale = expect(
    check.observeRetained(c.session, owner, transaction.txid, async () => {
      observed.finish();
      await finishObservation.promise;
      return result;
    })
  ).rejects.toThrow('UTXO observation changed');
  await observed.promise;
  const submitting = submitRetainedUtxo({
    ...c,
    record: transaction,
    fetch: replayFixtureFetch(async () => {
      posted.finish();
      await reply.promise;
      return c.response('d'.repeat(64));
    }),
  });
  const sending = expect(submitting).rejects.toMatchObject({
    code: 'UTXO_SUBMISSION_UNKNOWN',
  });
  try {
    await Promise.race([posted.promise, submitting]);
    finishObservation.finish();
    await stale;
    expect(
      (await c.records.fundingExclusions(c.session, owner)).outpoints
    ).toHaveLength(1);
    await expect(
      check.observeRetained(
        c.session,
        owner,
        transaction.txid,
        async () => result
      )
    ).resolves.toBe('confirmed');
    expect(
      (await c.records.fundingExclusions(c.session, owner)).outpoints
    ).toEqual([]);
  } finally {
    finishObservation.finish();
    reply.finish();
    await sending;
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

it('retains previously confirmed bytes when their current owned observation is unknown', async () => {
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
    ).toEqual(transaction);
  } finally {
    capacity.restore();
  }
});

it('protects exact previously confirmed bytes after a current Blockbook read rejects', async () => {
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
    ).toEqual(transaction);
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

type ReplaySender = Parameters<typeof submitRetainedUtxo>[0]['sender'];

const savedBase = 'https://previous.invalid/wallet/chain';
const savedStatus = savedBase + '/api/v2/';
const savedGenesis = savedStatus + 'block-index/0';
const savedPost = savedStatus + 'sendtx/';
const noPost = {
  code: 'UTXO_SUBMISSION_NOT_DISPATCHED',
  transactionNotBroadcast: true,
};

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
  const selected = {
    ...transaction.owner,
    account: { ...transaction.owner.account },
  };
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
    if (requestUrl === savedPost && init?.method === 'POST')
      return identityResponse(savedPost, { result: transaction.txid });
    throw new Error('Unexpected saved transfer request');
  };
  const fetch = jest.fn(transport);
  // Exercise the real pinned Network verifier and SyscoinJS transport through
  // the new SDK port contract before the candidate keyring package is adopted.
  const sender: ReplaySender = {
    async replayRetainedTransaction(txid, authority) {
      const retained = await authority.readRetained(selected, txid);
      if (!retained) throw new Error('Saved transaction changed');
      const verified = await verifyOwnedUtxoRpc(savedBase, {
        ...authority,
        backendChain: 'main',
        registration: selected,
      });
      const { result } = await syscoinUtils.sendRawTransaction(
        savedBase,
        retained.rawTransaction,
        undefined,
        {
          ...authority,
          assertCurrent: verified.assertCurrent,
        }
      );
      return { txid: result };
    },
  };
  return { ...c, sender, transaction, selected, fetch };
}

it('verifies the original prefixed route and dispatches exact bytes under the replay lease', async () => {
  const c = await retainedFixture();
  const checking = deferred(),
    release = deferred();
  const fetch = c.fetch.getMockImplementation()!;
  c.fetch.mockImplementationOnce(async (...args) => {
    checking.finish();
    await release.promise;
    return fetch(...args);
  });
  const submission = submitRetainedUtxo({ ...c, record: c.transaction });
  await Promise.race([checking.promise, submission]);
  expect(c.fetch).toHaveBeenCalledTimes(1);
  expect(c.cas).toHaveBeenCalledTimes(1);
  release.finish();
  await expect(submission).resolves.toEqual({ txid: c.transaction.txid });
  expect(
    c.fetch.mock.calls.map(([requestUrl, init]) => [requestUrl, init?.method])
  ).toEqual([
    [savedStatus, 'GET'],
    [savedGenesis, 'GET'],
    [savedPost, 'POST'],
  ]);
  const [status, genesis, post] = c.fetch.mock.calls;
  const readPolicy = {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  };
  expect(status[1]).toMatchObject(readPolicy);
  expect(genesis[1]).toMatchObject(readPolicy);
  expect(post[1]).toMatchObject({
    ...readPolicy,
    body: c.transaction.rawTransaction,
  });
});

it.each(['wrong URL', 'redirect', 'wrong genesis', 'oversized body'] as const)(
  'rejects %s during the saved route check before admission or POST',
  async (failure) => {
    const c = await retainedFixture();
    if (failure === 'wrong genesis')
      c.fetch
        .mockImplementationOnce(c.fetch.getMockImplementation()!)
        .mockResolvedValueOnce(
          identityResponse(savedGenesis, { blockHash: '0'.repeat(64) })
        );
    else if (failure === 'oversized body')
      c.fetch.mockResolvedValueOnce(
        identityResponse(savedStatus, 'x'.repeat(32 * 1024))
      );
    else
      c.fetch.mockResolvedValueOnce(
        identityResponse(
          failure === 'wrong URL' ? endpoint + '/api/v2/' : savedStatus,
          {},
          failure === 'redirect'
        )
      );
    await expect(
      submitRetainedUtxo({ ...c, record: c.transaction })
    ).rejects.toMatchObject(noPost);
    expect(c.fetch.mock.calls.map(([, init]) => init?.method)).toEqual(
      failure === 'wrong genesis' ? ['GET', 'GET'] : ['GET']
    );
    expect(c.cas).toHaveBeenCalledTimes(1);
  }
);

it('rejects a wrong selected owner before an authenticated journal or HTTP read', async () => {
  const c = await retainedFixture();
  c.selected.account.id++;
  const read = jest.spyOn(c.records, 'readExact');
  await expect(
    submitRetainedUtxo({ ...c, record: c.transaction })
  ).rejects.toMatchObject(noPost);
  expect(read).not.toHaveBeenCalled();
  expect(c.fetch).not.toHaveBeenCalled();
});

it('blocks genesis and POST when wallet authority expires during the status request', async () => {
  const c = await retainedFixture();
  const checking = deferred(),
    release = deferred();
  const fetch = c.fetch.getMockImplementation()!;
  let active = true;
  c.fetch.mockImplementationOnce(async (...args) => {
    checking.finish();
    await release.promise;
    return fetch(...args);
  });
  const pending = submitRetainedUtxo({
    ...c,
    record: c.transaction,
    session: {
      ...c.session,
      assertCurrent() {
        if (!active) throw new Error('Wallet changed');
      },
    },
  });
  const rejected = expect(pending).rejects.toMatchObject(noPost);
  try {
    await Promise.race([checking.promise, pending]);
    active = false;
  } finally {
    release.finish();
  }
  await rejected;
  expect(c.fetch.mock.calls.map(([requestUrl]) => requestUrl)).toEqual([
    savedStatus,
  ]);
  expect(c.cas).toHaveBeenCalledTimes(1);
});

it('ends a held original-route read at its deadline even if the transport does not settle', async () => {
  const c = await retainedFixture();
  const entered = deferred(),
    release = deferred();
  const transport = c.fetch.getMockImplementation()!;
  c.fetch.mockImplementationOnce(async (...args) => {
    entered.finish();
    await release.promise;
    return transport(...args);
  });
  jest.useFakeTimers();
  try {
    const pending = submitRetainedUtxo({ ...c, record: c.transaction });
    const rejected = expect(pending).rejects.toMatchObject(noPost);
    await Promise.race([entered.promise, pending]);
    await jest.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(c.fetch).toHaveBeenCalledTimes(1);
    expect(c.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(c.cas).toHaveBeenCalledTimes(1);
  } finally {
    release.finish();
    jest.useRealTimers();
  }
});

it.each([false, true])(
  'rejects same-txid witness changes with an independently held review (stale journal read: %s)',
  async (staleRead) => {
    const c = await retainedFixture();
    const altered = bitcoin.Transaction.fromHex(c.transaction.rawTransaction);
    const witness = altered.ins[0].witness.map((item) => Buffer.from(item));
    witness[0][0] ^= 1;
    altered.setWitness(0, witness);
    const reviewed = { ...c.transaction, rawTransaction: altered.toHex() };
    expect(altered.getId()).toBe(c.transaction.txid);
    expect(reviewed.rawTransaction).not.toBe(c.transaction.rawTransaction);
    if (staleRead)
      jest.spyOn(c.records, 'readExact').mockResolvedValueOnce(reviewed);
    await expect(
      submitRetainedUtxo({ ...c, record: reviewed })
    ).rejects.toMatchObject(noPost);
    expect(c.fetch.mock.calls.map(([requestUrl]) => requestUrl)).toEqual(
      staleRead ? [savedStatus, savedGenesis] : []
    );
    expect(
      await c.records.readExact(
        c.session,
        c.transaction.owner,
        c.transaction.txid
      )
    ).toEqual(c.transaction);
    expect(c.cas).toHaveBeenCalledTimes(1);
  }
);

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
    ).toEqual(c.transaction);
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
  await expect(
    submitRetainedUtxo({ ...c, record: c.transaction })
  ).rejects.toMatchObject(noPost);
  expect(text).not.toHaveBeenCalled();
  expect(c.fetch).toHaveBeenCalledTimes(1);
});

it.each(['manifest', 'CAS'] as const)(
  'preserves exact bytes when a status check starts after reclamation selection at %s',
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
      ).toEqual(c.transaction);
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
    ).toEqual(competing);
  } finally {
    capacity.restore();
  }
});
