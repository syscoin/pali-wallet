import { keccak256 } from 'ethers/crypto';

import { identifyClassicNote } from '../utils/privacy/note.ts';
import {
  captureWithdrawalPublicInputs,
  captureWithdrawalRootAnchor,
} from '../utils/privacy/withdrawalMetadata.ts';
import { MAX_PRIVACY_RELAY_TRANSACTIONS } from '../utils/privacy/withdrawalTransactionTypes.ts';

import {
  NOTE_BACKUP_MAX_HISTORY_HINTS,
  snapshotBackupObject,
} from './noteBackupHistory.ts';
import {
  readPrivateNoteRestoreGuard,
  readPrivateNoteRestoreMetadata,
  privateNoteExportHistory,
} from './privateNoteRestore.ts';
import type {
  IPrivateNoteRestoreGuard,
  IPrivateNoteRestoreMetadata,
} from './privateNoteRestore.ts';
import {
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_FORMAT,
  PRIVATE_VAULT_VERSION,
  DEFAULT_CAPACITY,
  MAX_ARCHIVED_NOTES,
  MAX_VAULT_NOTES,
  PRIVATE_VAULT_ARCHIVE_BUDGET,
  PRIVATE_VAULT_MAX_BUNDLE_BYTES,
  capacityValid,
  capacityBudget,
  MAX_PLAINTEXT_BYTES,
  MAX_SHARD_BYTES,
  MAX_SHARD_NOTES,
  PRIVATE_VAULT_SHARD_DOMAIN,
  PROFILE,
  UUID,
  parsePrivateVaultBundle,
  snapshotPrivateVaultBundle,
} from './privateVaultEnvelope.ts';
import type { IClassicNoteIdentity } from '../utils/privacy/note.ts';
import type { PrivateVaultCapacity } from '../utils/privacy/privateVaultTypes.ts';
import type {
  IPrivacyWithdrawalJournal,
  IPrivacyWithdrawalRecovery,
  IPrivacyWithdrawalRecoveryReceipt,
  IPrivacyRetiredWithdrawal,
  IPrivacyUnsignedWithdrawal,
} from '../utils/privacy/withdrawalTransactionTypes.ts';
import type {
  KeyringManager,
  IEncryptedPrivateRecord,
} from '@sidhujag/sysweb3-keyring';

export {
  PRIVATE_VAULT_STORAGE_PREFIX,
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_FORMAT,
  PRIVATE_VAULT_VERSION,
  DEFAULT_CAPACITY,
  MAX_NOTES,
  MAX_ARCHIVED_NOTES,
  MAX_VAULT_NOTES,
  PRIVATE_VAULT_ARCHIVE_BUDGET,
  PRIVATE_VAULT_MAX_BUNDLE_BYTES,
  capacityValid,
  capacityBudget,
  MAX_PLAINTEXT_BYTES,
  MAX_SHARD_BYTES,
  MAX_SHARD_NOTES,
  PRIVATE_VAULT_SHARD_DOMAIN,
  PROFILE,
  UUID,
} from './privateVaultEnvelope.ts';

/** Canonical authenticated storage reader. No storage writes, provider calls or transaction execution. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
export type IPrivateVaultWithdrawalJournal = IPrivacyWithdrawalJournal;
export interface IPrivateVaultSession {
  assertCurrent: () => void;
  captureOperation(assertCurrent: () => void): IPrivateVaultSession;
  generation: number;
  keyring: Pick<
    KeyringManager,
    | 'getPrivateRecordProfileId'
    | 'encryptPrivateRecord'
    | 'decryptPrivateRecord'
  >;
}

/** Explicit session policy for hosts whose codec authority already has a stable lifetime. */
export function createPrivateVaultSession(
  input: Omit<IPrivateVaultSession, 'captureOperation'>
): IPrivateVaultSession {
  return Object.freeze({
    ...input,
    captureOperation(assertCurrent: () => void) {
      const check = () => {
        assertPrivateVaultSession(input, true);
        const result: unknown = assertCurrent();
        if (result !== undefined) {
          void Promise.resolve(result).catch(() => undefined);
          throw new Error('privacy_vault_session_changed');
        }
        assertPrivateVaultSession(input, true);
      };
      check();
      return createPrivateVaultSession({ ...input, assertCurrent: check });
    },
  });
}

export const assertPrivateVaultSession = (
  session: Pick<IPrivateVaultSession, 'assertCurrent'>,
  requireSynchronous: boolean
) => {
  const result: unknown = session.assertCurrent();
  if (!requireSynchronous || result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).catch(() => undefined);
  throw new Error('privacy_vault_session_changed');
};

