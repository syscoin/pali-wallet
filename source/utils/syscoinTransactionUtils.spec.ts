import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from 'pages/Home/Panel/components/Transactions/UTXO/history.fixtures';

import {
  getSyscoinAccountDelta,
  getSyscoinAccountChange,
  getSyscoinNativeTransferAmount,
  getSyscoinIntentAmount,
  getSyscoinOperationAmount,
  getSyscoinActivityOperationAmount,
  getSyscoinTransactionTypeLabel,
} from './syscoinTransactionUtils';
import { getKnownTokenLogo, SYSX_ASSET_GUID } from './tokens';

describe('getSyscoinIntentAmount', () => {
  it.each(['syscoinburntoallocation', 'SPTSyscoinBurnToAssetAllocation'])(
    'binds the native burn operation %s to canonical SYSX without token metadata',
    (tokenType) => {
      const transaction = {
        tokenType,
        fees: '226',
        vin: [{ value: '300000226' }],
        vout: [
          { addresses: ['owned-change'], value: '100000000' },
          { addresses: ['OP_RETURN'], value: '200000000' },
        ],
      };
      const expected = {
        amount: 2,
        assetGuid: SYSX_ASSET_GUID,
        decimals: 8,
        symbol: 'SYSX',
      };

      expect(getSyscoinIntentAmount(transaction as any)).toEqual(expected);
      expect(getSyscoinOperationAmount(transaction)).toEqual({
        ...expected,
        scope: 'transaction',
      });
    }
  );

  it.each([undefined, ''])(
    'does not infer the canonical GUID from an ordinary SYSX symbol with GUID %s',
    (assetGuid) => {
      const transaction = {
        tokenType: 'SPTAssetAllocationSend',
        accountAssetTransfers: [
          { assetGuid, value: '200000000', decimals: 8, symbol: 'SYSX' },
        ],
      };
      const intent = getSyscoinIntentAmount(transaction);
      const operation = getSyscoinOperationAmount(transaction);

      expect(intent).toMatchObject({ amount: 2, decimals: 8, symbol: 'SYSX' });
      expect(operation).toMatchObject({ amount: 2, scope: 'account' });
      expect(intent?.assetGuid).not.toBe(SYSX_ASSET_GUID);
      expect(operation?.assetGuid).not.toBe(SYSX_ASSET_GUID);
      expect(
        getKnownTokenLogo(intent?.symbol, undefined, intent?.assetGuid)
      ).toBeNull();
    }
  );

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

describe('getSyscoinNativeTransferAmount', () => {
  const txid = 'ab'.repeat(32);
  const account = {
    txid,
    fees: '226',
    addressValueIn: '100000226',
    addressValueOut: '100000000',
    // These compact aliases must never be treated as full transaction totals.
    valueIn: '100000226',
    value: '100000000',
    vin: [],
    vout: [],
  };
  const full = {
    txid,
    fees: '226',
    vin: [{ value: '100000226' }],
    vout: [{ value: '100000000' }],
  };

  it('shows a self MAX output rather than its fee-sized account change', () => {
    expect(getSyscoinNativeTransferAmount(account)).toBeNull();
    expect(getSyscoinNativeTransferAmount(account, full)).toEqual({
      amount: '100000000',
      kind: 'self',
      outputTotal: false,
    });
  });
  it('totals external recipient outputs and excludes owned change when every input is owned', () => {
    expect(
      getSyscoinNativeTransferAmount(
        { ...account, addressValueOut: '30000000' },
        {
          ...full,
          vout: [
            { value: '20000000' },
            { value: '30000000' },
            { value: '50000000' },
          ],
        }
      )
    ).toEqual({ amount: '70000000', kind: 'external', direction: 'sent' });
  });
  it('marks a multi-output self transfer as an output total, not a guessed recipient amount', () => {
    expect(
      getSyscoinNativeTransferAmount(account, {
        ...full,
        vout: [{ value: '20000000' }, { value: '80000000' }],
      })
    ).toEqual({ amount: '100000000', kind: 'self', outputTotal: true });
  });
  it('can show an explicit receipt without requesting global transaction data', () => {
    expect(
      getSyscoinNativeTransferAmount({ ...account, addressValueIn: '0' })
    ).toEqual({
      amount: '100000000',
      kind: 'received',
      direction: 'received',
    });
    expect(
      getSyscoinNativeTransferAmount({ ...account, addressValueIn: undefined })
    ).toBeNull();
  });
  it('uses explicit account input ownership for a compact external spend', () => {
    expect(
      getSyscoinNativeTransferAmount({
        ...account,
        accountOwnsAllInputs: true,
        addressValueOut: '30000000',
        direction: 'received',
      })
    ).toEqual({ amount: '70000000', direction: 'sent', kind: 'external' });
  });
  it('uses compact ownership for a self output total without guessing output count', () => {
    expect(
      getSyscoinNativeTransferAmount({ ...account, accountOwnsAllInputs: true })
    ).toEqual({ amount: '100000000', kind: 'self', outputTotal: true });
  });
  it.each([undefined, false, 'true', 1, null])(
    'does not replace ownership evidence with a truthy flag %j or direction',
    (accountOwnsAllInputs) => {
      expect(
        getSyscoinNativeTransferAmount({
          ...account,
          accountOwnsAllInputs,
          direction: 'sent',
        })
      ).toBeNull();
    }
  );
  it.each([
    { fees: undefined },
    { fees: '-1' },
    { fees: '0.5' },
    { addressValueOut: '100000001' },
    { addressValueIn: '226', addressValueOut: '0' },
    { addressValueIn: Number.MAX_SAFE_INTEGER + 1 },
    { addressValueOut: '1e8' },
  ])('rejects inconsistent compact amounts %j', (changes) => {
    expect(
      getSyscoinNativeTransferAmount({
        ...account,
        accountOwnsAllInputs: true,
        ...changes,
      })
    ).toBeNull();
  });
  it('does not borrow ownership from cached chain details', () => {
    expect(
      getSyscoinNativeTransferAmount(account, {
        ...account,
        accountOwnsAllInputs: true,
      })
    ).toBeNull();
  });
  it('does not let a compact flag override contradictory or partial full details', () => {
    const owned = { ...account, accountOwnsAllInputs: true };
    expect(
      getSyscoinNativeTransferAmount(owned, { ...full, fees: '227' })
    ).toBeNull();
    expect(
      getSyscoinNativeTransferAmount(owned, { ...full, vout: [] })
    ).toBeNull();
    expect(
      getSyscoinNativeTransferAmount(owned, { ...full, vin: null, vout: null })
    ).toBeNull();
  });
  it('keeps compact atomic amounts exact beyond safe JavaScript integers', () => {
    expect(
      getSyscoinNativeTransferAmount({
        ...account,
        accountOwnsAllInputs: true,
        fees: '1',
        addressValueIn: '9007199254740993',
        addressValueOut: '9007199254740992',
      })
    ).toEqual({ amount: '9007199254740992', kind: 'self', outputTotal: true });
  });
  it.each([
    [{ addressValueIn: '50000000' }, {}],
    [{ addressValueOut: '100000001' }, {}],
    [{ addressValueIn: '0', addressValueOut: '0' }, {}],
    [{ addressValueIn: undefined }, {}],
    [{}, { txid: 'cd'.repeat(32) }],
    [{}, { fees: '227' }],
    [{}, { vin: [{ value: '-1' }] }],
    [{}, { vin: [{ value: '100000226' }, { value: '0' }] }],
    [{}, { vin: [{ value: Number.MAX_SAFE_INTEGER + 1 }] }],
    [{}, { vout: [{}] }],
    [{ tokenType: 'SPTAssetAllocationSend' }, {}],
  ])(
    'does not guess a mixed, missing or inconsistent native transfer %j %j',
    (summaryChanges, fullChanges) => {
      expect(
        getSyscoinNativeTransferAmount(
          { ...account, ...summaryChanges },
          { ...full, ...fullChanges }
        )
      ).toBeNull();
    }
  );
  it('keeps atomic output totals exact beyond Number.MAX_SAFE_INTEGER', () => {
    expect(
      getSyscoinNativeTransferAmount(
        {
          ...account,
          addressValueIn: '9007199254740993',
          addressValueOut: '9007199254740992',
        },
        {
          ...full,
          fees: '1',
          vin: [{ value: '9007199254740993' }],
          vout: [{ value: '9007199254740992' }],
        }
      )
    ).toMatchObject({ amount: '9007199254740992', kind: 'self' });
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

  it.each([
    ['100000226', '100000000', '-226'],
    ['100000000', '100000226', '226'],
    ['100000000', '100000000', '0'],
    ['9007199254740993', '9007199254740992', '-1'],
  ])(
    'keeps the signed native account change independent of token direction',
    (addressValueIn, addressValueOut, expected) => {
      expect(getSyscoinAccountChange({ addressValueIn, addressValueOut })).toBe(
        expected
      );
    }
  );
});

describe('getSyscoinOperationAmount', () => {
  it('uses full bridge burn semantics ahead of native funding or account asset deltas', () => {
    const full = {
      ...compactBridgeNativeOffset,
      vout: [
        {
          addresses: ['OP_RETURN'],
          value: '0',
          assetInfo: { assetGuid: '123456', value: '100000000' },
        },
      ],
      tokenTransfers: [{ token: '123456', symbol: 'SYSX', decimals: 8 }],
    };
    expect(getSyscoinOperationAmount(full)).toMatchObject({
      amount: 1,
      symbol: 'SYSX',
      scope: 'transaction',
    });
    expect(getSyscoinOperationAmount(compactBridgeNativeOffset)).toBeNull();
    expect(getSyscoinOperationAmount(compactBridgeWithAccountAsset)).toBeNull();
  });

  it('preserves an ordinary SPT account transfer and does not pick an unrelated first asset output', () => {
    expect(
      getSyscoinOperationAmount({
        ...compactBridgeWithAccountAsset,
        tokenType: 'SPTAssetAllocationSend',
      })
    ).toMatchObject({ amount: 0.1, scope: 'account' });
    expect(
      getSyscoinOperationAmount({
        tokenType: 'SPTAssetAllocationSend',
        vout: [{ assetInfo: { assetGuid: '999', value: '999999999' } }],
      })
    ).toBeNull();
  });

  it('uses the burned output and its metadata, not unrelated asset change or the funding account amount', () => {
    expect(
      getSyscoinOperationAmount({
        tokenType: 'SPTAssetAllocationBurnToNEVM',
        accountAssetTransfers: [
          { assetGuid: 'burned', value: '100', decimals: 2, symbol: 'BURN' },
        ],
        vout: [
          {
            addresses: ['change'],
            assetInfo: { assetGuid: 'unrelated', value: '99999999' },
          },
          {
            addresses: ['OP_RETURN'],
            assetInfo: { assetGuid: 'burned', value: '500' },
          },
        ],
      })
    ).toMatchObject({
      amount: 5,
      symbol: 'BURN',
      decimals: 2,
      scope: 'transaction',
    });
  });

  it('does not select the first of multiple unrelated mint assets', () => {
    expect(
      getSyscoinOperationAmount({
        tokenType: 'SPTAssetAllocationMint',
        vout: [
          { assetInfo: { assetGuid: 'first', value: '100000000' } },
          { assetInfo: { assetGuid: 'second', value: '200000000' } },
        ],
      })
    ).toBeNull();
  });

  it('rejects multiple burn outputs rather than taking the first one', () => {
    expect(
      getSyscoinOperationAmount({
        ...compactBridgeWithAccountAsset,
        vout: ['10000000', '20000000'].map((value) => ({
          addresses: ['OP_RETURN'],
          assetInfo: { assetGuid: '123456', value },
        })),
      })
    ).toBeNull();
  });

  it('uses minted asset net and native conversion amount without native-account attribution', () => {
    expect(
      getSyscoinOperationAmount({
        tokenType: 'SPTAssetAllocationMint',
        vin: [{ assetInfo: { assetGuid: 'minted', value: '100000000' } }],
        vout: [{ assetInfo: { assetGuid: 'minted', value: '300000000' } }],
        tokenTransfers: [{ token: 'minted', decimals: 8, symbol: 'MINT' }],
      })
    ).toMatchObject({ amount: 2, symbol: 'MINT', scope: 'transaction' });
    expect(
      getSyscoinOperationAmount({
        tokenType: 'SPTSyscoinBurnToAssetAllocation',
        vout: [{ addresses: ['OP_RETURN'], value: '300000000' }],
      })
    ).toMatchObject({ amount: 3, symbol: 'SYSX', scope: 'transaction' });
  });

  it('keeps SPT receive direction independent of native funding', () => {
    expect(
      getSyscoinOperationAmount({
        ...compactBridgeWithAccountAsset,
        tokenType: 'SPTAssetAllocationSend',
        direction: 'sent',
        accountAssetTransfers: [
          {
            assetGuid: '123456',
            value: '10000000',
            decimals: 8,
            symbol: 'SYSX',
          },
        ],
        vout: [
          {
            isOwn: true,
            assetInfo: { assetGuid: '123456', value: '10000000' },
          },
        ],
      })
    ).toMatchObject({ amount: 0.1, direction: 'received', scope: 'account' });
  });

  it.each(['sent', 'received'])(
    'does not infer SPT direction from an absolute account amount or native %s direction',
    (nativeDirection) => {
      expect(
        getSyscoinOperationAmount({
          ...compactBridgeWithAccountAsset,
          tokenType: 'SPTAssetAllocationSend',
          direction: nativeDirection,
        })
      ).toMatchObject({ amount: 0.1, direction: undefined, scope: 'account' });
    }
  );
});

describe('getSyscoinActivityOperationAmount', () => {
  it.each(['SPTAssetAllocationBurnToSyscoin', 'SPTAssetAllocationMint'])(
    'shows the supplied compact account asset quantity for %s without a detail read',
    (tokenType) => {
      const transaction = {
        ...compactBridgeWithAccountAsset,
        tokenType,
        direction: 'received',
        // These are duplicate account summaries, not two operation amounts.
        tokenTransfers: compactBridgeWithAccountAsset.accountAssetTransfers,
      };
      expect(getSyscoinActivityOperationAmount(transaction)).toEqual({
        amount: 0.1,
        assetGuid: '123456',
        decimals: 8,
        symbol: 'SYSX',
        direction: undefined,
        scope: 'account',
      });
    }
  );
  it('keeps the operation decoder strict while Activity uses an available account quantity', () => {
    expect(getSyscoinOperationAmount(compactBridgeWithAccountAsset)).toBeNull();
    expect(
      getSyscoinActivityOperationAmount(compactBridgeWithAccountAsset)
    ).toMatchObject({ amount: 0.1, scope: 'account' });
    expect(
      getSyscoinActivityOperationAmount(compactBridgeNativeOffset)
    ).toBeNull();
  });
  it('prefers full burned amount over a smaller account contribution', () => {
    expect(
      getSyscoinActivityOperationAmount(compactBridgeWithAccountAsset, {
        ...compactBridgeWithAccountAsset,
        vout: [
          {
            addresses: ['OP_RETURN'],
            assetInfo: { assetGuid: '123456', value: '200000000' },
          },
        ],
      })
    ).toMatchObject({ amount: 2, scope: 'transaction' });
  });
  it.each([
    { value: '0' },
    { value: 'NaN' },
    { value: '1e8' },
    { value: '0.1' },
    { value: Number.MAX_SAFE_INTEGER + 1 },
    { decimals: -1 },
    { decimals: 9 },
    { decimals: 1.1 },
    { decimals: undefined },
    { assetGuid: '', token: undefined, contract: undefined },
  ])(
    'leaves genuinely unavailable or malformed asset quantities unresolved %j',
    (changes) => {
      expect(
        getSyscoinActivityOperationAmount({
          ...compactBridgeWithAccountAsset,
          accountAssetTransfers: [
            {
              ...compactBridgeWithAccountAsset.accountAssetTransfers![0],
              ...changes,
            },
          ],
        })
      ).toBeNull();
    }
  );
  it('does not pick one of several account assets as a bridge operation', () => {
    expect(
      getSyscoinActivityOperationAmount({
        ...compactBridgeWithAccountAsset,
        accountAssetTransfers: [
          ...compactBridgeWithAccountAsset.accountAssetTransfers!,
          { assetGuid: 'other', value: '900000000', decimals: 8 },
        ],
      })
    ).toBeNull();
  });
});
