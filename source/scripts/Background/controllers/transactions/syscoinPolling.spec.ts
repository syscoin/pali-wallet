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

import { getSyscoinNativeTransferAmount } from 'utils/syscoinTransactionUtils';

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
const fullNativeTransaction = (changes: any = {}) => ({
  txid: 'ab'.repeat(32),
  confirmations: 1,
  fees: '226',
  valueIn: '6547561',
  value: '6547335',
  vin: [{ value: '6547561', isOwn: true }],
  vout: [{ value: '6547335', isOwn: true }],
  ...changes,
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

  it.each(['timeout', 'rate-limit', 'null', 'AbortError'])(
    'restores the native MAX amount after A → B (%s) → A without poisoning backend capability',
    async (failure) => {
      const networkUrl = `${URL}transient-${failure}/`;
      const full = fullNativeTransaction();
      const summary = {
        ...full,
        vin: [],
        vout: [],
        addressValueIn: '6547561',
        addressValueOut: '6547335',
      };
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      let failAccountB = true;
      fetchBackendAccountCachedMock.mockImplementation(
        async (_url: string, account: string, options: string) => {
          if (
            account === 'zpub-account-b' &&
            options.includes('details=txsummary') &&
            failAccountB
          ) {
            failAccountB = false;
            if (failure === 'null') return null;
            throw Object.assign(
              new Error(failure),
              failure === 'rate-limit'
                ? { status: 429 }
                : failure === 'AbortError'
                ? { name: 'AbortError' }
                : {}
            );
          }
          return txsResponse({
            transactions: [
              options.includes('details=txsummary') ? summary : full,
            ],
          });
        }
      );
      try {
        const controller = SysTransactionController();
        const first = await controller.pollingSysTransactions(
          'zpub-account-a',
          networkUrl
        );
        expect(getSyscoinNativeTransferAmount(first[0], full)?.amount).toBe(
          '6547335'
        );
        vaultState = {
          ...buildVaultState([]),
          activeAccount: { type: 'HDAccount', id: 1 },
          accountTransactions: {
            HDAccount: { 1: { syscoin: { [CHAIN_ID]: [] } } },
          },
        };
        await controller.pollingSysTransactions('zpub-account-b', networkUrl);
        vaultState = buildVaultState(first);
        const restored = await controller.pollingSysTransactions(
          'zpub-account-a',
          networkUrl
        );

        expect(
          fetchBackendAccountCachedMock.mock.calls.map(
            ([, account, options]) => [account, options]
          )
        ).toEqual([
          ['zpub-account-a', 'details=txsummary&pageSize=30'],
          ['zpub-account-b', 'details=txsummary&pageSize=30'],
          ['zpub-account-b', 'details=txslight&pageSize=30'],
          ['zpub-account-a', 'details=txsummary&pageSize=30'],
        ]);
        expect(getSyscoinNativeTransferAmount(restored[0], full)).toEqual({
          amount: '6547335',
          kind: 'self',
          outputTotal: false,
        });
      } finally {
        warn.mockRestore();
        fetchBackendAccountCachedMock.mockReset();
      }
    }
  );

  it('normalizes explicit account ownership in legitimate txslight fallback without using global value aliases', async () => {
    const full = fullNativeTransaction({
      value: '6547335',
      vout: [{ value: '1000000' }, { value: '5547335', isOwn: true }],
    });
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce({ txs: 1 })
      .mockResolvedValueOnce(txsResponse({ transactions: [full] }));

    const [row] =
      await SysTransactionController().getInitialUserTransactionsByXpub(
        'zpub-light-external',
        `${URL}owned-light/`
      );

    expect(row.addressValueIn).toBe('6547561');
    expect(row.addressValueOut).toBe('5547335');
    expect(row.value).toBe('6547335');
    expect(getSyscoinNativeTransferAmount(row)).toEqual({
      amount: '1000000',
      direction: 'sent',
      kind: 'external',
    });
  });

  it.each([
    {
      name: 'receipt',
      transaction: {
        vin: [{ value: '6547561' }],
        vout: [{ value: '1000000', isOwn: true }, { value: '5547335' }],
      },
      accountIn: '0',
      accountOut: '1000000',
      expected: { amount: '1000000', direction: 'received', kind: 'received' },
    },
    {
      name: 'exact large atomic strings',
      transaction: {
        vin: [{ value: '9007199254740993', isOwn: true }],
        vout: [{ value: '9007199254740767', isOwn: true }],
      },
      accountIn: '9007199254740993',
      accountOut: '9007199254740767',
      expected: {
        amount: '9007199254740767',
        kind: 'self',
        outputTotal: false,
      },
    },
    {
      name: 'collaborative inputs remain ambiguous',
      transaction: {
        vin: [{ value: '1000000', isOwn: true }, { value: '5547561' }],
        vout: [{ value: '1000000', isOwn: true }, { value: '5547335' }],
      },
      accountIn: '1000000',
      accountOut: '1000000',
      expected: null,
    },
  ])(
    'preserves truthful native amounts for paged fallback: $name',
    async ({ name, transaction, accountIn, accountOut, expected }) => {
      const full = fullNativeTransaction(transaction);
      const networkUrl = `${URL}paged-light-${name}/`;
      fetchBackendAccountCachedMock
        .mockResolvedValueOnce({ txs: 1 })
        .mockResolvedValueOnce(txsResponse({ transactions: [full] }));

      const [row] =
        await SysTransactionController().fetchTransactionsPageFromBlockbook(
          'zpub-paged-light',
          networkUrl,
          2,
          20
        );

      expect(fetchBackendAccountCachedMock).toHaveBeenLastCalledWith(
        networkUrl,
        'zpub-paged-light',
        'details=txslight&page=2&pageSize=20',
        true
      );
      expect(row.addressValueIn).toBe(accountIn);
      expect(row.addressValueOut).toBe(accountOut);
      expect(getSyscoinNativeTransferAmount(row)).toEqual(expected);
    }
  );

  it.each([
    { vin: [{ value: '6547561' }], vout: [{ value: '6547335' }] },
    { vin: [{ value: 'bad', isOwn: true }] },
    { vout: [{ value: '-1', isOwn: true }] },
    { fees: '225' },
    { vin: [{ value: Number.MAX_SAFE_INTEGER + 1, isOwn: true }] },
    { vin: [] },
    { addressValueIn: 'existing-authoritative-value' },
    { vin: [{ value: '6547561', isOwn: 'true' }] },
  ])(
    'leaves incomplete, malformed, or unattributed fallback rows unresolved: %p',
    async (changes) => {
      const full = fullNativeTransaction(changes);
      fetchBackendAccountCachedMock
        .mockResolvedValueOnce({ txs: 1 })
        .mockResolvedValueOnce(txsResponse({ transactions: [full] }));

      const [row] =
        await SysTransactionController().getInitialUserTransactionsByXpub(
          'zpub-light-ambiguous',
          `${URL}ambiguous-light-${JSON.stringify(changes)}/`
        );

      expect(row).toEqual(full);
      expect(getSyscoinNativeTransferAmount(row)).toBeNull();
    }
  );

  it('remembers txslight compatibility after a successful basic-only response with history', async () => {
    const fallbackUrl = `${URL}txsummary-unsupported/`;
    const xpub = 'zpub-txsummary-fallback';
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce({ txs: 1 })
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
      .mockResolvedValueOnce({ txs: 1 })
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