export interface IPrivateVaultDepositJournal {
  attemptHash: string;
  createdAt: number;
  from: string;
  intentId: string;
  nonce: string;
  nonceResetGeneration?: number;
  phase: 'unknown' | 'submitted';
  transactionHash?: string;
}

/** Private authenticated read result; never return bearer notes through a public DTO. */
export interface IStoredNote {
  archivedAt?: number;
  createdAt: number;
  deposit?: IPrivateVaultDepositJournal;
  id: string;
  note: string;
  origin?: 'generated';
  restoreGuard?: IPrivateNoteRestoreGuard;
  withdrawal?: IPrivateVaultWithdrawalJournal;
}
export interface IManifest {
  notes: IStoredNote[];
  version: 1;
}
export interface IShardReference {
  archived?: true;
  count: number;
  hash: string;
  noteKeys?: string[];
  recordId: string;
}
export interface IPrivateVaultEncryptedArchive {
  count: number;
  shards: Array<{
    envelope: IEncryptedPrivateRecord;
    reference: IShardReference;
  }>;
}

export const privateVaultNoteKey = (identity: IClassicNoteIdentity): string =>
  keccak256(
    new TextEncoder().encode(
      JSON.stringify([identity.poolId, identity.commitment])
    )
  );

/** Charge the archive's authenticated index to its own byte quota. */
export function privateVaultArchiveIndexBytes(
  root: any,
  ciphertextLength?: number
): number {
  if (!root.archiveCount) return 0;
  const active = {
    ...root,
    shards: root.shards.filter(
      (reference: IShardReference) => !reference.archived
    ),
  };
  delete active.archiveCount;
  const encodedLength = (value: unknown) =>
    Math.ceil(
      (new TextEncoder().encode(JSON.stringify(value)).length + 16) / 3
    ) * 4;
  return Math.max(
    0,
    (ciphertextLength ?? encodedLength(root)) - encodedLength(active)
  );
}
export interface IVaultBundle {
  format: typeof PRIVATE_VAULT_FORMAT;
  root: IEncryptedPrivateRecord;
  shards: IEncryptedPrivateRecord[];
  version: typeof PRIVATE_VAULT_VERSION;
}

interface IReadContext {
  capacity: PrivateVaultCapacity;
  profileId: string;
  restore: IPrivateNoteRestoreMetadata;
  session: IPrivateVaultSession;
  storedBytes: number;
  strictSession?: boolean;
}

export const envelopeHash = (value: IEncryptedPrivateRecord): string =>
  keccak256(
    new TextEncoder().encode(
      JSON.stringify([
        value.version,
        value.domain,
        value.recordId,
        value.profileId,
        value.nonce,
        value.ciphertext,
      ])
    )
  );
export function journal(
  value: IPrivateVaultDepositJournal
): IPrivateVaultDepositJournal {
  snapshotBackupObject(value, [
    'intentId',
    'attemptHash',
    'createdAt',
    'from',
    'nonce',
    'nonceResetGeneration',
    'phase',
    'transactionHash',
  ]);
  if (
    !value ||
    typeof value.intentId !== 'string' ||
    !UUID.test(value.intentId) ||
    typeof value.attemptHash !== 'string' ||
    !HASH.test(value.attemptHash) ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    typeof value.from !== 'string' ||
    !ADDRESS.test(value.from) ||
    typeof value.nonce !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,19})$/.test(value.nonce) ||
    BigInt(value.nonce) >= BigInt(1) << BigInt(64) ||
    (value.nonceResetGeneration !== undefined &&
      (!Number.isSafeInteger(value.nonceResetGeneration) ||
        value.nonceResetGeneration <= 0)) ||
    !['unknown', 'submitted'].includes(value.phase) ||
    (value.phase === 'submitted'
      ? typeof value.transactionHash !== 'string' ||
        !HASH.test(value.transactionHash)
      : value.transactionHash !== undefined)
  )
    throw new Error('privacy_vault_corrupt');
  return {
    intentId: value.intentId,
    attemptHash: value.attemptHash,
    createdAt: value.createdAt,
    from: value.from.toLowerCase(),
    nonce: value.nonce,
    ...(value.nonceResetGeneration
      ? { nonceResetGeneration: value.nonceResetGeneration }
      : {}),
    phase: value.phase,
    ...(value.transactionHash
      ? { transactionHash: value.transactionHash }
      : {}),
  };
}

