import { webcrypto } from 'crypto';
import { AbiCoder } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';

import { createNoteBackupCodec, NOTE_BACKUP_FORMAT } from './noteBackup';
import {
  mergeNoteBackupHistories,
  validateNoteBackupHistory,
} from './noteBackupHistory';
import {
  planPrivateNoteRestore,
  privateNoteCurrentHistory,
  privateNoteExportHistory,
  readPrivateNoteRestoreGuard,
  restoredNoteBlocksWithdrawal,
} from './privateNoteRestore';
import type { IClassicNoteIdentity } from '../utils/privacy/note';

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const publicInputs = {
  root: hash(1),
  nullifierHash: hash(2),
  recipient: `0x${'11'.repeat(20)}`,
  relayer: `0x${'22'.repeat(20)}`,
  fee: '7',
  refund: '0' as const,
};
const inputHash = keccak256(
  AbiCoder.defaultAbiCoder().encode(
    Array(6).fill('uint256'),
    Object.values(publicInputs).map((value) => BigInt(value).toString())
  )
);
const evidence = () => ({
  mode: 'relayed' as const,
  outcome: 'submitted' as const,
  transactionHash: hash(3),
  proofHash: hash(4),
  inputHash,
  publicInputs: { ...publicInputs },
  rootAnchor: {
    root: publicInputs.root,
    blockNumber: '8',
    blockHash: hash(10),
  },
  transactionHashes: Array.from({ length: 16 }, (_, n) => hash(n + 3)),
});
const history = (value: unknown) => ({ withdrawals: [value] });

test('the existing encrypted backup format roundtrips the optional relay evidence', async () => {
  const codec = createNoteBackupCodec({
    crypto: webcrypto as unknown as Crypto,
    assertCurrent: () => undefined,
  });
  const payload = {
    format: NOTE_BACKUP_FORMAT,
    version: 1 as const,
    createdAt: 1,
    notes: [
      {
        note: `tornado-eth-1-1-0x${'01'.repeat(62)}`,
        createdAt: 1,
        history: validateNoteBackupHistory(history(evidence())),
      },
    ],
  };
  const encrypted = await codec.encrypt(
    payload,
    'synthetic backup history password'
  );
  expect(
    await codec.decrypt(encrypted, 'synthetic backup history password')
  ).toEqual(payload);
});

test('direct current and retired root anchors remain portable inert hints in the unchanged backup format', async () => {
  const inputs = { ...publicInputs, relayer: `0x${'00'.repeat(20)}`, fee: '0' };
  const original = {
    mode: 'direct' as const,
    outcome: 'submitted' as const,
    from: publicInputs.recipient,
    nonce: '0',
    transactionHash: hash(3),
    proofHash: hash(4),
    rootAnchor: evidence().rootAnchor,
    publicInputs: inputs,
    inputHash: keccak256(
      AbiCoder.defaultAbiCoder().encode(
        Array(6).fill('uint256'),
        Object.values(inputs).map(BigInt)
      )
    ),
  };
  const local = {
    id: '00000000-0000-4000-8000-000000000001',
    note: `tornado-eth-1-1-0x${'01'.repeat(62)}`,
    createdAt: 1,
    withdrawal: {
      ...original,
      phase: 'submitted' as const,
      retired: [
        { ...original, phase: 'unknown' as const, transactionHash: undefined },
      ],
    },
  };
  const exported = privateNoteExportHistory(local)!;
  expect(exported.withdrawals).toHaveLength(2);
  expect(
    exported.withdrawals!.every(
      (row) =>
        JSON.stringify(row.rootAnchor) === JSON.stringify(original.rootAnchor)
    )
  ).toBe(true);
  const codec = createNoteBackupCodec({
    crypto: webcrypto as unknown as Crypto,
    assertCurrent: () => undefined,
  });
  const payload = {
    format: NOTE_BACKUP_FORMAT,
    version: 1 as const,
    createdAt: 1,
    notes: [{ note: local.note, createdAt: 1, history: exported }],
  };
  expect(
    await codec.decrypt(
      await codec.encrypt(payload, 'synthetic backup history password'),
      'synthetic backup history password'
    )
  ).toEqual(payload);
  const identify = () =>
    ({
      poolId: 'eth-1',
      commitment: hash(5),
      nullifierHash: hash(2),
    } as IClassicNoteIdentity);
  const restored = planPrivateNoteRestore({
    entries: payload.notes,
    existing: [],
    capacity: 128,
    identify,
    importedAt: 10,
    randomId: () => '00000000-0000-4000-8000-000000000002',
  });
  expect(restored.notes[0]).not.toHaveProperty('withdrawal');
  expect(restoredNoteBlocksWithdrawal(restored.notes[0].restoreGuard)).toBe(
    true
  );
});

