import { AbiCoder, Interface, keccak256, namehash } from 'ethers';

import { KeyringAccountType } from 'types/network';
import { identifyClassicNote } from 'utils/privacy/note';
import fixture from 'utils/privacy/prover.fixture.json';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import { PRIVACY_RELAYER_SOURCE } from 'utils/privacy/relayers';
import type {
  IPrivacyRelayerDirectory,
  IPrivacyRelayerSelection,
} from 'utils/privacy/relayers';
import type { PrivacySnapshot } from 'utils/privacy/types';
import type { IPrivacyWithdrawalStatusRecord } from 'utils/privacy/withdrawalTransactionTypes';
import type { IPrivacyWithdrawalsHost } from 'utils/privacy/withdrawTypes';

import {
  createPrivacyWithdrawalsController,
  PRIVACY_WITHDRAWAL_INTENT_TTL_MS,
} from './privacyWithdrawals';

const NOTE_ID = '00000000-0000-4000-8000-000000001000';
const JOB_ID = '00000000-0000-4000-8000-000000002000';
const HASH = `0x${'ab'.repeat(32)}`;
const RELAYER = '0x2222222222222222222222222222222222222222';
const ENS_HASH = namehash('relay.eth');
const ABI = new Interface([
  'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256) payable',
]);
const littleHex = (decimal: string) => {
  let value = BigInt(decimal),
    result = '';
  for (let i = 0; i < 31; i++) {
    result += Number(value & BigInt(255))
      .toString(16)
      .padStart(2, '0');
    value >>= BigInt(8);
  }
  return result;
};
const NOTE = `tornado-eth-1-1-0x${littleHex(
  fixture.input.nullifier
)}${littleHex(fixture.input.secret)}`;
const identity = identifyClassicNote(NOTE);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup() {
  let clock = 2000000000000,
    generation = 1,
    validSnapshot = true,
    id = 0;
  const events: string[] = [];
  const context = {
    account: {
      address: fixture.input.recipient,
      id: 0,
      type: KeyringAccountType.HDAccount,
    },
    chainId: 1,
    rpcUrl: 'https://operator.example',
    slip44: 60,
    sessionGeneration: 1,
  };
  const snapshot: PrivacySnapshot = {
    version: 1,
    chainId: 1,
    poolAddress: PRIVACY_POOLS[1].address,
    asOfBlockNumber: 20000000,
    asOfBlockHash: `0x${'01'.repeat(32)}`,
    root: fixture.input.root,
    leaves: [identity.commitment],
    leafCount: 1,
    withdrawnNullifiers: [],
  };
  const directory: IPrivacyRelayerDirectory = {
    version: 1,
    chainId: 1,
    source: PRIVACY_RELAYER_SOURCE,
    asOfBlockNumber: 20000000,
    asOfBlockHash: `0x${'01'.repeat(32)}`,
    asOfBlockTimestamp: clock / 1000 - 720,
    observedAt: clock,
    candidateCount: 1,
    unavailableEntries: 0,
    state: 'ready',
    relayers: [
      {
        ensHash: ENS_HASH,
        ensName: 'relay.eth',
        owner: RELAYER,
        registryBalance: '1',
        health: 'reported-healthy',
        advertisedServiceFeePercent: '0.3',
        supportedPools: ['eth-1'],
      },
    ],
  };
  const selection = {
    directory,
    endpoint: 'https://relay.example',
    ensHash: ENS_HASH,
    poolId: 'eth-1',
    rewardAccount: RELAYER,
    advertisedServiceFeePercent: '0.3',
    advertisedQueueLength: 0,
    version: '5.0.1',
    observedAt: clock,
  } as IPrivacyRelayerSelection;
  const host: IPrivacyWithdrawalsHost = {
    captureSession: jest.fn(() => {
      const captured = generation;
      return {
        context,
        assertCurrent: () => {
          if (captured !== generation) throw new Error('context changed');
        },
      };
    }),
    withNote: jest.fn(async (_id, _session, use) => use(NOTE, 'eth-1')),
    getSnapshot: jest.fn(async () => ({
      snapshot,
      getPath: jest.fn(async () => ({
        pathElements: [...fixture.input.pathElements],
        pathIndices: [...fixture.input.pathIndices],
      })),
      assertSnapshotCurrent: (supplied) => {
        if (!validSnapshot || supplied !== snapshot)
          throw new Error('privacy_verification_pending');
      },
    })),
    getWithdrawalAttempt: jest.fn(async () => null),
    recordJobStatus: jest.fn(async () => undefined),
    quoteDirectFees: jest.fn(async () => ({
      gasLimit: '650000',
      nonce: '7',
      maxFeePerGas: '30000000000',
      maxPriorityFeePerGas: '1000000000',
    })),
    quoteRelayerGasPrice: jest.fn(async () => '30000000000'),
    relayers: {
      getDirectory: jest.fn(async () => directory),
      checkRelayer: jest.fn(async () => selection),
      assertSelectionCurrent: jest.fn(),
    },
    prove: jest.fn(async (request, options) => {
      options.assertCurrent();
      options.assertSnapshotCurrent(request.snapshot);
      return {
        proof: `0x${'01'.repeat(256)}`,
        publicSignals: [
          request.snapshot.root,
          identity.nullifierHash,
          request.recipient,
          request.relayer,
          request.fee,
          request.refund,
        ].map((value) => BigInt(value).toString()),
      };
    }),
    beforeSubmission: jest.fn(async () => {
      events.push('reserve');
    }),
    recordSubmission: jest.fn(async () => {
      events.push('ack');
    }),
    recordNotBroadcast: jest.fn(async () => {
      events.push('clear');
    }),
    sendTransaction: jest.fn(async (_tx, _session, onBroadcast) => {
      events.push('send');
      await onBroadcast({ hash: HASH });
      return { hash: HASH };
    }),
  };
  const fetcher = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>(
    async () => {
      events.push('post');
      return new Response(JSON.stringify({ id: JOB_ID }), {
        headers: { 'content-type': 'application/json' },
      });
    }
  );
  const controller = createPrivacyWithdrawalsController(host, {
    now: () => clock,
    randomId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    fetcher,
  });
  return {
    host,
    controller,
    fetcher,
    events,
    context,
    snapshot,
    selection,
    clock: (value: number) => {
      clock = value;
    },
    change: () => {
      generation++;
    },
    invalidate: () => {
      validSnapshot = false;
    },
  };
}
const direct = () => ({
  noteId: NOTE_ID,
  recipient: fixture.input.recipient,
  mode: 'direct' as const,
});
const relayed = () => ({
  ...direct(),
  mode: 'relayed' as const,
  relayerId: ENS_HASH,
});
afterEach(() => jest.useRealTimers());

