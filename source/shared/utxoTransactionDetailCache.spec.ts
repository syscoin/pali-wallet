import {
  createUtxoTransactionDetailsCache,
  UTXO_DETAIL_CACHE_BYTES,
} from './utxoTransactionDetailCache';

const hash = 'a'.repeat(64);
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const held = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('isolates native lifetimes from each other and the extension cache', async () => {
  const first = createUtxoTransactionDetailsCache();
  const second = createUtxoTransactionDetailsCache();
  const data = { txid: hash, vin: [] };
  await first.readUtxoTransactionDetails(
    'same',
    hash,
    async () => data,
    () => true
  );
  expect(first.getCachedUtxoTransactionDetails('same')).toBe(data);
  expect(second.getCachedUtxoTransactionDetails('same')).toBeUndefined();
  first.dispose();
  second.dispose();
});

it('evicts by aggregate serialized size before the entry count is reached', async () => {
  const cache = createUtxoTransactionDetailsCache();
  const data = { txid: hash, hex: '0'.repeat(3 * 1024 * 1024) };
  const changed = jest.fn();
  cache.subscribeUtxoTransactionDetails('one', changed);
  await cache.readUtxoTransactionDetails(
    'one',
    hash,
    async () => data,
    () => true
  );
  await cache.readUtxoTransactionDetails(
    'two',
    hash,
    async () => data,
    () => true
  );
  await cache.readUtxoTransactionDetails(
    'three',
    hash,
    async () => data,
    () => true
  );
  expect(cache.getCachedUtxoTransactionDetails('one')).toBeUndefined();
  expect(cache.getCachedUtxoTransactionDetails('two')).toBe(data);
  expect(cache.getCachedUtxoTransactionDetails('three')).toBe(data);
  expect(changed).toHaveBeenCalledTimes(2);
  cache.dispose();
});

it('delivers a matching uncacheable body without retaining or truncating it', async () => {
  const cache = createUtxoTransactionDetailsCache();
  const data = { txid: hash, hex: '0'.repeat(UTXO_DETAIL_CACHE_BYTES) };
  const read = jest.fn(async () => data);
  expect(
    await cache.readUtxoTransactionDetails('large', hash, read, () => true)
  ).toBe(data);
  expect(cache.getCachedUtxoTransactionDetails('large')).toBeUndefined();
  await flush();
  expect(
    await cache.readUtxoTransactionDetails('large', hash, read, () => true)
  ).toBe(data);
  expect(read).toHaveBeenCalledTimes(2);
  cache.dispose();
});

it('releases all queued readers on disposal and suppresses late active results', async () => {
  const cache = createUtxoTransactionDetailsCache();
  const blockers = [held(), held()];
  const signals: AbortSignal[] = [];
  const first = blockers.map((blocker, index) =>
    cache
      .readUtxoTransactionDetails(
        String(index),
        hash,
        (signal) => {
          signals.push(signal);
          return blocker.promise;
        },
        () => true
      )
      .catch((error) => error.message)
  );
  const queuedRead = jest.fn(async () => ({ txid: hash }));
  const queued = Array.from({ length: 30 }, (_, index) =>
    cache
      .readUtxoTransactionDetails(
        `queue-${index}`,
        hash,
        queuedRead,
        () => true
      )
      .catch((error) => error.message)
  );
  const changed = jest.fn();
  cache.subscribeUtxoTransactionDetails('0', changed);
  await flush();
  expect(signals).toHaveLength(2);
  cache.dispose();
  cache.dispose();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(await Promise.all([...first, ...queued])).toEqual(
    Array(32).fill('History scope changed')
  );
  blockers.forEach((blocker) => blocker.resolve({ txid: hash }));
  await flush();
  expect(queuedRead).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(cache.getCachedUtxoTransactionDetails('0')).toBeUndefined();
  await expect(
    cache.readUtxoTransactionDetails('new', hash, queuedRead, () => true)
  ).rejects.toThrow('History scope changed');
});

it('aborts a selected read only after its last current subscriber leaves', async () => {
  const cache = createUtxoTransactionDetailsCache();
  const blocker = held();
  let signal!: AbortSignal;
  const read = jest.fn((ownedSignal: AbortSignal) => {
    signal = ownedSignal;
    return blocker.promise;
  });
  const departed = jest.fn(),
    mounted = jest.fn(),
    error = jest.fn();
  const stopFirst = cache.watchUtxoTransactionDetails(
    'same',
    hash,
    read,
    () => true,
    departed,
    error
  );
  const stopSecond = cache.watchUtxoTransactionDetails(
    'same',
    hash,
    read,
    () => true,
    mounted,
    error
  );
  await flush();
  stopFirst();
  expect(signal.aborted).toBe(false);
  blocker.resolve({ txid: hash });
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(departed).not.toHaveBeenCalled();
  expect(mounted).toHaveBeenCalledWith({ txid: hash });
  stopSecond();
  const pending = held();
  const stopLast = cache.watchUtxoTransactionDetails(
    'other',
    hash,
    (ownedSignal) => {
      signal = ownedSignal;
      return pending.promise;
    },
    () => true,
    departed,
    error
  );
  await flush();
  stopLast();
  expect(signal.aborted).toBe(true);
  pending.resolve({ txid: hash });
  await flush();
  expect(cache.getCachedUtxoTransactionDetails('other')).toBeUndefined();
  expect(departed).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  cache.dispose();
});

