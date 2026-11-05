export {
  PRIVATE_VAULT_STORAGE_PREFIX,
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_FORMAT,
} from './privateVaultInspection.ts';
export type {
  IPrivateVaultSession,
  IPrivateVaultDepositJournal,
} from './privateVaultInspection.ts';

import { AbiCoder, Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import { parseEther, toUtf8Bytes } from 'ethers/utils';

import { getPrivacyPool } from '../utils/privacy/registry.ts';

import {
  planPrivateNoteRestore,
  hasImportedWithdrawalHistory,
  privateNoteRestoreDigest,
  privateNoteExportHistory,
  readPrivateNoteRestoreGuard,
  readPrivateNoteRestoreMetadata,
  restoredNoteBlocksWithdrawal,
  snapshotPrivateNoteRestoreEntries,
} from './privateNoteRestore.ts';
import type {
  IPrivateNoteRestoreEntry,
  IPrivateNoteRestoreMetadata,
  IPrivateNoteRestoreReceipt,
} from './privateNoteRestore.ts';
import {
  PRIVATE_VAULT_STORAGE_PREFIX,
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_FORMAT,
  PRIVATE_VAULT_VERSION,
  DEFAULT_CAPACITY,
  capacityValid,
  capacityBudget,
  MAX_PLAINTEXT_BYTES,
  MAX_SHARD_BYTES,
  MAX_SHARD_NOTES,
  PRIVATE_VAULT_SHARD_DOMAIN,
  PROFILE,
  UUID,
  assertPrivateVaultSession,
  envelopeHash,
  recoveryReceipt,
  withdrawalJournal,
  checkEnvelope,
  readPrivateVaultBundle,
  JOB_ID,
  publicError,
  withdrawalRecovery,
} from './privateVaultInspection.ts';
import type {
  IPrivateVaultSession,
  IPrivateVaultDepositJournal,
  IStoredNote,
  IManifest,
  IShardReference,
  IVaultBundle,
} from './privateVaultInspection.ts';
import type {
  generateClassicNote,
  identifyClassicNote,
  IClassicNoteIdentity,
} from '../utils/privacy/note';
import type {
  IPrivacyNoteReader,
  IPrivateNoteStatus,
  IPrivateNoteView,
  IPrivateVaultController,
  PrivateVaultCapacity,
} from '../utils/privacy/privateVaultTypes';
import type { IPrivacyDepositAttempt } from '../utils/privacy/transactionTypes';
import type { PrivacyPoolId } from '../utils/privacy/types';
import type {
  IPrivacyWithdrawalAcknowledgement,
  IPrivacyWithdrawalAttempt,
  IPrivacyWithdrawalJournal,
  IPrivacyWithdrawalRecovery,
  IPrivacyWithdrawalRecoveryReceipt,
  IPrivacyRetiredWithdrawal,
  IPrivacyWithdrawalStatusRecord,
} from '../utils/privacy/withdrawalTransactionTypes';
import type { IEncryptedPrivateRecord } from '@sidhujag/sysweb3-keyring';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DEPOSIT_ABI = new Interface([
  'function deposit(bytes32 commitment) payable',
]);
const WITHDRAWAL_ABI = new Interface([
  'function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund)',
]);
const HASH = /^0x[0-9a-f]{64}$/;
const restoreEpochs = new WeakMap<IPrivateVaultMutex, Map<string, object>>();
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
export interface IPrivateVaultDepositController {
  clearUnbroadcastDepositAttempt: (
    attempt: IPrivacyDepositAttempt,
    session: IPrivateVaultSession
  ) => Promise<void>;
  getDepositAttempt: (
    noteId: string,
    session: IPrivateVaultSession
  ) => Promise<IPrivateVaultDepositJournal | null>;
  prepareDepositNote: (
    poolId: PrivacyPoolId,
    noteId: string | undefined,
    session: IPrivateVaultSession
  ) => Promise<{ id: string; poolId: PrivacyPoolId }>;
  recordDepositBroadcast: (
    attempt: IPrivacyDepositAttempt,
    transactionHash: string,
    session: IPrivateVaultSession
  ) => Promise<void>;
  reserveDepositAttempt: (
    attempt: IPrivacyDepositAttempt,
    session: IPrivateVaultSession,
    onRestoreFence?: (assertRestoreCurrent: () => void) => void
  ) => Promise<void>;
  withDepositCommitment: <T>(
    noteId: string,
    session: IPrivateVaultSession,
    use: (commitment: string) => T
  ) => Promise<T>;
}

export type IPrivateVaultWithdrawalJournal = IPrivacyWithdrawalJournal;

/** Background-only custody capabilities. Never project these into the message API. */
export interface IPrivateVaultWithdrawalController {
  clearKnownUnbroadcastWithdrawal: (
    noteId: string,
    intentId: string,
    attemptHash: string,
    profileId: string,
    session: IPrivateVaultSession,
    assertCurrent: () => void
  ) => Promise<void>;
  clearUnbroadcastWithdrawalAttempt: (
    attempt: IPrivacyWithdrawalAttempt,
    session: IPrivateVaultSession
  ) => Promise<void>;
  getWithdrawalAttempt: (
    noteId: string,
    session: IPrivateVaultSession
  ) => Promise<IPrivacyWithdrawalStatusRecord | null>;
  recordWithdrawalJobStatus: (
    noteId: string,
    attemptHash: string,
    acknowledgement: { jobId: string; transactionHash?: string },
    session: IPrivateVaultSession
  ) => Promise<void>;
  recordWithdrawalSubmission: (
    attempt: IPrivacyWithdrawalAttempt,
    acknowledgement: IPrivacyWithdrawalAcknowledgement,
    session: IPrivateVaultSession
  ) => Promise<void>;
  reserveWithdrawalAttempt: (
    attempt: IPrivacyWithdrawalAttempt,
    session: IPrivateVaultSession,
    onIdentity?: (identity: {
      assertRestoreCurrent: () => void;
      attemptHash: string;
      profileId: string;
    }) => void
  ) => Promise<void>;
  withWithdrawalNote: <T>(
    noteId: string,
    session: IPrivateVaultSession,
    use: (note: string, poolId: PrivacyPoolId) => Promise<T> | T
  ) => Promise<T>;
}

/** Opaque admission summary. Its identity, not its fields, authorizes a commit. */
export interface IPrivateVaultRestorePlan {
  readonly added: number;
  readonly duplicates: number;
  readonly guarded: number;
  readonly id: string;
}
/** Internal custody only: deliberately absent from the message-facing API. */
export interface IPrivateVaultRestoreController {
  cancelRestore: (plan: IPrivateVaultRestorePlan) => void;
  commitRestore: (
    plan: IPrivateVaultRestorePlan,
    entries: readonly IPrivateNoteRestoreEntry[],
    password: string,
    session: IPrivateVaultSession
  ) => Promise<IPrivateNoteRestoreReceipt>;
  exportBackupSnapshot: (
    password: string,
    session: IPrivateVaultSession
  ) => Promise<{
    createdAt: number;
    format: 'pali-private-notes';
    notes: IPrivateNoteRestoreEntry[];
    version: 1;
  }>;
  getRestoreReceipt: (
    session: IPrivateVaultSession
  ) => Promise<IPrivateNoteRestoreReceipt | null>;
  prepareRestore: (
    entries: readonly IPrivateNoteRestoreEntry[],
    session: IPrivateVaultSession
  ) => Promise<IPrivateVaultRestorePlan>;
}

export interface IPrivateVaultHost {
  authenticate: (
    password: string,
    session: IPrivateVaultSession,
    reveal: () => Promise<string>
  ) => Promise<string>;
  captureSession: () => IPrivateVaultSession;
  // Background-only callback. It receives public identity and journal metadata,
  // never the raw bearer note. The host must bind its bounded RPC to session.
  prepareCompletionProof?: (
    identity: IClassicNoteIdentity,
    withdrawal: IPrivacyWithdrawalJournal,
    deposit: IPrivateVaultDepositJournal | undefined,
    session: IPrivateVaultSession
  ) => Promise<{ revalidate: () => Promise<void> }>;
  /** Explicit authenticated recovery only; never disclose bearer-note material. */
  prepareWithdrawalRecovery?: (
    identity: IClassicNoteIdentity,
    withdrawal: IPrivacyWithdrawalJournal,
    session: IPrivateVaultSession
  ) => Promise<{
    receipt: IPrivacyWithdrawalRecoveryReceipt;
    revalidate: () => Promise<void>;
  }>;
  readNote: IPrivacyNoteReader;
}

interface IContext {
  capacity: PrivateVaultCapacity;
  profileId: string;
  restore: IPrivateNoteRestoreMetadata;
  session: IPrivateVaultSession;
  storedBytes: number;
}

interface IWriteBasis {
  rawBundle: string | undefined;
  recordId?: string;
}

/** Exact fixed-format size planning; no encryption, storage, or random IDs. */
function planVaultLayout(
  notes: IStoredNote[],
  capacity: PrivateVaultCapacity,
  profileId: string,
  restore: IPrivateNoteRestoreMetadata
): IStoredNote[][] {
  if (notes.length > capacity) throw new Error('privacy_note_limit');
  const bytes = (value: unknown) => {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const length = encoded.length;
    encoded.fill(0);
    return length;
  };
  const groups: IStoredNote[][] = [];
  let current: IStoredNote[] = [];
  for (const note of notes) {
    const single = bytes({ version: 1, notes: [note] });
    if (single > MAX_SHARD_BYTES) throw new Error('privacy_note_limit');
    const candidate = [...current, note];
    if (
      current.length &&
      (candidate.length > MAX_SHARD_NOTES ||
        bytes({ version: 1, notes: candidate }) > MAX_SHARD_BYTES)
    ) {
      groups.push(current);
      current = [note];
    } else current = candidate;
  }
  if (current.length || !groups.length) groups.push(current);
  const placeholderId = '00000000-0000-4000-8000-000000000000';
  const rootBytes = bytes({
    format: PRIVATE_VAULT_FORMAT,
    version: PRIVATE_VAULT_VERSION,
    noteCount: notes.length,
    capacity,
    shards: groups.map((group) => ({
      recordId: placeholderId,
      hash: '0x' + '0'.repeat(64),
      count: group.length,
    })),
    restore,
  });
  if (rootBytes > MAX_PLAINTEXT_BYTES) throw new Error('privacy_note_limit');
  // AES-GCM appends exactly sixteen bytes, encoded as canonical base64. IDs,
  // nonce and hash strings have fixed ASCII lengths in the accepted envelope.
  const envelopeBytes = (domain: string, plaintextBytes: number) =>
    bytes({
      version: 1,
      domain,
      recordId: placeholderId,
      profileId,
      nonce: '0'.repeat(16),
      ciphertext: '',
    }) +
    Math.ceil((plaintextBytes + 16) / 3) * 4;
  const size =
    bytes({
      format: PRIVATE_VAULT_FORMAT,
      version: PRIVATE_VAULT_VERSION,
      root: null,
      shards: [],
    }) -
    4 +
    envelopeBytes(PRIVATE_VAULT_DOMAIN, rootBytes) +
    groups.reduce(
      (sum, group) =>
        sum +
        envelopeBytes(
          PRIVATE_VAULT_SHARD_DOMAIN,
          bytes({ version: 1, notes: group })
        ),
      0
    ) +
    groups.length -
    1;
  if (size > capacityBudget(capacity)) throw new Error('privacy_note_limit');
  return groups;
}

/** Raw records remain untrusted until the engine validates their schema. */
export interface IPrivateVaultStorage {
  // This capability selects serialized bundle reads and exact guarded writes.
  // A refused or uncertain write must never fall back to setItem or retry.
  compareAndSet?: (
    key: string,
    expected: string | undefined,
    next: string,
    assertCurrent: () => void
  ) => Promise<boolean>;
  // Only null/undefined mean absence. Preserve malformed present values for
  // validation, and reject on storage errors rather than returning absence.
  getItem: (key: string) => Promise<unknown>;
  // Resolve only after the host acknowledges the complete record write.
  setItem?: (key: string, value: unknown) => Promise<void>;
}

/** Hosts sharing a vault must also share its serialization boundary. */
export interface IPrivateVaultMutex {
  runExclusive: <T>(callback: () => T | Promise<T>) => Promise<T>;
}

/** No host defaults: the embedding wallet supplies every environment port. */
export interface IPrivateVaultDependencies {
  // Millisecond clock used for elapsed operation deadlines, not record dates.
  deadlineNow: () => number;
  generate: typeof generateClassicNote;
  identify: typeof identifyClassicNote;
  mutex: IPrivateVaultMutex;
  // Millisecond clock used for persisted record timestamps.
  now: () => number;
  randomId: () => string;
  storage: IPrivateVaultStorage;
  // Optional host task yield during inventory reads, outside signing or writes.
  yieldInventory?: () => Promise<void>;
}

function uint(value: unknown, positive = false): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(value)
  )
    throw new Error('privacy_deposit_attempt_invalid');
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX || (positive && parsed === BigInt(0)))
    throw new Error('privacy_deposit_attempt_invalid');
  return parsed;
}

