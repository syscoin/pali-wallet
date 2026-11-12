import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATIC_FEE, chooseEvmFees, chooseUtxoFeeRate, feeGweiUnits, snapshotEvmFeeChoice, snapshotUtxoFeeChoice, utxoFeeRateUnits } from '../../../source/shared/transactionFeeChoice.ts';

test('fee editor uses the extension exact-gwei and preset policy', () => {
  assert.equal(feeGweiUnits('0.000000007'), '7');
  assert.throws(() => feeGweiUnits('0.0000000001'));
  assert.throws(() => feeGweiUnits('0'));
  assert.equal(feeGweiUnits('0', true), '0');
  const rates = { type: 2 as const, maxFeePerGas: '10000000000', maxPriorityFeePerGas: '1000000000' };
  assert.deepEqual(chooseEvmFees(rates, AUTOMATIC_FEE), rates);
  assert.deepEqual(chooseEvmFees(rates, { kind: 'high' }), { type: 2, maxFeePerGas: '12000000000', maxPriorityFeePerGas: '1200000000' });
  assert.deepEqual(chooseEvmFees(rates, { kind: 'custom', type: 2, maxFeePerGas: '9', maxPriorityFeePerGas: '1', gasLimit: '30000' }),
    { type: 2, maxFeePerGas: '9', maxPriorityFeePerGas: '1', gasLimit: '30000' });
});
test('fee choices copy only admitted fields before async work', () => {
  let read = false;
  const getter = Object.defineProperty({}, 'kind', { enumerable: true, get() { read = true; return 'automatic'; } });
  assert.throws(() => snapshotEvmFeeChoice(getter as any)); assert.equal(read, false);
  assert.throws(() => snapshotEvmFeeChoice({ kind: 'automatic', gasPrice: '100' } as any));
  assert.throws(() => snapshotEvmFeeChoice({ kind: 'custom', type: 2, maxFeePerGas: '1', maxPriorityFeePerGas: '2' }));
  assert.throws(() => snapshotEvmFeeChoice({ kind: 'custom', type: 0, gasPrice: '1', gasLimit: '0' }));
  const input = { kind: 'custom' as const, type: 0 as const, gasPrice: '7' };
  const captured = snapshotEvmFeeChoice(input); input.gasPrice = '100';
  assert.equal((captured as typeof input).gasPrice, '7');
  assert.throws(() => chooseEvmFees({ type: 0, gasPrice: '7' }, { kind: 'custom', type: 2, maxFeePerGas: '2', maxPriorityFeePerGas: '1' }));
});
test('UTXO custom and urgency rates go through the same exact SDK converter', () => {
  for (let rate = 1; rate < 5000; rate++) {
    const selected = chooseUtxoFeeRate(1e-8, { kind: 'custom', satPerVbyte: String(rate) });
    assert.equal(utxoFeeRateUnits(selected!), rate);
  }
  assert.equal(chooseUtxoFeeRate(7e-8, AUTOMATIC_FEE), undefined);
  assert.equal(utxoFeeRateUnits(chooseUtxoFeeRate(1e-7, { kind: 'high' })!), 12);
  for (const rate of ['0','-1','7.5','5000','NaN'])
    assert.throws(() => snapshotUtxoFeeChoice({ kind: 'custom', satPerVbyte: rate }));
});