it('prepares direct proof without submission and reviews no secret-derived identifiers', async () => {
  jest.useFakeTimers();
  const run = setup();
  const review = await run.controller.prepareWithdrawal(direct());
  expect(review).toMatchObject({
    noteId: NOTE_ID,
    poolId: 'eth-1',
    amount: '1',
    mode: 'direct',
    feeWei: '0',
    receiveWei: '1000000000000000000',
    gasLimit: '650000',
    maxNetworkFeeWei: '19500000000000000',
  });
  const serialized = JSON.stringify(review);
  for (const secret of [
    NOTE,
    identity.nullifierHash,
    identity.commitment,
    fixture.input.root,
    'proof',
    'transaction',
    'data',
  ])
    expect(serialized).not.toContain(secret);
  expect(run.host.beforeSubmission).not.toHaveBeenCalled();
  expect(run.host.sendTransaction).not.toHaveBeenCalled();
  expect(run.fetcher).not.toHaveBeenCalled();
  run.controller.close();
});

it('binds direct calldata/fees and journals before dispatch and acknowledgement', async () => {
  jest.useFakeTimers();
  const run = setup();
  const review = await run.controller.prepareWithdrawal(direct());
  const result = await run.controller.submitWithdrawal(review.intentId);
  expect(result).toEqual({
    intentId: review.intentId,
    noteId: NOTE_ID,
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect(run.events).toEqual(['reserve', 'send', 'ack']);
  const attempt = jest.mocked(run.host.beforeSubmission).mock.calls[0][0];
  expect(attempt.mode).toBe('direct');
  if (attempt.mode !== 'direct') throw new Error();
  expect(Object.isFrozen(attempt)).toBe(true);
  expect(Object.isFrozen(attempt.transaction)).toBe(true);
  expect(attempt.transaction).toMatchObject({
    chainId: 1,
    value: '0x0',
    gasLimit: '0x9eb10',
    nonce: '0x7',
    to: PRIVACY_POOLS[1].address,
  });
  const args = ABI.decodeFunctionData('withdraw', attempt.transaction.data);
  expect(args[1]).toBe(run.snapshot.root);
  expect(args[2]).toBe(identity.nullifierHash);
  expect(args[4]).toBe('0x0000000000000000000000000000000000000000');
  expect(args[5]).toBe(BigInt(0));
  expect(run.host.recordSubmission).toHaveBeenCalledWith(attempt, {
    transactionHash: HASH,
  });
  await expect(
    run.controller.submitWithdrawal(review.intentId)
  ).rejects.toThrow('privacy_withdrawal_intent_expired');
});

it('relayed mode fixes selected reward/fee before proof and sends exactly the pinned protocol body', async () => {
  jest.useFakeTimers();
  const run = setup();
  await run.controller.getRelayers();
  const review = await run.controller.prepareWithdrawal(relayed());
  expect(review).toMatchObject({
    mode: 'relayed',
    relayerId: ENS_HASH,
    relayerName: 'relay.eth',
    feeWei: '22500000000000000',
    serviceFeeWei: '3000000000000000',
    maxNetworkFeeWei: '19500000000000000',
  });
  expect(jest.mocked(run.host.prove!).mock.calls[0][0]).toMatchObject({
    relayer: RELAYER,
    fee: review.feeWei,
  });
  expect(run.fetcher).not.toHaveBeenCalled();
  const result = await run.controller.submitWithdrawal(review.intentId);
  expect(result).toMatchObject({ phase: 'submitted', jobId: JOB_ID });
  expect(run.events).toEqual(['reserve', 'post', 'ack']);
  expect(run.host.sendTransaction).not.toHaveBeenCalled();
  const [url, init] = run.fetcher.mock.calls[0];
  expect(url).toBe('https://relay.example/v1/tornadoWithdraw');
  expect(init).toMatchObject({
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  const body = JSON.parse(init!.body as string);
  expect(Object.keys(body).sort()).toEqual(['args', 'contract', 'proof']);
  expect(body.contract).toBe(PRIVACY_POOLS[1].address);
  expect(body.args).toEqual([
    run.snapshot.root,
    identity.nullifierHash,
    review.recipient,
    RELAYER,
    `0x${BigInt(review.feeWei).toString(16).padStart(64, '0')}`,
    `0x${'0'.repeat(64)}`,
  ]);
  expect(body).not.toHaveProperty('note');
  expect(run.host.relayers.checkRelayer).toHaveBeenCalledTimes(2);
});

it.each(['context', 'snapshot', 'close', 'cancel'] as const)(
  '%s invalidates delayed proof without leaking a review or sending',
  async (action) => {
    const run = setup(),
      started = deferred<void>(),
      blocked = deferred<void>();
    const original = run.host.prove!;
    jest
      .mocked(run.host.prove!)
      .mockImplementationOnce(async (request, options) => {
        started.resolve();
        await blocked.promise;
        return original(request, options);
      });
    const preparing = run.controller.prepareWithdrawal(direct());
    const rejected = expect(preparing).rejects.toThrow(/^privacy_/);
    await started.promise;
    if (action === 'context') run.change();
    if (action === 'snapshot') run.invalidate();
    if (action === 'close') run.controller.close();
    if (action === 'cancel') run.controller.cancelPreparation();
    blocked.resolve();
    await rejected;
    expect(run.host.beforeSubmission).not.toHaveBeenCalled();
    expect(run.fetcher).not.toHaveBeenCalled();
  }
);

it('allows only one active proof and TTL begins after completion, not before', async () => {
  jest.useFakeTimers();
  const run = setup(),
    started = deferred<void>(),
    blocked = deferred<void>();
  const original = run.host.prove!;
  jest
    .mocked(run.host.prove!)
    .mockImplementationOnce(async (request, options) => {
      started.resolve();
      await blocked.promise;
      return original(request, options);
    });
  const preparing = run.controller.prepareWithdrawal(direct());
  await started.promise;
  await expect(run.controller.prepareWithdrawal(direct())).rejects.toThrow(
    'privacy_proof_busy'
  );
  run.clock(2000000120000);
  blocked.resolve();
  const review = await preparing;
  expect(review.expiresAt).toBe(
    2000000120000 + PRIVACY_WITHDRAWAL_INTENT_TTL_MS
  );
  await jest.advanceTimersByTimeAsync(PRIVACY_WITHDRAWAL_INTENT_TTL_MS);
  await expect(
    run.controller.submitWithdrawal(review.intentId)
  ).rejects.toThrow('privacy_withdrawal_intent_expired');
});

it.each(['context', 'snapshot'] as const)(
  '%s change during durable reservation prevents send',
  async (action) => {
    jest.useFakeTimers();
    const run = setup(),
      review = await run.controller.prepareWithdrawal(direct());
    jest.mocked(run.host.beforeSubmission).mockImplementationOnce(async () => {
      if (action === 'context') run.change();
      else run.invalidate();
    });
    await expect(
      run.controller.submitWithdrawal(review.intentId)
    ).rejects.toThrow(/^privacy_/);
    expect(run.host.sendTransaction).not.toHaveBeenCalled();
    expect(run.host.recordNotBroadcast).toHaveBeenCalled();
  }
);

it('revalidates selected endpoint before reservation and never falls back to direct mode', async () => {
  jest.useFakeTimers();
  const run = setup();
  await run.controller.getRelayers();
  const review = await run.controller.prepareWithdrawal(relayed());
  jest
    .mocked(run.host.relayers.checkRelayer)
    .mockRejectedValueOnce(new Error('privacy_relayer_changed'));
  await expect(
    run.controller.submitWithdrawal(review.intentId)
  ).rejects.toThrow('privacy_relayer_changed');
  expect(run.fetcher).not.toHaveBeenCalled();
  expect(run.host.sendTransaction).not.toHaveBeenCalled();
  expect(run.host.beforeSubmission).not.toHaveBeenCalled();
});

it.each(['network', 'bad-json', 'oversized', 'bad-id'] as const)(
  'relay %s failure stays durable unknown with no retry',
  async (kind) => {
    jest.useFakeTimers();
    const run = setup();
    await run.controller.getRelayers();
    const review = await run.controller.prepareWithdrawal(relayed());
    if (kind === 'network')
      run.fetcher.mockRejectedValueOnce(new Error('secret response text'));
    if (kind === 'bad-json')
      run.fetcher.mockResolvedValueOnce(
        new Response('secret malformed', {
          headers: { 'content-type': 'application/json' },
        })
      );
    if (kind === 'oversized')
      run.fetcher.mockResolvedValueOnce(
        new Response('x'.repeat(4097), {
          headers: { 'content-type': 'application/json' },
        })
      );
    if (kind === 'bad-id')
      run.fetcher.mockResolvedValueOnce(
        new Response('{"id":"invalid"}', {
          headers: { 'content-type': 'application/json' },
        })
      );
    expect(
      await run.controller.submitWithdrawal(review.intentId)
    ).toMatchObject({ phase: 'unknown' });
    expect(run.host.recordNotBroadcast).not.toHaveBeenCalled();
    expect(run.fetcher).toHaveBeenCalledTimes(1);
    await expect(
      run.controller.submitWithdrawal(review.intentId)
    ).rejects.toThrow('privacy_withdrawal_intent_expired');
  }
);

it('acknowledgement persists against original attempt despite post-send session change', async () => {
  jest.useFakeTimers();
  const run = setup(),
    review = await run.controller.prepareWithdrawal(direct());
  jest
    .mocked(run.host.sendTransaction)
    .mockImplementationOnce(async (_transaction, _session, ack) => {
      run.change();
      await ack({ hash: HASH });
      throw new Error('changed after broadcast');
    });
  expect(await run.controller.submitWithdrawal(review.intentId)).toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect(run.host.recordSubmission).toHaveBeenCalledWith(
    jest.mocked(run.host.beforeSubmission).mock.calls[0][0],
    { transactionHash: HASH }
  );
});

it('failed durable acknowledgement returns known hash as unknown rather than clearing reservation', async () => {
  jest.useFakeTimers();
  const run = setup(),
    review = await run.controller.prepareWithdrawal(direct());
  jest
    .mocked(run.host.recordSubmission)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await run.controller.submitWithdrawal(review.intentId)).toMatchObject({
    phase: 'unknown',
    transactionHash: HASH,
  });
  expect(run.host.recordNotBroadcast).not.toHaveBeenCalled();
});

it('conflicting transaction acknowledgements cannot report submitted success', async () => {
  jest.useFakeTimers();
  const run = setup(),
    review = await run.controller.prepareWithdrawal(direct());
  jest
    .mocked(run.host.sendTransaction)
    .mockImplementationOnce(async (_transaction, _session, ack) => {
      await ack({ hash: HASH });
      return { hash: `0x${'cd'.repeat(32)}` };
    });
  expect(await run.controller.submitWithdrawal(review.intentId)).toMatchObject({
    phase: 'unknown',
    transactionHash: HASH,
  });
});

it.each([
  { mode: 'automatic' },
  { noteId: 'bad' },
  { recipient: '0x0000000000000000000000000000000000000000' },
  { relayerId: ENS_HASH },
  { note: NOTE },
  { proof: '0x00' },
])(
  'rejects extra secret/mode/address input %j before accessing custody',
  async (bad) => {
    const run = setup();
    await expect(
      run.controller.prepareWithdrawal({ ...direct(), ...bad } as any)
    ).rejects.toThrow('privacy_withdrawal_request_invalid');
    expect(run.host.withNote).not.toHaveBeenCalled();
  }
);

it.each(['1', '649999', '650001', '-1'])(
  'rejects unqualified direct gas limit %s',
  async (gasLimit) => {
    const run = setup();
    jest
      .mocked(run.host.quoteDirectFees)
      .mockResolvedValueOnce({ gasLimit, nonce: '1', gasPrice: '1' });
    await expect(run.controller.prepareWithdrawal(direct())).rejects.toThrow(
      'privacy_withdrawal_fee_invalid'
    );
    expect(run.host.prove).not.toHaveBeenCalled();
  }
);

it('guards context across public fee lookup and rejects altered proof signals', async () => {
  const run = setup();
  jest.mocked(run.host.quoteDirectFees).mockImplementationOnce(async () => {
    run.change();
    return { gasLimit: '650000', nonce: '1', gasPrice: '1' };
  });
  await expect(run.controller.prepareWithdrawal(direct())).rejects.toThrow(
    'privacy_withdrawal_context_changed'
  );
  expect(run.host.prove).not.toHaveBeenCalled();
  const second = setup();
  jest.mocked(second.host.prove!).mockResolvedValueOnce({
    proof: `0x${'01'.repeat(256)}`,
    publicSignals: ['0', '0', '0', '0', '0', '0'],
  });
  await expect(second.controller.prepareWithdrawal(direct())).rejects.toThrow(
    'privacy_proof_verification_failed'
  );
});

it('copies caller request before awaiting custody', async () => {
  jest.useFakeTimers();
  const run = setup(),
    blocked = deferred<void>(),
    started = deferred<void>(),
    request = direct();
  const original = run.host.withNote;
  jest
    .mocked(run.host.withNote)
    .mockImplementationOnce(async (id, session, use) => {
      started.resolve();
      await blocked.promise;
      return original(id, session, use);
    });
  const preparing = run.controller.prepareWithdrawal(request);
  await started.promise;
  request.recipient = RELAYER;
  blocked.resolve();
  expect((await preparing).recipient).toBe(fixture.input.recipient);
  run.controller.close();
});

it('rejects asynchronous snapshot assertions and sanitizes callback error text', async () => {
  const run = setup();
  jest.mocked(run.host.getSnapshot).mockResolvedValueOnce({
    snapshot: run.snapshot,
    getPath: async () => ({ pathElements: [], pathIndices: [] }),
    assertSnapshotCurrent: (async () => undefined) as any,
  });
  await expect(run.controller.prepareWithdrawal(direct())).rejects.toThrow(
    'privacy_verification_pending'
  );
  const other = setup();
  jest
    .mocked(other.host.withNote)
    .mockRejectedValueOnce(new Error('privacy_customer_password'));
  await expect(other.controller.prepareWithdrawal(direct())).rejects.toThrow(
    'privacy_withdrawal_failed'
  );
});

it('no send occurs if durable reservation fails and sender failure only clears proven unbroadcast attempts', async () => {
  jest.useFakeTimers();
  const run = setup();
  const review = await run.controller.prepareWithdrawal(direct());
  jest
    .mocked(run.host.beforeSubmission)
    .mockRejectedValueOnce(new Error('storage failed'));
  await expect(
    run.controller.submitWithdrawal(review.intentId)
  ).rejects.toThrow('privacy_withdrawal_failed');
  expect(run.host.sendTransaction).not.toHaveBeenCalled();
  expect(run.host.recordNotBroadcast).not.toHaveBeenCalled();
  const second = setup();
  const next = await second.controller.prepareWithdrawal(direct());
  jest.mocked(second.host.sendTransaction).mockRejectedValueOnce(
    Object.assign(new Error('send rejected'), {
      transactionNotBroadcast: true,
    })
  );
  await expect(
    second.controller.submitWithdrawal(next.intentId)
  ).rejects.toThrow('privacy_withdrawal_failed');
  expect(second.host.recordNotBroadcast).toHaveBeenCalledTimes(1);
});

it('a consumed relay request times out as unknown and cannot be repeated', async () => {
  jest.useFakeTimers();
  const run = setup();
  await run.controller.getRelayers();
  const review = await run.controller.prepareWithdrawal(relayed());
  run.fetcher.mockImplementationOnce(() => new Promise(() => undefined));
  const submission = run.controller.submitWithdrawal(review.intentId);
  await jest.advanceTimersByTimeAsync(15000);
  expect(await submission).toMatchObject({ phase: 'unknown' });
  expect(run.fetcher).toHaveBeenCalledTimes(1);
  expect(run.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(run.host.recordNotBroadcast).not.toHaveBeenCalled();
});

async function recordedRelay(run: ReturnType<typeof setup>) {
  await run.controller.getRelayers();
  const review = await run.controller.prepareWithdrawal(relayed());
  await run.controller.submitWithdrawal(review.intentId);
  const attempt = jest.mocked(run.host.beforeSubmission).mock.calls[0][0];
  if (attempt.mode !== 'relayed') throw new Error();
  const args = [
    attempt.root,
    attempt.nullifierHash,
    attempt.recipient,
    attempt.relayer,
    `0x${BigInt(attempt.fee).toString(16).padStart(64, '0')}`,
    `0x${'0'.repeat(64)}`,
  ];
  const record: IPrivacyWithdrawalStatusRecord = {
    noteId: NOTE_ID,
    poolId: 'eth-1',
    intentId: attempt.intentId,
    createdAt: attempt.createdAt,
    attemptHash: `0x${'aa'.repeat(32)}`,
    mode: 'relayed',
    phase: 'submitted',
    endpoint: attempt.endpoint,
    ensHash: ENS_HASH,
    jobId: JOB_ID,
    proofHash: keccak256(attempt.proof),
    inputHash: keccak256(
      AbiCoder.defaultAbiCoder().encode(
        Array(6).fill('uint256'),
        args.map((value) => BigInt(value).toString())
      )
    ),
  };
  const job = {
    id: JOB_ID,
    type: 'TORNADO_WITHDRAW',
    status: 'CONFIRMED',
    proof: attempt.proof,
    args,
    contract: PRIVACY_POOLS[1].address,
    txHash: HASH,
    failedReason: 'untrusted text',
  };
  jest.mocked(run.host.getWithdrawalAttempt).mockResolvedValue(record);
  return { record, job };
}

it('manual job status matches durable hashes and stores only a bound acknowledgement', async () => {
  jest.useFakeTimers();
  const run = setup();
  const { record, job } = await recordedRelay(run);
  run.fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify(job), {
      headers: { 'content-type': 'application/json' },
    })
  );
  const result = await run.controller.statusByNote(NOTE_ID);
  expect(result).toEqual({
    noteId: NOTE_ID,
    phase: 'submitted',
    mode: 'relayed',
    jobId: JOB_ID,
    claimedStatus: 'CONFIRMED',
    transactionHash: HASH,
  });
  expect(result).not.toHaveProperty('spent');
  expect(JSON.stringify(result)).not.toContain('proof');
  expect(run.host.recordJobStatus).toHaveBeenCalledWith(
    NOTE_ID,
    record.attemptHash,
    { jobId: JOB_ID, transactionHash: HASH },
    expect.any(Object)
  );
  expect(run.fetcher).toHaveBeenLastCalledWith(
    `https://relay.example/v1/jobs/${JOB_ID}`,
    expect.objectContaining({ method: 'GET' })
  );
  expect(run.fetcher).toHaveBeenCalledTimes(2); // one explicit submit, one explicit status read
});

it('a forged job or transaction hash cannot update the durable attempt', async () => {
  jest.useFakeTimers();
  const run = setup();
  const { record, job } = await recordedRelay(run);
  run.fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ...job,
        args: [...job.args.slice(0, 5), `0x${'0'.repeat(63)}1`],
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  );
  await expect(run.controller.statusByNote(NOTE_ID)).rejects.toThrow(
    'privacy_relayer_job_invalid'
  );
  expect(run.host.recordJobStatus).not.toHaveBeenCalled();
  jest.mocked(run.host.getWithdrawalAttempt).mockResolvedValueOnce({
    ...record,
    transactionHash: `0x${'cd'.repeat(32)}`,
  });
  run.fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify(job), {
      headers: { 'content-type': 'application/json' },
    })
  );
  await expect(run.controller.statusByNote(NOTE_ID)).rejects.toThrow(
    'privacy_relayer_job_invalid'
  );
  expect(run.host.recordJobStatus).not.toHaveBeenCalled();
});

