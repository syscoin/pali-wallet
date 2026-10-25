import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import { Interface, parseEther } from 'ethers';

import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { identifyClassicNote } from 'utils/privacy/note';
import type { IPrivateNoteStatus } from 'utils/privacy/privateVaultTypes';
import { getPrivacyPool } from 'utils/privacy/registry';
import type { IPrivacyDepositAttempt } from 'utils/privacy/transactionTypes';
import type { IPrivacyWithdrawalAttempt } from 'utils/privacy/withdrawalTransactionTypes';

import { createPrivacyTransactionsController } from './privacyTransactions';
import {
  createPrivateVaultController,
  IPrivateVaultSession,
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_STORAGE_PREFIX,
} from './privateVault';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({}));

// Synthetic roots and notes only. The released SDK's actual AEAD methods run;
// replacing the private root accessor avoids wallet storage, hardware and RPC.
const ROOT = 'synthetic private vault test root';
const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const SECOND_NOTE = `tornado-eth-1-1-0x${'02'.repeat(62)}`;
const UUID = '00000000-0000-4000-8000-000000000001';
const INTENT_ID = '00000000-0000-4000-8000-000000000002';
const TX_HASH = '0x' + 'ab'.repeat(32);
function depositAttempt(
  noteId: string,
  generation = 0,
  rawNote = NOTE,
  identify = identifyClassicNote
): IPrivacyDepositAttempt {
  const pool = getPrivacyPool('eth-1');
  const from = '0x' + '11'.repeat(20);
  return {
    intentId: INTENT_ID,
    noteId,
    poolId: pool.id,
    createdAt: 456,
    expiresAt: 60456,
    context: {
      chainId: 1,
      rpcUrl: 'https://operator.example',
      slip44: 60,
      sessionGeneration: generation,
      account: { address: from, id: 0, type: KeyringAccountType.HDAccount },
    },
    transaction: {
      chainId: 1,
      from,
      to: pool.address,
      value: '0x' + parseEther('1').toString(16),
      data: new Interface([
        'function deposit(bytes32) payable',
      ]).encodeFunctionData('deposit', [identify(rawNote).commitment]),
      gasLimit: '0x186a0',
      nonce: '0x7',
      maxFeePerGas: '0x64',
      maxPriorityFeePerGas: '0x1',
    },
  };
}
function withdrawalAttempt(
  noteId: string,
  mode: 'direct' | 'relayed' = 'direct',
  rawNote = NOTE,
  identify = identifyClassicNote
): IPrivacyWithdrawalAttempt {
  const identity = identify(rawNote);
  const base = {
    intentId: INTENT_ID,
    noteId,
    poolId: identity.poolId,
    createdAt: 456,
    expiresAt: 60456,
    context: depositAttempt(noteId, 0, NOTE, identify).context,
    root: '0x' + '01'.repeat(32),
    nullifierHash: identity.nullifierHash,
    recipient: '0x' + '22'.repeat(20),
    relayer: '0x' + '00'.repeat(20),
    fee: '0',
    refund: '0' as const,
    proof: '0x' + 'ab'.repeat(256),
  };
  if (mode === 'relayed')
    return {
      ...base,
      mode,
      relayer: '0x' + '33'.repeat(20),
      rewardAccount: '0x' + '33'.repeat(20),
      fee: '12345',
      endpoint: 'https://relay.example/base',
      ensHash: '0x' + '44'.repeat(32),
    };
  return {
    ...base,
    mode,
    transaction: {
      ...depositAttempt(noteId, 0, NOTE, identify).transaction,
      to: getPrivacyPool(identity.poolId).address,
      value: '0',
      gasLimit: '650000',
      data: new Interface([
        'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)',
      ]).encodeFunctionData('withdraw', [
        base.proof,
        base.root,
        base.nullifierHash,
        base.recipient,
        base.relayer,
        base.fee,
        base.refund,
      ]),
    },
  };
}
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fakeUnlockedKeyring(root = ROOT) {
  const keyring: any = Object.create(KeyringManager.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => root;
  return keyring as KeyringManager;
}

function fixture(
  generate?: () => string,
  identify?: typeof identifyClassicNote
) {
  const records: Record<string, any> = {};
  const mutex = new AsyncMutex();
  let keyring = fakeUnlockedKeyring();
  let generation = 0;
  let unlocked = true;
  let status: IPrivateNoteStatus = { phase: 'verified', blockNumber: 123 };
  const storage = {
    getItem: jest.fn(async (key: string) =>
      records[key] ? structuredClone(records[key]) : null
    ),
    setItem: jest.fn(async (key: string, value: unknown) => {
      records[key] = structuredClone(value);
    }),
  };
  const captureSession = (): IPrivateVaultSession => {
    if (!unlocked) throw new Error('privacy_vault_locked');
    const capturedKeyring = keyring;
    const capturedGeneration = generation;
    return {
      keyring,
      generation,
      assertCurrent: () => {
        if (
          !unlocked ||
          generation !== capturedGeneration ||
          keyring !== capturedKeyring
        )
          throw new Error('privacy_vault_session_changed');
      },
    };
  };
  const authenticate = jest.fn(
    async (
      password: string,
      session: IPrivateVaultSession,
      reveal: () => Promise<string>
    ) => {
      session.assertCurrent();
      if (password !== 'correct-password') throw new Error('Invalid password');
      const result = await reveal();
      session.assertCurrent();
      return result;
    }
  );
  const readNote = jest.fn(async () => status);
  const create = () =>
    createPrivateVaultController(
      { captureSession, authenticate, readNote },
      { storage, mutex, now: () => 456, generate, identify }
    );
  const controller = create();
  return {
    controller,
    create,
    records,
    storage,
    mutex,
    authenticate,
    readNote,
    captureSession,
    setStatus: (value: IPrivateNoteStatus) => {
      status = value;
    },
    getKeyring: () => keyring,
    replaceKeyring: (root = ROOT) => {
      keyring = fakeUnlockedKeyring(root);
      generation++;
    },
    lock: () => {
      unlocked = false;
      generation++;
    },
    unlock: () => {
      unlocked = true;
    },
  };
}

function capacityNotes(count = 128) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(index + 1000)
      .toString(16)
      .padStart(12, '0')}`,
    note: `tornado-eth-1-1-0x${(index + 1).toString(16).padStart(124, '0')}`,
    createdAt: 456,
  }));
}
async function capacityFixture(notes = capacityNotes()) {
  // Cache only real deterministic note identities, avoiding repeated Pedersen
  // calculations while exercising actual released SDK encryption and storage.
  const identities = new Map(
    notes.map(({ note }) => [note, identifyClassicNote(note)])
  );
  const identify = (note: string) => {
    let identity = identities.get(note);
    if (!identity) {
      identity = identifyClassicNote(note);
      identities.set(note, identity);
    }
    return identity;
  };
  const f = fixture(undefined, identify);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ version: 1, notes })
  );
  expect(plaintext.length).toBeLessThan(64 * 1024);
  const envelope = await f.getKeyring().encryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: UUID,
    plaintext,
  });
  plaintext.fill(0);
  const key = PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId;
  f.records[key] = envelope;
  return { f, notes, key, identify };
}
function capacityAttempt(
  note: { id: string; note: string },
  index: number,
  mode: 'direct' | 'relayed',
  identify = identifyClassicNote
) {
  const attempt = withdrawalAttempt(note.id, mode, note.note, identify);
  return attempt.mode === 'direct'
    ? {
        ...attempt,
        intentId: note.id,
        transaction: { ...attempt.transaction, nonce: String(index) },
      }
    : {
        ...attempt,
        intentId: note.id,
        endpoint:
          'https://relay.example/' +
          'a'.repeat(2048 - 'https://relay.example/'.length),
      };
}

it.each(['direct', 'relayed'] as const)(
  'keeps all 128 accepted notes spendable after their %s withdrawal journals grow',
  async (mode) => {
    const { f, notes, key, identify } = await capacityFixture();
    expect((await f.controller.getNotes()).notes).toHaveLength(128);
    const encrypt = jest.spyOn(f.getKeyring(), 'encryptPrivateRecord');
    const encryptedSizes: number[] = [];
    let storageWrites = 0;
    const recordOperationEvidence = () => {
      for (const [params] of encrypt.mock.calls)
        encryptedSizes.push(params.plaintext.length);
      // Retain the size assertion evidence, not hundreds of cleared plaintext
      // buffers and returned ciphertexts while this full-capacity loop runs.
      encrypt.mockClear();
      storageWrites += f.storage.setItem.mock.calls.length;
      // Both mock histories otherwise retain every full encrypted bundle,
      // although the storage fixture itself correctly retains only the latest.
      f.storage.setItem.mockClear();
      f.storage.getItem.mockClear();
    };
    const session = f.captureSession();
    for (const [index, note] of notes.entries()) {
      const attempt = capacityAttempt(note, index, mode, identify);
      await f.controller.reserveWithdrawalAttempt(attempt, session);
      recordOperationEvidence();
      await f.controller.recordWithdrawalSubmission(
        attempt,
        {
          transactionHash: TX_HASH,
          ...(mode === 'relayed' ? { jobId: 'x'.repeat(128) } : {}),
        },
        session
      );
      recordOperationEvidence();
    }
    expect(f.records[key].version).toBe(2);
    expect(f.records[key].shards.length).toBeGreaterThan(1);
    expect(storageWrites).toBe(256);
    expect(encryptedSizes.length).toBeGreaterThanOrEqual(256);
    expect(encryptedSizes.every((size) => size <= 64 * 1024)).toBe(true);
    const restarted = f.create();
    const restored = (await restarted.getNotes()).notes;
    expect(restored).toHaveLength(128);
    expect(
      restored.every((note) => note.withdrawal?.phase === 'submitted')
    ).toBe(true);
    const last = await restarted.getWithdrawalAttempt(notes[127].id, session);
    expect(last).toMatchObject({
      transactionHash: TX_HASH,
      mode,
      ...(mode === 'relayed'
        ? {
            endpoint:
              'https://relay.example/' +
              'a'.repeat(2048 - 'https://relay.example/'.length),
            jobId: 'x'.repeat(128),
          }
        : { nonce: '127' }),
    });
    expect(await restarted.revealNote(notes[0].id, 'correct-password')).toBe(
      notes[0].note
    );
    expect(await restarted.revealNote(notes[127].id, 'correct-password')).toBe(
      notes[127].note
    );
    const extra = `tornado-eth-1-1-0x${'ff'.repeat(62)}`;
    await expect(restarted.importNote(extra)).rejects.toThrow(
      'privacy_note_limit'
    );
    expect(JSON.stringify(f.records)).not.toContain(notes[0].note);
  }
);

async function chunkedFixture() {
  const ready = await capacityFixture(capacityNotes(32));
  const session = ready.f.captureSession();
  for (let i = 0; i < 24; i++) {
    const attempt = capacityAttempt(ready.notes[i], i, 'relayed');
    await ready.f.controller.reserveWithdrawalAttempt(attempt, session);
  }
  expect(ready.f.records[ready.key].version).toBe(2);
  return { ...ready, session };
}

it('bounds sharding for escaped long endpoints and both journal types', async () => {
  const notes = capacityNotes(8).map((note, index) => ({
    ...note,
    createdAt: Number.MAX_SAFE_INTEGER,
    origin: 'generated' as const,
    deposit: {
      intentId: note.id,
      createdAt: Number.MAX_SAFE_INTEGER,
      from: '0x' + '11'.repeat(20),
      nonce: String((BigInt(1) << BigInt(64)) - BigInt(1 + index)),
      phase: 'submitted' as const,
      attemptHash: '0x' + 'aa'.repeat(32),
      transactionHash: TX_HASH,
    },
  }));
  const { f, key } = await capacityFixture(notes);
  // URL accepts and encodes these path characters. Each remains six bytes in
  // JSON, covering the size expansion that an ASCII-only endpoint misses.
  const endpoint =
    'https://relay.example/' +
    '\u0000'.repeat(2048 - 'https://relay.example/'.length);
  expect(endpoint.length).toBe(2048);
  expect(new URL(endpoint).protocol).toBe('https:');
  const session = f.captureSession();
  const encrypt = jest.spyOn(f.getKeyring(), 'encryptPrivateRecord');
  for (const [index, note] of notes.entries()) {
    const base = withdrawalAttempt(note.id, 'relayed', note.note);
    if (base.mode !== 'relayed') throw new Error('Expected relayed fixture');
    const attempt = {
      ...base,
      intentId: note.id,
      endpoint,
      createdAt: Number.MAX_SAFE_INTEGER - 60000,
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
    await f.controller.reserveWithdrawalAttempt(attempt, session);
    if (index !== notes.length - 1)
      await f.controller.recordWithdrawalSubmission(
        attempt,
        { jobId: 'j'.repeat(128), transactionHash: TX_HASH },
        session
      );
  }
  expect(f.records[key].version).toBe(2);
  expect(
    encrypt.mock.calls
      .filter(([params]) => params.domain.endsWith('.shard.v2'))
      .every(([params]) => params.plaintext.length <= 32 * 1024)
  ).toBe(true);
  const restored = f.create();
  expect((await restored.getNotes()).notes).toHaveLength(notes.length);
  for (const [index, note] of notes.entries()) {
    expect(await restored.getDepositAttempt(note.id, session)).toEqual(
      note.deposit
    );
    expect(await restored.getWithdrawalAttempt(note.id, session)).toMatchObject(
      {
        endpoint,
        createdAt: Number.MAX_SAFE_INTEGER - 60000,
        phase: index === notes.length - 1 ? 'unknown' : 'submitted',
      }
    );
  }
  // Conservatively extend the largest observed plaintext note to the fixed
  // 128-note limit, include Base64 expansion and ample root/envelope overhead.
  const largest = new TextEncoder().encode(
    JSON.stringify({
      ...notes[0],
      withdrawal: await restored.getWithdrawalAttempt(notes[0].id, session),
    })
  ).length;
  expect(largest * 128 * (4 / 3) + 128 * 1024).toBeLessThan(4 * 1024 * 1024);
});

it('rejects missing, duplicate, swapped and stale encrypted shards without replacing saved data', async () => {
  const { f, key, notes, session } = await chunkedFixture();
  const saved = structuredClone(f.records[key]);
  const attempt = capacityAttempt(notes[24], 24, 'relayed');
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  const latest = structuredClone(f.records[key]);
  for (const corrupt of [
    { ...latest, shards: latest.shards.slice(1) },
    {
      ...latest,
      shards: [latest.shards[0], latest.shards[0], ...latest.shards.slice(2)],
    },
    { ...latest, shards: [...latest.shards].reverse() },
    { ...latest, shards: [saved.shards[0], ...latest.shards.slice(1)] },
  ]) {
    f.records[key] = corrupt;
    const before = f.storage.setItem.mock.calls.length;
    await expect(f.create().getNotes()).rejects.toThrow(
      'privacy_vault_corrupt'
    );
    expect(f.storage.setItem).toHaveBeenCalledTimes(before);
  }
  f.records[key] = latest;
  expect(
    (await f.create().getWithdrawalAttempt(notes[24].id, session))?.phase
  ).toBe('unknown');
});

it('keeps an atomic encrypted bundle readable after failed and uncertain writes', async () => {
  const { f, key, notes, session } = await chunkedFixture();
  const attempt = capacityAttempt(notes[24], 24, 'relayed');
  const saved = structuredClone(f.records[key]);
  f.storage.setItem.mockImplementationOnce(async () => {
    throw new Error('write refused');
  });
  await expect(
    f.controller.reserveWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(f.records[key]).toEqual(saved);
  expect(
    await f.create().getWithdrawalAttempt(notes[24].id, session)
  ).toBeNull();
  f.storage.setItem.mockImplementationOnce(async (storageKey, value) => {
    f.records[storageKey] = structuredClone(value);
    throw new Error('uncertain acknowledgement');
  });
  await expect(
    f.controller.reserveWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(
    (await f.create().getWithdrawalAttempt(notes[24].id, session))?.phase
  ).toBe('unknown');
  await expect(
    f.create().reserveWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_withdrawal_attempt_exists');
  await f.controller.clearUnbroadcastWithdrawalAttempt(attempt, session);
  expect(f.records[key].version).toBe(2);
  expect(
    await f.create().getWithdrawalAttempt(notes[24].id, session)
  ).toBeNull();
});

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
});
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

it('durably encrypts a generated note before returning its ID without a public lookup', async () => {
  const generate = jest.fn(() => NOTE);
  const f = fixture(generate);
  const entered = deferred();
  const release = deferred();
  const save = f.storage.setItem.getMockImplementation()!;
  f.storage.setItem.mockImplementation(async (key, value) => {
    entered.resolve();
    await release.promise;
    return save(key, value);
  });
  let completed = false;
  const creating = f.controller.createDepositNote('eth-1').then((value) => {
    completed = true;
    return value;
  });
  await entered.promise;
  expect(completed).toBe(false);
  expect(f.readNote).not.toHaveBeenCalled();
  release.resolve();
  const view = await creating;
  expect(view).toMatchObject({
    poolId: 'eth-1',
    amount: '1',
    phase: 'prepared',
  });
  expect(Object.keys(view).sort()).toEqual([
    'amount',
    'createdAt',
    'id',
    'phase',
    'poolId',
  ]);
  const serialized = JSON.stringify(f.records);
  for (const secret of [NOTE, ROOT, identifyClassicNote(NOTE).commitment])
    expect(serialized).not.toContain(secret);
  expect(f.readNote).not.toHaveBeenCalled();
  expect(await f.controller.revealNote(view.id, 'correct-password')).toBe(NOTE);
  f.setStatus({ phase: 'not-found', blockNumber: 123 });
  expect((await f.create().getNotes()).notes[0].phase).toBe('prepared');
  f.setStatus({ phase: 'verified', blockNumber: 124 });
  expect((await f.controller.getNotes()).notes[0].phase).toBe('verified');
  f.setStatus({ phase: 'spent', blockNumber: 125 });
  expect((await f.controller.getNotes()).notes[0].phase).toBe('spent');
  f.setStatus({ phase: 'waiting' });
  expect((await f.controller.getNotes()).notes[0].phase).toBe('waiting');
});

it('refuses an entropy collision without overwriting the existing note', async () => {
  const f = fixture(() => NOTE);
  const first = await f.controller.createDepositNote('eth-1');
  const stored = JSON.stringify(f.records);
  await expect(f.controller.createDepositNote('eth-1')).rejects.toThrow(
    'privacy_vault_unavailable'
  );
  expect(JSON.stringify(f.records)).toBe(stored);
  f.setStatus({ phase: 'not-found' });
  expect(
    (await f.controller.getNotes()).notes.map((entry) => entry.id)
  ).toEqual([first.id]);
});

it('prepares and reuses only durable generated notes through the internal interface', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const session = f.captureSession();
  const prepared = await f.controller.prepareDepositNote(
    'eth-1',
    undefined,
    session
  );
  expect(prepared).toEqual({ id: expect.any(String), poolId: 'eth-1' });
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  expect(
    await f.controller.prepareDepositNote('eth-1', prepared.id, session)
  ).toEqual(prepared);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  const use = jest.fn((commitment) => ({ publicCommitment: commitment }));
  expect(
    await f.controller.withDepositCommitment(prepared.id, session, use)
  ).toEqual({ publicCommitment: identifyClassicNote(NOTE).commitment });
  expect(use).toHaveBeenCalledWith(identifyClassicNote(NOTE).commitment);
  expect(JSON.stringify(use.mock.calls)).not.toContain(NOTE);
  const imported = fixture();
  const saved = await imported.controller.importNote(NOTE);
  imported.setStatus({ phase: 'not-found' });
  await expect(
    imported.controller.prepareDepositNote(
      'eth-1',
      saved.id,
      imported.captureSession()
    )
  ).rejects.toThrow('privacy_deposit_note_ineligible');
});

it('reuses the durable note after failed fee preparation and controller restart', async () => {
  const generate = jest
    .fn()
    .mockReturnValueOnce(NOTE)
    .mockReturnValue(SECOND_NOTE);
  const f = fixture(generate);
  f.setStatus({ phase: 'not-found' });
  const session = f.captureSession();
  const fees = jest
    .fn()
    .mockRejectedValueOnce(new Error('rpc unavailable'))
    .mockResolvedValue({
      gasLimit: '100000',
      nonce: '7',
      gasPrice: '100',
    });
  const send = jest.fn();
  const transactions = () =>
    createPrivacyTransactionsController({
      captureContext: () => ({
        context: depositAttempt(UUID).context,
        assertCurrent: session.assertCurrent,
      }),
      prepareNote: (poolId, noteId) =>
        f.create().prepareDepositNote(poolId, noteId, session),
      withCommitment: (noteId, _session, use) =>
        f.controller.withDepositCommitment(noteId, session, use),
      prepareFees: fees,
      beforeSubmission: (attempt) =>
        f.controller.reserveDepositAttempt(attempt, session),
      sendTransaction: send,
      recordBroadcast: (attempt, hash) =>
        f.controller.recordDepositBroadcast(attempt, hash, session),
      recordNotBroadcast: (attempt) =>
        f.controller.clearUnbroadcastDepositAttempt(attempt, session),
    });
  const first = transactions();
  await expect(first.prepareDeposit({ poolId: 'eth-1' })).rejects.toThrow();
  const saved = (await f.controller.getNotes()).notes[0];
  first.close();
  const restarted = transactions();
  const review = await restarted.prepareDeposit({ poolId: 'eth-1' });
  expect(review.noteId).toBe(saved.id);
  expect((await f.controller.getNotes()).notes).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

it.each(['not-found', 'waiting'] as const)(
  'deduplicates concurrent implicit preparations with %s local status',
  async (phase) => {
    const generate = jest
      .fn()
      .mockReturnValueOnce(NOTE)
      .mockReturnValue(SECOND_NOTE);
    const f = fixture(generate);
    f.setStatus({ phase });
    const session = f.captureSession();
    const notes = await Promise.all([
      f.controller.prepareDepositNote('eth-1', undefined, session),
      f.create().prepareDepositNote('eth-1', undefined, session),
    ]);
    expect(notes[0]).toEqual(notes[1]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  }
);

it.each(['verified', 'spent', 'unknown', 'submitted'] as const)(
  'does not implicitly reuse a %s deposit note',
  async (phase) => {
    const generate = jest
      .fn()
      .mockReturnValueOnce(NOTE)
      .mockReturnValueOnce(SECOND_NOTE);
    const f = fixture(generate);
    f.setStatus({ phase: 'not-found' });
    const session = f.captureSession();
    const first = await f.controller.prepareDepositNote(
      'eth-1',
      undefined,
      session
    );
    if (phase === 'verified' || phase === 'spent') f.setStatus({ phase });
    else {
      const attempt = depositAttempt(first.id);
      await f.controller.reserveDepositAttempt(attempt, session);
      if (phase === 'submitted')
        await f.controller.recordDepositBroadcast(attempt, TX_HASH, session);
    }
    const next = await f
      .create()
      .prepareDepositNote('eth-1', undefined, session);
    expect(next.id).not.toBe(first.id);
    expect(generate).toHaveBeenCalledTimes(2);
    if (phase === 'unknown' || phase === 'submitted') {
      expect(
        await f.controller.getDepositAttempt(first.id, session)
      ).toMatchObject({ phase });
      await expect(
        f.controller.reserveDepositAttempt(
          depositAttempt(next.id, 0, SECOND_NOTE),
          session
        )
      ).rejects.toThrow('privacy_deposit_attempt_exists');
    }
  }
);

it('keeps a durable unknown reservation across restart and excludes a prepared claim', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const attempt = depositAttempt(note.id);
  const session = f.captureSession();
  await f.controller.reserveDepositAttempt(attempt, session);
  const restarted = f.create();
  expect(await restarted.getDepositAttempt(note.id, session)).toMatchObject({
    intentId: INTENT_ID,
    phase: 'unknown',
    nonce: '7',
  });
  await expect(
    restarted.prepareDepositNote('eth-1', note.id, session)
  ).rejects.toThrow('privacy_deposit_attempt_exists');
  await expect(
    restarted.withDepositCommitment(note.id, session, () => undefined)
  ).rejects.toThrow('privacy_deposit_attempt_exists');
  expect((await restarted.getNotes()).notes[0].phase).toBe('waiting');
  const disk = JSON.stringify(f.records);
  for (const secret of [
    NOTE,
    note.id,
    INTENT_ID,
    attempt.context.account.address,
    attempt.context.rpcUrl,
  ])
    expect(disk).not.toContain(secret);
});

it('reserves exactly once under concurrent confirmations and awaits durable storage', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const first = depositAttempt(note.id);
  const entered = deferred(),
    release = deferred();
  const save = f.storage.setItem.getMockImplementation()!;
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    entered.resolve();
    await release.promise;
    return save(key, value);
  });
  let completions = 0;
  const otherId = '00000000-0000-4000-8000-000000000003';
  const reservations = [first, { ...first, intentId: otherId }].map((attempt) =>
    f.controller.reserveDepositAttempt(attempt, f.captureSession()).then(() => {
      completions++;
    })
  );
  const settled = Promise.allSettled(reservations);
  await entered.promise;
  expect(completions).toBe(0);
  release.resolve();
  const results = await settled;
  expect(completions).toBe(1);
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
    1
  );
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  expect(
    (
      results.find(
        ({ status }) => status === 'rejected'
      ) as PromiseRejectedResult
    ).reason.message
  ).toBe('privacy_deposit_attempt_exists');
  expect(
    (await f.create().getDepositAttempt(note.id, f.captureSession()))?.intentId
  ).toBe(results[0].status === 'fulfilled' ? INTENT_ID : otherId);
});

it('records only a matching acknowledged hash and never clears submitted or different attempts', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const attempt = depositAttempt(note.id);
  const session = f.captureSession();
  await f.controller.reserveDepositAttempt(attempt, session);
  await expect(
    f.controller.clearUnbroadcastDepositAttempt(
      { ...attempt, intentId: '00000000-0000-4000-8000-000000000003' },
      session
    )
  ).rejects.toThrow('privacy_deposit_attempt_invalid');
  await expect(
    f.controller.recordDepositBroadcast(
      { ...attempt, transaction: { ...attempt.transaction, nonce: '0x8' } },
      TX_HASH,
      session
    )
  ).rejects.toThrow('privacy_deposit_attempt_invalid');
  await f.controller.recordDepositBroadcast(attempt, TX_HASH, session);
  const written = f.storage.setItem.mock.calls.length;
  await f.controller.recordDepositBroadcast(attempt, TX_HASH, session);
  expect(f.storage.setItem).toHaveBeenCalledTimes(written);
  await expect(
    f.controller.clearUnbroadcastDepositAttempt(attempt, session)
  ).rejects.toThrow('privacy_deposit_attempt_invalid');
  expect(await f.create().getDepositAttempt(note.id, session)).toMatchObject({
    phase: 'submitted',
    transactionHash: TX_HASH,
  });
  expect((await f.controller.getNotes()).notes[0].phase).toBe('waiting');
  f.setStatus({ phase: 'verified', blockNumber: 124 });
  expect((await f.controller.getNotes()).notes[0].phase).toBe('verified');
});

it('clears only the matching proven-unbroadcast reservation for reuse', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const attempt = depositAttempt(note.id);
  const session = f.captureSession();
  await f.controller.reserveDepositAttempt(attempt, session);
  await f.controller.clearUnbroadcastDepositAttempt(attempt, session);
  expect(await f.create().getDepositAttempt(note.id, session)).toBeNull();
  expect(
    await f.controller.prepareDepositNote('eth-1', note.id, session)
  ).toEqual({ id: note.id, poolId: 'eth-1' });
});

it('does not reserve one account nonce for two different deposit notes', async () => {
  let count = 0;
  const f = fixture(() => (count++ === 0 ? NOTE : SECOND_NOTE));
  f.setStatus({ phase: 'not-found' });
  const first = await f.controller.createDepositNote('eth-1');
  const second = await f.controller.createDepositNote('eth-1');
  const session = f.captureSession();
  await f.controller.reserveDepositAttempt(depositAttempt(first.id), session);
  const other = {
    ...depositAttempt(second.id, 0, SECOND_NOTE),
    intentId: '00000000-0000-4000-8000-000000000003',
  };
  await expect(
    f.controller.reserveDepositAttempt(other, session)
  ).rejects.toThrow('privacy_deposit_attempt_exists');
  await f.controller.reserveDepositAttempt(
    { ...other, transaction: { ...other.transaction, nonce: '0x8' } },
    session
  );
  expect(
    (await f.controller.getDepositAttempt(second.id, session))?.nonce
  ).toBe('8');
});

it.each(['lock', 'replace'] as const)(
  'retains the original unknown reservation after %s before acknowledgement',
  async (change) => {
    const f = fixture(() => NOTE);
    f.setStatus({ phase: 'not-found' });
    const note = await f.controller.createDepositNote('eth-1');
    const attempt = depositAttempt(note.id);
    const oldSession = f.captureSession();
    await f.controller.reserveDepositAttempt(attempt, oldSession);
    const saved = JSON.stringify(f.records);
    if (change === 'lock') f.lock();
    else f.replaceKeyring('other root');
    await expect(
      f.controller.recordDepositBroadcast(attempt, TX_HASH, oldSession)
    ).rejects.toThrow('privacy_vault_session_changed');
    await expect(
      f.controller.clearUnbroadcastDepositAttempt(attempt, oldSession)
    ).rejects.toThrow('privacy_vault_session_changed');
    expect(JSON.stringify(f.records)).toBe(saved);
    if (change === 'lock') f.unlock();
    else f.replaceKeyring(ROOT);
    expect(
      await f.create().getDepositAttempt(note.id, f.captureSession())
    ).toMatchObject({ phase: 'unknown' });
  }
);

it('retains an unknown reservation when its crypto session changes during acknowledgement encryption', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const attempt = depositAttempt(note.id);
  const session = f.captureSession();
  await f.controller.reserveDepositAttempt(attempt, session);
  const saved = JSON.stringify(f.records);
  const keyring = f.getKeyring();
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementationOnce(async (input) => {
      const encrypted = await encrypt(input);
      f.lock();
      return encrypted;
    });
  await expect(
    f.controller.recordDepositBroadcast(attempt, TX_HASH, session)
  ).rejects.toThrow('privacy_vault_session_changed');
  expect(JSON.stringify(f.records)).toBe(saved);
});

it('rejects altered deposit destinations/commitments and journal ciphertext corruption', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const attempt = depositAttempt(note.id);
  const session = f.captureSession();
  await expect(
    f.controller.reserveDepositAttempt(
      {
        ...attempt,
        transaction: { ...attempt.transaction, to: '0x' + '22'.repeat(20) },
      },
      session
    )
  ).rejects.toThrow('privacy_deposit_attempt_invalid');
  await f.controller.reserveDepositAttempt(attempt, session);
  const key = Object.keys(f.records)[0];
  const envelope = f.records[key];
  envelope.ciphertext = envelope.ciphertext.slice(0, -4) + 'AAAA';
  await expect(f.create().getDepositAttempt(note.id, session)).rejects.toThrow(
    'privacy_vault_unavailable'
  );
});

it('does not report generated-note success when encryption or storage fails', async () => {
  const f = fixture(() => NOTE);
  f.storage.setItem.mockRejectedValueOnce(
    new Error('Synthetic storage failure')
  );
  await expect(f.controller.createDepositNote('eth-1')).rejects.toThrow(
    'privacy_vault_unavailable'
  );
  expect(f.records).toEqual({});
  expect(f.readNote).not.toHaveBeenCalled();
});

it('uses a verified note only inside an asynchronous background callback without holding persistence', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const use = jest.fn(async (raw, poolId) => {
    expect(raw).toBe(NOTE);
    expect(poolId).toBe('eth-1');
    expect((await f.controller.getNotes()).notes[0].id).toBe(saved.id);
    return { proof: 'synthetic-proof' };
  });
  expect(
    await f.controller.withWithdrawalNote(saved.id, f.captureSession(), use)
  ).toEqual({ proof: 'synthetic-proof' });
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(use).toHaveBeenCalledTimes(1);
});

it.each([
  ['waiting', 'privacy_verification_pending'],
  ['not-found', 'privacy_note_not_found'],
  ['spent', 'privacy_note_spent'],
] as const)(
  'refuses %s notes before the background proof callback',
  async (phase, error) => {
    const f = fixture();
    const saved = await f.controller.importNote(NOTE);
    f.setStatus({ phase });
    const use = jest.fn();
    await expect(
      f.controller.withWithdrawalNote(saved.id, f.captureSession(), use)
    ).rejects.toThrow(error);
    expect(use).not.toHaveBeenCalled();
  }
);

it('rejects a withdrawal proof callback result after the original session changes', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const entered = deferred(),
    release = deferred();
  const result = f.controller.withWithdrawalNote(
    saved.id,
    f.captureSession(),
    async () => {
      entered.resolve();
      await release.promise;
      return 'proof';
    }
  );
  const rejection = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  f.replaceKeyring('another profile');
  release.resolve();
  await rejection;
  expect(Object.keys(f.records)).toHaveLength(1);
});

it.each(['direct', 'relayed'] as const)(
  'durably reserves %s withdrawal before returning and preserves unknown across restart',
  async (mode) => {
    const f = fixture();
    const saved = await f.controller.importNote(NOTE);
    const attempt = withdrawalAttempt(saved.id, mode);
    const session = f.captureSession();
    const entered = deferred(),
      release = deferred();
    const write = f.storage.setItem.getMockImplementation()!;
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      return write(key, value);
    });
    let completed = false;
    const reserve = f.controller
      .reserveWithdrawalAttempt(attempt, session)
      .then(() => {
        completed = true;
      });
    await entered.promise;
    expect(completed).toBe(false);
    release.resolve();
    await reserve;
    const restarted = f.create();
    expect(
      await restarted.getWithdrawalAttempt(saved.id, session)
    ).toMatchObject({
      intentId: INTENT_ID,
      mode,
      phase: 'unknown',
      proofHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      inputHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect((await restarted.getNotes()).notes[0].phase).toBe('waiting');
    await expect(
      restarted.withWithdrawalNote(saved.id, session, jest.fn())
    ).rejects.toThrow('privacy_withdrawal_attempt_exists');
    await expect(
      restarted.reserveWithdrawalAttempt(attempt, session)
    ).rejects.toThrow('privacy_withdrawal_attempt_exists');
    const disk = JSON.stringify(f.records);
    for (const secret of [
      NOTE,
      attempt.proof,
      attempt.nullifierHash,
      attempt.recipient,
      INTENT_ID,
    ])
      expect(disk).not.toContain(secret);
    f.setStatus({ phase: 'spent', blockNumber: 124 });
    expect((await restarted.getNotes()).notes[0].phase).toBe('spent');
  }
);

it('journals a relay job then its transaction hash idempotently and refuses mismatched acknowledgements', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(saved.id, 'relayed');
  const session = f.captureSession();
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { jobId: UUID },
    session
  );
  expect(
    await f.create().getWithdrawalAttempt(saved.id, session)
  ).toMatchObject({ phase: 'submitted', jobId: UUID });
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { transactionHash: TX_HASH },
    session
  );
  const count = f.storage.setItem.mock.calls.length;
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { jobId: UUID, transactionHash: TX_HASH },
    session
  );
  expect(f.storage.setItem).toHaveBeenCalledTimes(count);
  await expect(
    f.controller.recordWithdrawalSubmission(
      attempt,
      { jobId: INTENT_ID },
      session
    )
  ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
  await expect(
    f.controller.clearUnbroadcastWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
});

it('recovers a relay job from encrypted custody and records a verified hash with an exact journal guard', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(saved.id, 'relayed');
  const session = f.captureSession();
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { jobId: UUID },
    session
  );
  const restarted = f.create();
  const record = (await restarted.getWithdrawalAttempt(saved.id, session))!;
  expect(record).toMatchObject({
    noteId: saved.id,
    poolId: 'eth-1',
    endpoint: 'https://relay.example/base',
    ensHash: '0x' + '44'.repeat(32),
  });
  for (const [hash, jobId] of [
    ['0x' + '99'.repeat(32), UUID],
    [record.attemptHash, INTENT_ID],
  ]) {
    await expect(
      restarted.recordWithdrawalJobStatus(
        saved.id,
        hash,
        { jobId, transactionHash: TX_HASH },
        session
      )
    ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
  }
  await restarted.recordWithdrawalJobStatus(
    saved.id,
    record.attemptHash,
    { jobId: UUID, transactionHash: TX_HASH },
    session
  );
  const view = (await restarted.getNotes()).notes[0];
  expect(view.phase).toBe('waiting');
  expect(view.withdrawal).toEqual({
    mode: 'relayed',
    phase: 'submitted',
    jobId: UUID,
    transactionHash: TX_HASH,
  });
  expect(JSON.stringify(view)).not.toContain('relay.example');
  expect(JSON.stringify(view)).not.toContain(record.proofHash);
  await expect(
    restarted.recordWithdrawalJobStatus(
      saved.id,
      record.attemptHash,
      { jobId: UUID, transactionHash: '0x' + '99'.repeat(32) },
      session
    )
  ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
});

it('reserves a withdrawal only once under concurrent confirmations', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(saved.id, 'relayed');
  const session = f.captureSession();
  const results = await Promise.allSettled([
    f.controller.reserveWithdrawalAttempt(attempt, session),
    f
      .create()
      .reserveWithdrawalAttempt({ ...attempt, intentId: UUID }, session),
  ]);
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
    1
  );
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  expect(
    (
      results.find(
        ({ status }) => status === 'rejected'
      ) as PromiseRejectedResult
    ).reason.message
  ).toBe('privacy_withdrawal_attempt_exists');
  expect(
    (await f.controller.getWithdrawalAttempt(saved.id, session))?.intentId
  ).toBe(results[0].status === 'fulfilled' ? INTENT_ID : UUID);
});

it('retains a withdrawal reservation when storage applies it before reporting failure', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(saved.id);
  const session = f.captureSession();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records[key] = structuredClone(value);
    throw new Error('uncertain storage acknowledgement');
  });
  await expect(
    f.controller.reserveWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(
    (await f.create().getWithdrawalAttempt(saved.id, session))?.phase
  ).toBe('unknown');
  await expect(
    f.controller.reserveWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_withdrawal_attempt_exists');
});

it('clears only a matching proven-unbroadcast withdrawal reservation', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(saved.id);
  const session = f.captureSession();
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  await expect(
    f.controller.clearUnbroadcastWithdrawalAttempt(
      { ...attempt, intentId: UUID },
      session
    )
  ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
  await f.controller.clearUnbroadcastWithdrawalAttempt(attempt, session);
  expect(await f.controller.getWithdrawalAttempt(saved.id, session)).toBeNull();
  expect((await f.controller.getNotes()).notes[0].phase).toBe('verified');
});

it.each([
  'recipient',
  'fee',
  'root',
  'proof',
  'endpoint',
  'ensHash',
  'context',
] as const)(
  'binds %s to the original relayed withdrawal journal',
  async (field) => {
    const f = fixture();
    const saved = await f.controller.importNote(NOTE);
    const attempt = withdrawalAttempt(saved.id, 'relayed');
    const session = f.captureSession();
    await f.controller.reserveWithdrawalAttempt(attempt, session);
    const modified: any = { ...attempt };
    if (field === 'context')
      modified.context = {
        ...attempt.context,
        rpcUrl: 'https://other.example',
      };
    else
      modified[field] = {
        recipient: '0x' + '55'.repeat(20),
        fee: '54321',
        root: '0x' + '02'.repeat(32),
        proof: '0x' + 'cd'.repeat(256),
        endpoint: 'https://another.example',
        ensHash: '0x' + '66'.repeat(32),
      }[field];
    await expect(
      f.controller.recordWithdrawalSubmission(
        modified,
        { transactionHash: TX_HASH },
        session
      )
    ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
    expect(
      (await f.controller.getWithdrawalAttempt(saved.id, session))?.phase
    ).toBe('unknown');
  }
);

it('binds direct withdrawal calldata and fee fields and rejects a different nonce after reservation', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(saved.id, 'direct');
  if (attempt.mode !== 'direct') throw new Error();
  const session = f.captureSession();
  await expect(
    f.controller.reserveWithdrawalAttempt(
      { ...attempt, transaction: { ...attempt.transaction, data: '0x1234' } },
      session
    )
  ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  for (const field of [
    'nonce',
    'gasLimit',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
  ] as const) {
    await expect(
      f.controller.recordWithdrawalSubmission(
        {
          ...attempt,
          transaction: { ...attempt.transaction, [field]: '999999' },
        },
        { transactionHash: TX_HASH },
        session
      )
    ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
  }
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { transactionHash: TX_HASH },
    session
  );
  expect(
    await f.create().getWithdrawalAttempt(saved.id, session)
  ).toMatchObject({ phase: 'submitted', transactionHash: TX_HASH });
});

it('rejects competing deposit and withdrawal reservations sharing an account nonce', async () => {
  for (const first of ['deposit', 'withdrawal']) {
    const f = fixture(() => SECOND_NOTE);
    const imported = await f.controller.importNote(NOTE);
    const generated = await f.controller.createDepositNote('eth-1');
    const session = f.captureSession();
    const withdraw = withdrawalAttempt(imported.id);
    const deposit = depositAttempt(generated.id, 0, SECOND_NOTE);
    if (first === 'deposit') {
      f.setStatus({ phase: 'not-found' });
      await f.controller.reserveDepositAttempt(deposit, session);
      f.setStatus({ phase: 'verified' });
      await expect(
        f.controller.reserveWithdrawalAttempt(withdraw, session)
      ).rejects.toThrow('privacy_withdrawal_attempt_exists');
    } else {
      await f.controller.reserveWithdrawalAttempt(withdraw, session);
      f.setStatus({ phase: 'not-found' });
      await expect(
        f.controller.reserveDepositAttempt(deposit, session)
      ).rejects.toThrow('privacy_deposit_attempt_exists');
    }
  }
});

it('leaves withdrawal unknown when the original crypto session locks before acknowledgement', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const session = f.captureSession();
  const attempt = withdrawalAttempt(saved.id, 'relayed');
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  const before = JSON.stringify(f.records);
  f.lock();
  await expect(
    f.controller.recordWithdrawalSubmission(attempt, { jobId: UUID }, session)
  ).rejects.toThrow('privacy_vault_session_changed');
  expect(JSON.stringify(f.records)).toBe(before);
  f.unlock();
  expect(
    (await f.create().getWithdrawalAttempt(saved.id, f.captureSession()))?.phase
  ).toBe('unknown');
});

it('keeps the original withdrawal unknown if its profile changes during acknowledgement encryption', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const session = f.captureSession();
  const attempt = withdrawalAttempt(saved.id);
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  const before = JSON.stringify(f.records);
  const entered = deferred(),
    release = deferred();
  const keyring = f.getKeyring();
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementationOnce(async (input) => {
      const envelope = await encrypt(input);
      entered.resolve();
      await release.promise;
      return envelope;
    });
  const saving = f.controller.recordWithdrawalSubmission(
    attempt,
    { transactionHash: TX_HASH },
    session
  );
  const rejection = expect(saving).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  f.replaceKeyring('other root');
  release.resolve();
  await rejection;
  expect(JSON.stringify(f.records)).toBe(before);
  f.replaceKeyring(ROOT);
  expect(
    (await f.controller.getWithdrawalAttempt(saved.id, f.captureSession()))
      ?.phase
  ).toBe('unknown');
});

it.each([
  null,
  {},
  { mode: 'direct' },
  { intentId: UUID, phase: 'submitted', jobId: '../not-a-job' },
])('rejects malformed encrypted withdrawal journals %#', async (withdrawal) => {
  const f = fixture();
  const envelope = await f.getKeyring().encryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: UUID,
    plaintext: new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        notes: [{ id: UUID, note: NOTE, createdAt: 456, withdrawal }],
      })
    ),
  });
  f.records[PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId] = envelope;
  await expect(f.controller.getNotes()).rejects.toThrow(
    'privacy_vault_corrupt'
  );
});

it('rechecks withdrawal status after encryption and refuses tampered encrypted custody', async () => {
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const session = f.captureSession();
  const attempt = withdrawalAttempt(saved.id);
  const keyring = f.getKeyring();
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementationOnce(async (input) => {
      const result = await encrypt(input);
      f.setStatus({ phase: 'spent' });
      return result;
    });
  await expect(
    f.controller.reserveWithdrawalAttempt(attempt, session)
  ).rejects.toThrow('privacy_note_spent');
  expect(await f.controller.getWithdrawalAttempt(saved.id, session)).toBeNull();
  f.setStatus({ phase: 'verified' });
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  const key = Object.keys(f.records)[0];
  f.records[key].ciphertext = f.records[key].ciphertext.slice(0, -4) + 'AAAA';
  await expect(
    f.create().getWithdrawalAttempt(saved.id, session)
  ).rejects.toThrow('privacy_vault_unavailable');
});

it('rejects generated-note completion after a wallet session change during encryption', async () => {
  const f = fixture(() => NOTE);
  const entered = deferred();
  const release = deferred();
  const keyring = f.getKeyring();
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementation(async (input) => {
      const result = await encrypt(input);
      entered.resolve();
      await release.promise;
      return result;
    });
  const operation = f.controller.createDepositNote('eth-1');
  const failure = expect(operation).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  f.replaceKeyring();
  release.resolve();
  await failure;
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

it('persists only an encrypted manifest and returns strict display metadata', async () => {
  const f = fixture();
  const item = await f.controller.importNote(NOTE);
  expect(item).toEqual({
    id: expect.any(String),
    poolId: 'eth-1',
    amount: '1',
    createdAt: 456,
    phase: 'verified',
    blockNumber: 123,
  });
  expect(item.id).toHaveLength(36);
  expect(Object.keys(f.records)).toEqual([
    PRIVATE_VAULT_STORAGE_PREFIX +
      (await f.getKeyring().getPrivateRecordProfileId()),
  ]);
  const saved = JSON.stringify(f.records);
  const identity = identifyClassicNote(NOTE);
  for (const secret of [
    ROOT,
    NOTE,
    item.id,
    identity.commitment,
    identity.nullifierHash,
    'eth-1',
  ])
    expect(saved).not.toContain(secret);
  const envelope = Object.values(f.records)[0];
  expect(Object.keys(envelope).sort()).toEqual([
    'ciphertext',
    'domain',
    'nonce',
    'profileId',
    'recordId',
    'version',
  ]);
  expect(envelope.domain).toBe(PRIVATE_VAULT_DOMAIN);
  expect(await f.controller.getNotes()).toEqual({ notes: [item] });
  expect(f.authenticate).not.toHaveBeenCalled();
});

it('serializes concurrent duplicate imports and survives a controller restart', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.controller.importNote(NOTE),
    f.controller.importNote(` \n${NOTE}\n`),
  ]);
  expect(first).toEqual(second);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  expect((await f.create().getNotes()).notes).toEqual([first]);
  expect(await f.create().revealNote(first.id, 'correct-password')).toBe(NOTE);
});

it('refreshes spent state from the local reader without changing encrypted custody', async () => {
  const f = fixture();
  const first = await f.controller.importNote(NOTE);
  f.setStatus({ phase: 'spent', blockNumber: 987 });
  expect(await f.controller.getNotes()).toEqual({
    notes: [{ ...first, phase: 'spent', blockNumber: 987 }],
  });
  expect(await f.controller.importNote(NOTE)).toEqual({
    ...first,
    phase: 'spent',
    blockNumber: 987,
  });
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

it.each([
  ['waiting', 'privacy_verification_pending'],
  ['not-found', 'privacy_note_not_found'],
] as const)('does not persist a %s note', async (phase, error) => {
  const f = fixture();
  f.setStatus({ phase });
  await expect(f.controller.importNote(NOTE)).rejects.toThrow(error);
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

it('admits locally verified spent notes as history', async () => {
  const f = fixture();
  f.setStatus({ phase: 'spent' });
  expect((await f.controller.importNote(NOTE)).phase).toBe('spent');
});

it('isolates root profiles, and permits a replacement keyring with the same root', async () => {
  const f = fixture();
  const first = await f.controller.importNote(NOTE);
  f.replaceKeyring();
  expect((await f.controller.getNotes()).notes).toEqual([first]);
  f.replaceKeyring('different synthetic root');
  expect((await f.controller.getNotes()).notes).toEqual([]);
  await f.controller.importNote(SECOND_NOTE);
  expect(Object.keys(f.records)).toHaveLength(2);
  f.replaceKeyring();
  expect((await f.controller.getNotes()).notes).toEqual([first]);
});

it('rejects an envelope copied to the wrong profile without overwriting it', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  const original = Object.values(f.records)[0];
  f.replaceKeyring('different synthetic root');
  const key =
    PRIVATE_VAULT_STORAGE_PREFIX +
    (await f.getKeyring().getPrivateRecordProfileId());
  f.records[key] = structuredClone(original);
  await expect(f.controller.getNotes()).rejects.toThrow(
    'privacy_vault_corrupt'
  );
  expect(f.records[key]).toEqual(original);
});

it('returns raw notes only after successful reauthentication', async () => {
  const f = fixture();
  const item = await f.controller.importNote(NOTE);
  await expect(
    f.controller.revealNote(item.id, 'wrong-password')
  ).rejects.toThrow('Invalid password');
  expect(await f.controller.revealNote(item.id, 'correct-password')).toBe(NOTE);
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  await expect(
    f.controller.revealNote(UUID, 'correct-password')
  ).rejects.toThrow('privacy_note_missing');
});

it('does not release a reveal after the authentication callback loses its session', async () => {
  const f = fixture();
  const item = await f.controller.importNote(NOTE);
  f.authenticate.mockImplementationOnce(async (_password, _session, reveal) => {
    const note = await reveal();
    f.lock();
    return note;
  });
  await expect(
    f.controller.revealNote(item.id, 'correct-password')
  ).rejects.toThrow('privacy_vault_session_changed');
});

it('keeps ciphertext and returns only a static error on decryption failure', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  const key = Object.keys(f.records)[0];
  f.records[key].ciphertext = f.records[key].ciphertext.slice(0, -4) + 'AAAA';
  const damaged = structuredClone(f.records[key]);
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
  expect(f.records[key]).toEqual(damaged);
});

it('suppresses malformed plaintext from JSON parser errors', async () => {
  const f = fixture();
  const keyring = f.getKeyring();
  const envelope = await keyring.encryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: UUID,
    plaintext: new TextEncoder().encode(`{"${NOTE}`),
  });
  f.records[PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId] = envelope;
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_corrupt$/
  );
});

