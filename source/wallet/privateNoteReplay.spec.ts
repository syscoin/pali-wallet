import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import {
  captureEvmSubmission,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { webcrypto } from 'crypto';
import { Interface, Transaction, Wallet, parseEther } from 'ethers';

import { KeyringAccountType } from '../types/network';
import { AsyncMutex } from '../utils/asyncMutex';
import { privateDepositUnsignedBytes } from '../utils/privacy/depositMetadata';
import { identifyClassicNote } from '../utils/privacy/note';
import { getPrivacyPool } from '../utils/privacy/registry';
import { privateWithdrawalUnsignedBytes } from '../utils/privacy/withdrawalMetadata';

import {
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
} from './evmSignedRecords';
import { EvmSignedReplay } from './evmSignedReplay';
import { authorizePrivateNoteReplay } from './privateNoteReplay';
import { createPrivateVaultController } from './privateVault';
import type { IPrivacyDepositAttempt } from '../utils/privacy/transactionTypes';
import type { IPrivacyWithdrawalAttempt } from '../utils/privacy/withdrawalTransactionTypes';

jest.unmock('syscoinjs-lib');
jest.mock('@trezor/connect-webextension', () => ({}));
const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const signer = new Wallet(`0x${'11'.repeat(32)}`);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

async function fixture(
  tagged = true,
  retained = true,
  kind: 'deposit' | 'withdrawal' = 'deposit'
) {
  const keyring: any = Object.create(KeyringManager.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () =>
    'synthetic private deposit integration root';
  const values: Record<string, any> = {};
  const mutex = new AsyncMutex();
  let generation = 1,
    sequence = 1;
  const session = () => {
    const captured = generation;
    return {
      keyring,
      generation,
      assertCurrent() {
        if (captured !== generation) throw Error('retired');
      },
    };
  };
  const dependencies = {
    mutex,
    generate: () => NOTE,
    identify: identifyClassicNote,
    now: () => 1000,
    deadlineNow: () => 1000,
    randomId: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    storage: {
      getItem: async (key: string) => values[key],
      setItem: async (key: string, value: unknown) => {
        values[key] = value;
      },
    },
  };
  let noteStatus: 'not-found' | 'verified' = 'not-found';
  const host = {
    captureSession: session,
    readNote: async () => ({ phase: noteStatus }),
    authenticate: async (
      _password: string,
      scope: ReturnType<typeof session>,
      reveal: () => Promise<any>
    ) => {
      scope.assertCurrent();
      return reveal();
    },
  };
  const vault = () => createPrivateVaultController(host, dependencies);
  const note = await vault().createDepositNote('eth-1');
  const pool = getPrivacyPool('eth-1');
  const attempt: IPrivacyDepositAttempt = {
    intentId: '00000000-0000-4000-8000-000000000099',
    noteId: note.id,
    poolId: pool.id,
    createdAt: 1000,
    expiresAt: 61000,
    context: {
      chainId: 1,
      rpcUrl: 'https://private.invalid',
      slip44: 60,
      sessionGeneration: generation,
      account: {
        id: 0,
        type: KeyringAccountType.HDAccount,
        address: signer.address,
      },
    },
    transaction: {
      chainId: 1,
      from: signer.address,
      to: pool.address,
      value: parseEther(pool.amount).toString(),
      data: new Interface([
        'function deposit(bytes32) payable',
      ]).encodeFunctionData('deposit', [identifyClassicNote(NOTE).commitment]),
      gasLimit: '100000',
      nonce: '0',
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
  };
  let direct: Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }> = {
    ...attempt,
    mode: 'direct',
    proof: '0x' + 'ab'.repeat(256),
    root: '0x' + '01'.repeat(32),
    nullifierHash: identifyClassicNote(NOTE).nullifierHash,
    recipient: signer.address,
    relayer: '0x' + '00'.repeat(20),
    fee: '0',
    refund: '0',
    transaction: {
      ...attempt.transaction,
      gasLimit: '650000',
      value: '0',
      data: '',
    },
  };
  direct = {
    ...direct,
    transaction: {
      ...direct.transaction,
      data: new Interface([
        'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256) payable',
      ]).encodeFunctionData('withdraw', [
        direct.proof,
        direct.root,
        direct.nullifierHash,
        direct.recipient,
        direct.relayer,
        direct.fee,
        direct.refund,
      ]),
    },
  };
  const privateAttempt = kind === 'deposit' ? attempt : direct;
  if (kind === 'deposit')
    await vault().reserveDepositAttempt(attempt, session());
  else {
    noteStatus = 'verified';
    await vault().reserveWithdrawalAttempt(direct, session());
  }
  const raw = await signer.signTransaction(
    Transaction.from(
      kind === 'deposit'
        ? privateDepositUnsignedBytes(attempt)
        : privateWithdrawalUnsignedBytes(direct)
    )
  );
  const tx = Transaction.from(raw);
  const storage = {
    read: async (profile: string) => values[`signed:${profile}`],
    compareAndSet: async (
      profile: string,
      expected: string | undefined,
      next: string,
      check: () => void
    ) =>
      mutex.runExclusive(async () => {
        check();
        const key = `signed:${profile}`;
        if (values[key] !== expected) return false;
        values[key] = next;
        return true;
      }),
  };
  let journal = new EvmSignedRecords(storage, () => 1000);
  const records = () => journal;
  const context = {
    account: attempt.context.account,
    network: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      url: attempt.context.rpcUrl,
    },
    operation: 'send' as const,
  };
  if (retained) {
    await records().append(
      session(),
      {
        context,
        rawTransaction: raw,
        hash: tx.hash!,
        from: signer.address,
        chainId: '1',
        nonce: 0,
        type: 2,
      },
      tagged
        ? kind === 'deposit'
          ? { privateDeposit: attempt }
          : { privateWithdrawal: direct }
        : undefined
    );
  }
  const sent: string[] = [];
  let beforeAck: () => Promise<void> = async () => undefined;
  let terminal: 'confirmed' | 'reverted' | undefined;
  let beforeAuthorize: () => Promise<void> = async () => undefined;
  let viewCurrent = true;
  let acknowledge!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const privateAuthorizations = jest.fn(
    async (
      scope: ReturnType<typeof session>,
      input: IPrivacyDepositAttempt
    ) => {
      await beforeAuthorize();
      const lease =
        kind === 'deposit'
          ? await vault().authorizeDepositReplay(input, scope)
          : await vault().authorizeWithdrawalReplay(direct, scope);
      return {
        ...lease,
        async onAcknowledged(hash: string) {
          await lease.onAcknowledged(hash);
          acknowledge();
        },
      };
    }
  );
  const replay = () => {
    const scope = session();
    const assertView = () => {
      scope.assertCurrent();
      if (!viewCurrent) throw Error('view changed');
    };
    return new EvmSignedReplay(
      records(),
      () => ({
        context,
        recordSession: scope,
        assertCurrent: assertView,
        authorizeReplay: (entry) =>
          authorizePrivateNoteReplay(
            entry,
            assertView,
            (input) => privateAuthorizations(scope, input),
            () => privateAuthorizations(scope, privateAttempt)
          ),
        observe: async () =>
          terminal
            ? {
                status: 'mined' as const,
                outcome: terminal,
                block: { number: '1', hash: '0x' + 'aa'.repeat(32) },
              }
            : { status: 'missing' as const, latestNonce: '0' },
        dispatch: async (bytes, admit) =>
          admit(
            () => {
              sent.push(bytes);
              return beforeAck().then(() => Transaction.from(bytes).hash!);
            },
            async () => undefined
          ),
      }),
      () => 1000,
      (n) => new Uint8Array(n).fill(7)
    );
  };
  return {
    attempt: privateAttempt,
    acknowledged,
    retireView() {
      viewCurrent = false;
    },
    beforeAuthorize(callback: () => Promise<void>) {
      beforeAuthorize = callback;
    },
    tx,
    raw,
    vault,
    session,
    replay,
    sent,
    records,
    privateAuthorizations,
    context,
    restart() {
      generation++;
      journal = new EvmSignedRecords(storage, () => 1000);
    },
    terminal(value: 'confirmed' | 'reverted') {
      terminal = value;
    },
    beforeAck(callback: () => Promise<void>) {
      beforeAck = callback;
    },
  };
}

it('reopens signed private bytes under a new session and journals only their acknowledged replay', async () => {
  const f = await fixture();
  f.restart();
  const replay = f.replay();
  const prepared = await replay.prepare(f.tx.hash!);
  if (prepared.status !== 'review') throw Error('Expected replay review');
  expect(await replay.confirm(prepared.review.id)).toEqual({
    status: 'submitted',
    hash: f.tx.hash,
  });
  expect(f.sent).toEqual([f.raw]);
  expect(
    await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
  ).toMatchObject({ phase: 'submitted', transactionHash: f.tx.hash });
});

it('rejects a restored private note after review without dispatching its saved bytes', async () => {
  const f = await fixture();
  const replay = f.replay();
  const prepared = await replay.prepare(f.tx.hash!);
  if (prepared.status !== 'review') throw Error('Expected replay review');
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const vault = f.vault();
  const plan = await vault.prepareRestore(entries, f.session());
  await vault.commitRestore(plan, entries, 'password', f.session());
  await expect(replay.confirm(prepared.review.id)).rejects.toThrow(
    'privacy_note_restore_required'
  );
  expect(f.sent).toEqual([]);
});

it('allows an ordinary external deposit to the same pool without a private note lease', async () => {
  const f = await fixture(false);
  const replay = f.replay();
  const prepared = await replay.prepare(f.tx.hash!);
  if (prepared.status !== 'review') throw Error('Expected replay review');
  await expect(replay.confirm(prepared.review.id)).resolves.toEqual({
    status: 'submitted',
    hash: f.tx.hash,
  });
  expect(f.privateAuthorizations).not.toHaveBeenCalled();
});

it('releases records and note locks before the network acknowledgement', async () => {
  const f = await fixture();
  let release!: () => void;
  let posted!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    posted = resolve;
  });
  f.beforeAck(() => {
    posted();
    return acknowledged;
  });
  const replay = f.replay();
  const prepared = await replay.prepare(f.tx.hash!);
  if (prepared.status !== 'review') throw Error('Expected replay review');
  const pending = replay.confirm(prepared.review.id);
  await started;
  // A real records write takes the same persistence mutex as the private vault.
  await expect(
    f
      .records()
      .updatePhase(f.session(), '1', signer.address, f.tx.hash!, 'attempted')
  ).resolves.toBeDefined();
  release();
  await expect(pending).resolves.toEqual({
    status: 'submitted',
    hash: f.tx.hash,
  });
});

