import test from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from 'ethers/transaction';
import { getNativeNetwork, createNativeNetwork, NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import { assembleFeeQuote, assertFeeRefreshApproved, snapshotUnsignedTransfer, unsignedTransferBytes } from '../src/custody/evmFeeContracts.ts';
import type { EvmUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
const from = '0x1111111111111111111111111111111111111111', to = '0x2222222222222222222222222222222222222222';
const input: EvmUnsignedTransfer = { type: 2, from, to, chainId: '1', nonce: '0', value: '100', gasLimit: '21000', data: '0x', maxFeePerGas: '10', maxPriorityFeePerGas: '1' };
const block = { number: '1', hash: `0x${'1'.repeat(64)}` };
function quote(overrides: Partial<EvmUnsignedTransfer> = {}, expires = 1000) { return assembleFeeQuote({ ...input, ...overrides } as EvmUnsignedTransfer, getNativeNetwork('ethereum'), block, 6n, expires); }

test('exact unsigned snapshots reject extra secret/signature fields and never serialize signed bytes', () => {
  assert.equal(Transaction.from(unsignedTransferBytes(input)).isSigned(), false);
  for (const field of ['signature', 'privateKey', 'mnemonic', 'accessList']) assert.throws(() => snapshotUnsignedTransfer({ ...input, [field]: 'x' }, getNativeNetwork('ethereum')));
  let calls = 0;
  assert.throws(() => snapshotUnsignedTransfer({ ...input, get from() { calls++; return from; } }, getNativeNetwork('ethereum')));
  assert.equal(calls, 0);
});
test('exact execution fee arithmetic preserves bounded units for type0 and type2', () => {
  const value = quote();
  assert.equal(value.envelopeFeeCapUnits, '210000'); assert.equal(value.estimatedEnvelopeFeeUnits, '126000'); assert.equal(value.maximumTotalUnits, '210100');
  const legacy = { from, to, chainId: '1', nonce: '0', value: '100', gasLimit: '21000', data: '0x', type: 0 as const, gasPrice: '10' };
  assert.equal(assembleFeeQuote(legacy, getNativeNetwork('ethereum'), block, 6n, 1000).envelopeFeeCapUnits, '210000');
  assert.throws(() => quote({ gasLimit: ((1n << 256n) - 1n).toString() }));
});
test('freshness retains exact envelope and issuer identity', () => {
  const approved = quote(); assert.doesNotThrow(() => assertFeeRefreshApproved(approved, quote(), 100));
  for (const candidate of [quote({ nonce: '1' }), quote({ from: to }), quote({ maxFeePerGas: '11' }), { ...approved }])
    assert.throws(() => assertFeeRefreshApproved(approved, candidate, 100), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => assertFeeRefreshApproved(approved, quote(), 1000), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => assertFeeRefreshApproved(approved, quote(), Number.NaN), { code: 'REVIEW_REQUIRED' });
});
test('all built-ins and structurally valid custom registrations use the same quote contract', () => {
  const custom = createNativeNetwork({ ...getNativeNetwork('ethereum'), id: 'custom-4242', name: 'Custom', chainId: '4242', rpcUrl: 'https://custom.example' });
  for (const network of [...NATIVE_NETWORKS, custom]) assert.equal(assembleFeeQuote({ ...input, chainId: network.chainId }, network, block, 6n, 1000).registrationHash, network.registrationHash);
});
test('registration tampering, block accessors and invalid estimate prices fail closed', () => {
  const network = getNativeNetwork('ethereum');
  assert.throws(() => assembleFeeQuote(input, { ...network, rpcUrl: 'https://changed.example' }, block, 6n, 1000));
  assert.throws(() => assembleFeeQuote(input, network, block, 11n, 1000));
  let called = 0;
  assert.throws(() => assembleFeeQuote(input, network, { ...block, get hash() { called++; return block.hash; } }, 6n, 1000));
  assert.equal(called, 0);
});