it('unsubmitted or direct attempt status reads remain local', async () => {
  const run = setup();
  expect(await run.controller.statusByNote(NOTE_ID)).toEqual({
    noteId: NOTE_ID,
    phase: 'none',
  });
  const base: IPrivacyWithdrawalStatusRecord = {
    noteId: NOTE_ID,
    poolId: 'eth-1',
    intentId: JOB_ID,
    createdAt: 1,
    attemptHash: `0x${'aa'.repeat(32)}`,
    inputHash: `0x${'bb'.repeat(32)}`,
    proofHash: `0x${'cc'.repeat(32)}`,
    mode: 'direct',
    phase: 'unknown',
  };
  jest.mocked(run.host.getWithdrawalAttempt).mockResolvedValueOnce(base);
  expect(await run.controller.statusByNote(NOTE_ID)).toMatchObject({
    noteId: NOTE_ID,
    phase: 'unknown',
    mode: 'direct',
  });
  jest
    .mocked(run.host.getWithdrawalAttempt)
    .mockResolvedValueOnce({ ...base, mode: 'relayed' });
  expect(await run.controller.statusByNote(NOTE_ID)).toMatchObject({
    phase: 'unknown',
    mode: 'relayed',
  });
  expect(run.fetcher).not.toHaveBeenCalled();
  expect(run.host.withNote).not.toHaveBeenCalled();
});

