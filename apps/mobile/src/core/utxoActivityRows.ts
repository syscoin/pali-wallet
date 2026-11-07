import {
  createUtxoTransactionDetailsCache,
  UTXO_DETAIL_CACHE_BYTES,
} from '../../../../source/shared/utxoTransactionDetailCache.ts';
import { abortable } from '../../../../source/shared/boundedHttp.ts';
import {
  sameUtxoActivityContext,
  UTXO_ACTIVITY_LIMITS,
  type UtxoActivityContext,
  type UtxoActivityDetail,
  type UtxoActivityPage,
  type UtxoActivityReader,
  type UtxoActivityRow,
  type UtxoActivitySource,
} from './utxoActivity.ts';

export type WithUtxoActivityRead = <T>(
  signal: AbortSignal,
  assertCurrent: () => void,
  read: (source: UtxoActivitySource, owned: AbortSignal, check: () => void) => Promise<T>
) => Promise<T>;

function createWindow() {
  return {
    cache: createUtxoTransactionDetailsCache(),
    rows: new Map<UtxoActivityRow, number>(),
    detailReads: new Map<UtxoActivityRow, Set<AbortController>>(),
    pageReads: new Set<AbortController>(),
    bytes: 0,
  };
}
type ActivityWindow = ReturnType<typeof createWindow>;
const unavailable = () => new Error('Account activity unavailable');
const cancelled = () => new Error('Account activity cancelled');

function followAbort(external: AbortSignal, controller: AbortController): () => void {
  const abort = () => controller.abort();
  external.addEventListener('abort', abort, { once: true });
  if (external.aborted) abort();
  return () => {
    external.removeEventListener('abort', abort);
    controller.abort();
  };
}

/** Shared in-memory admission for rows and their bounded detail capabilities. */
export class UtxoActivityRows {
  private window = createWindow();
  private readonly reader: UtxoActivityReader;
  private readonly getContext: () => UtxoActivityContext | null;
  private readonly withRead: WithUtxoActivityRead;
  constructor(
    reader: UtxoActivityReader,
    getContext: () => UtxoActivityContext | null,
    withRead: WithUtxoActivityRead,
  ) {
    this.getContext = getContext;
    this.withRead = withRead;
    this.reader = Object.freeze({
      readPage: reader.readPage.bind(reader), readDetail: reader.readDetail.bind(reader),
      forgetDetails: reader.forgetDetails.bind(reader), summaryBytes: reader.summaryBytes.bind(reader),
    });
  }

  private assertWindow(window: ActivityWindow, expected: UtxoActivityContext): void {
    const actual = this.getContext();
    if (this.window !== window || !sameUtxoActivityContext(actual, expected)) throw cancelled();
  }

  private forget(window: ActivityWindow, row: UtxoActivityRow): void {
    const charge = window.rows.get(row);
    if (charge === undefined) return;
    window.rows.delete(row);
    window.bytes -= charge;
    this.reader.forgetDetails([row]);
    const requests = window.detailReads.get(row);
    window.detailReads.delete(row);
    for (const request of requests ?? []) request.abort();
  }

  releaseUtxoActivity = (): void => {
    const previous = this.window;
    this.window = createWindow();
    for (const request of previous.pageReads) request.abort();
    previous.pageReads.clear();
    for (const row of previous.rows.keys()) this.forget(previous, row);
    previous.cache.dispose();
  };

  private trackDetail(window: ActivityWindow, row: UtxoActivityRow, external: AbortSignal) {
    const request = new AbortController(), stop = followAbort(external, request);
    const reads = window.detailReads.get(row) ?? new Set<AbortController>();
    reads.add(request);
    window.detailReads.set(row, reads);
    return { signal: request.signal, close() {
      reads.delete(request);
      if (!reads.size && window.detailReads.get(row) === reads) window.detailReads.delete(row);
      stop();
    } };
  }

  /** Drop-only admission follows the exact rows selected by the shared model. */
  retainUtxoActivityRows = (rows: readonly UtxoActivityRow[]): void => {
    if (rows.length > UTXO_ACTIVITY_LIMITS.displayRows) throw unavailable();
    const window = this.window, keep = new Set(rows);
    for (const row of window.rows.keys()) if (!keep.has(row)) this.forget(window, row);
  };

