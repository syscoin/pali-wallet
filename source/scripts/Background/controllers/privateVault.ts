import {
  AbiCoder,
  Interface,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from 'ethers';

import { walletPersistenceMutex } from 'utils/asyncMutex';
import {
  generateClassicNote,
  identifyClassicNote,
  IClassicNoteIdentity,
} from 'utils/privacy/note';
import type {
  IPrivacyNoteReader,
  IPrivateNoteStatus,
  IPrivateNoteView,
  IPrivateVaultController,
} from 'utils/privacy/privateVaultTypes';
import { getPrivacyPool } from 'utils/privacy/registry';
import type { IPrivacyDepositAttempt } from 'utils/privacy/transactionTypes';
import type { PrivacyPoolId } from 'utils/privacy/types';
import type {
  IPrivacyWithdrawalAcknowledgement,
  IPrivacyWithdrawalAttempt,
  IPrivacyWithdrawalJournal,
  IPrivacyWithdrawalStatusRecord,
} from 'utils/privacy/withdrawalTransactionTypes';
import { chromeStorage } from 'utils/storageAPI';

import type {
  IEncryptedPrivateRecord,
  KeyringManager,
} from '@sidhujag/sysweb3-keyring';

export const PRIVATE_VAULT_STORAGE_PREFIX = 'state-private-vault-v1:';
export const PRIVATE_VAULT_DOMAIN = 'org.syscoin.pali.privacy.notes.v1';
const MAX_NOTES = 128;
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_SHARD_BYTES = 32 * 1024;
const MAX_SHARD_NOTES = 16;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const PRIVATE_VAULT_SHARD_DOMAIN = 'org.syscoin.pali.privacy.notes.shard.v2';
const PROFILE = /^0x[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DEPOSIT_ABI = new Interface([
  'function deposit(bytes32 commitment) payable',
]);
const WITHDRAWAL_ABI = new Interface([
  'function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund)',
]);
const HASH = /^0x[0-9a-f]{64}$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const PUBLIC_ERRORS = new Set([
  'privacy_note_invalid',
  'privacy_note_limit',
  'privacy_note_missing',
  'privacy_note_not_found',
  'privacy_vault_corrupt',
  'privacy_vault_locked',
  'privacy_vault_session_changed',
  'privacy_vault_unavailable',
  'privacy_verification_pending',
  'privacy_deposit_attempt_exists',
  'privacy_deposit_attempt_invalid',
  'privacy_deposit_note_ineligible',
  'privacy_note_spent',
  'privacy_withdrawal_attempt_exists',
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

export interface IPrivateVaultSession {
  assertCurrent: () => void;
  generation: number;
  keyring: Pick<
    KeyringManager,
    | 'getPrivateRecordProfileId'
    | 'encryptPrivateRecord'
    | 'decryptPrivateRecord'
  >;
}

export interface IPrivateVaultDepositJournal {
  attemptHash: string;
  createdAt: number;
  from: string;
  intentId: string;
  nonce: string;
  phase: 'unknown' | 'submitted';
  transactionHash?: string;
}

/** MainController only: never add these methods to the message-facing vault API. */
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
    session: IPrivateVaultSession
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
    onIdentity?: (identity: { attemptHash: string; profileId: string }) => void
  ) => Promise<void>;
  withWithdrawalNote: <T>(
    noteId: string,
    session: IPrivateVaultSession,
    use: (note: string, poolId: PrivacyPoolId) => Promise<T> | T
  ) => Promise<T>;
}

interface IHost {
  authenticate: (
    password: string,
    session: IPrivateVaultSession,
    reveal: () => Promise<string>
  ) => Promise<string>;
  captureSession: () => IPrivateVaultSession;
  readNote: IPrivacyNoteReader;
}

interface IStoredNote {
  createdAt: number;
  deposit?: IPrivateVaultDepositJournal;
  id: string;
  note: string;
  origin?: 'generated';
  withdrawal?: IPrivateVaultWithdrawalJournal;
}
interface IManifest {
  notes: IStoredNote[];
  version: 1;
}
interface IContext {
  chunked?: boolean;
  profileId: string;
  session: IPrivateVaultSession;
}

interface IShardReference {
  count: number;
  hash: string;
  recordId: string;
}
interface IVaultBundle {
  root: IEncryptedPrivateRecord;
  shards: IEncryptedPrivateRecord[];
  version: 2;
}

const envelopeHash = (value: IEncryptedPrivateRecord): string =>
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
interface IDependencies {
  generate?: typeof generateClassicNote;
  identify?: typeof identifyClassicNote;
  mutex?: Pick<typeof walletPersistenceMutex, 'runExclusive'>;
  now?: () => number;
  randomId?: () => string;
  storage?: Pick<typeof chromeStorage, 'getItem' | 'setItem'>;
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

function journal(
  value: IPrivateVaultDepositJournal
): IPrivateVaultDepositJournal {
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
    phase: value.phase,
    ...(value.transactionHash
      ? { transactionHash: value.transactionHash }
      : {}),
  };
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
  'phase',
  'proofHash',
  'transactionHash',
];
const JOB_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const validRelayEndpoint = (value: unknown) => {
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
function withdrawalJournal(
  value: IPrivateVaultWithdrawalJournal
): IPrivateVaultWithdrawalJournal {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !WITHDRAWAL_JOURNAL_KEYS.includes(key)) ||
    typeof value.intentId !== 'string' ||
    !UUID.test(value.intentId) ||
    ![value.attemptHash, value.proofHash, value.inputHash].every(
      (hash) => typeof hash === 'string' && HASH.test(hash)
    ) ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !['direct', 'relayed'].includes(value.mode) ||
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
      : !value.transactionHash && !value.jobId)
  )
    throw new Error('privacy_vault_corrupt');
  return {
    intentId: value.intentId,
    attemptHash: value.attemptHash,
    proofHash: value.proofHash,
    inputHash: value.inputHash,
    createdAt: value.createdAt,
    mode: value.mode,
    phase: value.phase,
    ...(value.mode === 'direct'
      ? { from: value.from!.toLowerCase(), nonce: value.nonce }
      : { endpoint: value.endpoint, ensHash: value.ensHash }),
    ...(value.transactionHash
      ? { transactionHash: value.transactionHash }
      : {}),
    ...(value.jobId ? { jobId: value.jobId } : {}),
  };
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

const publicError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : '';
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
export function createPrivateVaultController(
  host: IHost,
  dependencies: IDependencies = {}
): IPrivateVaultController &
  IPrivateVaultDepositController &
  IPrivateVaultWithdrawalController {
  const storage = dependencies.storage || chromeStorage;
  const mutex = dependencies.mutex || walletPersistenceMutex;
  const identify = dependencies.identify || identifyClassicNote;
  const generate = dependencies.generate || generateClassicNote;
  const now = dependencies.now || Date.now;
  const randomId = dependencies.randomId || (() => crypto.randomUUID());

  const checked = async <T>(
    context: IContext,
    value: Promise<T>
  ): Promise<T> => {
    const result = await value;
    try {
      context.session.assertCurrent();
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
    session.assertCurrent();
    const profileId = await session.keyring.getPrivateRecordProfileId();
    session.assertCurrent();
    if (
      typeof profileId !== 'string' ||
      profileId.length !== 66 ||
      !PROFILE.test(profileId)
    )
      throw new Error('privacy_vault_unavailable');
    return { session, profileId };
  };

  const assertProfile = async (context: IContext) => {
    context.session.assertCurrent();
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

  const checkEnvelope = (
    context: IContext,
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
    context: IContext,
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

  const load = async (
    context: IContext
  ): Promise<{
    manifest: IManifest;
    recordId?: string;
  }> => {
    const stored = await checked(
      context,
      storage.getItem(PRIVATE_VAULT_STORAGE_PREFIX + context.profileId)
    );
    if (stored === null || stored === undefined)
      return { manifest: { version: 1, notes: [] } };
    try {
      let data: IManifest;
      let recordId: string;
      context.chunked = stored.version === 2;
      if (context.chunked) {
        const bundle = stored as IVaultBundle;
        if (
          !bundle ||
          typeof bundle !== 'object' ||
          Array.isArray(bundle) ||
          Object.keys(bundle).length !== 3 ||
          !Array.isArray(bundle.shards) ||
          bundle.shards.length < 1 ||
          bundle.shards.length > MAX_NOTES
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
        if (
          new TextEncoder().encode(JSON.stringify(bundle)).length >
          MAX_BUNDLE_BYTES
        )
          throw new Error('privacy_vault_corrupt');
        const root = await decrypt(
          context,
          bundle.root,
          PRIVATE_VAULT_DOMAIN,
          MAX_PLAINTEXT_BYTES
        );
        if (
          !root ||
          root.version !== 2 ||
          Object.keys(root).length !== 3 ||
          !Number.isInteger(root.noteCount) ||
          root.noteCount < 0 ||
          root.noteCount > MAX_NOTES ||
          !Array.isArray(root.shards) ||
          root.shards.length !== bundle.shards.length
        )
          throw new Error('privacy_vault_corrupt');
        const recordIds = new Set([bundle.root.recordId]);
        const notes: IStoredNote[] = [];
        for (const [index, envelope] of bundle.shards.entries()) {
          const reference: IShardReference = root.shards[index];
          if (
            !reference ||
            Object.keys(reference).length !== 3 ||
            reference.recordId !== envelope.recordId ||
            recordIds.has(reference.recordId) ||
            !Number.isInteger(reference.count) ||
            reference.count < 0 ||
            reference.count > MAX_SHARD_NOTES ||
            reference.hash !== envelopeHash(envelope)
          )
            throw new Error('privacy_vault_corrupt');
          recordIds.add(reference.recordId);
          const shard = await decrypt(
            context,
            envelope,
            PRIVATE_VAULT_SHARD_DOMAIN,
            MAX_SHARD_BYTES
          );
          if (
            !shard ||
            shard.version !== 1 ||
            Object.keys(shard).length !== 2 ||
            !Array.isArray(shard.notes) ||
            shard.notes.length !== reference.count
          )
            throw new Error('privacy_vault_corrupt');
          notes.push(...shard.notes);
          if (notes.length > MAX_NOTES)
            throw new Error('privacy_vault_corrupt');
        }
        if (notes.length !== root.noteCount)
          throw new Error('privacy_vault_corrupt');
        data = { version: 1, notes };
        recordId = bundle.root.recordId;
      } else {
        data = await decrypt(
          context,
          stored,
          PRIVATE_VAULT_DOMAIN,
          MAX_PLAINTEXT_BYTES
        );
        recordId = stored.recordId;
      }
      if (
        !data ||
        data.version !== 1 ||
        !Array.isArray(data.notes) ||
        data.notes.length > MAX_NOTES
      )
        throw new Error('privacy_vault_corrupt');
      const ids = new Set<string>();
      const commitments = new Set<string>();
      const notes = data.notes.map((entry: IStoredNote) => {
        if (
          !entry ||
          typeof entry.id !== 'string' ||
          entry.id.length !== 36 ||
          !UUID.test(entry.id) ||
          ids.has(entry.id) ||
          !Number.isSafeInteger(entry.createdAt) ||
          entry.createdAt < 0 ||
          typeof entry.note !== 'string' ||
          entry.note.length > 256 ||
          entry.note !== entry.note.trim().toLowerCase() ||
          (entry.origin !== undefined && entry.origin !== 'generated')
        )
          throw new Error('privacy_vault_corrupt');
        const identity = identify(entry.note);
        const deposit =
          entry.deposit === undefined ? undefined : journal(entry.deposit);
        const withdrawal =
          entry.withdrawal === undefined
            ? undefined
            : withdrawalJournal(entry.withdrawal);
        if (deposit && entry.origin !== 'generated')
          throw new Error('privacy_vault_corrupt');
        const key = `${identity.poolId}:${identity.commitment}`;
        if (commitments.has(key)) throw new Error('privacy_vault_corrupt');
        commitments.add(key);
        ids.add(entry.id);
        return {
          id: entry.id,
          note: entry.note,
          createdAt: entry.createdAt,
          ...(entry.origin === 'generated' ? { origin: entry.origin } : {}),
          ...(deposit ? { deposit } : {}),
          ...(withdrawal ? { withdrawal } : {}),
        };
      });
      return { manifest: { version: 1, notes }, recordId };
    } catch (error) {
      if (
        error instanceof Error &&
        [
          'privacy_vault_session_changed',
          'privacy_vault_unavailable',
          'Private record session changed',
        ].includes(error.message)
      )
        throw error;
      throw new Error('privacy_vault_corrupt');
    }
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
    ...(note.withdrawal
      ? {
          withdrawal: {
            mode: note.withdrawal.mode,
            phase: note.withdrawal.phase,
            ...(note.withdrawal.jobId ? { jobId: note.withdrawal.jobId } : {}),
            ...(note.withdrawal.transactionHash
              ? { transactionHash: note.withdrawal.transactionHash }
              : {}),
          },
        }
      : {}),
    ...(note.withdrawal && status.phase !== 'spent'
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
    recordId?: string,
    beforeWrite?: () => Promise<void>
  ) => {
    if (notes.length > MAX_NOTES) throw new Error('privacy_note_limit');
    const manifest = { version: 1, notes };
    const plain = new TextEncoder().encode(JSON.stringify(manifest));
    const fitsSingle = plain.length <= MAX_PLAINTEXT_BYTES;
    plain.fill(0);
    let stored: IEncryptedPrivateRecord | IVaultBundle;
    if (!context.chunked && fitsSingle) {
      stored = await encrypt(
        context,
        PRIVATE_VAULT_DOMAIN,
        recordId || nextId(),
        manifest,
        MAX_PLAINTEXT_BYTES
      );
    } else {
      // Keep the single atomic profile write while bounding each SDK record.
      // The encrypted root authenticates every ordered shard; none can be
      // omitted, swapped or copied from a previous update independently.
      const groups: IStoredNote[][] = [];
      let current: IStoredNote[] = [];
      for (const note of notes) {
        const candidate = [...current, note];
        const encoded = new TextEncoder().encode(
          JSON.stringify({ version: 1, notes: candidate })
        );
        const fits = encoded.length <= MAX_SHARD_BYTES;
        encoded.fill(0);
        if (current.length && (!fits || candidate.length > MAX_SHARD_NOTES)) {
          groups.push(current);
          current = [note];
        } else current = candidate;
      }
      if (current.length || !groups.length) groups.push(current);
      const shards: IEncryptedPrivateRecord[] = [];
      const references: IShardReference[] = [];
      const rootId = recordId || nextId();
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
        { version: 2, noteCount: notes.length, shards: references },
        MAX_PLAINTEXT_BYTES
      );
      stored = { version: 2, root, shards };
      const encoded = new TextEncoder().encode(JSON.stringify(stored));
      const fits = encoded.length <= MAX_BUNDLE_BYTES;
      encoded.fill(0);
      if (!fits) throw new Error('privacy_note_limit');
    }
    await assertProfile(context);
    if (beforeWrite) await beforeWrite();
    context.session.assertCurrent();
    await checked(
      context,
      storage.setItem(PRIVATE_VAULT_STORAGE_PREFIX + context.profileId, stored)
    );
    await assertProfile(context);
  };

  const createGeneratedNote = async (
    context: IContext,
    poolId: PrivacyPoolId
  ) => {
    context.session.assertCurrent();
    getPrivacyPool(poolId);
    const { manifest, recordId } = await load(context);
    if (manifest.notes.length >= MAX_NOTES)
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
      manifest.notes.some((entry) => entry.id === note.id)
    )
      throw new Error('privacy_vault_unavailable');
    await persist(context, [...manifest.notes, note], recordId);
    return { note, identity };
  };
  const internal = async <T>(
    session: IPrivateVaultSession,
    action: (context: IContext) => Promise<T>
  ): Promise<T> => {
    try {
      session.assertCurrent();
      const context = await capture(session);
      session.assertCurrent();
      return await mutex.runExclusive(async () => {
        session.assertCurrent();
        const result = await action(context);
        session.assertCurrent();
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
    if (note.withdrawal) throw new Error('privacy_withdrawal_attempt_exists');
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
        (entry.withdrawal?.from === from && entry.withdrawal.nonce === nonce)
    );

  return {
    withWithdrawalNote: async (noteId, session, use) => {
      let raw = '';
      let poolId: PrivacyPoolId | undefined;
      let context: IContext | undefined;
      try {
        await internal(session, async (captured) => {
          context = captured;
          const { manifest } = await load(captured);
          const note = findNote(manifest, noteId);
          const identity = await assertWithdrawable(captured, note);
          await assertProfile(captured);
          raw = note.note;
          poolId = identity.poolId;
        });
        session.assertCurrent();
        // Proving can take minutes. Do not hold the wallet persistence mutex
        // while the background-only callback uses this locally decrypted note.
        const result = await use(raw, poolId!);
        await assertProfile(context!);
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
        return note.withdrawal
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
        const { manifest, recordId } = await load(context);
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
          recordId
        );
      }),
    reserveWithdrawalAttempt: (attempt, session, onIdentity) =>
      internal(session, async (context) => {
        if (
          attempt?.context?.sessionGeneration !== session.generation ||
          attempt.expiresAt <= now()
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        const { manifest, recordId } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const identity = await assertWithdrawable(context, note);
        const withdrawal = createWithdrawalJournal(attempt, note, identity);
        onIdentity?.({
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
          recordId,
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
        const { manifest, recordId } = await load(context);
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
          recordId
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
        const { manifest, recordId } = await load(context);
        const note = findNote(manifest, noteId);
        const previous = note.withdrawal;
        if (!previous) return;
        if (
          previous.intentId !== intentId ||
          previous.attemptHash !== attemptHash ||
          previous.phase !== 'unknown'
        )
          throw new Error('privacy_withdrawal_attempt_invalid');
        const cleared = { ...note };
        delete cleared.withdrawal;
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? cleared : entry
          ),
          recordId,
          async () => assertCurrent()
        );
      }),
    clearUnbroadcastWithdrawalAttempt: (attempt, session) =>
      internal(session, async (context) => {
        const { manifest, recordId } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const previous = matchingWithdrawal(note, attempt);
        if (previous.phase !== 'unknown')
          throw new Error('privacy_withdrawal_attempt_invalid');
        const cleared = { ...note };
        delete cleared.withdrawal;
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? cleared : entry
          ),
          recordId
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
              candidate.withdrawal
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
        const result = await use(identity.commitment);
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
    reserveDepositAttempt: (attempt, session) =>
      internal(session, async (context) => {
        if (
          attempt?.context?.sessionGeneration !== session.generation ||
          attempt.expiresAt <= now()
        )
          throw new Error('privacy_deposit_attempt_invalid');
        const { manifest, recordId } = await load(context);
        const note = findNote(manifest, attempt?.noteId);
        const identity = await assertEligible(context, note);
        const deposit = depositJournal(attempt, note, identity);
        if (nonceReserved(manifest.notes, deposit.from, deposit.nonce))
          throw new Error('privacy_deposit_attempt_exists');
        await persist(
          context,
          manifest.notes.map((entry) =>
            entry.id === note.id ? { ...entry, deposit } : entry
          ),
          recordId,
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
        const { manifest, recordId } = await load(context);
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
          recordId
        );
      }),
    clearUnbroadcastDepositAttempt: (attempt, session) =>
      internal(session, async (context) => {
        const { manifest, recordId } = await load(context);
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
          recordId
        );
      }),
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
          const { manifest } = await load(context);
          const notes: IPrivateNoteView[] = [];
          for (const note of manifest.notes) {
            const identity = identify(note.note);
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
    importNote: async (rawNote) => {
      try {
        const identity = identify(rawNote);
        const normalized = rawNote.trim().toLowerCase();
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const { manifest, recordId } = await load(context);
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
          if (manifest.notes.length >= MAX_NOTES)
            throw new Error('privacy_note_limit');
          const note: IStoredNote = {
            id: nextId(),
            note: normalized,
            createdAt: now(),
          };
          if (
            !Number.isSafeInteger(note.createdAt) ||
            note.createdAt < 0 ||
            manifest.notes.some((item) => item.id === note.id)
          )
            throw new Error('privacy_vault_unavailable');
          await persist(
            context,
            [...manifest.notes, note],
            recordId,
            async () => {
              // Encryption can yield while the user clears or replaces the public
              // snapshot. Admit only against the currently verified local view.
              const admission = await readStatus(context, identity);
              if (admission.phase === 'waiting')
                throw new Error('privacy_verification_pending');
              if (admission.phase === 'not-found')
                throw new Error('privacy_note_not_found');
            }
          );
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
