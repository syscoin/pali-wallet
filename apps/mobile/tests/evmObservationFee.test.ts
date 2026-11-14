import assert from 'node:assert/strict';
import test from 'node:test';
import { observeEvmTransaction, readEvmReceiptFeeUnits } from '../../../source/shared/evmTransactionObservation.ts';

const hash = '0x' + '11'.repeat(32), blockHash = '0x' + '22'.repeat(32);
const from = '0x' + '33'.repeat(20), to = '0x' + '44'.repeat(20);
const expected = { chainId: '1', hash, from, to, nonce: '0' };
const receipt = { transactionHash: hash, from, to, status: '0x1', blockNumber: '0x2', blockHash };

test('receipt fees preserve exact quantities including zero and reject malformed or overflowing products', () => {
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x5208', effectiveGasPrice: '0x2' }), '42000');
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x0', effectiveGasPrice: '0xffff' }), '0');
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x1', effectiveGasPrice: '0x' + 'f'.repeat(64) }), ((1n << 256n) - 1n).toString());
  assert.equal(readEvmReceiptFeeUnits({ gasUsed: '0x5208' }), null);
  for (const fields of [
    { gasUsed: '0x00', effectiveGasPrice: '0x1' },
    { gasUsed: 21000, effectiveGasPrice: '0x1' },
    { gasUsed: '0x1', effectiveGasPrice: null },
    { gasUsed: '0x2', effectiveGasPrice: '0x' + 'f'.repeat(64) },
  ]) assert.throws(() => readEvmReceiptFeeUnits(fields), { code: 'INVALID_RESPONSE' });
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
