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
    fetchBackendAccountMock.mockReturnValue(deferred().promise);

    fetchBackendAccountCached(URL, XPUB, 'details=txs', true);
    fetchBackendAccountCached(URL, 'zpubDIFFERENT', 'details=basic', true);

    expect(fetchBackendAccountMock).toHaveBeenCalledTimes(2);
  });
});
