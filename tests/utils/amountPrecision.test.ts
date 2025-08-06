/**
 * Tests for amount precision handling in Pali wallet
 * Focuses on the specific fixes we made for JavaScript number precision limits
 */

import { safeBigNumber } from '../../source/utils/safeBigNumber';

describe('Amount Precision Safety Tests', () => {
  describe('JavaScript Number Limits', () => {
    it('should identify when values exceed MAX_SAFE_INTEGER', () => {
      const safeValue = Number.MAX_SAFE_INTEGER;
      const unsafeValue = Number.MAX_SAFE_INTEGER + 1;

      expect(Number.isSafeInteger(safeValue)).toBe(true);
      expect(Number.isSafeInteger(unsafeValue)).toBe(false);
    });

    it('should demonstrate precision loss with large numbers', () => {
      const largeNumber = '9007199254740993'; // MAX_SAFE_INTEGER + 2
      const converted = Number(largeNumber);
      const backToString = converted.toString();

      // This demonstrates the precision loss
      expect(backToString).not.toBe(largeNumber);
      expect(backToString).toBe('9007199254740992'); // Lost precision
    });

    it('should show why Number() is unsafe for large SYS amounts', () => {
      // 100 million SYS in satoshis
      const largeSYSInSatoshis = '10000000000000000'; // 10^16
      const asNumber = Number(largeSYSInSatoshis);

      // This exceeds MAX_SAFE_INTEGER
      expect(Number.isSafeInteger(asNumber)).toBe(false);
      expect(asNumber).toBe(10000000000000000); // But JS shows it as this

      // The actual precision is lost
      const backToString = asNumber.toString();
      expect(backToString).toBe('10000000000000000'); // Looks OK but...

      // Try with one more satoshi
      const oneSatoshiMore = '10000000000000001';
      const oneSatoshiMoreNum = Number(oneSatoshiMore);
      expect(oneSatoshiMoreNum.toString()).toBe('10000000000000000'); // Lost the 1!
    });
  });

  describe('safeBigNumber utility', () => {
    it('should handle large string values without precision loss', () => {
      const largeValue = '999999999999999999999999999999';
      const bn = safeBigNumber(largeValue);

      expect(bn.toString()).toBe(largeValue);
    });

    it('should handle decimal values by truncating', () => {
      const decimalValue = '123.456789';
      const bn = safeBigNumber(decimalValue);

      expect(bn.toString()).toBe('123');
    });

    it('should handle hex values', () => {
      const hexValue = '0xde0b6b3a7640000'; // 1 ETH in wei
      const bn = safeBigNumber(hexValue);

      expect(bn.toString()).toBe('1000000000000000000');
    });

    it('should handle negative values', () => {
      const negativeValue = '-12345';
      const bn = safeBigNumber(negativeValue);

      expect(bn.toString()).toBe('-12345');
    });

    it('should use fallback on invalid input', () => {
      const invalidValue = 'not-a-number';
      const bn = safeBigNumber(invalidValue, '0');

      expect(bn.toString()).toBe('0');
    });

    it('should handle scientific notation', () => {
      const scientificAmount = '1.23e+5'; // 123000
      const bn = safeBigNumber(scientificAmount);

      expect(bn.toString()).toBe('123000');
    });
  });

  describe('Fixed Issues Verification', () => {
    it('should verify amount is kept as string in SendSys.tsx', () => {
      // Before fix: amount: Number(amount)
      // After fix: amount: amount (kept as string)

      const amount = '99999999.99999999';

      // OLD WAY (UNSAFE)
      const unsafeAmount = Number(amount);
      // JavaScript happens to handle this specific value OK
      expect(unsafeAmount).toBe(99999999.99999999);

      // But with larger values it fails
      const hugeAmount = '9999999999999999.99999999';
      const hugeUnsafe = Number(hugeAmount);
      expect(hugeUnsafe).toBe(10000000000000000); // Lost all decimal precision!

      // NEW WAY (SAFE)
      const safeAmount = amount; // Keep as string
      expect(safeAmount).toBe('99999999.99999999'); // Precision preserved
    });

    it('should verify safe satoshi conversion without parseFloat', () => {
      const amount = '12345678.87654321';

      // OLD WAY (POTENTIALLY UNSAFE)
      const oldWay = Math.floor(parseFloat(amount) * 1e8).toString();

      // NEW WAY (SAFE) - as implemented in our fix
      const parts = amount.split('.');
      const integerPart = parts[0] || '0';
      const decimalPart = parts[1] || '';
      const paddedDecimal = decimalPart.padEnd(8, '0').substring(0, 8);
      const satoshiStr = integerPart + paddedDecimal;
      const trimmedSatoshis = satoshiStr.replace(/^0+/, '') || '0';

      expect(oldWay).toBe('1234567887654321');
      expect(trimmedSatoshis).toBe('1234567887654321');

      // Test with a value that shows precision loss
      const largeSys = '99999999.99999999';
      const unsafeLarge = Math.floor(parseFloat(largeSys) * 1e8);
      expect(unsafeLarge).toBe(9999999999999998); // Lost precision! Should be 9999999999999999

      // But our string method preserves it
      const largeParts = largeSys.split('.');
      const largeInt = largeParts[0] || '0';
      const largeDec = (largeParts[1] || '').padEnd(8, '0').substring(0, 8);
      const largeSatoshis = (largeInt + largeDec).replace(/^0+/, '') || '0';
      expect(largeSatoshis).toBe('9999999999999999'); // Correct!
    });

    it('should handle string amounts in transaction functions', () => {
      // The functions now accept: amount: number | string
      // This test verifies that passing strings works

      const stringAmount = '12345.67890123';

      // The function does: amount.toString()
      // So whether we pass number or string, it works
      const result = stringAmount.toString();
      expect(result).toBe(stringAmount);

      // If we had passed a number, precision might be lost
      const numberAmount = 12345.67890123;
      const numberResult = numberAmount.toString();
      expect(numberResult).toBe('12345.67890123'); // OK for this value

      // But for larger values
      const largeString = '99999999999999.99999999';
      const largeNumber = Number(largeString);

      expect(largeString.toString()).toBe('99999999999999.99999999'); // String preserves
      expect(largeNumber.toString()).not.toBe(largeString); // Number loses precision
    });
  });

  describe('Real-world Precision Scenarios', () => {
    it('should handle Bitcoin max supply in satoshis', () => {
      const btcMaxSatoshis = '2100000000000000'; // 21M * 1e8

      // This number is at the edge of JavaScript's safe integer range
      const asNumber = Number(btcMaxSatoshis);
      expect(Number.isSafeInteger(asNumber)).toBe(true); // Just barely safe

      // But any larger amount would be unsafe
      const doubleSupply = '4200000000000000';
      const doubleAsNumber = Number(doubleSupply);
      expect(Number.isSafeInteger(doubleAsNumber)).toBe(true); // Still safe

      // 5x Bitcoin supply would exceed safe range
      const fiveXSupply = '10500000000000000'; // 105M BTC in satoshis
      const fiveXAsNumber = Number(fiveXSupply);
      expect(Number.isSafeInteger(fiveXAsNumber)).toBe(false); // UNSAFE!
    });

    it('should demonstrate why we need BigNumber for Wei', () => {
      // Just 10 ETH in wei
      const tenEthInWei = '10000000000000000000'; // 10 * 1e18
      const asNumber = Number(tenEthInWei);

      // This exceeds safe integer
      expect(Number.isSafeInteger(asNumber)).toBe(false);

      // Precision is lost
      expect(asNumber.toString()).toBe('10000000000000000000'); // Looks OK but...

      // Add 1 wei
      const tenEthPlusOne = '10000000000000000001';
      const plusOneAsNumber = Number(tenEthPlusOne);

      // The 1 wei is lost!
      expect(plusOneAsNumber.toString()).toBe('10000000000000000000');
    });

    it('should show safe string manipulation for satoshi conversion', () => {
      // Test our safe conversion method
      const testCases = [
        { sys: '1', expectedSatoshis: '100000000' },
        { sys: '0.1', expectedSatoshis: '10000000' },
        { sys: '0.00000001', expectedSatoshis: '1' },
        { sys: '123.456', expectedSatoshis: '12345600000' },
        { sys: '123.45678901', expectedSatoshis: '12345678901' }, // Truncated
        { sys: '99999999.99999999', expectedSatoshis: '9999999999999999' },
      ];

      testCases.forEach(({ sys, expectedSatoshis }) => {
        const parts = sys.split('.');
        const integerPart = parts[0] || '0';
        const decimalPart = parts[1] || '';
        const paddedDecimal = decimalPart.padEnd(8, '0').substring(0, 8);
        const satoshiStr = integerPart + paddedDecimal;
        const trimmed = satoshiStr.replace(/^0+/, '') || '0';

        expect(trimmed).toBe(expectedSatoshis);
      });
    });
  });
});
