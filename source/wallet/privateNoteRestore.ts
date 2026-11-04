import { keccak256, toUtf8Bytes } from 'ethers';

import {
  mergeNoteBackupHistories,
  NOTE_BACKUP_MAX_HISTORY_HINTS,
  snapshotBackupArray,
  snapshotBackupObject,
  validateNoteBackupHistory,
} from './noteBackupHistory';
import type { INoteBackupHistory } from './noteBackupHistory';
import type { identifyClassicNote } from '../utils/privacy/note';

// Backup decoding and envelope validation belong to the codec. This leaf only
// projects restored entries, persists conservative evidence, and plans a merge.
export interface IPrivateNoteRestoreEntry {
  createdAt: number;
  history?: Readonly<INoteBackupHistory>;
  note: string;
  reconciliationRequired?: true;
}
export interface IPrivateNoteRestoreGuard {
  history?: Readonly<INoteBackupHistory>;
  importedAt: number;
  /** Local password-confirmed review only; never accepted from a backup. */
  reviewedAt?: number;
  sourceHash: string;
  version: 1;
}
export interface IPrivateNoteRestoreReceipt {
  added: number;
  createdAt: number;
  duplicates: number;
  guarded: number;
  id: string;
  sourceHash: string;
}
export interface IPrivateNoteRestoreMetadata {
  receipt?: IPrivateNoteRestoreReceipt;
  version: 1;
}
interface ILocalJournal {
  from?: string;
  jobId?: string;
  mode?: 'direct' | 'relayed';
  nonce?: string;
  phase: 'unknown' | 'submitted';
  retired?: readonly ILocalJournal[];
  transactionHash?: string;
}
export interface IRestorableNote {
  createdAt: number;
  deposit?: ILocalJournal;
  id: string;
  note: string;
  restoreGuard?: IPrivateNoteRestoreGuard;
  withdrawal?: ILocalJournal;
}
type IRestoredNote = Pick<
  IRestorableNote,
  'createdAt' | 'id' | 'note' | 'restoreGuard'
>;
const HASH = /^0x[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DATE = 8_640_000_000_000_000;
const invalid = (): never => {
  throw new Error('privacy_restore_invalid');
};
const date = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) >= 0 &&
  Number(value) <= MAX_DATE;
const data = (value: unknown, allowed: string[], required: string[]) => {
  const result = snapshotBackupObject(value, allowed);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
  )
    return invalid();
  return result;
};

export function readPrivateNoteRestoreGuard(
  value: unknown
): IPrivateNoteRestoreGuard {
  const guard = data(
    value,
    ['version', 'importedAt', 'sourceHash', 'history', 'reviewedAt'],
    ['version', 'importedAt', 'sourceHash']
  );
  if (
    guard.version !== 1 ||
    !date(guard.importedAt) ||
    typeof guard.sourceHash !== 'string' ||
    !HASH.test(guard.sourceHash) ||
    (guard.reviewedAt !== undefined && !date(guard.reviewedAt))
  )
    return invalid();
  const history =
    guard.history === undefined
      ? undefined
      : validateNoteBackupHistory(guard.history);
  return {
    version: 1,
    importedAt: guard.importedAt,
    sourceHash: guard.sourceHash,
    ...(history ? { history } : {}),
    ...(guard.reviewedAt !== undefined ? { reviewedAt: guard.reviewedAt } : {}),
  };
}

export const hasImportedWithdrawalHistory = (
  guard: IPrivateNoteRestoreGuard | undefined
): boolean => Boolean(guard?.history?.withdrawals?.length);

/** Review is local consent, not evidence of exclusive ownership or proof revocation. */
export const restoredNoteBlocksWithdrawal = (
  guard: IPrivateNoteRestoreGuard | undefined
): boolean =>
  Boolean(
    guard &&
      (guard.reviewedAt === undefined || hasImportedWithdrawalHistory(guard))
  );
