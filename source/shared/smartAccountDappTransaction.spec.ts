import { snapshotSmartAccountDappTransaction } from './smartAccountDappTransaction';

const from = '0x' + '11'.repeat(20);
const to = '0x' + '22'.repeat(20);
const transaction = { from, to, value: '0x0', data: '0x1234' };

test('Smart dapp calls retain exact calldata, value and EIP1559 overrides', () => {
  const source = {
    ...transaction,
    maxFeePerGas: '100',
    maxPriorityFeePerGas: '0',
  };
  const snapshot = snapshotSmartAccountDappTransaction(source);
  source.data = '0xdead';
  expect(snapshot.data).toBe('0x1234');
  expect(snapshot.value).toBe('0x0');
  expect(snapshot.maxFeePerGas).toBe('0x64');
  expect(snapshot.maxPriorityFeePerGas).toBe('0x0');
  expect(Object.isFrozen(snapshot)).toBe(true);
});

test.each([
  ['nonce', { nonce: '0x0' }],
  ['access list', { accessList: [{ address: to, storageKeys: [] }] }],
  ['legacy type', { type: '0x0' }],
  ['gas price', { gasPrice: '0x1' }],
  ['creation', { to: undefined }],
])(
  'Smart dapp request rejects unsupported %s before preparation',
  (_name, extra) => {
    expect(() =>
      snapshotSmartAccountDappTransaction({ ...transaction, ...extra })
    ).toThrow();
  }
);

test('Smart gas fields retain the extension request shape while execution estimates its own UserOp gas', () => {
  const request = snapshotSmartAccountDappTransaction({
    ...transaction,
    type: '0x2',
    gas: '100000',
    gasLimit: '100000',
  });
  expect(request.gas).toBe('0x186a0');
  expect(request.gasLimit).toBe('0x186a0');
  expect(request.type).toBe('0x2');
  // Neither host forwards these EOA gas limits into SmartAccountFeeOverrides.
  // The existing shared Smart estimator prepares UserOperation gas.
});

test('the common transaction normalizer rejects type 1 even with an empty access list', () => {
  expect(() =>
    snapshotSmartAccountDappTransaction({
      ...transaction,
      type: '0x1',
      accessList: [],
    })
  ).toThrow();
});