it('binds private metadata under the records admission queue', async () => {
  const f = await fixture();
  const entry = await f
    .records()
    .readExact(f.session(), '1', signer.address, f.tx.hash!);
  if (!entry) throw Error('Expected saved transaction');
  const admit = jest.fn(async () => ({ result: true }));
  await expect(
    f
      .records()
      .withReplayAdmission(
        f.session(),
        { ...entry, metadata: undefined },
        admit
      )
  ).resolves.toBeNull();
  const changed = {
    ...f.attempt,
    intentId: '00000000-0000-4000-8000-000000000088',
  };
  await expect(
    f
      .records()
      .withReplayAdmission(
        f.session(),
        { ...entry, metadata: { privateDeposit: changed } },
        admit
      )
  ).resolves.toBeNull();
  expect(admit).not.toHaveBeenCalled();
});

it.each(['deposit', 'withdrawal'] as const)(
  'refuses tagged private %s speed-up and preserves its reservation after an explicit cancel ACK',
  async (kind) => {
    const f = await fixture(true, true, kind);
    const records = f.records();
    await expect(
      records.readReplacement(
        f.session(),
        '1',
        signer.address,
        f.tx.hash!,
        'speed-up'
      )
    ).resolves.toBeNull();
    await expect(
      records.captureVerifiedReplacement(f.session(), {
        chainId: '1',
        from: signer.address,
        nonce: 0,
        originalHash: f.tx.hash!,
        operation: 'speed-up',
      })
    ).rejects.toThrow('EVM_PRIVATE_NOTE_REPLACEMENT_UNAVAILABLE');
    const binding = await records.captureVerifiedReplacement(f.session(), {
      chainId: '1',
      from: signer.address,
      nonce: 0,
      originalHash: f.tx.hash!,
      operation: 'cancel',
    });
    const rawTransaction = await signer.signTransaction({
      chainId: 1,
      nonce: 0,
      to: signer.address,
      value: 0,
      data: '0x',
      type: 2,
      gasLimit: 42000,
      maxFeePerGas: 4,
      maxPriorityFeePerGas: 2,
    });
    const tx = Transaction.from(rawTransaction);
    await records.append(
      f.session(),
      {
        context: {
          ...f.context,
          operation: 'cancel',
          originalHash: f.tx.hash!,
        },
        rawTransaction,
        hash: tx.hash!,
        from: signer.address,
        chainId: '1',
        nonce: 0,
        type: 2,
      },
      undefined,
      binding
    );
    const replay = f.replay();
    const prepared = await replay.prepare(tx.hash!);
    if (prepared.status !== 'review')
      throw Error('Expected cancellation review');
    await expect(replay.confirm(prepared.review.id)).resolves.toEqual({
      status: 'submitted',
      hash: tx.hash,
    });
    expect(
      await (kind === 'deposit'
        ? f.vault().getDepositAttempt(f.attempt.noteId, f.session())
        : f.vault().getWithdrawalAttempt(f.attempt.noteId, f.session()))
    ).toMatchObject({ phase: 'unknown' });
    expect(f.privateAuthorizations).not.toHaveBeenCalled();
  }
);

