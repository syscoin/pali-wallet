import { privacyFeeQuantity, privacyWithdrawalFees } from './withdrawalFees';

test('fixed withdrawal gas quote uses exact arithmetic and sufficient sender funds', () => {
  expect(
    privacyWithdrawalFees(
      { maxFeePerGas: BigInt(10), maxPriorityFeePerGas: BigInt(1) },
      7,
      BigInt(6500000)
    )
  ).toEqual({
    gasLimit: '650000',
    nonce: '7',
    maxFeePerGas: '10',
    maxPriorityFeePerGas: '1',
  });
  expect(
    privacyWithdrawalFees({ gasPrice: BigInt(3) }, '0x8', BigInt(1950000))
  ).toEqual({ gasLimit: '650000', nonce: '8', gasPrice: '3' });
});

test.each([
  undefined,
  null,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
  '01',
  '-1',
  '1.0',
  '1e3',
  '0x01',
  (BigInt(1) << BigInt(256)).toString(),
])('rejects malformed fee quantity %p', (value) => {
  expect(() => privacyFeeQuantity(value)).toThrow(
    'privacy_withdrawal_fee_invalid'
  );
});

test('rejects inadequate funds and invalid fee pairs without fallback estimates', () => {
  expect(() => privacyWithdrawalFees({ gasPrice: 1 }, 0, 649999)).toThrow(
    'privacy_withdrawal_insufficient_funds'
  );
  expect(() =>
    privacyWithdrawalFees(
      { maxFeePerGas: 1, maxPriorityFeePerGas: 2 },
      0,
      650000
    )
  ).toThrow('privacy_withdrawal_fee_invalid');
  expect(() => privacyWithdrawalFees({}, 0, 650000)).toThrow(
    'privacy_withdrawal_fee_invalid'
  );
  expect(() => privacyWithdrawalFees({ gasPrice: 0 }, 0, 650000)).toThrow(
    'privacy_withdrawal_fee_invalid'
  );
});
