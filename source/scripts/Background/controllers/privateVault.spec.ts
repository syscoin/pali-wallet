import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import { Interface, keccak256, parseEther, toUtf8Bytes } from 'ethers';

import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { identifyClassicNote } from 'utils/privacy/note';
import type { IPrivateNoteStatus } from 'utils/privacy/privateVaultTypes';
import { getPrivacyPool } from 'utils/privacy/registry';
import type { IPrivacyDepositAttempt } from 'utils/privacy/transactionTypes';
import { prepareWithdrawalRecovery as prepareWithdrawalRecoveryProof } from 'utils/privacy/withdrawalRecovery';
import type {
  IPrivacyWithdrawalAttempt,
  IPrivacyWithdrawalJournal,
} from 'utils/privacy/withdrawalTransactionTypes';

import { createPrivacyTransactionsController } from './privacyTransactions';
import {
  createPrivateVaultController,
  IPrivateVaultSession,
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_FORMAT,
  PRIVATE_VAULT_STORAGE_PREFIX,
} from './privateVault';

jest.unmock('syscoinjs-lib');
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

async function failedWithdrawalFixture(mode: 'direct' | 'relayed' = 'direct') {
  const f = fixture();
  const note = await f.controller.importNote(NOTE);
  const session = f.captureSession();
  const attempt = withdrawalAttempt(note.id, mode);
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { transactionHash: TX_HASH },
    session
  );
  return { f, note, session, attempt };
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
  const revalidateCompletion = jest.fn(async () => undefined);
  const prepareCompletionProof = jest.fn(
    async (): Promise<{ revalidate: () => Promise<void> }> => ({
      revalidate: revalidateCompletion,
    })
  );
  const revalidateRecovery = jest.fn(async () => undefined);
  const prepareWithdrawalRecovery = jest.fn<
    Promise<{
      receipt: { blockHash: string; blockNumber: string; root: string };
      revalidate: () => Promise<void>;
    }>,
    [
      ReturnType<typeof identifyClassicNote>,
      IPrivacyWithdrawalJournal,
      IPrivateVaultSession
    ]
  >(
    async (): Promise<{
      receipt: { blockHash: string; blockNumber: string; root: string };
      revalidate: () => Promise<void>;
    }> => ({
      receipt: {
        root: '0x' + '01'.repeat(32),
        blockNumber: '123',
        blockHash: '0x' + 'cd'.repeat(32),
      },
      revalidate: revalidateRecovery,
    })
  );
  const create = () =>
    createPrivateVaultController(
      {
        captureSession,
        authenticate,
        readNote,
        prepareCompletionProof,
        prepareWithdrawalRecovery,
      },
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
    prepareCompletionProof,
    revalidateCompletion,
    prepareWithdrawalRecovery,
    revalidateRecovery,
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
async function storeCanonicalManifest(
  f: ReturnType<typeof fixture>,
  manifest: { notes: any[]; version: number },
  capacity = 128,
  rawShard?: string,
  shardSize = 16
) {
  const shards = [];
  const references = [];
  const groups = [];
  for (let i = 0; i < manifest.notes.length; i += shardSize)
    groups.push(manifest.notes.slice(i, i + shardSize));
  if (!groups.length) groups.push([]);
  for (const [index, notes] of groups.entries()) {
    const plaintext = new TextEncoder().encode(
      rawShard ?? JSON.stringify({ version: manifest.version, notes })
    );
    try {
      const shard = await f.getKeyring().encryptPrivateRecord({
        domain: 'org.syscoin.pali.privacy.notes.shard.v2',
        recordId: `00000000-0000-4000-8000-${(200000 + index)
          .toString(16)
          .padStart(12, '0')}`,
        plaintext,
      });
      shards.push(shard);
      references.push({
        recordId: shard.recordId,
        count: notes.length,
        hash: keccak256(
          toUtf8Bytes(
            JSON.stringify([
              shard.version,
              shard.domain,
              shard.recordId,
              shard.profileId,
              shard.nonce,
              shard.ciphertext,
            ])
          )
        ),
      });
    } finally {
      plaintext.fill(0);
    }
  }
  const rootPlaintext = new TextEncoder().encode(
    JSON.stringify({
      format: PRIVATE_VAULT_FORMAT,
      version: 1,
      capacity,
      noteCount: manifest.notes.length,
      shards: references,
    })
  );
  try {
    const envelope = await f.getKeyring().encryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: UUID,
      plaintext: rootPlaintext,
    });
    const key = PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId;
    f.records[key] = {
      format: PRIVATE_VAULT_FORMAT,
      version: 1,
      root: envelope,
      shards,
    };
    return key;
  } finally {
    rootPlaintext.fill(0);
  }
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
  const key = await storeCanonicalManifest(f, { version: 1, notes });
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
    expect(f.records[key].version).toBe(1);
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
  expect(ready.f.records[ready.key].version).toBe(1);
  return { ...ready, session };
}

it('preserves canonical encrypted shard roots made with UTF-8 encoding', async () => {
  const { f, key, notes } = await chunkedFixture();
  const bundle = f.records[key];
  const plaintext = await f.getKeyring().decryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: bundle.root.recordId,
    envelope: bundle.root,
  });
  try {
    const root = JSON.parse(new TextDecoder().decode(plaintext));
    const references = bundle.shards.map(
      (shard: typeof bundle.root, index: number) => ({
        recordId: shard.recordId,
        hash: keccak256(
          toUtf8Bytes(
            JSON.stringify([
              shard.version,
              shard.domain,
              shard.recordId,
              shard.profileId,
              shard.nonce,
              shard.ciphertext,
            ])
          )
        ),
        count: root.shards[index].count,
      })
    );
    expect(root.shards).toEqual(references);
    const rewrittenPlaintext = new TextEncoder().encode(
      JSON.stringify({ ...root, shards: references })
    );
    try {
      f.records[key] = {
        ...bundle,
        root: await f.getKeyring().encryptPrivateRecord({
          domain: PRIVATE_VAULT_DOMAIN,
          recordId: bundle.root.recordId,
          plaintext: rewrittenPlaintext,
        }),
      };
    } finally {
      rewrittenPlaintext.fill(0);
    }
  } finally {
    plaintext.fill(0);
  }
  const restored = f.create();
  expect((await restored.getNotes()).notes).toHaveLength(notes.length);
  expect(await restored.revealNote(notes[0].id, 'correct-password')).toBe(
    notes[0].note
  );
  expect(await restored.revealNote(notes[31].id, 'correct-password')).toBe(
    notes[31].note
  );
});

it('changes capacity only on an explicit choice without changing format and survives restart', async () => {
  const { f, key } = await capacityFixture();
  const before = structuredClone(f.records[key]);
  expect(await f.controller.getCapacity()).toEqual({
    capacity: 128,
    noteCount: 128,
    bundleLimitBytes: 4 * 1024 * 1024,
    storedBytes: new TextEncoder().encode(JSON.stringify(before)).length,
  });
  await f.controller.setCapacity(128);
  expect(f.records[key]).toEqual(before);
  expect(await f.controller.setCapacity(256)).toMatchObject({
    capacity: 256,
    noteCount: 128,
    bundleLimitBytes: 8 * 1024 * 1024,
  });
  expect(f.records[key].version).toBe(1);
  const restarted = f.create();
  expect(await restarted.getCapacity()).toMatchObject({
    capacity: 256,
    noteCount: 128,
    bundleLimitBytes: 8 * 1024 * 1024,
  });
  const extra = `tornado-eth-1-1-0x${(99999).toString(16).padStart(124, '0')}`;
  await restarted.importNote(extra);
  const saved = structuredClone(f.records[key]);
  await expect(restarted.setCapacity(128)).rejects.toThrow(
    'privacy_note_limit'
  );
  expect(f.records[key]).toEqual(saved);
  expect((await f.create().getNotes()).notes).toHaveLength(129);
  expect(await restarted.setCapacity(512)).toMatchObject({
    capacity: 512,
    noteCount: 129,
    bundleLimitBytes: 16 * 1024 * 1024,
  });
});

it('rejects unsupported capacity values without mutating saved records', async () => {
  const f = fixture();
  await expect(f.controller.setCapacity(1024 as any)).rejects.toThrow(
    'privacy_vault_unavailable'
  );
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(await f.controller.getCapacity()).toEqual({
    capacity: 128,
    noteCount: 0,
    bundleLimitBytes: 4 * 1024 * 1024,
    storedBytes: 0,
  });
});

