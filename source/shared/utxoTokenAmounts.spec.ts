/** @jest-environment node */
import { BigNumber } from '../utils/ethersV6Compat';

import {
  formatSyscoinTokenAmount,
  getSyscoinActivityOperationAmount,
  getSyscoinIntentAmount,
  getSyscoinOperationAmount,
} from './utxoTokenAmounts';

const compact = (value: unknown, decimals = 0) => ({
  tokenType: 'SPTAssetAllocationSend',
  accountAssetTransfers: [
    { assetGuid: 'asset', value, decimals, symbol: 'BIG' },
  ],
});
const owned = (
  input: string,
  output: string,
  tokenType = 'SPTAssetAllocationSend'
) => ({
  tokenType,
  tokenTransfers: [{ token: 'asset', decimals: 0, symbol: 'BIG' }],
  vin: [{ isOwn: true, assetInfo: { assetGuid: 'asset', value: input } }],
  vout: [
    {
      isOwn: true,
      addresses: ['owned'],
      assetInfo: { assetGuid: 'asset', value: output },
    },
  ],
});

test.each([
  '9007199254740993',
  '115792089237316195423570985008687907853269984665640564039457584007913129639935',
])('retains exact large integer amount %s', (value) => {
  expect(getSyscoinIntentAmount(compact(value) as any)).toMatchObject({
    amount: value,
  });
  expect(formatSyscoinTokenAmount(value, 0)).toBe(value);
});
test.each(Array.from({ length: 9 }, (_, d) => d))(
  'uses the existing protocol precision %s exactly',
  (d) => {
    const expected = d === 0 ? '123456789' : `1.${'0'.repeat(d - 1)}1`;
    const raw = d === 0 ? '123456789' : String(10 ** d + 1);
    expect(getSyscoinIntentAmount(compact(raw, d) as any)?.amount).toBe(
      expected
    );
  }
);
test('compares different decimal precisions without rounding away a winning atom', () => {
  const tx = compact('9007199254740992');
  tx.accountAssetTransfers.push({
    assetGuid: 'larger',
    value: '900719925474099300000000',
    decimals: 8,
    symbol: 'LARGE',
  });
  expect(getSyscoinIntentAmount(tx as any)).toMatchObject({
    amount: '9007199254740993',
    assetGuid: 'larger',
  });
});
test.each([
  ['9007199254740992', '9007199254740993', 'received'],
  ['9007199254740993', '9007199254740992', 'sent'],
])(
  'derives exact net and direction between %s and %s',
  (input, output, direction) => {
    expect(getSyscoinOperationAmount(owned(input, output))).toMatchObject({
      amount: '1',
      direction,
      scope: 'account',
    });
  }
);
test('preserves minted transaction semantics with exact near-cancelling totals', () => {
  const result = getSyscoinOperationAmount(
    owned('9007199254740992', '9007199254740993', 'SPTAssetAllocationMint')
  );
  expect(result).toMatchObject({ amount: '1', scope: 'transaction' });
  expect(result?.direction).toBeUndefined();
});
test('sums multiple exact values and ranks account deltas by exact normalized value', () => {
  const tx = owned('9007199254740992', '9007199254740993');
  tx.vout.push({
    isOwn: true,
    addresses: ['owned'],
    assetInfo: { assetGuid: 'other', value: '2' },
  });
  expect(getSyscoinOperationAmount(tx)).toMatchObject({
    amount: '1',
    assetGuid: 'asset',
  }); // other defaults to eight decimals
});
test('preserves valueStr precedence and the supported optional symbol suffix', () => {
  const tx = owned('0', '999');
  tx.tokenTransfers[0].decimals = 2;
  Object.assign(tx.vout[0].assetInfo, { valueStr: '9007199254740993.12 BIG' });
  expect(getSyscoinOperationAmount(tx)).toMatchObject({
    amount: '9007199254740993.12',
    direction: 'received',
  });
});
test.each([
  { value: '' },
  { value: '1e8' },
  { value: '0x01' },
  { value: ' 1 ' },
  { value: '9'.repeat(79) },
  { value: Number.MAX_SAFE_INTEGER + 1 },
  { decimals: -1 },
  { decimals: 9 },
  { decimals: 1.5 },
  { decimals: 1000000000 },
])('leaves malformed or unbounded compact input unavailable %j', (change) => {
  const tx = compact('1');
  Object.assign(tx.accountAssetTransfers[0], change);
  expect(getSyscoinIntentAmount(tx as any)).toBeNull();
  expect(getSyscoinActivityOperationAmount(tx)).toBeNull();
});
test.each(['1.123 BIG', '1foo', '1e3 BIG', 'Infinity', '9'.repeat(300)])(
  'does not substitute zero/raw for invalid preferred valueStr %s',
  (valueStr) => {
    const tx = owned('0', '100');
    tx.tokenTransfers[0].decimals = 2;
    Object.assign(tx.vout[0].assetInfo, { valueStr });
    expect(getSyscoinOperationAmount(tx)).toBeNull();
  }
);
test.each([
  ['0.00000001', 8, '0.00000001'],
  ['0.00009999', 8, '0.00009999'],
  ['0.0001', 8, '0.000100'],
  ['0.99999999', 8, '1.000000'],
  ['1.00005', 8, '1.0001'],
  ['1.005', 2, '1.01'],
  ['123', 0, '123'],
  ['9007199254740993.12345678', 8, '9007199254740993.1235'],
])(
  'formats %s with the existing display precision choice exactly',
  (value, d, expected) => {
    expect(formatSyscoinTokenAmount(value, Number(d))).toBe(expected);
  }
);
test.each(['NaN', 'Infinity', '1e20', '-1', '1.000000001', '9'.repeat(257)])(
  'returns unavailable for invalid display value %s',
  (value) => {
    expect(formatSyscoinTokenAmount(value, 8)).toBeNull();
  }
);

it('rejects oversized text and invalid precision before arbitrary-precision work', () => {
  const parse = jest.spyOn(BigNumber, 'from');
  try {
    expect(
      getSyscoinActivityOperationAmount(compact('9'.repeat(100000)))
    ).toBeNull();
    expect(
      getSyscoinActivityOperationAmount(compact('1', 1000000000))
    ).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});