test('relay public proof inputs and bounded replacement hashes remain immutable inert history', () => {
  const input = evidence();
  const captured = validateNoteBackupHistory(history(input));
  expect(captured.withdrawals![0]).toEqual(input);
  expect(captured.withdrawals![0]).not.toHaveProperty('recovery');
  expect(captured.withdrawals![0]).not.toHaveProperty('proof');
  expect(Object.isFrozen(captured.withdrawals![0].publicInputs)).toBe(true);
  expect(Object.isFrozen(captured.withdrawals![0].rootAnchor)).toBe(true);
  expect(Object.isFrozen(captured.withdrawals![0].transactionHashes)).toBe(
    true
  );
  input.publicInputs.fee = '8';
  input.rootAnchor.blockNumber = '9';
  input.transactionHashes[0] = hash(99);
  expect(captured.withdrawals![0].publicInputs?.fee).toBe('7');
  expect(captured.withdrawals![0].rootAnchor?.blockNumber).toBe('8');
  expect(captured.withdrawals![0].transactionHashes?.[0]).toBe(hash(3));
  expect(mergeNoteBackupHistories(captured, captured)).toEqual(captured);
});

test.each([
  { proofHash: hash(4), mode: 'relayed', outcome: 'unknown' },
  { mode: 'relayed', outcome: 'unknown' },
  { mode: 'relayed', outcome: 'submitted', jobId: 'old-public-job' },
  {
    mode: 'direct',
    outcome: 'unknown',
    from: `0x${'11'.repeat(20)}`,
    nonce: '0',
  },
])('older no-input backup history remains readable: %j', (value) => {
  expect(validateNoteBackupHistory(history(value)).withdrawals).toEqual([
    value,
  ]);
});

test.each([
  { transactionHashes: [] },
  { transactionHashes: Array.from({ length: 17 }, (_, n) => hash(n + 3)) },
  { transactionHashes: [hash(3), hash(3)] },
  { transactionHashes: [hash(5), hash(3)] },
  { transactionHashes: [hash(3), '0x12'] },
  { transactionHashes: Array(1) },
  { transactionHash: undefined },
  { mode: 'direct', from: `0x${'11'.repeat(20)}`, nonce: '0' },
  { proofHash: '0x12' },
  { inputHash: hash(99) },
  { inputHash: undefined },
  { publicInputs: { ...publicInputs, fee: '08' } },
  { publicInputs: { ...publicInputs, refund: '1' } },
  { publicInputs: { ...publicInputs, recipient: `0x${'00'.repeat(20)}` } },
  { rootAnchor: { root: hash(99), blockNumber: '8', blockHash: hash(10) } },
  {
    rootAnchor: {
      root: publicInputs.root,
      blockNumber: '08',
      blockHash: hash(10),
    },
  },
])('rejects malformed or unbound relay history: %j', (change) => {
  expect(() =>
    validateNoteBackupHistory(history({ ...evidence(), ...change }))
  ).toThrow('BACKUP_INVALID_PAYLOAD');
});

