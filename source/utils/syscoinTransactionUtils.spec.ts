import { getSyscoinIntentAmount } from './syscoinTransactionUtils';

describe('getSyscoinIntentAmount', () => {
  it('selects compact SPT transfers by decimal-normalized amount', () => {
    const intent = getSyscoinIntentAmount({
      accountAssetTransfers: [
        {
          assetGuid: 'eight-decimal-asset',
          value: '100000000',
          decimals: 8,
          symbol: 'EIGHT',
        },
        {
          assetGuid: 'zero-decimal-asset',
          value: '-50',
          decimals: 0,
          symbol: 'ZERO',
        },
      ],
      tokenType: 'SPT_SEND',
    } as any);

    expect(intent).toEqual({
      amount: 50,
      assetGuid: 'zero-decimal-asset',
      decimals: 0,
      symbol: 'ZERO',
    });
  });
});