it('status read session invalidation prevents network or late response exposure', async () => {
  const run = setup();
  jest
    .mocked(run.host.getWithdrawalAttempt)
    .mockImplementationOnce(async () => {
      run.change();
      return null;
    });
  await expect(run.controller.statusByNote(NOTE_ID)).rejects.toThrow(
    'privacy_withdrawal_failed'
  );
  expect(run.fetcher).not.toHaveBeenCalled();
  jest.useFakeTimers();
  const other = setup();
  const { job } = await recordedRelay(other);
  other.fetcher.mockImplementationOnce(async () => {
    other.change();
    return new Response(JSON.stringify(job), {
      headers: { 'content-type': 'application/json' },
    });
  });
  await expect(other.controller.statusByNote(NOTE_ID)).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(other.host.recordJobStatus).not.toHaveBeenCalled();
});

it('persists a known broadcast hash carried by a post-broadcast sender error', async () => {
  jest.useFakeTimers();
  const run = setup();
  const review = await run.controller.prepareWithdrawal(direct());
  jest.mocked(run.host.sendTransaction).mockRejectedValueOnce(
    Object.assign(new Error('post-broadcast processing failed'), {
      transactionHash: HASH,
    })
  );
  expect(await run.controller.submitWithdrawal(review.intentId)).toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect(run.host.recordSubmission).toHaveBeenCalledWith(expect.any(Object), {
    transactionHash: HASH,
  });
  expect(run.host.recordNotBroadcast).not.toHaveBeenCalled();
});

