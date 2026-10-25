import { Interface, parseEther } from 'ethers';

import { KeyringAccountType } from 'types/network';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import type { IPrivacyTransactionsHost } from 'utils/privacy/transactionTypes';

import {
  createPrivacyTransactionsController,
  PRIVACY_DEPOSIT_INTENT_TTL_MS,
  PRIVACY_DEPOSIT_MAX_INTENTS,
} from './privacyTransactions';

const NOTE_ID = '00000000-0000-4000-8000-000000001000';
const HASH = '0x' + 'ab'.repeat(32);
const COMMITMENT = '0x' + '01'.repeat(32);
const ABI = new Interface(['function deposit(bytes32) payable']);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup() {
  let clock = 1000;
  let generation = 1;
  let id = 0;
  const events: string[] = [];
  const context = {
    account: {
      address: '0x' + '11'.repeat(20),
      id: 0,
      type: KeyringAccountType.HDAccount,
    },
    chainId: 1,
    rpcUrl: 'https://operator.example',
    slip44: 60,
    sessionGeneration: 1,
  };
  const host: IPrivacyTransactionsHost = {
    captureContext: jest.fn(() => {
      const captured = generation;
      const identity = JSON.stringify(context);
      return {
        context,
        assertCurrent: () => {
          if (captured !== generation || identity !== JSON.stringify(context))
            throw new Error('changed');
        },
      };
    }),
    prepareNote: jest.fn(async (poolId, noteId) => {
      events.push('durable-note');
      return { id: noteId || NOTE_ID, poolId };
    }),
    withCommitment: jest.fn(async (_id, _session, use) => use(COMMITMENT)),
    prepareFees: jest.fn(async () => ({
      gasLimit: '100000',
      nonce: '7',
      maxFeePerGas: '30000000000',
      maxPriorityFeePerGas: '1000000000',
    })),
    beforeSubmission: jest.fn(async () => {
      events.push('durable-marker');
    }),
    sendTransaction: jest.fn(async (_tx, _session, onBroadcast) => {
      events.push('send');
      await onBroadcast({ hash: HASH });
      return { hash: HASH };
    }),
    recordBroadcast: jest.fn(async () => {
      events.push('durable-hash');
    }),
    recordNotBroadcast: jest.fn(async () => {
      events.push('not-broadcast');
    }),
  };
  const controller = createPrivacyTransactionsController(host, {
    now: () => clock,
    randomId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  });
  return {
    controller,
    host,
    events,
    context,
    advance: (ms: number) => {
      clock += ms;
    },
    change: () => {
      generation++;
    },
  };
}

it.each(PRIVACY_POOLS)(
  'prepares a fixed $id call only after durable note creation',
  async (pool) => {
    const f = setup();
    const review = await f.controller.prepareDeposit({ poolId: pool.id });
    const call = jest.mocked(f.host.prepareFees).mock.calls[0][0];
    expect(call).toEqual({
      chainId: 1,
      from: f.context.account.address,
      to: pool.address,
      value: '0x' + parseEther(pool.amount).toString(16),
      data: ABI.encodeFunctionData('deposit', [COMMITMENT]),
    });
    expect(review).toMatchObject({
      poolId: pool.id,
      amount: pool.amount,
      valueWei: String(parseEther(pool.amount)),
      maxNetworkFeeWei: '3000000000000000',
      maxTotalWei: String(parseEther(pool.amount) + BigInt('3000000000000000')),
      feeMode: 'eip1559',
      nonce: '7',
    });
    expect(f.events).toEqual(['durable-note']);
    expect(f.host.beforeSubmission).not.toHaveBeenCalled();
    expect(f.host.sendTransaction).not.toHaveBeenCalled();
    expect(JSON.stringify(review)).not.toContain(COMMITMENT);
    expect(JSON.stringify(review)).not.toContain('operator.example');
    expect(review).not.toHaveProperty('data');
  }
);

