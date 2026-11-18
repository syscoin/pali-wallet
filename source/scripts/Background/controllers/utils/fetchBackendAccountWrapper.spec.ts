const fetchBackendAccountMock = jest.fn();

jest.mock('syscoinjs-lib', () => ({
  utils: {
    fetchBackendAccount: (...args: any[]) => fetchBackendAccountMock(...args),
  },
}));

import {
  fetchBackendAccountCached,
  clearFetchBackendAccountCache,
} from './fetchBackendAccountWrapper';

const XPUB = 'zpub6rABCDEF0123456789';
const URL = 'https://blockbook.test/';

const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<any>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('fetchBackendAccountCached', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearFetchBackendAccountCache();
  });

  it('deduplicates identical in-flight requests', async () => {
    const d = deferred();
    fetchBackendAccountMock.mockReturnValueOnce(d.promise);

    const p1 = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txs&pageSize=30',
      true
    );
    const p2 = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txs&pageSize=30',
      true
    );

    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(1);

    d.resolve({ balance: '1' });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ balance: '1' });
    expect(r2).toEqual({ balance: '1' });
  });

  it('shares exactly one trailing-slash variant without merging distinct paths or queries', async () => {
    const held = deferred();
    fetchBackendAccountMock.mockReturnValue(held.promise);
    const options = 'details=tokenBalances&tokens=used';
    const requests = [
      fetchBackendAccountCached(
        'https://blockbook.test/root',
        XPUB,
        options,
        true
      ),
      fetchBackendAccountCached(
        'https://blockbook.test/root/',
        XPUB,
        options,
        true
      ),
      fetchBackendAccountCached(
        'https://blockbook.test/root//',
        XPUB,
        options,
        true
      ),
      fetchBackendAccountCached(
        'https://blockbook.test/other',
        XPUB,
        options,
        true
      ),
      fetchBackendAccountCached(
        'https://blockbook.test/root?key=one',
        XPUB,
        options,
        true
      ),
      fetchBackendAccountCached(
        'https://blockbook.test/root?key=two',
        XPUB,
        options,
        true
      ),
    ];
    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(5);
    held.resolve({ balance: '1' });
    await Promise.all(requests);
  });

  it('satisfies a basic request from an in-flight higher-level request (same xpub)', async () => {
    const d = deferred();
    fetchBackendAccountMock.mockReturnValueOnce(d.promise);

    const txsPromise = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txs&pageSize=30',
      true
    );
    const basicPromise = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=basic&pageSize=0',
      true
    );

    // Only ONE network call for both the heavy txs fetch and the basic probe
    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(1);

    d.resolve({ balance: '5', txs: 2, transactions: [] });
    const [txsResult, basicResult] = await Promise.all([
      txsPromise,
      basicPromise,
    ]);
    // The basic probe receives the full higher-level response (a superset)
    expect(basicResult).toEqual(txsResult);
    expect(basicResult.balance).toBe('5');
  });

  it('does not satisfy a basic request from an in-flight txsummary request', async () => {
    const summaryD = deferred();
    const basicD = deferred();
    fetchBackendAccountMock
      .mockReturnValueOnce(summaryD.promise)
      .mockReturnValueOnce(basicD.promise);

    const summaryPromise = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txsummary&pageSize=30',
      true
    );
    const basicPromise = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=basic&pageSize=0',
      true
    );

    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(2);

    summaryD.resolve(null);
    basicD.resolve({ balance: '5', txs: 2 });
    const [summaryResult, basicResult] = await Promise.all([
      summaryPromise,
      basicPromise,
    ]);
    expect(summaryResult).toBeNull();
    expect(basicResult).toEqual({ balance: '5', txs: 2 });
  });

  it('does NOT upgrade a basic in-flight request to satisfy a txs request', async () => {
    const basicD = deferred();
    const txsD = deferred();
    fetchBackendAccountMock
      .mockReturnValueOnce(basicD.promise)
      .mockReturnValueOnce(txsD.promise);

    fetchBackendAccountCached(URL, XPUB, 'details=basic&pageSize=0', true);
    fetchBackendAccountCached(URL, XPUB, 'details=txs&pageSize=30', true);

    // basic cannot serve txs (txs has fields basic lacks), so a second call fires
    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(2);

    basicD.resolve({ balance: '1' });
    txsD.resolve({ balance: '1', transactions: [] });
  });

  it('does not share requests across different xpubs', async () => {
    fetchBackendAccountMock.mockResolvedValue({ balance: '1' });
    await Promise.all([
      fetchBackendAccountCached(URL, XPUB, 'details=txs', true),
      fetchBackendAccountCached(URL, 'zpubDIFFERENT', 'details=basic', true),
    ]);
    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a slow request joined past the completed-result cache lifetime', async () => {
    jest.useFakeTimers();
    const held = deferred();
    fetchBackendAccountMock.mockReturnValueOnce(held.promise);
    try {
      const first = fetchBackendAccountCached(URL, XPUB, 'details=txs', true);
      await jest.advanceTimersByTimeAsync(6000);
      const second = fetchBackendAccountCached(URL, XPUB, 'details=txs', true);
      expect(fetchBackendAccountMock).toHaveBeenCalledTimes(1);
      held.resolve({ balance: '1' });
      expect(await Promise.all([first, second])).toEqual([
        { balance: '1' },
        { balance: '1' },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('expires completed results after the short reuse lifetime', async () => {
    jest.useFakeTimers();
    fetchBackendAccountMock.mockResolvedValue({ balance: '1' });
    try {
      await fetchBackendAccountCached(URL, XPUB, 'details=basic', true);
      await fetchBackendAccountCached(URL, XPUB, 'details=basic', true);
      expect(fetchBackendAccountMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(100);
      await fetchBackendAccountCached(URL, XPUB, 'details=basic', true);
      expect(fetchBackendAccountMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels subscribers independently and aborts physical work after the final subscriber leaves', async () => {
    const held = deferred();
    fetchBackendAccountMock.mockReturnValueOnce(held.promise);
    const firstOwner = new AbortController(),
      secondOwner = new AbortController();
    const first = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txs',
      true,
      firstOwner.signal
    );
    const second = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txs',
      true,
      secondOwner.signal
    );
    const transport = fetchBackendAccountMock.mock.calls[0][5];
    firstOwner.abort();
    await expect(first).rejects.toHaveProperty('name', 'AbortError');
    expect(transport.signal.aborted).toBe(false);
    secondOwner.abort();
    await expect(second).rejects.toHaveProperty('name', 'AbortError');
    expect(transport.signal.aborted).toBe(true);
    held.resolve({ balance: 'late' });
  });

  it('invalidates completed summaries while keeping pending history owned until explicit retirement', async () => {
    const held = deferred();
    fetchBackendAccountMock
      .mockResolvedValueOnce({ balance: '1' })
      .mockReturnValueOnce(held.promise);
    await fetchBackendAccountCached(
      URL,
      XPUB,
      'details=tokenBalances&tokens=used',
      true
    );
    const history = fetchBackendAccountCached(
      URL,
      XPUB,
      'details=txsummary',
      true
    );
    const rejected = expect(history).rejects.toHaveProperty(
      'name',
      'AbortError'
    );
    const transport = fetchBackendAccountMock.mock.calls[1][5];
    clearFetchBackendAccountCache(true);
    expect(transport.signal.aborted).toBe(false);
    fetchBackendAccountMock.mockResolvedValueOnce({ balance: '2' });
    await expect(
      fetchBackendAccountCached(
        URL,
        XPUB,
        'details=tokenBalances&tokens=used',
        true
      )
    ).resolves.toEqual({ balance: '2' });
    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(3);
    clearFetchBackendAccountCache();
    await rejected;
    expect(transport.signal.aborted).toBe(true);
    held.resolve({ transactions: [] });
  });

  it('retires physical transport when the cache is explicitly cleared', async () => {
    const held = deferred();
    fetchBackendAccountMock.mockReturnValueOnce(held.promise);
    const first = fetchBackendAccountCached(URL, XPUB, 'details=txs', true);
    const transport = fetchBackendAccountMock.mock.calls[0][5];
    clearFetchBackendAccountCache();
    await expect(first).rejects.toHaveProperty('name', 'AbortError');
    expect(transport.signal.aborted).toBe(true);
    held.resolve({ balance: 'late' });
  });

  it('propagates a transport rejection without a second unhandled cleanup rejection', async () => {
    const failure = new Error('transport offline');
    fetchBackendAccountMock.mockRejectedValueOnce(failure);
    const request = fetchBackendAccountCached(URL, XPUB, 'details=txs', true);
    await expect(request).rejects.toBe(failure);
    // Jest treats any separate unhandled rejection as failure. Give the event
    // loop a turn without intercepting or suppressing process-level errors.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