it('projects only account identity fields from the captured host context', async () => {
  jest.useFakeTimers();
  const run = setup();
  (run.context.account as any).unrelatedSecret =
    'must-not-enter-review-or-attempt';
  (run.context as any).unrelatedSecret = 'must-not-enter-review-or-attempt';
  const review = await run.controller.prepareWithdrawal(direct());
  expect(JSON.stringify(review)).not.toContain('unrelatedSecret');
  await run.controller.submitWithdrawal(review.intentId);
  const attempt = jest.mocked(run.host.beforeSubmission).mock.calls[0][0];
  expect(JSON.stringify(attempt.context)).not.toContain('unrelatedSecret');
});

it('requires the production snapshot path provider and passes the same provider to the local prover', async () => {
  const { host, controller } = setup();
  try {
    await controller.prepareWithdrawal(direct());
    const access = await jest.mocked(host.getSnapshot).mock.results[0].value;
    expect(jest.mocked(host.prove!).mock.calls[0][1].getPath).toBe(
      access.getPath
    );
    expect(access.getPath).not.toHaveBeenCalled(); // The real builder, not controller, owns path derivation.
  } finally {
    controller.close();
  }
});

it('does not fall back to a full-tree proof build when a production snapshot has no local path provider', async () => {
  const { host, controller, snapshot } = setup();
  jest.mocked(host.getSnapshot).mockResolvedValue({
    snapshot,
    assertSnapshotCurrent: () => undefined,
  } as any);
  await expect(controller.prepareWithdrawal(direct())).rejects.toThrow(
    'privacy_verification_pending'
  );
  expect(host.prove).not.toHaveBeenCalled();
  expect(host.quoteDirectFees).not.toHaveBeenCalled();
});
