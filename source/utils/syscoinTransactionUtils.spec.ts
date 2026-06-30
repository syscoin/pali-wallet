import { getSyscoinIntentAmount } from './syscoinTransactionUtils';

describe('getSyscoinIntentAmount', () => {
  it('selects compact SPT transfers by decimal-normalized amount', () => {
    const intent = getSyscoinIntentAmount({
      accountAssetTransfers: [
        {
          value: '100000000',
          decimals: 8,
          symbol: 'EIGHT',
        },
        {
          value: '50',
          decimals: 0,
          symbol: 'ZERO',
        },
      ],
      tokenType: 'SPT_SEND',
    } as any);

    expect(intent).toEqual({
      amount: 50,
      decimals: 0,
      symbol: 'ZERO',
    });
  });
});