it('bounds sharding for escaped long endpoints and both journal types', async () => {
  const notes = capacityNotes(8).map((note, index) => ({
    ...note,
    createdAt: 8_640_000_000_000_000,
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
  expect(f.records[key].version).toBe(1);
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
  expect(f.records[key].version).toBe(1);
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
      beforeSubmission: async (attempt) => {
        let fence!: () => void;
        await f.controller.reserveDepositAttempt(
          attempt,
          session,
          (assertion) => {
            fence = assertion;
          }
        );
        return fence;
      },
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
  envelope.root.ciphertext = envelope.root.ciphertext.slice(0, -4) + 'AAAA';
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
  await storeCanonicalManifest(f, {
    version: 1,
    notes: [{ id: UUID, note: NOTE, createdAt: 456, withdrawal }],
  });
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
  f.records[key].root.ciphertext =
    f.records[key].root.ciphertext.slice(0, -4) + 'AAAA';
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
  const bundle = Object.values(f.records)[0];
  expect(Object.keys(bundle).sort()).toEqual([
    'format',
    'root',
    'shards',
    'version',
  ]);
  expect(bundle).toMatchObject({ format: PRIVATE_VAULT_FORMAT, version: 1 });
  for (const envelope of [bundle.root, ...bundle.shards])
    expect(Object.keys(envelope).sort()).toEqual([
      'ciphertext',
      'domain',
      'nonce',
      'profileId',
      'recordId',
      'version',
    ]);
  expect(bundle.root.domain).toBe(PRIVATE_VAULT_DOMAIN);
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
  f.records[key].root.ciphertext =
    f.records[key].root.ciphertext.slice(0, -4) + 'AAAA';
  const damaged = structuredClone(f.records[key]);
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
  expect(f.records[key]).toEqual(damaged);
});

it('suppresses malformed plaintext from JSON parser errors', async () => {
  const f = fixture();
  await storeCanonicalManifest(f, { version: 1, notes: [] }, 128, `{"${NOTE}`);
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
  await storeCanonicalManifest(f, manifest);
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_corrupt$/
  );
});

it.each([
  'switch during committed write',
  'healthy pre-sign cancellation',
] as const)('reservation review: %s', async (scenario) => {
  const { createPrivacyWithdrawalsController } = await import(
    './privacyWithdrawals'
  );
  const f = fixture();
  const saved = await f.controller.importNote(NOTE);
  const originalSession = f.captureSession();
  const captured = {
    context: depositAttempt(saved.id).context,
    assertCurrent: originalSession.assertCurrent,
  };
  const identity = identifyClassicNote(NOTE);
  const root = '0x' + '01'.repeat(32);
  const proof = '0x' + 'ab'.repeat(256);
  let forceCancel = false;
  const send = jest.fn();
  const clear = jest.fn(async (attempt) =>
    f.controller.clearUnbroadcastWithdrawalAttempt(attempt, originalSession)
  );
  const snapshot: any = { root };
  const host: any = {
    captureSession: () => captured,
    withNote: (id, _session, use) =>
      f.controller.withWithdrawalNote(id, originalSession, use),
    getSnapshot: async () => ({
      snapshot,
      getPath: async () => ({}),
      assertSnapshotCurrent: () => {
        if (forceCancel) throw new Error('privacy_verification_pending');
      },
    }),
    quoteDirectFees: async () => ({
      gasLimit: '650000',
      nonce: '7',
      maxFeePerGas: '100',
      maxPriorityFeePerGas: '1',
    }),
    prove: async (request) => ({
      proof,
      publicSignals: [
        root,
        identity.nullifierHash,
        request.recipient,
        request.relayer,
        request.fee,
        request.refund,
      ].map((x) => BigInt(x).toString()),
    }),
    beforeSubmission: async (attempt) => {
      captured.assertCurrent();
      await f.controller.reserveWithdrawalAttempt(attempt, originalSession);
      captured.assertCurrent();
      if (scenario === 'healthy pre-sign cancellation') forceCancel = true;
      return () => undefined;
    },
    recordNotBroadcast: clear,
    recordSubmission: jest.fn(),
    sendTransaction: send,
    relayers: {},
  };
  const controller = createPrivacyWithdrawalsController(host, {
    now: () => 456,
    randomId: () => INTENT_ID,
  });
  const review = await controller.prepareWithdrawal({
    noteId: saved.id,
    recipient: '0x' + '22'.repeat(20),
    mode: 'direct',
  });
  const committed = deferred(),
    release = deferred();
  if (scenario === 'switch during committed write') {
    const write = f.storage.setItem.getMockImplementation()!;
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      await write(key, value);
      committed.resolve();
      await release.promise;
    });
  }
  const result = controller.submitWithdrawal(review.intentId);
  const rejected = expect(result).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  if (scenario === 'switch during committed write') {
    await committed.promise;
    f.replaceKeyring();
    release.resolve();
  }
  await rejected;
  expect(send).not.toHaveBeenCalled();
  const newSession = f.captureSession();
  const persisted = await f.create().getWithdrawalAttempt(saved.id, newSession);
  if (scenario === 'switch during committed write') {
    expect(clear).not.toHaveBeenCalled();
    expect(persisted).toMatchObject({ phase: 'unknown' });
    expect((await f.create().getNotes()).notes[0].phase).toBe('waiting');
    await expect(
      f.create().withWithdrawalNote(saved.id, newSession, jest.fn())
    ).rejects.toThrow('privacy_withdrawal_attempt_exists');
  } else {
    expect(clear).toHaveBeenCalledTimes(1);
    expect(persisted).toBeNull();
    expect((await f.create().getNotes()).notes[0].phase).toBe('verified');
  }
  controller.close();
});

it('preserves the prior vault if a capacity change write fails', async () => {
  const { f, key } = await capacityFixture(capacityNotes(2));
  const before = structuredClone(f.records[key]);
  f.storage.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(f.controller.setCapacity(256)).rejects.toThrow(
    'privacy_vault_unavailable'
  );
  expect(f.records[key]).toEqual(before);
  expect(await f.create().getCapacity()).toMatchObject({
    capacity: 128,
    noteCount: 2,
  });
});

async function completedClearFixture() {
  const f = fixture();
  const completed = await f.controller.importNote(NOTE);
  const unrelated = await f.controller.importNote(SECOND_NOTE);
  const session = f.captureSession();
  const attempt = withdrawalAttempt(completed.id, 'relayed');
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { transactionHash: TX_HASH },
    session
  );
  return { f, completed, unrelated, session, attempt };
}

it('clear completed removes only the proven unchanged note and preserves unresolved records', async () => {
  const { f, completed, unrelated } = await completedClearFixture();
  const result = await f.controller.clearCompletedNotes([completed.id]);
  expect(result).toEqual({ removed: [completed.id], unresolved: [] });
  expect(await f.controller.clearCompletedNotes([unrelated.id])).toEqual({
    removed: [],
    unresolved: [unrelated.id],
  });
  expect((await f.controller.getNotes()).notes.map((note) => note.id)).toEqual([
    unrelated.id,
  ]);
  expect(f.prepareCompletionProof).toHaveBeenCalledTimes(1);
  expect(f.revalidateCompletion).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.prepareCompletionProof.mock.calls)).not.toContain(
    NOTE
  );
  expect((await f.create().getNotes()).notes.map((note) => note.id)).toEqual([
    unrelated.id,
  ]);
});

it.each(['initial', 'revalidation'])(
  'clear completed retains the encrypted note after %s proof failure',
  async (kind) => {
    const { f, completed } = await completedClearFixture();
    const count = f.storage.setItem.mock.calls.length;
    if (kind === 'initial')
      f.prepareCompletionProof.mockRejectedValueOnce(new Error('offline'));
    else f.revalidateCompletion.mockRejectedValueOnce(new Error('reorg'));
    expect(await f.controller.clearCompletedNotes([completed.id])).toEqual({
      removed: [],
      unresolved: [completed.id],
    });
    expect(f.storage.setItem).toHaveBeenCalledTimes(count);
    expect(
      (await f.controller.getNotes()).notes.some(
        (note) => note.id === completed.id
      )
    ).toBe(true);
  }
);

it('clear completed leaves unknown or no-hash journals untouched', async () => {
  const f = fixture();
  const note = await f.controller.importNote(NOTE);
  const session = f.captureSession();
  const attempt = withdrawalAttempt(note.id, 'relayed');
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  expect(await f.controller.clearCompletedNotes([note.id])).toEqual({
    removed: [],
    unresolved: [note.id],
  });
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { jobId: UUID },
    session
  );
  expect(await f.controller.clearCompletedNotes([note.id])).toEqual({
    removed: [],
    unresolved: [note.id],
  });
  expect(f.prepareCompletionProof).not.toHaveBeenCalled();
});

function holdCompletionProof(f: ReturnType<typeof fixture>) {
  const entered = deferred();
  const release = deferred();
  f.prepareCompletionProof.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { revalidate: async () => undefined };
  });
  return { entered: entered.promise, release: release.resolve };
}

it('clear completed fails closed when the session changes while proof is pending', async () => {
  const { f, completed } = await completedClearFixture();
  const proof = holdCompletionProof(f);
  const action = f.controller.clearCompletedNotes([completed.id]);
  await proof.entered;
  f.lock();
  proof.release();
  await expect(action).rejects.toThrow('privacy_vault_session_changed');
  f.unlock();
  expect(
    (await f.controller.getNotes()).notes.some(
      (note) => note.id === completed.id
    )
  ).toBe(true);
});

it('clear completed refuses a journal changed while proof is pending', async () => {
  const { f, completed, session, attempt } = await completedClearFixture();
  const proof = holdCompletionProof(f);
  const action = f.controller.clearCompletedNotes([completed.id]);
  await proof.entered;
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { jobId: UUID },
    session
  );
  proof.release();
  expect(await action).toEqual({ removed: [], unresolved: [completed.id] });
  expect(
    (await f.controller.getNotes()).notes.some(
      (note) => note.id === completed.id
    )
  ).toBe(true);
});

it('clear completed rejects duplicate, malformed and oversized requests', async () => {
  const f = fixture();
  await expect(
    f.controller.clearCompletedNotes([UUID, UUID])
  ).rejects.toThrow();
  await expect(
    f.controller.clearCompletedNotes([UUID, INTENT_ID])
  ).rejects.toThrow();
  await expect(
    f.controller.clearCompletedNotes(['not-a-uuid'])
  ).rejects.toThrow();
  await expect(
    f.controller.clearCompletedNotes(
      Array.from(
        { length: 17 },
        (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
      )
    )
  ).rejects.toThrow();
  expect(f.prepareCompletionProof).not.toHaveBeenCalled();
});

it('clear completed fails closed when session changes during final proof revalidation', async () => {
  const { f, completed } = await completedClearFixture();
  const count = f.storage.setItem.mock.calls.length;
  f.revalidateCompletion.mockImplementationOnce(async () => {
    f.lock();
  });
  await expect(
    f.controller.clearCompletedNotes([completed.id])
  ).rejects.toThrow('privacy_vault_session_changed');
  expect(f.storage.setItem).toHaveBeenCalledTimes(count);
  f.unlock();
  expect(
    (await f.controller.getNotes()).notes.some(
      (note) => note.id === completed.id
    )
  ).toBe(true);
});

it('clear completed reports a storage failure and preserves unrelated notes', async () => {
  const { f, completed, unrelated } = await completedClearFixture();
  f.storage.setItem.mockRejectedValueOnce(new Error('private backend error'));
  await expect(
    f.controller.clearCompletedNotes([completed.id])
  ).rejects.toThrow('privacy_vault_unavailable');
  expect((await f.controller.getNotes()).notes.map((note) => note.id)).toEqual([
    completed.id,
    unrelated.id,
  ]);
});

it('clear completed requires caller refresh after an ambiguous committed write', async () => {
  const { f, completed, unrelated } = await completedClearFixture();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records[key] = structuredClone(value);
    throw new Error('acknowledgement lost');
  });
  await expect(
    f.controller.clearCompletedNotes([completed.id])
  ).rejects.toThrow('privacy_vault_unavailable');
  expect((await f.create().getNotes()).notes.map((note) => note.id)).toEqual([
    unrelated.id,
  ]);
});