const WITHDRAWAL_JOURNAL_KEYS = [
  'attemptHash',
  'createdAt',
  'endpoint',
  'ensHash',
  'from',
  'inputHash',
  'intentId',
  'jobId',
  'mode',
  'nonce',
  'nonceResetGeneration',
  'phase',
  'proofHash',
  'publicInputs',
  'rootAnchor',
  'recovery',
  'retired',
  'transactionHash',
  'transactionHashes',
  'unsigned',
];
const MAX_RETIRED_WITHDRAWALS = NOTE_BACKUP_MAX_HISTORY_HINTS - 1;
function recoveryReceipt(value: IPrivacyWithdrawalRecoveryReceipt) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 + (value.kind === undefined ? 0 : 1) ||
    (value.kind !== undefined && value.kind !== 'relayed-proof-expired') ||
    Object.keys(value).some(
      (key) => !['root', 'blockNumber', 'blockHash', 'kind'].includes(key)
    ) ||
    typeof value.root !== 'string' ||
    !HASH.test(value.root) ||
    BigInt(value.root) >=
      BigInt(
        '21888242871839275222246405745257275088548364400416034343698204186575808495617'
      ) ||
    typeof value.blockHash !== 'string' ||
    !HASH.test(value.blockHash) ||
    typeof value.blockNumber !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,77})$/.test(value.blockNumber) ||
    BigInt(value.blockNumber) > UINT256_MAX
  )
    throw new Error('privacy_vault_corrupt');
  return {
    ...(value.kind ? { kind: value.kind } : {}),
    root: value.root,
    blockNumber: value.blockNumber,
    blockHash: value.blockHash,
  };
}
function withdrawalRecovery(value: IPrivacyWithdrawalRecovery) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 + (value.kind === undefined ? 0 : 1) ||
    Object.keys(value).some(
      (key) =>
        !['root', 'blockNumber', 'blockHash', 'recoveredAt', 'kind'].includes(
          key
        )
    ) ||
    !Number.isSafeInteger(value.recoveredAt) ||
    value.recoveredAt < 0 ||
    value.recoveredAt > 8_640_000_000_000_000
  )
    throw new Error('privacy_vault_corrupt');
  return {
    ...recoveryReceipt({
      ...(value.kind ? { kind: value.kind } : {}),
      root: value.root,
      blockNumber: value.blockNumber,
      blockHash: value.blockHash,
    }),
    recoveredAt: value.recoveredAt,
  };
}
export const JOB_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const validRelayEndpoint = (value: unknown) => {
  try {
    if (typeof value !== 'string' || value.length > 2048) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
};
/** Strict local dispatch evidence; the enclosing encrypted shard binds the wallet/profile. */
export function unsignedWithdrawal(
  value: IPrivacyUnsignedWithdrawal
): IPrivacyUnsignedWithdrawal {
  const context = value?.context,
    account = context?.account;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some(
      (key) => !['version', 'lifetime', 'context'].includes(key)
    ) ||
    value.version !== 1 ||
    typeof value.lifetime !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:0|[1-9][0-9]{0,15})$/.test(
      value.lifetime
    ) ||
    !Number.isSafeInteger(Number(value.lifetime.split(':')[1])) ||
    !context ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    Object.keys(context).length !== 4 ||
    Object.keys(context).some(
      (key) => !['account', 'chainId', 'rpcUrl', 'slip44'].includes(key)
    ) ||
    context.chainId !== 1 ||
    !Number.isSafeInteger(context.slip44) ||
    context.slip44 < 0 ||
    typeof context.rpcUrl !== 'string' ||
    !context.rpcUrl ||
    context.rpcUrl.length > 2048 ||
    !account ||
    typeof account !== 'object' ||
    Array.isArray(account) ||
    Object.keys(account).length !== 3 ||
    Object.keys(account).some(
      (key) => !['id', 'type', 'address'].includes(key)
    ) ||
    !Number.isSafeInteger(account.id) ||
    account.id < 0 ||
    typeof account.type !== 'string' ||
    !account.type ||
    account.type.length > 64 ||
    typeof account.address !== 'string' ||
    !ADDRESS.test(account.address)
  )
    throw new Error('privacy_vault_corrupt');
  return {
    version: 1,
    lifetime: value.lifetime,
    context: {
      chainId: context.chainId,
      slip44: context.slip44,
      rpcUrl: context.rpcUrl,
      account: {
        id: account.id,
        type: account.type,
        address: account.address.toLowerCase(),
      },
    },
  };
}