function depositJournal(
  attempt: IPrivacyDepositAttempt,
  note: IStoredNote,
  identity: IClassicNoteIdentity
): IPrivateVaultDepositJournal {
  const context = attempt?.context;
  const tx = attempt?.transaction;
  const pool = getPrivacyPool(identity.poolId);
  if (
    !attempt ||
    typeof attempt.intentId !== 'string' ||
    !UUID.test(attempt.intentId) ||
    attempt.noteId !== note.id ||
    attempt.poolId !== identity.poolId ||
    !Number.isSafeInteger(attempt.createdAt) ||
    attempt.createdAt < 0 ||
    !Number.isSafeInteger(attempt.expiresAt) ||
    attempt.expiresAt <= attempt.createdAt ||
    !context ||
    context.chainId !== 1 ||
    !Number.isSafeInteger(context.sessionGeneration) ||
    context.sessionGeneration! < 0 ||
    !Number.isSafeInteger(context.slip44) ||
    context.slip44 < 0 ||
    typeof context.rpcUrl !== 'string' ||
    !context.rpcUrl ||
    context.rpcUrl.length > 2048 ||
    !context.account ||
    !Number.isSafeInteger(context.account.id) ||
    context.account.id < 0 ||
    typeof context.account.type !== 'string' ||
    typeof context.account.address !== 'string' ||
    !ADDRESS.test(context.account.address) ||
    !tx ||
    tx.chainId !== 1 ||
    typeof tx.from !== 'string' ||
    tx.from.toLowerCase() !== context.account.address.toLowerCase() ||
    typeof tx.to !== 'string' ||
    tx.to.toLowerCase() !== pool.address ||
    tx.data !==
      DEPOSIT_ABI.encodeFunctionData('deposit', [identity.commitment]) ||
    uint(tx.value) !== parseEther(pool.amount) ||
    Object.keys(tx).some(
      (key) =>
        ![
          'chainId',
          'from',
          'to',
          'value',
          'data',
          'gasLimit',
          'nonce',
          'gasPrice',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
        ].includes(key)
    )
  )
    throw new Error('privacy_deposit_attempt_invalid');
  const nonce = uint(tx.nonce);
  if (nonce >= BigInt(1) << BigInt(64))
    throw new Error('privacy_deposit_attempt_invalid');
  const fees: Record<string, string> = {
    gasLimit: String(uint(tx.gasLimit, true)),
    nonce: String(nonce),
  };
  if (tx.gasPrice !== undefined) {
    if (tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined)
      throw new Error('privacy_deposit_attempt_invalid');
    fees.gasPrice = String(uint(tx.gasPrice, true));
  } else {
    const max = uint(tx.maxFeePerGas, true),
      priority = uint(tx.maxPriorityFeePerGas);
    if (priority > max) throw new Error('privacy_deposit_attempt_invalid');
    fees.maxFeePerGas = String(max);
    fees.maxPriorityFeePerGas = String(priority);
  }
  const normalized = {
    intentId: attempt.intentId,
    noteId: note.id,
    poolId: identity.poolId,
    createdAt: attempt.createdAt,
    expiresAt: attempt.expiresAt,
    context: {
      chainId: 1,
      rpcUrl: context.rpcUrl,
      slip44: context.slip44,
      sessionGeneration: context.sessionGeneration,
      account: {
        id: context.account.id,
        type: context.account.type,
        address: context.account.address.toLowerCase(),
      },
    },
    transaction: {
      chainId: 1,
      from: tx.from.toLowerCase(),
      to: pool.address,
      data: tx.data,
      value: String(uint(tx.value)),
      ...fees,
    },
  };
  return {
    intentId: attempt.intentId,
    createdAt: attempt.createdAt,
    from: tx.from.toLowerCase(),
    nonce: String(nonce),
    phase: 'unknown',
    attemptHash: keccak256(toUtf8Bytes(JSON.stringify(normalized))),
  };
}

