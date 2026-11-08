import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { normalizeDappTransaction } from '../../../../source/shared/dappTransaction.ts';
import { snapshotEvmAccessList, snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { captureEvmFeeApproval, assertEvmFeeApprovalCurrent, assertEvmFeeRefreshApproved } from '../../../../source/shared/evmFeeApproval.ts';
import { guardedRead } from '../custody/evmFeeContracts.ts';
import type { EvmTransferReadRpc, EvmDappTransactionRequest, NativeAutomaticNoncePlanner } from '../custody/evmTransferReadRpc.ts';
import type { NativeTransferDispatchValidation } from '../custody/transfers.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';

/** Private one-use capability. Only the connection controller holds it. */
export type NativePreparedConnectionTransaction = Readonly<{
  transaction: PreparedEvmTransaction;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  expiresAtMonotonicMilliseconds: number;
  submit(assertCurrent: () => void, onBroadcast: (hash: string) => void): Promise<string>;
}>;

type SignedTransaction = Readonly<{ rawTransaction: string; hash: string }>;
type Ports = Readonly<{
  network: NativeNetworkRegistration;
  rpc: EvmTransferReadRpc;
  signal: AbortSignal;
  planner: NativeAutomaticNoncePlanner;
  assertCurrent(): void;
  sign(transaction: PreparedEvmTransaction, assertCurrent: () => void): Promise<SignedTransaction>;
  submit(transaction: PreparedEvmTransaction, signed: SignedTransaction, assertCurrent: () => void,
    verifyDispatch: NativeTransferDispatchValidation, onBroadcast: (hash: string) => void): Promise<string>;
  now?: () => number;
}>;

export async function prepareNativeConnectionTransaction(input: unknown, ports: Ports): Promise<NativePreparedConnectionTransaction> {
  const normalized = normalizeDappTransaction(input);
  const amount = (value: unknown) => BigInt(value as string).toString();
  if (normalized.chainId !== undefined && amount(normalized.chainId) !== ports.network.chainId)
    throw new Error('Transaction chain does not match the selected network');
  const request: EvmDappTransactionRequest = Object.freeze({
    from: normalized.from,
    to: normalized.to ?? null,
    value: normalized.value === undefined ? '0' : amount(normalized.value),
    data: normalized.data,
    ...(normalized.nonce === undefined ? {} : { nonce: Number(BigInt(normalized.nonce)) }),
    ...(normalized.gasLimit === undefined && normalized.gas === undefined ? {} : { gasLimit: amount(normalized.gasLimit ?? normalized.gas) }),
    ...(normalized.type === undefined ? {} : { type: Number(BigInt(normalized.type)) as 0 | 2 }),
    ...(normalized.gasPrice === undefined ? {} : { gasPrice: amount(normalized.gasPrice) }),
    ...(normalized.maxFeePerGas === undefined ? {} : { maxFeePerGas: amount(normalized.maxFeePerGas) }),
    ...(normalized.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: amount(normalized.maxPriorityFeePerGas) }),
    ...(normalized.accessList === undefined ? {} : { accessList: snapshotEvmAccessList(normalized.accessList) }),
  });
  // Validate the generic SDK envelope before any RPC. Placeholder fees and
  // nonce only validate omitted fields; the shared planner/fee read fills them.
  const kind = request.type ?? (request.gasPrice === undefined ? 2 : 0);
  snapshotPreparedEvmTransaction({
    from: request.from, to: request.to, value: request.value, data: request.data,
    chainId: ports.network.chainId, nonce: String(request.nonce ?? 0), gasLimit: request.gasLimit ?? '21000',
    ...(kind === 0 ? { type: 0, gasPrice: request.gasPrice ?? '1' } : {
      type: 2, accessList: request.accessList ?? [],
      maxFeePerGas: request.maxFeePerGas ?? request.maxPriorityFeePerGas ?? '1',
      maxPriorityFeePerGas: request.maxPriorityFeePerGas ?? '0',
    }),
  });
  const now = ports.now ?? (() => Math.floor(performance.now()));
  const check = () => {
    guardedRead(ports.assertCurrent);
    if (ports.signal.aborted) throw new Error('CANCELLED');
  };
  check();
  const quote = await ports.rpc.prepareDapp(request, ports.signal, check, ports.planner);
  check();
  const approved = captureEvmFeeApproval(quote.transaction, ports.network.registrationHash, quote.expiresAtMonotonicMilliseconds);
  let consumed = false;
  return Object.freeze({
    transaction: quote.transaction,
    maximumFeeUnits: quote.maximumFeeUnits,
    maximumTotalUnits: quote.maximumTotalUnits,
    expiresAtMonotonicMilliseconds: quote.expiresAtMonotonicMilliseconds,
    async submit(assertCurrent, onBroadcast) {
      if (consumed || typeof onBroadcast !== 'function') throw new Error('REVIEW_REQUIRED');
      consumed = true;
      const current = () => { check(); guardedRead(assertCurrent); assertEvmFeeApprovalCurrent(approved, now()); };
      const refresh = async (planner: NativeAutomaticNoncePlanner, assertDispatchCurrent: () => void) => {
        const guard = () => { current(); guardedRead(assertDispatchCurrent); };
        guard();
        const latest = await ports.rpc.prepareDapp(request, ports.signal, guard, planner, quote);
        guard();
        assertEvmFeeRefreshApproved(approved, captureEvmFeeApproval(latest.transaction,
          ports.network.registrationHash, latest.expiresAtMonotonicMilliseconds), now());
      };
      await refresh(ports.planner, current);
      current();
      const signed = await ports.sign(quote.transaction, current);
      current();
      return ports.submit(quote.transaction, signed, current, refresh, onBroadcast);
    },
  });
}
