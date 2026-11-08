import {
  snapshotPreparedEvmTransaction,
  type PreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

import {
  compareEvmDappFees,
  evmDappFeeChoiceMatches,
  selectEvmDappFeeChoice,
} from './evmDappFeePolicy';

const network = {
  gasPrice: BigInt(2000000000),
  maxFeePerGas: BigInt(3000000000),
  maxPriorityFeePerGas: BigInt(1000000000),
};

test('a fee choice is accepted only when every selected field survives the requote', () => {
  const transaction = {
    type: 0,
    gasLimit: '25200',
    gasPrice: '9007199254740995',
  } as PreparedEvmTransaction;
  expect(
    evmDappFeeChoiceMatches(transaction, {
      gasLimit: '25200',
      gasPrice: '9007199254740995',
    })
  ).toBe(true);
  expect(
    evmDappFeeChoiceMatches(transaction, {
      gasLimit: '21000',
      gasPrice: '9007199254740995',
    })
  ).toBe(false);
  expect(
    evmDappFeeChoiceMatches(transaction, {
      gasLimit: '25200',
      gasPrice: '9007199254740993',
    })
  ).toBe(false);
  const typed = {
    type: 2,
    gasLimit: '25200',
    maxFeePerGas: '9007199254740995',
    maxPriorityFeePerGas: '0',
  } as PreparedEvmTransaction;
  expect(
    evmDappFeeChoiceMatches(typed, {
      gasLimit: '25200',
      maxFeePerGas: '9007199254740995',
      maxPriorityFeePerGas: '0',
    })
  ).toBe(true);
  expect(
    evmDappFeeChoiceMatches(typed, {
      gasLimit: '25200',
      maxFeePerGas: '9007199254740993',
      maxPriorityFeePerGas: '0',
    })
  ).toBe(false);
  expect(
    evmDappFeeChoiceMatches(typed, {
      gasLimit: '25200',
      maxFeePerGas: '9007199254740995',
      maxPriorityFeePerGas: '1',
    })
  ).toBe(false);
  expect(
    evmDappFeeChoiceMatches(typed, {
      gasLimit: '25200',
      gasPrice: '9007199254740995',
    })
  ).toBe(false);
});

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

test('shared fee selection preserves every base unit and selects only fee fields', () => {
  const transaction = snapshotPreparedEvmTransaction({
    from: `0x${'11'.repeat(20)}`,
    to: `0x${'22'.repeat(20)}`,
    data: '0x',
    value: '0',
    nonce: '4',
    chainId: '1',
    gasLimit: '25200',
    type: 2,
    accessList: [],
    maxFeePerGas: '9007199254740993',
    maxPriorityFeePerGas: '0',
  });
  const comparison = {
    gasLimit: { requested: '21000', recommended: '25200' },
    maxFeePerGas: {
      requested: '9007199254740993',
      recommended: '9007199254740995',
    },
    maxPriorityFeePerGas: { requested: '0', recommended: '1000000000' },
    recommendationOnly: false,
  };
  expect(selectEvmDappFeeChoice(transaction, comparison, 'dapp')).toEqual({
    gasLimit: '21000',
    maxFeePerGas: '9007199254740993',
    maxPriorityFeePerGas: '0',
  });
  const selected = selectEvmDappFeeChoice(transaction, comparison, 'network');
  expect(selected).toEqual({
    gasLimit: '25200',
    maxFeePerGas: '9007199254740995',
    maxPriorityFeePerGas: '1000000000',
  });
  expect(Object.isFrozen(selected)).toBe(true);
  expect(() =>
    selectEvmDappFeeChoice(transaction, comparison, 'other' as 'network')
  ).toThrow('Invalid fee choice');
});

test('shared legacy fee selection retains the quoted gas when only price differs', () => {
  const transaction = snapshotPreparedEvmTransaction({
    from: `0x${'11'.repeat(20)}`,
    to: `0x${'22'.repeat(20)}`,
    data: '0x',
    value: '0',
    nonce: '4',
    chainId: '1',
    gasLimit: '70000',
    type: 0,
    gasPrice: '1500000000',
  });
  expect(
    selectEvmDappFeeChoice(
      transaction,
      {
        gasPrice: { requested: '1500000000', recommended: '2000000000' },
        recommendationOnly: true,
      },
      'network'
    )
  ).toEqual({ gasLimit: '70000', gasPrice: '2000000000' });
});