it('waits for durable creation and refuses a context change during preparation', async () => {
  const f = setup();
  const note = deferred<{ id: string; poolId: 'eth-1' }>();
  jest.mocked(f.host.prepareNote).mockReturnValue(note.promise);
  let completed = false;
  const preparing = f.controller
    .prepareDeposit({ poolId: 'eth-1' })
    .then((value) => {
      completed = true;
      return value;
    });
  const failure = expect(preparing).rejects.toMatchObject({
    message: 'privacy_deposit_context_changed',
    transactionNotBroadcast: true,
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(f.host.prepareFees).not.toHaveBeenCalled();
  f.change();
  note.resolve({ id: NOTE_ID, poolId: 'eth-1' });
  await failure;
  expect(f.host.sendTransaction).not.toHaveBeenCalled();
});

it('projects only public account identity rather than a full wallet record', async () => {
  const f = setup();
  Object.assign(f.context.account, { xprv: 'must-not-escape' });
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect(review.account).toEqual({
    address: f.context.account.address,
    id: 0,
    type: KeyringAccountType.HDAccount,
  });
  expect(JSON.stringify(review)).not.toContain('must-not-escape');
});

it('binds the reviewed context through fee preparation and confirmation', async () => {
  for (const change of ['network', 'account', 'rpc', 'session']) {
    const f = setup();
    const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
    if (change === 'network') f.context.chainId = 57;
    if (change === 'account') f.context.account.id = 1;
    if (change === 'rpc') f.context.rpcUrl = 'https://other.example';
    if (change === 'session') f.change();
    await expect(
      f.controller.submitDeposit(review.intentId)
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.host.sendTransaction).not.toHaveBeenCalled();
  }
  const f = setup();
  jest.mocked(f.host.prepareFees).mockImplementation(async () => {
    f.change();
    return { nonce: '1', gasLimit: '50000', gasPrice: '100' };
  });
  await expect(
    f.controller.prepareDeposit({ poolId: 'eth-1' })
  ).rejects.toMatchObject({ message: 'privacy_deposit_context_changed' });
});

it('persists the attempt before sending and the acknowledged hash before success', async () => {
  const f = setup();
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect(await f.controller.submitDeposit(review.intentId)).toEqual({
    intentId: review.intentId,
    noteId: NOTE_ID,
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect(f.events).toEqual([
    'durable-note',
    'durable-marker',
    'send',
    'durable-hash',
  ]);
  expect(f.host.recordBroadcast).toHaveBeenCalledTimes(1);
  const attempt = jest.mocked(f.host.beforeSubmission).mock.calls[0][0];
  expect(Object.isFrozen(attempt)).toBe(true);
  expect(Object.isFrozen(attempt.context.account)).toBe(true);
  expect(Object.isFrozen(attempt.transaction)).toBe(true);
  await expect(f.controller.submitDeposit(review.intentId)).rejects.toThrow(
    'privacy_deposit_intent_expired'
  );
});

it('consumes confirmation before awaiting and invalidates sibling intents for the same note', async () => {
  const f = setup();
  const first = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  const sibling = await f.controller.prepareDeposit({
    poolId: 'eth-1',
    noteId: NOTE_ID,
  });
  const marker = deferred<void>();
  jest.mocked(f.host.beforeSubmission).mockReturnValue(marker.promise);
  const sending = f.controller.submitDeposit(first.intentId);
  await expect(f.controller.submitDeposit(first.intentId)).rejects.toThrow(
    'intent_expired'
  );
  await expect(f.controller.submitDeposit(sibling.intentId)).rejects.toThrow(
    'intent_expired'
  );
  expect(f.host.sendTransaction).not.toHaveBeenCalled();
  marker.resolve();
  await sending;
  expect(f.host.sendTransaction).toHaveBeenCalledTimes(1);
});

it('never sends after failed durable reservation or context change during reservation', async () => {
  const f = setup();
  jest
    .mocked(f.host.beforeSubmission)
    .mockRejectedValue(new Error('disk failed'));
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  await expect(
    f.controller.submitDeposit(review.intentId)
  ).rejects.toMatchObject({
    transactionNotBroadcast: true,
    message: 'privacy_deposit_submission_blocked',
  });
  expect(f.host.sendTransaction).not.toHaveBeenCalled();
  expect(f.host.recordNotBroadcast).not.toHaveBeenCalled();
  const changed = setup();
  jest.mocked(changed.host.beforeSubmission).mockImplementation(async () => {
    changed.change();
  });
  const other = await changed.controller.prepareDeposit({ poolId: 'eth-1' });
  await expect(
    changed.controller.submitDeposit(other.intentId)
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(changed.host.sendTransaction).not.toHaveBeenCalled();
});

it('retains an acknowledged hash when context changes while send is in flight', async () => {
  const f = setup();
  jest
    .mocked(f.host.sendTransaction)
    .mockImplementation(async (_tx, _session, onBroadcast) => {
      f.change();
      await onBroadcast({ hash: HASH });
      throw Object.assign(new Error('context changed after broadcast'), {
        transactionHash: HASH,
        transactionNotBroadcast: false,
      });
    });
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect((await f.controller.submitDeposit(review.intentId)).phase).toBe(
    'submitted'
  );
  expect(f.host.recordBroadcast).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({ chainId: 1 }),
    }),
    HASH
  );
});

it('returns unknown on ambiguous broadcast and never retries the sender', async () => {
  const f = setup();
  jest
    .mocked(f.host.sendTransaction)
    .mockRejectedValue(new Error('network timeout'));
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect(await f.controller.submitDeposit(review.intentId)).toEqual({
    intentId: review.intentId,
    noteId: NOTE_ID,
    phase: 'unknown',
  });
  await expect(f.controller.submitDeposit(review.intentId)).rejects.toThrow();
  expect(f.host.sendTransaction).toHaveBeenCalledTimes(1);
  expect(f.host.recordNotBroadcast).not.toHaveBeenCalled();
});

it('keeps a context loss after sender entry unknown when no hash was acknowledged', async () => {
  const f = setup();
  jest.mocked(f.host.sendTransaction).mockImplementation(async () => {
    f.change();
    throw new Error('context changed during send');
  });
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect((await f.controller.submitDeposit(review.intentId)).phase).toBe(
    'unknown'
  );
  expect(f.host.recordNotBroadcast).not.toHaveBeenCalled();
  expect(f.host.sendTransaction).toHaveBeenCalledTimes(1);
});

it('does not claim success for conflicting acknowledged hashes', async () => {
  const f = setup();
  jest
    .mocked(f.host.sendTransaction)
    .mockImplementation(async (_tx, _session, onBroadcast) => {
      await onBroadcast({ hash: HASH });
      const other = '0x' + 'cd'.repeat(32);
      await onBroadcast({ hash: other });
      return { hash: other };
    });
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect((await f.controller.submitDeposit(review.intentId)).phase).toBe(
    'unknown'
  );
  expect(f.host.recordBroadcast).toHaveBeenCalledTimes(1);
});

it('retains a known hash as unknown if durable acknowledgement fails', async () => {
  const f = setup();
  jest
    .mocked(f.host.recordBroadcast)
    .mockRejectedValue(new Error('disk failed'));
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect(await f.controller.submitDeposit(review.intentId)).toMatchObject({
    phase: 'unknown',
    transactionHash: HASH,
  });
  expect(f.host.sendTransaction).toHaveBeenCalledTimes(1);
  expect(f.host.recordBroadcast).toHaveBeenCalledTimes(1);
});

it('honors the durable per-note guard across a controller restart after an unknown send', async () => {
  const f = setup();
  const reserved = new Set<string>();
  jest.mocked(f.host.beforeSubmission).mockImplementation(async (attempt) => {
    if (reserved.has(attempt.noteId)) throw new Error('prior unknown attempt');
    reserved.add(attempt.noteId);
  });
  jest
    .mocked(f.host.sendTransaction)
    .mockRejectedValue(new Error('network timeout'));
  const first = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  expect((await f.controller.submitDeposit(first.intentId)).phase).toBe(
    'unknown'
  );
  const restarted = createPrivacyTransactionsController(f.host, {
    now: () => 2000,
    randomId: () => '00000000-0000-4000-8000-000000000999',
  });
  const second = await restarted.prepareDeposit({
    poolId: 'eth-1',
    noteId: NOTE_ID,
  });
  await expect(restarted.submitDeposit(second.intentId)).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.host.sendTransaction).toHaveBeenCalledTimes(1);
  expect(f.host.recordNotBroadcast).not.toHaveBeenCalled();
});

it('honors only explicit proven-not-broadcast errors before any acknowledgement', async () => {
  const f = setup();
  jest
    .mocked(f.host.sendTransaction)
    .mockRejectedValue(
      Object.assign(new Error('cancelled'), { transactionNotBroadcast: true })
    );
  const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
  await expect(
    f.controller.submitDeposit(review.intentId)
  ).rejects.toMatchObject({
    message: 'privacy_deposit_not_broadcast',
    transactionNotBroadcast: true,
  });
  expect(f.host.recordNotBroadcast).toHaveBeenCalledTimes(1);
});

it('does not broadcast expired, discarded, or closed intents', async () => {
  for (const action of ['expire', 'discard', 'close']) {
    const f = setup();
    const review = await f.controller.prepareDeposit({ poolId: 'eth-1' });
    if (action === 'expire') f.advance(PRIVACY_DEPOSIT_INTENT_TTL_MS);
    if (action === 'discard')
      await f.controller.discardDeposit(review.intentId);
    if (action === 'close') f.controller.close();
    await expect(
      f.controller.submitDeposit(review.intentId)
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.host.sendTransaction).not.toHaveBeenCalled();
  }
});

it.each([
  { gasLimit: '0', nonce: '1', gasPrice: '1' },
  { gasLimit: '1', nonce: '-1', gasPrice: '1' },
  { gasLimit: '1', nonce: '1', gasPrice: '1', maxFeePerGas: '2' },
  { gasLimit: '1', nonce: '1', maxFeePerGas: '2', maxPriorityFeePerGas: '3' },
  { gasLimit: '1', nonce: '18446744073709551616', gasPrice: '1' },
  { gasLimit: '1', nonce: '1', gasPrice: '1', to: '0x' + '22'.repeat(20) },
  { gasLimit: '1', nonce: '1', gasPrice: '1e9' },
])('rejects malformed or overbroad host fee projection %j', async (fees) => {
  const f = setup();
  jest.mocked(f.host.prepareFees).mockResolvedValue(fees);
  await expect(
    f.controller.prepareDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow('privacy_deposit_fee_invalid');
  expect(f.host.sendTransaction).not.toHaveBeenCalled();
});

it('supports exact legacy quantities without changing the fixed call', async () => {
  const f = setup();
  jest
    .mocked(f.host.prepareFees)
    .mockResolvedValue({ gasLimit: '0x186a0', nonce: '0x7', gasPrice: '0x64' });
  const review = await f.controller.prepareDeposit({ poolId: 'eth-0.1' });
  expect(review).toMatchObject({
    feeMode: 'legacy',
    maxNetworkFeeWei: '10000000',
    gasPrice: '100',
  });
  await f.controller.submitDeposit(review.intentId);
  expect(f.host.sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ nonce: '0x7', gasPrice: '0x64' }),
    expect.any(Object),
    expect.any(Function)
  );
});

