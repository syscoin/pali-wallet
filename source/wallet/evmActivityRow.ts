import { EVM_TRANSACTION_HISTORY_SOURCE } from '../shared/evmHistory';
import type { ITransactionInfoEvm } from 'types/useTransactionsInfo';

import type { EvmSavedTransaction } from './evmSignedReplay';
import type { SmartAccountAuthorizationSummary } from './smartAccountAuthorization';
import type { SmartAccountReplayIntent } from './smartAccountSignedReplay';

export type EvmActivitySummary = EvmSavedTransaction & {
  smartAccount?: SmartAccountReplayIntent;
};

export type SmartAccountSignedActivity = Pick<
  SmartAccountAuthorizationSummary,
  | 'account'
  | 'chainId'
  | 'createdAt'
  | 'operationHash'
  | 'replacesOperationHash'
> & { status: 'unresolved' | 'unavailable' };

/** Project the shared public summary without inventing unsigned calldata or receipt fields. */
export const projectEvmActivityRow = (
  tx: EvmActivitySummary
): ITransactionInfoEvm => {
  const smart = tx.smartAccount;
  const batch = (smart?.executions?.length ?? 0) > 1;
  const single =
    smart?.executions?.length === 1 ? smart.executions[0] : undefined;
  return {
    hash: tx.hash,
    historySource: EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned,
    chainId: Number(tx.chainId),
    from: smart?.account ?? tx.from,
    to: single?.target ?? tx.to,
    value:
      single?.value ??
      (batch
        ? smart!
            .executions!.reduce(
              (total, call) => total + BigInt(call.value),
              BigInt(0)
            )
            .toString()
        : tx.value),
    ...(smart
      ? {
          smartAccountExecutionFrom: smart.account,
          smartAccount: smart,
          feePayer: tx.from,
          input: batch ? undefined : single?.data ?? smart.callData,
        }
      : {}),
    nonce: String(tx.nonce),
    type: tx.type,
    timestamp: Math.floor(tx.createdAt / 1000),
    gas: tx.gasLimit,
    gasPrice: tx.feePerGas,
    dataBytes: tx.dataBytes,
    ...(tx.selector ? { methodSelector: tx.selector } : {}),
    ...(tx.speedUpAvailable && !smart ? { speedUpAvailable: true } : {}),
    isCancel: tx.operation === 'cancel' || smart?.cancellation === true,
    isSpeedUp: tx.operation === 'speed-up',
    ...(tx.originalHash ? { replacesHash: tx.originalHash } : {}),
    ...(tx.collectibleTransfer
      ? { collectibleTransfer: tx.collectibleTransfer }
      : {}),
    ...(tx.tokenTransfer
      ? {
          tokenRecipient: tx.tokenTransfer.recipient,
          tokenTransfer: {
            chainId: Number(tx.chainId),
            contractAddress: tx.to,
            recipient: tx.tokenTransfer.recipient,
            value: tx.tokenTransfer.amountUnits,
            ...(tx.tokenTransfer.token
              ? {
                  decimals: tx.tokenTransfer.token.decimals,
                  symbol: tx.tokenTransfer.token.symbol,
                }
              : {}),
          },
        }
      : {}),
  } as unknown as ITransactionInfoEvm;
};