  readUtxoActivityPage = async (input: Readonly<{ page: number }>, external: AbortSignal): Promise<UtxoActivityPage> => {
    const page = input.page, window = this.window, owner = this.getContext();
    if (!owner || !Number.isSafeInteger(page) || page < 1) throw unavailable();
    const request = new AbortController(), stop = followAbort(external, request);
    window.pageReads.add(request);
    const current = () => {
      if (request.signal.aborted) throw cancelled();
      this.assertWindow(window, owner);
    };
    let result: UtxoActivityPage | undefined;
    const admitted: UtxoActivityRow[] = [];
    try {
      current();
      // Leave room for one incoming page without dropping the displayed list.
      while (window.rows.size > UTXO_ACTIVITY_LIMITS.displayRows) {
        this.forget(window, window.rows.keys().next().value!);
        current();
      }
      result = await abortable(this.withRead(request.signal, current, async (source, signal, check) => {
        current();
        if (!sameUtxoActivityContext(source.context, owner)) throw cancelled();
        const value = await this.reader.readPage({ ...source, assertCurrent: check }, { page }, signal);
        check();
        if (!sameUtxoActivityContext(value.context, owner) || value.page !== page) throw cancelled();
        return value;
      }), request.signal);
      current();
      for (const row of result.rows) {
        if (window.rows.has(row)) continue;
        const charge = this.reader.summaryBytes(row);
        current();
        if (charge === null || charge > UTXO_DETAIL_CACHE_BYTES) {
          this.reader.forgetDetails([row]);
          continue;
        }
        while (window.rows.size && (window.rows.size >= UTXO_ACTIVITY_LIMITS.displayRows + UTXO_ACTIVITY_LIMITS.pageSize ||
            window.bytes + charge > UTXO_DETAIL_CACHE_BYTES)) {
          this.forget(window, window.rows.keys().next().value!);
          current();
        }
        // Duplicate IDs can carry different facts; the paging model chooses
        // which exact row retains its read capability.
        window.rows.set(row, charge);
        window.bytes += charge;
        admitted.push(row);
      }
      current();
      return result;
    } catch (error) {
      for (const row of admitted) this.forget(window, row);
      if (result) this.reader.forgetDetails(result.rows);
      throw error;
    } finally {
      window.pageReads.delete(request);
      stop();
    }
  };

  readUtxoActivityDetail = async (input: Readonly<{ txid: string }>, external: AbortSignal): Promise<UtxoActivityDetail> => {
    const { txid } = input, window = this.window, owner = this.getContext();
    if (!owner || typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) throw unavailable();
    const key = txid.toLowerCase(), row = [...window.rows.keys()].find((item) => item.txid === key);
    if (!row) throw unavailable();
    const request = this.trackDetail(window, row, external);
    const assertDetailCurrent = () => {
      this.assertWindow(window, owner);
      if (!window.rows.has(row)) throw cancelled();
    };
    const current = () => {
      if (request.signal.aborted) throw cancelled();
      assertDetailCurrent();
    };
    try {
      current();
      const result = await abortable(this.withRead(request.signal, current, async (source, signal, check) => {
        const guard = () => { current(); check(); };
        guard();
        if (!sameUtxoActivityContext(source.context, owner)) throw cancelled();
        const value = await this.reader.readDetail(source, { row, txid: key }, signal, window.cache, guard);
        guard();
        return value;
      }), request.signal);
      current();
      const readNode = result.readSentryNode;
      return readNode ? Object.freeze({ ...result,
        readSentryNode: async (signal: AbortSignal, guard: () => void) => {
          assertDetailCurrent();
          const lookup = this.trackDetail(window, row, signal);
          const checkView = () => {
            if (lookup.signal.aborted) throw cancelled();
            assertDetailCurrent();
            return guard();
          };
          try {
            const observation = await abortable(this.withRead(lookup.signal, checkView, (source, owned, check) => {
              if (!sameUtxoActivityContext(source.context, owner)) throw cancelled();
              return readNode(owned, check);
            }), lookup.signal);
            checkView();
            return observation;
          } finally { lookup.close(); }
        },
      }) : result;
    } finally { request.close(); }
  };
}
