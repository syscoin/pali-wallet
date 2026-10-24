import { isNativeBalanceAvailable } from './nativeBalance';

describe('native balance availability', () => {
  it.each([0, '0', '0.00000000', 2, '2.00000001', '1e-8'])(
    'keeps the valid loaded balance %p',
    (balance) => expect(isNativeBalanceAvailable(balance)).toBe(true)
  );

  it.each([
    -1,
    '-1',
    '-1.0',
    undefined,
    null,
    '',
    ' ',
    NaN,
    Infinity,
    'Infinity',
    'unavailable',
    false,
  ])(
    'does not display or use the unknown/invalid balance %p as native MAX',
    (balance) => expect(isNativeBalanceAvailable(balance)).toBe(false)
  );
});