it('clear completed preserves a note with an unknown deposit journal even after a withdrawal is submitted', async () => {
  const f = fixture(() => NOTE);
  f.setStatus({ phase: 'not-found' });
  const note = await f.controller.createDepositNote('eth-1');
  const session = f.captureSession();
  await f.controller.reserveDepositAttempt(depositAttempt(note.id), session);
  f.setStatus({ phase: 'verified' });
  const withdrawal = withdrawalAttempt(note.id, 'relayed');
  await f.controller.reserveWithdrawalAttempt(withdrawal, session);
  await f.controller.recordWithdrawalSubmission(
    withdrawal,
    { transactionHash: TX_HASH },
    session
  );
  expect(await f.controller.clearCompletedNotes([note.id])).toEqual({
    removed: [],
    unresolved: [note.id],
  });
  expect(f.prepareCompletionProof).not.toHaveBeenCalled();
  expect((await f.controller.getNotes()).notes).toHaveLength(1);
});

it('clear completed refuses to write if proof revalidation exhausts its deadline', async () => {
  const { f, completed } = await completedClearFixture();
  const count = f.storage.setItem.mock.calls.length;
  let clock = 1_000;
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    f.revalidateCompletion.mockImplementationOnce(async () => {
      clock += 60_000;
    });
    expect(await f.controller.clearCompletedNotes([completed.id])).toEqual({
      removed: [],
      unresolved: [completed.id],
    });
    expect(f.storage.setItem).toHaveBeenCalledTimes(count);
    expect(
      (await f.controller.getNotes()).notes.some(
        (note) => note.id === completed.id
      )
    ).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

it('clears a verified note without losing canonical capacity or unrelated custody', async () => {
  const { f, completed, unrelated } = await completedClearFixture();
  await f.controller.setCapacity(256);
  expect(await f.controller.clearCompletedNotes([completed.id])).toEqual({
    removed: [completed.id],
    unresolved: [],
  });
  expect(await f.create().getCapacity()).toMatchObject({
    capacity: 256,
    noteCount: 1,
  });
  expect((await f.create().getNotes()).notes.map((entry) => entry.id)).toEqual([
    unrelated.id,
  ]);
});

it.each([256, 512] as const)(
  'preserves and rewrites a worst-case encrypted %i-note canonical vault',
  async (capacity) => {
    const max = 8_640_000_000_000_000;
    const hash = '0x' + 'ab'.repeat(32);
    const endpoint = 'https://a' + '\u0000'.repeat(2039);
    expect(endpoint).toHaveLength(2048);
    expect(new URL(endpoint).protocol).toBe('https:');
    const notes = capacityNotes(capacity).map((entry) => ({
      ...entry,
      note: entry.note.replace('tornado-eth-1-1-', 'tornado-eth-100-1-'),
      createdAt: max,
      origin: 'generated' as const,
      deposit: {
        intentId: entry.id,
        attemptHash: hash,
        createdAt: max,
        from: '0x' + '11'.repeat(20),
        nonce: '18446744073709551615',
        phase: 'submitted' as const,
        transactionHash: hash,
      },
      withdrawal: {
        intentId: entry.id,
        attemptHash: hash,
        proofHash: hash,
        inputHash: hash,
        createdAt: max,
        mode: 'relayed' as const,
        phase: 'submitted' as const,
        endpoint,
        ensHash: hash,
        transactionHash: hash,
        jobId: 'j'.repeat(128),
      },
    }));
    // The first measured read repeats identity work exactly as production does.
    // Cache only later reads so the persistence assertions stay bounded.
    let cacheIdentities = false;
    const identities = new Map<
      string,
      ReturnType<typeof identifyClassicNote>
    >();
    const identify = (note: string) => {
      let identity = identities.get(note);
      if (!cacheIdentities || !identity) {
        identity = identifyClassicNote(note);
        identities.set(note, identity);
      }
      return identity;
    };
    const f = fixture(undefined, identify);
    const keyring = f.getKeyring();
    const profileId = await keyring.getPrivateRecordProfileId();
    const shardDomain = 'org.syscoin.pali.privacy.notes.shard.v2';
    const shards = [];
    const references = [];
    let maximumShardBytes = 0;
    for (let i = 0; i < notes.length; i += 2) {
      const recordId = `00000000-0000-4000-8000-${(1000000 + i)
        .toString(16)
        .padStart(12, '0')}`;
      const plaintext = new TextEncoder().encode(
        JSON.stringify({ version: 1, notes: notes.slice(i, i + 2) })
      );
      expect(plaintext.length).toBeLessThanOrEqual(32 * 1024);
      maximumShardBytes = Math.max(maximumShardBytes, plaintext.length);
      const shard = await keyring.encryptPrivateRecord({
        domain: shardDomain,
        recordId,
        plaintext,
      });
      plaintext.fill(0);
      shards.push(shard);
      references.push({
        recordId,
        count: 2,
        hash: keccak256(
          new TextEncoder().encode(
            JSON.stringify([
              shard.version,
              shard.domain,
              shard.recordId,
              shard.profileId,
              shard.nonce,
              shard.ciphertext,
            ])
          )
        ),
      });
    }
    const rootPlain = new TextEncoder().encode(
      JSON.stringify({
        format: PRIVATE_VAULT_FORMAT,
        version: 1,
        noteCount: capacity,
        capacity,
        shards: references,
      })
    );
    expect(rootPlain.length).toBeLessThanOrEqual(64 * 1024);
    const rootBytes = rootPlain.length;
    const root = await keyring.encryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: UUID,
      plaintext: rootPlain,
    });
    rootPlain.fill(0);
    const key = PRIVATE_VAULT_STORAGE_PREFIX + profileId;
    f.records[key] = { format: PRIVATE_VAULT_FORMAT, version: 1, root, shards };
    const bytes = new TextEncoder().encode(
      JSON.stringify(f.records[key])
    ).length;
    expect(bytes).toBeLessThanOrEqual((capacity / 128) * 4 * 1024 * 1024);
    const start = Date.now();
    const restarted = f.create();
    expect((await restarted.getNotes()).notes).toHaveLength(capacity);
    const readMs = Date.now() - start;
    cacheIdentities = true;
    expect(await restarted.getCapacity()).toMatchObject({
      capacity,
      noteCount: capacity,
      storedBytes: bytes,
    });
    const before = keccak256(toUtf8Bytes(JSON.stringify(f.records[key])));
    await expect(restarted.setCapacity(128)).rejects.toThrow(
      'privacy_note_limit'
    );
    expect(keccak256(toUtf8Bytes(JSON.stringify(f.records[key])))).toBe(before);
    f.storage.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(restarted.clearCompletedNotes([notes[0].id])).rejects.toThrow(
      'privacy_vault_unavailable'
    );
    expect(keccak256(toUtf8Bytes(JSON.stringify(f.records[key])))).toBe(before);
    // Exercise the real serializer and atomic write at full retained capacity,
    // then reload and verify the other worst-case journals survived.
    expect(await restarted.clearCompletedNotes([notes[0].id])).toEqual({
      removed: [notes[0].id],
      unresolved: [],
    });
    expect(f.revalidateCompletion).toHaveBeenCalledTimes(2);
    const afterRestart = f.create();
    expect(await afterRestart.getCapacity()).toMatchObject({
      capacity,
      noteCount: capacity - 1,
    });
    const remaining = (await afterRestart.getNotes()).notes;
    expect(remaining).toHaveLength(capacity - 1);
    expect(remaining.some((entry) => entry.id === notes[0].id)).toBe(false);
    expect(
      await afterRestart.getWithdrawalAttempt(notes[1].id, f.captureSession())
    ).toEqual({
      ...notes[1].withdrawal,
      noteId: notes[1].id,
      poolId: 'eth-100',
    });
    expect(
      await afterRestart.getDepositAttempt(notes[1].id, f.captureSession())
    ).toEqual(notes[1].deposit);
    // Non-secret diagnostic measurements; reviewed after execution, not timing gates.
    console.info('Synthetic worst-case encrypted vault', {
      capacity,
      bytes,
      readMs,
      rootBytes,
      maximumShardBytes,
      shards: shards.length,
    });
  },
  180000
);

it.each(['tier', 'count', 'schema', 'bytes'] as const)(
  'rejects an authenticated malformed canonical %s without changing storage',
  async (kind) => {
    const { f, key } = await capacityFixture(capacityNotes(2));
    await f.controller.setCapacity(256);
    const bundle = structuredClone(f.records[key]);
    const keyring = f.getKeyring();
    const plain = await keyring.decryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: bundle.root.recordId,
      envelope: bundle.root,
    });
    const root = JSON.parse(new TextDecoder().decode(plain));
    plain.fill(0);
    if (kind === 'tier') root.capacity = 1024;
    if (kind === 'count') root.noteCount = 257;
    if (kind === 'schema') root.unexpected = true;
    if (kind === 'bytes') {
      root.capacity = 128;
      root.noteCount = 97;
      // Envelopes satisfy the pre-decrypt size bound, but their combined
      // encoded size exceeds this selected tier's 4 MiB bundle limit.
      bundle.shards = Array.from({ length: 97 }, (_, index) => ({
        ...bundle.shards[0],
        recordId: `00000000-0000-4000-8000-${(2000000 + index)
          .toString(16)
          .padStart(12, '0')}`,
        ciphertext: 'A'.repeat(Math.ceil((32 * 1024 + 16) / 3) * 4),
      }));
      root.shards = bundle.shards.map((shard: any) => ({
        recordId: shard.recordId,
        count: 1,
        hash: keccak256(
          new TextEncoder().encode(
            JSON.stringify([
              shard.version,
              shard.domain,
              shard.recordId,
              shard.profileId,
              shard.nonce,
              shard.ciphertext,
            ])
          )
        ),
      }));
    }
    const rootPlain = new TextEncoder().encode(JSON.stringify(root));
    bundle.root = await keyring.encryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: bundle.root.recordId,
      plaintext: rootPlain,
    });
    rootPlain.fill(0);
    if (kind === 'bytes')
      expect(
        new TextEncoder().encode(JSON.stringify(bundle)).length
      ).toBeGreaterThan(4 * 1024 * 1024);
    f.records[key] = bundle;
    const saved = structuredClone(bundle);
    const writes = f.storage.setItem.mock.calls.length;
    await expect(f.create().getCapacity()).rejects.toThrow(
      'privacy_vault_corrupt'
    );
    expect(f.storage.setItem).toHaveBeenCalledTimes(writes);
    expect(f.records[key]).toEqual(saved);
  }
);

