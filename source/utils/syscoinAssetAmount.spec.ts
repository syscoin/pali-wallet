import {
  assertValidAssetAmount,
  isAssetAmountWithinBalance,
  toEightDecimalBuilderAmount,
} from './syscoinAssetAmount';

describe('Syscoin asset amount conversion', () => {
  it('converts zero-decimal NFT quantities to exact builder units', () => {
    expect(toEightDecimalBuilderAmount('1', 0)).toBe('0.00000001');
    expect(toEightDecimalBuilderAmount('25', 0)).toBe('0.00000025');
  });

  it('preserves eight-decimal fungible SPT amounts', () => {
    expect(toEightDecimalBuilderAmount('1.23000000', 8)).toBe('1.23000000');
  });

  it('supports native SPT precisions without using Number', () => {
    expect(toEightDecimalBuilderAmount('1.23', 2)).toBe('0.00000123');
    expect(toEightDecimalBuilderAmount('90071992.54740991', 8)).toBe(
      '90071992.54740991'
    );
  });

  it('compares large ERC-1155 balances without Number precision loss', () => {
    expect(
      isAssetAmountWithinBalance('9007199254740992', '9007199254740993', 0)
    ).toBe(true);
    expect(
      isAssetAmountWithinBalance('9007199254740994', '9007199254740993', 0)
    ).toBe(false);
  });

  it('rejects fractional NFT quantities and excess precision', () => {
    expect(() => assertValidAssetAmount('1.5', 0)).toThrow(
      'Amount supports at most 0 decimal places'
    );
    expect(() => assertValidAssetAmount('1.001', 2)).toThrow(
      'Amount supports at most 2 decimal places'
    );
  });

  it('rejects malformed, zero, and negative amounts', () => {
    for (const amount of ['', '0', '-1', '1e2', '1.2.3', '1'.repeat(21)]) {
      expect(() => assertValidAssetAmount(amount, 8)).toThrow();
    }
  });
});
