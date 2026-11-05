export const UTXO_SUMMARY_OBSERVATION = 'walletHistoryObservation';
export const UTXO_DETAIL_OBSERVATION = 'walletDetailObservation';

// Only a small token is retained with the full body, never the account summary.
export type UtxoSummaryObservation = number | string;
export type UtxoSummaryStatus = Readonly<{ facts: string; revision?: string }>;
type DetailObservation = Readonly<{
  dispatch?: UtxoSummaryObservation;
  routeSummary?: UtxoSummaryStatus;
  summary?: UtxoSummaryStatus;
}>;
const detailObservations = new WeakMap<object, DetailObservation>();
const serializedObservation = /^([0-9a-f]{32}):([1-9]\d{0,15})$/;

export function isSerializedUtxoObservation(value: unknown): value is string {
  return typeof value === 'string' && serializedObservation.test(value);
}

function isAtOrBefore(
  summary: UtxoSummaryObservation,
  boundary: UtxoSummaryObservation | undefined
): boolean | undefined {
  if (typeof summary === 'number' && typeof boundary === 'number')
    return summary <= boundary;
  if (typeof summary !== 'string' || typeof boundary !== 'string') return;
  const left = serializedObservation.exec(summary);
  const right = serializedObservation.exec(boundary);
  if (!left || !right || left[1] !== right[1]) return undefined;
  const from = left[2]!,
    to = right[2]!;
  return from.length === to.length ? from <= to : from.length < to.length;
}

export function bindUtxoDetailObservation<T>(
  body: T,
  observation: DetailObservation
): T {
  if (body && typeof body === 'object')
    detailObservations.set(body, observation);
  return body;
}

export function detailFollowsUtxoSummary(
  body: object,
  summary: UtxoSummaryObservation
): boolean {
  const detail = detailObservations.get(body);
  if (!detail) return false;
  // Reopened routes can supply an older summary. Across worker epochs only
  // compare source revisions from the same epoch, or observations seen at read.
  // Durable rows lose their revision on restart but can match the saved facts.
  return (
    isAtOrBefore(summary, detail.dispatch) ??
    isAtOrBefore(summary, detail.summary?.revision) ??
    (summary === detail.summary?.revision ||
      summary === detail.routeSummary?.revision ||
      summary === detail.summary?.facts ||
      summary === detail.routeSummary?.facts)
  );
}
