import { getTransactionDisplayCacheKey } from './transactionDisplayCache';

const base = {
  accountAddress: '0xaccount',
  chainId: 1,
  currency: 'ETH',
  transaction: {
    hash: 'same-hash',
    input: '0xa9059cbb',
    to: '0xtoken',
    value: '0',
  },
  tokenMeta: { decimals: 6, symbol: 'USDC' },
};

describe('transaction display cache isolation', () => {
  it('isolates identical transaction hashes across accounts and networks', () => {
    const key = getTransactionDisplayCacheKey(base);
    expect(getTransactionDisplayCacheKey({ ...base, chainId: 57 })).not.toBe(
      key
    );
    expect(
      getTransactionDisplayCacheKey({ ...base, accountAddress: '0xother' })
    ).not.toBe(key);
    expect(
      getTransactionDisplayCacheKey({ ...base, currency: 'SYS' })
    ).not.toBe(key);
  });

  it('invalidates values when decoded calls or token metadata change', () => {
    const key = getTransactionDisplayCacheKey(base);
    expect(
      getTransactionDisplayCacheKey({
        ...base,
        tokenMeta: { ...base.tokenMeta, decimals: 18 },
      })
    ).not.toBe(key);
    expect(
      getTransactionDisplayCacheKey({
        ...base,
        transaction: { ...base.transaction, input: '0xnew-call' },
      })
    ).not.toBe(key);
  });
});
