export const NOTE_BACKUP_MAX_HISTORY_HINTS = 16;
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const NONCE = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_NONCE = (BigInt(1) << BigInt(64)) - BigInt(1);

type Outcome = 'unknown' | 'submitted';
/** Inert historical evidence; never an active transaction or reservation. */
export interface INoteBackupDepositHistory {
  from: string;
  nonce: string;
  outcome: Outcome;
  transactionHash?: string;
}
export interface INoteBackupWithdrawalHistory {
  from?: string;
  jobId?: string;
  mode: 'direct' | 'relayed';
  nonce?: string;
  outcome: Outcome;
  transactionHash?: string;
}
export interface INoteBackupHistory {
  deposits?: readonly Readonly<INoteBackupDepositHistory>[];
  withdrawals?: readonly Readonly<INoteBackupWithdrawalHistory>[];
}
const invalid = (): never => {
  throw Object.assign(new Error('BACKUP_INVALID_PAYLOAD'), {
    code: 'BACKUP_INVALID_PAYLOAD',
  });
};
export const snapshotBackupObject = (
  value: unknown,
  allowed: readonly string[]
): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) return invalid();
  const snapshot: Record<string, any> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !property.enumerable || !('value' in property))
      return invalid();
    snapshot[key] = property.value;
  }
  return snapshot;
};
/** Snapshot dense own data slots; never invoke a caller's iterator or map. */
export const snapshotBackupArray = (
  value: unknown,
  maximum: number
): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
    return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return invalid();
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !('value' in property))
      return invalid();
    snapshot.push(property.value);
  }
  return snapshot;
};
const hash = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !HASH.test(value)) return invalid();
  return value;
};
const senderNonce = (raw: Record<string, any>, required: boolean) => {
  if (!required && raw.from === undefined && raw.nonce === undefined) return {};
  if (
    typeof raw.from !== 'string' ||
    !ADDRESS.test(raw.from) ||
    typeof raw.nonce !== 'string' ||
    !NONCE.test(raw.nonce) ||
    BigInt(raw.nonce) > MAX_NONCE
  )
    return invalid();
  return { from: raw.from, nonce: raw.nonce };
};
const outcome = (value: unknown): Outcome => {
  if (value !== 'unknown' && value !== 'submitted') return invalid();
  return value;
};

function deposit(value: unknown): Readonly<INoteBackupDepositHistory> {
  const entry = snapshotBackupObject(value, [
    'outcome',
    'transactionHash',
    'from',
    'nonce',
  ]);
  const state = outcome(entry.outcome);
  const transactionHash = hash(entry.transactionHash);
  if (state === 'submitted' && !transactionHash) return invalid();
  const identity = senderNonce(entry, true) as { from: string; nonce: string };
  return Object.freeze({
    outcome: state,
    ...identity,
    ...(transactionHash ? { transactionHash } : {}),
  });
}
function withdrawal(value: unknown): Readonly<INoteBackupWithdrawalHistory> {
  const entry = snapshotBackupObject(value, [
    'outcome',
    'mode',
    'transactionHash',
    'from',
    'nonce',
    'jobId',
  ]);
  const state = outcome(entry.outcome);
  if (entry.mode !== 'direct' && entry.mode !== 'relayed') return invalid();
  const transactionHash = hash(entry.transactionHash);
  const identity = senderNonce(entry, entry.mode === 'direct');
  if (entry.mode === 'relayed' && entry.from !== undefined) return invalid();
  if (
    entry.jobId !== undefined &&
    (entry.mode !== 'relayed' ||
      typeof entry.jobId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(entry.jobId))
  )
    return invalid();
  if (state === 'submitted' && !transactionHash && !entry.jobId)
    return invalid();
  return Object.freeze({
    outcome: state,
    mode: entry.mode,
    ...identity,
    ...(transactionHash ? { transactionHash } : {}),
    ...(entry.jobId === undefined ? {} : { jobId: entry.jobId }),
  });
}
function ordered<T>(values: readonly T[]): readonly T[] {
  const entries = new Map(
    values.map((value) => [JSON.stringify(value), value])
  );
  return Object.freeze(
    [...entries.keys()].sort().map((key) => entries.get(key)!)
  );
}
function combine(
  deposits: readonly Readonly<INoteBackupDepositHistory>[],
  withdrawals: readonly Readonly<INoteBackupWithdrawalHistory>[]
): Readonly<INoteBackupHistory> {
  const canonicalDeposits = ordered(deposits);
  const canonicalWithdrawals = ordered(withdrawals);
  const count = canonicalDeposits.length + canonicalWithdrawals.length;
  if (!count || count > NOTE_BACKUP_MAX_HISTORY_HINTS) return invalid();
  return Object.freeze({
    ...(canonicalDeposits.length ? { deposits: canonicalDeposits } : {}),
    ...(canonicalWithdrawals.length
      ? { withdrawals: canonicalWithdrawals }
      : {}),
  });
}
/** Validate inert hints, preserving conflicts and collapsing only exact duplicates. */
export function validateNoteBackupHistory(
  value: unknown
): Readonly<INoteBackupHistory> {
  try {
    const raw = snapshotBackupObject(value, ['deposits', 'withdrawals']);
    const deposits =
      raw.deposits === undefined
        ? []
        : snapshotBackupArray(raw.deposits, NOTE_BACKUP_MAX_HISTORY_HINTS).map(
            deposit
          );
    const withdrawals =
      raw.withdrawals === undefined
        ? []
        : snapshotBackupArray(
            raw.withdrawals,
            NOTE_BACKUP_MAX_HISTORY_HINTS
          ).map(withdrawal);
    if (
      (raw.deposits !== undefined && !deposits.length) ||
      (raw.withdrawals !== undefined && !withdrawals.length)
    )
      return invalid();
    return combine(deposits, withdrawals);
  } catch {
    return invalid();
  }
}
/** Same per-note budget covers retained, imported and live-current evidence. */
export function mergeNoteBackupHistories(
  ...values: readonly unknown[]
): Readonly<INoteBackupHistory> | undefined {
  try {
    if (values.length > NOTE_BACKUP_MAX_HISTORY_HINTS) return invalid();
    const deposits: Readonly<INoteBackupDepositHistory>[] = [];
    const withdrawals: Readonly<INoteBackupWithdrawalHistory>[] = [];
    for (const value of values) {
      if (value === undefined) continue;
      const validated = validateNoteBackupHistory(value);
      deposits.push(...(validated.deposits ?? []));
      withdrawals.push(...(validated.withdrawals ?? []));
    }
    return deposits.length || withdrawals.length
      ? combine(deposits, withdrawals)
      : undefined;
  } catch {
    return invalid();
  }
}
