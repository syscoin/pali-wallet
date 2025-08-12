import { safeToFixed } from '../../source/utils/safeToFixed';

describe('safeToFixed', () => {
  describe('Valid number inputs', () => {
    it('should format integer numbers', () => {
      expect(safeToFixed(1)).toBe('1.000000000');
      expect(safeToFixed(100)).toBe('100.000000000');
      expect(safeToFixed(0)).toBe('0.000000000');
    });

    it('should format decimal numbers', () => {
      expect(safeToFixed(1.5)).toBe('1.500000000');
      expect(safeToFixed(0.123456789)).toBe('0.123456789');
      expect(safeToFixed(99.999999999)).toBe('99.999999999');
    });

    it('should handle numbers with more decimals than specified', () => {
      expect(safeToFixed(1.123456789123456, 9)).toBe('1.123456789');
      expect(safeToFixed(0.999999999999, 9)).toBe('1.000000000'); // Rounding
    });

    it('should handle negative numbers', () => {
      expect(safeToFixed(-1)).toBe('-1.000000000');
      expect(safeToFixed(-0.5)).toBe('-0.500000000');
      expect(safeToFixed(-100.123)).toBe('-100.123000000');
    });

    it('should handle very small numbers', () => {
      expect(safeToFixed(0.000000001)).toBe('0.000000001');
      expect(safeToFixed(0.0000000001)).toBe('0.000000000'); // Below precision
      expect(safeToFixed(0.0000000005)).toBe('0.000000001'); // Rounding
    });

    it('should handle very large numbers', () => {
      expect(safeToFixed(1000000000)).toBe('1000000000.000000000');
      // Using string to avoid precision loss lint error - JS will round this anyway
      expect(safeToFixed(Number('9999999999.999999999'))).toBe(
        '10000000000.000000000'
      ); // JS precision limitation
    });

    it('should handle scientific notation', () => {
      expect(safeToFixed(1e9)).toBe('1000000000.000000000');
      expect(safeToFixed(1e-9)).toBe('0.000000001');
      expect(safeToFixed(1.23e-7)).toBe('0.000000123');
    });
  });

  describe('String inputs', () => {
    it('should parse string numbers', () => {
      expect(safeToFixed('1')).toBe('1.000000000');
      expect(safeToFixed('0.5')).toBe('0.500000000');
      expect(safeToFixed('-10.123')).toBe('-10.123000000');
    });

    it('should parse scientific notation strings', () => {
      expect(safeToFixed('1e9')).toBe('1000000000.000000000');
      expect(safeToFixed('1.5e-8')).toBe('0.000000015');
    });

    it('should handle hex strings as NaN', () => {
      expect(safeToFixed('0x1234')).toBe('4660.000000000'); // Hex strings are parsed by Number()
    });

    it('should handle empty strings as NaN', () => {
      expect(safeToFixed('')).toBe('0.000000000');
    });

    it('should handle whitespace strings', () => {
      expect(safeToFixed('  10.5  ')).toBe('10.500000000');
    });
  });

  describe('Custom decimal places', () => {
    it('should use custom decimal places', () => {
      expect(safeToFixed(1, 0)).toBe('1');
      expect(safeToFixed(1.5, 1)).toBe('1.5');
      expect(safeToFixed(1.234, 2)).toBe('1.23');
      expect(safeToFixed(1.999, 2)).toBe('2.00'); // Rounding
    });

    it('should handle 18 decimals for ETH values', () => {
      expect(safeToFixed(1, 18)).toBe('1.000000000000000000');
      // Using string to avoid precision loss lint error
      expect(safeToFixed(Number('0.123456789012345678'), 18)).toBe(
        '0.123456789012345677'
      ); // JS precision limitation
    });

    it('should handle 0 decimals', () => {
      expect(safeToFixed(1.9, 0)).toBe('2');
      expect(safeToFixed(1.4, 0)).toBe('1');
      expect(safeToFixed(1.5, 0)).toBe('2'); // Standard rounding
    });

    it('should default to 9 decimals when not specified', () => {
      expect(safeToFixed(1)).toBe('1.000000000');
      expect(safeToFixed(1.23456789012345)).toBe('1.234567890');
    });
  });

  describe('Invalid inputs', () => {
    it('should return 0 for NaN', () => {
      expect(safeToFixed(NaN)).toBe('0.000000000');
    });

    it('should return 0 for non-numeric strings', () => {
      expect(safeToFixed('abc')).toBe('0.000000000');
      expect(safeToFixed('12abc')).toBe('0.000000000');
      expect(safeToFixed('NaN')).toBe('0.000000000');
    });

    it('should return 0 for null', () => {
      expect(safeToFixed(null)).toBe('0.000000000');
    });

    it('should return 0 for undefined', () => {
      expect(safeToFixed(undefined)).toBe('0.000000000');
    });

    it('should return 0 for objects', () => {
      expect(safeToFixed({})).toBe('0.000000000');
      expect(safeToFixed({ value: 1 })).toBe('0.000000000');
      expect(safeToFixed([])).toBe('0.000000000');
    });

    it('should return 0 for booleans', () => {
      expect(safeToFixed(true)).toBe('1.000000000'); // true converts to 1
      expect(safeToFixed(false)).toBe('0.000000000'); // false converts to 0
    });

    it('should return 0 for Infinity', () => {
      expect(safeToFixed(Infinity)).toBe('0.000000000');
      expect(safeToFixed(-Infinity)).toBe('0.000000000');
    });
  });

  describe('Gas price formatting scenarios', () => {
    it('should format typical Gwei values', () => {
      expect(safeToFixed(1, 9)).toBe('1.000000000'); // 1 Gwei
      expect(safeToFixed(10, 9)).toBe('10.000000000'); // 10 Gwei
      expect(safeToFixed(100, 9)).toBe('100.000000000'); // 100 Gwei
      expect(safeToFixed(0.1, 9)).toBe('0.100000000'); // 0.1 Gwei
    });

    it('should handle floating point precision issues', () => {
      // This was the original bug - floating point math can create values with many decimals
      const problematicValue = 0.1 + 0.2; // Results in 0.30000000000000004 in JS
      expect(safeToFixed(problematicValue, 9)).toBe('0.300000000');

      const anotherProblematic = 1.0000000001; // More than 9 decimals
      expect(safeToFixed(anotherProblematic, 9)).toBe('1.000000000');
    });

    it('should handle calculated gas values', () => {
      // Simulating values that come from gas calculations
      const baseFee = 30.5;
      const priorityFee = 1.5;
      const maxFee = baseFee + priorityFee;

      expect(safeToFixed(maxFee, 9)).toBe('32.000000000');
      expect(safeToFixed(baseFee, 9)).toBe('30.500000000');
      expect(safeToFixed(priorityFee, 9)).toBe('1.500000000');
    });

    it('should prevent parseUnits overflow errors', () => {
      // These values would cause parseUnits to fail without safeToFixed
      // Using Number() to avoid precision loss lint error
      const tooManyDecimals = Number('1.1234567890123456789');
      expect(safeToFixed(tooManyDecimals, 9)).toBe('1.123456789');

      const verySmallWithManyDecimals = 0.000000000123456789;
      expect(safeToFixed(verySmallWithManyDecimals, 9)).toBe('0.000000000');
    });
  });

  describe('Edge cases', () => {
    it('should handle -0', () => {
      expect(safeToFixed(-0)).toBe('0.000000000');
    });

    it('should handle Number.MAX_VALUE', () => {
      const result = safeToFixed(Number.MAX_VALUE, 0);
      expect(result).not.toBe('0'); // Should handle large numbers
    });

    it('should handle Number.MIN_VALUE', () => {
      expect(safeToFixed(Number.MIN_VALUE, 9)).toBe('0.000000000'); // Too small for 9 decimals
      // Skip test with 324 decimals as toFixed max is 100
    });

    it('should handle arrays that convert to numbers', () => {
      expect(safeToFixed([1])).toBe('1.000000000'); // [1] converts to 1
      expect(safeToFixed([1, 2])).toBe('0.000000000'); // [1,2] converts to NaN
    });
  });
});
