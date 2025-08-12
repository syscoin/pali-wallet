// Don't mock @ethersproject packages since BigNumber needs them
import { BigNumber } from '@ethersproject/bignumber';

import {
  safeBigNumber,
  canConvertToBigNumber,
} from '../../source/utils/safeBigNumber';

describe('safeBigNumber', () => {
  describe('Valid inputs', () => {
    it('should handle BigNumber input', () => {
      const bn = BigNumber.from(1234);
      const result = safeBigNumber(bn);
      expect(result.toString()).toBe('1234');
    });

    it('should handle hex string input', () => {
      const result = safeBigNumber('0x1234');
      expect(result.toString()).toBe('4660');
    });

    it('should handle decimal string input', () => {
      const result = safeBigNumber('1234');
      expect(result.toString()).toBe('1234');
    });

    it('should handle zero', () => {
      expect(safeBigNumber(0).toString()).toBe('0');
      expect(safeBigNumber('0').toString()).toBe('0');
      expect(safeBigNumber('0x0').toString()).toBe('0');
    });

    it('should handle negative numbers', () => {
      const result = safeBigNumber(-1234);
      expect(result.toString()).toBe('-1234');
    });

    it('should handle negative strings', () => {
      const result = safeBigNumber('-1234');
      expect(result.toString()).toBe('-1234');
    });

    it('should handle numbers outside JavaScript safe integer range', () => {
      // This number is 10^16, which is outside safe integer range
      const largeNumber = 10000000000000000;
      const result = safeBigNumber(largeNumber);
      expect(result.toString()).toBe('10000000000000000');
    });

    it('should handle very large string numbers', () => {
      const veryLarge =
        '115792089237316195423570985008687907853269984665640564039457584007913129639935';
      const result = safeBigNumber(veryLarge);
      expect(result.toString()).toBe(veryLarge);
    });

    it('should handle objects with hex property', () => {
      const obj = { hex: '0x1234' };
      const result = safeBigNumber(obj);
      expect(result.toString()).toBe('4660');
    });

    it('should handle objects with _hex property (ethers BigNumber-like)', () => {
      const obj = { _hex: '0x1234' };
      const result = safeBigNumber(obj);
      expect(result.toString()).toBe('4660');
    });

    it('should handle decimal numbers by truncating them', () => {
      expect(safeBigNumber(1.5).toString()).toBe('1');
      expect(safeBigNumber(2.9).toString()).toBe('2');
      expect(safeBigNumber(-1.5).toString()).toBe('-1');
      expect(safeBigNumber(-2.9).toString()).toBe('-2');
    });

    it('should handle string decimals by truncating them', () => {
      expect(safeBigNumber('1.23232223').toString()).toBe('1');
      expect(safeBigNumber('123.456').toString()).toBe('123');
      expect(safeBigNumber('0.1').toString()).toBe('0');
      expect(safeBigNumber('0.999').toString()).toBe('0');
      expect(safeBigNumber('-1.5').toString()).toBe('-1');
      expect(safeBigNumber('1000000.123456789').toString()).toBe('1000000');
      expect(safeBigNumber('.5').toString()).toBe('0');
      expect(safeBigNumber('-.5').toString()).toBe('0');
      expect(
        safeBigNumber('12345.67890123456789012345678901234567890').toString()
      ).toBe('12345');
    });

    it('should handle trimming whitespace from strings', () => {
      const result = safeBigNumber('  1234  ');
      expect(result.toString()).toBe('1234');
      const result2 = safeBigNumber('\n\t  -5678  \n');
      expect(result2.toString()).toBe('-5678');
    });
  });

  describe('Invalid inputs with fallback', () => {
    it('should use fallback for null', () => {
      const result = safeBigNumber(null, '100');
      expect(result.toString()).toBe('100');
    });

    it('should use fallback for undefined', () => {
      const result = safeBigNumber(undefined, BigNumber.from(200));
      expect(result.toString()).toBe('200');
    });

    it('should use fallback for empty string', () => {
      const result = safeBigNumber('', '0');
      expect(result.toString()).toBe('0');
    });

    it('should use fallback for invalid hex', () => {
      const result = safeBigNumber('0xGGG', '0');
      expect(result.toString()).toBe('0');
    });

    it('should use fallback for NaN', () => {
      const result = safeBigNumber(NaN, '0');
      expect(result.toString()).toBe('0');
    });

    it('should use fallback for Infinity', () => {
      const result = safeBigNumber(Infinity, '0');
      expect(result.toString()).toBe('0');
    });

    it('should use fallback for invalid number strings', () => {
      const result = safeBigNumber('abc123', '0');
      expect(result.toString()).toBe('0');
    });

    it('should use fallback with BigNumber', () => {
      const fallback = BigNumber.from(999);
      const result = safeBigNumber(null, fallback);
      expect(result.toString()).toBe('999');
    });
  });

  describe('Invalid inputs without fallback', () => {
    it('should throw for null without fallback', () => {
      expect(() => safeBigNumber(null)).toThrow('Value is null or undefined');
    });

    it('should throw for undefined without fallback', () => {
      expect(() => safeBigNumber(undefined)).toThrow(
        'Value is null or undefined'
      );
    });

    it('should throw for empty string without fallback', () => {
      expect(() => safeBigNumber('')).toThrow('Empty string value');
    });

    it('should throw for invalid hex without fallback', () => {
      expect(() => safeBigNumber('0xGGG')).toThrow('Invalid hex string');
    });

    it('should throw for NaN without fallback', () => {
      expect(() => safeBigNumber(NaN)).toThrow(
        'Invalid number: NaN (not finite)'
      );
    });

    it('should throw for Infinity without fallback', () => {
      expect(() => safeBigNumber(Infinity)).toThrow(
        'Invalid number: Infinity (not finite)'
      );
    });

    it('should throw for invalid number strings without fallback', () => {
      expect(() => safeBigNumber('abc123')).toThrow('Invalid number format');
    });
  });

  describe('Context messages', () => {
    it('should include context in error messages', () => {
      expect(() => safeBigNumber(null, undefined, 'gas price')).toThrow(
        'gas price: Value is null or undefined'
      );
    });

    it('should include context in console warnings', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      // Use an invalid hex string to trigger the catch block with fallback
      safeBigNumber('0xGGG', '0', 'test context');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('test context'),
        expect.any(String)
      );
      warnSpy.mockRestore();
    });
  });

  describe('Edge cases', () => {
    it('should handle max uint256', () => {
      const maxUint256 =
        '115792089237316195423570985008687907853269984665640564039457584007913129639935';
      const result = safeBigNumber(maxUint256);
      expect(result.toString()).toBe(maxUint256);
    });

    it('should handle scientific notation strings', () => {
      const result = safeBigNumber('1e18');
      expect(result.toString()).toBe('1000000000000000000');
    });

    it('should handle multiple decimal points as invalid', () => {
      expect(() => safeBigNumber('1.2.3')).toThrow('Invalid number format');
    });

    it('should handle leading zeros in strings', () => {
      const result = safeBigNumber('00001234');
      expect(result.toString()).toBe('1234');
    });

    it('should handle hex with leading zeros', () => {
      const result = safeBigNumber('0x00001234');
      expect(result.toString()).toBe('4660');
    });
  });
});

