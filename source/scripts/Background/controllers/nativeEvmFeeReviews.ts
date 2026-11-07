import {
  assertEvmFeeApprovalCurrent,
  assertSynchronousEvmFeeGuard,
  EVM_FEE_APPROVAL_LIFETIME_MS,
} from '../../../shared/evmFeeApproval';

import type { ExtensionReviewedNonce } from './evmAutoNonce';
import type { captureReviewedNativeEvmTransfer } from './freshNativeGasEstimate';

type Review = ReturnType<typeof captureReviewedNativeEvmTransfer> &
  Readonly<{ walletNonce: ExtensionReviewedNonce }>;
type Pending = Readonly<{ assertCurrent: () => void; review: Review }>;
const pendingByOwner = new WeakMap<object, Map<string, Pending>>();
const MAX_PENDING_REVIEWS = 8;

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
  let pending = pendingByOwner.get(owner);
  if (!pending) {
    pending = new Map();
    pendingByOwner.set(owner, pending);
  }
  for (const [id, value] of pending) {
    try {
      assertSynchronousEvmFeeGuard(value.assertCurrent);
      assertEvmFeeApprovalCurrent(value.review.approval, now);
    } catch {
      pending.delete(id);
    }
  }
  if (pending.size >= MAX_PENDING_REVIEWS)
    pending.delete(pending.keys().next().value!);
  const id = randomId();
  if (typeof id !== 'string' || !id || pending.has(id))
    throw new Error('Native fee review ID unavailable');
  pending.set(id, Object.freeze({ review, assertCurrent }));
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
  if (!value) throw new Error('Native fee review is unavailable');
  pending!.delete(id);
  assertSynchronousEvmFeeGuard(value.assertCurrent);
  assertEvmFeeApprovalCurrent(value.review.approval, now);
  return value;
}

export function discardNativeEvmFeeReview(owner: object, id: string): void {
  pendingByOwner.get(owner)?.delete(id);
}