it('writes one canonical root and shard path for empty and small inventories', async () => {
  const f = fixture();
  expect(await f.controller.getNotes()).toEqual({ notes: [] });
  expect(await f.controller.getCapacity()).toMatchObject({
    capacity: 128,
    noteCount: 0,
    storedBytes: 0,
  });
  expect(f.storage.setItem).not.toHaveBeenCalled();

  const emptyStart = performance.now();
  await f.controller.setCapacity(256);
  const emptyWriteMs = performance.now() - emptyStart;
  const key = Object.keys(f.records)[0];
  const assertCanonical = async (count: number, capacity: number) => {
    const bundle = f.records[key];
    expect(Object.keys(bundle).sort()).toEqual([
      'format',
      'root',
      'shards',
      'version',
    ]);
    expect(bundle).toMatchObject({ format: PRIVATE_VAULT_FORMAT, version: 1 });
    expect(bundle.shards).toHaveLength(1);
    const rootPlain = await f.getKeyring().decryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: bundle.root.recordId,
      envelope: bundle.root,
    });
    try {
      const root = JSON.parse(new TextDecoder().decode(rootPlain));
      expect(Object.keys(root).sort()).toEqual([
        'capacity',
        'format',
        'noteCount',
        'restore',
        'shards',
        'version',
      ]);
      expect(root).toMatchObject({
        format: PRIVATE_VAULT_FORMAT,
        version: 1,
        noteCount: count,
        capacity,
      });
      expect(root.shards).toHaveLength(1);
      expect(root.shards[0].count).toBe(count);
    } finally {
      rootPlain.fill(0);
    }
    expect((await f.create().getNotes()).notes).toHaveLength(count);
  };
  await assertCanonical(0, 256);
  const emptyBytes = new TextEncoder().encode(
    JSON.stringify(f.records[key])
  ).length;
  await f.controller.setCapacity(128);
  await assertCanonical(0, 128);
  const smallStart = performance.now();
  const note = await f.controller.importNote(NOTE);
  const smallWriteMs = performance.now() - smallStart;
  const readStart = performance.now();
  await assertCanonical(1, 128);
  const smallReadAndInspectionMs = performance.now() - readStart;
  const smallBytes = new TextEncoder().encode(
    JSON.stringify(f.records[key])
  ).length;
  console.info('Canonical empty and single-note vault (desktop test only)', {
    emptyBytes,
    smallBytes,
    emptyWriteMs,
    smallWriteMs,
    smallReadAndInspectionMs,
  });
  expect(await f.create().revealNote(note.id, 'correct-password')).toBe(NOTE);
  expect(f.storage.setItem).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(f.records)).not.toContain(NOTE);
});

it.each([
  'old-single',
  'old-sharded',
  'old-capacity',
  'unknown-format',
  'future-version',
])(
  'preserves unsupported development data (%s) without reading it as empty or rewriting it',
  async (kind) => {
    const f = fixture();
    const key = await storeCanonicalManifest(f, {
      version: 1,
      notes: [{ id: UUID, note: NOTE, createdAt: 456 }],
    });
    const bundle = f.records[key];
    if (kind === 'old-single') {
      const plain = new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          notes: [{ id: UUID, note: NOTE, createdAt: 456 }],
        })
      );
      try {
        f.records[key] = await f.getKeyring().encryptPrivateRecord({
          domain: PRIVATE_VAULT_DOMAIN,
          recordId: UUID,
          plaintext: plain,
        });
      } finally {
        plain.fill(0);
      }
    } else if (kind === 'old-sharded' || kind === 'old-capacity') {
      const plain = await f.getKeyring().decryptPrivateRecord({
        domain: PRIVATE_VAULT_DOMAIN,
        recordId: bundle.root.recordId,
        envelope: bundle.root,
      });
      let legacyPlain!: Uint8Array;
      try {
        const root = JSON.parse(new TextDecoder().decode(plain));
        delete root.format;
        root.version = kind === 'old-sharded' ? 2 : 3;
        if (kind === 'old-sharded') delete root.capacity;
        legacyPlain = new TextEncoder().encode(JSON.stringify(root));
        bundle.root = await f.getKeyring().encryptPrivateRecord({
          domain: PRIVATE_VAULT_DOMAIN,
          recordId: bundle.root.recordId,
          plaintext: legacyPlain,
        });
        delete bundle.format;
        bundle.version = root.version;
      } finally {
        plain.fill(0);
        legacyPlain?.fill(0);
      }
    } else if (kind === 'unknown-format') bundle.format = 'different-vault';
    else bundle.version = 2;
    const before = structuredClone(f.records);
    for (const readOrWrite of [
      () => f.controller.getNotes(),
      () => f.controller.getCapacity(),
      () => f.controller.importNote(SECOND_NOTE),
      () => f.controller.createDepositNote('eth-1'),
      () => f.controller.setCapacity(256),
      () => f.controller.revealNote(UUID, 'correct-password'),
    ]) {
      await expect(readOrWrite()).rejects.toThrow(
        'privacy_vault_unsupported_format'
      );
      expect(f.records).toEqual(before);
      expect(f.storage.setItem).not.toHaveBeenCalled();
    }
    expect(f.readNote).not.toHaveBeenCalled();
  }
);

it.each(['format', 'version'])(
  'rejects a canonical outer record whose authenticated root has a different %s',
  async (field) => {
    const f = fixture();
    const key = await storeCanonicalManifest(f, { version: 1, notes: [] });
    const bundle = f.records[key];
    const plain = await f.getKeyring().decryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: bundle.root.recordId,
      envelope: bundle.root,
    });
    let changed!: Uint8Array;
    try {
      const root = JSON.parse(new TextDecoder().decode(plain));
      root[field] = field === 'format' ? 'different-vault' : 2;
      changed = new TextEncoder().encode(JSON.stringify(root));
      bundle.root = await f.getKeyring().encryptPrivateRecord({
        domain: PRIVATE_VAULT_DOMAIN,
        recordId: bundle.root.recordId,
        plaintext: changed,
      });
    } finally {
      plain.fill(0);
      changed?.fill(0);
    }
    const before = structuredClone(f.records);
    await expect(f.controller.getNotes()).rejects.toThrow(
      'privacy_vault_corrupt'
    );
    await expect(f.controller.importNote(NOTE)).rejects.toThrow(
      'privacy_vault_corrupt'
    );
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.records).toEqual(before);
  }
);

async function decryptedVault(f: ReturnType<typeof fixture>) {
  const bundle = Object.values(f.records)[0];
  const decrypt = async (envelope: any, domain: string) => {
    const bytes = await f
      .getKeyring()
      .decryptPrivateRecord({ domain, recordId: envelope.recordId, envelope });
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
      bytes.fill(0);
    }
  };
  const root = await decrypt(bundle.root, PRIVATE_VAULT_DOMAIN);
  const notes = [];
  for (const shard of bundle.shards)
    notes.push(
      ...(await decrypt(shard, 'org.syscoin.pali.privacy.notes.shard.v2')).notes
    );
  return { root, notes };
}

it('restores atomically after fresh authentication and keeps unknown history blocked after reload', async () => {
  const f = fixture();
  const session = f.captureSession();
  const entry = {
    note: NOTE,
    createdAt: 123,
    history: {
      withdrawals: [{ mode: 'relayed' as const, outcome: 'unknown' as const }],
    },
  };
  const denied = await f.controller.prepareRestore([entry], session);
  expect(f.storage.setItem).not.toHaveBeenCalled();
  await expect(
    f.controller.commitRestore(denied, [entry], 'wrong-password', session)
  ).rejects.toThrow('Invalid password');
  await expect(
    f.controller.commitRestore(denied, [entry], 'correct-password', session)
  ).rejects.toThrow('privacy_restore_stale');
  const plan = await f.controller.prepareRestore([entry], session);
  expect(JSON.stringify(plan)).not.toContain(NOTE);
  const receipt = await f.controller.commitRestore(
    plan,
    [entry],
    'correct-password',
    session
  );
  expect(receipt).toMatchObject({
    id: plan.id,
    added: 1,
    duplicates: 0,
    guarded: 1,
  });
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.records)).not.toContain(NOTE);
  const restarted = f.create();
  expect(await restarted.getRestoreReceipt(session)).toEqual(receipt);
  const note = (await restarted.getNotes()).notes[0];
  expect(note.phase).toBe('waiting');
  const use = jest.fn();
  await expect(
    restarted.withWithdrawalNote(note.id, session, use)
  ).rejects.toThrow('privacy_note_restore_required');
  await expect(
    restarted.reserveWithdrawalAttempt(withdrawalAttempt(note.id), session)
  ).rejects.toThrow('privacy_note_restore_required');
  expect(use).not.toHaveBeenCalled();
  const backup = await restarted.exportBackupSnapshot(
    'correct-password',
    session
  );
  expect(backup.notes).toEqual([{ ...entry, reconciliationRequired: true }]);
  f.setStatus({ phase: 'spent' });
  expect((await restarted.getNotes()).notes[0].phase).toBe('spent');
  f.setStatus({ phase: 'verified' });
  expect((await restarted.getNotes()).notes[0].phase).toBe('waiting');
});

it('new restores without hints remain guarded and cannot be reused as deposit candidates', async () => {
  const f = fixture();
  const session = f.captureSession();
  const plan = await f.controller.prepareRestore(
    [{ note: NOTE, createdAt: 1 }],
    session
  );
  await f.controller.commitRestore(
    plan,
    [{ note: NOTE, createdAt: 1 }],
    'correct-password',
    session
  );
  const note = (await f.controller.getNotes()).notes[0];
  await expect(
    f.controller.prepareDepositNote('eth-1', note.id, session)
  ).rejects.toThrow('privacy_note_restore_required');
  const raw = await decryptedVault(f);
  expect(raw.notes[0]).toMatchObject({
    note: NOTE,
    restoreGuard: { version: 1 },
  });
  expect(Object.keys(raw.root).sort()).toEqual([
    'capacity',
    'format',
    'noteCount',
    'restore',
    'shards',
    'version',
  ]);
  // The previous reader's strict five-key predicate rejects this canonical root.
  expect(Object.keys(raw.root)).not.toHaveLength(5);
});

