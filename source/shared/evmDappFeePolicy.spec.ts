import { compareEvmDappFees } from './evmDappFeePolicy';

const network = {
  gasPrice: BigInt(2000000000),
  maxFeePerGas: BigInt(3000000000),
  maxPriorityFeePerGas: BigInt(1000000000),
};

test('preserved lower app prices retain their network recommendation', () => {
  expect(
    compareEvmDappFees(
      { gasPrice: BigInt(1500000000), gasLimit: BigInt(70000) },
      { type: 0, gasPrice: BigInt(1500000000), gasLimit: BigInt(70000) },
      BigInt(21000),
      network
    )
  ).toEqual({
    gasLimit: undefined,
    gasPrice: { requested: '1500000000', recommended: '2000000000' },
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
    recommendationOnly: true,
  });
});

test('raised gas and prices are distinguished from an optional recommendation', () => {
  const comparison = compareEvmDappFees(
    { gasPrice: BigInt(1), gasLimit: BigInt(4096) },
    { type: 0, gasPrice: network.gasPrice, gasLimit: BigInt(25200) },
    BigInt(21000),
    network
  );
  expect(comparison).toMatchObject({
    gasLimit: { requested: '4096', recommended: '25200' },
    gasPrice: { requested: '1', recommended: '2000000000' },
    recommendationOnly: false,
  });
  expect(Object.isFrozen(comparison)).toBe(true);
  expect(Object.isFrozen(comparison.gasPrice)).toBe(true);
});

test('large fee comparisons retain every base unit and a zero priority fee', () => {
  const requested = BigInt('9007199254740993');
  const recommended = requested + BigInt(2);
  expect(
    compareEvmDappFees(
      { maxFeePerGas: requested, maxPriorityFeePerGas: BigInt(0) },
      {
        type: 2,
        maxFeePerGas: requested,
        maxPriorityFeePerGas: BigInt(0),
        gasLimit: BigInt(25200),
      },
      BigInt(21000),
      { ...network, maxFeePerGas: recommended }
    )
  ).toMatchObject({
    maxFeePerGas: {
      requested: '9007199254740993',
      recommended: '9007199254740995',
    },
    maxPriorityFeePerGas: { requested: '0', recommended: '1000000000' },
    recommendationOnly: true,
  });
});

test('omitted app fees have no comparison warning', () => {
  expect(
    compareEvmDappFees(
      {},
      { type: 2, ...network, gasLimit: BigInt(25200) },
      BigInt(21000),
      network
    )
  ).toEqual({
    gasLimit: undefined,
    gasPrice: undefined,
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
    recommendationOnly: true,
  });
});
