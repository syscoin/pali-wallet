const fetchBackendAccountCachedMock = jest.fn();

jest.mock('../utils/fetchBackendAccountWrapper', () => ({
  fetchBackendAccountCached: (...args: any[]) =>
    fetchBackendAccountCachedMock(...args),
}));

let vaultState: any;

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: vaultState }),
  },
}));

import SysTransactionController from './syscoin';

const CHAIN_ID = 57;
const URL = 'https://blockbook.test/';

const buildVaultState = (localTxs: any[]) => ({
  activeAccount: { type: 'HDAccount', id: 0 },
  activeNetwork: { chainId: CHAIN_ID },
  accountTransactions: {
    HDAccount: {
      0: {
        syscoin: {
          [CHAIN_ID]: localTxs,
        },
      },
    },
  },
});

const txsResponse = (overrides: any = {}) => ({
  balance: '100000000',
  unconfirmedBalance: '0',
  txs: 1,
  unconfirmedTxs: 0,
  transactions: [
    {
      txid: 'tx1',
      confirmations: 10,
      blockTime: 1700000000,
      value: '100000000',
    },
  ],
  ...overrides,
});

describe('SysTransactionController rapid polling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vaultState = buildVaultState([]);
  });

  it('regular polling always performs the txsummary history fetch', async () => {
    // Use a unique xpub per test: the activity snapshot map is module-level
    const xpub = 'zpub-regular-poll';
    fetchBackendAccountCachedMock.mockResolvedValueOnce(txsResponse());

    const controller = SysTransactionController();
    const result = await controller.pollingSysTransactions(xpub, URL, false);

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      URL,
      xpub,
      'details=txsummary&pageSize=30',
      true
    );
    expect(result.map((tx: any) => tx.txid)).toEqual(['tx1']);
  });

  it('falls back to txslight when txsummary is unavailable', async () => {
    const fallbackUrl = `${URL}txsummary-unsupported/`;
    const xpub = 'zpub-txsummary-fallback';
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(txsResponse());

    const controller = SysTransactionController();
    const result = await controller.pollingSysTransactions(
      xpub,
      fallbackUrl,
      false
    );

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(2);
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      1,
      fallbackUrl,
      xpub,
      'details=txsummary&pageSize=30',
      true
    );
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      2,
      fallbackUrl,
      xpub,
      'details=txslight&pageSize=30',
      true
    );
    expect(result.map((tx: any) => tx.txid)).toEqual(['tx1']);

    fetchBackendAccountCachedMock.mockClear();
    fetchBackendAccountCachedMock.mockResolvedValueOnce(txsResponse());

    const secondXpub = 'zpub-txsummary-fallback-cached';
    const secondResult = await controller.pollingSysTransactions(
      secondXpub,
      fallbackUrl,
      false
    );

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      fallbackUrl,
      secondXpub,
      'details=txslight&pageSize=30',
      true
    );
    expect(secondResult.map((tx: any) => tx.txid)).toEqual(['tx1']);
  });

  it('falls back when txsummary returns account data without transactions', async () => {
    const fallbackUrl = `${URL}txsummary-basic-only/`;
    const xpub = 'zpub-txsummary-basic-only';
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce({
        balance: '100000000',
        unconfirmedBalance: '0',
        txs: 1,
        unconfirmedTxs: 0,
      })
      .mockResolvedValueOnce(txsResponse());

    const controller = SysTransactionController();
    const result = await controller.pollingSysTransactions(
      xpub,
      fallbackUrl,
      false
    );

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(2);
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      1,
      fallbackUrl,
      xpub,
      'details=txsummary&pageSize=30',
      true
    );
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      2,
      fallbackUrl,
      xpub,
      'details=txslight&pageSize=30',
      true
    );
    expect(result.map((tx: any) => tx.txid)).toEqual(['tx1']);
  });

  it('falls back when txsummary omits unconfirmed-only transactions', async () => {
    const fallbackUrl = `${URL}txsummary-unconfirmed-basic-only/`;
    const xpub = 'zpub-txsummary-unconfirmed-basic-only';
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce({
        balance: '0',
        unconfirmedBalance: '100000000',
        txs: 0,
        unconfirmedTxs: 1,
      })
      .mockResolvedValueOnce(txsResponse());

    const controller = SysTransactionController();
    const result = await controller.pollingSysTransactions(
      xpub,
      fallbackUrl,
      false
    );

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(2);
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      1,
      fallbackUrl,
      xpub,
      'details=txsummary&pageSize=30',
      true
    );
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      2,
      fallbackUrl,
      xpub,
      'details=txslight&pageSize=30',
      true
    );
    expect(result.map((tx: any) => tx.txid)).toEqual(['tx1']);
  });

  it('propagates failures once history uses cached txslight fallback', async () => {
    const fallbackUrl = `${URL}txsummary-unsupported-reject/`;
    const xpub = 'zpub-txsummary-fallback-reject';
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(txsResponse());

    const controller = SysTransactionController();
    await controller.pollingSysTransactions(xpub, fallbackUrl, false);

    const txslightError = new Error('txslight unavailable');
    fetchBackendAccountCachedMock.mockClear();
    fetchBackendAccountCachedMock.mockRejectedValueOnce(txslightError);

    await expect(
      controller.pollingSysTransactions(
        'zpub-txsummary-fallback-reject-second',
        fallbackUrl,
        false
      )
    ).rejects.toThrow('txslight unavailable');
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      fallbackUrl,
      'zpub-txsummary-fallback-reject-second',
      'details=txslight&pageSize=30',
      true
    );
  });

  it('rapid polling skips the history fetch when the basic summary is unchanged', async () => {
    const xpub = 'zpub-rapid-unchanged';
    const controller = SysTransactionController();

    // Seed the activity snapshot with a history fetch
    fetchBackendAccountCachedMock.mockResolvedValueOnce(txsResponse());
    await controller.pollingSysTransactions(xpub, URL, false);

    const localTxs = [{ txid: 'tx1', confirmations: 10 }];
    vaultState = buildVaultState(localTxs);

    // Rapid poll: basic probe reports the same summary -> no txs fetch
    fetchBackendAccountCachedMock.mockClear();
    fetchBackendAccountCachedMock.mockResolvedValueOnce({
      balance: '100000000',
      unconfirmedBalance: '0',
      txs: 1,
      unconfirmedTxs: 0,
    });

    const result = await controller.pollingSysTransactions(xpub, URL, true);

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      URL,
      xpub,
      'details=basic&pageSize=0',
      true
    );
    // Local state is returned untouched
    expect(result).toEqual(localTxs);
  });

  it('rapid polling compares addrTxCount when txsummary deduplicates xpub transactions', async () => {
    const xpub = 'zpub-rapid-xpub-deduped-count';
    const controller = SysTransactionController();

    fetchBackendAccountCachedMock.mockResolvedValueOnce(
      txsResponse({
        txs: 9,
        addrTxCount: 10,
        transactions: [
          {
            txid: 'tx1',
            confirmations: 10,
            blockTime: 1700000000,
            value: '100000000',
          },
        ],
      })
    );
    await controller.pollingSysTransactions(xpub, URL, false);

    const localTxs = [{ txid: 'tx1', confirmations: 10 }];
    vaultState = buildVaultState(localTxs);

    fetchBackendAccountCachedMock.mockClear();
    fetchBackendAccountCachedMock.mockResolvedValueOnce({
      balance: '100000000',
      unconfirmedBalance: '0',
      txs: 10,
      addrTxCount: 10,
      unconfirmedTxs: 0,
    });

    const result = await controller.pollingSysTransactions(xpub, URL, true);

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      URL,
      xpub,
      'details=basic&pageSize=0',
      true
    );
    expect(result).toEqual(localTxs);
  });

  it('rapid polling performs the history fetch when the summary changed', async () => {
    const xpub = 'zpub-rapid-changed';
    const controller = SysTransactionController();

    fetchBackendAccountCachedMock.mockResolvedValueOnce(txsResponse());
    await controller.pollingSysTransactions(xpub, URL, false);

    fetchBackendAccountCachedMock.mockClear();
    // Basic probe: a new unconfirmed tx appeared
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce({
        balance: '100000000',
        unconfirmedBalance: '-50000000',
        txs: 1,
        unconfirmedTxs: 1,
      })
      .mockResolvedValueOnce(
        txsResponse({
          txs: 1,
          unconfirmedTxs: 1,
          unconfirmedBalance: '-50000000',
          transactions: [
            { txid: 'tx2', confirmations: 0, blockTime: 1700000100 },
            {
              txid: 'tx1',
              confirmations: 10,
              blockTime: 1700000000,
            },
          ],
        })
      );

    const result = await controller.pollingSysTransactions(xpub, URL, true);

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(2);
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      1,
      URL,
      xpub,
      'details=basic&pageSize=0',
      true
    );
    expect(fetchBackendAccountCachedMock).toHaveBeenNthCalledWith(
      2,
      URL,
      xpub,
      'details=txsummary&pageSize=30',
      true
    );
    expect(result.some((tx: any) => tx.txid === 'tx2')).toBe(true);
  });

  it('rapid polling without a prior snapshot goes straight to the history fetch', async () => {
    const xpub = 'zpub-rapid-no-snapshot';
    fetchBackendAccountCachedMock.mockResolvedValueOnce(txsResponse());

    const controller = SysTransactionController();
    await controller.pollingSysTransactions(xpub, URL, true);

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      URL,
      xpub,
      'details=txsummary&pageSize=30',
      true
    );
  });

  it('rapid polling falls back to the history fetch when the basic probe fails', async () => {
    const xpub = 'zpub-rapid-probe-fail';
    const controller = SysTransactionController();

    fetchBackendAccountCachedMock.mockResolvedValueOnce(txsResponse());
    await controller.pollingSysTransactions(xpub, URL, false);

    fetchBackendAccountCachedMock.mockClear();
    fetchBackendAccountCachedMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(txsResponse());

    const result = await controller.pollingSysTransactions(xpub, URL, true);

    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(2);
    expect(result.map((tx: any) => tx.txid)).toEqual(['tx1']);
  });
});