describe('canConvertToBigNumber', () => {
  it('should return true for valid inputs', () => {
    expect(canConvertToBigNumber('1234')).toBe(true);
    expect(canConvertToBigNumber(1234)).toBe(true);
    expect(canConvertToBigNumber('0x1234')).toBe(true);
    expect(canConvertToBigNumber(BigNumber.from(1234))).toBe(true);
    expect(canConvertToBigNumber({ hex: '0x1234' })).toBe(true);
    expect(canConvertToBigNumber({ _hex: '0x1234' })).toBe(true);
  });

  it('should return false for invalid inputs', () => {
    expect(canConvertToBigNumber(null)).toBe(false);
    expect(canConvertToBigNumber(undefined)).toBe(false);
    expect(canConvertToBigNumber('')).toBe(false);
    expect(canConvertToBigNumber('abc')).toBe(false);
    expect(canConvertToBigNumber(NaN)).toBe(false);
    expect(canConvertToBigNumber(Infinity)).toBe(false);
    expect(canConvertToBigNumber({})).toBe(false);
  });

  it('should handle objects with hex property', () => {
    expect(canConvertToBigNumber({ hex: '0x1234' })).toBe(true);
    expect(canConvertToBigNumber({ hex: 'invalid' })).toBe(false);
  });

  it('should handle numbers outside safe range', () => {
    // This is the key test for the bug fix
    expect(canConvertToBigNumber(10000000000000000)).toBe(true);
    expect(canConvertToBigNumber(Number.MAX_SAFE_INTEGER + 1)).toBe(true);
  });
});