// An undisclosed new attempt may be removed, but recovered history must survive.
function clearUnbroadcastJournal(note: IStoredNote): IStoredNote {
  const retired = note.withdrawal?.retired;
  const cleared = { ...note };
  if (retired?.length) {
    cleared.withdrawal = withdrawalJournal({
      ...retired[retired.length - 1]!,
      ...(retired.length > 1 ? { retired: retired.slice(0, -1) } : {}),
    });
  } else delete cleared.withdrawal;
  return cleared;
}

function retireWithdrawal(withdrawal: IPrivacyWithdrawalJournal) {
  const retired = { ...withdrawal };
  delete retired.retired;
  return retired as IPrivacyRetiredWithdrawal;
}

function createWithdrawalJournal(
  attempt: IPrivacyWithdrawalAttempt,
  note: IStoredNote,
  identity: IClassicNoteIdentity
): IPrivateVaultWithdrawalJournal {
  try {
    const context = attempt?.context;
    const pool = getPrivacyPool(identity.poolId);
    const baseKeys = [
      'context',
      'createdAt',
      'expiresAt',
      'fee',
      'intentId',
      'noteId',
      'nullifierHash',
      'poolId',
      'proof',
      'recipient',
      'refund',
      'relayer',
      'root',
      'mode',
    ];
    const keys =
      attempt?.mode === 'direct'
        ? [...baseKeys, 'transaction']
        : [...baseKeys, 'endpoint', 'ensHash', 'rewardAccount'];
    if (
      !attempt ||
      Object.keys(attempt).some((key) => !keys.includes(key)) ||
      typeof attempt.intentId !== 'string' ||
      !UUID.test(attempt.intentId) ||
      attempt.noteId !== note.id ||
      attempt.poolId !== identity.poolId ||
      !Number.isSafeInteger(attempt.createdAt) ||
      attempt.createdAt < 0 ||
      !Number.isSafeInteger(attempt.expiresAt) ||
      attempt.expiresAt <= attempt.createdAt ||
      !context ||
      context.chainId !== 1 ||
      !Number.isSafeInteger(context.sessionGeneration) ||
      context.sessionGeneration! < 0 ||
      !Number.isSafeInteger(context.slip44) ||
      context.slip44 < 0 ||
      typeof context.rpcUrl !== 'string' ||
      !context.rpcUrl ||
      context.rpcUrl.length > 2048 ||
      !context.account ||
      !Number.isSafeInteger(context.account.id) ||
      context.account.id < 0 ||
      typeof context.account.type !== 'string' ||
      !context.account.type ||
      typeof context.account.address !== 'string' ||
      !ADDRESS.test(context.account.address) ||
      typeof attempt.proof !== 'string' ||
      !/^0x[0-9a-f]{512}$/.test(attempt.proof) ||
      typeof attempt.root !== 'string' ||
      !HASH.test(attempt.root) ||
      BigInt(attempt.root) >=
        BigInt(
          '21888242871839275222246405745257275088548364400416034343698204186575808495617'
        ) ||
      attempt.nullifierHash !== identity.nullifierHash ||
      typeof attempt.recipient !== 'string' ||
      !ADDRESS.test(attempt.recipient) ||
      BigInt(attempt.recipient) === BigInt(0) ||
      typeof attempt.relayer !== 'string' ||
      !ADDRESS.test(attempt.relayer) ||
      typeof attempt.fee !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,76})$/.test(attempt.fee) ||
      uint(attempt.fee) >= parseEther(pool.amount) ||
      attempt.refund !== '0'
    )
      throw new Error();
    let modeFields: object;
    let direct: { from: string; nonce: string } | undefined;
    if (attempt.mode === 'direct') {
      const tx = attempt.transaction;
      if (
        BigInt(attempt.relayer) !== BigInt(0) ||
        attempt.fee !== '0' ||
        !tx ||
        tx.chainId !== 1 ||
        typeof tx.from !== 'string' ||
        tx.from.toLowerCase() !== context.account.address.toLowerCase() ||
        typeof tx.to !== 'string' ||
        tx.to.toLowerCase() !== pool.address ||
        uint(tx.value) !== BigInt(0) ||
        tx.data !==
          WITHDRAWAL_ABI.encodeFunctionData('withdraw', [
            attempt.proof,
            attempt.root,
            attempt.nullifierHash,
            attempt.recipient,
            attempt.relayer,
            attempt.fee,
            attempt.refund,
          ]) ||
        Object.keys(tx).some(
          (key) =>
            ![
              'chainId',
              'from',
              'to',
              'value',
              'data',
              'gasLimit',
              'nonce',
              'gasPrice',
              'maxFeePerGas',
              'maxPriorityFeePerGas',
            ].includes(key)
        )
      )
        throw new Error();
      const nonce = uint(tx.nonce);
      if (nonce >= BigInt(1) << BigInt(64)) throw new Error();
      const fees: Record<string, string> = {
        gasLimit: String(uint(tx.gasLimit, true)),
        nonce: String(nonce),
      };
      if (tx.gasPrice !== undefined) {
        if (
          tx.maxFeePerGas !== undefined ||
          tx.maxPriorityFeePerGas !== undefined
        )
          throw new Error();
        fees.gasPrice = String(uint(tx.gasPrice, true));
      } else {
        const max = uint(tx.maxFeePerGas, true),
          priority = uint(tx.maxPriorityFeePerGas);
        if (priority > max) throw new Error();
        fees.maxFeePerGas = String(max);
        fees.maxPriorityFeePerGas = String(priority);
      }
      direct = { from: tx.from.toLowerCase(), nonce: String(nonce) };
      modeFields = {
        transaction: {
          chainId: 1,
          from: direct.from,
          to: pool.address,
          data: tx.data,
          value: '0',
          ...fees,
        },
      };
    } else if (attempt.mode === 'relayed') {
      if (
        typeof attempt.endpoint !== 'string' ||
        attempt.endpoint.length > 2048 ||
        typeof attempt.ensHash !== 'string' ||
        !HASH.test(attempt.ensHash) ||
        typeof attempt.rewardAccount !== 'string' ||
        !ADDRESS.test(attempt.rewardAccount) ||
        attempt.rewardAccount.toLowerCase() !== attempt.relayer.toLowerCase() ||
        BigInt(attempt.relayer) === BigInt(0)
      )
        throw new Error();
      const endpoint = new URL(attempt.endpoint);
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
      modeFields = {
        endpoint: attempt.endpoint,
        ensHash: attempt.ensHash,
        rewardAccount: attempt.rewardAccount.toLowerCase(),
      };
    } else throw new Error();
    const inputHash = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        Array(6).fill('uint256'),
        [
          attempt.root,
          attempt.nullifierHash,
          attempt.recipient,
          attempt.relayer,
          attempt.fee,
          attempt.refund,
        ].map((value) => BigInt(value).toString())
      )
    );
    const proofHash = keccak256(attempt.proof);
    const normalized = {
      intentId: attempt.intentId,
      noteId: note.id,
      poolId: pool.id,
      createdAt: attempt.createdAt,
      expiresAt: attempt.expiresAt,
      mode: attempt.mode,
      context: {
        chainId: 1,
        rpcUrl: context.rpcUrl,
        slip44: context.slip44,
        sessionGeneration: context.sessionGeneration,
        account: {
          id: context.account.id,
          type: context.account.type,
          address: context.account.address.toLowerCase(),
        },
      },
      recipient: attempt.recipient.toLowerCase(),
      relayer: attempt.relayer.toLowerCase(),
      fee: attempt.fee,
      refund: '0',
      root: attempt.root,
      nullifierHash: attempt.nullifierHash,
      inputHash,
      proofHash,
      ...modeFields,
    };
    return {
      intentId: attempt.intentId,
      createdAt: attempt.createdAt,
      mode: attempt.mode,
      phase: 'unknown',
      proofHash,
      inputHash,
      attemptHash: keccak256(toUtf8Bytes(JSON.stringify(normalized))),
      ...direct,
      ...(attempt.mode === 'relayed'
        ? { endpoint: attempt.endpoint, ensHash: attempt.ensHash }
        : {}),
    };
  } catch {
    throw new Error('privacy_withdrawal_attempt_invalid');
  }
}

