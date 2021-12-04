import {
  getDecimalPlaces,
  inputValToString,
  getChangeAmount,
} from '../../utils/sendUtil';

const MAX_AMOUNT_NUMBER = 1000000000;
const EIGHT_ASSET_DECINALS = 8;

describe('SendUtil Test', () => {
  describe('getDecimalPlaces', () => {
    ////////////////////////
    // Positive Test
    ////////////////////////

    test('should return 0 for non decimal values', () => {
      const value = getDecimalPlaces('10');
      expect(value).toBe(0);
    });

    test('should return number of decimal places', () => {
      const value = getDecimalPlaces('10.00001');
      expect(value).toBe(5);
    })


    ////////////////////////
    // Negative Test
    ////////////////////////

    test('should return null for alpha characters', () => {
      const value = getDecimalPlaces('abc');
      expect(value).toBe(null);
    });


  });

  describe('inputValToString', () => {
    ////////////////////////
    // Positive Test
    ////////////////////////

    test('should return the numerical inputs', () => {
      const value = inputValToString('10000');
      expect(value).toBe('10000');
    });

    test('should return 0 for alpha inputs', () => {
      const value = inputValToString('abc');
      expect(value).toBe('0');
    });
  });

  describe('getChangeAmount', () => {
    test('should handle no decimal place', () => {
      const changeAmount = getChangeAmount(
        '1',
        MAX_AMOUNT_NUMBER,
        EIGHT_ASSET_DECINALS
      );
      expect(changeAmount).toBe('1');
    });

    test('should handle long decimals', () => {
      const changeAmount = getChangeAmount(
        '1.00001',
        MAX_AMOUNT_NUMBER,
        EIGHT_ASSET_DECINALS
      );
      expect(changeAmount).toBe('1.00001');
    });

    test('should return zero for non-numbers', () => {
      const changeAmount = getChangeAmount(
        'asdfdsf',
        MAX_AMOUNT_NUMBER,
        EIGHT_ASSET_DECINALS
      );
      expect(changeAmount).toBe('0');
    });

    test('should return null for decimals that are too long', () => {
      const changeAmount = getChangeAmount(
        '1.000000001',
        MAX_AMOUNT_NUMBER,
        EIGHT_ASSET_DECINALS
      );
      expect(changeAmount).toBe(null);
    });

    test('should return null for numbers over the maxAmount', () => {
      const changeAmount = getChangeAmount(
        '1000000001',
        MAX_AMOUNT_NUMBER,
        EIGHT_ASSET_DECINALS
      );
      expect(changeAmount).toBe(null);
    });
  });
});
