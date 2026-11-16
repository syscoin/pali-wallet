import assert from 'node:assert/strict';
import test from 'node:test';
import { observeEvmTransaction, readEvmReceiptFeeUnits } from '../../../source/shared/evmTransactionObservation.ts';

const hash = '0x' + '11'.repeat(32), blockHash = '0x' + '22'.repeat(32);
const from = '0x' + '33'.repeat(20), to = '0x' + '44'.repeat(20);
const expected = { chainId: '1', hash, from, to, nonce: '0' };
const receipt = { transactionHash: hash, from, to, status: '0x1', blockNumber: '0x2', blockHash };

test('receipt fees preserve exact quantities including zero and reject malformed or overflowing products', () => {
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x5208', effectiveGasPrice: '0x2' }, '1'), '42000');
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x0', effectiveGasPrice: '0xffff' }, '1'), '0');
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x1', effectiveGasPrice: '0x' + 'f'.repeat(64) }, '1'), ((1n << 256n) - 1n).toString());
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x5208' }, '1'), null);
  for (const fields of [
    { gasUsed: '0x00', effectiveGasPrice: '0x1' },
    { gasUsed: 21000, effectiveGasPrice: '0x1' },
    { gasUsed: '0x1', effectiveGasPrice: null },
    { gasUsed: '0x2', effectiveGasPrice: '0x' + 'f'.repeat(64) },
  ]) assert.throws(() => readEvmReceiptFeeUnits(fields, '1'), { code: 'INVALID_RESPONSE' });
});

test('canonical observation carries fee from its existing receipt without an additional read', async () => {
  const methods: string[] = [];
  const value = await observeEvmTransaction(expected, async method => {
    methods.push(method);
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionReceipt') return { ...receipt, gasUsed: '0x5208', effectiveGasPrice: '0x2' };
    return { number: '0x2', hash: blockHash, gasLimit: '0x100000' };
  }, () => undefined);
  assert.equal(value.status, 'mined');
  assert.equal(value.status === 'mined' && value.feeUnits, '42000');
  assert.deepEqual(methods, ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_chainId']);
});

test('missing or malformed optional fee fields do not invalidate an otherwise canonical outcome', async () => {
  for (const fields of [{}, { gasUsed: '0x1' }, { gasUsed: '0x00', effectiveGasPrice: '0x1' },
    { gasUsed: '0x2', effectiveGasPrice: '0x' + 'f'.repeat(64) }]) {
    const value = await observeEvmTransaction(expected, async method => method === 'eth_chainId' ? '0x1'
      : method === 'eth_getTransactionReceipt' ? { ...receipt, ...fields }
        : { number: '0x2', hash: blockHash, gasLimit: '0x100000' }, () => undefined);
    assert.equal(value.status, 'mined');
    assert.equal(value.status === 'mined' && value.outcome, 'confirmed');
    assert.equal('feeUnits' in value, false);
  }
});

const blobFields = { type: '0x3', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', blobGasUsed: '0x20000', blobGasPrice: '0x3b9aca00' };

test('qualified blob fees include execution and blob gas exactly for successful and reverted outcomes', async () => {
  for (const [status, gasUsed, expectedFee] of [
    ['0x1', '0x5208', '152072000000000'],
    ['0x0', '0xc350', '181072000000000'],
  ] as const) {
    const methods: string[] = [];
    const value = await observeEvmTransaction(expected, async method => {
      methods.push(method);
      return method === 'eth_chainId' ? '0x1'
        : method === 'eth_getTransactionReceipt' ? { ...receipt, ...blobFields, status, gasUsed }
          : { number: '0x2', hash: blockHash, gasLimit: '0x100000' };
    }, () => undefined);
    assert.equal(value.status, 'mined');
    if (value.status !== 'mined') assert.fail('Expected canonical outcome');
    assert.equal(value.outcome, status === '0x1' ? 'confirmed' : 'reverted');
    assert.equal(value.feeUnits, expectedFee);
    assert.deepEqual(methods, ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_chainId']);
  }
  assert.equal(readEvmReceiptFeeUnits({ type: '0x2', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00' }, '1'), '21000000000000');
  assert.equal(readEvmReceiptFeeUnits({ type: '0x2', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', l1Fee: '0x5af3107a4000' }, '8453'), '121000000000000');
});

test('incomplete or malformed blob components never masquerade as a complete execution-only fee', async () => {
  for (const fields of [
    { blobGasUsed: undefined }, { blobGasPrice: undefined },
    { blobGasUsed: undefined, blobGasPrice: undefined },
    { blobGasUsed: '0x0' }, { blobGasPrice: '0x0' }, { blobGasUsed: '0x1' },
    { blobGasUsed: '0x020000' }, { blobGasPrice: '0x01' },
    { blobGasUsed: 131072 }, { blobGasPrice: null },
    { blobGasUsed: '0x1' + '0'.repeat(64) },
    { blobGasPrice: '0x1' + '0'.repeat(64) },
    { type: '0x2' }, { type: undefined },
  ]) {
    assert.equal(readEvmReceiptFeeUnits({ ...blobFields, ...fields }, '1'), null);
    const value = await observeEvmTransaction(expected, async method => method === 'eth_chainId' ? '0x1'
      : method === 'eth_getTransactionReceipt' ? { ...receipt, ...blobFields, ...fields }
        : { number: '0x2', hash: blockHash, gasLimit: '0x100000' }, () => undefined);
    assert.equal(value.status, 'mined');
    assert.equal(value.status === 'mined' && value.outcome, 'confirmed');
    assert.equal('feeUnits' in value, false);
  }
});

test('blob fee products and complete totals remain inside uint256 without hiding a canonical outcome', async () => {
  const maximum = (1n << 256n) - 1n;
  for (const fields of [
    { blobGasPrice: '0x' + maximum.toString(16) },
    { gasUsed: '0x1', effectiveGasPrice: '0x' + maximum.toString(16), blobGasPrice: '0x1' },
  ]) {
    assert.throws(() => readEvmReceiptFeeUnits({ ...blobFields, ...fields }, '1'), { code: 'INVALID_RESPONSE' });
    const value = await observeEvmTransaction(expected, async method => method === 'eth_chainId' ? '0x1'
      : method === 'eth_getTransactionReceipt' ? { ...receipt, ...blobFields, ...fields }
        : { number: '0x2', hash: blockHash, gasLimit: '0x100000' }, () => undefined);
    assert.equal(value.status === 'mined' && value.outcome, 'confirmed');
    assert.equal('feeUnits' in value, false);
  }
  assert.equal(readEvmReceiptFeeUnits({ ...blobFields, gasUsed: '0x1', effectiveGasPrice: '0x' + (maximum - 131072n).toString(16), blobGasPrice: '0x1' }, '1'), maximum.toString());
});
