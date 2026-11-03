import {
  planPrivateNoteRestore,
  privateNoteCurrentHistory,
  privateNoteExportHistory,
  readPrivateNoteRestoreGuard,
  snapshotPrivateNoteRestoreEntries,
} from './privateNoteRestore';
import type { IRestorableNote } from './privateNoteRestore';
import type { IClassicNoteIdentity } from '../utils/privacy/note';

const FROM = '0x' + '11'.repeat(20);
const HASH = '0x' + 'aa'.repeat(32);
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const identify = (note: string): IClassicNoteIdentity => ({
  poolId: note.startsWith('small') ? 'eth-0.1' : 'eth-1',
  commitment: note,
  nullifierHash: HASH,
});
const entry = (note = 'one') => ({ note, createdAt: 12 });
const history = (count: number) => ({
  withdrawals: Array.from({ length: count }, (_, n) => ({
    mode: 'direct' as const,
    outcome: 'unknown' as const,
    from: FROM,
    nonce: String(n),
  })),
});
const plan = (
  entries: unknown,
  existing: IRestorableNote[] = [],
  capacity = 128
) =>
  planPrivateNoteRestore({
    entries: entries as any,
    existing,
    identify,
    capacity,
    importedAt: 23,
    randomId: (() => {
      let n = 10;
      return () => id(n++);
    })(),
  });

test('all new notes are guarded without history and all supported pools may coexist', () => {
  const result = plan([entry(), entry('small-two')]);
  expect(result).toMatchObject({ added: 2, duplicates: 0, guarded: 2 });
  expect(result.notes.map((n) => n.restoreGuard)).toEqual([
    { version: 1, importedAt: 23, sourceHash: result.sourceHash },
    { version: 1, importedAt: 23, sourceHash: result.sourceHash },
  ]);
});
test('duplicate entries or overflowing capacity reject the complete plan', () => {
  expect(() => plan([entry(), entry()])).toThrow('privacy_restore_invalid');
  const existing = Array.from({ length: 128 }, (_, n) => ({
    ...entry(String(n)),
    id: id(n + 100),
  }));
  expect(() => plan([entry('new')], existing)).toThrow('privacy_note_limit');
  expect(existing).toHaveLength(128);
});
test('a plain duplicate preserves the existing object and every journal field', () => {
  const local = {
    ...entry(),
    id: id(1),
    origin: 'generated',
    deposit: {
      phase: 'unknown' as const,
      from: FROM,
      nonce: '7',
      intentId: id(2),
    },
  };
  const result = plan([{ ...entry(), createdAt: 999 }], [local]);
  expect(result.notes[0]).toBe(local);
  expect(result).toMatchObject({ added: 0, duplicates: 1, guarded: 0 });
});
test('imported uncertainty only adds a guard, retaining local journals byte for byte', () => {
  const local = {
    ...entry(),
    id: id(1),
    origin: 'generated',
    withdrawal: {
      phase: 'unknown' as const,
      mode: 'direct' as const,
      from: FROM,
      nonce: '7',
      endpoint: 'do-not-export',
      proofHash: HASH,
    },
  };
  const before = JSON.stringify(local);
  const result = plan([{ ...entry(), history: history(1) }], [local]);
  const merged = result.notes[0];
  expect(JSON.stringify(local)).toBe(before);
  expect((merged as IRestorableNote).withdrawal).toBe(local.withdrawal);
  expect(merged).toMatchObject({
    createdAt: 12,
    id: id(1),
    origin: 'generated',
  });
  expect(merged.restoreGuard?.history?.withdrawals).toHaveLength(2);
  const projection = JSON.stringify(privateNoteCurrentHistory(merged));
  expect(projection).not.toContain('endpoint');
  expect(projection).not.toContain('proofHash');
});
test('a restored reconciliation marker cannot disappear on duplicate import', () => {
  const local = { ...entry(), id: id(1) };
  const first = plan([{ ...entry(), reconciliationRequired: true }], [local]);
  expect(first.notes[0].restoreGuard).toBeDefined();
  const second = plan([entry()], first.notes);
  expect(second.notes[0]).toBe(first.notes[0]);
});
test('preserves conflicting hints, deduplicates exact hints, rejects silent overflow', () => {
  const first = plan([{ ...entry(), history: history(16) }]);
  const repeated = plan([{ ...entry(), history: history(16) }], first.notes);
  expect(repeated.notes[0]).toBe(first.notes[0]);
  expect(() =>
    plan(
      [
        {
          ...entry(),
          history: {
            withdrawals: [
              {
                mode: 'direct',
                outcome: 'submitted',
                from: FROM,
                nonce: '0',
                transactionHash: HASH,
              },
            ],
          },
        },
      ],
      first.notes
    )
  ).toThrow('BACKUP_INVALID_PAYLOAD');
  expect(first.notes[0].restoreGuard?.history?.withdrawals).toHaveLength(16);
});
test('reserves space for direct final acknowledgment without dropping the unknown hint', () => {
  const local = {
    ...entry(),
    id: id(1),
    withdrawal: {
      phase: 'unknown' as const,
      mode: 'direct' as const,
      from: FROM,
      nonce: '0',
    },
  };
  expect(() => plan([{ ...entry(), history: history(16) }], [local])).toThrow(
    'privacy_note_limit'
  );
  const admitted = plan([{ ...entry(), history: history(15) }], [local])
    .notes[0];
  const acknowledged = {
    ...admitted,
    withdrawal: {
      ...local.withdrawal,
      phase: 'submitted' as const,
      transactionHash: HASH,
    },
  };
  expect(privateNoteExportHistory(acknowledged)?.withdrawals).toHaveLength(16);
});
test('reserves two relayed slots so job-only and final hash acknowledgments remain possible', () => {
  const local = {
    ...entry(),
    id: id(1),
    withdrawal: { phase: 'unknown' as const, mode: 'relayed' as const },
  };
  expect(() => plan([{ ...entry(), history: history(14) }], [local])).toThrow(
    'privacy_note_limit'
  );
  const admitted = plan([{ ...entry(), history: history(13) }], [local])
    .notes[0];
  const job = {
    ...admitted,
    withdrawal: {
      ...local.withdrawal,
      phase: 'submitted' as const,
      jobId: 'known-job',
    },
  };
  expect(privateNoteExportHistory(job)?.withdrawals).toHaveLength(15);
  expect(
    privateNoteExportHistory({
      ...job,
      withdrawal: { ...job.withdrawal, transactionHash: HASH },
    })?.withdrawals
  ).toHaveLength(15);
});
test('projects before asynchronous admission without invoking getters or accepting sparse arrays', () => {
  const getter = jest.fn(() => 'one');
  expect(() =>
    snapshotPrivateNoteRestoreEntries([
      {
        createdAt: 1,
        get note() {
          return getter();
        },
      },
    ])
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => snapshotPrivateNoteRestoreEntries(Array(1))).toThrow();
  expect(() =>
    snapshotPrivateNoteRestoreEntries([{ ...entry(), walletProfile: HASH }])
  ).toThrow();
});
test('rejects malformed durable guards and never treats absence of hints as clearance', () => {
  const guard = { version: 1, importedAt: 1, sourceHash: HASH };
  expect(readPrivateNoteRestoreGuard(guard)).toEqual(guard);
  expect(() =>
    readPrivateNoteRestoreGuard({ ...guard, cleared: true })
  ).toThrow();
  expect(() =>
    readPrivateNoteRestoreGuard({ ...guard, history: {} })
  ).toThrow();
});
