import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from 'pages/Home/Panel/components/Transactions/UTXO/history.fixtures';

import {
  getSyscoinAccountDelta,
  getSyscoinIntentAmount,
  getSyscoinTransactionTypeLabel,
} from './syscoinTransactionUtils';

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

  it('keeps a known bridge type separate from an absent account asset delta', () => {
    expect(
      getSyscoinTransactionTypeLabel(compactBridgeNativeOffset.tokenType)
    ).toBe('Bridge to NEVM');
    expect(getSyscoinIntentAmount(compactBridgeNativeOffset)).toBeNull();
    expect(getSyscoinAccountDelta(compactBridgeNativeOffset)).toBe(
      '2959851940'
    );
  });

  it('preserves the decimal-normalized amount of the compact account asset', () => {
    expect(getSyscoinIntentAmount(compactBridgeWithAccountAsset)).toEqual({
      amount: 0.1,
      assetGuid: '123456',
      decimals: 8,
      symbol: 'SYSX',
    });
  });
});

describe('getSyscoinAccountDelta', () => {
  it.each([
    ['100000226', '100000000', '226'],
    ['100000000', '100000226', '226'],
    ['100000000', '100000000', '0'],
    ['9007199254740993', '9007199254740992', '1'],
  ])('keeps the exact account delta %s - %s', (valueIn, valueOut, expected) => {
    expect(
      getSyscoinAccountDelta({
        addressValueIn: valueIn,
        addressValueOut: valueOut,
      })
    ).toBe(expected);
  });

  it('distinguishes missing or malformed account totals from a zero delta', () => {
    expect(getSyscoinAccountDelta({})).toBeNull();
    expect(getSyscoinAccountDelta({ addressValueIn: 'invalid' })).toBeNull();
  });
});
