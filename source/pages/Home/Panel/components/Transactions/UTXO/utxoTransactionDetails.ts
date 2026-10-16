// Details fetches full transactions; list rows only reuse this bounded memory
// cache. Never fetch a full body just to fill a compact history row.
const cache = new Map<string, { data: any; timestamp: number }>();
const cacheListeners = new Map<string, Set<() => void>>();
const pending = new Map<
  string,
  { guards: Set<() => boolean>; promise: Promise<any> }
>();
const queue: Array<() => void> = [];
const TTL = 5 * 60 * 1000;
let active = 0;
const capacityListeners = new Set<() => void>();
let notifyingCapacity = false;
class HistoryReadQueueFullError extends Error {}

export const getCachedUtxoTransactionDetails = (scope: string) => {
  const cached = cache.get(scope);
  return cached && Date.now() - cached.timestamp < TTL
    ? cached.data
    : undefined;
};

export const subscribeUtxoTransactionDetails = (
  scope: string,
  onChange: () => void
) => {
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

export const readUtxoTransactionDetails = (
  scope: string,
  hash: string,
  read: () => Promise<any>,
  isCurrent: () => boolean
): Promise<any> => {
  const cached = getCachedUtxoTransactionDetails(scope);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(scope);
  if (inflight) {
    inflight.guards.add(isCurrent);
    return inflight.promise;
  }
  if (queue.length >= 30)
    return Promise.reject(
      new HistoryReadQueueFullError('History read queue full')
    );

  const guards = new Set([isCurrent]);
  const result = new Promise<any>((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve()
        .then(() => {
          // Only cancel queued work once every Details subscriber has left
          // the scope; concurrent views can share the same pending read.
          if (![...guards].some((guard) => guard()))
            throw new Error('History scope changed');
          return read();
        })
        .then((data) => {
          if (
            typeof data?.txid !== 'string' ||
            data.txid.toLowerCase() !== hash.toLowerCase()
          ) {
            resolve(null);
            return;
          }
          cache.set(scope, { data, timestamp: Date.now() });
          if (cache.size > 100) {
            const oldestScope = cache.keys().next().value;
            cache.delete(oldestScope);
            notifyCacheChange(oldestScope);
          }
          notifyCacheChange(scope);
          resolve(data);
        })
        .catch(reject)
        .finally(() => {
          pending.delete(scope);
          active -= 1;
          queue.shift()?.();
          notifyCapacity();
        });
    };
    if (active < 2) start();
    else queue.push(start);
  });
  pending.set(scope, { guards, promise: result });
  return result;
};

/** Scoped, cancellable UI consumer: saturation waits; real read failures settle. */
export const watchUtxoTransactionDetails = (
  scope: string,
  hash: string,
  read: () => Promise<any>,
  isCurrent: () => boolean,
  onData: (data: any) => void,
  onError: (error: unknown) => void
): (() => void) => {
  let stopped = false;
  const current = () => !stopped && isCurrent();
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
  };
};