it('does not acknowledge a failed save and permits a safe retry', async () => {
  const f = fixture();
  f.storage.setItem.mockRejectedValueOnce(new Error(NOTE));
  await expect(f.controller.importNote(NOTE)).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
  expect(Object.keys(f.records)).toHaveLength(0);
  expect((await f.controller.importNote(NOTE)).phase).toBe('verified');
});

it('deduplicates a retry when storage applied a write before reporting failure', async () => {
  const f = fixture();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records[key] = structuredClone(value);
    throw new Error('unknown write outcome');
  });
  await expect(f.controller.importNote(NOTE)).rejects.toThrow(
    'privacy_vault_unavailable'
  );
  const recovered = await f.controller.importNote(NOTE);
  expect((await f.controller.getNotes()).notes).toEqual([recovered]);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

it.each(['lock', 'replace'] as const)(
  'rejects a %s during a durable save',
  async (change) => {
    const f = fixture();
    const entered = deferred();
    const release = deferred();
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      f.records[key] = structuredClone(value);
    });
    const result = f.controller.importNote(NOTE);
    const failure = expect(result).rejects.toThrow(
      'privacy_vault_session_changed'
    );
    await entered.promise;
    if (change === 'lock') f.lock();
    else f.replaceKeyring();
    release.resolve();
    await failure;
    expect(JSON.stringify(f.records)).not.toContain(NOTE);
  }
);

