import {
  planEvmCancellationFees,
  assertEvmGasLimit,
} from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { getAddress } from 'ethers/address';
import { keccak256, sha256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { concat, getBytes } from 'ethers/utils';

import { createErc20Policy, decodeErc20Transfer } from '../shared/erc20.ts';
import { snapshotEvmTransferAsset } from '../shared/evmAssetState.ts';
import { EvmAutoNonceAcceptance } from '../shared/evmAutoNonce.ts';
import { isEvmProtectedEmptySelfCall } from '../shared/evmCancellationPayer.ts';
import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import { EVM_SIGNED_RECORD_LIMITS } from '../shared/evmSignedRecordLimits.ts';
import { observeEvmTransaction } from '../shared/evmTransactionObservation.ts';
import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';
import { decodeRetainedNftTransfer } from '../shared/nftTransfer.ts';
import { getPrivacyPoolActivity } from '../shared/privacyPoolActivity.ts';
import {
  EVM_ASSET_REVIEW_MESSAGE,
  EVM_ASSET_REVIEW_REQUIRED,
} from '../utils/evmTransactionContext.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';

import {
  canSpeedUpSmartAccountOuter,
  decodeRetainedSmartAccountTransfer,
  decodeRetainedSmartAccountCancellation,
  isSmartAccountActivityCandidate,
  decodeRetainedSmartAccountOperations,
  decodeSmartAccountOperations,
  type RetainedSmartAccountOperation,
  type RetainedSmartAccountActivity,
  type RetainedSmartAccountCancellation,
} from './smartAccountActivity.ts';
import {
  smartAccountAuthorizationSummary,
  captureSignedSmartAccountOperation,
  captureSmartAccountAuthorization,
  captureSmartAccountAuthorizationSummary,
  decodeSmartAccountAuthorization,
  encodeSmartAccountAuthorization,
  isSmartAccountRevocationOperation,
  type RetainedSmartAccountAuthorization,
  type SmartAccountAuthorizationBlock,
  type SmartAccountAuthorizationSummary,
} from './smartAccountAuthorization.ts';
import {
  decodeCancellationOuter,
  decodeSmartAccountCancellation,
  type SmartAccountCancellationMetadata,
} from './smartAccountCancellation.ts';
import type { EvmAutoNonceSnapshot } from '../shared/evmAutoNonce.ts';
import type { EvmTransactionObservation } from '../shared/evmTransactionObservation.ts';
import type { SmartAccountPackedUserOperation } from '../utils/smartAccount/account.ts';
import type {
  IEncryptedPrivateRecord,
  EvmSignedSubmission,
} from '@sidhujag/sysweb3-keyring';

export { EVM_SIGNED_RECORD_LIMITS } from '../shared/evmSignedRecordLimits.ts';
export const EVM_SIGNED_RECORD_PREFIX = 'pali-evm-signed-v1:';
const encoder = new TextEncoder();
const ROOT_DOMAIN = 'org.syscoin.pali.evm.signed.root.v1';
const UNSIGNED_CHUNK_DOMAIN = 'org.syscoin.pali.evm.unsigned.chunk.v1';
const CHUNK_DOMAIN = 'org.syscoin.pali.evm.signed.chunk.v1';
const PROFILE = /^0x[0-9a-f]{64}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SIGNED_PHASES = [
  'signed',
  'attempted',
  'submitted',
  'confirmed',
  'reverted',
  'nonce-consumed',
] as const;
export type EvmSignedPhase = (typeof SIGNED_PHASES)[number];
export class EvmSignedRecordCancellationFence extends Error {
  readonly #recoveryHash: string | null;

  constructor(recoveryHash: string | null) {
    super('EVM_SIGNED_RECORD_CANCELLATION_FENCE');
    this.name = 'EvmSignedRecordCancellationFence';
    this.#recoveryHash = recoveryHash;
  }

  get recoveryHash(): string | null {
    return this.#recoveryHash;
  }
}

export const EVM_SIGNED_RECORD_NONCE_CONFLICT =
  'EVM_SIGNED_RECORD_NONCE_CONFLICT';

export class EvmSignedRecordNonceConflict extends Error {
  readonly code = EVM_SIGNED_RECORD_NONCE_CONFLICT;
  readonly transactionNotBroadcast = true;
  readonly operation: EvmSignedRecordSummary['operation'];
  readonly #recoveryHash: string;

  constructor(owner: Pick<EvmSignedRecordSummary, 'hash' | 'operation'>) {
    super(EVM_SIGNED_RECORD_NONCE_CONFLICT);
    this.name = 'EvmSignedRecordNonceConflict';
    this.operation = owner.operation;
    this.#recoveryHash = owner.hash;
  }

  get recoveryHash(): string {
    return this.#recoveryHash;
  }
}

// Unforgeable local provenance: only a failed held admission can mint this
// marker. It carries no RPC body or signed bytes across the SDK boundary.
const heldAssetPreflightFailures = new WeakMap<
  object,
  Pick<EvmSignedRecordSummary, 'hash' | 'operation'>
>();
export function retainedEvmAssetPreflightConflict(
  error: unknown
): EvmSignedRecordNonceConflict | null {
  if (!error || typeof error !== 'object') return null;
  const record = heldAssetPreflightFailures.get(error);
  return record ? new EvmSignedRecordNonceConflict(record) : null;
}

const MAX_PHASE_BYTES = Math.max(...SIGNED_PHASES.map((phase) => phase.length));
const MAX_REVISION_DIGITS = String(Number.MAX_SAFE_INTEGER).length;

export type EvmSignedRecordStorage = {
  compareAndSet(
    profileId: string,
    expected: string | undefined,
    next: string,
    assertCurrent: () => void
  ): Promise<boolean>;
  read(profileId: string): Promise<string | undefined>;
};
export type SmartAccountPendingRecords = Readonly<{
  filterPendingAuthorizations?(
    authorizations: readonly Pick<
      SmartAccountAuthorizationSummary,
      'account' | 'chainId' | 'operationHash' | 'operationNonce'
    >[]
  ): readonly Pick<
    SmartAccountAuthorizationSummary,
    'account' | 'chainId' | 'operationHash' | 'operationNonce'
  >[];
  filterPendingOperations?(
    operations: readonly RetainedSmartAccountOperation[]
  ): readonly RetainedSmartAccountOperation[];
  forAuthorization?(
    receipt: SmartAccountAuthorizationReceipt
  ): SmartAccountPendingRecords;
  profileId: string;
  read(fresh: boolean): Promise<readonly RetainedSmartAccountOperation[]>;
  readAuthorizations?(
    fresh: boolean
  ): Promise<
    readonly Pick<
      SmartAccountAuthorizationSummary,
      'account' | 'chainId' | 'operationHash' | 'operationNonce'
    >[]
  >;
  readPayerRecords?(
    address: string
  ): Promise<readonly EvmSignedRecordSummary[]>;
}>;
export type SmartAccountAuthorizationReceipt = Readonly<{
  operationHash: string;
}>;
const authorizationReceipts = new WeakMap<
  SmartAccountAuthorizationReceipt,
  Readonly<{
    assertCurrent(): void;
    profileId: string;
    record: RetainedSmartAccountAuthorization;
    storage: EvmSignedRecordStorage;
  }>
>();
export function assertSmartAccountAuthorizationReceipt(
  receipt: SmartAccountAuthorizationReceipt,
  input: Readonly<{
    chainId: number;
    payer: string;
    userOperation: SmartAccountPackedUserOperation;
  }>,
  assertCurrent: () => void
): void {
  const captured = authorizationReceipts.get(receipt);
  if (!captured) throw new Error('SMART_ACCOUNT_AUTHORIZATION_REQUIRED');
  assertCurrent();
  captured.assertCurrent();
  if (
    captured.record.chainId !== String(input.chainId) ||
    captured.record.payer !== getAddress(input.payer) ||
    JSON.stringify(captured.record.userOperation) !==
      JSON.stringify(captureSignedSmartAccountOperation(input.userOperation))
  )
    throw new Error('SMART_ACCOUNT_AUTHORIZATION_CHANGED');
}
/** Resolve an already retained no-op's randomized proof without discarding its first bytes. */
export function resolveSmartAccountAuthorization(
  receipt: SmartAccountAuthorizationReceipt,
  input: Readonly<{
    chainId: number;
    payer: string;
    userOperation: SmartAccountPackedUserOperation;
  }>,
  assertCurrent: () => void
): SmartAccountPackedUserOperation {
  const captured = authorizationReceipts.get(receipt);
  if (!captured) throw new Error('SMART_ACCOUNT_AUTHORIZATION_REQUIRED');
  assertSynchronousEvmFeeGuard(assertCurrent);
  captured.assertCurrent();
  const provided = captureSignedSmartAccountOperation(input.userOperation);
  const retained = captured.record.userOperation;
  if (
    captured.record.chainId !== String(input.chainId) ||
    captured.record.payer !== getAddress(input.payer) ||
    !sameUnsignedSmartAccountOperation(retained, provided) ||
    (retained.signature !== provided.signature &&
      (!captured.record.replacesOperationHash ||
        !isSmartAccountRevocationOperation(retained) ||
        !isSmartAccountRevocationOperation(provided)))
  )
    throw new Error('SMART_ACCOUNT_AUTHORIZATION_CHANGED');
  return retained;
}
function sameUnsignedSmartAccountOperation(
  left: SmartAccountPackedUserOperation,
  right: SmartAccountPackedUserOperation
): boolean {
  return Object.keys(left).every(
    (key) =>
      key === 'signature' ||
      left[key as keyof SmartAccountPackedUserOperation] ===
        right[key as keyof SmartAccountPackedUserOperation]
  );
}
const mutationSerials = new WeakMap<EvmSignedRecordStorage, number>();
// A handoff need not change the journal revision. Track it separately so a
// failed initial submission cannot remove a record another admission may use.
const dispatchSerials = new WeakMap<EvmSignedRecordStorage, number>();
const discardUndispatched = Symbol('discardUndispatched');

export type EvmSignedRecordSession = {
  assertCurrent(): void;
  keyring: {
    decryptPrivateRecord(input: {
      domain: string;
      envelope: IEncryptedPrivateRecord;
      recordId: string;
    }): Promise<Uint8Array>;
    encryptPrivateRecord(input: {
      domain: string;
      plaintext: Uint8Array;
      recordId: string;
    }): Promise<IEncryptedPrivateRecord>;
    getPrivateRecordProfileId(): Promise<string>;
  };
};
export type EvmSignedRecordSummary = Readonly<{
  chainId: string;
  createdAt: number;
  from: string;
  hash: string;
  metadata?: Readonly<Record<string, unknown>>;
  nonce: number;
  operation: EvmSignedSubmission['context']['operation'];
  originalHash?: string;
  phase: EvmSignedPhase;
  signer: Readonly<{ id: number; type: string }>;
}>;
export type EvmRetainedSignedRecord = EvmSignedRecordSummary &
  Readonly<{
    payloadKind?: 'signed';
    rawTransaction: string;
    unsignedTransaction?: never;
  }>;
export type EvmRetainedUnsignedRecord = EvmSignedRecordSummary &
  Readonly<{
    payloadKind: 'unsigned-eoa';
    rawTransaction?: never;
    unsignedTransaction: string;
  }>;
export type EvmRetainedRecord =
  | EvmRetainedSignedRecord
  | EvmRetainedUnsignedRecord;
export function retainedEvmTransaction(entry: EvmRetainedRecord): Transaction {
  return Transaction.from(
    entry.payloadKind === 'unsigned-eoa'
      ? entry.unsignedTransaction
      : entry.rawTransaction
  );
}
function isReconstructableEoa(
  tx: Transaction,
  entry: Pick<
    EvmSignedRecordSummary,
    'operation' | 'metadata' | 'signer' | 'from' | 'hash' | 'nonce' | 'chainId'
  >
): boolean {
  if (
    !tx.to ||
    (tx.type !== 0 && tx.type !== 2) ||
    !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(entry.signer.type)
  )
    return false;
  const { operation, metadata } = entry;
  if (
    Object.keys(metadata ?? {}).some(
      (key) => key !== 'intent' && key !== 'nftTransfer'
    )
  )
    return false;
  if (
    tx.to.toLowerCase() ===
      getPaliEntryPointAddress(Number(tx.chainId)).toLowerCase() ||
    getPrivacyPoolActivity(tx.chainId.toString(), tx.to, tx.data.slice(0, 10))
  )
    return false;
  if (operation === 'send') return metadata === undefined;
  if (operation === 'speed-up' && !metadata?.intent && !metadata?.nftTransfer)
    return true;
  if (tx.value !== BigInt(0) || tx.accessList?.length) return false;
  try {
    if (
      operation === 'erc20' ||
      (operation === 'speed-up' && metadata?.intent)
    ) {
      const decoded = decodeErc20Transfer(tx.data);
      if (metadata?.nftTransfer) return false;
      if (!metadata?.intent) return true;
      const intent = metadata.intent as Record<string, unknown>;
      const token = createErc20Policy(getAddress).parseMetadata(intent.token);
      return (
        intent.kind === 'erc20-transfer' &&
        intent.chainId === entry.chainId &&
        getAddress(token.contractAddress) === tx.to &&
        getAddress(String(intent.recipient)).toLowerCase() ===
          decoded.recipient &&
        intent.amountUnits === decoded.amountUnits
      );
    }
    return !!decodeRetainedNftTransfer(
      {
        ...entry,
        ...(tx.isSigned()
          ? { rawTransaction: tx.serialized }
          : { unsignedTransaction: tx.unsignedSerialized }),
      },
      tx
    );
  } catch {
    return false;
  }
}
function sameEoaExecution(a: Transaction, b: Transaction): boolean {
  return (
    a.to === b.to &&
    a.data === b.data &&
    a.value === b.value &&
    a.gasLimit === b.gasLimit &&
    a.type === b.type &&
    JSON.stringify(a.accessList ?? []) === JSON.stringify(b.accessList ?? [])
  );
}
export type EvmRetainedSmartAccountRecord = Readonly<{
  cancellation?: RetainedSmartAccountCancellation;
  entry: EvmRetainedSignedRecord;
  operations: readonly RetainedSmartAccountOperation[];
}>;

type VerifiedPendingOriginal = Readonly<{
  chainId: string;
  from: string;
  nonce: number;
  operation: 'cancel' | 'speed-up';
  originalHash: string;
}>;
export type EvmVerifiedReplacementBinding = VerifiedPendingOriginal &
  Readonly<{
    expectedTipHash: string | null;
    profileId: string;
    resetGeneration: number;
  }>;
const verifiedReplacementBindings =
  new WeakSet<EvmVerifiedReplacementBinding>();
export type EvmReplacementRates = Readonly<
  | { gasPrice: bigint; type: 0 }
  | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; type: 2 }
>;
/** Pali-owned permission to replace an outer nonce with an inner-nonce revocation. */
export type EvmVerifiedSmartAccountReplacement = Readonly<{
  chainId: string;
  expectedTipHash: string;
  from: string;
  nonce: number;
  operation: 'send';
  originalHash: string;
  profileId: string;
  rates: EvmReplacementRates;
  resetGeneration: number;
}>;
const smartAccountReplacementBindings = new WeakMap<
  EvmVerifiedSmartAccountReplacement,
  Readonly<{
    assertCurrent(): void;
    data: string;
    metadata: SmartAccountCancellationMetadata;
    userOperation: SmartAccountPackedUserOperation;
  }>
>();
export function isEvmVerifiedSmartAccountReplacement(
  value: unknown
): value is EvmVerifiedSmartAccountReplacement {
  return (
    !!value &&
    typeof value === 'object' &&
    smartAccountReplacementBindings.has(
      value as EvmVerifiedSmartAccountReplacement
    )
  );
}
export function assertEvmVerifiedSmartAccountReplacement(
  value: EvmVerifiedSmartAccountReplacement
): void {
  const binding = smartAccountReplacementBindings.get(value);
  if (!binding) throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
  binding.assertCurrent();
}

function bindVerifiedReplacement(
  original: VerifiedPendingOriginal,
  profileId: string,
  expectedTipHash: string | null,
  resetGeneration: number
): EvmVerifiedReplacementBinding {
  const binding = Object.freeze({
    ...original,
    profileId,
    expectedTipHash,
    resetGeneration,
  });
  verifiedReplacementBindings.add(binding);
  return binding;
}

function isPendingPhase(phase: EvmSignedPhase): boolean {
  return phase === 'signed' || phase === 'attempted' || phase === 'submitted';
}

function matchesNonce(
  entry: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>,
  {
    chainId,
    from,
    nonce,
  }: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>
): boolean {
  return (
    entry.chainId === chainId && entry.from === from && entry.nonce === nonce
  );
}

function isCancellationEnvelope(tx: Transaction): boolean {
  return isEvmProtectedEmptySelfCall(tx, 'cancel');
}

function repricesCancellation(tx: Transaction, original: Transaction): boolean {
  return (
    isCancellationEnvelope(tx) &&
    tx.type === original.type &&
    tx.gasLimit === original.gasLimit
  );
}

type Entry = EvmSignedRecordSummary &
  Readonly<{
    chunks: readonly IEncryptedPrivateRecord[];
    payloadKind?: 'unsigned-eoa';
  }>;
type AuthorizationEntry = SmartAccountAuthorizationSummary &
  Readonly<{ chunks: readonly IEncryptedPrivateRecord[] }>;
type MinedObservation = Extract<EvmTransactionObservation, { status: 'mined' }>;