it('reconciles a confirmed private ACK on explicit status inspection after restart', async () => {
  const f = await fixture();
  f.restart();
  f.terminal('confirmed');
  const result = await f.replay().prepare(f.tx.hash!);
  expect(result.status).toBe('confirmed');
  await f.acknowledged;
  expect(f.sent).toEqual([]);
  expect(
    await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
  ).toMatchObject({ phase: 'submitted', transactionHash: f.tx.hash });
});

it.each(['confirmed', 'reverted'] as const)(
  'preserves public %s history when its private note can no longer authorize replay',
  async (outcome) => {
    const f = await fixture();
    await f.vault().clearUnbroadcastDepositAttempt(f.attempt, f.session());
    f.terminal(outcome);
    expect((await f.replay().prepare(f.tx.hash!)).status).toBe(outcome);
    expect(f.sent).toEqual([]);
    expect(
      await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
    ).toBeNull();
  }
);

it('keeps signed preflight failures recoverable through the same private replay lease', async () => {
  const f = await fixture(true, false);
  const scope = f.session();
  const boundary = captureEvmSubmission(f.context, scope.assertCurrent, () =>
    createEvmSignedRecordLifecycle(f.records(), scope, {
      retirementReadForChain: null,
      metadata: { privateDeposit: f.attempt },
      preflight: async () => {
        throw Error('synthetic final preflight refusal');
      },
    })
  );
  const broadcast = jest.fn(async () => f.tx.hash!);
  await expect(
    submitSignedEvmTransaction(
      f.raw,
      (request) => request.admit(broadcast),
      boundary,
      undefined,
      f.tx.unsignedSerialized
    )
  ).rejects.toThrow('synthetic final preflight refusal');
  expect(broadcast).not.toHaveBeenCalled();
  const retained = await f
    .records()
    .readExact(f.session(), '1', signer.address, f.tx.hash!);
  expect(retained?.metadata).toEqual({ privateDeposit: f.attempt });
  expect(
    await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
  ).toMatchObject({ phase: 'unknown' });
  f.restart();
  const replay = f.replay();
  const prepared = await replay.prepare(f.tx.hash!);
  if (prepared.status !== 'review')
    throw Error('Expected private replay review');
  await expect(replay.confirm(prepared.review.id)).resolves.toEqual({
    status: 'submitted',
    hash: f.tx.hash,
  });
  expect(
    await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
  ).toMatchObject({ phase: 'submitted', transactionHash: f.tx.hash });
});

