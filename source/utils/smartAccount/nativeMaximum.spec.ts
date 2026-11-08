import { toBeHex } from 'ethers/utils';
import { prepareSmartAccountNativeMaximum } from './nativeMaximum';

const target = '0x1111111111111111111111111111111111111111';
const balance = BigInt('2000000000000');
const buffer = BigInt('1000000000000');
const current = () => undefined;

test('keeps the extension reserve and returns only a stable exact execution', async () => {
  const values: string[] = [];
  const quotes: object[] = [];
  const result = await prepareSmartAccountNativeMaximum({
    target,
    assertCurrent: current,
    async readBalance() {
      return balance.toString();
    },
    async quote(execution) {
      values.push(execution.value);
      const quote = {};
      quotes.push(quote);
      return { quote, maximumFeeUnits: '10' };
    },
  });
  expect(values.map(BigInt)).toEqual([
    BigInt(1),
    balance - buffer - BigInt(10),
  ]);
  expect(result.execution).toEqual({
    target,
    data: '0x',
    value: toBeHex(balance - buffer - BigInt(10)),
  });
  expect(result.quote).toBe(quotes[1]);
});

test('re-quotes a changing fee and caps refinement at the existing three attempts', async () => {
  let calls = 0;
  const quote = jest.fn(async () => ({
    quote: ++calls,
    maximumFeeUnits: calls === 1 ? '10' : '20',
  }));
  const result = await prepareSmartAccountNativeMaximum({
    target,
    assertCurrent: current,
    async readBalance() {
      return balance.toString();
    },
    quote,
  });
  expect(quote).toHaveBeenCalledTimes(3);
  expect(result.quote).toBe(3);
  expect(BigInt(result.execution.value)).toBe(balance - buffer - BigInt(20));
  calls = 0;
  await expect(
    prepareSmartAccountNativeMaximum({
      target,
      assertCurrent: current,
      async readBalance() {
        return balance.toString();
      },
      async quote() {
        return { quote: null, maximumFeeUnits: String(++calls) };
      },
    })
  ).rejects.toThrow('did not stabilize');
  expect(calls).toBe(3);
});

test('zero-credit gas quotes retain the same reserve and insufficient or malformed values fail', async () => {
  const options = {
    target,
    assertCurrent: current,
    async readBalance() {
      return balance.toString();
    },
    async quote() {
      return { quote: null, maximumFeeUnits: '0' };
    },
  };
  const result = await prepareSmartAccountNativeMaximum(options);
  expect(BigInt(result.execution.value)).toBe(balance - buffer);
  await expect(
    prepareSmartAccountNativeMaximum({
      ...options,
      readBalance: async () => buffer.toString(),
    })
  ).rejects.toThrow('Insufficient');
  await expect(
    prepareSmartAccountNativeMaximum({
      ...options,
      readBalance: async () => '1e18',
    })
  ).rejects.toThrow('Invalid');
  await expect(
    prepareSmartAccountNativeMaximum({
      ...options,
      quote: async () => ({ quote: null, maximumFeeUnits: '-1' }),
    })
  ).rejects.toThrow('Invalid');
});

test('owner or expiry loss after either asynchronous read prevents any result', async () => {
  let active = true;
  const guard = () => {
    if (!active) throw new Error('expired');
  };
  const quote = jest.fn(async () => ({ quote: null, maximumFeeUnits: '0' }));
  await expect(
    prepareSmartAccountNativeMaximum({
      target,
      assertCurrent: guard,
      quote,
      async readBalance() {
        active = false;
        return balance.toString();
      },
    })
  ).rejects.toThrow('expired');
  expect(quote).not.toHaveBeenCalled();
  active = true;
  await expect(
    prepareSmartAccountNativeMaximum({
      target,
      assertCurrent: guard,
      async readBalance() {
        return balance.toString();
      },
      async quote() {
        active = false;
        return { quote: null, maximumFeeUnits: '0' };
      },
    })
  ).rejects.toThrow('expired');
});

test('asynchronous guards fail before balance queries', async () => {
  const readBalance = jest.fn(async () => balance.toString());
  await expect(
    prepareSmartAccountNativeMaximum({
      target,
      assertCurrent: async () => undefined,
      readBalance,
      async quote() {
        return { quote: null, maximumFeeUnits: '0' };
      },
    })
  ).rejects.toThrow();
  expect(readBalance).not.toHaveBeenCalled();
});