function completedNonceGroups(entries: readonly Entry[]): readonly Entry[][] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = `${entry.chainId}:${entry.from}:${entry.nonce}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].filter(
    (group) =>
      group.every((entry) => !isPendingPhase(entry.phase)) &&
      group.some(
        (entry) => entry.phase === 'confirmed' || entry.phase === 'reverted'
      )
  );
}

function retainedReplacementLineage(
  sameNonce: readonly Entry[],
  retainedIndex: number
): readonly Entry[] | null {
  const lineage = sameNonce.slice(retainedIndex);
  const known = new Set([lineage[0]!.hash]);
  for (const entry of lineage.slice(1)) {
    if (
      entry.operation !== 'speed-up' ||
      !entry.originalHash ||
      !known.has(entry.originalHash) ||
      (entry.phase !== 'signed' && entry.phase !== 'attempted')
    )
      return null;
    known.add(entry.hash);
  }
  return lineage;
}

function replacementMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  original: EvmRetainedRecord | null | undefined,
  operation: 'cancel' | 'speed-up'
) {
  const fields = { ...metadata };
  delete fields.nftTransfer;
  // Cancellation is an empty self-call; the original asset intent is not its consent.
  if (operation === 'cancel') delete fields.intent;
  const nftTransfer =
    operation === 'speed-up' &&
    original &&
    decodeRetainedNftTransfer(original, retainedEvmTransaction(original));
  if (nftTransfer) fields.nftTransfer = nftTransfer;
  if (operation === 'speed-up' && original?.metadata?.intent !== undefined)
    fields.intent = original.metadata.intent;
  return Object.keys(fields).length ? snapshotMetadata(fields) : undefined;
}

export type EvmSignedRetirementReadMethod =
  | 'eth_getTransactionReceipt'
  | 'eth_chainId'
  | 'eth_getBlockByNumber'
  | 'eth_getTransactionCount';
export type EvmSignedRetirementRead = (
  method: EvmSignedRetirementReadMethod,
  params: readonly unknown[]
) => Promise<unknown>;
export type EvmSignedRetirementReadForChain = (
  chainId: string,
  signal: AbortSignal,
  assertCurrent: () => void
) => EvmSignedRetirementRead | null;
type NonceFloor = Readonly<{ chainId: string; from: string; nonce: number }>;
const ROOT_PLAINTEXT_LIMIT = 64 * 1024;
const FINALITY_TIMEOUT_MS = 12_000;
const floorKey = ({ chainId, from }: Pick<NonceFloor, 'chainId' | 'from'>) =>
  `${chainId}:${from}`;
function nonceFloors(value: unknown): readonly NonceFloor[] {
  if (!Array.isArray(value)) return invalid();
  let previous = '';
  return Object.freeze(
    value.map((item) => {
      const floor = exact(item, ['chainId', 'from', 'nonce']);
      if (
        typeof floor.chainId !== 'string' ||
        !/^[1-9][0-9]{0,77}$/.test(floor.chainId) ||
        BigInt(floor.chainId) >= BigInt(1) << BigInt(256) ||
        typeof floor.from !== 'string' ||
        getAddress(floor.from).toLowerCase() !== floor.from ||
        !Number.isSafeInteger(floor.nonce) ||
        floor.nonce < 0
      )
        return invalid();
      const key = floorKey(floor as NonceFloor);
      if (key <= previous) return invalid();
      previous = key;
      return Object.freeze({
        chainId: floor.chainId,
        from: floor.from,
        nonce: floor.nonce,
      });
    })
  );
}
function minimumNonce(
  bundle: Bundle | null,
  scope: Pick<NonceFloor, 'chainId' | 'from'>
): number {
  return (
    bundle?.nonceFloors.find((floor) => floorKey(floor) === floorKey(scope))
      ?.nonce ?? 0
  );
}
function assertNonceFloor(bundle: Bundle | null, scope: NonceFloor): void {
  if (scope.nonce < minimumNonce(bundle, scope))
    throw Object.assign(new Error('EVM_SIGNED_RECORD_NONCE_FINALIZED'), {
      transactionNotBroadcast: true,
    });
}
type ParsedBundle = Readonly<{
  authorizations: readonly AuthorizationEntry[];
  entries: readonly Entry[];
  hasAuthorizations: boolean;
  profileId: string;
  revision: number;
  root: IEncryptedPrivateRecord;
  version: 1;
}>;
type Bundle = ParsedBundle &
  Readonly<{
    nonceFloors: readonly NonceFloor[];
    resetGeneration: number;
  }>;
const queues = new WeakMap<EvmSignedRecordStorage, Promise<unknown>>();
// Reset invalidates work immediately, including work waiting on the storage queue.
const resetSerials = new WeakMap<EvmSignedRecordStorage, number>();
type SessionGeneration = { persisted?: number; serial: number };
const invalid = (): never => {
  throw new Error('EVM_SIGNED_RECORD_CORRUPT');
};
// A private identity proves this refusal arose while adding to an authenticated
// journal, before its storage write and before signed-byte dispatch.
const appendCapacityLimits = new WeakSet<object>();
const signedCapacityRefusals = new WeakMap<
  object,
  { hash: string; token: object }
>();
let currentPersistToken: object | undefined;
export function consumeSignedEvmCapacityRefusal(
  error: unknown,
  readFailure?: (failure: unknown) =>
    | Readonly<{
        signedTransactionHash?: string;
        transactionNotBroadcast: boolean;
      }>
    | undefined
): boolean {
  if (!error || typeof error !== 'object') return false;
  const refusal = signedCapacityRefusals.get(error);
  if (!refusal || refusal.token !== currentPersistToken || !readFailure)
    return false;
  const { hash } = refusal;
  // Only SDK-owned failure metadata for this exact signed envelope can
  // establish that its dispatch never started.
  let failure: ReturnType<NonNullable<typeof readFailure>>;
  try {
    failure = readFailure(error);
  } catch {
    return false;
  }
  const matches =
    failure?.transactionNotBroadcast === true &&
    failure.signedTransactionHash === hash &&
    'transactionNotBroadcast' in error &&
    error.transactionNotBroadcast === true &&
    'signedTransactionHash' in error &&
    error.signedTransactionHash === hash;
  if (matches) signedCapacityRefusals.delete(error);
  return matches;
}
const limit = (): never => {
  const error = new Error('EVM_SIGNED_RECORD_CAPACITY');
  throw error;
};
const appendLimit = (): never => {
  const error = new Error('EVM_SIGNED_RECORD_CAPACITY');
  appendCapacityLimits.add(error);
  throw error;
};
function exact(value: unknown, fields: readonly string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return invalid();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return invalid();
  }
  return value as Record<string, any>;
}
function snapshotMetadata(
  value: unknown,
  depth = 0,
  budget = { nodes: 0 }
): any {
  if (++budget.nodes > 1024 || depth > 8) return invalid();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 8192) return invalid();
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid();
    return value;
  }
  if (!value || typeof value !== 'object') return invalid();
  if (Array.isArray(value)) {
    if (
      value.length > 1024 ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      return invalid();
    return Object.freeze(
      value.map((_, i) => {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !('value' in d)) return invalid();
        return snapshotMetadata(d.value, depth + 1, budget);
      })
    );
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      key === '__proto__' ||
      !d ||
      !d.enumerable ||
      !('value' in d)
    )
      return invalid();
    out[key] = snapshotMetadata(d.value, depth + 1, budget);
  }
  return Object.freeze(out);
}
function envelope(
  value: unknown,
  profileId: string,
  domain: string,
  recordId: string
): IEncryptedPrivateRecord {
  const data = exact(value, [
    'version',
    'profileId',
    'domain',
    'recordId',
    'nonce',
    'ciphertext',
  ]);
  if (
    data.version !== 1 ||
    data.profileId !== profileId ||
    data.domain !== domain ||
    data.recordId !== recordId ||
    typeof data.nonce !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(data.nonce) ||
    typeof data.ciphertext !== 'string' ||
    data.ciphertext.length < 24 ||
    data.ciphertext.length > Math.ceil((64 * 1024 + 16) / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data.ciphertext
    )
  )
    return invalid();
  return Object.freeze({ ...data }) as IEncryptedPrivateRecord;
}
function parse(raw: string, expectedProfile?: string): ParsedBundle {
  if (
    typeof raw !== 'string' ||
    raw.length > EVM_SIGNED_RECORD_LIMITS.bytes ||
    encoder.encode(raw).length > EVM_SIGNED_RECORD_LIMITS.bytes
  )
    return limit();
  assertJsonTextBudget(raw, {
    depth: 16,
    nodes: 500000,
    tokenCharacters: 100000,
  });
  const decoded = JSON.parse(raw);
  const hasAuthorizations =
    !!decoded &&
    typeof decoded === 'object' &&
    Object.hasOwn(decoded, 'authorizations');
  const value = exact(decoded, [
    'version',
    'profileId',
    'revision',
    'root',
    'entries',
    ...(hasAuthorizations ? ['authorizations'] : []),
  ]);
  if (
    JSON.stringify(value) !== raw ||
    value.version !== 1 ||
    !PROFILE.test(value.profileId) ||
    (expectedProfile !== undefined && value.profileId !== expectedProfile) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length > EVM_SIGNED_RECORD_LIMITS.transactions ||
    (hasAuthorizations &&
      (!Array.isArray(value.authorizations) ||
        value.entries.length + value.authorizations.length >
          EVM_SIGNED_RECORD_LIMITS.transactions))
  )
    return invalid();
  const hashes = new Set<string>();
  const entries: Entry[] = value.entries.map((input: unknown) => {
    const keys = input && typeof input === 'object' ? Object.keys(input) : [];
    const data = exact(input, [
      'hash',
      'chainId',
      'from',
      'nonce',
      'phase',
      'createdAt',
      'signer',
      'operation',
      'chunks',
      ...(keys.includes('payloadKind') ? ['payloadKind'] : []),
      ...(keys.includes('originalHash') ? ['originalHash'] : []),
      ...(keys.includes('metadata') ? ['metadata'] : []),
    ]);
    if (
      (keys.includes('payloadKind') &&
        (data.payloadKind !== 'unsigned-eoa' ||
          !['send', 'speed-up', 'erc20', 'erc721', 'erc1155'].includes(
            data.operation
          ))) ||
      !HASH.test(data.hash) ||
      hashes.has(data.hash) ||
      typeof data.chainId !== 'string' ||
      !/^[1-9][0-9]{0,77}$/.test(data.chainId) ||
      BigInt(data.chainId) >= BigInt(1) << BigInt(256) ||
      typeof data.from !== 'string' ||
      getAddress(data.from).toLowerCase() !== data.from ||
      !Number.isSafeInteger(data.nonce) ||
      data.nonce < 0 ||
      !Number.isSafeInteger(data.createdAt) ||
      data.createdAt < 0 ||
      !SIGNED_PHASES.includes(data.phase) ||
      !['send', 'cancel', 'speed-up', 'erc20', 'erc721', 'erc1155'].includes(
        data.operation
      ) ||
      (data.originalHash !== undefined && !HASH.test(data.originalHash)) ||
      !Array.isArray(data.chunks) ||
      !data.chunks.length
    )
      return invalid();
    exact(data.signer, ['id', 'type']);
    if (
      !Number.isSafeInteger(data.signer.id) ||
      data.signer.id < 0 ||
      typeof data.signer.type !== 'string' ||
      !data.signer.type ||
      data.signer.type.length > 64
    )
      return invalid();
    if (
      data.metadata !== undefined &&
      (!data.metadata ||
        typeof data.metadata !== 'object' ||
        Array.isArray(data.metadata))
    )
      return invalid();
    hashes.add(data.hash);
    return Object.freeze({
      ...data,
      signer: Object.freeze({ ...data.signer }),
      chunks: Object.freeze(
        data.chunks.map((chunk: unknown, i: number) =>
          envelope(
            chunk,
            value.profileId,
            data.payloadKind ? UNSIGNED_CHUNK_DOMAIN : CHUNK_DOMAIN,
            `${data.hash}/${i}`
          )
        )
      ),
    }) as Entry;
  });
  const authorizationHashes = new Set<string>();
  const authorizations: AuthorizationEntry[] = (
    hasAuthorizations ? value.authorizations : []
  ).map((input: unknown) => {
    const data = exact(input, [
      'account',
      'chainId',
      'createdAt',
      'observedAt',
      'operationHash',
      'operationNonce',
      'payer',
      'chunks',
      ...(input &&
      typeof input === 'object' &&
      Object.hasOwn(input, 'replacesOperationHash')
        ? ['replacesOperationHash']
        : []),
    ]);
    const { chunks, ...header } = data;
    const captured = captureSmartAccountAuthorizationSummary(header);
    if (
      authorizationHashes.has(captured.operationHash) ||
      !Array.isArray(chunks) ||
      !chunks.length
    )
      return invalid();
    authorizationHashes.add(captured.operationHash);
    return Object.freeze({
      ...captured,
      chunks: Object.freeze(
        chunks.map((chunk: unknown, i: number) =>
          envelope(
            chunk,
            value.profileId,
            CHUNK_DOMAIN,
            `authorization/${captured.operationHash}/${i}`
          )
        )
      ),
    });
  });
  return Object.freeze({
    version: 1,
    profileId: value.profileId,
    revision: value.revision,
    root: envelope(value.root, value.profileId, ROOT_DOMAIN, 'manifest'),
    entries: Object.freeze(entries),
    authorizations: Object.freeze(authorizations),
    hasAuthorizations,
  });
}
/** Structural physical admission only; authenticated completeness is checked after SDK decryption. */
export function inspectEvmSignedBundle(
  raw: string,
  expectedProfile?: string
): Readonly<{
  bytes: number;
  profileId: string;
  revision: number;
  transactions: number;
}> {
  const value = parse(raw, expectedProfile);
  return Object.freeze({
    profileId: value.profileId,
    revision: value.revision,
    transactions: value.entries.length + value.authorizations.length,
    bytes: encoder.encode(raw).length,
  });
}
function guard(session: EvmSignedRecordSession): void {
  const result: unknown = session.assertCurrent();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
  }
}
async function profile(session: EvmSignedRecordSession): Promise<string> {
  guard(session);
  const id = await session.keyring.getPrivateRecordProfileId();
  guard(session);
  if (!PROFILE.test(id)) return invalid();
  return id;
}
function summary(entry: Entry): EvmSignedRecordSummary {
  const { chunks: _chunks, payloadKind: _payloadKind, ...value } = entry;
  void _payloadKind;
  void _chunks;
  return Object.freeze(value);
}
async function entriesHash(entries: readonly unknown[]): Promise<string> {
  const bytes = encoder.encode(JSON.stringify(entries));
  try {
    return sha256(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** One portable retention policy; host ports own physical atomicity and protection. */
export class EvmSignedRecords {
  readonly autoNonceAcceptance = new EvmAutoNonceAcceptance();
  private readonly storage: EvmSignedRecordStorage;
  private readonly freshAppends = new WeakMap<
    EvmRetainedSignedRecord,
    { dispatchSerial: number; profileId: string; revision: number }
  >();
  private readonly now: () => number;
  private readonly onUnavailable: () => void;
  private unavailable = false;
  private retirementCursor?: Readonly<{ profileId: string; scope: string }>;
  private readonly retirementGroupCursors = new Map<
    string,
    { nonce: number; resume: boolean }
  >();
  private readonly sessionParents = new WeakMap<
    EvmSignedRecordSession,
    EvmSignedRecordSession
  >();
  private readonly sessionGenerations = new WeakMap<
    EvmSignedRecordSession,
    SessionGeneration
  >();
  get requiresReopen(): boolean {
    return this.unavailable;
  }
  constructor(
    storage: EvmSignedRecordStorage,
    now = Date.now,
    onUnavailable: () => void = () => undefined
  ) {
    this.storage = storage;
    this.now = now;
    this.onUnavailable = onUnavailable;
  }
  /** Capture before signing or starting asynchronous reads. A reset revokes the
   * captured authority even if an old callback obtains the storage queue later. */
  captureSession(session: EvmSignedRecordSession): EvmSignedRecordSession {
    const generation = this.sessionGenerations.get(session) ?? {
      serial: resetSerials.get(this.storage) ?? 0,
    };
    this.sessionGenerations.set(session, generation);
    const captured = {
      keyring: session.keyring,
      assertCurrent: () => {
        guard(session);
        if (generation.serial !== (resetSerials.get(this.storage) ?? 0))
          throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
      },
    };
    this.sessionGenerations.set(captured, generation);
    this.sessionParents.set(captured, session);
    guard(captured);
    return captured;
  }

  private bindGeneration(session: EvmSignedRecordSession, persisted: number) {
    const generation = this.sessionGenerations.get(session);
    if (!generation) throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
    if (
      generation.persisted !== undefined &&
      generation.persisted !== persisted
    )
      throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
    generation.persisted = persisted;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.storage) ?? Promise.resolve();
    const pending = previous
      .then(() => {
        if (this.unavailable)
          throw new Error('EVM_SIGNED_RECORD_REOPEN_REQUIRED');
        return operation();
      })
      .catch((error) => {
        if (
          (error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'STORAGE_REOPEN_REQUIRED') ||
          (error instanceof Error &&
            error.message === 'EVM_SIGNED_RECORD_REOPEN_REQUIRED')
        ) {
          if (!this.unavailable) {
            this.unavailable = true;
            this.onUnavailable();
          }
        }
        throw error;
      });
    queues.set(
      this.storage,
      pending.catch(() => undefined)
    );
    return pending;
  }
  private async load(
    session: EvmSignedRecordSession,
    id: string
  ): Promise<{ bundle: Bundle | null; raw: string | undefined }> {
    guard(session);
    const raw = await this.storage.read(id);
    guard(session);
    if (raw === undefined) {
      this.bindGeneration(session, 0);
      return { raw, bundle: null };
    }
    const parsed = parse(raw, id);
    const plaintext = await session.keyring.decryptPrivateRecord({
      domain: ROOT_DOMAIN,
      recordId: 'manifest',
      envelope: parsed.root,
    });
    let floors: readonly NonceFloor[];
    let resetGeneration: number;
    try {
      guard(session);
      if (plaintext.length > ROOT_PLAINTEXT_LIMIT) return invalid();
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
      );
      const hasFloors =
        !!value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'nonceFloors');
      const hasResetGeneration =
        !!value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'resetGeneration');
      const hasAuthorizationCount =
        !!value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'authorizations');
      const hasAuthorizationHash =
        !!value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'authorizationsHash');
      const hasAuthorizationEntries = parsed.hasAuthorizations;
      if (
        hasAuthorizationCount !== hasAuthorizationHash ||
        hasAuthorizationCount !== hasAuthorizationEntries
      )
        return invalid();
      const root = exact(value, [
        'version',
        'revision',
        'transactions',
        'entriesHash',
        ...(hasFloors ? ['nonceFloors'] : []),
        ...(hasResetGeneration ? ['resetGeneration'] : []),
        ...(hasAuthorizationCount
          ? ['authorizations', 'authorizationsHash']
          : []),
      ]);
      if (
        root.version !== 1 ||
        root.revision !== parsed.revision ||
        root.transactions !== parsed.entries.length ||
        root.entriesHash !== (await entriesHash(parsed.entries)) ||
        (hasAuthorizationCount &&
          (root.authorizations !== parsed.authorizations.length ||
            root.authorizationsHash !==
              (await entriesHash(parsed.authorizations))))
      )
        return invalid();
      floors = nonceFloors(hasFloors ? root.nonceFloors : []);
      resetGeneration = hasResetGeneration ? root.resetGeneration : 0;
      if (!Number.isSafeInteger(resetGeneration) || resetGeneration < 0)
        return invalid();
      this.bindGeneration(session, resetGeneration);
    } finally {
      plaintext.fill(0);
    }
    const bundle: Bundle = Object.freeze({
      ...parsed,
      nonceFloors: floors,
      resetGeneration,
    });
    const byScope = new Map(
      floors.map((floor) => [floorKey(floor), floor.nonce])
    );
    for (const entry of bundle.entries)
      if (entry.nonce < (byScope.get(floorKey(entry)) ?? 0)) return invalid();
    guard(session);
    return { raw, bundle };
  }
  private async write(
    session: EvmSignedRecordSession,
    id: string,
    before: string | undefined,
    revision: number,
    entries: readonly Entry[],
    authorizations: readonly AuthorizationEntry[],
    floors: readonly NonceFloor[],
    reserveStatusGrowth: boolean,
    resetGeneration: number,
    verifyBeforeCommit?: () => Promise<() => void>
  ): Promise<boolean> {
    if (!Number.isSafeInteger(revision)) return limit();
    if (
      entries.length + authorizations.length >
      EVM_SIGNED_RECORD_LIMITS.transactions
    )
      return reserveStatusGrowth ? appendLimit() : limit();
    const digest = await entriesHash(entries);
    guard(session);
    const bytes = encoder.encode(
      JSON.stringify({
        version: 1,
        revision,
        transactions: entries.length,
        entriesHash: digest,
        ...(authorizations.length
          ? {
              authorizations: authorizations.length,
              authorizationsHash: await entriesHash(authorizations),
            }
          : {}),
        nonceFloors: nonceFloors(floors),
        ...(resetGeneration ? { resetGeneration } : {}),
      })
    );
    let root: IEncryptedPrivateRecord;
    try {
      if (
        bytes.length + MAX_REVISION_DIGITS - String(revision).length >
        ROOT_PLAINTEXT_LIMIT
      )
        return reserveStatusGrowth ? appendLimit() : limit();
      root = await session.keyring.encryptPrivateRecord({
        domain: ROOT_DOMAIN,
        recordId: 'manifest',
        plaintext: bytes,
      });
      guard(session);
    } finally {
      bytes.fill(0);
    }
    const next = JSON.stringify({
      version: 1,
      profileId: id,
      revision,
      root: envelope(root, id, ROOT_DOMAIN, 'manifest'),
      entries,
      ...(authorizations.length ? { authorizations } : {}),
    });
    // The prior bundle was already authenticated. Distinguish a newly
    // generated over-limit append from an oversized/corrupt stored bundle.
    if (
      reserveStatusGrowth &&
      (next.length > EVM_SIGNED_RECORD_LIMITS.bytes ||
        encoder.encode(next).length > EVM_SIGNED_RECORD_LIMITS.bytes)
    )
      return appendLimit();
    const inspected = inspectEvmSignedBundle(next, id);
    if (reserveStatusGrowth) {
      // Entry fields other than the ASCII phase are immutable. For fixed entry
      // count, the root plaintext can grow only with revision digits (at most
      // 16). AES-GCM adds a fixed tag; base64 grows by at most 4*ceil(delta/3).
      // Reserve every entry's largest phase plus both revision representations.
      const revisionGrowth = MAX_REVISION_DIGITS - String(revision).length;
      const phaseGrowth = entries.reduce(
        (sum, entry) => sum + MAX_PHASE_BYTES - entry.phase.length,
        0
      );
      const headroom =
        phaseGrowth + revisionGrowth + 4 * Math.ceil(revisionGrowth / 3);
      if (inspected.bytes > EVM_SIGNED_RECORD_LIMITS.bytes - headroom)
        return appendLimit();
    }
    const assertFresh = verifyBeforeCommit
      ? await verifyBeforeCommit()
      : undefined;
    const assertWrite = () => {
      guard(session);
      assertFresh?.();
    };
    assertWrite();
    mutationSerials.set(
      this.storage,
      (mutationSerials.get(this.storage) ?? 0) + 1
    );
    const committed = await this.storage.compareAndSet(
      id,
      before,
      next,
      assertWrite
    );
    guard(session);
    if (typeof committed !== 'boolean')
      throw new Error('EVM_SIGNED_RECORD_REOPEN_REQUIRED');
    return committed;
  }
  private async materialize(
    session: EvmSignedRecordSession,
    entry: Entry
  ): Promise<EvmRetainedSignedRecord> {
    const record = await this.materializeRecord(session, entry);
    if (record.payloadKind === 'unsigned-eoa')
      throw new Error('EVM_SIGNED_RECORD_REQUIRES_NEW_SIGNATURE');
    return record;
  }

  private async materializeRecord(
    session: EvmSignedRecordSession,
    entry: Entry
  ): Promise<EvmRetainedRecord> {
    const pieces: Uint8Array[] = [];
    try {
      for (let i = 0; i < entry.chunks.length; i++) {
        guard(session);
        const bytes = await session.keyring.decryptPrivateRecord({
          domain: entry.payloadKind ? UNSIGNED_CHUNK_DOMAIN : CHUNK_DOMAIN,
          recordId: `${entry.hash}/${i}`,
          envelope: entry.chunks[i]!,
        });
        pieces.push(bytes);
        guard(session);
        if (!bytes.length || bytes.length > EVM_SIGNED_RECORD_LIMITS.chunkBytes)
          return invalid();
      }
      const rawTransaction = concat(pieces);
      const tx = Transaction.from(rawTransaction);
      if (entry.payloadKind === 'unsigned-eoa') {
        if (
          tx.isSigned() ||
          tx.unsignedSerialized !== rawTransaction ||
          !isReconstructableEoa(tx, entry) ||
          tx.chainId.toString() !== entry.chainId ||
          tx.nonce !== entry.nonce
        )
          return invalid();
        return Object.freeze({
          ...summary(entry),
          payloadKind: 'unsigned-eoa',
          unsignedTransaction: rawTransaction,
        });
      }
      if (
        !tx.isSigned() ||
        tx.serialized !== rawTransaction ||
        tx.hash !== entry.hash ||
        tx.from?.toLowerCase() !== entry.from ||
        tx.chainId.toString() !== entry.chainId ||
        tx.nonce !== entry.nonce
      )
        return invalid();
      return Object.freeze({ ...summary(entry), rawTransaction });
    } finally {
      pieces.forEach((bytes) => bytes.fill(0));
    }
  }

  private authorizationReceipt(
    session: EvmSignedRecordSession,
    profileId: string,
    record: RetainedSmartAccountAuthorization
  ): SmartAccountAuthorizationReceipt {
    const receipt = Object.freeze({ operationHash: record.operationHash });
    authorizationReceipts.set(receipt, {
      assertCurrent: () => guard(session),
      profileId,
      record,
      storage: this.storage,
    });
    return receipt;
  }
  private async materializeAuthorization(
    session: EvmSignedRecordSession,
    entry: AuthorizationEntry
  ): Promise<RetainedSmartAccountAuthorization> {
    const pieces: Uint8Array[] = [];
    try {
      let total = 0;
      for (let i = 0; i < entry.chunks.length; i++) {
        guard(session);
        const part = await session.keyring.decryptPrivateRecord({
          domain: CHUNK_DOMAIN,
          recordId: `authorization/${entry.operationHash}/${i}`,
          envelope: entry.chunks[i]!,
        });
        pieces.push(part);
        guard(session);
        total += part.length;
        if (
          !part.length ||
          part.length > EVM_SIGNED_RECORD_LIMITS.chunkBytes ||
          total > EVM_SIGNED_RECORD_LIMITS.bytes
        )
          return invalid();
      }
      const payload = new Uint8Array(total);
      try {
        let offset = 0;
        for (const part of pieces) {
          payload.set(part, offset);
          offset += part.length;
        }
        const { chunks: _chunks, ...header } = entry;
        void _chunks;
        return decodeSmartAccountAuthorization(header, payload);
      } finally {
        payload.fill(0);
      }
    } finally {
      for (const part of pieces) part.fill(0);
    }
  }
  private async encryptAuthorization(
    session: EvmSignedRecordSession,
    id: string,
    record: RetainedSmartAccountAuthorization,
    payload: Uint8Array
  ): Promise<AuthorizationEntry> {
    const chunks: IEncryptedPrivateRecord[] = [];
    for (
      let offset = 0;
      offset < payload.length;
      offset += EVM_SIGNED_RECORD_LIMITS.chunkBytes
    ) {
      const part = payload.slice(
        offset,
        offset + EVM_SIGNED_RECORD_LIMITS.chunkBytes
      );
      try {
        const recordId = `authorization/${record.operationHash}/${chunks.length}`;
        const encrypted = await session.keyring.encryptPrivateRecord({
          domain: CHUNK_DOMAIN,
          recordId,
          plaintext: part,
        });
        guard(session);
        chunks.push(envelope(encrypted, id, CHUNK_DOMAIN, recordId));
      } finally {
        part.fill(0);
      }
    }
    return Object.freeze({
      ...smartAccountAuthorizationSummary(record),
      chunks: Object.freeze(chunks),
    });
  }
  /** Reserve the inner operation nonce before an estimate, simulation or delivery can disclose its proof. */
  retainSmartAccountAuthorization(
    session: EvmSignedRecordSession,
    input: Readonly<{
      chainId: number;
      observedAt: SmartAccountAuthorizationBlock;
      payer: string;
      replacesOperationHash?: string;
      userOperation: SmartAccountPackedUserOperation;
    }>
  ): Promise<SmartAccountAuthorizationReceipt> {
    session = this.captureSession(session);
    const record = captureSmartAccountAuthorization({
      ...input,
      createdAt: this.now(),
    });
    const payload = encodeSmartAccountAuthorization(record);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        const duplicate = previous.bundle?.authorizations.find(
          (entry) => entry.operationHash === record.operationHash
        );
        if (duplicate) {
          const retained = await this.materializeAuthorization(
            session,
            duplicate
          );
          if (
            !sameUnsignedSmartAccountOperation(
              retained.userOperation,
              record.userOperation
            ) ||
            ((retained.signatureDigest ??
              keccak256(retained.userOperation.signature)) !==
              keccak256(record.userOperation.signature) &&
              (!record.replacesOperationHash ||
                !isSmartAccountRevocationOperation(record.userOperation))) ||
            retained.payer !== record.payer ||
            retained.replacesOperationHash !== record.replacesOperationHash
          )
            throw new Error('SMART_ACCOUNT_AUTHORIZATION_CONFLICT');
          return this.authorizationReceipt(
            session,
            id,
            retained.signatureDigest ? record : retained
          );
        }
        const conflicts = new Map<string, string>();
        const priorRevocations = new Set<string>();
        for (const entry of previous.bundle?.authorizations ?? []) {
          if (
            entry.account === record.account &&
            entry.chainId === record.chainId &&
            entry.operationNonce === record.operationNonce
          ) {
            conflicts.set(entry.operationHash, entry.operationNonce);
            if (
              record.replacesOperationHash &&
              entry.replacesOperationHash === record.replacesOperationHash &&
              isSmartAccountRevocationOperation(
                (await this.materializeAuthorization(session, entry))
                  .userOperation
              )
            )
              priorRevocations.add(entry.operationHash);
          }
        }
        // Historical signed outer records also disclose an independently live
        // instruction, even when that payer transaction reverted or was cancelled.
        for (const entry of previous.bundle?.entries ?? []) {
          if (
            entry.chainId !== record.chainId ||
            entry.payloadKind === 'unsigned-eoa'
          )
            continue;
          const outer = await this.materialize(session, entry);
          const cancellation =
            record.replacesOperationHash &&
            decodeSmartAccountCancellation(outer);
          for (const operation of decodeRetainedSmartAccountOperations(outer))
            if (
              operation.account === record.account &&
              operation.operationNonce === record.operationNonce
            ) {
              conflicts.set(
                operation.operationHash.toLowerCase(),
                operation.operationNonce
              );
              if (
                cancellation &&
                cancellation.originalOperationHash ===
                  record.replacesOperationHash
              )
                priorRevocations.add(operation.operationHash.toLowerCase());
            }
        }
        // An authenticated historical outer row may already contain these
        // identical inner fields. Backfill its signature without minting a nonce.
        conflicts.delete(record.operationHash);
        if (record.replacesOperationHash !== undefined) {
          if (
            !isSmartAccountRevocationOperation(record.userOperation) ||
            !conflicts.has(record.replacesOperationHash) ||
            [...conflicts.keys()].some(
              (hash) =>
                hash !== record.replacesOperationHash &&
                !priorRevocations.has(hash)
            )
          )
            throw new Error('SMART_ACCOUNT_AUTHORIZATION_CONFLICT');
        } else if (conflicts.size)
          throw new Error('SMART_ACCOUNT_AUTHORIZATION_CONFLICT');
        const entries = previous.bundle?.entries ?? [],
          authorizations = previous.bundle?.authorizations ?? [];
        if (
          entries.length + authorizations.length >=
            EVM_SIGNED_RECORD_LIMITS.transactions ||
          (previous.raw?.length ?? 0) + Math.ceil((payload.length * 4) / 3) >
            EVM_SIGNED_RECORD_LIMITS.bytes
        )
          return appendLimit();
        const added = await this.encryptAuthorization(
          session,
          id,
          record,
          payload
        );
        if (
          await this.write(
            session,
            id,
            previous.raw,
            (previous.bundle?.revision ?? -1) + 1,
            previous.bundle?.entries ?? [],
            [...(previous.bundle?.authorizations ?? []), added],
            previous.bundle?.nonceFloors ?? [],
            true,
            previous.bundle?.resetGeneration ?? 0
          )
        )
          return this.authorizationReceipt(session, id, record);
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    }).finally(() => payload.fill(0));
  }
  /** Free completed inner signatures only when space is needed, without querying other accounts. */
  retireConsumedSmartAccountAuthorizations(
    session: EvmSignedRecordSession,
    chainId: number,
    address: string,
    read: import('./smartAccountAuthorizationRetirement.ts').SmartAccountRetirementRead
  ): Promise<number> {
    session = this.captureSession(session);
    const account = getAddress(address);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id),
          bundle = previous.bundle;
        if (
          !bundle ||
          !bundle.authorizations.length ||
          (bundle.entries.length + bundle.authorizations.length <
            EVM_SIGNED_RECORD_LIMITS.transactions - 1 &&
            (previous.raw?.length ?? 0) <
              EVM_SIGNED_RECORD_LIMITS.bytes - 1024 * 1024)
        )
          return 0;
        const { prepareSmartAccountAuthorizationRetirement } = await import(
          /* webpackChunkName: "smart-account" */
          './smartAccountAuthorizationRetirement.ts'
        );
        guard(session);
        const proof = await prepareSmartAccountAuthorizationRetirement({
          account,
          chainId,
          authorizations: bundle.authorizations,
          read,
          assertCurrent: () => guard(session),
        });
        guard(session);
        if (!proof.hashes.length) return 0;
        const hashes = new Set(proof.hashes);
        const remaining = bundle.authorizations.filter(
          (entry) => !hashes.has(entry.operationHash)
        );
        if (
          await this.write(
            session,
            id,
            previous.raw,
            bundle.revision + 1,
            bundle.entries,
            remaining,
            bundle.nonceFloors,
            false,
            bundle.resetGeneration,
            async () => {
              await proof.revalidate();
              guard(session);
              return () => guard(session);
            }
          )
        )
          return bundle.authorizations.length - remaining.length;
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }

  readSmartAccountAuthorizationExact(
    session: EvmSignedRecordSession,
    chainId: string,
    account: string,
    operationHash: string
  ): Promise<RetainedSmartAccountAuthorization | null> {
    session = this.captureSession(session);
    account = getAddress(account);
    if (!HASH.test(operationHash))
      throw new Error('SMART_ACCOUNT_AUTHORIZATION_CORRUPT');
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      const entry = bundle?.authorizations.find(
        (value) =>
          value.operationHash === operationHash &&
          value.chainId === chainId &&
          value.account === account
      );
      return entry ? this.materializeAuthorization(session, entry) : null;
    });
  }
  listSmartAccountAuthorizations(
    session: EvmSignedRecordSession,
    chainId: string,
    account: string,
    options: Readonly<{
      after?: number;
      beforeHash?: string;
      includeOuterPresence?: true;
      maximum: number;
      withoutOuter?: boolean;
    }>
  ): Promise<
    Readonly<{
      entries: readonly SmartAccountAuthorizationSummary[];
      nextCursor: string | null;
      withOuterOperationHashes?: readonly string[];
    }>
  > {
    session = this.captureSession(session);
    account = getAddress(account);
    if (
      !Number.isSafeInteger(options.maximum) ||
      options.maximum < 1 ||
      options.maximum >
        (options.withoutOuter ? EVM_SIGNED_RECORD_LIMITS.transactions : 100) ||
      (options.beforeHash !== undefined && !HASH.test(options.beforeHash))
    )
      throw new Error('SMART_ACCOUNT_AUTHORIZATION_CORRUPT');
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      let matching = (bundle?.authorizations ?? []).filter(
        (entry) =>
          entry.chainId === chainId &&
          entry.account === account &&
          (options.after === undefined || entry.createdAt > options.after)
      );
      const findWithoutOuter = async (
        entries: readonly AuthorizationEntry[],
        includeLegacyPayers = false
      ) => {
        const unmatched = new Set(entries.map((entry) => entry.operationHash));
        const payers = includeLegacyPayers
          ? new Set(entries.map((entry) => entry.payer.toLowerCase()))
          : undefined;
        for (const outer of bundle?.entries ?? []) {
          if (!unmatched.size) break;
          const hint = outer.metadata?.smartAccountOperationHash;
          if (
            outer.chainId !== chainId ||
            outer.payloadKind === 'unsigned-eoa' ||
            (!isSmartAccountActivityCandidate(outer, account) &&
              !payers?.has(outer.from)) ||
            (typeof hint === 'string' && !unmatched.has(hint.toLowerCase()))
          )
            continue;
          const entry = await this.materialize(session, outer);
          for (const operation of decodeRetainedSmartAccountOperations(entry))
            if (operation.account === account)
              unmatched.delete(operation.operationHash.toLowerCase());
        }
        return unmatched;
      };
      if (options.withoutOuter && matching.length) {
        const unmatched = await findWithoutOuter(matching, true);
        matching = matching.filter((entry) =>
          unmatched.has(entry.operationHash)
        );
      }
      const end =
        options.beforeHash === undefined
          ? matching.length
          : matching.findIndex(
              (entry) => entry.operationHash === options.beforeHash
            );
      if (end < 0) throw new Error('SMART_ACCOUNT_AUTHORIZATION_CORRUPT');
      const start = Math.max(0, end - options.maximum);
      const page = matching.slice(start, end).reverse();
      // Presence annotations are scoped to the returned page and to the Smart
      // account records that mobile's Activity can project.
      const unmatched =
        options.includeOuterPresence && !options.withoutOuter
          ? await findWithoutOuter(page)
          : undefined;
      const entries = page.map((entry) => {
        const { chunks: _chunks, ...header } = entry;
        void _chunks;
        return Object.freeze(header);
      });
      const withOuterOperationHashes =
        unmatched &&
        Object.freeze(
          entries
            .map(({ operationHash }) => operationHash)
            .filter((hash) => !unmatched.has(hash))
        );
      guard(session);
      return Object.freeze({
        entries: Object.freeze(entries),
        nextCursor: start > 0 ? entries.at(-1)!.operationHash : null,
        ...(withOuterOperationHashes ? { withOuterOperationHashes } : {}),
      });
    });
  }

  private async replayableVariants(
    session: EvmSignedRecordSession,
    entries: readonly Entry[]
  ): Promise<readonly Entry[]> {
    const smart = new Set<string>();
    for (const entry of entries) {
      if (
        entry.operation === 'send' &&
        entry.metadata?.smartAccountOperationCancellation &&
        decodeSmartAccountCancellation(await this.materialize(session, entry))
      )
        smart.add(entry.hash);
    }
    const firstCancel = entries.findIndex(
      (entry) => entry.operation === 'cancel' || smart.has(entry.hash)
    );
    if (firstCancel < 0) return entries;
    const allowed = new Map<string, Transaction>();
    const result: Entry[] = [];
    for (const entry of entries.slice(firstCancel)) {
      const parent = entry.originalHash
        ? allowed.get(entry.originalHash)
        : undefined;
      if (
        entry.operation !== 'cancel' &&
        !smart.has(entry.hash) &&
        !(entry.operation === 'speed-up' && parent)
      )
        continue;
      const tx = retainedEvmTransaction(
        await this.materializeRecord(session, entry)
      );
      if (
        smart.has(entry.hash) ||
        (entry.operation === 'cancel'
          ? isCancellationEnvelope(tx)
          : smart.has(entry.originalHash ?? '')
          ? tx.to === parent!.to &&
            tx.data === parent!.data &&
            tx.value === parent!.value &&
            tx.type === parent!.type &&
            tx.gasLimit === parent!.gasLimit &&
            JSON.stringify(tx.accessList ?? []) ===
              JSON.stringify(parent!.accessList ?? [])
          : repricesCancellation(tx, parent!))
      ) {
        allowed.set(entry.hash, tx);
        if (smart.has(entry.originalHash ?? '')) smart.add(entry.hash);
        result.push(entry);
      }
    }
    return result;
  }

  /** Retention withdraws local permission to redisclose the old instruction;
   * it is not evidence that its on-chain nonce has been consumed. */
  private async revokedSmartAccountOperations(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    authorizations: readonly AuthorizationEntry[]
  ): Promise<ReadonlySet<string>> {
    const revoked = new Set<string>();
    for (const entry of authorizations) {
      if (!entry.replacesOperationHash) continue;
      const record = await this.materializeAuthorization(session, entry);
      if (!isSmartAccountRevocationOperation(record.userOperation))
        return invalid();
      revoked.add(record.replacesOperationHash!);
    }
    for (const entry of entries) {
      if (!entry.metadata?.smartAccountOperationCancellation) continue;
      const cancellation = decodeSmartAccountCancellation(
        await this.materialize(session, entry)
      );
      if (cancellation)
        revoked.add(cancellation.originalOperationHash.toLowerCase());
    }
    guard(session);
    return revoked;
  }

  private async withoutRevokedSmartAccountOperations(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    allEntries: readonly Entry[],
    authorizations: readonly AuthorizationEntry[]
  ): Promise<readonly Entry[]> {
    const revoked = await this.revokedSmartAccountOperations(
      session,
      allEntries,
      authorizations
    );
    if (!revoked.size) return entries;
    const retained: Entry[] = [];
    for (const entry of entries) {
      if (entry.payloadKind === 'unsigned-eoa') {
        retained.push(entry);
        continue;
      }
      const operations = decodeRetainedSmartAccountOperations(
        await this.materialize(session, entry)
      );
      if (
        !operations.some((operation) =>
          revoked.has(operation.operationHash.toLowerCase())
        )
      )
        retained.push(entry);
    }
    return retained;
  }

  private async cancellationFence(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    scope: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>
  ): Promise<Readonly<{ tip: Entry | undefined }> | undefined> {
    const sameNonce = entries.filter((entry) => matchesNonce(entry, scope));
    let fenced = sameNonce.some((entry) => entry.operation === 'cancel');
    for (const entry of sameNonce) {
      if (
        !fenced &&
        entry.metadata?.smartAccountOperationCancellation &&
        decodeSmartAccountCancellation(await this.materialize(session, entry))
      )
        fenced = true;
    }
    if (!fenced) return;
    const tip = (await this.replayableVariants(session, sameNonce)).at(-1);
    return { tip };
  }

  /** Only the authenticated pending tip of a cancellation lineage can be repriced. */
  readPendingCancellation(
    session: EvmSignedRecordSession,
    input: Omit<VerifiedPendingOriginal, 'operation'>
  ): Promise<string | null> {
    const scope = Object.freeze({
      ...input,
      from: getAddress(input.from).toLowerCase(),
    });
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const fence = await this.cancellationFence(
        session,
        bundle?.entries ?? [],
        scope
      );
      if (!fence) return null;
      const { tip } = fence;
      if (!tip || tip.hash !== scope.originalHash || !isPendingPhase(tip.phase))
        throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      return (await this.materialize(session, tip)).rawTransaction;
    });
  }

  private async assertOrdinaryNonceAvailable(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    scope: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>
  ): Promise<void> {
    const fence = await this.cancellationFence(session, entries, scope);
    guard(session);
    if (fence)
      throw new EvmSignedRecordCancellationFence(fence.tip?.hash ?? null);
    // A terminal observation can change in a reorg. An ordinary send never
    // replaces a retained nonce, even if it would produce the same wire hash.
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]!;
      if (matchesNonce(entry, scope))
        throw new EvmSignedRecordNonceConflict(entry);
    }
  }

  assertSpendingNonce(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    nonce: number
  ): Promise<void> {
    if (!Number.isSafeInteger(nonce) || nonce < 0)
      return Promise.reject(new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED'));
    const scope = { chainId, from: getAddress(address).toLowerCase(), nonce };
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      assertNonceFloor(bundle, scope);
      await this.assertOrdinaryNonceAvailable(
        session,
        bundle?.entries ?? [],
        scope
      );
      guard(session);
    });
  }

  private async smartAccountReplacementBasis(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    input: Readonly<{
      chainId: string;
      from: string;
      originalHash: string;
      userOperation: SmartAccountPackedUserOperation;
    }>
  ) {
    const selected = entries.find((entry) => entry.hash === input.originalHash);
    if (
      !selected ||
      selected.chainId !== input.chainId ||
      selected.from !== input.from ||
      !isPendingPhase(selected.phase)
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    const original = await this.materialize(session, selected);
    const decoded = decodeCancellationOuter(
      original.rawTransaction,
      Number(input.chainId)
    );
    const oldOperation = captureSignedSmartAccountOperation(decoded.operation);
    const operations = decodeRetainedSmartAccountOperations(original);
    if (
      operations.length !== 1 ||
      oldOperation.paymasterAndData !== '0x' ||
      input.userOperation.sender !== oldOperation.sender ||
      input.userOperation.nonce !== oldOperation.nonce ||
      !isSmartAccountRevocationOperation(input.userOperation) ||
      getSmartAccountUserOpHash(
        input.userOperation,
        Number(input.chainId)
      ).toLowerCase() === operations[0]!.operationHash.toLowerCase()
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    const expectedTipHash = await this.verifiedReplacementTip(
      session,
      entries,
      {
        chainId: input.chainId,
        from: input.from,
        nonce: selected.nonce,
        originalHash: selected.hash,
        operation: 'cancel',
      }
    );
    if (!expectedTipHash || (decoded.tx.type !== 0 && decoded.tx.type !== 2))
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    let cap = decoded.tx.maxFeePerGas ?? decoded.tx.gasPrice ?? BigInt(0);
    let priority = decoded.tx.maxPriorityFeePerGas ?? BigInt(0);
    const sameNonce = entries.filter((entry) => matchesNonce(entry, selected));
    const lineage = retainedReplacementLineage(
      sameNonce,
      sameNonce.indexOf(selected)
    );
    if (!lineage) throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    for (const entry of lineage.slice(1)) {
      const variant = retainedEvmTransaction(
        await this.materializeRecord(session, entry)
      );
      if (
        variant.type !== decoded.tx.type ||
        variant.to !== decoded.tx.to ||
        variant.value !== decoded.tx.value ||
        variant.data !== decoded.tx.data ||
        JSON.stringify(variant.accessList ?? []) !==
          JSON.stringify(decoded.tx.accessList ?? [])
      )
        throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      const rate = variant.maxFeePerGas ?? variant.gasPrice ?? BigInt(0);
      const tip = variant.maxPriorityFeePerGas ?? BigInt(0);
      if (rate > cap) cap = rate;
      if (tip > priority) priority = tip;
    }
    const rates: EvmReplacementRates =
      decoded.tx.type === 0
        ? Object.freeze({ type: 0, gasPrice: cap })
        : Object.freeze({
            type: 2,
            maxFeePerGas: cap,
            maxPriorityFeePerGas: priority,
          });
    return {
      original,
      expectedTipHash,
      rates,
      oldOperationHash: operations[0]!.operationHash.toLowerCase(),
    };
  }

  /** Authenticate the original outer nonce without introducing a new SDK operation kind. */
  captureSmartAccountCancellationReplacement(
    session: EvmSignedRecordSession,
    input: Readonly<{
      chainId: number;
      newUserOperation: SmartAccountPackedUserOperation;
      originalHash: string;
      payer: string;
    }>
  ): Promise<EvmVerifiedSmartAccountReplacement> {
    const originalHash = input.originalHash.toLowerCase(),
      chainId = String(input.chainId);
    const from = getAddress(input.payer).toLowerCase();
    const userOperation = captureSignedSmartAccountOperation(
      input.newUserOperation
    );
    if (
      !Number.isSafeInteger(input.chainId) ||
      input.chainId <= 0 ||
      !HASH.test(originalHash)
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      const basis = await this.smartAccountReplacementBasis(
        session,
        bundle?.entries ?? [],
        { originalHash, chainId, from, userOperation }
      );
      assertNonceFloor(bundle, basis.original);
      const binding: EvmVerifiedSmartAccountReplacement = Object.freeze({
        chainId,
        from,
        nonce: basis.original.nonce,
        originalHash,
        operation: 'send',
        expectedTipHash: basis.expectedTipHash,
        profileId: id,
        resetGeneration: bundle?.resetGeneration ?? 0,
        rates: basis.rates,
      });
      const metadata: SmartAccountCancellationMetadata = Object.freeze({
        account: userOperation.sender,
        chainId,
        originalHash,
        originalKind: 'transaction',
        originalOperationHash: basis.oldOperationHash,
        operationHash: getSmartAccountUserOpHash(
          userOperation,
          input.chainId
        ).toLowerCase(),
        operationNonce: userOperation.nonce,
      });
      smartAccountReplacementBindings.set(
        binding,
        Object.freeze({
          assertCurrent: () => guard(session),
          userOperation,
          metadata,
          data: paliEntryPointInterface
            .encodeFunctionData('handleOps', [
              [userOperation],
              getAddress(from),
            ])
            .toLowerCase(),
        })
      );
      return binding;
    });
  }

  /** A host-verified pending transaction can predate this journal. Its exact
   * nonce lineage must still match at write time, even when initially empty. */
  captureVerifiedReplacement(
    session: EvmSignedRecordSession,
    input: VerifiedPendingOriginal
  ): Promise<EvmVerifiedReplacementBinding> {
    const original = Object.freeze({
      ...input,
      from: getAddress(input.from).toLowerCase(),
    });
    if (
      !HASH.test(original.originalHash) ||
      !Number.isSafeInteger(original.nonce) ||
      original.nonce < 0
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      assertNonceFloor(bundle, original);
      return bindVerifiedReplacement(
        original,
        id,
        await this.verifiedReplacementTip(
          session,
          bundle?.entries ?? [],
          original
        ),
        bundle?.resetGeneration ?? 0
      );
    });
  }

  private async verifiedReplacementTip(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    original: VerifiedPendingOriginal,
    replacement?: Transaction
  ): Promise<string | null> {
    const sameNonce = entries.filter((entry) => matchesNonce(entry, original));
    const tracked = entries.find(
      (entry) => entry.hash === original.originalHash
    );
    if (
      tracked &&
      tracked.metadata &&
      (Object.hasOwn(tracked.metadata, 'privateWithdrawal') ||
        (original.operation === 'speed-up' &&
          Object.hasOwn(tracked.metadata, 'privateDeposit')))
    )
      throw new Error('EVM_PRIVATE_NOTE_REPLACEMENT_UNAVAILABLE');
    if (tracked && !matchesNonce(tracked, original))
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    if (await this.cancellationFence(session, entries, original)) {
      const tip = (await this.replayableVariants(session, sameNonce)).at(-1);
      if (
        !tip ||
        !isPendingPhase(tip.phase) ||
        tip.hash !== original.originalHash ||
        (original.operation === 'speed-up' &&
          replacement &&
          !repricesCancellation(
            replacement,
            retainedEvmTransaction(await this.materializeRecord(session, tip))
          ))
      )
        throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      return tip.hash;
    }
    const retainedIndex = sameNonce.findIndex(
      (entry) => entry.hash === original.originalHash
    );
    if (retainedIndex < 0) return sameNonce.at(-1)?.hash ?? null;
    if (
      !isPendingPhase(sameNonce[retainedIndex]!.phase) ||
      !retainedReplacementLineage(sameNonce, retainedIndex)
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    return sameNonce.at(-1)?.hash ?? null;
  }

  private async encryptTransactionBody(
    session: EvmSignedRecordSession,
    id: string,
    hash: string,
    body: string,
    domain: string
  ) {
    const allBytes = getBytes(body);
    const chunks: IEncryptedPrivateRecord[] = [];
    try {
      for (
        let offset = 0;
        offset < allBytes.length;
        offset += EVM_SIGNED_RECORD_LIMITS.chunkBytes
      ) {
        const bytes = allBytes.slice(
          offset,
          offset + EVM_SIGNED_RECORD_LIMITS.chunkBytes
        );
        try {
          const chunk = await session.keyring.encryptPrivateRecord({
            domain,
            recordId: `${hash}/${chunks.length}`,
            plaintext: bytes,
          });
          guard(session);
          chunks.push(envelope(chunk, id, domain, `${hash}/${chunks.length}`));
        } finally {
          bytes.fill(0);
        }
      }
    } finally {
      allBytes.fill(0);
    }
    return Object.freeze(chunks);
  }
  append(
    session: EvmSignedRecordSession,
    signed: EvmSignedSubmission,
    metadata?: Readonly<Record<string, unknown>>,
    replacement?:
      | EvmVerifiedReplacementBinding
      | EvmVerifiedSmartAccountReplacement,
    retainUnsignedNative = false
  ): Promise<EvmRetainedSignedRecord> {
    guard(session);
    const raw = signed.rawTransaction,
      hash = signed.hash;
    if (
      typeof raw !== 'string' ||
      raw.length > 2 * EVM_SIGNED_RECORD_LIMITS.bytes ||
      !HASH.test(hash)
    )
      return Promise.reject(new Error('EVM_SIGNED_RECORD_CAPACITY'));
    const source = signed.context;
    const smartReplacement = isEvmVerifiedSmartAccountReplacement(replacement)
      ? replacement
      : undefined;
    if (smartReplacement)
      assertEvmVerifiedSmartAccountReplacement(smartReplacement);
    const context = Object.freeze({
      account: Object.freeze({
        id: source.account.id,
        type: source.account.type,
        address: source.account.address,
      }),
      network: Object.freeze({ chainId: source.network.chainId }),
      operation: source.operation,
      originalHash:
        source.originalHash?.toLowerCase() ?? smartReplacement?.originalHash,
    });
    const isReplacement =
      context.operation === 'speed-up' || context.operation === 'cancel';
    if (
      (smartReplacement
        ? context.operation !== 'send'
        : isReplacement !== Boolean(replacement)) ||
      (replacement &&
        ((!smartReplacement &&
          !verifiedReplacementBindings.has(
            replacement as EvmVerifiedReplacementBinding
          )) ||
          replacement.originalHash !== context.originalHash))
    )
      return Promise.reject(new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED'));
    const tx = Transaction.from(raw);
    if (
      !tx.isSigned() ||
      tx.serialized !== raw ||
      tx.hash !== hash ||
      tx.from?.toLowerCase() !== context.account.address.toLowerCase() ||
      tx.chainId.toString() !== String(context.network.chainId)
    )
      return Promise.reject(new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED'));
    assertEvmGasLimit(tx.gasLimit, tx.chainId);
    if (context.operation === 'cancel' && !isCancellationEnvelope(tx))
      return Promise.reject(new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED'));
    const signedNonce = {
      chainId: tx.chainId.toString(),
      from: tx.from!.toLowerCase(),
      nonce: tx.nonce,
    };
    const metadataSnapshot =
      metadata === undefined ? undefined : snapshotMetadata(metadata);
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        let retainedMetadata = metadataSnapshot;
        assertNonceFloor(previous.bundle, signedNonce);
        if (smartReplacement) {
          const permit = smartAccountReplacementBindings.get(smartReplacement)!;
          permit.assertCurrent();
          const basis = await this.smartAccountReplacementBasis(
            session,
            previous.bundle?.entries ?? [],
            {
              originalHash: smartReplacement.originalHash,
              chainId: smartReplacement.chainId,
              from: smartReplacement.from,
              userOperation: permit.userOperation,
            }
          );
          guard(session);
          permit.assertCurrent();
          const floor = planEvmCancellationFees(
            basis.rates.type === 0
              ? { type: 0, currentGasPrice: basis.rates.gasPrice }
              : {
                  type: 2,
                  currentMaxFeePerGas: basis.rates.maxFeePerGas,
                  currentMaxPriorityFeePerGas: basis.rates.maxPriorityFeePerGas,
                }
          );
          if (
            id !== smartReplacement.profileId ||
            (previous.bundle?.resetGeneration ?? 0) !==
              smartReplacement.resetGeneration ||
            basis.expectedTipHash !== smartReplacement.expectedTipHash ||
            tx.chainId.toString() !== smartReplacement.chainId ||
            tx.from?.toLowerCase() !== smartReplacement.from ||
            tx.nonce !== smartReplacement.nonce ||
            tx.to?.toLowerCase() !==
              getPaliEntryPointAddress(
                Number(smartReplacement.chainId)
              ).toLowerCase() ||
            tx.value !== BigInt(0) ||
            tx.data.toLowerCase() !== permit.data ||
            tx.type !== floor.type ||
            (floor.type === 0
              ? tx.gasPrice === null || tx.gasPrice < floor.gasPrice
              : tx.maxFeePerGas === null ||
                tx.maxPriorityFeePerGas === null ||
                tx.maxFeePerGas < floor.maxFeePerGas ||
                tx.maxPriorityFeePerGas < floor.maxPriorityFeePerGas)
          )
            throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
          const provided = metadataSnapshot?.smartAccountOperationCancellation;
          if (
            provided !== undefined &&
            (!provided ||
              typeof provided !== 'object' ||
              Object.keys(provided).length !==
                Object.keys(permit.metadata).length ||
              Object.entries(permit.metadata).some(
                ([key, value]) =>
                  (provided as Record<string, unknown>)[key] !== value
              ))
          )
            throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
          retainedMetadata = Object.freeze({
            ...replacementMetadata(metadataSnapshot, undefined, 'cancel'),
            smartAccountExecution: true,
            smartAccountExecutionFrom: permit.metadata.account,
            smartAccountOperationCancellation: permit.metadata,
          });
        } else if (replacement) {
          const ordinary = replacement as EvmVerifiedReplacementBinding;
          if (
            id !== ordinary.profileId ||
            (previous.bundle?.resetGeneration ?? 0) !==
              ordinary.resetGeneration ||
            ordinary.operation !== context.operation ||
            !matchesNonce(signedNonce, ordinary) ||
            (await this.verifiedReplacementTip(
              session,
              previous.bundle?.entries ?? [],
              ordinary,
              tx
            )) !== ordinary.expectedTipHash
          )
            throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
          if (context.operation === 'speed-up') {
            const originalEntry = previous.bundle?.entries.find(
              (entry) => entry.hash === ordinary.originalHash
            );
            const original = originalEntry
              ? await this.materializeRecord(session, originalEntry)
              : undefined;
            retainedMetadata = replacementMetadata(
              metadataSnapshot,
              original,
              'speed-up'
            );
          } else {
            retainedMetadata = replacementMetadata(
              metadataSnapshot,
              undefined,
              'cancel'
            );
          }
        } else {
          await this.assertOrdinaryNonceAvailable(
            session,
            previous.bundle?.entries ?? [],
            signedNonce
          );
          guard(session);
        }
        const duplicate = previous.bundle?.entries.find(
          (entry) => entry.hash === hash
        );
        if (duplicate) {
          const existing = await this.materializeRecord(session, duplicate);
          if (
            existing.payloadKind === 'unsigned-eoa'
              ? existing.unsignedTransaction !== tx.unsignedSerialized
              : existing.rawTransaction !== raw
          )
            return invalid();
          return Object.freeze({ ...summary(duplicate), rawTransaction: raw });
        }
        if (
          (previous.bundle?.entries.length ?? 0) +
            (previous.bundle?.authorizations.length ?? 0) >=
          EVM_SIGNED_RECORD_LIMITS.transactions
        )
          return appendLimit();
        // Bound added payload before allocating/encrypting its chunks. The final
        // canonical encoding below remains the exact capacity check.
        if (
          (previous.raw?.length ?? 0) +
            Math.ceil((((raw.length - 2) / 2) * 4) / 3) >
          EVM_SIGNED_RECORD_LIMITS.bytes
        )
          return appendLimit();
        const parent =
          context.operation === 'speed-up' && replacement
            ? previous.bundle?.entries.find(
                (entry) => entry.hash === replacement.originalHash
              )
            : undefined;
        const inheritedUnsigned = parent?.payloadKind === 'unsigned-eoa';
        const reconstructable = isReconstructableEoa(tx, {
          ...signedNonce,
          hash,
          operation: context.operation,
          signer: context.account,
          metadata: retainedMetadata,
        });
        if (
          inheritedUnsigned &&
          (!reconstructable ||
            !sameEoaExecution(
              tx,
              retainedEvmTransaction(
                await this.materializeRecord(session, parent)
              )
            ) ||
            parent.signer.id !== context.account.id ||
            parent.signer.type !== context.account.type)
        )
          throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
        const unsigned =
          (retainUnsignedNative &&
            !isReplacement &&
            !smartReplacement &&
            reconstructable) ||
          inheritedUnsigned;
        const chunks = await this.encryptTransactionBody(
          session,
          id,
          hash,
          unsigned ? tx.unsignedSerialized : raw,
          unsigned ? UNSIGNED_CHUNK_DOMAIN : CHUNK_DOMAIN
        );
        const createdAt = this.now();
        if (!Number.isSafeInteger(createdAt) || createdAt < 0) return invalid();
        const entry: Entry = Object.freeze({
          hash,
          chainId: tx.chainId.toString(),
          from: tx.from!.toLowerCase(),
          nonce: tx.nonce,
          phase: 'signed',
          createdAt,
          signer: Object.freeze({
            id: context.account.id,
            type: context.account.type,
          }),
          operation: context.operation,
          ...(context.originalHash
            ? { originalHash: context.originalHash }
            : {}),
          ...(retainedMetadata ? { metadata: retainedMetadata } : {}),
          ...(unsigned ? { payloadKind: 'unsigned-eoa' as const } : {}),
          chunks,
        });
        const entries = [...(previous.bundle?.entries ?? []), entry];
        if (
          await this.write(
            session,
            id,
            previous.raw,
            (previous.bundle?.revision ?? -1) + 1,
            entries,
            previous.bundle?.authorizations ?? [],
            previous.bundle?.nonceFloors ?? [],
            true,
            previous.bundle?.resetGeneration ?? 0,
            smartReplacement
              ? async () => {
                  const permit =
                    smartAccountReplacementBindings.get(smartReplacement)!;
                  permit.assertCurrent();
                  return permit.assertCurrent;
                }
              : undefined
          )
        ) {
          const result = Object.freeze({
            ...summary(entry),
            rawTransaction: raw,
          });
          if (
            reconstructable ||
            (context.operation === 'cancel' && !retainedMetadata)
          ) {
            this.freshAppends.set(result, {
              profileId: id,
              revision: (previous.bundle?.revision ?? -1) + 1,
              dispatchSerial: dispatchSerials.get(this.storage) ?? 0,
            });
          }
          return result;
        }
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }
  /** A failed first submission can retire only its own untouched new entry. */
  [discardUndispatched](
    session: EvmSignedRecordSession,
    fresh: EvmRetainedSignedRecord
  ): Promise<boolean> {
    const append = this.freshAppends.get(fresh);
    if (!append) return Promise.resolve(false);
    this.freshAppends.delete(fresh);
    return this.exclusive(async () => {
      const id = await profile(session);
      if (
        id !== append.profileId ||
        (dispatchSerials.get(this.storage) ?? 0) !== append.dispatchSerial
      )
        return false;
      const { raw, bundle } = await this.load(session, id);
      if (!bundle || bundle.revision !== append.revision) return false;
      const entry = bundle.entries.find(
        (candidate) => candidate.hash === fresh.hash
      );
      if (!entry || entry.phase !== 'signed') return false;
      return this.write(
        session,
        id,
        raw,
        bundle.revision + 1,
        bundle.entries.filter((candidate) => candidate !== entry),
        bundle.authorizations ?? [],
        bundle.nonceFloors ?? [],
        false,
        bundle.resetGeneration ?? 0
      );
    });
  }

  readReplacement(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    operation: VerifiedPendingOriginal['operation'],
    eoaSpeedUpOnly = false
  ): Promise<Readonly<{
    binding: EvmVerifiedReplacementBinding | null;
    executionOperation?: EvmSignedRecordSummary['operation'];
    original: EvmSignedRecordSummary &
      Readonly<{ rawTransaction?: string }> &
      Readonly<{ unsignedTransaction: string }>;
    rates: EvmReplacementRates;
  }> | null> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const entries = bundle?.entries ?? [];
      const selected = entries.find(
        (entry) =>
          entry.chainId === chainId &&
          entry.from === from &&
          entry.hash === hash
      );
      if (!selected) return null;
      const sameNonce = entries.filter((entry) =>
        matchesNonce(entry, selected)
      );
      if (await this.cancellationFence(session, entries, selected)) return null;
      const lineage = retainedReplacementLineage(
        sameNonce,
        sameNonce.indexOf(selected)
      );
      const tip = lineage?.at(-1);
      if (!lineage || !tip) return null;

      const original = await this.materializeRecord(session, selected);
      if (
        original.metadata &&
        (Object.hasOwn(original.metadata, 'privateWithdrawal') ||
          (operation === 'speed-up' &&
            Object.hasOwn(original.metadata, 'privateDeposit')))
      )
        return null;
      const base = retainedEvmTransaction(original);
      if (base.type !== 0 && base.type !== 2) return null;
      let executionOperation: EvmSignedRecordSummary['operation'] | undefined;
      if (eoaSpeedUpOnly) {
        if (
          operation !== 'speed-up' ||
          !isPendingPhase(selected.phase) ||
          tip.hash !== hash ||
          !isReconstructableEoa(base, selected) ||
          sameNonce.some((entry) =>
            Object.keys(entry.metadata ?? {}).some(
              (key) => key !== 'intent' && key !== 'nftTransfer'
            )
          )
        )
          return null;
        let ancestor = selected;
        while (ancestor.operation === 'speed-up') {
          const index = sameNonce.indexOf(ancestor);
          const parent = sameNonce
            .slice(0, index)
            .find((entry) => entry.hash === ancestor.originalHash);
          if (
            !parent ||
            parent.signer.id !== selected.signer.id ||
            parent.signer.type !== selected.signer.type
          )
            return null;
          const transaction = retainedEvmTransaction(
            await this.materializeRecord(session, parent)
          );
          if (
            !isReconstructableEoa(transaction, parent) ||
            !sameEoaExecution(base, transaction)
          )
            return null;
          ancestor = parent;
        }
        executionOperation = ancestor.operation;
      }
      let cap = base.maxFeePerGas ?? base.gasPrice ?? BigInt(0);
      let tipRate = base.maxPriorityFeePerGas ?? BigInt(0);
      for (const entry of lineage.slice(1)) {
        const variant = retainedEvmTransaction(
          await this.materializeRecord(session, entry)
        );
        if (
          variant.type !== base.type ||
          variant.to !== base.to ||
          variant.value !== base.value ||
          variant.data !== base.data ||
          JSON.stringify(variant.accessList ?? []) !==
            JSON.stringify(base.accessList ?? [])
        )
          return null;
        const variantCap =
          variant.maxFeePerGas ?? variant.gasPrice ?? BigInt(0);
        const variantTip = variant.maxPriorityFeePerGas ?? BigInt(0);
        if (variantCap > cap) cap = variantCap;
        if (variantTip > tipRate) tipRate = variantTip;
      }
      const rates: EvmReplacementRates =
        base.type === 0
          ? Object.freeze({ type: 0, gasPrice: cap })
          : Object.freeze({
              type: 2,
              maxFeePerGas: cap,
              maxPriorityFeePerGas: tipRate,
            });
      guard(session);
      return Object.freeze({
        original: Object.freeze({
          ...original,
          unsignedTransaction: base.unsignedSerialized,
        }),
        rates,
        executionOperation,
        binding: isPendingPhase(selected.phase)
          ? bindVerifiedReplacement(
              {
                chainId,
                from,
                nonce: selected.nonce,
                originalHash: hash,
                operation,
              },
              id,
              tip.hash,
              bundle?.resetGeneration ?? 0
            )
          : null,
      });
    });
  }
  async readEoaSpeedUpIntent(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ) {
    const retained = await this.readReplacement(
      session,
      chainId,
      address,
      hash,
      'speed-up',
      true
    );
    if (
      !retained?.executionOperation ||
      retained.binding?.expectedTipHash !== hash
    )
      return null;
    const { rawTransaction, ...original } = retained.original;
    void rawTransaction;
    return Object.freeze({
      original: Object.freeze(original),
      rates: retained.rates,
      executionOperation: retained.executionOperation,
      binding: retained.binding,
    });
  }
  async readSmartAccountSpeedUpIntent(
    session: EvmSignedRecordSession,
    chainId: string,
    account: string,
    hash: string
  ) {
    const record = await this.readSmartAccountReplayExact(
      session,
      chainId,
      account,
      hash
    );
    if (!record || !canSpeedUpSmartAccountOuter(record, account)) return null;
    const retained = await this.readReplacement(
      session,
      chainId,
      record.entry.from,
      hash,
      'speed-up'
    );
    if (retained?.binding?.expectedTipHash !== hash) return null;
    const { rawTransaction, ...original } = retained.original;
    void rawTransaction;
    return Object.freeze({
      original: Object.freeze(original),
      binding: retained.binding,
    });
  }

  /** Compact eligible EOA sends, fee-only descendants and standalone ordinary Smart Account proofs atomically. */
  migrateUnsignedNative(
    session: EvmSignedRecordSession,
    {
      nativeEoa = true,
      allowUnboundErc20 = true,
    }: { allowUnboundErc20?: boolean; nativeEoa?: boolean } = {}
  ): Promise<number> {
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        if (!previous.bundle) return 0;
        const bundle = previous.bundle;
        const entries: Entry[] = [];
        const converted = new Map<string, { entry: Entry; tx: Transaction }>();
        let changed = 0;
        for (const entry of bundle.entries) {
          if (
            !nativeEoa ||
            (!allowUnboundErc20 &&
              entry.operation === 'erc20' &&
              !entry.metadata?.intent) ||
            entry.operation === 'cancel' ||
            (entry.operation === 'speed-up' &&
              !converted.has(entry.originalHash ?? ''))
          ) {
            entries.push(entry);
            continue;
          }
          const tx = retainedEvmTransaction(
            await this.materializeRecord(session, entry)
          );
          const parent = converted.get(entry.originalHash ?? '');
          if (
            !isReconstructableEoa(tx, entry) ||
            (entry.operation === 'speed-up' &&
              (!parent ||
                !matchesNonce(entry, parent.entry) ||
                entry.signer.type !== parent.entry.signer.type ||
                entry.signer.id !== parent.entry.signer.id ||
                !sameEoaExecution(tx, parent.tx)))
          ) {
            entries.push(entry);
            continue;
          }
          converted.set(entry.hash, { entry, tx });
          if (entry.payloadKind === 'unsigned-eoa') {
            entries.push(entry);
            continue;
          }
          const chunks = await this.encryptTransactionBody(
            session,
            id,
            entry.hash,
            tx.unsignedSerialized,
            UNSIGNED_CHUNK_DOMAIN
          );
          entries.push(
            Object.freeze({ ...entry, payloadKind: 'unsigned-eoa', chunks })
          );
          changed++;
        }
        const authorizations: AuthorizationEntry[] = [];
        for (const entry of bundle.authorizations) {
          const record = await this.materializeAuthorization(session, entry);
          if (record.signatureDigest || record.replacesOperationHash) {
            authorizations.push(entry);
            continue;
          }
          const payload = encodeSmartAccountAuthorization(record);
          try {
            authorizations.push(
              await this.encryptAuthorization(session, id, record, payload)
            );
          } finally {
            payload.fill(0);
          }
          changed++;
        }
        if (!changed) return 0;
        if (
          await this.write(
            session,
            id,
            previous.raw,
            bundle.revision + 1,
            entries,
            authorizations,
            bundle.nonceFloors,
            false,
            bundle.resetGeneration
          )
        )
          return changed;
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }

  validate(session: EvmSignedRecordSession): Promise<number> {
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      for (const authorization of bundle?.authorizations ?? []) {
        await this.materializeAuthorization(session, authorization);
      }
      return (
        (bundle?.entries.length ?? 0) + (bundle?.authorizations.length ?? 0)
      );
    });
  }

  private async smartAccountPayerEntries(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    chainId: string,
    account: string
  ): Promise<ReadonlyMap<string, Entry>> {
    const matched = new Map<string, Entry>();
    const from = account.toLowerCase();
    for (const entry of entries) {
      if (
        entry.chainId !== chainId ||
        entry.from === from ||
        entry.payloadKind === 'unsigned-eoa'
      )
        continue;
      const parent = entry.originalHash && matched.get(entry.originalHash);
      if (entry.operation === 'cancel' && !parent) continue;
      const tx = retainedEvmTransaction(await this.materialize(session, entry));
      const operations = decodeSmartAccountOperations({
        chainId,
        data: tx.data,
        hash: entry.hash,
        nonce: entry.nonce,
        payer: entry.from,
        to: tx.to,
        value: tx.value.toString(),
      });
      if (operations.length) {
        // A shared outer envelope cannot be removed without losing the other
        // account's retained instructions and payer-side nonce evidence.
        if (operations.every((operation) => operation.account === account))
          matched.set(entry.hash, entry);
        continue;
      }
      const matchesPrefund =
        entry.metadata?.smartAccountDeploymentPrefund === true &&
        typeof entry.metadata.smartAccountAddress === 'string' &&
        entry.metadata.smartAccountAddress.toLowerCase() === from &&
        tx.to === account &&
        tx.data === '0x' &&
        tx.value > BigInt(0);
      if (
        matchesPrefund ||
        (parent &&
          matchesNonce(entry, parent) &&
          (entry.operation === 'cancel'
            ? isCancellationEnvelope(tx)
            : entry.operation === 'speed-up' &&
              sameEoaExecution(
                tx,
                retainedEvmTransaction(await this.materialize(session, parent))
              )))
      )
        matched.set(entry.hash, entry);
    }
    return matched;
  }

  /** Explicitly forget local tracking for one account and chain. Network-held
   * transactions can still execute. The host must revoke its signing/review and
   * history-publication authorities before calling this method. */
  clearScope(
    session: EvmSignedRecordSession,
    input: Readonly<{
      chainId: string;
      from: string;
      profileId: string;
      smartAccount?: true;
    }>
  ): Promise<number> {
    guard(session);
    const account = getAddress(input.from);
    const from = account.toLowerCase();
    const { chainId, profileId, smartAccount } = input;
    if (
      !PROFILE.test(profileId) ||
      !/^[1-9][0-9]{0,77}$/.test(chainId) ||
      BigInt(chainId) >= BigInt(1) << BigInt(256)
    )
      throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
    while (this.sessionParents.has(session))
      session = this.sessionParents.get(session)!;
    resetSerials.set(this.storage, (resetSerials.get(this.storage) ?? 0) + 1);
    // Do not reuse a previously captured session after revocation.
    const resetSession = this.captureSession({
      keyring: session.keyring,
      assertCurrent: () => guard(session),
    });
    return this.exclusive(async () => {
      if ((await profile(resetSession)) !== profileId)
        throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(resetSession, profileId);
        const recorded = previous.bundle?.entries ?? [];
        const payerEntries =
          smartAccount === true
            ? await this.smartAccountPayerEntries(
                resetSession,
                recorded,
                chainId,
                account
              )
            : undefined;
        const entries: Entry[] = [],
          removed: Entry[] = [];
        for (const entry of recorded) {
          if (
            (entry.chainId === chainId && entry.from === from) ||
            payerEntries?.has(entry.hash)
          )
            removed.push(entry);
          else entries.push(entry);
        }
        const floors = (previous.bundle?.nonceFloors ?? []).filter(
          (entry) => entry.chainId !== chainId || entry.from !== from
        );
        const authorizations = (previous.bundle?.authorizations ?? []).filter(
          (entry) =>
            entry.chainId !== chainId || entry.account.toLowerCase() !== from
        );
        const resetGeneration = (previous.bundle?.resetGeneration ?? 0) + 1;
        if (!Number.isSafeInteger(resetGeneration)) return limit();
        if (
          await this.write(
            resetSession,
            profileId,
            previous.raw,
            (previous.bundle?.revision ?? -1) + 1,
            entries,
            authorizations,
            floors,
            false,
            resetGeneration
          )
        ) {
          this.retirementGroupCursors.delete(`${profileId}:${chainId}:${from}`);
          for (const entry of removed)
            this.autoNonceAcceptance.retireNonce(
              profileId,
              entry,
              entry.from === from ? 'nonce' : 'hash'
            );
          return (
            removed.length +
            (previous.bundle?.authorizations.length ?? 0) -
            authorizations.length
          );
        }
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }

  /** Reclaim only terminal nonce groups after a fresh, hash-specific inclusion
   * observation. RPC observations never create a permanent nonce floor. */
  async retireFinalized(
    session: EvmSignedRecordSession,
    input: Readonly<{ chainId: string; from: string }>,
    read: EvmSignedRetirementRead,
    progress: { onTimeout?: () => void; removed: number }
  ): Promise<number> {
    session = this.captureSession(session);
    const chainId = input.chainId;
    const from = getAddress(input.from).toLowerCase();
    if (
      !/^[1-9][0-9]{0,77}$/.test(chainId) ||
      BigInt(chainId) >= BigInt(1) << BigInt(256)
    )
      throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
    const id = await profile(session);
    const scopeKey = `${id}:${chainId}:${from}`;
    const deadline = performance.now() + FINALITY_TIMEOUT_MS;
    const unavailable = new Error('EVM_SIGNED_RECORD_FINALITY_UNAVAILABLE');
    const assertFresh = () => {
      guard(session);
      if (performance.now() >= deadline) {
        progress.onTimeout?.();
        throw unavailable;
      }
    };
    const call: EvmSignedRetirementRead = async (method, params) => {
      assertFresh();
      const value = await read(method, params);
      assertFresh();
      return value;
    };
    const quantity = (value: unknown): bigint => {
      if (
        typeof value !== 'string' ||
        !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
      )
        throw unavailable;
      return BigInt(value);
    };
    const candidates = await this.exclusive(async () => {
      const { bundle } = await this.load(session, id);
      const groups = completedNonceGroups(
        (bundle?.entries ?? []).filter(
          (entry) => entry.chainId === chainId && entry.from === from
        )
      );
      const previous = this.retirementGroupCursors.get(scopeKey);
      const previousIndex =
        previous === undefined
          ? -1
          : groups.findIndex((group) => group[0]!.nonce === previous.nonce);
      const start =
        previousIndex < 0 ? 0 : previousIndex + (previous!.resume ? 0 : 1);
      return [...groups.slice(start), ...groups.slice(0, start)];
    });
    let removed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      for (const group of candidates) {
        assertFresh();
        const winner = group.find(
          (entry) => entry.phase === 'confirmed' || entry.phase === 'reverted'
        )!;
        // Budget interruption resumes this group, including an incomplete validation.
        const cursor = { nonce: winner.nonce, resume: true };
        this.retirementGroupCursors.delete(scopeKey);
        this.retirementGroupCursors.set(scopeKey, cursor);
        if (
          this.retirementGroupCursors.size >
          EVM_SIGNED_RECORD_LIMITS.transactions
        )
          this.retirementGroupCursors.delete(
            this.retirementGroupCursors.keys().next().value!
          );
        const advanceGroup = () => {
          if (this.retirementGroupCursors.get(scopeKey) === cursor)
            cursor.resume = false;
        };
        // A timed-out group yields to its successor on the next attempt.
        progress.onTimeout = advanceGroup;
        const tx = retainedEvmTransaction(
          await this.materializeRecord(session, winner)
        );
        const observe = async () => {
          const observed = await observeEvmTransaction(
            {
              chainId,
              from,
              hash: winner.hash,
              nonce: String(winner.nonce),
              to: tx.to,
            },
            call,
            assertFresh
          );
          if (
            observed.status !== 'mined' ||
            observed.transactionIndex === undefined ||
            observed.outcome !== winner.phase
          ) {
            advanceGroup();
            throw unavailable;
          }
          const finalized = await call('eth_getBlockByNumber', [
            'finalized',
            false,
          ]);
          if (
            !finalized ||
            typeof finalized !== 'object' ||
            Array.isArray(finalized)
          )
            throw unavailable;
          const block = finalized as Record<string, unknown>;
          const height = quantity(block.number);
          if (
            height < BigInt(observed.block.number) ||
            typeof block.hash !== 'string' ||
            !HASH.test(block.hash.toLowerCase())
          )
            throw unavailable;
          const canonical = await call('eth_getBlockByNumber', [
            `0x${height.toString(16)}`,
            false,
          ]);
          if (
            !canonical ||
            typeof canonical !== 'object' ||
            Array.isArray(canonical) ||
            quantity((canonical as Record<string, unknown>).number) !==
              height ||
            (canonical as Record<string, unknown>).hash !== block.hash
          )
            throw unavailable;
          const count = quantity(
            await call('eth_getTransactionCount', [
              from,
              { blockHash: block.hash, requireCanonical: true },
            ])
          );
          if (count <= BigInt(winner.nonce)) throw unavailable;
          return observed;
        };
        let observed: Awaited<ReturnType<typeof observe>>;
        try {
          observed = await observe();
        } catch {
          guard(session);
          continue;
        }
        removed += await this.exclusive(async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            const previous = await this.load(session, id);
            const current = (previous.bundle?.entries ?? []).filter((entry) =>
              matchesNonce(entry, winner)
            );
            if (
              current.length !== group.length ||
              current.some(
                (entry, index) =>
                  entry.hash !== group[index]!.hash ||
                  entry.phase !== group[index]!.phase
              )
            )
              return 0;
            const entries = previous.bundle!.entries.filter(
              (entry) => !matchesNonce(entry, winner)
            );
            if (
              await this.write(
                session,
                id,
                previous.raw,
                previous.bundle!.revision + 1,
                entries,
                previous.bundle!.authorizations,
                previous.bundle!.nonceFloors,
                false,
                previous.bundle!.resetGeneration,
                async () => {
                  const fresh = await observe();
                  if (
                    fresh.block.hash !== observed.block.hash ||
                    fresh.block.number !== observed.block.number ||
                    fresh.transactionIndex !== observed.transactionIndex
                  )
                    throw unavailable;
                  return assertFresh;
                }
              )
            ) {
              this.autoNonceAcceptance.retireNonce(id, winner);
              // Publish acknowledged progress before any next RPC can stall.
              progress.removed += group.length;
              advanceGroup();
              return group.length;
            }
          }
          throw new Error('EVM_SIGNED_RECORD_CONFLICT');
        });
      }
      return removed;
    };
    try {
      return await Promise.race([
        work(),
        new Promise<number>((resolve) => {
          timer = setTimeout(() => {
            progress.onTimeout?.();
            resolve(removed);
          }, FINALITY_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      guard(session);
      if (error === unavailable) return removed;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  /** Capacity belongs to the whole profile, so any configured chain can
   * release its finalized records without selecting or funding that account. */
  async retireAvailableFinalized(
    session: EvmSignedRecordSession,
    preferred: Readonly<{ chainId: string; from: string }>,
    resolveRead: EvmSignedRetirementReadForChain
  ): Promise<number> {
    session = this.captureSession(session);
    const preferredKey = floorKey({
      ...preferred,
      from: getAddress(preferred.from).toLowerCase(),
    });
    const candidates = await this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const unique = new Map<
        string,
        Readonly<{ chainId: string; from: string }>
      >();
      for (const group of completedNonceGroups(bundle?.entries ?? [])) {
        const entry = group[0]!;
        const key = floorKey(entry);
        if (!unique.has(key))
          unique.set(key, { chainId: entry.chainId, from: entry.from });
      }
      const current = unique.get(preferredKey);
      unique.delete(preferredKey);
      // Prefer the current scope on the first pass, then continue around the
      // same ring so an unavailable current endpoint cannot starve the rest.
      const scopes = [...(current ? [current] : []), ...unique.values()];
      const cursor =
        this.retirementCursor?.profileId === id
          ? this.retirementCursor.scope
          : undefined;
      const start =
        cursor === undefined
          ? 0
          : scopes.findIndex((scope) => floorKey(scope) === cursor) + 1;
      return {
        id,
        scopes: [...scopes.slice(start), ...scopes.slice(0, start)],
      };
    });
    guard(session);
    if (!candidates.scopes.length) return 0;
    const controller = new AbortController();
    const deadline = performance.now() + FINALITY_TIMEOUT_MS;
    const expired = new Error('EVM_SIGNED_RETIREMENT_BUDGET_EXHAUSTED');
    const progress: { onTimeout?: () => void; removed: number } = {
      removed: 0,
    };
    const assertCurrent = () => {
      guard(session);
      if (controller.signal.aborted) throw expired;
      if (performance.now() >= deadline) {
        progress.onTimeout?.();
        throw expired;
      }
    };
    const ownedSession = { keyring: session.keyring, assertCurrent };
    const readers = new Map<string, EvmSignedRetirementRead | null>();
    let remaining = 64;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      try {
        for (const scope of candidates.scopes) {
          assertCurrent();
          if (!remaining) break;
          this.retirementCursor = {
            profileId: candidates.id,
            scope: floorKey(scope),
          };
          if (!readers.has(scope.chainId))
            readers.set(
              scope.chainId,
              resolveRead(scope.chainId, controller.signal, assertCurrent)
            );
          assertCurrent();
          const read = readers.get(scope.chainId);
          if (!read) continue;
          await this.retireFinalized(
            ownedSession,
            scope,
            async (method, params) => {
              assertCurrent();
              if (!remaining) {
                controller.abort(expired);
                throw expired;
              }
              remaining--;
              const value = await read(method, params);
              assertCurrent();
              return value;
            },
            progress
          );
        }
      } catch (error) {
        guard(session);
        if (error !== expired) throw error;
      }
      return progress.removed;
    };
    try {
      const result = await Promise.race([
        work(),
        new Promise<number>((resolve) => {
          timer = setTimeout(() => {
            progress.onTimeout?.();
            controller.abort(expired);
            resolve(progress.removed);
          }, FINALITY_TIMEOUT_MS);
        }),
      ]);
      guard(session);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort(expired);
    }
  }
  private autoNonceSnapshot(
    session: EvmSignedRecordSession,
    owner: string,
    entries: readonly Entry[],
    nonceFloor: number,
    authenticatedEntries: readonly Entry[],
    authenticatedAuthorizations: readonly AuthorizationEntry[]
  ): EvmAutoNonceSnapshot {
    const byHash = new Map(entries.map((entry) => [entry.hash, entry]));
    const budgets = new Map<
      string,
      Readonly<{
        maximumCost: bigint;
        transaction: Transaction;
      }>
    >();
    const readBudget = async (hash: string) => {
      guard(session);
      const cached = budgets.get(hash);
      if (cached) return cached;
      const entry = byHash.get(hash);
      if (!entry) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
      const tx = retainedEvmTransaction(
        await this.materializeRecord(session, entry)
      );
      const feePerGas = tx.maxFeePerGas ?? tx.gasPrice;
      // These envelope types each consume exactly one sender nonce.
      if (
        feePerGas === null ||
        (tx.type !== 0 && tx.type !== 1 && tx.type !== 2)
      )
        throw new Error('EVM_AUTO_NONCE_UNSUPPORTED_PREDECESSOR');
      guard(session);
      const budget = Object.freeze({
        transaction: tx,
        maximumCost: tx.value + tx.gasLimit * feePerGas,
      });
      budgets.set(hash, budget);
      return budget;
    };
    let revoked: Promise<ReadonlySet<string>> | undefined;

    const operationReads = new Map<
      string,
      Promise<readonly RetainedSmartAccountOperation[]>
    >();

    const readOperations = (chainId: string, address: string) => {
      guard(session);
      const account = getAddress(address),
        key = JSON.stringify([chainId, account]);
      let result = operationReads.get(key);
      if (!result) {
        result = (async () => {
          const operations: RetainedSmartAccountOperation[] = [];
          for (const entry of authenticatedEntries) {
            if (entry.chainId !== chainId || entry.payloadKind) continue;
            const materialized = await this.materialize(session, entry);
            operations.push(
              ...decodeRetainedSmartAccountOperations(materialized).filter(
                (operation) => operation.account === account
              )
            );
          }
          guard(session);
          return Object.freeze(operations);
        })();
        operationReads.set(key, result);
      }
      return result;
    };

    const readAuthorizations = async (chainId: string, address: string) => {
      guard(session);
      const account = getAddress(address);
      const identities = new Map<
        string,
        Pick<
          SmartAccountAuthorizationSummary,
          'account' | 'chainId' | 'operationHash' | 'operationNonce'
        >
      >();
      for (const entry of authenticatedAuthorizations) {
        if (entry.chainId !== chainId || entry.account !== account) continue;
        const record = await this.materializeAuthorization(session, entry);
        identities.set(
          record.operationHash,
          Object.freeze({
            account,
            chainId,
            operationHash: record.operationHash,
            operationNonce: record.operationNonce,
          })
        );
      }
      for (const operation of await readOperations(chainId, account))
        identities.set(
          operation.operationHash.toLowerCase(),
          Object.freeze({
            account,
            chainId,
            operationHash: operation.operationHash.toLowerCase(),
            operationNonce: operation.operationNonce,
          })
        );
      guard(session);
      return Object.freeze([...identities.values()]);
    };

    return Object.freeze({
      owner,
      minimumNonce: nonceFloor,
      retained: Object.freeze(
        entries.map(({ chainId, from, hash, nonce, phase }) =>
          Object.freeze({ chainId, from, hash, nonce, phase })
        )
      ),
      readUnsignedNativeTransaction: async (hash: string) => {
        guard(session);
        if (byHash.get(hash)?.payloadKind !== 'unsigned-eoa') return null;
        return (await readBudget(hash)).transaction.unsignedSerialized;
      },
      readSignedTransaction: async (hash: string) => {
        revoked ??= this.revokedSmartAccountOperations(
          session,
          authenticatedEntries,
          authenticatedAuthorizations
        );
        const suppressed = await revoked;
        const transaction = (await readBudget(hash)).transaction;
        if (!transaction.isSigned())
          throw new Error('EVM_SIGNED_RECORD_REQUIRES_NEW_SIGNATURE');
        if (
          suppressed.size &&
          decodeRetainedSmartAccountOperations({
            ...summary(byHash.get(hash)!),
            rawTransaction: transaction.serialized,
          }).some((operation) =>
            suppressed.has(operation.operationHash.toLowerCase())
          )
        )
          throw new EvmSignedRecordCancellationFence(null);
        return transaction.serialized;
      },
      readMaximumCost: async (hash: string) =>
        (await readBudget(hash)).maximumCost,
      // The admission already authenticated this complete manifest while holding
      // its storage queue. Project from that exact snapshot without re-entering it.
      readSmartAccountOperations: readOperations,
      readSmartAccountAuthorizations: readAuthorizations,
      readAssetDebit: async (hash, input) => {
        const asset = snapshotEvmTransferAsset(input);
        const tx = (await readBudget(hash)).transaction;
        if (tx.to?.toLowerCase() !== asset.contractAddress.toLowerCase())
          return BigInt(0);
        const entry = byHash.get(hash)!;
        if (asset.standard === 'ERC20') {
          // Other calls can affect token state, but are not known transfer debits.
          try {
            return BigInt(decodeErc20Transfer(tx.data).amountUnits);
          } catch {
            if (entry.operation === 'erc20') return invalid();
            return BigInt(0);
          }
        }
        const transfer = decodeRetainedNftTransfer(
          {
            ...summary(entry),
            operation: asset.standard === 'ERC721' ? 'erc721' : 'erc1155',
            ...(tx.isSigned()
              ? { rawTransaction: tx.serialized }
              : { unsignedTransaction: tx.unsignedSerialized }),
          },
          tx
        );
        if (
          !transfer &&
          entry.operation ===
            (asset.standard === 'ERC721' ? 'erc721' : 'erc1155')
        )
          return invalid();
        if (!transfer || transfer.tokenId !== asset.tokenId) return BigInt(0);
        return BigInt(transfer.amountUnits);
      },
    });
  }

  captureAutoNonceSnapshot(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<EvmAutoNonceSnapshot> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      guard(session);
      return this.autoNonceSnapshot(
        session,
        id,
        (bundle?.entries ?? []).filter(
          (entry) => entry.chainId === chainId && entry.from === from
        ),
        minimumNonce(bundle, { chainId, from }),
        bundle?.entries ?? [],
        bundle?.authorizations ?? []
      );
    });
  }

  listSender(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<readonly EvmSignedRecordSummary[]> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      guard(session);
      return Object.freeze(
        (bundle?.entries ?? [])
          .filter((entry) => entry.chainId === chainId && entry.from === from)
          .map(summary)
      );
    });
  }
  listAddress(
    session: EvmSignedRecordSession,
    address: string
  ): Promise<readonly EvmSignedRecordSummary[]> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      return Object.freeze(
        (bundle?.entries ?? [])
          .filter((entry) => entry.from === from)
          .map(summary)
      );
    });
  }
  /**
   * Select a sender's current work from authenticated append order. Wall-clock
   * timestamps are presentation metadata: clock changes cannot hide unresolved
   * signed bytes behind a completed transaction.
   */
  readCurrent(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<EvmRetainedRecord | null> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      let latest: Entry | undefined;
      let unresolved: Entry | undefined;
      for (const entry of bundle?.entries ?? []) {
        if (entry.chainId !== chainId || entry.from !== from) continue;
        latest = entry;
        if (['signed', 'attempted', 'submitted'].includes(entry.phase))
          unresolved = entry;
      }
      const entry = unresolved ?? latest;
      return entry ? this.materializeRecord(session, entry) : null;
    });
  }
  pendingPrivacyWithdrawalNotes(
    session: EvmSignedRecordSession,
    payer: string
  ): Promise<ReadonlySet<string>> {
    const from = getAddress(payer).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const notes = new Set<string>();
      for (const entry of bundle?.entries ?? []) {
        if (
          entry.from !== from ||
          entry.chainId !== '1' ||
          !isPendingPhase(entry.phase)
        )
          continue;
        const withdrawal = entry.metadata?.privateWithdrawal;
        if (
          withdrawal &&
          typeof withdrawal === 'object' &&
          'noteId' in withdrawal &&
          typeof withdrawal.noteId === 'string'
        )
          notes.add(withdrawal.noteId);
      }
      guard(session);
      return notes;
    });
  }

  readRecent(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    maximum: number
  ): Promise<
    Readonly<{ entries: readonly EvmRetainedRecord[]; total: number }>
  > {
    const from = getAddress(address).toLowerCase();
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > EVM_SIGNED_RECORD_LIMITS.transactions
    )
      throw new Error('EVM_SIGNED_RECORD_CAPACITY');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const matching = (bundle?.entries ?? []).filter(
        (entry) => entry.chainId === chainId && entry.from === from
      );
      const entries: EvmRetainedRecord[] = [];
      for (const entry of matching.slice(-maximum))
        entries.push(await this.materializeRecord(session, entry));
      guard(session);
      return Object.freeze({
        entries: Object.freeze(entries),
        total: matching.length,
      });
    });
  }
  /** A private operation-owned projection. Final admission explicitly reauthenticates storage. */
  async captureSmartAccountPendingRecords(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<SmartAccountPendingRecords> {
    session = this.captureSession(session);
    const owner = getAddress(address),
      id = await profile(session);
    guard(session);
    type Identity = Pick<
      SmartAccountAuthorizationSummary,
      'account' | 'chainId' | 'operationHash' | 'operationNonce'
    >;
    type Pending = Readonly<{
      authorizations: readonly Identity[];
      operations: readonly RetainedSmartAccountOperation[];
    }>;
    let serial = -1,
      cached: Pending | undefined,
      running: Promise<Pending> | undefined;
    const readPending = (fresh: boolean): Promise<Pending> => {
      guard(session);
      if (running) return running;
      const task = this.exclusive(async () => {
        const currentSerial = mutationSerials.get(this.storage) ?? 0;
        guard(session);

        if (!fresh && cached && serial === currentSerial) return cached;
        const { bundle } = await this.load(session, id);
        const operations: RetainedSmartAccountOperation[] = [],
          authorizations = new Map<string, Identity>();
        for (const entry of bundle?.authorizations ?? []) {
          if (entry.chainId !== chainId || entry.account !== owner) continue;
          const record = await this.materializeAuthorization(session, entry);
          authorizations.set(
            record.operationHash,
            Object.freeze({
              account: owner,
              chainId,
              operationHash: record.operationHash,
              operationNonce: record.operationNonce,
            })
          );
        }
        for (const entry of bundle?.entries ?? []) {
          if (entry.chainId !== chainId || entry.payloadKind === 'unsigned-eoa')
            continue;
          const materialized = await this.materialize(session, entry);
          for (const operation of decodeRetainedSmartAccountOperations(
            materialized
          )) {
            if (operation.account !== owner) continue;
            operations.push(operation);
            authorizations.set(
              operation.operationHash.toLowerCase(),
              Object.freeze({
                account: owner,
                chainId,
                operationHash: operation.operationHash.toLowerCase(),
                operationNonce: operation.operationNonce,
              })
            );
          }
        }
        guard(session);
        cached = Object.freeze({
          operations: Object.freeze(operations),
          authorizations: Object.freeze([...authorizations.values()]),
        });
        serial = currentSerial;
        return cached;
      });
      running = task;
      void task
        .finally(() => {
          if (running === task) running = undefined;
        })
        .catch(() => undefined);
      return task;
    };
    const scoped = (
      allowed: readonly SmartAccountAuthorizationReceipt[]
    ): SmartAccountPendingRecords => {
      const permissions = () =>
        allowed.map((receipt) => {
          const captured = authorizationReceipts.get(receipt);
          if (
            !captured ||
            captured.storage !== this.storage ||
            captured.profileId !== id ||
            captured.record.account !== owner ||
            captured.record.chainId !== chainId
          )
            throw new Error('SMART_ACCOUNT_AUTHORIZATION_CHANGED');
          captured.assertCurrent();
          guard(session);
          return captured.record;
        });
      const isAllowed = (
        operation: Identity,
        values: readonly RetainedSmartAccountAuthorization[]
      ) =>
        values.some(
          (record) =>
            operation.operationHash.toLowerCase() === record.operationHash &&
            operation.account === record.account &&
            operation.chainId === record.chainId &&
            operation.operationNonce === record.operationNonce
        );
      const checked = async (fresh: boolean) => {
        const pending = await readPending(fresh),
          values = permissions();
        for (const value of values)
          if (
            !pending.authorizations.some((operation) =>
              isAllowed(operation, [value])
            )
          )
            throw new Error('SMART_ACCOUNT_AUTHORIZATION_CHANGED');
        return { pending, values };
      };
      return Object.freeze({
        profileId: id,
        readPayerRecords: (payer: string) =>
          this.listSender(session, chainId, payer),
        filterPendingOperations: (
          operations: readonly RetainedSmartAccountOperation[]
        ) => {
          const values = permissions();
          return Object.freeze(
            operations.filter((operation) => !isAllowed(operation, values))
          );
        },
        filterPendingAuthorizations: (authorizations) => {
          const values = permissions();
          return Object.freeze(
            authorizations.filter((operation) => !isAllowed(operation, values))
          );
        },
        forAuthorization: (receipt: SmartAccountAuthorizationReceipt) => {
          if (allowed.includes(receipt)) return scoped(allowed);
          if (allowed.length >= 2)
            throw new Error('SMART_ACCOUNT_AUTHORIZATION_CHANGED');
          const result = scoped(Object.freeze([...allowed, receipt]));
          // Resolve the opaque receipt at the point it grants an exception.
          result.filterPendingOperations!([]);
          return result;
        },
        read: async (fresh: boolean) => {
          const { pending, values } = await checked(fresh);
          return Object.freeze(
            pending.operations.filter(
              (operation) => !isAllowed(operation, values)
            )
          );
        },
        readAuthorizations: async (fresh: boolean) => {
          const { pending, values } = await checked(fresh);
          return Object.freeze(
            pending.authorizations.filter(
              (operation) => !isAllowed(operation, values)
            )
          );
        },
      });
    };
    return scoped([]);
  }

  /** General handleOps recovery: membership comes from authenticated signed bytes. */
  readSmartAccountReplayExact(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<EvmRetainedSmartAccountRecord | null> {
    const owner = getAddress(address);
    if (!HASH.test(hash)) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      const saved = bundle?.entries.find(
        (entry) => entry.chainId === chainId && entry.hash === hash
      );
      if (!saved || saved.payloadKind === 'unsigned-eoa') return null;
      const entry = await this.materialize(session, saved);
      const operations = decodeRetainedSmartAccountOperations(entry);
      const original =
        entry.operation === 'cancel' && entry.originalHash
          ? bundle?.entries.find((value) => value.hash === entry.originalHash)
          : undefined;
      const materializedOriginal =
        original && !original.payloadKind
          ? await this.materialize(session, original)
          : undefined;
      const cancellation = materializedOriginal
        ? decodeRetainedSmartAccountCancellation(
            entry,
            materializedOriginal,
            owner
          )
        : null;
      guard(session);
      return operations.some((operation) => operation.account === owner)
        ? Object.freeze({ entry, operations })
        : cancellation
        ? Object.freeze({
            entry,
            cancellation,
            operations: decodeRetainedSmartAccountOperations(
              materializedOriginal!
            ),
          })
        : null;
    });
  }

  /** Resolve a public operation reference to its authenticated outer lineage. */
  findSmartAccountAuthorizationOuter(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    operationHash: string
  ): Promise<EvmRetainedSmartAccountRecord | null> {
    session = this.captureSession(session);
    const account = getAddress(address);
    if (!HASH.test(operationHash))
      throw new Error('SMART_ACCOUNT_AUTHORIZATION_CORRUPT');
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      // New rows have an exact hash hint. Older rows require bounded decoding;
      // an incomplete search must not silently authorize a fresh outer nonce.
      const candidates = (bundle?.entries ?? []).filter(
        (entry) =>
          entry.chainId === chainId &&
          entry.metadata?.smartAccountExecution === true &&
          typeof entry.metadata.smartAccountExecutionFrom === 'string' &&
          entry.metadata.smartAccountExecutionFrom.toLowerCase() ===
            account.toLowerCase() &&
          (!entry.metadata.smartAccountOperationHash ||
            entry.metadata.smartAccountOperationHash === operationHash)
      );
      let examined = 0;
      for (const header of candidates.toReversed()) {
        if (++examined > 128)
          throw new Error('SMART_ACCOUNT_AUTHORIZATION_LOOKUP_UNAVAILABLE');
        const entry = await this.materialize(session, header);
        const operations = decodeRetainedSmartAccountOperations(entry);
        if (
          operations.some(
            (operation) =>
              operation.account === account &&
              operation.operationHash === operationHash
          )
        )
          return Object.freeze({ entry, operations });
      }
      guard(session);
      return null;
    });
  }

  readSmartAccountReplayPage(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    options: Readonly<{ after?: number; beforeHash?: string; maximum: number }>
  ): Promise<
    Readonly<{
      entries: readonly EvmRetainedSmartAccountRecord[];
      nextCursor: string | null;
    }>
  > {
    const owner = getAddress(address),
      { after, beforeHash, maximum } = options;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > 48 ||
      (beforeHash !== undefined && !HASH.test(beforeHash))
    )
      throw new Error('EVM_SIGNED_RECORD_CAPACITY');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      const candidates = await this.withoutRevokedSmartAccountOperations(
        session,
        (bundle?.entries ?? []).filter(
          (entry) =>
            entry.chainId === chainId &&
            (after === undefined || entry.createdAt > after)
        ),
        bundle?.entries ?? [],
        bundle?.authorizations ?? []
      );
      const end =
        beforeHash === undefined
          ? candidates.length
          : candidates.findIndex((entry) => entry.hash === beforeHash);
      if (end < 0) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
      const entries: EvmRetainedSmartAccountRecord[] = [];
      for (
        let index = end - 1;
        index >= 0 && entries.length <= maximum;
        index--
      ) {
        if (candidates[index]!.payloadKind === 'unsigned-eoa') continue;
        const entry = await this.materialize(session, candidates[index]!);
        const operations = decodeRetainedSmartAccountOperations(entry);
        if (operations.some((operation) => operation.account === owner))
          entries.push(Object.freeze({ entry, operations }));
        else if (entry.operation === 'cancel' && entry.originalHash) {
          const original = bundle?.entries.find(
            (value) => value.hash === entry.originalHash
          );
          const materializedOriginal =
            original && !original.payloadKind
              ? await this.materialize(session, original)
              : undefined;
          const cancellation = materializedOriginal
            ? decodeRetainedSmartAccountCancellation(
                entry,
                materializedOriginal,
                owner
              )
            : null;
          if (cancellation)
            entries.push(
              Object.freeze({
                entry,
                cancellation,
                operations: decodeRetainedSmartAccountOperations(
                  materializedOriginal!
                ),
              })
            );
        }
      }
      const hasMore = entries.length > maximum;
      if (hasMore) entries.pop();
      guard(session);
      return Object.freeze({
        entries: Object.freeze(entries),
        nextCursor: hasMore ? entries[entries.length - 1]!.entry.hash : null,
      });
    });
  }

  readSmartAccountActivityExact(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<RetainedSmartAccountActivity | null> {
    const owner = getAddress(address);
    if (!HASH.test(hash)) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session),
        { bundle } = await this.load(session, id);
      const entry = bundle?.entries.find(
        (item) =>
          item.chainId === chainId &&
          item.hash === hash &&
          isSmartAccountActivityCandidate(item, owner)
      );
      if (!entry) return null;
      const materialized = await this.materialize(session, entry);
      const original =
        entry.operation === 'cancel' && entry.originalHash
          ? bundle?.entries.find((value) => value.hash === entry.originalHash)
          : undefined;
      return original && !original.payloadKind
        ? decodeRetainedSmartAccountCancellation(
            materialized,
            await this.materialize(session, original),
            owner
          )
        : decodeRetainedSmartAccountTransfer(materialized, owner);
    });
  }

  readPage(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    options: Readonly<{
      beforeHash?: string;
      maximum: number;
      nonce?: number;
      pendingOnly?: boolean;
    }>
  ): Promise<
    Readonly<{
      entries: readonly EvmRetainedRecord[];
      nextCursor: string | null;
      total: number;
    }>
  > {
    const from = getAddress(address).toLowerCase();
    const { maximum, beforeHash, nonce, pendingOnly } = options;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > 30 ||
      (beforeHash !== undefined && !HASH.test(beforeHash)) ||
      (nonce !== undefined && (!Number.isSafeInteger(nonce) || nonce < 0))
    )
      throw new Error('EVM_SIGNED_RECORD_CAPACITY');
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const scoped = (bundle?.entries ?? []).filter(
        (entry) =>
          entry.chainId === chainId &&
          entry.from === from &&
          (nonce === undefined || entry.nonce === nonce)
      );
      const end =
        beforeHash === undefined
          ? scoped.length
          : scoped.findIndex((entry) => entry.hash === beforeHash);
      if (end < 0) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
      // Locate the anchor in append order before filtering. Its phase may
      // have changed while the preceding page was visible.
      const visible = pendingOnly
        ? scoped.slice(0, end).filter((entry) => isPendingPhase(entry.phase))
        : scoped;
      const pageEnd = pendingOnly ? visible.length : end;
      const start = Math.max(0, pageEnd - maximum),
        entries: EvmRetainedRecord[] = [];
      for (const entry of visible.slice(start, pageEnd).reverse())
        entries.push(await this.materializeRecord(session, entry));
      guard(session);
      return Object.freeze({
        entries: Object.freeze(entries),
        total: pendingOnly
          ? scoped.filter((entry) => isPendingPhase(entry.phase)).length
          : scoped.length,
        nextCursor: start > 0 ? visible[start]!.hash : null,
      });
    });
  }
  /** Admit initial dispatch or replay under the authenticated cancellation barrier.
   * An owned replay preflight runs inside the queue. Box the result to release before its ACK. */
  withReplayAdmission<T>(
    session: EvmSignedRecordSession,
    {
      chainId,
      from,
      hash,
      nonce,
      operation,
      originalHash,
      metadata,
    }: Pick<
      EvmSignedRecordSummary,
      'chainId' | 'from' | 'hash' | 'nonce' | 'operation' | 'originalHash'
    > &
      Readonly<{ metadata: EvmSignedRecordSummary['metadata'] }>,
    admit: (
      predecessors: readonly EvmSignedRecordSummary[]
    ) => Promise<Readonly<{ result: T }>>,
    predecessorNonce?: number,
    preflight?: Readonly<{
      assertCurrent(): void;
      run(
        owner: string,
        autoNonceSnapshot: () => EvmAutoNonceSnapshot
      ): Promise<void>;
    }>
  ): Promise<Readonly<{ result: T }> | null> {
    const address = getAddress(from).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      // A queued replay may have expired before reaching storage.
      preflight?.assertCurrent();
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      assertNonceFloor(bundle, { chainId, from: address, nonce });
      const sender = (bundle?.entries ?? []).filter(
        (entry) => entry.chainId === chainId && entry.from === address
      );
      const replayableSender = await this.withoutRevokedSmartAccountOperations(
        session,
        sender,
        bundle?.entries ?? [],
        bundle?.authorizations ?? []
      );
      const variants = await this.replayableVariants(
        session,
        replayableSender.filter((entry) => entry.nonce === nonce)
      );
      const retained = variants.find((entry) => entry.hash === hash);
      if (
        !retained ||
        retained.operation !== operation ||
        retained.originalHash !== originalHash ||
        JSON.stringify(retained.metadata) !== JSON.stringify(metadata)
      )
        return null;
      const predecessors =
        predecessorNonce === undefined
          ? []
          : (
              await this.replayableVariants(
                session,
                replayableSender.filter(
                  (entry) => entry.nonce === predecessorNonce
                )
              )
            ).map(summary);
      guard(session);
      if (preflight) {
        await preflight.run(id, () =>
          this.autoNonceSnapshot(
            session,
            id,
            sender.filter((entry) => entry.hash !== hash),
            minimumNonce(bundle, { chainId, from: address }),
            bundle?.entries ?? [],
            bundle?.authorizations ?? []
          )
        );
        guard(session);
      }
      dispatchSerials.set(
        this.storage,
        (dispatchSerials.get(this.storage) ?? 0) + 1
      );
      return await admit(predecessors);
    });
  }
  async readExact(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<EvmRetainedRecord | null> {
    return (
      (await this.readForObservation(session, chainId, address, hash))?.entry ??
      null
    );
  }

  readForObservation(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<Readonly<{
    entry: EvmRetainedRecord;
    revision: number;
  }> | null> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const entry = bundle?.entries.find(
        (candidate) =>
          candidate.chainId === chainId &&
          candidate.from === from &&
          candidate.hash === hash
      );
      return entry && bundle
        ? Object.freeze({
            entry: await this.materializeRecord(session, entry),
            revision: bundle.revision,
          })
        : null;
    });
  }
  updatePhase(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    phase: EvmSignedPhase
  ): Promise<EvmSignedRecordSummary> {
    return this.writePhase(session, chainId, address, hash, phase);
  }

  updateObservedPhase(
    session: EvmSignedRecordSession,
    entry: Pick<EvmSignedRecordSummary, 'chainId' | 'from' | 'hash' | 'phase'>,
    revision: number,
    phase: EvmSignedPhase
  ): Promise<EvmSignedRecordSummary> {
    return this.writePhase(
      session,
      entry.chainId,
      entry.from,
      entry.hash,
      phase,
      { phase: entry.phase, revision }
    );
  }

  reconcileMinedCancellation(
    session: EvmSignedRecordSession,
    entry: Pick<
      EvmSignedRecordSummary,
      'chainId' | 'from' | 'hash' | 'nonce' | 'phase'
    >,
    revision: number,
    observation: MinedObservation,
    reobserve: () => Promise<EvmTransactionObservation>
  ): Promise<EvmSignedRecordSummary> {
    const { hash, from, chainId, nonce } = entry;
    const { outcome, block, transactionIndex } = observation;
    const { number, hash: blockHash } = block;
    const changed = () => new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
    const observed = { phase: entry.phase, revision };
    return this.writePhase(session, chainId, from, hash, outcome, observed, {
      nonce,
      inclusionVerified:
        transactionIndex !== undefined &&
        Number.isSafeInteger(transactionIndex) &&
        transactionIndex >= 0,
      async verify() {
        const timeout = 12_000;
        const cutoff = performance.now() + timeout;
        const assertFresh = () => {
          guard(session);
          if (performance.now() >= cutoff) throw changed();
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          assertFresh();
          const current = await Promise.race([
            reobserve(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(changed()), timeout);
            }),
          ]);
          assertFresh();
          if (
            current.status !== 'mined' ||
            current.outcome !== outcome ||
            current.transactionIndex !== transactionIndex ||
            current.block.number !== number ||
            current.block.hash !== blockHash
          )
            throw changed();
          return assertFresh;
        } catch {
          guard(session);
          throw changed();
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  private writePhase(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    phase: EvmSignedPhase,
    observed?: Readonly<{ phase: EvmSignedPhase; revision: number }>,
    cancellation?: Readonly<{
      inclusionVerified: boolean;
      nonce: number;
      verify(): Promise<() => void>;
    }>
  ): Promise<EvmSignedRecordSummary> {
    const from = getAddress(address).toLowerCase();
    session = this.captureSession(session);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        const entry = previous.bundle?.entries.find(
          (candidate) =>
            candidate.chainId === chainId &&
            candidate.from === from &&
            candidate.hash === hash
        );
        if (!entry || !previous.bundle)
          throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
        const revisionChanged =
          observed !== undefined &&
          observed.revision !== previous.bundle.revision;
        const hasSibling =
          (revisionChanged || cancellation !== undefined) &&
          previous.bundle.entries.some(
            (candidate) => candidate !== entry && matchesNonce(candidate, entry)
          );
        // Unrelated journal writes can overlap a standalone observation. With
        // competing hashes, the revision must still bind their whole lineage.
        if (
          observed &&
          (observed.phase !== entry.phase || (revisionChanged && hasSibling))
        )
          throw new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
        if (
          cancellation &&
          (entry.operation !== 'cancel' || entry.nonce !== cancellation.nonce)
        )
          throw new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
        const reconcile = hasSibling ? cancellation : undefined;
        if (reconcile && !reconcile.inclusionVerified)
          throw new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
        if (!isPendingPhase(phase) || !isPendingPhase(entry.phase))
          this.autoNonceAcceptance.retireNonce(id, entry);
        if (!reconcile && entry.phase === phase) return summary(entry);
        const next =
          entry.phase === phase ? entry : Object.freeze({ ...entry, phase });
        let changesSibling = false;
        const entries = previous.bundle.entries.map((candidate) => {
          if (candidate === entry) return next;
          if (!reconcile || !matchesNonce(candidate, entry)) return candidate;
          if (candidate.phase === 'nonce-consumed') return candidate;
          changesSibling = true;
          return Object.freeze({
            ...candidate,
            phase: 'nonce-consumed' as const,
          });
        });
        if (entry === next && !changesSibling) return summary(entry);
        if (
          await this.write(
            session,
            id,
            previous.raw,
            previous.bundle.revision + 1,
            entries,
            previous.bundle.authorizations,
            previous.bundle.nonceFloors,
            false,
            previous.bundle.resetGeneration,
            reconcile?.verify
          )
        )
          return summary(next);
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }
}

/** Shared SDK hook implementation; hosts contribute only a captured session and storage. */
export function createEvmSignedRecordLifecycle(
  records: EvmSignedRecords,
  session: EvmSignedRecordSession,
  options: Readonly<{
    automaticNonceEndpoint?: string;
    metadata?: Readonly<Record<string, unknown>>;
    preflight?: (
      record: EvmSignedSubmission,
      assertCurrent: () => void,
      autoNonceSnapshot: EvmAutoNonceSnapshot
    ) => Promise<void>;
    replacement?:
      | EvmVerifiedReplacementBinding
      | EvmVerifiedSmartAccountReplacement
      | Promise<
          EvmVerifiedReplacementBinding | EvmVerifiedSmartAccountReplacement
        >;
    // Opt in only when the host can recheck the original token approval.
    retainAssetPreflightFailure?: boolean;
    retainUnsignedNative?: boolean;
    retirementReadForChain: EvmSignedRetirementReadForChain | null;
    walletSendCleanupSession?: EvmSignedRecordSession;
  }>
) {
  session = records.captureSession(session);
  if (
    !options ||
    (options.retirementReadForChain !== null &&
      typeof options.retirementReadForChain !== 'function')
  )
    throw new Error('EVM_SIGNED_RECORD_RETIREMENT_CONTEXT_REQUIRED');
  const retirementReadForChain = options.retirementReadForChain;
  const cleanupSession =
    options.walletSendCleanupSession &&
    records.captureSession(options.walletSendCleanupSession);
  let metadata =
    options.metadata === undefined
      ? undefined
      : snapshotMetadata(options.metadata);
  let smartReplacementOriginalHash: string | undefined;
  let freshWalletSend: EvmRetainedSignedRecord | undefined;
  // Starting another lifecycle invalidates any unconsumed earlier refusal.
  // Concurrent sends may fall back to generic guidance, never stale guidance.
  currentPersistToken = undefined;
  return Object.freeze({
    assertCurrent: () => guard(session),
    persistSigned: async (record: EvmSignedSubmission) => {
      const token = {};
      currentPersistToken = token;
      // Capture the SDK's exact signed envelope before any asynchronous work.
      // Persistence must complete before these exact bytes may be dispatched.
      const signed = Object.freeze({
        ...record,
        context: Object.freeze({
          ...record.context,
          account: Object.freeze({ ...record.context.account }),
          network: Object.freeze({ ...record.context.network }),
        }),
      });
      const replacement = options.replacement && (await options.replacement);
      if (signed.context.operation === 'cancel') {
        metadata = replacementMetadata(metadata, undefined, 'cancel');
      } else if (signed.context.operation === 'speed-up' && replacement) {
        const original = await records.readExact(
          session,
          signed.chainId,
          signed.from,
          replacement.originalHash
        );
        metadata = replacementMetadata(metadata, original, 'speed-up');
      }
      const persist = async () => {
        const retained = await records.append(
          session,
          signed,
          metadata,
          replacement,
          options.retainUnsignedNative
        );
        if (
          cleanupSession &&
          !signed.context.origin &&
          !isEvmVerifiedSmartAccountReplacement(replacement)
        ) {
          freshWalletSend = retained;
        }
        if (isEvmVerifiedSmartAccountReplacement(replacement)) {
          smartReplacementOriginalHash = retained.originalHash;
          metadata = retained.metadata;
        }
      };
      try {
        await persist();
      } catch (error) {
        guard(session);
        if (
          !error ||
          typeof error !== 'object' ||
          !appendCapacityLimits.has(error)
        )
          throw error;
        if (
          retirementReadForChain &&
          (await records.retireAvailableFinalized(
            session,
            {
              chainId: String(signed.context.network.chainId),
              from: signed.context.account.address,
            },
            retirementReadForChain
          )) > 0
        ) {
          try {
            await persist();
            return;
          } catch (retryError) {
            guard(session);
            if (
              retryError &&
              typeof retryError === 'object' &&
              appendCapacityLimits.has(retryError)
            )
              signedCapacityRefusals.set(retryError, {
                hash: signed.hash,
                token,
              });
            throw retryError;
          }
        }
        signedCapacityRefusals.set(error, { hash: signed.hash, token });
        throw error;
      }
      guard(session);
    },
    async dispatchSigned<T>(
      record: EvmSignedSubmission,
      initiate: () => Promise<T>,
      preflight: () => Promise<void>
    ): Promise<T> {
      let expires: number | undefined;
      let trackAcknowledgement: (() => (hash: unknown) => void) | undefined;
      const expired = () => new Error('EVM_SIGNED_DISPATCH_PREFLIGHT_EXPIRED');
      const assertAdmission = () => {
        guard(session);
        if (expires !== undefined && performance.now() >= expires)
          throw expired();
      };
      let retainedAuthenticated = false;
      let wireStarted = false;
      let admitted: Readonly<{ result: Promise<T> }> | null;
      try {
        admitted = await records.withReplayAdmission(
          session,
          {
            chainId: record.chainId,
            from: record.from,
            nonce: record.nonce,
            hash: record.hash,
            operation: record.context.operation,
            originalHash:
              record.context.originalHash?.toLowerCase() ??
              smartReplacementOriginalHash,
            metadata,
          },
          async () => {
            assertAdmission();
            const recordAcknowledgement = trackAcknowledgement?.();
            let response: Promise<T>;
            try {
              // Once initiation begins, even a synchronous failure may be an
              // ambiguous POST; never classify it as a held preflight refusal.
              wireStarted = true;
              response = initiate();
            } catch (error) {
              recordAcknowledgement?.(undefined);
              throw error;
            }
            if (recordAcknowledgement) {
              response = response.then(
                (value) => {
                  try {
                    guard(session);
                    recordAcknowledgement(
                      value && typeof value === 'object' && 'hash' in value
                        ? value.hash
                        : value
                    );
                  } catch {
                    // The acknowledged send may have outlived its wallet scope.
                    recordAcknowledgement(undefined);
                  }
                  return value;
                },
                (error: unknown) => {
                  recordAcknowledgement(undefined);
                  throw error;
                }
              );
            }
            void response.catch(() => undefined);
            return { result: response };
          },
          undefined,
          {
            assertCurrent: assertAdmission,
            async run(owner, autoNonceSnapshot) {
              // withReplayAdmission has authenticated the exact retained record.
              retainedAuthenticated = true;
              const endpoint = options?.automaticNonceEndpoint;
              if (endpoint) {
                if (endpoint !== record.context.network.url)
                  throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
                trackAcknowledgement = () =>
                  records.autoNonceAcceptance.track(owner, endpoint, record);
              }
              const timeout = 12_000;
              expires = performance.now() + timeout;
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  (async () => {
                    await preflight();
                    assertAdmission();
                    await options?.preflight?.(
                      record,
                      assertAdmission,
                      autoNonceSnapshot()
                    );
                    assertAdmission();
                  })(),
                  new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(expired()), timeout);
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            },
          }
        );
        if (!admitted) throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      } catch (error) {
        const operation = record.context.operation;
        if (
          !wireStarted &&
          cleanupSession &&
          freshWalletSend?.hash === record.hash &&
          (await records[discardUndispatched](cleanupSession, freshWalletSend))
        ) {
          if (options.retainAssetPreflightFailure)
            throw Object.assign(new Error(EVM_ASSET_REVIEW_MESSAGE), {
              code: EVM_ASSET_REVIEW_REQUIRED,
            });
          throw error;
        }
        if (
          options?.retainAssetPreflightFailure &&
          retainedAuthenticated &&
          !wireStarted &&
          (operation === 'erc20' ||
            operation === 'erc721' ||
            operation === 'erc1155')
        ) {
          // Wallet/session invalidation has precedence over recovery guidance.
          guard(session);
          const marker = new Error('EVM_SIGNED_ASSET_PREFLIGHT_FAILED');
          heldAssetPreflightFailures.set(marker, {
            hash: record.hash,
            operation,
          });
          throw marker;
        }
        throw error;
      }
      return admitted.result;
    },
  });
}