export function readPrivateNoteRestoreMetadata(
  value: unknown
): IPrivateNoteRestoreMetadata {
  const metadata = data(value, ['version', 'receipt'], ['version']);
  if (metadata.version !== 1) return invalid();
  if (metadata.receipt === undefined) return { version: 1 };
  const receipt = data(
    metadata.receipt,
    ['id', 'sourceHash', 'createdAt', 'added', 'duplicates', 'guarded'],
    ['id', 'sourceHash', 'createdAt', 'added', 'duplicates', 'guarded']
  );
  if (
    typeof receipt.id !== 'string' ||
    !UUID.test(receipt.id) ||
    typeof receipt.sourceHash !== 'string' ||
    !HASH.test(receipt.sourceHash) ||
    !date(receipt.createdAt) ||
    ![receipt.added, receipt.duplicates, receipt.guarded].every(
      (count) => Number.isSafeInteger(count) && count >= 0 && count <= 512
    ) ||
    receipt.added + receipt.duplicates < 1 ||
    receipt.added + receipt.duplicates > 512 ||
    receipt.guarded > receipt.added + receipt.duplicates
  )
    return invalid();
  return { version: 1, receipt: receipt as IPrivateNoteRestoreReceipt };
}
export function snapshotPrivateNoteRestoreEntries(
  value: unknown
): IPrivateNoteRestoreEntry[] {
  const entries = snapshotBackupArray(value, 512);
  if (!entries.length) return invalid();
  return entries.map((raw) => {
    const entry = data(
      raw,
      ['createdAt', 'note', 'history', 'reconciliationRequired'],
      ['createdAt', 'note']
    );
    if (
      !date(entry.createdAt) ||
      typeof entry.note !== 'string' ||
      !entry.note.length ||
      entry.note.length > 256 ||
      entry.note !== entry.note.trim().toLowerCase() ||
      (entry.reconciliationRequired !== undefined &&
        entry.reconciliationRequired !== true)
    )
      return invalid();
    return {
      createdAt: entry.createdAt,
      note: entry.note,
      ...(entry.history === undefined
        ? {}
        : { history: validateNoteBackupHistory(entry.history) }),
      ...(entry.reconciliationRequired === true
        ? { reconciliationRequired: true as const }
        : {}),
    };
  });
}
export const privateNoteRestoreDigest = (value: unknown): string =>
  keccak256(toUtf8Bytes(JSON.stringify(value)));

/** Excludes endpoints, proofs, intent IDs and other active-job authority. */
export function privateNoteCurrentHistory(
  note: IRestorableNote
): Readonly<INoteBackupHistory> | undefined {
  const deposit = note.deposit;
  const withdrawal = note.withdrawal;
  return mergeNoteBackupHistories(
    deposit
      ? {
          deposits: [
            {
              outcome: deposit.phase,
              from: deposit.from,
              nonce: deposit.nonce,
              ...(deposit.transactionHash
                ? { transactionHash: deposit.transactionHash }
                : {}),
            },
          ],
        }
      : undefined,
    withdrawal
      ? {
          withdrawals: [...(withdrawal.retired ?? []), withdrawal].map(
            (entry) => ({
              outcome: entry.phase,
              mode: entry.mode,
              ...(entry.from ? { from: entry.from, nonce: entry.nonce } : {}),
              ...(entry.transactionHash
                ? { transactionHash: entry.transactionHash }
                : {}),
              ...(entry.jobId ? { jobId: entry.jobId } : {}),
            })
          ),
        }
      : undefined
  );
}

/** Reserve space for a pending journal's final acknowledgment before admission. */
export function privateNoteExportHistory(
  note: IRestorableNote
): Readonly<INoteBackupHistory> | undefined {
  const history = mergeNoteBackupHistories(
    note.restoreGuard?.history,
    privateNoteCurrentHistory(note)
  );
  const count =
    (history?.deposits?.length ?? 0) + (history?.withdrawals?.length ?? 0);
  const pending =
    Number(note.deposit?.phase === 'unknown') +
    (note.withdrawal?.phase === 'unknown'
      ? note.withdrawal.mode === 'relayed'
        ? 2
        : 1
      : Number(
          note.withdrawal?.mode === 'relayed' &&
            note.withdrawal.phase === 'submitted' &&
            !note.withdrawal.transactionHash
        ));
  if (count + pending > NOTE_BACKUP_MAX_HISTORY_HINTS)
    throw new Error('privacy_note_limit');
  return history;
}

