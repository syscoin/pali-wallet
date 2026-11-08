import type { EvmDappFeeComparison } from '../../../../source/shared/evmDappFeePolicy.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { prepareEvmDappReview } from '../../../../source/shared/evmDappReview.ts';
import { type EvmFeeFunding } from '../../../../source/shared/evmFeeApproval.ts';
import { guardedRead } from '../custody/evmFeeContracts.ts';
import type { EvmTransferReadRpc, NativeAutomaticNoncePlanner } from '../custody/evmTransferReadRpc.ts';
import type { NativeTransferDispatchValidation } from '../custody/transfers.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import { decodeApprovalData, summarizeApproval, type ApprovalContractMetadata, type ApprovalSummary } from '../../../../source/shared/approval.ts';

/** Private one-use capability. Only the connection controller holds it. */
export type NativePreparedConnectionTransaction = Readonly<{
  feeComparison: EvmDappFeeComparison;
  transaction: PreparedEvmTransaction;
  maximumFeeUnits: string;
  coveredFeeUnits: string;
  maximumTotalUnits: string;
  expiresAtMonotonicMilliseconds: number;
  approval: ApprovalSummary | null;
  submit(assertCurrent: () => void, onBroadcast: (hash: string) => void): Promise<string>;
}>;

type SignedTransaction = Readonly<{ rawTransaction: string; hash: string }>;
type Ports = Readonly<{
  network: NativeNetworkRegistration;
  funding: EvmFeeFunding;
  rpc: EvmTransferReadRpc;
  signal: AbortSignal;
  planner: NativeAutomaticNoncePlanner;
  assertCurrent(): void;
  sign(transaction: PreparedEvmTransaction, assertCurrent: () => void): Promise<SignedTransaction>;
  submit(transaction: PreparedEvmTransaction, signed: SignedTransaction, assertCurrent: () => void,
    verifyDispatch: NativeTransferDispatchValidation, onBroadcast: (hash: string) => void): Promise<string>;
  now?: () => number;
  readApprovalMetadata?(contract: string, assertCurrent: () => void): Promise<ApprovalContractMetadata | undefined>;
}>;

export async function prepareNativeConnectionTransaction(input: unknown, ports: Ports): Promise<NativePreparedConnectionTransaction> {
  const check = () => {
    guardedRead(ports.assertCurrent);
    if (ports.signal.aborted) throw new Error('CANCELLED');
  };
  const review = await prepareEvmDappReview(input, {
    chainId: ports.network.chainId,
    scope: ports.network.registrationHash,
    signal: ports.signal,
    nonceContext: ports.planner,
    now: ports.now ?? (() => Math.floor(performance.now())),
    assertCurrent: check,
    prepare: (request, assertCurrent, planner, approved) =>
      ports.rpc.prepareDapp(request, ports.signal, assertCurrent, planner, approved, ports.funding),
    async send(transaction, assertCurrent, verifyDispatch, onBroadcast) {
      const signed = await ports.sign(transaction, assertCurrent);
      assertCurrent();
      return ports.submit(transaction, signed, assertCurrent, verifyDispatch, onBroadcast);
    },
  });
  const contract = review.transaction.to;
  const metadata = contract && decodeApprovalData(review.transaction.data).isApproval
    ? await ports.readApprovalMetadata?.(contract, check) : undefined;
  check();
  return Object.freeze({
    ...review,
    approval: contract ? summarizeApproval(review.transaction.data, contract, metadata) : null,
  });
}