it('preserves existing live journals and timestamps while adding imported evidence', async () => {
  const f = fixture();
  const session = f.captureSession();
  const local = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(local.id);
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  const before = (await decryptedVault(f)).notes[0];
  const entry = {
    note: NOTE,
    createdAt: 999,
    history: {
      withdrawals: [{ mode: 'relayed' as const, outcome: 'unknown' as const }],
    },
  };
  const plan = await f.controller.prepareRestore([entry], session);
  await f.controller.commitRestore(plan, [entry], 'correct-password', session);
  const after = (await decryptedVault(f)).notes[0];
  const { restoreGuard, ...rest } = after;
  expect(rest).toEqual(before);
  expect(restoreGuard.history.withdrawals).toHaveLength(1);
  await f.controller.recordWithdrawalSubmission(
    attempt,
    { transactionHash: TX_HASH },
    session
  );
  expect(
    await f.create().getWithdrawalAttempt(local.id, session)
  ).toMatchObject({ phase: 'submitted', transactionHash: TX_HASH });
  const backup = await f.controller.exportBackupSnapshot(
    'correct-password',
    session
  );
  expect(backup.notes[0]).toMatchObject({
    createdAt: before.createdAt,
    reconciliationRequired: true,
  });
  expect(backup.notes[0].history!.withdrawals).toHaveLength(2);
  expect(JSON.stringify(backup)).not.toContain('proofHash');
  expect(JSON.stringify(backup)).not.toContain('endpoint');
});

it('trusted unbroadcast cleanup cannot remove an independent restore guard', async () => {
  const f = fixture();
  const session = f.captureSession();
  const local = await f.controller.importNote(NOTE);
  const attempt = withdrawalAttempt(local.id);
  await f.controller.reserveWithdrawalAttempt(attempt, session);
  const plan = await f.controller.prepareRestore(
    [{ note: NOTE, createdAt: 1, reconciliationRequired: true }],
    session
  );
  await f.controller.commitRestore(
    plan,
    [{ note: NOTE, createdAt: 1, reconciliationRequired: true }],
    'correct-password',
    session
  );
  await f.controller.clearUnbroadcastWithdrawalAttempt(attempt, session);
  expect(await f.create().getWithdrawalAttempt(local.id, session)).toBeNull();
  await expect(
    f.create().withWithdrawalNote(local.id, session, () => undefined)
  ).rejects.toThrow('privacy_note_restore_required');
});

it.each(['lock', 'replace'] as const)(
  'rejects a %s after restore preview without writing another profile',
  async (change) => {
    const f = fixture();
    const session = f.captureSession();
    const plan = await f.controller.prepareRestore(
      [{ note: NOTE, createdAt: 1 }],
      session
    );
    if (change === 'lock') f.lock();
    else f.replaceKeyring('different wallet');
    await expect(
      f.controller.commitRestore(
        plan,
        [{ note: NOTE, createdAt: 1 }],
        'correct-password',
        session
      )
    ).rejects.toThrow();
    expect(f.storage.setItem).not.toHaveBeenCalled();
  }
);

