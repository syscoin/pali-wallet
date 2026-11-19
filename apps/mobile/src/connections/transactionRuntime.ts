import { captureEvmGasPolicy, type EvmGasPolicy } from '../../../../source/shared/evmDappPreparation.ts';
import type { EvmDappFeeComparison } from '../../../../source/shared/evmDappFeePolicy.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { prepareEvmDappReview, type EvmDappSubmission } from '../../../../source/shared/evmDappReview.ts';
import { type EvmFeeFunding } from '../../../../source/shared/evmFeeApproval.ts';
import { EvmTransferReadError, guardedRead } from '../custody/evmFeeContracts.ts';
import type { EvmTransferReadRpc, NativeAutomaticNoncePlanner } from '../custody/evmTransferReadRpc.ts';
import type { NativeTransferDispatchValidation } from '../custody/transfers.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import { decodeApprovalData, summarizeApproval, type ApprovalContractMetadata, type ApprovalSummary } from '../../../../source/shared/approval.ts';
import { decodeAssetTransfer, type AssetTransferCall } from '../../../../source/shared/assetTransfer.ts';
export type NativeConnectionSubmission = EvmDappSubmission;

type NativeConnectionSubmissionFailure = 'retryable' | 'not-sent' | 'uncertain';
const nativeSubmissionFailures = new WeakMap<object, NativeConnectionSubmissionFailure>();

/** Retry evidence comes from the pre-send refresh or the custody host's SDK stage and journal cleanup. */
export function recordNativeConnectionSubmissionFailure(
  error: unknown,
  failure: NativeConnectionSubmissionFailure
): void {
  if (error && typeof error === 'object') nativeSubmissionFailures.set(error, failure);
}

export function nativeConnectionSubmissionFailure(error: unknown): NativeConnectionSubmissionFailure | undefined {
  return error && typeof error === 'object' ? nativeSubmissionFailures.get(error) : undefined;
}

/** Private one-use capability. Only the connection controller holds it. */
export type NativePreparedConnectionTransaction = Readonly<{
  feeComparison: EvmDappFeeComparison;
  transaction: PreparedEvmTransaction;
  maximumFeeUnits: string;
  coveredFeeUnits: string;
  maximumTotalUnits: string;
  expiresAtMonotonicMilliseconds: number;
  approval: ApprovalSummary | null;
  assetTransfer?: AssetTransferCall | null;
  submit(assertCurrent: () => void, onBroadcast: (hash: string) => void, submission: NativeConnectionSubmission): Promise<string>;
}>;

type SignedTransaction = Readonly<{ rawTransaction: string; hash: string }>;
type Ports = Readonly<{
  network: NativeNetworkRegistration;
  funding: EvmFeeFunding;
  gasPolicy: EvmGasPolicy;
  feePolicy?: 'fixed';
  /** Initial review and pre-authorization refresh use only the approved ceiling. */
  estimateAfterAuthorization?: true;
  rpc: EvmTransferReadRpc;
  signal: AbortSignal;
  planner: NativeAutomaticNoncePlanner;
  assertCurrent(): void;
  assertRefreshedState?(provider: unknown): Promise<void>;
  sign(transaction: PreparedEvmTransaction, assertCurrent: () => void,
    recheckAfterAuthorization?: (guard: () => void) => Promise<void>): Promise<SignedTransaction>;
  submit(transaction: PreparedEvmTransaction, signed: SignedTransaction, assertCurrent: () => void,
    verifyDispatch: NativeTransferDispatchValidation, onBroadcast: (hash: string) => void,
    submission: NativeConnectionSubmission): Promise<string>;
  now?: () => number;
  readApprovalMetadata?(contract: string, assertCurrent: () => void): Promise<ApprovalContractMetadata | undefined>;
}>;

export async function prepareNativeConnectionTransaction(input: unknown, ports: Ports): Promise<NativePreparedConnectionTransaction> {
  const gasPolicy = captureEvmGasPolicy(ports.gasPolicy);
  const estimateAfterAuthorization = ports.estimateAfterAuthorization === true;
  if (estimateAfterAuthorization && gasPolicy.kind !== 'fixed') throw new Error('REVIEW_REQUIRED');
  const planner = ports.planner;
  // Submission's first refresh is still before device authorization. A
  // separate nonce context lets the authenticated refresh estimate the exact
  // envelope, just as signed-journal dispatch does with its owned context.
  const authorizationPlanner: NativeAutomaticNoncePlanner = input => planner(input);
  const check = () => {
    guardedRead(ports.assertCurrent);
    if (ports.signal.aborted) throw new Error('CANCELLED');
  };
  const review = await prepareEvmDappReview(input, {
    chainId: ports.network.chainId,
    scope: ports.network.registrationHash,
    signal: ports.signal,
    nonceContext: planner,
    now: ports.now ?? (() => Math.floor(performance.now())),
    assertCurrent: check,
    onPreSendRefreshFailure(error, submission) {
      if (submission.kind === 'transaction' &&
          (error instanceof EvmTransferReadError && error.code === 'REVIEW_REQUIRED' ||
           error instanceof Error && error.message === 'EVM fee approval changed'))
        recordNativeConnectionSubmissionFailure(error, 'retryable');
    },
    prepare: (request, assertCurrent, nonceContext, approved) =>
      ports.rpc.prepareDapp(request, ports.signal, assertCurrent, nonceContext, approved, ports.funding,
        estimateAfterAuthorization && nonceContext !== planner ? { kind: 'estimate' } : gasPolicy, ports.feePolicy,
        nonceContext === planner ? ports.assertRefreshedState : undefined),
    async send(transaction, assertCurrent, verifyDispatch, onBroadcast, submission) {
      const signed = await ports.sign(
        transaction,
        assertCurrent,
        estimateAfterAuthorization ? guard => verifyDispatch(authorizationPlanner, guard) : undefined
      );
      assertCurrent();
      return ports.submit(transaction, signed, assertCurrent, verifyDispatch, onBroadcast, submission);
    },
  });
  const contract = review.transaction.to;
  const metadata = contract && (decodeApprovalData(review.transaction.data).isApproval || decodeAssetTransfer(review.transaction.data, contract))
    ? await ports.readApprovalMetadata?.(contract, check) : undefined;
  check();
  return Object.freeze({
    ...review,
    assetTransfer: contract ? decodeAssetTransfer(review.transaction.data, contract, metadata) : null,
    approval: contract ? summarizeApproval(review.transaction.data, contract, metadata) : null,
  });
}