it('rejects caller transaction overrides and redacts host preparation errors', async () => {
  const f = setup();
  await expect(
    f.controller.prepareDeposit({ poolId: 'eth-1', data: 'secret' } as any)
  ).rejects.toThrow('request_invalid');
  expect(f.host.prepareNote).not.toHaveBeenCalled();
  jest
    .mocked(f.host.prepareNote)
    .mockRejectedValue(new Error('privacy_deposit_secret raw-note'));
  await expect(
    f.controller.prepareDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow(/^privacy_deposit_prepare_failed$/);
});

it('bounds concurrent preparation including expired in-flight host work', async () => {
  const f = setup();
  const held = deferred<{ id: string; poolId: 'eth-1' }>();
  jest.mocked(f.host.prepareNote).mockReturnValue(held.promise);
  const preparing = Array.from({ length: PRIVACY_DEPOSIT_MAX_INTENTS }, () =>
    f.controller.prepareDeposit({ poolId: 'eth-1' })
  );
  const settled = Promise.allSettled(preparing);
  f.advance(PRIVACY_DEPOSIT_INTENT_TTL_MS * 2);
  await expect(
    f.controller.prepareDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow('intent_limit');
  f.controller.close();
  held.resolve({ id: NOTE_ID, poolId: 'eth-1' });
  await settled;
  expect(f.host.sendTransaction).not.toHaveBeenCalled();
});
