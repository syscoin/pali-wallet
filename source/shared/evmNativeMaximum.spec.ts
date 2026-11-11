import {
  nativeEvmMaximumReserve,
  nativeEvmMaximumValue,
  refineNativeEvmMaximum,
} from './evmNativeMaximum';

const current = () => undefined;
const units = (value: number) => BigInt(value);

it('keeps the existing software and hardware reserves in exact atomic units', () => {
  expect(nativeEvmMaximumReserve('software')).toBe(BigInt(0));
  expect(nativeEvmMaximumReserve('hardware')).toBe(BigInt('1000000000000'));
  const balance = BigInt('100000000000000000001');
  expect(
    nativeEvmMaximumValue(balance, units(21_000), units(3), BigInt(0))
  ).toBe(BigInt('99999999999999937001'));
  expect(
    nativeEvmMaximumValue(
      balance,
      units(21_000),
      units(3),
      nativeEvmMaximumReserve('hardware')
    )
  ).toBe(BigInt('99999998999999937001'));
});

it('reports insufficient funds without clamping or changing the reviewed arithmetic', () => {
  expect(
    nativeEvmMaximumValue(units(10), units(21_000), units(1), units(2))
  ).toBe(units(-20_992));
});

it('rejects negative, out-of-range and zero-gas inputs', () => {
  expect(() =>
    nativeEvmMaximumValue(units(-1), units(21_000), units(1), units(0))
  ).toThrow(RangeError);
  expect(() =>
    nativeEvmMaximumValue(units(1), units(0), units(1), units(0))
  ).toThrow(RangeError);
  expect(() =>
    nativeEvmMaximumValue(units(1), units(21_000), units(-1), units(0))
  ).toThrow(RangeError);
  expect(() =>
    nativeEvmMaximumValue(units(1), units(21_000), units(1), units(-1))
  ).toThrow(RangeError);
  expect(() =>
    nativeEvmMaximumValue(
      BigInt(1) << BigInt(256),
      units(21_000),
      units(1),
      units(0)
    )
  ).toThrow(RangeError);
  expect(() => nativeEvmMaximumReserve('unknown' as never)).toThrow(RangeError);
});

it('refines a conservative initial amount to the exact amount for stable gas', async () => {
  const values: bigint[] = [];
  const result = await refineNativeEvmMaximum({
    balanceUnits: units(10_000_000),
    feePerGas: units(2),
    reserveUnits: units(100),
    estimateGas: async (value) => {
      values.push(value);
      return units(21_000);
    },
    assertCurrent: current,
  });
  expect(values).toEqual([units(8_999_900), units(9_957_900)]);
  expect(result).toEqual({ value: units(9_957_900), gasLimit: units(21_000) });
});

it('makes at most two refinements and returns the amount for the last observed gas cap', async () => {
  const values: bigint[] = [];
  const gas = [units(40_000), units(50_000), units(60_000)];
  const result = await refineNativeEvmMaximum({
    balanceUnits: units(10_000_000),
    feePerGas: units(2),
    reserveUnits: units(100),
    estimateGas: async (value) => {
      values.push(value);
      return gas[values.length - 1];
    },
    assertCurrent: current,
  });
  expect(values).toEqual([
    units(8_999_900),
    units(9_919_900),
    units(9_899_900),
  ]);
  // A caller must validate this final exact value through its fee approval.
  expect(result).toEqual({ value: units(9_879_900), gasLimit: units(60_000) });
  expect(result.value).not.toBe(values.at(-1));
});

it('stops when the initial gas is already stable without an extra estimate', async () => {
  const estimateGas = jest.fn(async () => units(500_000));
  const result = await refineNativeEvmMaximum({
    balanceUnits: units(10_000_000),
    feePerGas: units(2),
    reserveUnits: units(100),
    estimateGas,
    assertCurrent: current,
  });
  expect(estimateGas).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ value: units(8_999_900), gasLimit: units(500_000) });
});

it('uses the existing positive probe and stops when the final amount cannot be funded', async () => {
  const estimateGas = jest.fn(async () => units(21_000));
  const result = await refineNativeEvmMaximum({
    balanceUnits: units(100),
    feePerGas: units(2),
    reserveUnits: units(100),
    estimateGas,
    assertCurrent: current,
  });
  expect(estimateGas).toHaveBeenCalledWith(BigInt(1));
  expect(estimateGas).toHaveBeenCalledTimes(1);
  expect(result.value).toBe(units(-42_000));
});

it('preserves the zero-fee probe without unnecessary refinements', async () => {
  const estimateGas = jest.fn(async () => units(21_000));
  const result = await refineNativeEvmMaximum({
    balanceUnits: units(100),
    feePerGas: units(0),
    reserveUnits: units(2),
    estimateGas,
    assertCurrent: current,
  });
  expect(estimateGas).toHaveBeenCalledWith(BigInt(1));
  expect(estimateGas).toHaveBeenCalledTimes(1);
  expect(result.value).toBe(units(98));
});

it('does not estimate before a rejected or asynchronous authority guard', async () => {
  const estimateGas = jest.fn(async () => units(21_000));
  const input = {
    balanceUnits: units(10_000_000),
    feePerGas: units(2),
    reserveUnits: units(0),
    estimateGas,
  };
  await expect(
    refineNativeEvmMaximum({
      ...input,
      assertCurrent: () => {
        throw new Error('cancelled');
      },
    })
  ).rejects.toThrow('cancelled');
  await expect(
    refineNativeEvmMaximum({ ...input, assertCurrent: async () => undefined })
  ).rejects.toThrow('must be synchronous');
  expect(estimateGas).not.toHaveBeenCalled();
});

it('rejects cancellation while an estimate is pending before refinement or delivery', async () => {
  let active = true;
  let resolve!: (gas: bigint) => void;
  const estimateGas = jest.fn(
    () =>
      new Promise<bigint>((done) => {
        resolve = done;
      })
  );
  const pending = refineNativeEvmMaximum({
    balanceUnits: units(10_000_000),
    feePerGas: units(2),
    reserveUnits: units(0),
    estimateGas,
    assertCurrent: () => {
      if (!active) throw new Error('retired');
    },
  });
  active = false;
  resolve(units(21_000));
  await expect(pending).rejects.toThrow('retired');
  expect(estimateGas).toHaveBeenCalledTimes(1);
});

it('propagates estimation failure and rejects invalid returned gas', async () => {
  const input = {
    balanceUnits: units(10_000_000),
    feePerGas: units(2),
    reserveUnits: units(0),
    assertCurrent: current,
  };
  await expect(
    refineNativeEvmMaximum({
      ...input,
      estimateGas: async () => {
        throw new Error('rpc refused');
      },
    })
  ).rejects.toThrow('rpc refused');
  await expect(
    refineNativeEvmMaximum({ ...input, estimateGas: async () => units(0) })
  ).rejects.toThrow(RangeError);
});
