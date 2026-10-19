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

  it('invalidates every event field consumed by token-only display', () => {
    const transaction = {
      ...base.transaction,
      historySource: 'explorer-tokentx',
      tokenRecipient: '0xrecipient',
      tokenTransfer: {
        chainId: 1,
        contractAddress: '0xcontract',
        recipient: '0xrecipient',
        value: '1000000',
        decimals: '6',
        symbol: 'USDC',
        tokenId: '0',
        tokenStandard: 'ERC-1155',
      },
    };
    const key = getTransactionDisplayCacheKey({ ...base, transaction });
    for (const [field, value] of Object.entries(transaction.tokenTransfer)) {
      expect(
        getTransactionDisplayCacheKey({
          ...base,
          transaction: {
            ...transaction,
            tokenTransfer: {
              ...transaction.tokenTransfer,
              [field]: `${value}-changed`,
            },
          },
        })
      ).not.toBe(key);
    }
    for (const field of ['historySource', 'tokenRecipient']) {
      expect(
        getTransactionDisplayCacheKey({
          ...base,
          transaction: { ...transaction, [field]: 'changed' },
        })
      ).not.toBe(key);
    }
  });
});