it('returns terminal history before a held private lease and does not queue repeated reconciliations', async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.beforeAuthorize(() => held);
  f.terminal('confirmed');
  const replay = f.replay();
  expect((await replay.prepare(f.tx.hash!)).status).toBe('confirmed');
  expect((await replay.prepare(f.tx.hash!)).status).toBe('confirmed');
  expect(f.privateAuthorizations).toHaveBeenCalledTimes(1);
  replay.cancel();
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(
    await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
  ).toMatchObject({ phase: 'unknown' });
  expect(f.sent).toEqual([]);
});

it('journals an exact replay ACK even if the visible account changes while the POST is pending', async () => {
  const f = await fixture();
  f.beforeAck(async () => {
    f.retireView();
  });
  const replay = f.replay();
  const prepared = await replay.prepare(f.tx.hash!);
  if (prepared.status !== 'review') throw Error('Expected replay review');
  await expect(replay.confirm(prepared.review.id)).resolves.toEqual({
    status: 'unknown',
    hash: f.tx.hash,
  });
  await f.acknowledged;
  expect(
    await f.vault().getDepositAttempt(f.attempt.noteId, f.session())
  ).toMatchObject({ phase: 'submitted', transactionHash: f.tx.hash });
});

it('replays a cold-reopened withdrawal with its original proof and records only its real acknowledgement', async () => {
  const f = await fixture(true, true, 'withdrawal');
  f.restart();
  const replay = f.replay();
  const ready = await replay.prepare(f.tx.hash!);
  if (ready.status !== 'review') throw new Error('Expected withdrawal review');
  await expect(replay.confirm(ready.review.id)).resolves.toEqual({
    status: 'submitted',
    hash: f.tx.hash,
  });
  expect(f.sent).toEqual([f.raw]);
  await expect(
    f.vault().getWithdrawalAttempt(f.attempt.noteId, f.session())
  ).resolves.toMatchObject({ phase: 'submitted', transactionHash: f.tx.hash });
});