it.each([false, true])(
  'reopens an aborted active read after it physically drains (transport honors abort: %s)',
  async (honorsAbort) => {
    const cache = createUtxoTransactionDetailsCache();
    const old = held();
    let physical = 0,
      maxPhysical = 0;
    const firstRead = jest.fn((signal: AbortSignal) => {
      physical++;
      maxPhysical = Math.max(maxPhysical, physical);
      if (honorsAbort)
        signal.addEventListener('abort', () => old.resolve(null), {
          once: true,
        });
      return old.promise.finally(() => {
        physical--;
      });
    });
    const data = jest.fn(),
      error = jest.fn(),
      nextData = held();
    const stopFirst = cache.watchUtxoTransactionDetails(
      'reopen',
      hash,
      firstRead,
      () => true,
      data,
      error
    );
    await flush();
    stopFirst();
    const fresh = { txid: hash, value: 'new' };
    const nextRead = jest.fn(async () => {
      physical++;
      maxPhysical = Math.max(maxPhysical, physical);
      physical--;
      return fresh;
    });
    const stopNext = cache.watchUtxoTransactionDetails(
      'reopen',
      hash,
      nextRead,
      () => true,
      (value) => {
        data(value);
        nextData.resolve(value);
      },
      error
    );
    await flush();
    if (!honorsAbort) expect(nextRead).not.toHaveBeenCalled();
    old.resolve({ txid: hash, value: 'stale' });
    await expect(nextData.promise).resolves.toBe(fresh);
    expect(nextRead).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledWith(fresh);
    expect(cache.getCachedUtxoTransactionDetails('reopen')).toBe(fresh);
    expect(error).not.toHaveBeenCalled();
    expect(maxPhysical).toBe(1);
    stopNext();
    cache.dispose();
  }
);

it('lets a reopened consumer supply the live reader to an already queued job', async () => {
  const cache = createUtxoTransactionDetailsCache();
  const blocks = [held(), held()];
  const active = blocks.map((block, i) =>
    cache.readUtxoTransactionDetails(
      `active-${i}`,
      hash,
      () => block.promise,
      () => true
    )
  );
  const read = jest.fn(async (signal: AbortSignal) => {
    expect(signal.aborted).toBe(false);
    return { txid: hash };
  });
  const retiredRead = jest.fn(async () => ({ txid: hash }));
  const left = jest.fn(),
    next = jest.fn(),
    error = jest.fn();
  const stopFirst = cache.watchUtxoTransactionDetails(
    'queued',
    hash,
    retiredRead,
    () => true,
    left,
    error
  );
  await flush();
  stopFirst();
  const stopNext = cache.watchUtxoTransactionDetails(
    'queued',
    hash,
    read,
    () => true,
    next,
    error
  );
  expect(read).not.toHaveBeenCalled();
  blocks.forEach((block) => block.resolve({ txid: hash }));
  await Promise.all(active);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(retiredRead).not.toHaveBeenCalled();
  expect(left).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith({ txid: hash });
  expect(error).not.toHaveBeenCalled();
  stopNext();
  cache.dispose();
});

it('does not refill a cache disposed by an eviction observer', async () => {
  const cache = createUtxoTransactionDetailsCache();
  const data = { txid: hash, hex: '0'.repeat(3 * 1024 * 1024) };
  await cache.readUtxoTransactionDetails(
    'one',
    hash,
    async () => data,
    () => true
  );
  await cache.readUtxoTransactionDetails(
    'two',
    hash,
    async () => data,
    () => true
  );
  cache.subscribeUtxoTransactionDetails('one', () => cache.dispose());
  await expect(
    cache.readUtxoTransactionDetails(
      'three',
      hash,
      async () => data,
      () => true
    )
  ).rejects.toThrow('History scope changed');
  expect(cache.getCachedUtxoTransactionDetails('three')).toBeUndefined();
});

it('purges expired retention without notifying render-time snapshot readers', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const cache = createUtxoTransactionDetailsCache();
  try {
    await cache.readUtxoTransactionDetails(
      'expired',
      hash,
      async () => ({ txid: hash }),
      () => true
    );
    const changed = jest.fn();
    cache.subscribeUtxoTransactionDetails('expired', changed);
    now.mockReturnValue(1000 + 5 * 60 * 1000);
    expect(cache.getCachedUtxoTransactionDetails('expired')).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
    cache.dispose();
  }
});
