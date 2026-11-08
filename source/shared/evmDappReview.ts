import {
  snapshotEvmAccessList,
  snapshotPreparedEvmTransaction,
  type PreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

import {
  snapshotEoaCallsSignedAttempt,
  type EoaCallsSignedAttempt,
} from '../wallet/dappCallsBundles.ts';

import { normalizeDappTransaction } from './dappTransaction.ts';
import type { EvmDappFeeComparison } from './evmDappFeePolicy.ts';
import type {
  EvmDappPreparedQuote,
  EvmDappTransactionRequest,
} from './evmDappPreparation.ts';
import {
  assertEvmFeeApprovalCurrent,
  assertEvmFeeRefreshApproved,
  assertSynchronousEvmFeeGuard,
  captureEvmFeeApproval,
} from './evmFeeApproval.ts';

export type EvmDappDispatchValidation<NonceContext> = (
  nonceContext: NonceContext,
  assertCurrent: () => void
) => Promise<void>;
export type EvmDappSubmission = Readonly<
  | { kind: 'transaction' }
  | { attempt: EoaCallsSignedAttempt; kind: 'eoa-calls' }
>;

export type EvmDappReview<Result = string> = Readonly<{
  coveredFeeUnits: string;
  expiresAtMonotonicMilliseconds: number;
  feeComparison: EvmDappFeeComparison;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  submit(
    assertCurrent: () => void,
    onBroadcast: (hash: string) => void,
    submission: EvmDappSubmission
  ): Promise<Result>;
  transaction: PreparedEvmTransaction;
}>;

export type EvmDappReviewPorts<NonceContext, Result> = Readonly<{
  assertCurrent(): void;
  chainId: string;
  nonceContext: NonceContext;
  now(): number;
  prepare(
    request: EvmDappTransactionRequest,
    assertCurrent: () => void,
    nonceContext: NonceContext,
    approved: EvmDappPreparedQuote | undefined
  ): Promise<EvmDappPreparedQuote>;
  scope: string;
  send(
    transaction: PreparedEvmTransaction,
    assertCurrent: () => void,
    verifyDispatch: EvmDappDispatchValidation<NonceContext>,
    onBroadcast: (hash: string) => void,
    submission: EvmDappSubmission
  ): Promise<Result>;
  signal: AbortSignal;
}>;

/** Private one-use approval, held by the host controller until explicit user confirmation. */
export async function prepareEvmDappReview<NonceContext, Result>(
  input: unknown,
  ports: EvmDappReviewPorts<NonceContext, Result>
): Promise<EvmDappReview<Result>> {
  ports = Object.freeze({
    ...ports,
    assertCurrent: ports.assertCurrent.bind(ports),
    now: ports.now.bind(ports),
    prepare: ports.prepare.bind(ports),
    send: ports.send.bind(ports),
  });
  const normalized = normalizeDappTransaction(input);
  const amount = (value: unknown) => BigInt(value as string).toString();
  if (
    normalized.chainId !== undefined &&
    amount(normalized.chainId) !== ports.chainId
  )
    throw new Error('Transaction chain does not match the selected network');
  const request: EvmDappTransactionRequest = Object.freeze({
    from: normalized.from,
    to: normalized.to ?? null,
    value: normalized.value === undefined ? '0' : amount(normalized.value),
    data: normalized.data,
    ...(normalized.nonce === undefined
      ? {}
      : { nonce: Number(BigInt(normalized.nonce)) }),
    ...(normalized.gasLimit === undefined && normalized.gas === undefined
      ? {}
      : { gasLimit: amount(normalized.gasLimit ?? normalized.gas) }),
    ...(normalized.type === undefined
      ? {}
      : { type: Number(BigInt(normalized.type)) as 0 | 2 }),
    ...(normalized.gasPrice === undefined
      ? {}
      : { gasPrice: amount(normalized.gasPrice) }),
    ...(normalized.maxFeePerGas === undefined
      ? {}
      : { maxFeePerGas: amount(normalized.maxFeePerGas) }),
    ...(normalized.maxPriorityFeePerGas === undefined
      ? {}
      : { maxPriorityFeePerGas: amount(normalized.maxPriorityFeePerGas) }),
    ...(normalized.accessList === undefined
      ? {}
      : { accessList: snapshotEvmAccessList(normalized.accessList) }),
  });
  // Validate the generic SDK envelope before any RPC. Placeholder fees and
  // nonce only validate omitted fields; the shared planner/fee read fills them.
  const kind = request.type ?? (request.gasPrice === undefined ? 2 : 0);
  snapshotPreparedEvmTransaction({
    from: request.from,
    to: request.to,
    value: request.value,
    data: request.data,
    chainId: ports.chainId,
    nonce: String(request.nonce ?? 0),
    gasLimit: request.gasLimit ?? '21000',
    ...(kind === 0
      ? { type: 0, gasPrice: request.gasPrice ?? '1' }
      : {
          type: 2,
          accessList: request.accessList ?? [],
          maxFeePerGas:
            request.maxFeePerGas ?? request.maxPriorityFeePerGas ?? '1',
          maxPriorityFeePerGas: request.maxPriorityFeePerGas ?? '0',
        }),
  });
  const now = ports.now;
  const check = () => {
    assertSynchronousEvmFeeGuard(ports.assertCurrent);
    if (ports.signal.aborted) throw new Error('CANCELLED');
  };
  check();
  const quote = await ports.prepare(
    request,
    check,
    ports.nonceContext,
    undefined
  );
  check();
  const approved = captureEvmFeeApproval(
    quote.transaction,
    ports.scope,
    quote.expiresAtMonotonicMilliseconds
  );
  let consumed = false;
  return Object.freeze({
    feeComparison: quote.feeComparison,
    transaction: quote.transaction,
    maximumFeeUnits: quote.maximumFeeUnits,
    coveredFeeUnits: quote.coveredFeeUnits,
    maximumTotalUnits: quote.maximumTotalUnits,
    expiresAtMonotonicMilliseconds: quote.expiresAtMonotonicMilliseconds,
    async submit(assertCurrent, onBroadcast, context) {
      if (
        consumed ||
        typeof onBroadcast !== 'function' ||
        !context ||
        (context.kind !== 'transaction' && context.kind !== 'eoa-calls')
      )
        throw new Error('REVIEW_REQUIRED');
      consumed = true;
      const submission: EvmDappSubmission =
        context.kind === 'transaction'
          ? Object.freeze({ kind: 'transaction' })
          : Object.freeze({
              kind: 'eoa-calls',
              attempt: snapshotEoaCallsSignedAttempt(context.attempt),
            });
      const current = () => {
        assertSynchronousEvmFeeGuard(assertCurrent);
        check();
        assertEvmFeeApprovalCurrent(approved, now());
      };
      const refresh = async (
        nonceContext: NonceContext,
        assertDispatchCurrent: () => void
      ) => {
        const guard = () => {
          assertSynchronousEvmFeeGuard(assertDispatchCurrent);
          current();
        };
        guard();
        const latest = await ports.prepare(request, guard, nonceContext, quote);
        guard();
        assertEvmFeeRefreshApproved(
          approved,
          captureEvmFeeApproval(
            latest.transaction,
            ports.scope,
            latest.expiresAtMonotonicMilliseconds
          ),
          now()
        );
      };
      await refresh(ports.nonceContext, current);
      current();
      return ports.send(
        quote.transaction,
        current,
        refresh,
        onBroadcast,
        submission
      );
    },
  });
}