export function withdrawalJournal(
  value: IPrivateVaultWithdrawalJournal,
  isRetired = false
): IPrivateVaultWithdrawalJournal {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !WITHDRAWAL_JOURNAL_KEYS.includes(key)) ||
    (isRetired && value.retired !== undefined) ||
    (value.unsigned !== undefined &&
      (value.phase !== 'unknown' || value.recovery !== undefined)) ||
    typeof value.intentId !== 'string' ||
    !UUID.test(value.intentId) ||
    ![value.attemptHash, value.proofHash, value.inputHash].every(
      (hash) => typeof hash === 'string' && HASH.test(hash)
    ) ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !['direct', 'relayed'].includes(value.mode) ||
    (value.nonceResetGeneration !== undefined &&
      (value.mode !== 'direct' ||
        !Number.isSafeInteger(value.nonceResetGeneration) ||
        value.nonceResetGeneration <= 0)) ||
    !['unknown', 'submitted'].includes(value.phase) ||
    (value.mode === 'direct'
      ? typeof value.from !== 'string' ||
        !ADDRESS.test(value.from) ||
        typeof value.nonce !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,19})$/.test(value.nonce) ||
        BigInt(value.nonce) >= BigInt(1) << BigInt(64) ||
        value.jobId !== undefined ||
        value.endpoint !== undefined ||
        value.ensHash !== undefined
      : value.from !== undefined ||
        value.nonce !== undefined ||
        !validRelayEndpoint(value.endpoint) ||
        typeof value.ensHash !== 'string' ||
        !HASH.test(value.ensHash)) ||
    (value.transactionHash !== undefined &&
      (typeof value.transactionHash !== 'string' ||
        !HASH.test(value.transactionHash))) ||
    (value.jobId !== undefined &&
      (typeof value.jobId !== 'string' || !JOB_ID.test(value.jobId))) ||
    (value.phase === 'unknown'
      ? value.transactionHash !== undefined || value.jobId !== undefined
      : !value.transactionHash && !value.jobId) ||
    (value.recovery !== undefined &&
      (value.mode === 'direct'
        ? value.phase !== 'submitted' ||
          !value.transactionHash ||
          value.recovery.kind !== undefined
        : value.recovery.kind !== 'relayed-proof-expired' ||
          !value.publicInputs)) ||
    (value.transactionHashes !== undefined &&
      (value.mode !== 'relayed' ||
        value.phase !== 'submitted' ||
        !value.transactionHash ||
        !Array.isArray(value.transactionHashes) ||
        !value.transactionHashes.length ||
        value.transactionHashes.length > MAX_PRIVACY_RELAY_TRANSACTIONS ||
        value.transactionHashes[0] !== value.transactionHash ||
        !value.transactionHashes.every(
          (hash) => typeof hash === 'string' && HASH.test(hash)
        ) ||
        new Set(value.transactionHashes).size !==
          value.transactionHashes.length))
  )
    throw new Error('privacy_vault_corrupt');
  const recovery =
    value.recovery === undefined
      ? undefined
      : withdrawalRecovery(value.recovery);
  let publicInputs, rootAnchor;
  try {
    publicInputs =
      value.publicInputs === undefined
        ? undefined
        : captureWithdrawalPublicInputs(value.publicInputs, value.inputHash);
    if (value.rootAnchor !== undefined) {
      rootAnchor = captureWithdrawalRootAnchor(
        value.rootAnchor,
        publicInputs?.root
      );
    }
    if (
      publicInputs &&
      ((value.mode === 'direct' &&
        (publicInputs.relayer !== '0x' + '00'.repeat(20) ||
          publicInputs.fee !== '0')) ||
        (value.mode === 'relayed' &&
          publicInputs.relayer === '0x' + '00'.repeat(20)) ||
        (recovery && recovery.root !== publicInputs.root))
    )
      throw new Error();
  } catch {
    throw new Error('privacy_vault_corrupt');
  }
  let retired: IPrivacyRetiredWithdrawal[] | undefined;
  if (value.retired !== undefined) {
    if (
      !Array.isArray(value.retired) ||
      value.retired.length < 1 ||
      value.retired.length > MAX_RETIRED_WITHDRAWALS
    )
      throw new Error('privacy_vault_corrupt');
    const intents = new Set([value.intentId]),
      attempts = new Set([value.attemptHash]),
      transactions = new Set(
        value.transactionHash ? [value.transactionHash] : []
      );
    retired = value.retired.map((entry) => {
      const retiredEntry = withdrawalJournal(
        entry,
        true
      ) as IPrivacyRetiredWithdrawal;
      if (
        intents.has(retiredEntry.intentId) ||
        attempts.has(retiredEntry.attemptHash) ||
        (retiredEntry.transactionHash !== undefined &&
          transactions.has(retiredEntry.transactionHash))
      )
        throw new Error('privacy_vault_corrupt');
      intents.add(retiredEntry.intentId);
      attempts.add(retiredEntry.attemptHash);
      if (retiredEntry.transactionHash)
        transactions.add(retiredEntry.transactionHash);
      return retiredEntry;
    });
  }
  return {
    intentId: value.intentId,
    attemptHash: value.attemptHash,
    proofHash: value.proofHash,
    inputHash: value.inputHash,
    ...(publicInputs ? { publicInputs } : {}),
    ...(rootAnchor ? { rootAnchor } : {}),
    createdAt: value.createdAt,
    mode: value.mode,
    phase: value.phase,
    ...(value.mode === 'direct'
      ? { from: value.from!.toLowerCase(), nonce: value.nonce }
      : { endpoint: value.endpoint, ensHash: value.ensHash }),
    ...(value.nonceResetGeneration
      ? { nonceResetGeneration: value.nonceResetGeneration }
      : {}),
    ...(value.transactionHash
      ? { transactionHash: value.transactionHash }
      : {}),
    ...(value.jobId ? { jobId: value.jobId } : {}),
    ...(value.transactionHashes
      ? { transactionHashes: [...value.transactionHashes] }
      : {}),
    ...(recovery ? { recovery } : {}),
    ...(retired ? { retired } : {}),
    ...(value.unsigned ? { unsigned: unsignedWithdrawal(value.unsigned) } : {}),
  };
}