/** Pure bounded merge. No chain status can turn a restored record spendable. */
export function planPrivateNoteRestore<T extends IRestorableNote>(input: {
  capacity: number;
  entries: readonly IPrivateNoteRestoreEntry[];
  existing: readonly T[];
  identify: typeof identifyClassicNote;
  importedAt: number;
  randomId: () => string;
}): {
  added: number;
  duplicates: number;
  guarded: number;
  notes: (T | IRestoredNote)[];
  sourceHash: string;
} {
  const { capacity, existing, identify, importedAt, randomId } = input;
  if (
    ![128, 256, 512].includes(capacity) ||
    existing.length > capacity ||
    !date(importedAt)
  )
    return invalid();
  const entries = snapshotPrivateNoteRestoreEntries(input.entries);
  const sourceHash = privateNoteRestoreDigest(entries);
  const key = (raw: string) => {
    const identity = identify(raw);
    return `${identity.poolId}:${identity.commitment}`;
  };
  const positions = new Map<string, number>();
  const ids = new Set<string>();
  const notes: (T | IRestoredNote)[] = [...existing];
  for (const [index, note] of existing.entries()) {
    const identity = key(note.note);
    if (positions.has(identity) || ids.has(note.id)) return invalid();
    positions.set(identity, index);
    ids.add(note.id);
  }
  const incoming = new Set<string>();
  let added = 0,
    duplicates = 0,
    guarded = 0;
  for (const entry of entries) {
    const identity = key(entry.note);
    if (incoming.has(identity)) return invalid();
    incoming.add(identity);
    const position = positions.get(identity);
    if (position !== undefined) {
      duplicates++;
      const previous = notes[position];
      // Never replace a local record or journal. Reconciliation markers and
      // inert imported evidence can only add a block and retain more evidence.
      if (entry.history || entry.reconciliationRequired) {
        const guard = previous.restoreGuard
          ? readPrivateNoteRestoreGuard(previous.restoreGuard)
          : { version: 1 as const, importedAt, sourceHash };
        const history = mergeNoteBackupHistories(guard.history, entry.history);
        // Local journals remain in their original fields and are included by
        // export admission below. Do not turn them into imported blockers.
        const revokeReview =
          entry.reconciliationRequired ||
          Boolean(entry.history?.withdrawals?.length);
        const unreviewed = { ...guard };
        if (revokeReview) delete unreviewed.reviewedAt;
        const nextGuard = {
          ...(revokeReview ? unreviewed : guard),
          ...(history ? { history } : {}),
        };
        if (
          !previous.restoreGuard ||
          JSON.stringify(nextGuard) !== JSON.stringify(previous.restoreGuard)
        ) {
          notes[position] = { ...previous, restoreGuard: nextGuard };
          guarded++;
        }
      }
      continue;
    }
    if (notes.length >= capacity) throw new Error('privacy_note_limit');
    const id = randomId();
    if (typeof id !== 'string' || !UUID.test(id) || ids.has(id))
      return invalid();
    ids.add(id);
    notes.push({
      id,
      note: entry.note,
      createdAt: entry.createdAt,
      restoreGuard: {
        version: 1,
        importedAt,
        sourceHash,
        ...(entry.history ? { history: entry.history } : {}),
      },
    });
    added++;
    guarded++;
  }
  // Check the complete future export, including unchanged live notes, before
  // committing any of the import. All pending outcomes retain reserved space.
  for (const note of notes) privateNoteExportHistory(note);
  return { notes, added, duplicates, guarded, sourceHash };
}
