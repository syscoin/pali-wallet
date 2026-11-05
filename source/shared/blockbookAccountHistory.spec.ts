import {
  createBlockbookAccountHistory,
  isUnsupportedTxSummaryResponse,
  normalizeAccountHistory,
  readHistoryCount,
  validateAccountHistory,
} from './blockbookAccountHistory';

const URL = 'https://blockbook.test';
const ACCOUNT = 'public-account-fixture';
const empty = { txs: 0, unconfirmedTxs: 0 };
const row = { txid: 'public-tx', confirmations: 1 };
const response = { txs: 1, unconfirmedTxs: 0, transactions: [row] };

it.each([0, 1, Number.MAX_SAFE_INTEGER, '0', '0001', '9007199254740991'])(
  'preserves supported count representation %s',
  (value) => {
    expect(readHistoryCount(value)).toBe(Number(value));
  }
);
it.each([
  null,
  undefined,
  {},
  [],
  -1,
  0.1,
  NaN,
  Infinity,
  ' 1',
  '+1',
  '1e2',
  '9007199254740992',
])('rejects unsupported count representation %s', (value) => {
  expect(readHistoryCount(value)).toBeNull();
});

it('preserves explicit zero-count omitted-array and later-page behavior', () => {
  expect(validateAccountHistory(empty, false)).toEqual({
    ...empty,
    transactions: [],
  });
  expect(validateAccountHistory({ txs: 8, unconfirmedTxs: 1 }, true)).toEqual({
    txs: 8,
    unconfirmedTxs: 1,
    transactions: [],
  });
  expect(() =>
    validateAccountHistory({ txs: 8, unconfirmedTxs: 1 }, false)
  ).toThrow('Incomplete Blockbook history response');
  expect(() =>
    validateAccountHistory(
      { txs: 8, unconfirmedTxs: 1, txids: ['missing-row'] },
      true
    )
  ).toThrow('Incomplete Blockbook history response');
  expect(() =>
    validateAccountHistory({ ...empty, transactions: null }, true)
  ).toThrow('Incomplete Blockbook history response');
  expect(() =>
    validateAccountHistory({ error: 'backend failed', ...empty }, false)
  ).toThrow('Invalid Blockbook history response');
});
it('does not turn positive counts, invalid rows or malformed counts into an empty first page', () => {
  for (const value of [
    { txs: 1, transactions: [] },
    { txs: 'bad', transactions: [row] },
    { transactions: [null] },
    { transactions: [{ txid: '' }] },
  ]) {
    expect(() => validateAccountHistory(value, false)).toThrow();
  }
  expect(validateAccountHistory({ transactions: [row] }, false)).toEqual({
    transactions: [row],
  });
});
it('classifies unsupported summary only from the existing successful basic-only response', () => {
  expect(
    isUnsupportedTxSummaryResponse({ txs: 1 }, 'details=txsummary&pageSize=30')
  ).toBe(true);
  expect(
    isUnsupportedTxSummaryResponse({ unconfirmedTxs: '1' }, 'details=txsummary')
  ).toBe(true);
  for (const value of [
    null,
    empty,
    { error: 'failed', txs: 1 },
    { txs: 'bad' },
    { txs: 1, transactions: [] },
    response,
  ]) {
    expect(isUnsupportedTxSummaryResponse(value, 'details=txsummary')).toBe(
      false
    );
  }
  expect(isUnsupportedTxSummaryResponse({ txs: 1 }, 'details=txslight')).toBe(
    false
  );
});
it('derives only account-relative owned totals with exact integers and preserves other fields', () => {
  const huge = '900719925474099300000';
  const tx = {
    txid: 'public',
    fees: '100',
    assetSpecific: { keep: true },
    vin: [
      { value: huge, isOwn: true },
      { value: '500', isOwn: false },
    ],
    vout: [
      { value: huge, isOwn: true },
      { value: '400', isOwn: false },
    ],
  };
  const input = { ...response, transactions: [tx] };
  const result = normalizeAccountHistory(input);
  expect(result.transactions[0]).toEqual({
    ...tx,
    addressValueIn: huge,
    addressValueOut: huge,
  });
  expect(input.transactions[0]).not.toHaveProperty('addressValueIn');
  expect(result.transactions[0].assetSpecific).toBe(tx.assetSpecific);
});
it('preserves unresolved ownership, supplied totals and inconsistent raw values unchanged', () => {
  const ordinary = {
    txid: 'public',
    fees: '1',
    value: '999',
    valueIn: '1000',
    vin: [{ value: '1000' }],
    vout: [{ value: '999' }],
  };
  const values = [
    ordinary,
    { ...ordinary, addressValueIn: '700' },
    { ...ordinary, vin: [{ value: '1000', isOwn: 'yes' }] },
    { ...ordinary, vin: [{ value: '1000', isOwn: true }], fees: '2' },
    { ...ordinary, vin: [{ value: 9007199254740992, isOwn: true }] },
  ];
  const result = normalizeAccountHistory({ transactions: values });
  values.forEach((value, i) => expect(result.transactions[i]).toBe(value));
});
it('retains exact request options and one host-lifetime capability memo shared across account calls', async () => {
  const fetch = jest
    .fn()
    .mockResolvedValueOnce({ txs: 1 })
    .mockResolvedValue(response);
  const warn = jest.fn();
  const history = createBlockbookAccountHistory(fetch, warn);
  expect(history.getHistoryRequestOptions(URL, ACCOUNT)).toBe(
    'details=txsummary&pageSize=30'
  );
  expect(history.getHistoryRequestOptions(URL, ACCOUNT, 0, 20)).toBe(
    'details=txsummary&page=0&pageSize=20'
  );
  await expect(
    history.fetchAccountHistory(
      URL,
      ACCOUNT,
      history.getHistoryRequestOptions(URL, ACCOUNT)
    )
  ).resolves.toEqual(response);
  expect(fetch.mock.calls).toEqual([
    [URL, ACCOUNT, 'details=txsummary&pageSize=30', true],
    [URL, ACCOUNT, 'details=txslight&pageSize=30', true],
  ]);
  expect(history.getHistoryRequestOptions(URL, 'other-account', 2, 20)).toBe(
    'details=txslight&page=2&pageSize=20'
  );
  expect(history.getHistoryRequestOptions(URL + '/other', ACCOUNT)).toBe(
    'details=txsummary&pageSize=30'
  );
  expect(
    createBlockbookAccountHistory(fetch).getHistoryRequestOptions(URL, ACCOUNT)
  ).toBe('details=txsummary&pageSize=30');
  expect(warn).not.toHaveBeenCalled();
});
it.each(['throw', 'null', 'invalid'])(
  'falls back on %s without changing later summary capability',
  async (failure) => {
    const cause = new Error('public-test-error');
    const warn = jest.fn();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        failure === 'null' ? null : { txs: 1, transactions: [] }
      )
      .mockResolvedValue(response);
    if (failure === 'throw')
      fetch
        .mockReset()
        .mockRejectedValueOnce(cause)
        .mockResolvedValue(response);
    const history = createBlockbookAccountHistory(fetch, warn);
    await expect(
      history.fetchAccountHistory(
        URL,
        ACCOUNT,
        'details=txsummary&page=2&pageSize=20'
      )
    ).resolves.toEqual(response);
    expect(fetch.mock.calls[1]).toEqual([
      URL,
      ACCOUNT,
      'details=txslight&page=2&pageSize=20',
      true,
    ]);
    expect(history.getHistoryRequestOptions(URL, ACCOUNT)).toBe(
      'details=txsummary&pageSize=30'
    );
    expect(warn).toHaveBeenCalledTimes(1);
    if (failure === 'throw') expect(warn).toHaveBeenCalledWith(cause);
  }
);
it('propagates fallback failure and preserves direct txslight failures without another request', async () => {
  const error = new Error('public-test-error'),
    fetch = jest
      .fn()
      .mockResolvedValueOnce({ txs: 1 })
      .mockRejectedValue(error);
  const warn = jest.fn(),
    history = createBlockbookAccountHistory(fetch, warn);
  await expect(
    history.fetchAccountHistory(URL, ACCOUNT, 'details=txsummary')
  ).rejects.toBe(error);
  expect(history.getHistoryRequestOptions(URL, ACCOUNT)).toBe(
    'details=txslight&pageSize=30'
  );
  fetch.mockClear();
  await expect(
    history.fetchAccountHistory(URL, ACCOUNT, 'details=txslight')
  ).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(warn).not.toHaveBeenCalled();
});
it('keeps optional diagnostic propagation and explicit later-page admission', async () => {
  const diagnostic = new Error('diagnostic'),
    fetch = jest.fn().mockRejectedValue(new Error('transport'));
  const history = createBlockbookAccountHistory(fetch, () => {
    throw diagnostic;
  });
  await expect(
    history.fetchAccountHistory(URL, ACCOUNT, 'details=txsummary')
  ).rejects.toBe(diagnostic);
  expect(fetch).toHaveBeenCalledTimes(1);
  const page = createBlockbookAccountHistory(
    jest.fn().mockResolvedValue({ txs: 9, unconfirmedTxs: 0 })
  );
  await expect(
    page.fetchAccountHistory(
      URL,
      ACCOUNT,
      'details=txslight&page=2&pageSize=30',
      true
    )
  ).resolves.toEqual({ txs: 9, unconfirmedTxs: 0, transactions: [] });
});

it('request-scoped transport and revocation do not change default extension calls or leak a fallback', async () => {
  const defaultFetch = jest.fn().mockResolvedValue(response);
  const scopedFetch = jest.fn().mockResolvedValue({ txs: 1 });
  const history = createBlockbookAccountHistory(defaultFetch);
  let current = true;
  scopedFetch.mockImplementation(async () => {
    current = false;
    return { txs: 1 };
  });
  await expect(
    history.fetchAccountHistory(URL, ACCOUNT, 'details=txsummary', false, {
      fetch: scopedFetch,
      assertCurrent() {
        if (!current) throw new Error('revoked');
      },
    })
  ).rejects.toThrow('revoked');
  expect(scopedFetch).toHaveBeenCalledTimes(1);
  expect(defaultFetch).not.toHaveBeenCalled();
  expect(history.getHistoryRequestOptions(URL, ACCOUNT)).toBe(
    'details=txsummary&pageSize=30'
  );
  await history.fetchAccountHistory(URL, ACCOUNT, 'details=txsummary');
  expect(defaultFetch).toHaveBeenCalledWith(
    URL,
    ACCOUNT,
    'details=txsummary',
    true
  );
});