const PUBLIC_ERRORS = new Set([
  'BACKUP_AUTHENTICATION_FAILED',
  'privacy_note_invalid',
  'privacy_note_restore_required',
  'privacy_restore_invalid',
  'privacy_restore_stale',
  'privacy_note_limit',
  'privacy_archive_limit',
  'privacy_note_archived',
  'privacy_note_missing',
  'privacy_note_not_found',
  'privacy_vault_corrupt',
  'privacy_vault_unsupported_format',
  'privacy_vault_locked',
  'privacy_vault_session_changed',
  'privacy_vault_unavailable',
  'privacy_verification_pending',
  'privacy_deposit_attempt_exists',
  'privacy_deposit_attempt_invalid',
  'privacy_deposit_note_ineligible',
  'privacy_note_spent',
  'privacy_withdrawal_attempt_exists',
  'privacy_withdrawal_nonce_conflict',
  'privacy_withdrawal_attempt_invalid',
  'privacy_proof_cancelled',
  'privacy_proof_failed',
  'privacy_proof_busy',
  'privacy_proof_unavailable',
  'privacy_proof_artifact_invalid',
  'privacy_proof_verification_failed',
  'privacy_proof_invalid_input',
  'privacy_withdrawal_snapshot_invalid',
  'privacy_withdrawal_invalid',
]);

export const publicError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'BACKUP_INVALID_PAYLOAD')
    return new Error('privacy_restore_invalid');
  if (PUBLIC_ERRORS.has(message)) return new Error(message);
  if (message === 'Private record session changed')
    return new Error('privacy_vault_session_changed');
  if (
    message === 'Invalid password' ||
    /^Too many failed attempts\. Please wait \d+ seconds before trying again\.$/.test(
      message
    )
  )
    return new Error(message);
  return new Error('privacy_vault_unavailable');
};

/** Local-only custody. No plaintext manifest is retained between operations. */

const checked = async <T>(
  context: IReadContext,
  value: Promise<T>
): Promise<T> => {
  const result = await value;
  try {
    assertPrivateVaultSession(context.session, context.strictSession === true);
  } catch (error) {
    if (result instanceof Uint8Array) result.fill(0);
    throw error;
  }
  return result;
};

export const checkEnvelope = (
  context: IReadContext,
  value: IEncryptedPrivateRecord,
  domain: string,
  limit: number
) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 6 ||
    value.version !== 1 ||
    value.domain !== domain ||
    value.profileId !== context.profileId ||
    typeof value.recordId !== 'string' ||
    !UUID.test(value.recordId) ||
    typeof value.nonce !== 'string' ||
    value.nonce.length !== 16 ||
    typeof value.ciphertext !== 'string' ||
    value.ciphertext.length > Math.ceil((limit + 16) / 3) * 4
  )
    throw new Error('privacy_vault_corrupt');
};

const decrypt = async (
  context: IReadContext,
  envelope: IEncryptedPrivateRecord,
  domain: string,
  limit: number
): Promise<any> => {
  checkEnvelope(context, envelope, domain, limit);
  let plaintext: Uint8Array;
  try {
    plaintext = await checked(
      context,
      context.session.keyring.decryptPrivateRecord({
        domain,
        recordId: envelope.recordId,
        envelope,
      })
    );
  } catch (error) {
    throw publicError(error);
  }
  try {
    if (!(plaintext instanceof Uint8Array) || plaintext.length > limit)
      throw new Error('privacy_vault_corrupt');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
    );
  } finally {
    plaintext.fill(0);
  }
};

