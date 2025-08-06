import { BigNumber } from '@ethersproject/bignumber';

import {
  formatSyscoinValue,
  toSatoshis,
  formatGweiValue,
} from '../../source/utils/formatSyscoinValue';

describe('formatSyscoinValue', () => {
  describe('formatSyscoinValue', () => {
    it('should format satoshis to SYS correctly', () => {
      // 1 SYS = 100000000 satoshis
      expect(formatSyscoinValue('100000000')).toBe('1');
      expect(formatSyscoinValue('50000000')).toBe('0.5');
      expect(formatSyscoinValue('12345678')).toBe('0.12345678');
      expect(formatSyscoinValue('1')).toBe('1e-8'); // formatUnits returns scientific notation for very small numbers
    });

    it('should handle BigNumber input', () => {
      const bn = BigNumber.from('100000000');
      expect(formatSyscoinValue(bn)).toBe('1');
    });

    it('should handle hex string input', () => {
      // 0x5F5E100 = 100000000 in decimal
      expect(formatSyscoinValue('0x5F5E100')).toBe('1');
    });

    it('should handle number input', () => {
      expect(formatSyscoinValue(100000000)).toBe('1');
      expect(formatSyscoinValue(50000000)).toBe('0.5');
    });

    it('should handle zero', () => {
      expect(formatSyscoinValue('0')).toBe('0');
      expect(formatSyscoinValue(0)).toBe('0');
      expect(formatSyscoinValue(BigNumber.from(0))).toBe('0');
    });

    it('should handle large values', () => {
      // 21 million SYS
      expect(formatSyscoinValue('2100000000000000')).toBe('21000000');
    });

    it('should handle invalid input gracefully', () => {
      expect(formatSyscoinValue(null as any)).toBe('0');
      expect(formatSyscoinValue(undefined as any)).toBe('0');
      expect(formatSyscoinValue('invalid')).toBe('0');
    });

    it('should handle fractional satoshis by truncating', () => {
      // Numbers with decimals should be truncated
      expect(formatSyscoinValue(100000000.5)).toBe('1');
      expect(formatSyscoinValue(50000000.999)).toBe('0.5');
    });
  });

  describe('toSatoshis', () => {
    it('should convert SYS to satoshis correctly', () => {
      expect(toSatoshis('1').toString()).toBe('100000000');
      expect(toSatoshis('0.5').toString()).toBe('50000000');
      expect(toSatoshis('0.12345678').toString()).toBe('12345678');
      expect(toSatoshis('0.00000001').toString()).toBe('1');
    });

    it('should handle number input', () => {
      expect(toSatoshis(1).toString()).toBe('100000000');
      expect(toSatoshis(0.5).toString()).toBe('50000000');
    });

    it('should handle zero', () => {
      expect(toSatoshis('0').toString()).toBe('0');
      expect(toSatoshis(0).toString()).toBe('0');
    });

    it('should truncate extra decimal places', () => {
      // More than 8 decimal places should be truncated
      expect(toSatoshis('0.123456789').toString()).toBe('12345678');
      expect(toSatoshis('1.999999999').toString()).toBe('199999999');
    });

    it('should handle large values', () => {
      expect(toSatoshis('21000000').toString()).toBe('2100000000000000');
    });

    it('should handle invalid input gracefully', () => {
      expect(toSatoshis('invalid').toString()).toBe('0');
      expect(toSatoshis(null as any).toString()).toBe('0');
      expect(toSatoshis(undefined as any).toString()).toBe('0');
    });

    it('should handle values without decimal point', () => {
      expect(toSatoshis('100').toString()).toBe('10000000000');
      expect(toSatoshis('5').toString()).toBe('500000000');
    });

    it('should handle values with partial decimals', () => {
      expect(toSatoshis('1.1').toString()).toBe('110000000');
      expect(toSatoshis('0.1').toString()).toBe('10000000');
      expect(toSatoshis('0.001').toString()).toBe('100000');
    });
  });

  describe('formatGweiValue', () => {
    it('should format wei to Gwei correctly', () => {
      // 1 Gwei = 10^9 wei
      expect(formatGweiValue('1000000000')).toBe('1');
      expect(formatGweiValue('500000000')).toBe('0.5');
      expect(formatGweiValue('123456789')).toBe('0.123456789');
      expect(formatGweiValue('1')).toBe('1e-9'); // formatUnits returns scientific notation for very small numbers
    });

    it('should handle BigNumber input', () => {
      const bn = BigNumber.from('1000000000');
      expect(formatGweiValue(bn)).toBe('1');
    });

    it('should handle hex string input', () => {
      // 0x3B9ACA00 = 1000000000 in decimal
      expect(formatGweiValue('0x3B9ACA00')).toBe('1');
    });

    it('should handle number input', () => {
      expect(formatGweiValue(1000000000)).toBe('1');
      expect(formatGweiValue(500000000)).toBe('0.5');
    });

    it('should handle zero', () => {
      expect(formatGweiValue('0')).toBe('0');
      expect(formatGweiValue(0)).toBe('0');
      expect(formatGweiValue(BigNumber.from(0))).toBe('0');
    });

    it('should handle large values', () => {
      // 1000 Gwei
      expect(formatGweiValue('1000000000000')).toBe('1000');
    });

    it('should handle invalid input gracefully', () => {
      expect(formatGweiValue(null as any)).toBe('0');
      expect(formatGweiValue(undefined as any)).toBe('0');
      expect(formatGweiValue('invalid')).toBe('0');
    });
  });
});
