import {
  getCachedUtxoTransactionDetails,
  readUtxoTransactionDetails,
  subscribeUtxoTransactionDetails,
  watchUtxoTransactionDetails,
} from './utxoTransactionDetails';

const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
};
let sequence = 0;
const scope = () => `read-${++sequence}`;
const hash = 'a'.repeat(64);

it('reads the cache synchronously without starting any transaction request', () => {
  expect(getCachedUtxoTransactionDetails(scope())).toBeUndefined();
});

it('notifies only matching cache subscribers after a successful Details read and reuses the snapshot', async () => {
  const key = scope();
  const changed = jest.fn();
  const otherChanged = jest.fn();
  const stop = subscribeUtxoTransactionDetails(key, changed);
  const stopOther = subscribeUtxoTransactionDetails(scope(), otherChanged);
  const transaction = { txid: hash, vin: [], vout: [] };
  const read = jest.fn().mockResolvedValue(transaction);
  try {
    expect(changed).not.toHaveBeenCalled();
    expect(getCachedUtxoTransactionDetails(key)).toBeUndefined();
    await readUtxoTransactionDetails(key, hash, read, () => true);
    expect(getCachedUtxoTransactionDetails(key)).toBe(transaction);
    expect(getCachedUtxoTransactionDetails(key)).toBe(transaction);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(otherChanged).not.toHaveBeenCalled();
    await readUtxoTransactionDetails(key, hash, read, () => true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    stopOther();
  }
});

it('removes an unsubscribed listener without removing another mounted subscriber', async () => {
  const key = scope();
  const departed = jest.fn();
  const mounted = jest.fn();
  const stopDeparted = subscribeUtxoTransactionDetails(key, departed);
  const stopMounted = subscribeUtxoTransactionDetails(key, mounted);
  stopDeparted();
  stopDeparted();
  try {
    await readUtxoTransactionDetails(
      key,
      hash,
      async () => ({ txid: hash }),
      () => true
    );
    expect(departed).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(1);
  } finally {
    stopMounted();
  }
});

it('expires a cached snapshot after five minutes and accepts a fresh Details read', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const key = scope();
  const first = { txid: hash, value: '100000000' };
  const next = { txid: hash, value: '200000000' };
  const read = jest
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(next);
  try {
    await readUtxoTransactionDetails(key, hash, read, () => true);
    await flush();
    now.mockReturnValue(1000 + 5 * 60 * 1000 - 1);
    expect(getCachedUtxoTransactionDetails(key)).toBe(first);
    now.mockReturnValue(1000 + 5 * 60 * 1000);
    expect(getCachedUtxoTransactionDetails(key)).toBeUndefined();
    await readUtxoTransactionDetails(key, hash, read, () => true);
    expect(getCachedUtxoTransactionDetails(key)).toBe(next);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    now.mockRestore();
  }
});

it('evicts the oldest cached transaction after 100 later entries without refetching it', async () => {
  const firstKey = scope();
  await readUtxoTransactionDetails(
    firstKey,
    hash,
    async () => ({ txid: hash }),
    () => true
  );
  let newestKey = firstKey;
  for (let index = 0; index < 100; index += 1) {
    newestKey = scope();
    await readUtxoTransactionDetails(
      newestKey,
      hash,
      async () => ({ txid: hash }),
      () => true
    );
  }
  expect(getCachedUtxoTransactionDetails(firstKey)).toBeUndefined();
  expect(getCachedUtxoTransactionDetails(newestKey)).toEqual({ txid: hash });
  await flush();
});

it('deduplicates matching scoped reads and shares only matching raw chain metadata', async () => {
  const key = scope();
  const result = deferred();
  const read = jest.fn(() => result.promise);
  const first = readUtxoTransactionDetails(key, hash, read, () => true);
  const second = readUtxoTransactionDetails(key, hash, read, () => true);
  expect(second).toBe(first);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  result.resolve({ txid: hash.toUpperCase(), vin: [] });
  await expect(first).resolves.toEqual({ txid: hash.toUpperCase(), vin: [] });
  await expect(
    readUtxoTransactionDetails(key, hash, read, () => true)
  ).resolves.toEqual({ txid: hash.toUpperCase(), vin: [] });
  expect(read).toHaveBeenCalledTimes(1);
});

it.each([null, { txid: 'b'.repeat(64) }])(
  'does not cache a missing or mismatched transaction: %p',
  async (invalid) => {
    const key = scope();
    const changed = jest.fn();
    const stop = subscribeUtxoTransactionDetails(key, changed);
    const read = jest
      .fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValue({ txid: hash });
    await expect(
      readUtxoTransactionDetails(key, hash, read, () => true)
    ).resolves.toBeNull();
    expect(getCachedUtxoTransactionDetails(key)).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    await flush();
    await expect(
      readUtxoTransactionDetails(key, hash, read, () => true)
    ).resolves.toEqual({ txid: hash });
    expect(read).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  }
);