export async function readPrivateVaultBundle(
  value: unknown,
  session: IPrivateVaultSession,
  identify: typeof identifyClassicNote = identifyClassicNote,
  encoding: 'object' | 'serialized' = 'object',
  identities?: WeakMap<IStoredNote, IClassicNoteIdentity>,
  yieldInventory?: () => Promise<void>,
  includeArchive = true
): Promise<
  Readonly<{
    archive: IPrivateVaultEncryptedArchive;
    archiveStoredBytes: number;
    capacity: PrivateVaultCapacity;
    manifest: IManifest;
    recordId?: string;
    restore: IPrivateNoteRestoreMetadata;
    storedBytes: number;
  }>
> {
  let stored: IVaultBundle | null | undefined;
  try {
    stored =
      value === null
        ? null
        : value === undefined
        ? undefined
        : encoding === 'serialized'
        ? parsePrivateVaultBundle(value)
        : snapshotPrivateVaultBundle(value);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'privacy_vault_unsupported_format'
    )
      throw error;
    throw new Error('privacy_vault_corrupt');
  }
  const base = session;
  session = base.captureOperation(() => assertPrivateVaultSession(base, true));
  const strictSession = encoding === 'serialized';
  assertPrivateVaultSession(session, strictSession);
  const profileId = await session.keyring.getPrivateRecordProfileId();
  assertPrivateVaultSession(session, strictSession);
  if (typeof profileId !== 'string' || !PROFILE.test(profileId))
    throw new Error('privacy_vault_unavailable');
  if (
    stored !== null &&
    stored !== undefined &&
    stored.root.profileId !== profileId
  )
    throw new Error('privacy_vault_corrupt');
  const context: IReadContext = {
    session,
    profileId,
    capacity: DEFAULT_CAPACITY,
    storedBytes: 0,
    restore: { version: 1 },
    strictSession,
  };
  context.capacity = DEFAULT_CAPACITY;
  context.storedBytes = 0;
  context.restore = { version: 1 };
  if (stored === null || stored === undefined)
    return {
      manifest: { version: 1, notes: [] },
      archiveStoredBytes: 0,
      archive: { count: 0, shards: [] },
      capacity: context.capacity,
      restore: context.restore,
      storedBytes: 0,
    };
  try {
    const serialized = new TextEncoder().encode(JSON.stringify(stored));
    context.storedBytes = serialized.length;
    serialized.fill(0);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored))
      throw new Error('privacy_vault_corrupt');
    // Older single-envelope layouts are not inferred as this bundle. Only
    // the explicit guard-free root compatibility case below is readable.
    if (
      stored.format !== PRIVATE_VAULT_FORMAT ||
      stored.version !== PRIVATE_VAULT_VERSION
    )
      throw new Error('privacy_vault_unsupported_format');
    const bundle = stored as IVaultBundle;
    if (
      Object.keys(bundle).length !== 4 ||
      !Array.isArray(bundle.shards) ||
      bundle.shards.length < 1 ||
      bundle.shards.length > MAX_VAULT_NOTES
    )
      throw new Error('privacy_vault_corrupt');
    checkEnvelope(
      context,
      bundle.root,
      PRIVATE_VAULT_DOMAIN,
      MAX_PLAINTEXT_BYTES
    );
    for (const shard of bundle.shards)
      checkEnvelope(
        context,
        shard,
        PRIVATE_VAULT_SHARD_DOMAIN,
        MAX_SHARD_BYTES
      );
    if (context.storedBytes > PRIVATE_VAULT_MAX_BUNDLE_BYTES)
      throw new Error('privacy_vault_corrupt');
    const root: any = await decrypt(
      context,
      bundle.root,
      PRIVATE_VAULT_DOMAIN,
      MAX_PLAINTEXT_BYTES
    );
    if (
      !root ||
      typeof root !== 'object' ||
      Array.isArray(root) ||
      root.format !== PRIVATE_VAULT_FORMAT ||
      root.version !== PRIVATE_VAULT_VERSION ||
      ![5, 6, 7].includes(Object.keys(root).length) ||
      (Object.keys(root).length === 5 &&
        Object.prototype.hasOwnProperty.call(root, 'restore')) ||
      (Object.keys(root).length === 6 &&
        !Object.prototype.hasOwnProperty.call(root, 'restore')) ||
      !capacityValid(root.capacity) ||
      !Number.isInteger(root.noteCount) ||
      root.noteCount < 0 ||
      root.noteCount > root.capacity ||
      (root.archiveCount !== undefined &&
        (!Number.isInteger(root.archiveCount) ||
          root.archiveCount < 1 ||
          root.archiveCount > MAX_ARCHIVED_NOTES ||
          !Object.prototype.hasOwnProperty.call(root, 'restore'))) ||
      Object.keys(root).some(
        (key) =>
          ![
            'format',
            'version',
            'noteCount',
            'capacity',
            'shards',
            'restore',
            'archiveCount',
          ].includes(key)
      ) ||
      !Array.isArray(root.shards) ||
      root.shards.length !== bundle.shards.length ||
      root.shards.length >
        Math.max(1, root.noteCount + (root.archiveCount ?? 0))
    )
      throw new Error('privacy_vault_corrupt');
    // The only compatibility reader is the guard-free pre-release root.
    // Every writer emits the required sixth field, which older readers reject.
    const legacyRoot = Object.keys(root).length === 5;
    context.restore = legacyRoot
      ? { version: 1 }
      : readPrivateNoteRestoreMetadata(root.restore);
    context.capacity = root.capacity;
    const recordIds = new Set([bundle.root.recordId]);
    const storedNotes: IStoredNote[] = [];
    let archiveStoredBytes = privateVaultArchiveIndexBytes(
      root,
      bundle.root.ciphertext.length
    );
    let archiveCount = 0;
    const archive: IPrivateVaultEncryptedArchive = {
      count: root.archiveCount ?? 0,
      shards: [],
    };
    const archivedKeys = new Set<string>();
    const expectedArchiveKeys = new Map<string, readonly string[]>();
    for (const [index, envelope] of bundle.shards.entries()) {
      const reference: IShardReference = root.shards[index];
      if (
        !reference ||
        typeof reference !== 'object' ||
        Array.isArray(reference) ||
        Object.keys(reference).length !==
          (reference.archived === true ? 5 : 3) ||
        (reference.archived !== undefined && reference.archived !== true) ||
        reference.recordId !== envelope.recordId ||
        recordIds.has(reference.recordId) ||
        !Number.isInteger(reference.count) ||
        reference.count <
          (root.noteCount + (root.archiveCount ?? 0) === 0 ? 0 : 1) ||
        reference.count > MAX_SHARD_NOTES ||
        reference.hash !== envelopeHash(envelope)
      )
        throw new Error('privacy_vault_corrupt');
      recordIds.add(reference.recordId);
      if (reference.archived) {
        if (
          !Array.isArray(reference.noteKeys) ||
          reference.noteKeys.length !== reference.count ||
          reference.noteKeys.some(
            (key) =>
              typeof key !== 'string' ||
              !HASH.test(key) ||
              archivedKeys.has(key)
          )
        )
          throw new Error('privacy_vault_corrupt');
        for (const key of reference.noteKeys) {
          if (archivedKeys.has(key)) throw new Error('privacy_vault_corrupt');
          archivedKeys.add(key);
        }
        archiveCount += reference.count;
        archiveStoredBytes +=
          new TextEncoder().encode(JSON.stringify(envelope)).length + 1;
        archive.shards.push({ envelope, reference });
      }
    }
    if (
      archiveCount !== (root.archiveCount ?? 0) ||
      archiveStoredBytes > PRIVATE_VAULT_ARCHIVE_BUDGET ||
      context.storedBytes - archiveStoredBytes >
        capacityBudget(context.capacity)
    )
      throw new Error('privacy_vault_corrupt');
    // Admit the authenticated layout and both byte quotas before decrypting
    // shards, including when an oversized active tier has an archive attached.
    for (const [index, envelope] of bundle.shards.entries()) {
      const reference: IShardReference = root.shards[index];
      if (reference.archived && !includeArchive) continue;
      const shard = await decrypt(
        context,
        envelope,
        PRIVATE_VAULT_SHARD_DOMAIN,
        MAX_SHARD_BYTES
      );
      if (
        !shard ||
        typeof shard !== 'object' ||
        Array.isArray(shard) ||
        shard.version !== 1 ||
        Object.keys(shard).length !== 2 ||
        !Array.isArray(shard.notes) ||
        shard.notes.length !== reference.count
      )
        throw new Error('privacy_vault_corrupt');
      if (
        shard.notes.some(
          (entry: any) =>
            (entry?.archivedAt !== undefined) !== (reference.archived === true)
        )
      )
        throw new Error('privacy_vault_corrupt');
      if (reference.archived)
        for (const entry of shard.notes)
          expectedArchiveKeys.set(entry.id, reference.noteKeys!);
      storedNotes.push(...shard.notes);
      if (storedNotes.length > MAX_VAULT_NOTES)
        throw new Error('privacy_vault_corrupt');
    }
    if (
      storedNotes.length !==
      root.noteCount + (includeArchive ? root.archiveCount ?? 0 : 0)
    )
      throw new Error('privacy_vault_corrupt');
    const data: IManifest = { version: 1, notes: storedNotes };
    const recordId = bundle.root.recordId;
    const ids = new Set<string>();
    const commitments = new Set<string>();
    const notes: IStoredNote[] = [];
    for (const entry of data.notes) {
      snapshotBackupObject(entry, [
        'id',
        'createdAt',
        'note',
        'origin',
        'deposit',
        'withdrawal',
        'restoreGuard',
        'archivedAt',
      ]);
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        entry.id.length !== 36 ||
        !UUID.test(entry.id) ||
        ids.has(entry.id) ||
        !Number.isSafeInteger(entry.createdAt) ||
        entry.createdAt < 0 ||
        entry.createdAt > 8_640_000_000_000_000 ||
        typeof entry.note !== 'string' ||
        entry.note.length > 256 ||
        entry.note !== entry.note.trim().toLowerCase() ||
        (entry.origin !== undefined && entry.origin !== 'generated') ||
        (entry.archivedAt !== undefined &&
          (!Number.isSafeInteger(entry.archivedAt) ||
            entry.archivedAt < 0 ||
            entry.archivedAt > 8_640_000_000_000_000)) ||
        (legacyRoot &&
          Object.prototype.hasOwnProperty.call(entry, 'restoreGuard'))
      )
        throw new Error('privacy_vault_corrupt');
      const restoreGuard =
        entry.restoreGuard === undefined
          ? undefined
          : readPrivateNoteRestoreGuard(entry.restoreGuard);
      const identity = identify(entry.note);
      const deposit =
        entry.deposit === undefined ? undefined : journal(entry.deposit);
      const withdrawal =
        entry.withdrawal === undefined
          ? undefined
          : withdrawalJournal(entry.withdrawal);
      if (
        withdrawal &&
        [withdrawal, ...(withdrawal.retired ?? [])].some(
          (attempt) =>
            attempt.publicInputs &&
            attempt.publicInputs.nullifierHash !== identity.nullifierHash
        )
      )
        throw new Error('privacy_vault_corrupt');
      if (deposit && entry.origin !== 'generated')
        throw new Error('privacy_vault_corrupt');
      const key = `${identity.poolId}:${identity.commitment}`;
      const noteKey = privateVaultNoteKey(identity);
      if (
        entry.archivedAt === undefined
          ? archivedKeys.has(noteKey)
          : !expectedArchiveKeys.get(entry.id)?.includes(noteKey)
      )
        throw new Error('privacy_vault_corrupt');
      if (commitments.has(key)) throw new Error('privacy_vault_corrupt');
      commitments.add(key);
      ids.add(entry.id);
      const note: IStoredNote = {
        id: entry.id,
        note: entry.note,
        createdAt: entry.createdAt,
        ...(entry.archivedAt === undefined
          ? {}
          : { archivedAt: entry.archivedAt }),
        ...(entry.origin === 'generated' ? { origin: entry.origin } : {}),
        ...(deposit ? { deposit } : {}),
        ...(withdrawal ? { withdrawal } : {}),
        ...(restoreGuard ? { restoreGuard } : {}),
      };
      identities?.set(note, { ...identity });
      notes.push(note);
      if (
        yieldInventory &&
        notes.length % 4 === 0 &&
        notes.length < data.notes.length
      ) {
        // Keep the same validation and owner across an opt-in foreground yield.
        try {
          assertPrivateVaultSession(session, strictSession);
          await yieldInventory();
          assertPrivateVaultSession(session, strictSession);
        } catch (error) {
          throw publicError(error);
        }
      }
    }
    for (const note of notes) privateNoteExportHistory(note);
    return {
      manifest: { version: 1, notes },
      archiveStoredBytes,
      archive,
      recordId,
      capacity: context.capacity,
      restore: context.restore,
      storedBytes: context.storedBytes,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'privacy_vault_session_changed',
        'privacy_vault_unavailable',
        'privacy_vault_unsupported_format',
        'Private record session changed',
      ].includes(error.message)
    )
      throw error;
    throw new Error('privacy_vault_corrupt');
  }
}