test('history snapshots reject accessor/hash iterators and proof-input getters without invoking them', () => {
  const getter = jest.fn(() => hash(3));
  const hashes = Object.defineProperty([], '0', {
    get: getter,
    enumerable: true,
  });
  const inputs = Object.defineProperty({ ...publicInputs }, 'root', {
    get: getter,
    enumerable: true,
  });
  for (const change of [
    { transactionHashes: hashes },
    { publicInputs: inputs },
    {
      transactionHashes: Object.assign([hash(3)], {
        [Symbol.iterator]: getter,
      }),
    },
  ]) {
    expect(() =>
      validateNoteBackupHistory(history({ ...evidence(), ...change }))
    ).toThrow('BACKUP_INVALID_PAYLOAD');
  }
  expect(getter).not.toHaveBeenCalled();
});

test('export preserves active and retired relay observations without importing recovery authority', () => {
  const original = evidence();
  const retired = {
    ...original,
    phase: 'unknown' as const,
    transactionHash: undefined,
    transactionHashes: undefined,
    endpoint: 'https://secret:credential@example.invalid',
    intentId: 'local-only',
    proof: 'never-export-proof-bytes',
    recovery: { kind: 'relayed-proof-expired', root: hash(1) },
  };
  const local = {
    id: '00000000-0000-4000-8000-000000000001',
    note: 'synthetic-note',
    createdAt: 1,
    withdrawal: {
      ...original,
      phase: 'submitted' as const,
      retired: [retired],
    },
  };
  const exported = privateNoteExportHistory(local)!;
  expect(exported.withdrawals).toHaveLength(2);
  const known = exported.withdrawals!.find(
    (row) => row.transactionHash === hash(3)
  )!;
  expect(known.transactionHashes).toEqual(original.transactionHashes);
  expect(known.publicInputs).toEqual(publicInputs);
  expect(known.rootAnchor).toEqual(original.rootAnchor);
  const serialized = JSON.stringify(privateNoteCurrentHistory(local));
  for (const forbidden of [
    'endpoint',
    'credential',
    'intentId',
    'never-export-proof-bytes',
    'recovery',
    'unsigned',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  const restored = planPrivateNoteRestore({
    entries: [{ createdAt: 1, note: 'synthetic-note', history: exported }],
    existing: [],
    capacity: 128,
    identify: (() => ({
      poolId: 'eth-1',
      commitment: hash(6),
      nullifierHash: hash(2),
    })) as (note: string) => IClassicNoteIdentity,
    importedAt: 10,
    randomId: () => '00000000-0000-4000-8000-000000000002',
  });
  expect(restored.notes[0]).not.toHaveProperty('withdrawal');
  expect(restored.notes[0]).not.toHaveProperty('recovery');
  expect(restored.notes[0].restoreGuard?.history).toEqual(exported);
  expect(restoredNoteBlocksWithdrawal(restored.notes[0].restoreGuard)).toBe(
    true
  );
  const reviewed = readPrivateNoteRestoreGuard({
    ...restored.notes[0].restoreGuard,
    reviewedAt: 11,
  });
  // A stored review marker cannot become a permanent competing-proof approval.
  expect(restoredNoteBlocksWithdrawal(reviewed)).toBe(true);
});

test('export admission reserves late acknowledgement space for unresolved retained withdrawals', () => {
  const journal = (n: number) => ({
    ...evidence(),
    phase: 'unknown' as const,
    transactionHash: undefined,
    transactionHashes: undefined,
    proofHash: hash(n + 30),
    jobId: `retained-${n}`,
  });
  const note = (count: number) => ({
    id: '00000000-0000-4000-8000-000000000001',
    note: 'synthetic-note',
    createdAt: 1,
    withdrawal: {
      ...journal(0),
      retired: Array.from({ length: count - 1 }, (_, index) =>
        journal(index + 1)
      ),
    },
  });
  expect(privateNoteExportHistory(note(5))?.withdrawals).toHaveLength(5);
  expect(() => privateNoteExportHistory(note(6))).toThrow('privacy_note_limit');
});