export function createPrivateVaultController(
  host: IPrivateVaultHost,
  dependencies: IPrivateVaultDependencies
): IPrivateVaultController &
  IPrivateVaultDepositController &
  IPrivateVaultWithdrawalController &
  IPrivateVaultRestoreController {
  if (
    !dependencies ||
    typeof dependencies.storage?.getItem !== 'function' ||
    (dependencies.storage.compareAndSet === undefined
      ? typeof dependencies.storage.setItem !== 'function'
      : typeof dependencies.storage.compareAndSet !== 'function') ||
    typeof dependencies.mutex?.runExclusive !== 'function' ||
    typeof dependencies.identify !== 'function' ||
    typeof dependencies.generate !== 'function' ||
    typeof dependencies.now !== 'function' ||
    typeof dependencies.deadlineNow !== 'function' ||
    typeof dependencies.randomId !== 'function'
  ) {
    throw new Error('privacy_vault_unavailable');
  }
  const { storage, mutex, identify, generate, now, deadlineNow, randomId } =
    dependencies;
  const compareAndSet = storage.compareAndSet?.bind(storage);
  const assertSession = (session: IPrivateVaultSession) =>
    assertPrivateVaultSession(session, compareAndSet !== undefined);
  let epochs = restoreEpochs.get(mutex);
  if (!epochs) {
    epochs = new Map();
    restoreEpochs.set(mutex, epochs);
  }
  const restoreFence = (context: IContext): (() => void) => {
    const epoch = epochs.get(context.profileId);
    return () => {
      context.session.assertCurrent();
      if (epochs.get(context.profileId) !== epoch)
        throw new Error('privacy_note_restore_required');
    };
  };

  const checked = async <T>(
    context: IContext,
    value: Promise<T>
  ): Promise<T> => {
    const result = await value;
    try {
      assertSession(context.session);
    } catch (error) {
      if (result instanceof Uint8Array) result.fill(0);
      throw error;
    }
    return result;
  };

  const capture = async (
    provided?: IPrivateVaultSession
  ): Promise<IContext> => {
    const session = provided || host.captureSession();
    assertSession(session);
    const profileId = await session.keyring.getPrivateRecordProfileId();
    assertSession(session);
    if (
      typeof profileId !== 'string' ||
      profileId.length !== 66 ||
      !PROFILE.test(profileId)
    )
      throw new Error('privacy_vault_unavailable');
    return {
      session,
      profileId,
      capacity: DEFAULT_CAPACITY,
      storedBytes: 0,
      restore: { version: 1 },
    };
  };

  const assertProfile = async (context: IContext) => {
    assertSession(context.session);
    const current = await checked(
      context,
      context.session.keyring.getPrivateRecordProfileId()
    );
    if (current !== context.profileId)
      throw new Error('privacy_vault_session_changed');
  };

  const nextId = () => {
    const id = randomId();
    if (typeof id !== 'string' || id.length !== 36 || !UUID.test(id))
      throw new Error('privacy_vault_unavailable');
    return id;
  };

  const load = async (
    context: IContext,
    identities?: WeakMap<IStoredNote, IClassicNoteIdentity>
  ): Promise<{ basis: IWriteBasis; manifest: IManifest }> => {
    if (compareAndSet) assertSession(context.session);
    const stored = await checked(
      context,
      storage.getItem(PRIVATE_VAULT_STORAGE_PREFIX + context.profileId)
    );
    const result = await readPrivateVaultBundle(
      stored,
      context.session,
      identify,
      compareAndSet ? 'serialized' : 'object',
      identities,
      identities ? dependencies.yieldInventory : undefined
    );
    assertSession(context.session);
    context.capacity = result.capacity;
    context.restore = result.restore;
    context.storedBytes = result.storedBytes;
    return {
      manifest: result.manifest,
      basis: {
        recordId: result.recordId,
        rawBundle:
          compareAndSet && typeof stored === 'string' ? stored : undefined,
      },
    };
  };

  const readStatus = async (
    context: IContext,
    identity: IClassicNoteIdentity
  ): Promise<IPrivateNoteStatus> => {
    const status = await checked(context, host.readNote(identity));
    if (
      !status ||
      !['verified', 'spent', 'waiting', 'not-found'].includes(status.phase) ||
      (status.blockNumber !== undefined &&
        (!Number.isSafeInteger(status.blockNumber) || status.blockNumber < 0))
    )
      throw new Error('privacy_vault_unavailable');
    return {
      phase: status.phase,
      ...(status.blockNumber === undefined
        ? {}
        : { blockNumber: status.blockNumber }),
    };
  };

  const view = (
    note: IStoredNote,
    identity: IClassicNoteIdentity,
    status: IPrivateNoteStatus
  ): IPrivateNoteView => ({
    id: note.id,
    poolId: identity.poolId,
    amount: getPrivacyPool(identity.poolId).amount,
    createdAt: note.createdAt,
    ...status,
    ...(note.withdrawal && !note.withdrawal.recovery
      ? {
          withdrawal: {
            mode: note.withdrawal.mode,
            phase: note.withdrawal.phase,
            ...(!hasImportedWithdrawalHistory(note.restoreGuard) &&
            note.withdrawal.mode === 'direct' &&
            note.withdrawal.phase === 'submitted' &&
            note.withdrawal.transactionHash
              ? { canCheckRecovery: true as const }
              : {}),
            ...(note.withdrawal.jobId ? { jobId: note.withdrawal.jobId } : {}),
            ...(note.withdrawal.transactionHash
              ? { transactionHash: note.withdrawal.transactionHash }
              : {}),
          },
        }
      : {}),
    ...(note.restoreGuard
      ? {
          restoration:
            hasImportedWithdrawalHistory(note.restoreGuard) ||
            Boolean(note.withdrawal && !note.withdrawal.recovery)
              ? ('withdrawal-pending' as const)
              : restoredNoteBlocksWithdrawal(note.restoreGuard)
              ? ('review-required' as const)
              : ('reviewed' as const),
        }
      : {}),
    ...(restoredNoteBlocksWithdrawal(note.restoreGuard) &&
    status.phase !== 'spent'
      ? { phase: 'waiting' as const }
      : note.withdrawal && !note.withdrawal.recovery && status.phase !== 'spent'
      ? { phase: 'waiting' as const }
      : note.deposit && status.phase !== 'verified' && status.phase !== 'spent'
      ? { phase: 'waiting' as const }
      : note.origin === 'generated' && status.phase === 'not-found'
      ? { phase: 'prepared' as const }
      : {}),
  });

  const encrypt = async (
    context: IContext,
    domain: string,
    recordId: string,
    value: unknown,
    limit: number
  ): Promise<IEncryptedPrivateRecord> => {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    try {
      if (plaintext.length > limit) throw new Error('privacy_note_limit');
      const envelope = await checked(
        context,
        context.session.keyring.encryptPrivateRecord({
          domain,
          recordId,
          plaintext,
        })
      );
      if (
        envelope.profileId !== context.profileId ||
        envelope.domain !== domain
      )
        throw new Error('privacy_vault_session_changed');
      checkEnvelope(context, envelope, domain, limit);
      if (envelope.recordId !== recordId)
        throw new Error('privacy_vault_corrupt');
      return envelope;
    } finally {
      plaintext.fill(0);
    }
  };

  const persist = async (
    context: IContext,
    notes: IStoredNote[],
    basis: IWriteBasis,
    beforeWrite?: () => Promise<void>,
    assertWriteCurrent?: () => void
  ) => {
    if (notes.length > context.capacity) throw new Error('privacy_note_limit');
    for (const note of notes) privateNoteExportHistory(note);
    // Use the same deterministic layout admission for preview and commit.
    const groups = planVaultLayout(
      notes,
      context.capacity,
      context.profileId,
      context.restore
    );
    const shards: IEncryptedPrivateRecord[] = [];
    const references: IShardReference[] = [];
    const rootId = basis.recordId || nextId();
    const ids = new Set([rootId]);
    for (const group of groups) {
      const shardId = nextId();
      if (ids.has(shardId)) throw new Error('privacy_vault_unavailable');
      ids.add(shardId);
      const shard = await encrypt(
        context,
        PRIVATE_VAULT_SHARD_DOMAIN,
        shardId,
        { version: 1, notes: group },
        MAX_SHARD_BYTES
      );
      shards.push(shard);
      references.push({
        recordId: shardId,
        hash: envelopeHash(shard),
        count: group.length,
      });
    }
    const root = await encrypt(
      context,
      PRIVATE_VAULT_DOMAIN,
      rootId,
      {
        format: PRIVATE_VAULT_FORMAT,
        version: PRIVATE_VAULT_VERSION,
        noteCount: notes.length,
        capacity: context.capacity,
        shards: references,
        restore: context.restore,
      },
      MAX_PLAINTEXT_BYTES
    );
    const stored: IVaultBundle = {
      format: PRIVATE_VAULT_FORMAT,
      version: PRIVATE_VAULT_VERSION,
      root,
      shards,
    };
    const raw = JSON.stringify(stored);
    const serialized = new TextEncoder().encode(raw);
    context.storedBytes = serialized.length;
    serialized.fill(0);
    if (context.storedBytes > capacityBudget(context.capacity))
      throw new Error('privacy_note_limit');
    await assertProfile(context);
    if (beforeWrite) await beforeWrite();
    assertSession(context.session);
    const key = PRIVATE_VAULT_STORAGE_PREFIX + context.profileId;
    if (compareAndSet) {
      const guard = () => {
        assertSession(context.session);
        assertWriteCurrent?.();
      };
      guard();
      const committed = await checked(
        context,
        compareAndSet(key, basis.rawBundle, raw, guard)
      );
      if (committed !== true) throw new Error('privacy_vault_session_changed');
    } else {
      await checked(context, storage.setItem!(key, stored));
    }
    await assertProfile(context);
  };

  const createGeneratedNote = async (
    context: IContext,
    poolId: PrivacyPoolId
  ) => {
    context.session.assertCurrent();
    getPrivacyPool(poolId);
    const { manifest, basis } = await load(context);
    if (manifest.notes.length >= context.capacity)
      throw new Error('privacy_note_limit');
    const raw = generate(poolId);
    const identity = identify(raw);
    if (
      identity.poolId !== poolId ||
      manifest.notes.some((entry) => {
        const existing = identify(entry.note);
        return (
          existing.poolId === poolId &&
          existing.commitment === identity.commitment
        );
      })
    )
      throw new Error('privacy_vault_unavailable');
    const note: IStoredNote = {
      id: nextId(),
      note: raw,
      createdAt: now(),
      origin: 'generated',
    };
    if (
      !Number.isSafeInteger(note.createdAt) ||
      note.createdAt < 0 ||
      note.createdAt > 8_640_000_000_000_000 ||
      manifest.notes.some((entry) => entry.id === note.id)
    )
      throw new Error('privacy_vault_unavailable');
    await persist(context, [...manifest.notes, note], basis);
    return { note, identity };
  };
  const internal = async <T>(
    session: IPrivateVaultSession,
    action: (context: IContext) => Promise<T>
  ): Promise<T> => {
    try {
      assertSession(session);
      const context = await capture(session);
      assertSession(session);
      return await mutex.runExclusive(async () => {
        assertSession(session);
        const result = await action(context);
        assertSession(session);
        return result;
      });
    } catch (error) {
      throw publicError(error);
    }
  };
  const findNote = (manifest: IManifest, id: string) => {
    if (typeof id !== 'string' || !UUID.test(id))
      throw new Error('privacy_note_missing');
    const note = manifest.notes.find((entry) => entry.id === id);
    if (!note) throw new Error('privacy_note_missing');
    return note;
  };
  const assertEligible = async (context: IContext, note: IStoredNote) => {
    if (note.restoreGuard) throw new Error('privacy_note_restore_required');
    if (note.origin !== 'generated')
      throw new Error('privacy_deposit_note_ineligible');
    if (note.deposit) throw new Error('privacy_deposit_attempt_exists');
    if (note.withdrawal) throw new Error('privacy_withdrawal_attempt_exists');
    const identity = identify(note.note);
    const status = await readStatus(context, identity);
    if (status.phase === 'verified' || status.phase === 'spent')
      throw new Error('privacy_deposit_note_ineligible');
    return identity;
  };
  const matchingAttempt = (
    note: IStoredNote,
    attempt: IPrivacyDepositAttempt
  ) => {
    const expected = depositJournal(attempt, note, identify(note.note));
    if (
      !note.deposit ||
      note.deposit.intentId !== expected.intentId ||
      note.deposit.attemptHash !== expected.attemptHash
    )
      throw new Error('privacy_deposit_attempt_invalid');
    return note.deposit;
  };
  const assertWithdrawable = async (context: IContext, note: IStoredNote) => {
    if (restoredNoteBlocksWithdrawal(note.restoreGuard))
      throw new Error('privacy_note_restore_required');
    if (note.withdrawal && !note.withdrawal.recovery)
      throw new Error('privacy_withdrawal_attempt_exists');
    const identity = identify(note.note);
    const status = await readStatus(context, identity);
    if (status.phase === 'spent') throw new Error('privacy_note_spent');
    if (status.phase === 'not-found') throw new Error('privacy_note_not_found');
    if (status.phase !== 'verified')
      throw new Error('privacy_verification_pending');
    return identity;
  };
  const matchingWithdrawal = (
    note: IStoredNote,
    attempt: IPrivacyWithdrawalAttempt
  ) => {
    const expected = createWithdrawalJournal(
      attempt,
      note,
      identify(note.note)
    );
    if (
      !note.withdrawal ||
      note.withdrawal.intentId !== expected.intentId ||
      note.withdrawal.attemptHash !== expected.attemptHash
    )
      throw new Error('privacy_withdrawal_attempt_invalid');
    return note.withdrawal;
  };
  const nonceReserved = (notes: IStoredNote[], from: string, nonce: string) =>
    notes.some(
      (entry) =>
        (entry.deposit?.from === from && entry.deposit.nonce === nonce) ||
        (!entry.withdrawal?.recovery &&
          entry.withdrawal?.from === from &&
          entry.withdrawal.nonce === nonce)
    );

  // No bearer notes survive a preview operation in this map. A commit must
  // present the same detached source again, verified against its digest.
  const restorePlans = new Map<
    IPrivateVaultRestorePlan,
    {
      baseline: string;
      context: IContext;
      expiresAt: number;
      receipt: IPrivateNoteRestoreReceipt;
    }
  >();
  const restoreBaseline = (context: IContext, notes: IStoredNote[]) =>
    privateNoteRestoreDigest({
      capacity: context.capacity,
      notes,
      restore: context.restore,
    });
  const pruneRestorePlans = () => {
    for (const [token, plan] of restorePlans) {
      try {
        assertSession(plan.context.session);
      } catch {
        restorePlans.delete(token);
        continue;
      }
      if (deadlineNow() >= plan.expiresAt) restorePlans.delete(token);
    }
  };

  return {
    cancelRestore: (plan) => {
      restorePlans.delete(plan);
    },
    prepareRestore: async (entries, session) => {
      // Snapshot before the first await: caller mutation cannot change what the
      // user reviews or what a later authenticated commit imports.
      let admitted: IPrivateNoteRestoreEntry[];
      try {
        admitted = snapshotPrivateNoteRestoreEntries(entries);
      } catch (error) {
        throw publicError(error);
      }
      return internal(session, async (context) => {
        pruneRestorePlans();
        if (restorePlans.size >= 4)
          throw new Error('privacy_vault_unavailable');
        const { manifest } = await load(context);
        const merged = planPrivateNoteRestore({
          capacity: context.capacity,
          entries: admitted,
          existing: manifest.notes,
          identify,
          importedAt: now(),
          randomId: nextId,
        });
        const token = Object.freeze({
          id: nextId(),
          added: merged.added,
          duplicates: merged.duplicates,
          guarded: merged.guarded,
        });
        const receipt: IPrivateNoteRestoreReceipt = {
          ...token,
          sourceHash: merged.sourceHash,
          createdAt: now(),
        };
        readPrivateNoteRestoreMetadata({ version: 1, receipt });
        planVaultLayout(merged.notes, context.capacity, context.profileId, {
          version: 1,
          receipt,
        });
        await assertProfile(context);
        restorePlans.set(token, {
          baseline: restoreBaseline(context, manifest.notes),
          context,
          expiresAt: deadlineNow() + 300_000,
          receipt,
        });
        return token;
      });
    },
    commitRestore: async (token, entries, password, session) => {
      // One attempt consumes admission even on an authentication/storage error.
      // An ambiguous write is resolved through its durable receipt, never replay.
      const plan = restorePlans.get(token);
      restorePlans.delete(token);
      try {
        if (!plan || deadlineNow() >= plan.expiresAt)
          throw new Error('privacy_restore_stale');
        const admitted = snapshotPrivateNoteRestoreEntries(entries);
        if (privateNoteRestoreDigest(admitted) !== plan.receipt.sourceHash)
          throw new Error('privacy_restore_stale');
        assertSession(plan.context.session);
        assertSession(session);
        if (
          session.generation !== plan.context.session.generation ||
          session.keyring !== plan.context.session.keyring
        )
          throw new Error('privacy_restore_stale');
        const context = await capture(session);
        if (context.profileId !== plan.context.profileId)
          throw new Error('privacy_restore_stale');
        if (compareAndSet) assertSession(session);
        await host.authenticate(password, session, () =>
          mutex.runExclusive(async () => {
            assertSession(session);
            const { manifest, basis } = await load(context);
            if (
              deadlineNow() >= plan.expiresAt ||
              restoreBaseline(context, manifest.notes) !== plan.baseline
            )
              throw new Error('privacy_restore_stale');
            const merged = planPrivateNoteRestore({
              capacity: context.capacity,
              entries: admitted,
              existing: manifest.notes,
              identify,
              importedAt: plan.receipt.createdAt,
              randomId: nextId,
            });
            if (
              merged.sourceHash !== plan.receipt.sourceHash ||
              merged.added !== plan.receipt.added ||
              merged.duplicates !== plan.receipt.duplicates ||
              merged.guarded !== plan.receipt.guarded
            )
              throw new Error('privacy_restore_stale');
            // Revocation precedes the first yielding persistence operation.
            // Even a lost/failed acknowledgment cannot revive earlier signing.
            epochs.set(context.profileId, {});
            context.restore = { version: 1, receipt: plan.receipt };
            const assertRestoreLive = () => {
              if (deadlineNow() >= plan.expiresAt)
                throw new Error('privacy_restore_stale');
            };
            await persist(
              context,
              merged.notes,
              basis,
              async () => assertRestoreLive(),
              assertRestoreLive
            );
            return '';
          })
        );
        await assertProfile(context);
        return { ...plan.receipt };
      } catch (error) {
        throw publicError(error);
      }
    },
    exportBackupSnapshot: async (password, session) => {
      let serialized = '';
      try {
        const context = await capture(session);
        if (compareAndSet) assertSession(session);
        serialized = await host.authenticate(password, session, () =>
          mutex.runExclusive(async () => {
            const { manifest } = await load(context);
            const createdAt = now();
            if (
              !Number.isSafeInteger(createdAt) ||
              createdAt < 0 ||
              createdAt > 8_640_000_000_000_000
            )
              throw new Error('privacy_vault_unavailable');
            const notes = manifest.notes.map((note) => {
              const history = privateNoteExportHistory(note);
              return {
                note: note.note,
                createdAt: note.createdAt,
                ...(note.restoreGuard
                  ? { reconciliationRequired: true as const }
                  : {}),
                ...(history ? { history } : {}),
              };
            });
            await assertProfile(context);
            return JSON.stringify({
              format: 'pali-private-notes',
              version: 1,
              createdAt,
              notes,
            });
          })
        );
        await assertProfile(context);
        return JSON.parse(serialized);
      } catch (error) {
        throw publicError(error);
      } finally {
        serialized = '';
      }
    },
    getRestoreReceipt: (session) =>
      internal(session, async (context) => {
        await load(context);
        await assertProfile(context);
        return context.restore.receipt ? { ...context.restore.receipt } : null;
      }),
    withWithdrawalNote: async (noteId, session, use) => {
      let raw = '';
      let poolId: PrivacyPoolId | undefined;
      let context: IContext | undefined;
      let assertRestoreCurrent: (() => void) | undefined;
      try {
        await internal(session, async (captured) => {
          context = captured;
          const { manifest } = await load(captured);
          const note = findNote(manifest, noteId);
          const identity = await assertWithdrawable(captured, note);
          await assertProfile(captured);
          assertRestoreCurrent = restoreFence(captured);
          raw = note.note;
          poolId = identity.poolId;
        });
        session.assertCurrent();
        // Proving can take minutes. Do not hold the wallet persistence mutex
        // while the background-only callback uses this locally decrypted note.
        const result = await use(raw, poolId!);
        assertRestoreCurrent!();
        await assertProfile(context!);
        assertRestoreCurrent!();
        return result;
      } catch (error) {
        throw publicError(error);
      } finally {
        raw = '';
      }
    },
    getWithdrawalAttempt: (noteId, session) =>
      internal(session, async (context) => {
        const { manifest } = await load(context);
        const note = findNote(manifest, noteId);
        await assertProfile(context);
        return note.withdrawal && !note.withdrawal.recovery
          ? {
              ...note.withdrawal,
              noteId: note.id,
              poolId: identify(note.note).poolId,
            }
          : null;
      }),
    recordWithdrawalJobStatus: (
      noteId,
      attemptHash,
      acknowledgement,
      session
    ) =>
      internal(session, async (context) => {
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, noteId),
          previous = note.withdrawal;
        if (
          !previous ||
          previous.mode !== 'relayed' ||
          previous.phase !== 'submitted' ||
          previous.attemptHash !== attemptHash ||
          !previous.jobId ||
          !acknowledgement ||
          typeof acknowledgement !== 'object' ||
          Array.isArray(acknowledgement) ||
          Object.keys(acknowledgement).some(
            (key) => !['jobId', 'transactionHash'].includes(key)
          ) ||
          acknowledgement.jobId !== previous.jobId ||
          (acknowledgement.transactionHash !== undefined &&
            (typeof acknowledgement.transactionHash !== 'string' ||
              !/^0x[0-9a-fA-F]{64}$/.test(acknowledgement.transactionHash))) ||
          (previous.transactionHash &&
            acknowledgement.transactionHash &&
            previous.transactionHash !==
              acknowledgement.transactionHash.toLowerCase())
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        if (
          !acknowledgement.transactionHash ||
          previous.transactionHash ===
            acknowledgement.transactionHash.toLowerCase()
        )
          return;
        const withdrawal = {
          ...previous,
          transactionHash: acknowledgement.transactionHash.toLowerCase(),
        };
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? { ...entry, withdrawal } : entry
          ),
          basis
        );
      }),
    reserveWithdrawalAttempt: (attempt, session, onIdentity) =>
      internal(session, async (context) => {
        if (
          attempt?.context?.sessionGeneration !== session.generation ||
          attempt.expiresAt <= now()
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const identity = await assertWithdrawable(context, note);
        const created = createWithdrawalJournal(attempt, note, identity);
        const previous = note.withdrawal;
        const withdrawal = withdrawalJournal({
          ...created,
          ...(previous?.recovery
            ? {
                retired: [
                  ...(previous.retired ?? []),
                  retireWithdrawal(previous),
                ],
              }
            : {}),
        });
        onIdentity?.({
          assertRestoreCurrent: restoreFence(context),
          profileId: context.profileId,
          attemptHash: withdrawal.attemptHash,
        });
        if (
          withdrawal.from &&
          withdrawal.nonce !== undefined &&
          nonceReserved(manifest.notes, withdrawal.from, withdrawal.nonce)
        )
          throw new Error('privacy_withdrawal_attempt_exists');
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? { ...entry, withdrawal } : entry
          ),
          basis,
          async () => {
            await assertWithdrawable(context, note);
          }
        );
      }),
    recordWithdrawalSubmission: (attempt, acknowledgement, session) =>
      internal(session, async (context) => {
        if (
          !acknowledgement ||
          typeof acknowledgement !== 'object' ||
          Array.isArray(acknowledgement) ||
          Object.keys(acknowledgement).some(
            (key) => !['jobId', 'transactionHash'].includes(key)
          )
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const previous = matchingWithdrawal(note, attempt);
        const { transactionHash, jobId } = acknowledgement;
        if (
          (!transactionHash && !jobId) ||
          (transactionHash !== undefined &&
            (typeof transactionHash !== 'string' ||
              !/^0x[0-9a-fA-F]{64}$/.test(transactionHash))) ||
          (jobId !== undefined &&
            (attempt.mode !== 'relayed' ||
              typeof jobId !== 'string' ||
              !JOB_ID.test(jobId))) ||
          (previous.transactionHash &&
            transactionHash &&
            previous.transactionHash !== transactionHash.toLowerCase()) ||
          (previous.jobId && jobId && previous.jobId !== jobId)
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        const withdrawal = withdrawalJournal({
          ...previous,
          phase: 'submitted',
          ...(transactionHash
            ? { transactionHash: transactionHash.toLowerCase() }
            : {}),
          ...(jobId ? { jobId } : {}),
        });
        if (JSON.stringify(withdrawal) === JSON.stringify(previous)) return;
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? { ...entry, withdrawal } : entry
          ),
          basis
        );
      }),
    clearKnownUnbroadcastWithdrawal: (
      noteId,
      intentId,
      attemptHash,
      profileId,
      session,
      assertCurrent
    ) =>
      internal(session, async (context) => {
        if (context.profileId !== profileId)
          throw new Error('privacy_vault_session_changed');
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, noteId);
        const previous = note.withdrawal;
        if (!previous) return;
        if (
          previous.intentId !== intentId ||
          previous.attemptHash !== attemptHash ||
          previous.phase !== 'unknown'
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        const cleared = clearUnbroadcastJournal(note);
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? cleared : entry
          ),
          basis,
          async () => assertCurrent()
        );
      }),
    clearUnbroadcastWithdrawalAttempt: (attempt, session) =>
      internal(session, async (context) => {
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const previous = matchingWithdrawal(note, attempt);
        if (previous.phase !== 'unknown')
          throw new Error('privacy_withdrawal_attempt_invalid');
        const cleared = clearUnbroadcastJournal(note);
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? cleared : entry
          ),
          basis
        );
      }),
    prepareDepositNote: (poolId, noteId, session) =>
      internal(session, async (context) => {
        getPrivacyPool(poolId);
        if (noteId === undefined) {
          // Fee preparation can fail after durable creation but before the UI
          // learns this ID. Reuse an unsubmitted generated note across retries
          // and UI/background restarts instead of filling the encrypted vault.
          const { manifest } = await load(context);
          for (const candidate of [...manifest.notes].reverse()) {
            if (
              candidate.origin !== 'generated' ||
              candidate.deposit ||
              candidate.withdrawal ||
              candidate.restoreGuard
            )
              continue;
            const identity = identify(candidate.note);
            if (identity.poolId !== poolId) continue;
            const status = await readStatus(context, identity);
            if (status.phase === 'verified' || status.phase === 'spent')
              continue;
            await assertProfile(context);
            return { id: candidate.id, poolId };
          }
          const { note } = await createGeneratedNote(context, poolId);
          return { id: note.id, poolId };
        }
        const { manifest } = await load(context);
        const note = findNote(manifest, noteId);
        const identity = await assertEligible(context, note);
        if (identity.poolId !== poolId)
          throw new Error('privacy_deposit_note_ineligible');
        await assertProfile(context);
        return { id: note.id, poolId };
      }),
    withDepositCommitment: (noteId, session, use) =>
      internal(session, async (context) => {
        const { manifest } = await load(context);
        const identity = await assertEligible(
          context,
          findNote(manifest, noteId)
        );
        context.session.assertCurrent();
        const assertRestoreCurrent = restoreFence(context);
        const result = await use(identity.commitment);
        assertRestoreCurrent();
        await assertProfile(context);
        return result;
      }),
    getDepositAttempt: (noteId, session) =>
      internal(session, async (context) => {
        const { manifest } = await load(context);
        const note = findNote(manifest, noteId);
        await assertProfile(context);
        return note.deposit ? { ...note.deposit } : null;
      }),
    reserveDepositAttempt: (attempt, session, onRestoreFence) =>
      internal(session, async (context) => {
        if (
          attempt?.context?.sessionGeneration !== session.generation ||
          attempt.expiresAt <= now()
        )
          throw new Error('privacy_deposit_attempt_invalid');
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const identity = await assertEligible(context, note);
        const deposit = depositJournal(attempt, note, identity);
        onRestoreFence?.(restoreFence(context));
        if (nonceReserved(manifest.notes, deposit.from, deposit.nonce))
          throw new Error('privacy_deposit_attempt_exists');
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? { ...entry, deposit } : entry
          ),
          basis,
          async () => {
            await assertEligible(context, note);
          }
        );
      }),
    recordDepositBroadcast: (attempt, transactionHash, session) =>
      internal(session, async (context) => {
        if (
          typeof transactionHash !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
        )
          throw new Error('privacy_deposit_attempt_invalid');
        const hash = transactionHash.toLowerCase();
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const previous = matchingAttempt(note, attempt);
        if (previous.phase === 'submitted') {
          if (previous.transactionHash !== hash)
            throw new Error('privacy_deposit_attempt_invalid');
          return;
        }
        const deposit = {
          ...previous,
          phase: 'submitted' as const,
          transactionHash: hash,
        };
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? { ...entry, deposit } : entry
          ),
          basis
        );
      }),
    clearUnbroadcastDepositAttempt: (attempt, session) =>
      internal(session, async (context) => {
        const { manifest, basis } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const previous = matchingAttempt(note, attempt);
        if (previous.phase !== 'unknown')
          throw new Error('privacy_deposit_attempt_invalid');
        const cleared = { ...note };
        delete cleared.deposit;
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? cleared : entry
          ),
          basis
        );
      }),
    reviewRestoredNote: async (id, password) => {
      try {
        if (typeof id !== 'string' || !UUID.test(id))
          throw new Error('privacy_note_missing');
        const context = await capture();
        await host.authenticate(password, context.session, () =>
          mutex.runExclusive(async () => {
            context.session.assertCurrent();
            const { manifest, basis } = await load(context);
            const note = findNote(manifest, id);
            if (
              !note.restoreGuard ||
              hasImportedWithdrawalHistory(note.restoreGuard) ||
              (note.withdrawal && !note.withdrawal.recovery)
            )
              throw new Error('privacy_note_restore_required');
            // This is the verifier-owned, age-bounded local pool snapshot. It
            // is not a new RPC observation or evidence of exclusive ownership.
            const requireVerified = async () => {
              const status = await readStatus(context, identify(note.note));
              if (status.phase === 'spent')
                throw new Error('privacy_note_spent');
              if (status.phase === 'not-found')
                throw new Error('privacy_note_not_found');
              if (status.phase !== 'verified')
                throw new Error('privacy_verification_pending');
              await assertProfile(context);
            };
            await requireVerified();
            if (note.restoreGuard.reviewedAt !== undefined) return '';
            const restoreGuard = readPrivateNoteRestoreGuard({
              ...note.restoreGuard,
              reviewedAt: now(),
            });
            await persist(
              context,
              manifest.notes.map((entry) =>
                entry.id === id ? { ...entry, restoreGuard } : entry
              ),
              basis,
              requireVerified
            );
            return '';
          })
        );
        await assertProfile(context);
      } catch (error) {
        throw publicError(error);
      }
    },
    recoverFailedWithdrawal: async (id, password) => {
      try {
        if (typeof id !== 'string' || !UUID.test(id))
          throw new Error('privacy_note_missing');
        const context = await capture();
        const deadline = deadlineNow() + 60_000;
        await host.authenticate(password, context.session, async () => {
          const fingerprint = (note: IStoredNote) =>
            JSON.stringify({
              id: note.id,
              createdAt: note.createdAt,
              origin: note.origin,
              deposit: note.deposit,
              withdrawal: note.withdrawal,
              restoreGuard: note.restoreGuard,
            });
          const candidate = await mutex.runExclusive(async () => {
            const { manifest } = await load(context);
            const note = findNote(manifest, id);
            if (hasImportedWithdrawalHistory(note.restoreGuard))
              throw new Error('privacy_note_restore_required');
            if (
              !note.withdrawal ||
              note.withdrawal.mode !== 'direct' ||
              note.withdrawal.phase !== 'submitted' ||
              !note.withdrawal.transactionHash ||
              note.withdrawal.recovery
            )
              throw new Error('privacy_withdrawal_recovery_unavailable');
            await assertProfile(context);
            return {
              identity: { ...identify(note.note) },
              metadata: fingerprint(note),
              withdrawal: withdrawalJournal(note.withdrawal),
            };
          });
          if (!host.prepareWithdrawalRecovery || deadlineNow() >= deadline)
            throw new Error('privacy_withdrawal_recovery_unavailable');
          const proof = await host.prepareWithdrawalRecovery(
            { ...candidate.identity },
            withdrawalJournal(candidate.withdrawal),
            context.session
          );
          context.session.assertCurrent();
          if (!proof || typeof proof.revalidate !== 'function')
            throw new Error('privacy_withdrawal_recovery_unavailable');
          let recovery: IPrivacyWithdrawalRecovery;
          try {
            recovery = withdrawalRecovery({
              ...recoveryReceipt(proof.receipt),
              recoveredAt: now(),
            });
          } catch {
            throw new Error('privacy_withdrawal_recovery_unavailable');
          }
          await mutex.runExclusive(async () => {
            const { manifest, basis } = await load(context);
            const note = findNote(manifest, id);
            if (fingerprint(note) !== candidate.metadata)
              throw new Error('privacy_withdrawal_recovery_unavailable');
            const identity = identify(note.note);
            if (
              identity.poolId !== candidate.identity.poolId ||
              identity.commitment !== candidate.identity.commitment ||
              identity.nullifierHash !== candidate.identity.nullifierHash
            )
              throw new Error('privacy_withdrawal_recovery_unavailable');
            const withdrawal = withdrawalJournal({
              ...note.withdrawal!,
              recovery,
            });
            await assertProfile(context);
            await persist(
              context,
              manifest.notes.map((entry) =>
                entry.id === id ? { ...entry, withdrawal } : entry
              ),
              basis,
              async () => {
                if (deadlineNow() >= deadline)
                  throw new Error('privacy_withdrawal_recovery_unavailable');
                await proof.revalidate();
                await assertProfile(context);
                if (deadlineNow() >= deadline)
                  throw new Error('privacy_withdrawal_recovery_unavailable');
              }
            );
          });
          return '';
        });
        await assertProfile(context);
      } catch (error) {
        throw publicError(error);
      }
    },
    // One explicitly user-triggered record per call. A storage acknowledgement
    // can be ambiguous; callers must refresh the list after every error.
    clearCompletedNotes: async (ids) => {
      try {
        if (
          !Array.isArray(ids) ||
          ids.length > 1 ||
          ids.some((id) => typeof id !== 'string' || !UUID.test(id)) ||
          new Set(ids).size !== ids.length
        )
          throw new Error('privacy_vault_unavailable');
        const deadline = deadlineNow() + 60_000;
        const context = await capture();
        const removed: string[] = [];
        const unresolved: string[] = [];
        for (const id of ids) {
          context.session.assertCurrent();
          const candidate = await mutex.runExclusive(async () => {
            const { manifest } = await load(context);
            const note = manifest.notes.find((entry) => entry.id === id);
            if (
              !note ||
              !note.withdrawal ||
              note.withdrawal.recovery ||
              note.withdrawal.phase !== 'submitted' ||
              !note.withdrawal.transactionHash ||
              (note.deposit &&
                (note.deposit.phase !== 'submitted' ||
                  !note.deposit.transactionHash))
            )
              return undefined;
            await assertProfile(context);
            const identity = identify(note.note);
            return {
              metadata: JSON.stringify({
                id: note.id,
                createdAt: note.createdAt,
                origin: note.origin,
                deposit: note.deposit,
                withdrawal: note.withdrawal,
                restoreGuard: note.restoreGuard,
              }),
              identity: { ...identity },
              withdrawal: { ...note.withdrawal },
              deposit: note.deposit ? { ...note.deposit } : undefined,
            };
          });
          if (!candidate || !host.prepareCompletionProof) {
            unresolved.push(id);
            continue;
          }
          let proof: { revalidate: () => Promise<void> };
          try {
            if (deadlineNow() >= deadline) throw new Error('deadline');
            proof = await host.prepareCompletionProof(
              { ...candidate.identity },
              candidate.withdrawal,
              candidate.deposit,
              context.session
            );
            context.session.assertCurrent();
            if (!proof || typeof proof.revalidate !== 'function')
              throw new Error('invalid');
          } catch {
            context.session.assertCurrent();
            unresolved.push(id);
            continue;
          }
          const cleared = await mutex.runExclusive(async () => {
            context.session.assertCurrent();
            const { manifest, basis } = await load(context);
            const note = manifest.notes.find((entry) => entry.id === id);
            if (
              !note ||
              JSON.stringify({
                id: note.id,
                createdAt: note.createdAt,
                origin: note.origin,
                deposit: note.deposit,
                withdrawal: note.withdrawal,
                restoreGuard: note.restoreGuard,
              }) !== candidate.metadata
            )
              return false;
            const identity = identify(note.note);
            if (
              identity.poolId !== candidate.identity.poolId ||
              identity.commitment !== candidate.identity.commitment ||
              identity.nullifierHash !== candidate.identity.nullifierHash
            )
              return false;
            await assertProfile(context);
            let proofRejected = false;
            try {
              await persist(
                context,
                manifest.notes.filter((entry) => entry.id !== id),
                basis,
                async () => {
                  try {
                    if (deadlineNow() >= deadline) throw new Error('deadline');
                    await proof.revalidate();
                    await assertProfile(context);
                    if (deadlineNow() >= deadline) throw new Error('deadline');
                  } catch (error) {
                    proofRejected = true;
                    throw error;
                  }
                }
              );
            } catch (error) {
              context.session.assertCurrent();
              if (proofRejected) return false;
              throw error;
            }
            return true;
          });
          (cleared ? removed : unresolved).push(id);
        }
        return { removed, unresolved };
      } catch (error) {
        throw publicError(error);
      }
    },
    createDepositNote: async (poolId) => {
      try {
        const context = await capture();
        return await mutex.runExclusive(async () => {
          const { note, identity } = await createGeneratedNote(context, poolId);
          return view(note, identity, { phase: 'not-found' });
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    getNotes: async () => {
      try {
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const identities = new WeakMap<IStoredNote, IClassicNoteIdentity>();
          const { manifest } = await load(context, identities);
          const notes: IPrivateNoteView[] = [];
          for (const note of manifest.notes) {
            const identity = identities.get(note);
            if (!identity) throw new Error('privacy_vault_corrupt');
            notes.push(
              view(note, identity, await readStatus(context, identity))
            );
          }
          await assertProfile(context);
          return { notes };
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    getCapacity: async () => {
      try {
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const { manifest } = await load(context);
          await assertProfile(context);
          const capacity = context.capacity;
          return {
            capacity,
            noteCount: manifest.notes.length,
            bundleLimitBytes: capacityBudget(capacity),
            storedBytes: context.storedBytes || 0,
          };
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    setCapacity: async (capacity) => {
      try {
        if (!capacityValid(capacity))
          throw new Error('privacy_vault_unavailable');
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const { manifest, basis } = await load(context);
          if (manifest.notes.length > capacity)
            throw new Error('privacy_note_limit');
          if (context.capacity !== capacity) {
            context.capacity = capacity;
            await persist(context, manifest.notes, basis);
          }
          await assertProfile(context);
          return {
            capacity,
            noteCount: manifest.notes.length,
            bundleLimitBytes: capacityBudget(capacity),
            storedBytes: context.storedBytes || 0,
          };
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    importNote: async (rawNote) => {
      try {
        const identity = identify(rawNote);
        const normalized = rawNote.trim().toLowerCase();
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const { manifest, basis } = await load(context);
          const status = await readStatus(context, identity);
          if (status.phase === 'waiting')
            throw new Error('privacy_verification_pending');
          if (status.phase === 'not-found')
            throw new Error('privacy_note_not_found');
          const existing = manifest.notes.find((entry) => {
            const candidate = identify(entry.note);
            return (
              candidate.poolId === identity.poolId &&
              candidate.commitment === identity.commitment
            );
          });
          if (existing) {
            await assertProfile(context);
            return view(existing, identity, status);
          }
          if (manifest.notes.length >= context.capacity)
            throw new Error('privacy_note_limit');
          const note: IStoredNote = {
            id: nextId(),
            note: normalized,
            createdAt: now(),
          };
          if (
            !Number.isSafeInteger(note.createdAt) ||
            note.createdAt < 0 ||
            note.createdAt > 8_640_000_000_000_000 ||
            manifest.notes.some((item) => item.id === note.id)
          )
            throw new Error('privacy_vault_unavailable');
          await persist(context, [...manifest.notes, note], basis, async () => {
            // Encryption can yield while the user clears or replaces the public
            // snapshot. Admit only against the currently verified local view.
            const admission = await readStatus(context, identity);
            if (admission.phase === 'waiting')
              throw new Error('privacy_verification_pending');
            if (admission.phase === 'not-found')
              throw new Error('privacy_note_not_found');
          });
          // A successful write owns the note even if its public view changed
          // during storage. Report that current view without discarding it.
          return view(note, identity, await readStatus(context, identity));
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    revealNote: async (id, password) => {
      try {
        if (typeof id !== 'string' || id.length !== 36 || !UUID.test(id))
          throw new Error('privacy_note_missing');
        const context = await capture();
        const result = await host.authenticate(password, context.session, () =>
          mutex.runExclusive(async () => {
            context.session.assertCurrent();
            const { manifest } = await load(context);
            const note = manifest.notes.find((entry) => entry.id === id);
            if (!note) throw new Error('privacy_note_missing');
            await assertProfile(context);
            return note.note;
          })
        );
        await assertProfile(context);
        return result;
      } catch (error) {
        throw publicError(error);
      }
    },
  };
}