it('bounds concurrency and keeps a queued read alive when a new Details consumer joins', async () => {
  const first = deferred();
  const second = deferred();
  const firstRead = readUtxoTransactionDetails(
    scope(),
    hash,
    () => first.promise,
    () => true
  );
  const secondRead = readUtxoTransactionDetails(
    scope(),
    hash,
    () => second.promise,
    () => true
  );
  let rowCurrent = true;
  const key = scope();
  const read = jest.fn().mockResolvedValue({ txid: hash });
  const row = readUtxoTransactionDetails(key, hash, read, () => rowCurrent);
  rowCurrent = false;
  const details = readUtxoTransactionDetails(key, hash, read, () => true);
  await flush();
  expect(read).not.toHaveBeenCalled();
  first.resolve({ txid: hash });
  await firstRead;
  await expect(details).resolves.toEqual({ txid: hash });
  expect(details).toBe(row);
  expect(read).toHaveBeenCalledTimes(1);
  second.resolve({ txid: hash });
  await secondRead;
  await flush();
});

it('bounds backlog and skips queued reads whose entire scope has left', async () => {
  const blockers = [deferred(), deferred()];
  const blockingReads = blockers.map((blocker) =>
    readUtxoTransactionDetails(
      scope(),
      hash,
      () => blocker.promise,
      () => true
    )
  );
  const read = jest.fn().mockResolvedValue({ txid: hash });
  const queued = Array.from({ length: 30 }, () =>
    readUtxoTransactionDetails(scope(), hash, read, () => false).catch(
      (error) => error.message
    )
  );
  await expect(
    readUtxoTransactionDetails(scope(), hash, read, () => true)
  ).rejects.toThrow('History read queue full');
  blockers.forEach((blocker) => blocker.resolve({ txid: hash }));
  await Promise.all(blockingReads);
  expect(await Promise.all(queued)).toEqual(
    Array(30).fill('History scope changed')
  );
  expect(read).not.toHaveBeenCalled();
  await flush();
});

it('does not share cached metadata across account or network scopes', async () => {
  const read = jest.fn().mockResolvedValue({ txid: hash });
  const key = scope();
  await readUtxoTransactionDetails(
    `${key}:account-a:network-a`,
    hash,
    read,
    () => true
  );
  await readUtxoTransactionDetails(
    `${key}:account-b:network-a`,
    hash,
    read,
    () => true
  );
  await readUtxoTransactionDetails(
    `${key}:account-a:network-b`,
    hash,
    read,
    () => true
  );
  expect(read).toHaveBeenCalledTimes(3);
});

it('wakes live overflow consumers on capacity but never reads for unmounted or stale consumers', async () => {
  const blockers = [deferred(), deferred()];
  const blocking = blockers.map((blocker) =>
    readUtxoTransactionDetails(
      scope(),
      hash,
      () => blocker.promise,
      () => true
    )
  );
  const queued = Array.from({ length: 30 }, () =>
    readUtxoTransactionDetails(scope(), hash, jest.fn(), () => false).catch(
      () => undefined
    )
  );
  const unmountedRead = jest.fn().mockResolvedValue({ txid: hash });
  const staleRead = jest.fn().mockResolvedValue({ txid: hash });
  const currentRead = jest.fn().mockResolvedValue({ txid: hash });
  const staleData = jest.fn(),
    staleError = jest.fn(),
    currentData = jest.fn();
  let staleCurrent = true;
  const stopUnmounted = watchUtxoTransactionDetails(
    scope(),
    hash,
    unmountedRead,
    () => true,
    staleData,
    staleError
  );
  const stopStale = watchUtxoTransactionDetails(
    scope(),
    hash,
    staleRead,
    () => staleCurrent,
    staleData,
    staleError
  );
  const stopCurrent = watchUtxoTransactionDetails(
    scope(),
    hash,
    currentRead,
    () => true,
    currentData,
    staleError
  );
  await flush();
  expect(currentRead).not.toHaveBeenCalled();
  stopUnmounted();
  staleCurrent = false;
  blockers.forEach((blocker) => blocker.resolve({ txid: hash }));
  await Promise.all([...blocking, ...queued]);
  await flush();
  expect(currentRead).toHaveBeenCalledTimes(1);
  expect(currentData).toHaveBeenCalledWith({ txid: hash });
  expect(unmountedRead).not.toHaveBeenCalled();
  expect(staleRead).not.toHaveBeenCalled();
  expect(staleData).not.toHaveBeenCalled();
  expect(staleError).not.toHaveBeenCalled();
  stopStale();
  stopCurrent();
});

it.each([
  new Error('Network request timed out'),
  Object.assign(new Error('Remote error with a similar code'), {
    code: 'HISTORY_READ_QUEUE_FULL',
  }),
])(
  'does not retry actual read failures when later capacity notifications arrive: %s',
  async (error) => {
    const read = jest.fn().mockRejectedValue(error);
    const onError = jest.fn();
    const stop = watchUtxoTransactionDetails(
      scope(),
      hash,
      read,
      () => true,
      jest.fn(),
      onError
    );
    await flush();
    await readUtxoTransactionDetails(
      scope(),
      hash,
      async () => ({ txid: hash }),
      () => true
    );
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  }
);
