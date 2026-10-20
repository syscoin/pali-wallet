import { getCustomFeeGwei, getFeePresetGwei } from './customFee';

describe('custom GWEI representation', () => {
  it.each([
    ['0.000000001', 0.000000001],
    ['1e-9', 0.000000001],
    ['1.000000001', 1.000000001],
    ['3.5000000010', 3.500000001],
    ['100000000000000000000', 1e20],
  ])('preserves exact integer wei for %s', (input, expected) => {
    expect(getCustomFeeGwei(input)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '-1',
    '0.0000000001',
    '1.0000000001',
    '9007199.254740991',
    '1000000000000000000000',
    '1e309',
    '0x10',
    NaN,
    Infinity,
    null,
    undefined,
  ])('rejects invalid or lossy price %s', (input) => {
    expect(getCustomFeeGwei(input)).toBeNull();
  });

  it('allows exactly zero only for a priority fee', () => {
    expect(getCustomFeeGwei('0', true)).toBe(0);
    expect(getCustomFeeGwei('0')).toBeNull();
    expect(getCustomFeeGwei('0.0000000001', true)).toBeNull();
    expect(getCustomFeeGwei('1e-10000001', true)).toBeNull();
  });

  it.each([
    [3.000000001, 2, '3.600000001'],
    [3.5, 2, '4.2'],
    [3.5, 0, '2.8'],
    [0.000000001, 2, '0.000000001'],
    [0.000000003, 2, '0.000000004'],
    [0, 2, '0'],
  ])(
    'rounds the %s GWEI preset %s once to integer wei',
    (quote, priority, expected) => {
      const preset = getFeePresetGwei(quote as number, priority as number);
      expect(preset).toBe(expected);
      expect(getCustomFeeGwei(preset, quote === 0)).toBe(Number(expected));
    }
  );
});
