import { readUtxoTransactionDetails } from './utxoTransactionDetails';

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
    const read = jest
      .fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValue({ txid: hash });
    await expect(
      readUtxoTransactionDetails(key, hash, read, () => true)
    ).resolves.toBeNull();
    await flush();
    await expect(
      readUtxoTransactionDetails(key, hash, read, () => true)
    ).resolves.toEqual({ txid: hash });
    expect(read).toHaveBeenCalledTimes(2);
  }
);

it('bounds concurrency and keeps a queued read alive when Details replaces its list subscriber', async () => {
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