it('invalidates a prepared merge if another wallet operation changes the inventory', async () => {
  const f = fixture();
  const session = f.captureSession();
  const plan = await f.controller.prepareRestore(
    [{ note: SECOND_NOTE, createdAt: 1 }],
    session
  );
  await f.controller.importNote(NOTE);
  const before = structuredClone(f.records);
  await expect(
    f.controller.commitRestore(
      plan,
      [{ note: SECOND_NOTE, createdAt: 1 }],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_restore_stale');
  expect(f.records).toEqual(before);
});

it('snapshots caller input before preview yields and consumes one token only once', async () => {
  const f = fixture();
  const session = f.captureSession();
  const entries = [{ note: NOTE, createdAt: 1 }];
  const pending = f.controller.prepareRestore(entries, session);
  entries[0].note = SECOND_NOTE;
  const plan = await pending;
  const results = await Promise.allSettled([
    f.controller.commitRestore(
      plan,
      [{ note: NOTE, createdAt: 1 }],
      'correct-password',
      session
    ),
    f.controller.commitRestore(
      plan,
      [{ note: NOTE, createdAt: 1 }],
      'correct-password',
      session
    ),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(
    (await f.controller.exportBackupSnapshot('correct-password', session))
      .notes[0].note
  ).toBe(NOTE);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

it('rejects forged or cancelled plan summaries and bounds retained previews', async () => {
  const f = fixture();
  const session = f.captureSession();
  const plan = await f.controller.prepareRestore(
    [{ note: NOTE, createdAt: 1 }],
    session
  );
  await expect(
    f.controller.commitRestore(
      { ...plan },
      [{ note: NOTE, createdAt: 1 }],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_restore_stale');
  f.controller.cancelRestore(plan);
  await expect(
    f.controller.commitRestore(
      plan,
      [{ note: NOTE, createdAt: 1 }],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_restore_stale');
  for (let n = 0; n < 4; n++)
    await f.controller.prepareRestore([{ note: NOTE, createdAt: n }], session);
  await expect(
    f.controller.prepareRestore([{ note: NOTE, createdAt: 5 }], session)
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

it('keeps prior custody intact when restore encryption or storage rejects before commit', async () => {
  const f = fixture();
  const session = f.captureSession();
  await f.controller.importNote(NOTE);
  const before = structuredClone(f.records);
  let plan = await f.controller.prepareRestore(
    [{ note: SECOND_NOTE, createdAt: 1 }],
    session
  );
  const encrypt = jest
    .spyOn(f.getKeyring(), 'encryptPrivateRecord')
    .mockRejectedValueOnce(new Error('failed'));
  await expect(
    f.controller.commitRestore(
      plan,
      [{ note: SECOND_NOTE, createdAt: 1 }],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(f.records).toEqual(before);
  encrypt.mockRestore();
  plan = await f.controller.prepareRestore(
    [{ note: SECOND_NOTE, createdAt: 1 }],
    session
  );
  f.storage.setItem.mockRejectedValueOnce(new Error('failed'));
  await expect(
    f.controller.commitRestore(
      plan,
      [{ note: SECOND_NOTE, createdAt: 1 }],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(f.records).toEqual(before);
  expect(await f.controller.getRestoreReceipt(session)).toBeNull();
});

it('writes the restore receipt with the notes when storage commits before losing acknowledgment', async () => {
  const f = fixture();
  const session = f.captureSession();
  const plan = await f.controller.prepareRestore(
    [
      { note: NOTE, createdAt: 1 },
      { note: SECOND_NOTE, createdAt: 2 },
    ],
    session
  );
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records[key] = structuredClone(value);
    throw new Error('lost acknowledgment');
  });
  await expect(
    f.controller.commitRestore(
      plan,
      [
        { note: NOTE, createdAt: 1 },
        { note: SECOND_NOTE, createdAt: 2 },
      ],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(await f.create().getRestoreReceipt(session)).toMatchObject({
    id: plan.id,
    added: 2,
  });
  expect((await f.create().getNotes()).notes).toHaveLength(2);
  await expect(
    f.controller.commitRestore(
      plan,
      [
        { note: NOTE, createdAt: 1 },
        { note: SECOND_NOTE, createdAt: 2 },
      ],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_restore_stale');
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

it('exports only the authenticated current profile and rejects a session switch during export', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  f.replaceKeyring('second synthetic wallet');
  await f.controller.importNote(SECOND_NOTE);
  expect(Object.keys(f.records)).toHaveLength(2);
  const session = f.captureSession();
  await expect(
    f.controller.exportBackupSnapshot('wrong-password', session)
  ).rejects.toThrow('Invalid password');
  const snapshot = await f.controller.exportBackupSnapshot(
    'correct-password',
    session
  );
  expect(snapshot.notes.map((note) => note.note)).toEqual([SECOND_NOTE]);
  f.authenticate.mockImplementationOnce(async (_password, current, reveal) => {
    current.assertCurrent();
    const result = await reveal();
    f.replaceKeyring('third synthetic wallet');
    return result;
  });
  await expect(
    f.controller.exportBackupSnapshot('correct-password', session)
  ).rejects.toThrow('privacy_vault_session_changed');
});

it('reads only guard-free pre-release roots and writes the required restore root field on change', async () => {
  const f = fixture();
  await storeCanonicalManifest(f, {
    version: 1,
    notes: [{ id: UUID, note: NOTE, createdAt: 1 }],
  });
  expect((await f.controller.getNotes()).notes).toHaveLength(1);
  await f.controller.setCapacity(256);
  expect((await decryptedVault(f)).root.restore).toEqual({ version: 1 });
  const other = fixture();
  await storeCanonicalManifest(other, {
    version: 1,
    notes: [
      {
        id: UUID,
        note: NOTE,
        createdAt: 1,
        restoreGuard: { version: 1, importedAt: 1, sourceHash: TX_HASH },
      },
    ],
  });
  await expect(other.controller.getNotes()).rejects.toThrow(
    'privacy_vault_corrupt'
  );
  expect(other.storage.setItem).not.toHaveBeenCalled();
});

it('rejects malformed authenticated restore metadata instead of discarding the guard', async () => {
  const f = fixture();
  const session = f.captureSession();
  const plan = await f.controller.prepareRestore(
    [{ note: NOTE, createdAt: 1 }],
    session
  );
  await f.controller.commitRestore(
    plan,
    [{ note: NOTE, createdAt: 1 }],
    'correct-password',
    session
  );
  const bundle = Object.values(f.records)[0];
  const { root } = await decryptedVault(f);
  root.restore = {
    version: 1,
    receipt: { ...root.restore.receipt, guarded: 513 },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(root));
  try {
    bundle.root = await f.getKeyring().encryptPrivateRecord({
      domain: PRIVATE_VAULT_DOMAIN,
      recordId: bundle.root.recordId,
      plaintext: bytes,
    });
  } finally {
    bytes.fill(0);
  }
  const before = structuredClone(f.records);
  await expect(f.create().getNotes()).rejects.toThrow('privacy_vault_corrupt');
  expect(f.records).toEqual(before);
});

it('binds a commit to its reviewed source and snapshots it before authentication yields', async () => {
  const f = fixture();
  const session = f.captureSession();
  const entries = [{ note: NOTE, createdAt: 1 }];
  let plan = await f.controller.prepareRestore(entries, session);
  await expect(
    f.controller.commitRestore(
      plan,
      [{ note: SECOND_NOTE, createdAt: 1 }],
      'correct-password',
      session
    )
  ).rejects.toThrow('privacy_restore_stale');
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.storage.setItem).not.toHaveBeenCalled();
  plan = await f.controller.prepareRestore(entries, session);
  const pending = f.controller.commitRestore(
    plan,
    entries,
    'correct-password',
    session
  );
  entries[0].note = SECOND_NOTE;
  await pending;
  expect(
    (await f.controller.exportBackupSnapshot('correct-password', session))
      .notes[0].note
  ).toBe(NOTE);
});

it.each(['deposit', 'withdrawal'] as const)(
  'shares the %s restore fence across core instances and preserves late acknowledgments',
  async (kind) => {
    const f = fixture(() => NOTE);
    const session = f.captureSession();
    if (kind === 'deposit') f.setStatus({ phase: 'not-found' });
    const local =
      kind === 'deposit'
        ? await f.controller.createDepositNote('eth-1')
        : await f.controller.importNote(NOTE);
    let fence!: () => void;
    const attempt =
      kind === 'deposit'
        ? depositAttempt(local.id)
        : withdrawalAttempt(local.id);
    if (kind === 'deposit')
      await f.controller.reserveDepositAttempt(
        attempt as IPrivacyDepositAttempt,
        session,
        (assertion) => {
          fence = assertion;
        }
      );
    else
      await f.controller.reserveWithdrawalAttempt(
        attempt as IPrivacyWithdrawalAttempt,
        session,
        (identity) => {
          fence = identity.assertRestoreCurrent;
        }
      );
    fence();
    const other = f.create();
    const entries = [
      { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
    ];
    const plan = await other.prepareRestore(entries, session);
    await other.commitRestore(plan, entries, 'correct-password', session);
    expect(fence).toThrow('privacy_note_restore_required');
    if (kind === 'deposit')
      await f.controller.recordDepositBroadcast(
        attempt as IPrivacyDepositAttempt,
        TX_HASH,
        session
      );
    else
      await f.controller.recordWithdrawalSubmission(
        attempt as IPrivacyWithdrawalAttempt,
        { transactionHash: TX_HASH },
        session
      );
    const stored = (await decryptedVault(f)).notes[0];
    expect(stored[kind]).toMatchObject({
      phase: 'submitted',
      transactionHash: TX_HASH,
    });
    expect(stored.restoreGuard).toBeDefined();
  }
);

it('discards an in-flight proof result if a restore adds a guard while proving', async () => {
  const f = fixture();
  const session = f.captureSession();
  const local = await f.controller.importNote(NOTE);
  const entered = deferred(),
    release = deferred();
  const proof = f.controller.withWithdrawalNote(local.id, session, async () => {
    entered.resolve();
    await release.promise;
    return 'public-proof';
  });
  const rejected = expect(proof).rejects.toThrow(
    'privacy_note_restore_required'
  );
  await entered.promise;
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const engine = f.create();
  const ownPlan = await engine.prepareRestore(entries, session);
  await engine.commitRestore(ownPlan, entries, 'correct-password', session);
  release.resolve();
  await rejected;
});

it('revokes a reservation fence before a restore whose storage acknowledgment is lost', async () => {
  const f = fixture();
  const session = f.captureSession();
  const local = await f.controller.importNote(NOTE);
  let fence!: () => void;
  await f.controller.reserveWithdrawalAttempt(
    withdrawalAttempt(local.id),
    session,
    (identity) => {
      fence = identity.assertRestoreCurrent;
    }
  );
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const plan = await f.controller.prepareRestore(entries, session);
  f.storage.setItem.mockRejectedValueOnce(new Error('storage failed'));
  await expect(
    f.controller.commitRestore(plan, entries, 'correct-password', session)
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(fence).toThrow('privacy_note_restore_required');
  expect((await decryptedVault(f)).notes[0].restoreGuard).toBeUndefined();
});

it('rechecks the proof fence after a final yielding profile read', async () => {
  const f = fixture();
  const session = f.captureSession();
  const local = await f.controller.importNote(NOTE);
  const entered = deferred(),
    release = deferred();
  const keyring = f.getKeyring();
  const profile = keyring.getPrivateRecordProfileId.bind(keyring);
  let pauseAfterProof = false;
  jest
    .spyOn(keyring, 'getPrivateRecordProfileId')
    .mockImplementation(async () => {
      const value = await profile();
      if (pauseAfterProof) {
        pauseAfterProof = false;
        entered.resolve();
        await release.promise;
      }
      return value;
    });
  const result = f.controller.withWithdrawalNote(local.id, session, () => {
    pauseAfterProof = true;
    return 'stale-proof';
  });
  const rejected = expect(result).rejects.toThrow(
    'privacy_note_restore_required'
  );
  await entered.promise;
  const other = f.create();
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const plan = await other.prepareRestore(entries, session);
  await other.commitRestore(plan, entries, 'correct-password', session);
  release.resolve();
  await rejected;
});

it('rejects a valid extreme-history merge before preview when its authenticated root cannot fit', async () => {
  const hash = '0x' + 'ab'.repeat(32),
    from = '0x' + '11'.repeat(20);
  const notes = capacityNotes(512).map((entry) => ({
    ...entry,
    origin: 'generated' as const,
    deposit: {
      intentId: entry.id,
      attemptHash: hash,
      createdAt: 456,
      from,
      nonce: '18446744073709551615',
      phase: 'submitted' as const,
      transactionHash: hash,
    },
    withdrawal: {
      intentId: entry.id,
      attemptHash: hash,
      proofHash: hash,
      inputHash: hash,
      createdAt: 456,
      mode: 'relayed' as const,
      phase: 'submitted' as const,
      endpoint: 'https://a' + '\u0000'.repeat(2039),
      ensHash: hash,
      transactionHash: hash,
      jobId: 'j'.repeat(128),
    },
  }));
  const f = fixture(undefined, (note) => ({
    poolId: 'eth-1',
    commitment: keccak256(toUtf8Bytes(note)),
    nullifierHash: hash,
  }));
  await storeCanonicalManifest(f, { version: 1, notes }, 512, undefined, 2);
  const before = structuredClone(f.records);
  const history = {
    withdrawals: Array.from({ length: 14 }, (_, index) => ({
      mode: 'direct' as const,
      outcome: 'submitted' as const,
      from,
      nonce: String(BigInt('18446744073709551615') - BigInt(index)),
      transactionHash: hash,
    })),
  };
  const entries = notes.map((note) => ({
    note: note.note,
    createdAt: note.createdAt,
    history,
  }));
  await expect(
    f.controller.prepareRestore(entries, f.captureSession())
  ).rejects.toThrow('privacy_note_limit');
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.records).toEqual(before);
});

it.each(['before authentication', 'during encryption'] as const)(
  'expires a restore preview %s without writing',
  async (stage) => {
    let clock = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const f = fixture();
    const session = f.captureSession();
    const entries = [{ note: NOTE, createdAt: 1 }];
    const plan = await f.controller.prepareRestore(entries, session);
    if (stage === 'before authentication') clock += 300_001;
    else {
      const encrypt = f.getKeyring().encryptPrivateRecord.bind(f.getKeyring());
      jest
        .spyOn(f.getKeyring(), 'encryptPrivateRecord')
        .mockImplementation(async (request) => {
          const envelope = await encrypt(request);
          clock += 300_001;
          return envelope;
        });
    }
    await expect(
      f.controller.commitRestore(plan, entries, 'correct-password', session)
    ).rejects.toThrow('privacy_restore_stale');
    expect(f.storage.setItem).not.toHaveBeenCalled();
  }
);

it('a duplicate raw-note import cannot strip an existing restore guard', async () => {
  const f = fixture();
  const session = f.captureSession();
  const entries = [{ note: NOTE, createdAt: 1 }];
  const plan = await f.controller.prepareRestore(entries, session);
  await f.controller.commitRestore(plan, entries, 'correct-password', session);
  const before = structuredClone(f.records);
  const imported = await f.controller.importNote(NOTE);
  expect(imported.phase).toBe('waiting');
  expect(f.records).toEqual(before);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  await expect(
    f.controller.withWithdrawalNote(imported.id, session, () => undefined)
  ).rejects.toThrow('privacy_note_restore_required');
});

it('failed withdrawal recovery retains the original journal and survives restart with fresh-review eligibility', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  const before = (await decryptedVault(f)).notes[0];
  expect((await f.controller.getNotes()).notes[0].phase).toBe('waiting');
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  const after = (await decryptedVault(f)).notes[0];
  expect(after).toEqual({
    ...before,
    withdrawal: {
      ...before.withdrawal,
      recovery: {
        root: '0x' + '01'.repeat(32),
        blockNumber: '123',
        blockHash: '0x' + 'cd'.repeat(32),
        recoveredAt: 456,
      },
    },
  });
  expect(f.prepareWithdrawalRecovery).toHaveBeenCalledWith(
    identifyClassicNote(NOTE),
    before.withdrawal,
    expect.objectContaining({ generation: session.generation })
  );
  expect(f.revalidateRecovery).toHaveBeenCalledTimes(1);
  const restarted = f.create();
  expect((await restarted.getNotes()).notes[0]).toMatchObject({
    id: note.id,
    phase: 'verified',
  });
  expect((await restarted.getNotes()).notes[0].withdrawal).toBeUndefined();
  expect(await restarted.getWithdrawalAttempt(note.id, session)).toBeNull();
  await expect(
    restarted.withWithdrawalNote(note.id, session, (raw) => raw)
  ).resolves.toBe(NOTE);
  const backup = await restarted.exportBackupSnapshot(
    'correct-password',
    session
  );
  expect(backup.notes[0].history?.withdrawals).toEqual([
    {
      mode: 'direct',
      outcome: 'submitted',
      from: '0x' + '11'.repeat(20),
      nonce: '7',
      transactionHash: TX_HASH,
    },
  ]);
  expect(JSON.stringify(backup)).not.toMatch(
    /proofHash|inputHash|recoveredAt|blockHash/
  );
  expect(Object.keys(after.withdrawal)).toContain('recovery');
  await restarted.importNote(NOTE);
  expect((await decryptedVault(f)).notes[0].withdrawal).toEqual(
    after.withdrawal
  );
  const restore = fixture();
  const restoreSession = restore.captureSession();
  const plan = await restore.controller.prepareRestore(
    backup.notes,
    restoreSession
  );
  await restore.controller.commitRestore(
    plan,
    backup.notes,
    'correct-password',
    restoreSession
  );
  const restored = (await restore.controller.getNotes()).notes[0];
  expect(restored.phase).toBe('waiting');
  await expect(
    restore.controller.recoverFailedWithdrawal(restored.id, 'correct-password')
  ).rejects.toThrow('privacy_note_restore_required');
  expect(restore.prepareWithdrawalRecovery).not.toHaveBeenCalled();
});

it('recovers the reproduced reverted withdrawal through real receipt/root verification only after proof expiry', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  const attempt = withdrawalAttempt(note.id);
  const blockHash = '0x' + 'cd'.repeat(32);
  let known = true;
  const abi = new Interface([
    'function isKnownRoot(bytes32) view returns(bool)',
    'function isSpent(bytes32) view returns(bool)',
  ]);
  f.prepareWithdrawalRecovery.mockImplementation(
    (identity, withdrawal, captured) =>
      prepareWithdrawalRecoveryProof({
        poolAddress: getPrivacyPool(identity.poolId).address,
        nullifierHash: identity.nullifierHash,
        withdrawal,
        assertCurrent: () => captured.assertCurrent(),
        rpc: async (method, params) => {
          if (method === 'eth_chainId') return '0x1';
          if (method === 'eth_getBlockByNumber')
            return { number: '0x7b', hash: blockHash };
          if (method === 'eth_getTransactionReceipt')
            return {
              transactionHash: TX_HASH,
              blockNumber: '0x7b',
              blockHash,
              status: '0x0',
            };
          if (method === 'eth_getTransactionByHash')
            return {
              hash: TX_HASH,
              blockNumber: '0x7b',
              blockHash,
              ...(
                attempt as Extract<
                  IPrivacyWithdrawalAttempt,
                  { mode: 'direct' }
                >
              ).transaction,
              chainId: '0x1',
              value: '0x0',
              input: (
                attempt as Extract<
                  IPrivacyWithdrawalAttempt,
                  { mode: 'direct' }
                >
              ).transaction.data,
            };
          if (method === 'eth_call') {
            const call = params[0] as { data: string };
            const name = call.data.startsWith(
              abi.getFunction('isKnownRoot')!.selector
            )
              ? 'isKnownRoot'
              : 'isSpent';
            return abi.encodeFunctionResult(name, [
              name === 'isKnownRoot' ? known : false,
            ]);
          }
          throw new Error('Unexpected synthetic RPC');
        },
      })
  );
  await expect(
    f.controller.withWithdrawalNote(note.id, session, () => undefined)
  ).rejects.toThrow('privacy_withdrawal_attempt_exists');
  await expect(
    f.controller.recoverFailedWithdrawal(note.id, 'correct-password')
  ).rejects.toThrow('privacy_withdrawal_recovery_unavailable');
  expect((await f.controller.getNotes()).notes[0].phase).toBe('waiting');
  known = false;
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  await expect(
    f
      .create()
      .withWithdrawalNote(note.id, session, () => 'fresh review allowed')
  ).resolves.toBe('fresh review allowed');
  expect((await decryptedVault(f)).notes[0].withdrawal.recovery).toMatchObject({
    blockNumber: '123',
    blockHash,
    root: attempt.root,
  });
});

it.each(['direct cleanup', 'known-unbroadcast cleanup'] as const)(
  'failed withdrawal recovery preserves history after a fresh reservation and %s',
  async (cleanup) => {
    const { f, note, session, attempt } = await failedWithdrawalFixture();
    await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
    const recovered = (await decryptedVault(f)).notes[0].withdrawal;
    const next = { ...attempt, intentId: UUID };
    await f.controller.reserveWithdrawalAttempt(next, session);
    const pending = await f.controller.getWithdrawalAttempt(note.id, session);
    expect(pending?.retired).toEqual([recovered]);
    expect((await f.controller.getNotes()).notes[0].phase).toBe('waiting');
    if (cleanup === 'direct cleanup') {
      await f.controller.clearUnbroadcastWithdrawalAttempt(next, session);
    } else {
      await f.controller.clearKnownUnbroadcastWithdrawal(
        note.id,
        next.intentId,
        pending!.attemptHash,
        await f.getKeyring().getPrivateRecordProfileId(),
        session,
        () => undefined
      );
    }
    expect((await decryptedVault(f)).notes[0].withdrawal).toEqual(recovered);
    expect(await f.create().getWithdrawalAttempt(note.id, session)).toBeNull();
    await f.controller.reserveWithdrawalAttempt(next, session);
    await f.controller.recordWithdrawalSubmission(
      next,
      { transactionHash: '0x' + 'de'.repeat(32) },
      session
    );
    const backup = await f.controller.exportBackupSnapshot(
      'correct-password',
      session
    );
    expect(backup.notes[0].history?.withdrawals).toHaveLength(2);
  }
);

it('failed withdrawal recovery authenticates before RPC and refuses relayed or unknown attempts', async () => {
  const direct = await failedWithdrawalFixture();
  await expect(
    direct.f.controller.recoverFailedWithdrawal(direct.note.id, 'wrong')
  ).rejects.toThrow('Invalid password');
  expect(direct.f.prepareWithdrawalRecovery).not.toHaveBeenCalled();
  const relayed = await failedWithdrawalFixture('relayed');
  const before = structuredClone(relayed.f.records);
  await expect(
    relayed.f.controller.recoverFailedWithdrawal(
      relayed.note.id,
      'correct-password'
    )
  ).rejects.toThrow('privacy_withdrawal_recovery_unavailable');
  expect(relayed.f.prepareWithdrawalRecovery).not.toHaveBeenCalled();
  expect(relayed.f.records).toEqual(before);
  const unknown = fixture();
  const note = await unknown.controller.importNote(NOTE);
  await unknown.controller.reserveWithdrawalAttempt(
    withdrawalAttempt(note.id),
    unknown.captureSession()
  );
  await expect(
    unknown.controller.recoverFailedWithdrawal(note.id, 'correct-password')
  ).rejects.toThrow('privacy_withdrawal_recovery_unavailable');
  expect(unknown.prepareWithdrawalRecovery).not.toHaveBeenCalled();
});

it('failed withdrawal recovery also preserves prior history when the fresh attempt is relayed', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  const recovered = (await decryptedVault(f)).notes[0].withdrawal;
  const next = { ...withdrawalAttempt(note.id, 'relayed'), intentId: UUID };
  await f.controller.reserveWithdrawalAttempt(next, session);
  await f.controller.clearUnbroadcastWithdrawalAttempt(next, session);
  expect((await decryptedVault(f)).notes[0].withdrawal).toEqual(recovered);
});

it('failed withdrawal recovery keeps an applied recovery marker after an ambiguous storage acknowledgement', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  const write = f.storage.setItem.getMockImplementation()!;
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    await write(key, value);
    throw new Error('acknowledgement lost');
  });
  await expect(
    f.controller.recoverFailedWithdrawal(note.id, 'correct-password')
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(await f.create().getWithdrawalAttempt(note.id, session)).toBeNull();
  await expect(
    f.create().recoverFailedWithdrawal(note.id, 'correct-password')
  ).rejects.toThrow('privacy_withdrawal_recovery_unavailable');
  expect(f.prepareWithdrawalRecovery).toHaveBeenCalledTimes(1);
  expect((await decryptedVault(f)).notes[0].withdrawal.recovery).toBeDefined();
});

it('failed withdrawal recovery retains the blocking journal when final proof revalidation fails', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  const before = structuredClone(f.records);
  f.revalidateRecovery.mockRejectedValueOnce(new Error('root remains valid'));
  await expect(
    f.controller.recoverFailedWithdrawal(note.id, 'correct-password')
  ).rejects.toThrow();
  expect(f.records).toEqual(before);
  await expect(
    f.create().withWithdrawalNote(note.id, session, () => undefined)
  ).rejects.toThrow('privacy_withdrawal_attempt_exists');
});

it('a new restore invalidates an in-flight recovery while a fresh exact recovery preserves its guard', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  const entered = deferred(),
    release = deferred();
  f.prepareWithdrawalRecovery.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return {
      receipt: {
        root: '0x' + '01'.repeat(32),
        blockNumber: '123',
        blockHash: '0x' + 'cd'.repeat(32),
      },
      revalidate: f.revalidateRecovery,
    };
  });
  const recovering = f.controller.recoverFailedWithdrawal(
    note.id,
    'correct-password'
  );
  const rejected = expect(recovering).rejects.toThrow(
    'privacy_withdrawal_recovery_unavailable'
  );
  await entered.promise;
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const other = f.create();
  const plan = await other.prepareRestore(entries, session);
  await other.commitRestore(plan, entries, 'correct-password', session);
  const guarded = structuredClone(f.records);
  release.resolve();
  await rejected;
  expect(f.records).toEqual(guarded);
  expect(f.revalidateRecovery).not.toHaveBeenCalled();
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  const recovered = (await decryptedVault(f)).notes[0];
  expect(recovered.restoreGuard.reviewedAt).toBeUndefined();
  expect(recovered.withdrawal.recovery).toBeDefined();
});

it('failed withdrawal recovery refuses a session change during encryption before writing', async () => {
  const { f, note } = await failedWithdrawalFixture();
  const before = structuredClone(f.records);
  const keyring = f.getKeyring(),
    encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementationOnce(async (request) => {
      const result = await encrypt(request);
      f.lock();
      return result;
    });
  await expect(
    f.controller.recoverFailedWithdrawal(note.id, 'correct-password')
  ).rejects.toThrow('privacy_vault_session_changed');
  expect(f.records).toEqual(before);
});

it('failed withdrawal recovery reserves backup capacity before a seventeenth historical outcome', async () => {
  const { f, note, session } = await failedWithdrawalFixture();
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  const stored = (await decryptedVault(f)).notes[0];
  const previous = structuredClone(stored.withdrawal);
  stored.withdrawal.retired = Array.from({ length: 15 }, (_, i) => ({
    ...previous,
    intentId: `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
    attemptHash: '0x' + (i + 1).toString(16).padStart(64, '0'),
    transactionHash: '0x' + (i + 100).toString(16).padStart(64, '0'),
  }));
  await storeCanonicalManifest(f, { version: 1, notes: [stored] });
  const backup = await f
    .create()
    .exportBackupSnapshot('correct-password', session);
  expect(backup.notes[0].history?.withdrawals).toHaveLength(16);
  const before = structuredClone(f.records);
  await expect(
    f
      .create()
      .reserveWithdrawalAttempt(
        { ...withdrawalAttempt(note.id), intentId: UUID },
        session
      )
  ).rejects.toThrow();
  expect(f.records).toEqual(before);
  expect((await f.create().getNotes()).notes[0].phase).toBe('verified');
});

it.each([
  'unknown',
  'relayed',
  'bad block',
  'missing marker',
  'recursive',
  'duplicate',
] as const)(
  'failed withdrawal recovery rejects malformed persisted history: %s',
  async (invalid) => {
    const { f, note } = await failedWithdrawalFixture();
    await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
    const stored = (await decryptedVault(f)).notes[0];
    const retired = structuredClone(stored.withdrawal);
    retired.intentId = UUID;
    retired.attemptHash = '0x' + 'bc'.repeat(32);
    retired.transactionHash = '0x' + 'de'.repeat(32);
    if (invalid === 'unknown') retired.phase = 'unknown';
    if (invalid === 'relayed') retired.mode = 'relayed';
    if (invalid === 'bad block') retired.recovery.blockNumber = '0123';
    if (invalid === 'missing marker') delete retired.recovery;
    if (invalid === 'recursive') retired.retired = [structuredClone(retired)];
    if (invalid === 'duplicate')
      retired.attemptHash = stored.withdrawal.attemptHash;
    stored.withdrawal.retired = [retired];
    await storeCanonicalManifest(f, { version: 1, notes: [stored] });
    await expect(f.create().getNotes()).rejects.toThrow(
      'privacy_vault_corrupt'
    );
  }
);

async function restoredReviewFixture(history?: any) {
  const f = fixture();
  const session = f.captureSession();
  const entries = [
    { note: NOTE, createdAt: 12, ...(history ? { history } : {}) },
  ];
  const plan = await f.controller.prepareRestore(entries, session);
  await f.controller.commitRestore(plan, entries, 'correct-password', session);
  const note = (await f.controller.getNotes()).notes[0];
  return { f, session, note };
}

it.each([
  ['without history', undefined],
  [
    'with deposit history',
    {
      deposits: [
        {
          outcome: 'submitted',
          from: '0x' + '11'.repeat(20),
          nonce: '7',
          transactionHash: TX_HASH,
        },
      ],
    },
  ],
])(
  'reviews an ordinary restored note %s without transferring review consent through backup',
  async (_label, history) => {
    const { f, session, note } = await restoredReviewFixture(history);
    expect(note).toMatchObject({
      phase: 'waiting',
      restoration: 'review-required',
    });
    const before = structuredClone(f.records);
    await expect(
      f.controller.reviewRestoredNote(note.id, 'wrong')
    ).rejects.toThrow('Invalid password');
    expect(f.records).toEqual(before);
    await f.controller.reviewRestoredNote(note.id, 'correct-password');
    const reviewed = (await decryptedVault(f)).notes[0];
    expect(reviewed).toMatchObject({
      id: note.id,
      createdAt: 12,
      note: NOTE,
      restoreGuard: { reviewedAt: 456 },
    });
    expect(reviewed.restoreGuard.history).toEqual(history);
    expect((await f.create().getNotes()).notes[0]).toMatchObject({
      phase: 'verified',
      restoration: 'reviewed',
    });
    await expect(
      f.create().withWithdrawalNote(note.id, session, (raw) => raw)
    ).resolves.toBe(NOTE);
    await expect(
      f.controller.prepareDepositNote('eth-1', note.id, session)
    ).rejects.toThrow('privacy_note_restore_required');
    const backup = await f.controller.exportBackupSnapshot(
      'correct-password',
      session
    );
    expect(JSON.stringify(backup)).not.toContain('reviewedAt');
    expect(backup.notes[0].history).toEqual(history);
    const second = fixture();
    const target = second.captureSession();
    const plan = await second.controller.prepareRestore(backup.notes, target);
    await second.controller.commitRestore(
      plan,
      backup.notes,
      'correct-password',
      target
    );
    expect((await second.controller.getNotes()).notes[0]).toMatchObject({
      phase: 'waiting',
      restoration: 'review-required',
    });
    expect(f.prepareWithdrawalRecovery).not.toHaveBeenCalled();
  }
);

it.each(['waiting', 'not-found', 'spent'] as const)(
  'refuses restored-note review for %s pool data without changing the note',
  async (phase) => {
    const { f, note } = await restoredReviewFixture();
    f.setStatus({ phase, blockNumber: 123 });
    const before = structuredClone(f.records);
    await expect(
      f.controller.reviewRestoredNote(note.id, 'correct-password')
    ).rejects.toThrow();
    expect(f.records).toEqual(before);
  }
);

it.each(['status', 'session'] as const)(
  'rechecks %s after review encryption before saving consent',
  async (change) => {
    const { f, note } = await restoredReviewFixture();
    const before = structuredClone(f.records);
    const encrypt = f.getKeyring().encryptPrivateRecord.bind(f.getKeyring());
    jest
      .spyOn(f.getKeyring(), 'encryptPrivateRecord')
      .mockImplementationOnce(async (request) => {
        const result = await encrypt(request);
        if (change === 'session') f.lock();
        else f.setStatus({ phase: 'spent', blockNumber: 124 });
        return result;
      });
    await expect(
      f.controller.reviewRestoredNote(note.id, 'correct-password')
    ).rejects.toThrow();
    expect(f.records).toEqual(before);
  }
);

it.each([
  {
    mode: 'direct',
    outcome: 'unknown',
    from: '0x' + '11'.repeat(20),
    nonce: '7',
  },
  {
    mode: 'direct',
    outcome: 'submitted',
    from: '0x' + '11'.repeat(20),
    nonce: '7',
    transactionHash: TX_HASH,
  },
  { mode: 'relayed', outcome: 'unknown' },
  { mode: 'relayed', outcome: 'submitted', jobId: 'saved-job' },
])(
  'keeps imported $mode/$outcome withdrawal evidence blocked and inert',
  async (withdrawal) => {
    const { f, note, session } = await restoredReviewFixture({
      withdrawals: [withdrawal],
    });
    const before = structuredClone(f.records);
    expect(note).toMatchObject({
      phase: 'waiting',
      restoration: 'withdrawal-pending',
    });
    await expect(
      f.controller.reviewRestoredNote(note.id, 'correct-password')
    ).rejects.toThrow('privacy_note_restore_required');
    await expect(
      f.controller.withWithdrawalNote(note.id, session, () => undefined)
    ).rejects.toThrow('privacy_note_restore_required');
    await expect(
      f.controller.recoverFailedWithdrawal(note.id, 'correct-password')
    ).rejects.toThrow('privacy_note_restore_required');
    expect(f.prepareWithdrawalRecovery).not.toHaveBeenCalled();
    expect(f.records).toEqual(before);
  }
);

it('preserves exact local failed-withdrawal recovery after a duplicate deposit-only backup adds an unreviewed guard', async () => {
  const { f, note, session, attempt } = await failedWithdrawalFixture();
  const entries = [
    {
      note: NOTE,
      createdAt: 1,
      history: {
        deposits: [
          {
            outcome: 'submitted' as const,
            from: '0x' + '11'.repeat(20),
            nonce: '7',
            transactionHash: TX_HASH,
          },
        ],
      },
    },
  ];
  const plan = await f.controller.prepareRestore(entries, session);
  await f.controller.commitRestore(plan, entries, 'correct-password', session);
  const guarded = (await decryptedVault(f)).notes[0];
  expect(guarded.restoreGuard.reviewedAt).toBeUndefined();
  expect(guarded.restoreGuard.history.withdrawals).toBeUndefined();
  expect(
    (await f.controller.getNotes()).notes[0].withdrawal?.canCheckRecovery
  ).toBe(true);
  await expect(
    f.controller.reviewRestoredNote(note.id, 'correct-password')
  ).rejects.toThrow('privacy_note_restore_required');
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  const recovered = (await decryptedVault(f)).notes[0];
  expect(recovered.restoreGuard).toEqual(guarded.restoreGuard);
  expect(recovered.withdrawal.recovery).toBeDefined();
  expect((await f.controller.getNotes()).notes[0]).toMatchObject({
    phase: 'waiting',
    restoration: 'review-required',
  });
  await f.controller.reviewRestoredNote(note.id, 'correct-password');
  await expect(
    f.controller.withWithdrawalNote(note.id, session, (raw) => raw)
  ).resolves.toBe(NOTE);
  if (attempt.mode !== 'direct') throw new Error('Expected direct fixture');
  const next = {
    ...attempt,
    intentId: UUID,
    transaction: { ...attempt.transaction, nonce: '0x8' },
  };
  await f.controller.reserveWithdrawalAttempt(next, session);
  await f.controller.recordWithdrawalSubmission(
    next,
    { transactionHash: '0x' + 'cd'.repeat(32) },
    session
  );
  expect(
    (await f.controller.getNotes()).notes[0].withdrawal?.canCheckRecovery
  ).toBe(true);
  await f.controller.recoverFailedWithdrawal(note.id, 'correct-password');
  expect((await f.controller.getNotes()).notes[0].phase).toBe('verified');
});

it.each(['history', 'marker'] as const)(
  'new imported %s revokes restored-note consent and an in-flight note use',
  async (kind) => {
    const { f, note, session } = await restoredReviewFixture();
    await f.controller.reviewRestoredNote(note.id, 'correct-password');
    const entered = deferred(),
      release = deferred();
    const use = f.controller.withWithdrawalNote(note.id, session, async () => {
      entered.resolve();
      await release.promise;
    });
    const rejected = expect(use).rejects.toThrow(
      'privacy_note_restore_required'
    );
    await entered.promise;
    const entries = [
      {
        note: NOTE,
        createdAt: 1,
        ...(kind === 'marker'
          ? { reconciliationRequired: true as const }
          : {
              history: {
                withdrawals: [
                  { mode: 'relayed' as const, outcome: 'unknown' as const },
                ],
              },
            }),
      },
    ];
    const plan = await f.controller.prepareRestore(entries, session);
    await f.controller.commitRestore(
      plan,
      entries,
      'correct-password',
      session
    );
    release.resolve();
    await rejected;
    expect(
      (await decryptedVault(f)).notes[0].restoreGuard.reviewedAt
    ).toBeUndefined();
    const before = structuredClone(f.records);
    await f.controller.importNote(NOTE);
    expect(f.records).toEqual(before);
  }
);

it('a lost review acknowledgement preserves durable consent and a retry does not rewrite it', async () => {
  const { f, note } = await restoredReviewFixture();
  const write = f.storage.setItem.getMockImplementation()!;
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    await write(key, value);
    throw new Error('acknowledgement lost');
  });
  await expect(
    f.controller.reviewRestoredNote(note.id, 'correct-password')
  ).rejects.toThrow('privacy_vault_unavailable');
  expect((await f.create().getNotes()).notes[0]).toMatchObject({
    phase: 'verified',
    restoration: 'reviewed',
  });
  const writes = f.storage.setItem.mock.calls.length;
  await f.create().reviewRestoredNote(note.id, 'correct-password');
  expect(f.storage.setItem).toHaveBeenCalledTimes(writes);
});