it('lets a serialized reset remove an in-flight save without resurrection', async () => {
  const f = fixture();
  const entered = deferred();
  const release = deferred();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    entered.resolve();
    await release.promise;
    f.records[key] = structuredClone(value);
  });
  const result = f.controller.importNote(NOTE);
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  f.lock();
  const reset = f.mutex.runExclusive(async () => {
    for (const key of Object.keys(f.records))
      if (key.startsWith('state-')) delete f.records[key];
  });
  release.resolve();
  await failure;
  await reset;
  expect(f.records).toEqual({});
});

it('clears decrypted byte buffers even when the post-decryption session check rejects', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  const keyring = f.getKeyring();
  const decrypt = keyring.decryptPrivateRecord.bind(keyring);
  let bytes!: Uint8Array;
  jest
    .spyOn(keyring, 'decryptPrivateRecord')
    .mockImplementationOnce(async (params) => {
      bytes = await decrypt(params);
      f.lock();
      return bytes;
    });
  await expect(f.controller.getNotes()).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(bytes.every((byte) => byte === 0)).toBe(true);
});

it('does not query custody for invalid notes or use network globals', async () => {
  const f = fixture();
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('network prohibited'));
  try {
    await expect(f.controller.importNote('invalid')).rejects.toThrow(
      'privacy_note_invalid'
    );
    expect(f.storage.getItem).not.toHaveBeenCalled();
    await f.controller.importNote(NOTE);
    await f.controller.getNotes();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

it.each([
  ['clear', 'waiting', 'privacy_verification_pending'],
  ['expired verification', 'waiting', 'privacy_verification_pending'],
  ['changed verified snapshot', 'not-found', 'privacy_note_not_found'],
] as const)(
  'rechecks admission after encryption during %s',
  async (_change, phase, error) => {
    const f = fixture();
    const entered = deferred();
    const release = deferred();
    const keyring = f.getKeyring();
    const encrypt = keyring.encryptPrivateRecord.bind(keyring);
    jest
      .spyOn(keyring, 'encryptPrivateRecord')
      .mockImplementationOnce(async (params) => {
        const envelope = await encrypt(params);
        entered.resolve();
        await release.promise;
        return envelope;
      });
    const result = f.controller.importNote(NOTE);
    const failure = expect(result).rejects.toThrow(error);
    await entered.promise;
    f.setStatus({ phase });
    release.resolve();
    await failure;
    expect(f.storage.setItem).not.toHaveBeenCalled();
  }
);

it('uses a spent result published while encryption was running', async () => {
  const f = fixture();
  const keyring = f.getKeyring();
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementationOnce(async (params) => {
      const envelope = await encrypt(params);
      f.setStatus({ phase: 'spent', blockNumber: 234 });
      return envelope;
    });
  expect(await f.controller.importNote(NOTE)).toMatchObject({
    phase: 'spent',
    blockNumber: 234,
  });
});

it.each(['waiting', 'spent'] as const)(
  'preserves a saved note and reports %s when the public view changes during storage',
  async (phase) => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      f.records[key] = structuredClone(value);
      f.setStatus({ phase });
    });
    const item = await f.controller.importNote(NOTE);
    expect(item.phase).toBe(phase);
    expect(await f.controller.revealNote(item.id, 'correct-password')).toBe(
      NOTE
    );
  }
);

it('rejects a failed storage read without exposing its error text', async () => {
  const f = fixture();
  f.storage.getItem.mockRejectedValueOnce(new Error(NOTE));
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
});

it.each([
  { notes: [], version: 2 },
  {
    notes: Array(129).fill({ id: UUID, note: NOTE, createdAt: 123 }),
    version: 1,
  },
  { notes: [{ id: UUID, note: NOTE, createdAt: -1 }], version: 1 },
  {
    notes: [
      { id: UUID, note: NOTE, createdAt: 123 },
      { id: UUID, note: SECOND_NOTE, createdAt: 123 },
    ],
    version: 1,
  },
])('rejects invalid encrypted manifest schema %#', async (manifest) => {
  const f = fixture();
  const keyring = f.getKeyring();
  const envelope = await keyring.encryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: UUID,
    plaintext: new TextEncoder().encode(JSON.stringify(manifest)),
  });
  f.records[PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId] = envelope;
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_corrupt$/
  );
});