it('refuses withdrawal replay after a restored-note fence and keeps the signed bytes', async () => {
  const f = await fixture(true, true, 'withdrawal');
  const replay = f.replay();
  const ready = await replay.prepare(f.tx.hash!);
  if (ready.status !== 'review') throw new Error('Expected withdrawal review');
  const entries = [
    { note: NOTE, createdAt: 1000, reconciliationRequired: true as const },
  ];
  const vault = f.vault();
  const plan = await vault.prepareRestore(entries, f.session());
  await vault.commitRestore(plan, entries, 'password', f.session());
  await expect(replay.confirm(ready.review.id)).rejects.toThrow();
  expect(f.sent).toEqual([]);
  expect(
    await f.records().readExact(f.session(), '1', signer.address, f.tx.hash!)
  ).not.toBeNull();
});

it('leaves an ordinary external withdrawal on the ordinary replay path', async () => {
  const f = await fixture(false, true, 'withdrawal');
  const replay = f.replay();
  const ready = await replay.prepare(f.tx.hash!);
  if (ready.status !== 'review') throw new Error('Expected ordinary review');
  await replay.confirm(ready.review.id);
  expect(f.sent).toEqual([f.raw]);
  expect(f.privateAuthorizations).not.toHaveBeenCalled();
});

it('rejects a mixed private marker before invoking either vault authorizer', async () => {
  const f = await fixture(true, true, 'withdrawal');
  const entry = await f
    .records()
    .readExact(f.session(), '1', signer.address, f.tx.hash!);
  if (!entry) throw new Error('Missing retained record');
  const authorize = jest.fn();
  await expect(
    authorizePrivateNoteReplay(
      { ...entry, metadata: { ...entry.metadata, privateDeposit: f.attempt } },
      () => undefined,
      authorize,
      authorize
    )
  ).rejects.toThrow('EVM_PRIVATE_NOTE_METADATA_INVALID');
  expect(authorize).not.toHaveBeenCalled();
});
