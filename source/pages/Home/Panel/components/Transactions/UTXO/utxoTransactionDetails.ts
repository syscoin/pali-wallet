import {
  isSerializedUtxoObservation,
  type UtxoSummaryStatus,
} from '../../../../../../shared/utxoDetailFreshness';
import { createUtxoTransactionDetailsCache } from '../../../../../../shared/utxoTransactionDetailCache';
import type { ISysTransaction } from 'scripts/Background/controllers/transactions/types';

export { mergeAccountOwnershipFlags } from '../../../../../../shared/utxoTransactionDetailCache';

import type { UtxoActivityParticipants } from '../../../../../../shared/utxoActivityParticipants';

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

export type UtxoActivityDetailRead = Readonly<{
  compact: { data: UtxoActivityParticipants; key: string } | null;
  transaction: ISysTransaction | null;
  txid: string;
}>;

// A vetted compact row is useful to live readers even if no full body is
// available. It must not displace the next normal detail lookup.
const details = createUtxoTransactionDetailsCache(
  (result: UtxoActivityDetailRead) => result.transaction !== null
);

export const getCachedUtxoTransactionDetails = (scope: string) =>
  (
    details.getCachedUtxoTransactionDetails(scope) as
      | UtxoActivityDetailRead
      | undefined
  )?.transaction ?? undefined;

export const {
  readUtxoTransactionDetails,
  subscribeUtxoTransactionDetails,
  watchUtxoTransactionDetails,
} = details;
