import {
  readEvmOwnData,
  serializePreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { Transaction } from 'ethers/transaction';

import {
  captureEvmFeeApproval,
  assertEvmFeeApprovalCurrent,
  assertSynchronousEvmFeeGuard,
  EVM_FEE_APPROVAL_LIFETIME_MS,
} from '../../../shared/evmFeeApproval';
import {
  capturePrivateDepositAttempt,
  privateDepositUnsignedBytes,
} from '../../../utils/privacy/depositMetadata';
import {
  capturePrivateWithdrawalAttempt,
  privateWithdrawalUnsignedBytes,
} from '../../../utils/privacy/withdrawalMetadata';

import type { ExtensionReviewedNonce } from './evmAutoNonce';
import type { captureReviewedNativeEvmTransfer } from './freshNativeGasEstimate';
import type { IEvmTransactionResponse } from './transactions/types';
import type { EvmAutoNonceSnapshot } from '../../../shared/evmAutoNonce';
import type { EvmDappReview } from '../../../shared/evmDappReview';
import type { IEvmTransactionContext } from '../../../utils/evmTransactionContext';
import type { IPrivacyDepositAttempt } from '../../../utils/privacy/transactionTypes';
import type { IPrivacyWithdrawalAttempt } from '../../../utils/privacy/withdrawalTransactionTypes';
import type {
  EvmSignedSubmission,
  EvmSubmissionContext,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';

type Review = ReturnType<typeof captureReviewedNativeEvmTransfer> &
  Readonly<{ walletNonce: ExtensionReviewedNonce }>;
type Pending = Readonly<{ assertCurrent: () => void; review: Review }>;
type DispatchCheck = (
  record: EvmSignedSubmission,
  assertCurrent: () => void,
  snapshot: EvmAutoNonceSnapshot
) => Promise<void>;
export type GenericEvmFeeAuthority =
  | Readonly<{ kind: 'dapp'; request: object }>
  | Readonly<{ kind: 'wallet' }>
  | Readonly<{
      kind: 'private-deposit' | 'private-withdrawal';
      request: object;
    }>;
const sameAuthority = (
  expected: GenericEvmFeeAuthority,
  actual: GenericEvmFeeAuthority
) =>
  expected.kind === actual.kind &&
  (expected.kind === 'wallet' ||
    (actual.kind !== 'wallet' && expected.request === actual.request));
type GenericPending = Readonly<{
  approval: ReturnType<typeof captureEvmFeeApproval>;
  assertCurrent: () => void;
  authority: GenericEvmFeeAuthority;
  context: Readonly<IEvmTransactionContext>;
  review: EvmDappReview<IEvmTransactionResponse>;
  unsignedHash: string;
  walletNonce: ExtensionReviewedNonce;
}>;
type PrivateNoteAttempt =
  | Readonly<{ attempt: Readonly<IPrivacyDepositAttempt>; kind: 'deposit' }>
  | Readonly<{
      attempt: Readonly<Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>>;
      kind: 'withdrawal';
    }>;
type Entry =
  | { kind: 'native'; value: Pending }
  | {
      dispatch?: DispatchCheck;
      kind: 'generic';
      phase: 'quoted' | 'consumed' | 'dispatch';
      privateNote: PrivateNoteAttempt | null;
      sdkEntered: boolean;
      value: GenericPending;
    };
const pendingByOwner = new WeakMap<object, Map<string, Entry>>();
const MAX_PENDING_REVIEWS = 8;

function reserveReview(
  owner: object,
  approval: ReturnType<typeof captureEvmFeeApproval>,
  assertCurrent: () => void,
  now: number,
  randomId: () => string
) {
  assertSynchronousEvmFeeGuard(assertCurrent);
  assertEvmFeeApprovalCurrent(approval, now);
  let pending = pendingByOwner.get(owner);
  if (!pending) {
    pending = new Map();
    pendingByOwner.set(owner, pending);
  }
  for (const [id, entry] of pending) {
    try {
      assertSynchronousEvmFeeGuard(entry.value.assertCurrent);
      assertEvmFeeApprovalCurrent(
        entry.kind === 'native'
          ? entry.value.review.approval
          : entry.value.approval,
        now
      );
    } catch {
      pending.delete(id);
    }
  }
  if (pending.size >= MAX_PENDING_REVIEWS) {
    const unused = [...pending].find(
      ([, entry]) => entry.kind === 'native' || entry.phase === 'quoted'
    );
    if (!unused) throw new Error('Too many active EVM fee reviews');
    pending.delete(unused[0]);
  }
  const id = randomId();
  if (
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
    pending.has(id)
  )
    throw new Error('EVM fee review ID unavailable');
  return { pending, id };
}

/** IDs are scoped to this live controller and captured approval. */
export function issueNativeEvmFeeReview(
  owner: object,
  review: Review,
  assertCurrent: () => void,
  now: number,
  randomId: () => string = () => crypto.randomUUID()
) {
  assertSynchronousEvmFeeGuard(assertCurrent);
  assertEvmFeeApprovalCurrent(review.approval, now);
  if (review.nonce !== BigInt(review.walletNonce.nonce))
    throw new Error('Native fee review nonce changed');
  const { pending, id } = reserveReview(
    owner,
    review.approval,
    assertCurrent,
    now,
    randomId
  );
  pending.set(id, {
    kind: 'native',
    value: Object.freeze({ review, assertCurrent }),
  });
  return Object.freeze({
    id,
    maximumFee: review.approval.maximumFeeUnits,
    validForMs: Math.min(
      EVM_FEE_APPROVAL_LIFETIME_MS,
      review.approval.expiresAtMonotonicMilliseconds - now
    ),
  });
}

/** Consume before rechecking or signing so a failed attempt needs a new review. */
export function consumeNativeEvmFeeReview(
  owner: object,
  id: string,
  now: number
): Pending {
  const pending = pendingByOwner.get(owner);
  const value = typeof id === 'string' ? pending?.get(id) : undefined;
  if (!value || value.kind !== 'native')
    throw new Error('Native fee review is unavailable');
  pending!.delete(id);
  assertSynchronousEvmFeeGuard(value.value.assertCurrent);
  assertEvmFeeApprovalCurrent(value.value.review.approval, now);
  return value.value;
}

export function discardNativeEvmFeeReview(owner: object, id: string): void {
  pendingByOwner.get(owner)?.delete(id);
}

function assertMatchingContext(
  expected: IEvmTransactionContext,
  actual: IEvmTransactionContext
) {
  if (
    expected.account.id !== actual.account.id ||
    expected.account.type !== actual.account.type ||
    expected.account.address.toLowerCase() !==
      actual.account.address.toLowerCase() ||
    expected.chainId !== actual.chainId ||
    expected.rpcUrl !== actual.rpcUrl ||
    expected.slip44 !== actual.slip44 ||
    expected.sessionGeneration !== actual.sessionGeneration
  )
    throw new Error('EVM fee review context changed');
}

/** Generic reviews share the existing bounded owner registry with native sends. */
export function issueGenericEvmFeeReview(
  owner: object,
  review: EvmDappReview<IEvmTransactionResponse>,
  context: IEvmTransactionContext,
  walletNonce: ExtensionReviewedNonce,
  assertCurrent: () => void,
  now: number,
  authority: GenericEvmFeeAuthority,
  randomId: () => string = () => crypto.randomUUID()
) {
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (
    !Number.isSafeInteger(context.sessionGeneration) ||
    review.transaction.nonce !== String(walletNonce.nonce) ||
    review.transaction.chainId !== String(context.chainId) ||
    review.transaction.from.toLowerCase() !==
      context.account.address.toLowerCase()
  )
    throw new Error('Invalid generic fee review context');
  const captured = Object.freeze({
    ...context,
    account: Object.freeze({ ...context.account }),
  });
  const approval = captureEvmFeeApproval(
    review.transaction,
    JSON.stringify(captured),
    review.expiresAtMonotonicMilliseconds
  );
  assertEvmFeeApprovalCurrent(approval, now);
  const { pending, id } = reserveReview(
    owner,
    approval,
    assertCurrent,
    now,
    randomId
  );
  const unsignedHash = Transaction.from(
    serializePreparedEvmTransaction(review.transaction)
  ).unsignedHash;
  pending.set(id, {
    kind: 'generic',
    phase: 'quoted',
    privateNote: null,
    sdkEntered: false,
    value: Object.freeze({
      assertCurrent,
      authority: Object.freeze({ ...authority }),
      context: captured,
      approval,
      review,
      walletNonce: Object.freeze({ ...walletNonce }),
      unsignedHash,
    }),
  });
  return Object.freeze({
    id,
    transaction: review.transaction,
    maximumFeeUnits: review.maximumFeeUnits,
    maximumTotalUnits: review.maximumTotalUnits,
    validForMs: review.expiresAtMonotonicMilliseconds - now,
  });
}

/** The caller must still supply its independently verified dapp or wallet authority. */
export function consumeGenericEvmFeeReview(
  owner: object,
  id: string,
  context: IEvmTransactionContext,
  assertCurrent: () => void,
  now: number,
  authority: GenericEvmFeeAuthority
) {
  const pending = pendingByOwner.get(owner);
  const entry = pending?.get(id);
  if (!entry || entry.kind !== 'generic' || entry.phase !== 'quoted')
    throw new Error('Generic fee review is unavailable');
  if (!sameAuthority(entry.value.authority, authority))
    throw new Error('EVM fee review request changed');
  assertMatchingContext(entry.value.context, context);
  entry.phase = 'consumed';
  try {
    assertSynchronousEvmFeeGuard(assertCurrent);
    assertSynchronousEvmFeeGuard(entry.value.assertCurrent);
    assertEvmFeeApprovalCurrent(entry.value.approval, now);
  } catch (error) {
    pending!.delete(id);
    throw error;
  }
  const check = () => {
    if (pending!.get(id) !== entry)
      throw new Error('Generic fee review is unavailable');
    assertSynchronousEvmFeeGuard(assertCurrent);
    assertSynchronousEvmFeeGuard(entry.value.assertCurrent);
    assertEvmFeeApprovalCurrent(
      entry.value.approval,
      Math.floor(performance.now())
    );
  };
  return Object.freeze({
    review: entry.value.review,
    walletNonce: entry.value.walletNonce,
    assertCurrent: check,
    close() {
      if (pending!.get(id) === entry) pending!.delete(id);
    },
  });
}

/** Only the SDK's explicit review identity selects a live dispatch lease. */
export function captureGenericEvmFeeDispatch(
  owner: object,
  context: EvmSubmissionContext & {
    review?: Readonly<{ id: string; unsignedHash: string }>;
  }
) {
  const identity = context.review;
  if (!identity) return null;
  const pending = pendingByOwner.get(owner);
  const entry = pending?.get(identity.id);
  if (
    !entry ||
    entry.kind !== 'generic' ||
    entry.phase !== 'dispatch' ||
    !entry.dispatch
  )
    throw new Error('Generic fee review dispatch is unavailable');
  const { value, dispatch } = entry;
  const expected = value.context;
  if (
    identity.unsignedHash !== value.unsignedHash ||
    context.operation !== 'send' ||
    context.account.id !== expected.account.id ||
    context.account.type !== expected.account.type ||
    context.account.address.toLowerCase() !==
      expected.account.address.toLowerCase() ||
    context.network.kind !== 'ethereum' ||
    context.network.chainId !== expected.chainId ||
    context.network.url !== expected.rpcUrl ||
    context.network.slip44 !== expected.slip44 ||
    context.walletNonce?.nonce !== value.walletNonce.nonce ||
    context.walletNonce?.source !== value.walletNonce.source
  )
    throw new Error('Generic fee review dispatch context changed');
  const preflight = async (
    record: EvmSignedSubmission,
    assertCurrent: () => void,
    snapshot: EvmAutoNonceSnapshot
  ) => {
    if (pending!.get(identity.id) !== entry || entry.phase !== 'dispatch')
      throw new Error('Generic fee review dispatch is unavailable');
    assertSynchronousEvmFeeGuard(assertCurrent);
    assertSynchronousEvmFeeGuard(value.assertCurrent);
    assertEvmFeeApprovalCurrent(value.approval, Math.floor(performance.now()));
    if (
      Transaction.from(record.rawTransaction).unsignedHash !==
      value.unsignedHash
    )
      throw new Error('Generic fee review signed envelope changed');
    await dispatch(record, assertCurrent, snapshot);
    if (pending!.get(identity.id) !== entry)
      throw new Error('Generic fee review dispatch is unavailable');
    assertSynchronousEvmFeeGuard(assertCurrent);
    assertSynchronousEvmFeeGuard(value.assertCurrent);
    assertEvmFeeApprovalCurrent(value.approval, Math.floor(performance.now()));
  };
  return Object.freeze({
    preflight,
    metadata: entry.privateNote
      ? entry.privateNote.kind === 'deposit'
        ? Object.freeze({ privateDeposit: entry.privateNote.attempt })
        : Object.freeze({ privateWithdrawal: entry.privateNote.attempt })
      : undefined,
  });
}

/** Bind the consumed review before the SDK synchronously captures its lifecycle. */
export function bindGenericEvmFeeDispatch(
  owner: object,
  id: string,
  context: IEvmTransactionContext,
  dispatch: DispatchCheck
): void {
  const entry = pendingByOwner.get(owner)?.get(id);
  if (
    !entry ||
    entry.kind !== 'generic' ||
    entry.phase !== 'consumed' ||
    typeof dispatch !== 'function' ||
    ((entry.value.authority.kind === 'private-deposit' ||
      entry.value.authority.kind === 'private-withdrawal') &&
      entry.privateNote === null)
  )
    throw new Error('Generic fee review dispatch is unavailable');
  assertMatchingContext(entry.value.context, context);
  assertSynchronousEvmFeeGuard(entry.value.assertCurrent);
  assertEvmFeeApprovalCurrent(
    entry.value.approval,
    Math.floor(performance.now())
  );
  entry.dispatch = dispatch;
  entry.phase = 'dispatch';
}

/** Only the private host can bind its reserved note to this opaque fee capability. */
export function bindPrivateNoteFeeAttempt(
  owner: object,
  id: string,
  context: IEvmTransactionContext,
  input: PrivateNoteAttempt
): void {
  const request = readEvmOwnData(input, ['kind', 'attempt']);
  if (request.kind !== 'deposit' && request.kind !== 'withdrawal')
    throw new Error('Private note fee review is unavailable');
  const entry = pendingByOwner.get(owner)?.get(id);
  if (
    !entry ||
    entry.kind !== 'generic' ||
    entry.phase !== 'quoted' ||
    entry.value.authority.kind !==
      (request.kind === 'deposit' ? 'private-deposit' : 'private-withdrawal')
  )
    throw new Error('Private note fee review is unavailable');
  assertMatchingContext(entry.value.context, context);
  assertSynchronousEvmFeeGuard(entry.value.assertCurrent);
  const captured: PrivateNoteAttempt =
    request.kind === 'deposit'
      ? {
          kind: 'deposit',
          attempt: capturePrivateDepositAttempt(request.attempt),
        }
      : {
          kind: 'withdrawal',
          attempt: capturePrivateWithdrawalAttempt(request.attempt),
        };
  assertMatchingContext(context, captured.attempt.context);
  const bytes =
    captured.kind === 'deposit'
      ? privateDepositUnsignedBytes(captured.attempt)
      : privateWithdrawalUnsignedBytes(captured.attempt);
  if (bytes !== serializePreparedEvmTransaction(entry.value.review.transaction))
    throw new Error('Private note fee review changed');
  entry.privateNote = captured;
}

/** The invocation boundary is owned by MainController, independently of provider fields. */
export function markGenericEvmFeeSdkEntered(owner: object, id: string): void {
  const entry = pendingByOwner.get(owner)?.get(id);
  if (!entry || entry.kind !== 'generic' || entry.phase !== 'dispatch')
    throw new Error('Generic fee review dispatch is unavailable');
  assertSynchronousEvmFeeGuard(entry.value.assertCurrent);
  entry.sdkEntered = true;
}

export function captureGenericEvmFeeSdkEntryState(
  owner: object,
  id: string
): () => boolean {
  const entry = pendingByOwner.get(owner)?.get(id);
  if (!entry || entry.kind !== 'generic')
    throw new Error('Generic fee review is unavailable');
  return () => entry.sdkEntered;
}
