import {
  isSerializedUtxoObservation,
  type UtxoSummaryStatus,
} from '../../../../../../shared/utxoDetailFreshness';
import type { ISysTransaction } from 'scripts/Background/controllers/transactions/types';

export function getUtxoSummaryObservation(
  tx: ISysTransaction | undefined
): UtxoSummaryStatus | undefined {
  if (!tx) return undefined;
  // The compact facts also identify the same row restored without its live
  // revision, without retaining the original account summary.
  const fields = [
    tx.blockHash,
    tx.blockHeight,
    tx.blockTime,
    tx.confirmations,
    tx.confirmationETABlocks,
    tx.confirmationETASeconds,
  ];
  const facts = JSON.stringify(
    fields.map((value) =>
      typeof value === 'number' ||
      (typeof value === 'string' && value.length <= 128)
        ? value
        : null
    )
  );
  return {
    facts,
    revision: isSerializedUtxoObservation(tx.walletHistoryObservation)
      ? tx.walletHistoryObservation
      : undefined,
  };
}

export {
  getCachedUtxoTransactionDetails,
  mergeAccountOwnershipFlags,
  readUtxoTransactionDetails,
  subscribeUtxoTransactionDetails,
  watchUtxoTransactionDetails,
} from '../../../../../../shared/utxoTransactionDetailCache';
