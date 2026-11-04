import type { RecoveryStorageSnapshot } from './types.ts';

/** Exact stored bytes, including key-set changes; no semantic JSON normalization. */
export function sameRecoverySnapshot(a: RecoveryStorageSnapshot, b: RecoveryStorageSnapshot): boolean {
  const same = (left: RecoveryStorageSnapshot['records'], right: RecoveryStorageSnapshot['records']) =>
    left.length === right.length && left.every((row, index) => row.key === right[index]?.key && row.value === right[index]?.value);
  return same(a.records, b.records) && same(a.metadata, b.metadata) &&
    a.notes.length === b.notes.length && a.notes.every((row, index) => row.profileId === b.notes[index]?.profileId && row.walletBindingId === b.notes[index]?.walletBindingId && row.value === b.notes[index]?.value);
}
