// Shared, memory-only full-transaction reads for compact token rows and Details.
// Native list rows never request hydration. Bound both concurrency and backlog.
const cache = new Map<string, { data: any; timestamp: number }>();
const pending = new Map<
  string,
  { guards: Set<() => boolean>; promise: Promise<any> }
>();
const queue: Array<() => void> = [];
const TTL = 5 * 60 * 1000;
let active = 0;

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
  const cached = cache.get(scope);
  if (cached && Date.now() - cached.timestamp < TTL)
    return Promise.resolve(cached.data);
  const inflight = pending.get(scope);
  if (inflight) {
    inflight.guards.add(isCurrent);
    return inflight.promise;
  }
  if (queue.length >= 30)
    return Promise.reject(new Error('History read queue full'));

  const guards = new Set([isCurrent]);
  const result = new Promise<any>((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve()
        .then(() => {
          // A list row may unmount while Details joins this same read. Only
          // cancel queued work once every subscriber has left the scope.
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
          if (cache.size > 100) cache.delete(cache.keys().next().value);
          resolve(data);
        })
        .catch(reject)
        .finally(() => {
          pending.delete(scope);
          active -= 1;
          queue.shift()?.();
        });
    };
    if (active < 2) start();
    else queue.push(start);
  });
  pending.set(scope, { guards, promise: result });
  return result;
};
