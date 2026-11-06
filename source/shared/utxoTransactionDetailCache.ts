import { measureJsonWorkBudget } from '../utils/requestPayloadBudget.ts';

// Shared retention budget, independent of provider response limits.
export const UTXO_DETAIL_CACHE_BYTES = 8 * 1024 * 1024;
class HistoryReadQueueFullError extends Error {}

// Account history and the raw transaction have the same input/output ordering.
// Preserve account attribution when a raw read supplies missing asset metadata;
// never infer ownership from funding or from the first asset output.
export const mergeAccountOwnershipFlags = (
  accountEntries: any[] | undefined,
  fullEntries: any[] | undefined
) => {
  if (!Array.isArray(accountEntries) || !Array.isArray(fullEntries))
    return fullEntries;
  return fullEntries.map((entry, index) => {
    const accountEntry = accountEntries[index];
    return entry?.isOwn !== undefined || accountEntry?.isOwn === undefined
      ? entry
      : { ...entry, isOwn: accountEntry.isOwn };
  });
};

/** One queue/cache implementation; each native authority owns its lifetime. */
export const createUtxoTransactionDetailsCache = (
  shouldRetain: (data: any) => boolean = () => true
) => {
  // Details fetches full transactions; list rows only reuse this bounded memory
  // cache. Never fetch a full body just to fill a compact history row.
  const cache = new Map<
    string,
    { bytes: number; data: any; timestamp: number }
  >();
  let retainedBytes = 0;
  let disposed = false;
  const cacheListeners = new Map<string, Set<() => void>>();
  const pending = new Map<
    string,
    {
      abort: AbortController;
      drain: () => void;
      drained: Promise<void>;
      promise: Promise<any>;
      readers: Map<() => boolean, (signal: AbortSignal) => Promise<any>>;
      reject: (error: Error) => void;
      started: () => boolean;
    }
  >();
  const queue: Array<() => void> = [];
  const TTL = 5 * 60 * 1000;
  let active = 0;
  const capacityListeners = new Set<() => void>();
  let notifyingCapacity = false;

  const getCachedUtxoTransactionDetails = (scope: string) => {
    if (disposed) return undefined;
    purgeExpired(false);
    const cached = cache.get(scope);
    return cached && Date.now() - cached.timestamp < TTL
      ? cached.data
      : undefined;
  };

  const subscribeUtxoTransactionDetails = (
    scope: string,
    onChange: () => void
  ) => {
    if (disposed) return () => undefined;
    purgeExpired(false);
    let listeners = cacheListeners.get(scope);
    if (!listeners) {
      listeners = new Set();
      cacheListeners.set(scope, listeners);
    }
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
      if (!listeners.size) cacheListeners.delete(scope);
    };
  };

  const notifyCacheChange = (scope: string) => {
    cacheListeners.get(scope)?.forEach((listener) => listener());
  };

  // Listeners belong to mounted consumers, not queued RPC jobs. Notify one-shot
  // listeners only while synchronous admission can consume a real free slot.
  const notifyCapacity = () => {
    if (notifyingCapacity) return;
    notifyingCapacity = true;
    try {
      for (const listener of capacityListeners) {
        if (queue.length >= 30) break;
        capacityListeners.delete(listener);
        listener();
      }
    } finally {
      notifyingCapacity = false;
    }
  };

  const readUtxoTransactionDetails = (
    scope: string,
    hash: string,
    read: (signal: AbortSignal) => Promise<any>,
    isCurrent: () => boolean
  ): Promise<any> => {
    if (disposed) return Promise.reject(new Error('History scope changed'));
    const cached = getCachedUtxoTransactionDetails(scope);
    if (cached) return Promise.resolve(cached);
    const inflight = pending.get(scope);
    if (inflight) {
      // A stopped physical read still owns its active slot until it drains.
      // Reopening waits for that slot rather than adopting its aborted result.
      if (inflight.abort.signal.aborted)
        return inflight.drained.then(() =>
          readUtxoTransactionDetails(scope, hash, read, isCurrent)
        );
      inflight.readers.set(isCurrent, read);
      return inflight.promise;
    }
    if (queue.length >= 30)
      return Promise.reject(
        new HistoryReadQueueFullError('History read queue full')
      );

    const readers = new Map([[isCurrent, read]]);
    const assertLive = () => {
      const current = [...readers]
        .reverse()
        .find(([guard]) => guard() && readers.has(guard));
      if (disposed || abort.signal.aborted || !current)
        throw new Error('History scope changed');
      return current[1];
    };
    const abort = new AbortController();
    let rejectPending!: (error: Error) => void;
    let started = false;
    let markDrained!: () => void;
    const drained = new Promise<void>((resolve) => {
      markDrained = resolve;
    });
    const result = new Promise<any>((resolve, reject) => {
      rejectPending = reject;
      const start = () => {
        started = true;
        active += 1;
        Promise.resolve()
          // A queued selection may reopen before dispatch. Its latest live
          // reader owns the physical request and its observation baseline.
          .then(() => assertLive()(abort.signal))
          .then((data) => {
            assertLive();
            if (
              typeof data?.txid !== 'string' ||
              data.txid.toLowerCase() !== hash.toLowerCase()
            ) {
              resolve(null);
              return;
            }
            // Network JSON is charged by the same iterative wallet work walker.
            // This bounds retained serialized data, not JavaScript heap usage.
            // Uncacheable full bodies still reach the selected Details consumer.
            let bytes: number | undefined;
            try {
              if (shouldRetain(data))
                bytes = measureJsonWorkBudget(
                  data,
                  UTXO_DETAIL_CACHE_BYTES,
                  32,
                  200_000
                );
            } catch {
              /* Display without retention. */
            }
            if (bytes !== undefined) {
              purgeExpired();
              removeCached(scope);
              while (
                cache.size &&
                (cache.size >= 100 ||
                  retainedBytes + bytes > UTXO_DETAIL_CACHE_BYTES)
              )
                removeCached(cache.keys().next().value!);
              assertLive();
              cache.set(scope, { data, timestamp: Date.now(), bytes });
              retainedBytes += bytes;
              notifyCacheChange(scope);
            }
            assertLive();
            resolve(data);
          })
          .catch(reject)
          .finally(() => {
            if (pending.get(scope)?.promise === result) pending.delete(scope);
            active -= 1;
            queue.shift()?.();
            notifyCapacity();
            markDrained();
          });
      };
      if (active < 2) start();
      else queue.push(start);
    });
    pending.set(scope, {
      readers,
      promise: result,
      abort,
      reject: rejectPending,
      drained,
      started: () => started,
      drain: markDrained,
    });
    return result;
  };

  /** Scoped, cancellable UI consumer: saturation waits; real read failures settle. */
  const watchUtxoTransactionDetails = (
    scope: string,
    hash: string,
    read: (signal: AbortSignal) => Promise<any>,
    isCurrent: () => boolean,
    onData: (data: any) => void,
    onError: (error: unknown) => void
  ): (() => void) => {
    let stopped = false;
    const current = () => !disposed && !stopped && isCurrent();
    const attempt = () => {
      capacityListeners.delete(attempt);
      if (!current()) return;
      readUtxoTransactionDetails(scope, hash, read, current).then(
        (data) => {
          if (current()) onData(data);
        },
        (error) => {
          if (!current()) return;
          if (error instanceof HistoryReadQueueFullError) {
            capacityListeners.add(attempt);
            // A slot may have opened between rejection and this subscription.
            // Otherwise only a job's completion can wake this consumer.
            notifyCapacity();
          } else onError(error);
        }
      );
    };
    attempt();
    return () => {
      stopped = true;
      capacityListeners.delete(attempt);
      const job = pending.get(scope);
      job?.readers.delete(current);
      if (job?.started() && ![...job.readers.keys()].some((guard) => guard()))
        job.abort.abort();
    };
  };

  const removeCached = (scope: string, notify = true) => {
    const previous = cache.get(scope);
    if (!previous) return;
    cache.delete(scope);
    retainedBytes -= previous.bytes;
    if (notify) notifyCacheChange(scope);
  };
  const purgeExpired = (notify = true) => {
    const now = Date.now();
    for (const [scope, value] of cache)
      if (now - value.timestamp >= TTL) removeCached(scope, notify);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cache.clear();
    retainedBytes = 0;
    cacheListeners.clear();
    capacityListeners.clear();
    queue.length = 0;
    for (const job of pending.values()) {
      job.abort.abort();
      job.reject(new Error('History scope changed'));
      job.drain();
    }
    pending.clear();
  };
  return Object.freeze({
    getCachedUtxoTransactionDetails,
    readUtxoTransactionDetails,
    subscribeUtxoTransactionDetails,
    watchUtxoTransactionDetails,
    dispose,
  });
};
