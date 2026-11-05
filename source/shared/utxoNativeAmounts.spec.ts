import * as legacy from '../utils/syscoinTransactionUtils';

import {
  getSyscoinAccountChange,
  getSyscoinAccountDelta,
  getSyscoinNativeTransferAmount,
  isSyscoinTokenOperation,
  normalizeSyscoinTransactionType,
} from './utxoNativeAmounts';

const TXID = 'ab'.repeat(32);
const account = {
  txid: TXID,
  addressValueIn: '900719925474099300000',
  addressValueOut: '7',
};
const full = {
  txid: TXID,
  fees: '1',
  vin: [{ value: '900719925474099300000' }],
  vout: [{ value: '7' }, { value: '900719925474099299992' }],
};

it('the existing extension entry re-exports these exact functions', () => {
  for (const name of [
    'getSyscoinAccountDelta',
    'getSyscoinAccountChange',
    'getSyscoinNativeTransferAmount',
    'isSyscoinTokenOperation',
    'normalizeSyscoinTransactionType',
  ] as const) {
    expect(legacy[name]).toBe(
      {
        getSyscoinAccountDelta,
        getSyscoinAccountChange,
        getSyscoinNativeTransferAmount,
        isSyscoinTokenOperation,
        normalizeSyscoinTransactionType,
      }[name]
    );
  }
});
it('preserves exact native account movement above Number precision and separate transfer intent', () => {
  expect(getSyscoinAccountChange(account)).toBe('-900719925474099299993');
  expect(getSyscoinAccountDelta(account)).toBe('900719925474099299993');
  expect(getSyscoinNativeTransferAmount(account, full)).toEqual({
    amount: '900719925474099299992',
    direction: 'sent',
    kind: 'external',
  });
  expect(
    getSyscoinAccountChange({
      addressValueIn: '0',
      addressValueOut: '900719925474099300000',
    })
  ).toBe('900719925474099300000');
});
it('retains the distinction between loose absolute delta and required signed-account totals', () => {
  expect(getSyscoinAccountDelta({ addressValueIn: '7' })).toBe('7');
  expect(getSyscoinAccountChange({ addressValueIn: '7' })).toBeNull();
  expect(getSyscoinAccountDelta({})).toBeNull();
  expect(getSyscoinAccountDelta({ addressValueIn: 'bad' })).toBeNull();
  expect(
    getSyscoinAccountChange({ addressValueIn: '-7', addressValueOut: '0' })
  ).toBeNull();
});
it('handles received and self amounts without calling a native account delta a sent amount', () => {
  expect(
    getSyscoinNativeTransferAmount({
      txid: TXID,
      addressValueIn: '0',
      addressValueOut: '300',
    })
  ).toEqual({ amount: '300', direction: 'received', kind: 'received' });
  const self = { ...account, addressValueOut: '900719925474099299999' };
  expect(getSyscoinNativeTransferAmount(self, full)).toEqual({
    amount: '900719925474099299999',
    kind: 'self',
    outputTotal: true,
  });
  expect(getSyscoinAccountChange(self)).toBe('-1');
});
it('keeps missing, mismatched, collaborative and nonconserved native intent unavailable', () => {
  const variants = [
    {},
    { ...full, txid: 'cd'.repeat(32) },
    { ...full, vin: [...full.vin, { value: '100' }] },
    { ...full, vin: [...full.vin, { value: '0' }] },
    { ...full, fees: '2' },
    { ...full, vin: [{ value: Number.MAX_SAFE_INTEGER + 1 }] },
  ];
  for (const value of variants)
    expect(getSyscoinNativeTransferAmount(account, value)).toBeNull();
  expect(getSyscoinNativeTransferAmount(null)).toBeNull();
  expect(
    getSyscoinNativeTransferAmount({ ...account, txid: 'not-a-hash' }, full)
  ).toBeNull();
});
it.each([
  'assetallocation_send',
  'SPTAssetAllocationSend',
  'assetallocationsend',
])('retains normalization and token/native separation for %s', (kind) => {
  expect(normalizeSyscoinTransactionType(kind)).toBe('assetallocationsend');
  expect(isSyscoinTokenOperation({ tokenType: kind })).toBe(true);
  expect(
    getSyscoinNativeTransferAmount({ ...account, tokenType: kind }, full)
  ).toBeNull();
});
it('detects asset-bearing records independently from native funding and leaves NEVM data alone', () => {
  expect(isSyscoinTokenOperation({ tokenType: 'nevmdata' })).toBe(false);
  for (const value of [
    { accountAssetTransfers: [{}] },
    { tokenTransfers: [{}] },
    { vin: [{ assetInfo: {} }] },
    { vout: [{ assetInfo: {} }] },
  ]) {
    expect(isSyscoinTokenOperation(value)).toBe(true);
    expect(
      getSyscoinNativeTransferAmount(account, { ...full, ...value })
    ).toBeNull();
  }
});
