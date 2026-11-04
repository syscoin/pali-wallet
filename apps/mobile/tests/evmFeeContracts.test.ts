import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { getNativeNetwork, NATIVE_NETWORKS, type EvmNetworkId } from '../src/custody/networkContext.ts';
import { getEvmTransferProfile } from '../src/custody/evmTransferProfiles.ts';
import { assembleFeeQuote, assertFeeRefreshApproved, snapshotUnsignedTransfer, unsignedTransferBytes } from '../src/custody/evmFeeContracts.ts';
import type { EvmUnsignedTransfer, EvmFeeExtra } from '../src/custody/evmFeeContracts.ts';
const from = Wallet.fromPhrase('test test test test test test test test test test test junk').address;
const input: EvmUnsignedTransfer = { type: 2, from, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '100', gasLimit: '21000', data: '0x', maxFeePerGas: '10', maxPriorityFeePerGas: '2' };
const block = { number: '100', hash: '0x' + '1'.repeat(64) };
const quote = (id: EvmNetworkId = 'ethereum', extras: EvmFeeExtra[] = [], changes: Partial<EvmUnsignedTransfer> = {}, expires = 1000) =>
  assembleFeeQuote({ ...input, chainId: getNativeNetwork(id).chainId, ...changes }, getNativeNetwork(id), getEvmTransferProfile(id), block, 6n, extras, expires);
const extra = (amount: string): EvmFeeExtra => ({ kind: 'l1-data', estimateUnits: amount, enforceableByEnvelope: false });

test('exact unsigned snapshots reject secret/signature fields and never serialize usable signed bytes', () => {
  for (const network of NATIVE_NETWORKS) {
    const snapshot = snapshotUnsignedTransfer({ ...input, chainId: network.chainId }, network);
    const raw = unsignedTransferBytes(snapshot);
    assert.equal(Transaction.from(raw).isSigned(), false);
    assert.equal(Transaction.from(raw).chainId, BigInt(network.chainId));
    assert(Object.isFrozen(snapshot));
  }
  for (const change of [{ signature: '0x01' }, { privateKey: '0x01' }, { nonce: '01' }, { gasLimit: '1' }, { chainId: '57' }, { maxPriorityFeePerGas: '11' }]) {
    assert.throws(() => snapshotUnsignedTransfer({ ...input, ...change } as EvmUnsignedTransfer, getNativeNetwork('ethereum')));
  }
  let getterCalls = 0;
  assert.throws(() => snapshotUnsignedTransfer({ ...input, get from() { getterCalls++; return from; } }, getNativeNetwork('ethereum')));
  assert.equal(getterCalls, 0);
});

test('quotes distinguish signed execution caps from uncapped estimates, including zero extras', () => {
  const capped = quote();
  assert.equal(capped.envelopeFeeCapUnits, '210000');
  assert.equal(capped.estimatedEnvelopeFeeUnits, '126000');
  assert.equal(capped.maximumTotalUnits, '210100');
  const uncapped = quote('base', [extra('75'), { kind: 'operator', estimateUnits: '25', enforceableByEnvelope: false }]);
  assert.equal(uncapped.estimatedFeeUnits, '126100');
  assert.equal(uncapped.fundingEstimateUnits, '210200');
  assert.equal(uncapped.maximumTotalUnits, null);
  assert.equal(quote('rollux', [extra('0')]).maximumTotalUnits, null);
  assert(Object.isFrozen(uncapped.extras) && Object.isFrozen(uncapped.extras[0]));
  assert.throws(() => quote('rollux', [extra(((1n << 256n) - 1n).toString())]), { code: 'INVALID_RESPONSE' });
});

test('refresh retains exact envelope for reduced estimates but rejects increases, expiry and another account', () => {
  const approved = quote('rollux', [extra('100')]);
  assert.doesNotThrow(() => assertFeeRefreshApproved(approved, quote('rollux', [extra('99')]), 100));
  assert.doesNotThrow(() => assertFeeRefreshApproved(approved, quote('rollux', [extra('100')]), 100));
  assert.throws(() => assertFeeRefreshApproved(approved, quote('rollux', [extra('101')]), 100), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => assertFeeRefreshApproved(approved, quote('rollux', [extra('99')]), 1000), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => assertFeeRefreshApproved(approved, quote('rollux', [extra('99')], { nonce: '1' }), 100), { code: 'REVIEW_REQUIRED' });
  const other = quote('rollux', [extra('99')], { from: '0x2222222222222222222222222222222222222222' });
  assert.equal(approved.unsignedEnvelopeHash, other.unsignedEnvelopeHash, 'unsigned bytes do not contain sender identity');
  assert.throws(() => assertFeeRefreshApproved(approved, other, 100), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => assertFeeRefreshApproved({ ...approved }, quote('rollux', [extra('99')]), 100), { code: 'REVIEW_REQUIRED' });
});

test('profile registry leaves every new chain send-disabled and states unqualified receipt semantics', () => {
  for (const network of NATIVE_NETWORKS) assert.equal(getEvmTransferProfile(network.id).newSendEnabled, false);
  assert.equal(getEvmTransferProfile('arbitrum').feeModel, 'nitro-inclusive-gas');
  assert.equal(getEvmTransferProfile('arbitrum').settlement, 'unqualified');
  assert.equal(getEvmTransferProfile('syscoin-nevm').settlement, 'nevm-depth-observation');
  assert.equal(getEvmTransferProfile('zksys-testnet').feeSourceQualified, false);
});


test('public assembly rejects invented profiles, changed registrations and omitted uncapped costs', () => {
  const ethereum = getNativeNetwork('ethereum'), profile = getEvmTransferProfile('ethereum');
  for (const forged of [{ ...profile }, { ...profile, id: 'invented' }, { ...profile, feeModel: 'execution-only' as const, networkId: 'base' as const }]) {
    assert.throws(() => assembleFeeQuote(input, ethereum, forged, block, 6n, [], 1000), { code: 'INVALID_INPUT' });
  }
  for (const forged of [{ ...ethereum }, { ...ethereum, rpcUrl: 'https://changed.invalid' }, { ...ethereum, registrationHash: '0x' + '0'.repeat(64) }]) {
    assert.throws(() => assembleFeeQuote(input, forged, profile, block, 6n, [], 1000), { code: 'INVALID_INPUT' });
  }
  for (const id of ['base', 'rollux'] as const) {
    assert.throws(() => quote(id), { code: 'INVALID_INPUT' });
    assert.throws(() => quote(id, [{ kind: 'operator', estimateUnits: '1', enforceableByEnvelope: false }]), { code: 'INVALID_INPUT' });
  }
  assert.throws(() => quote('base', [extra('1')]), { code: 'INVALID_INPUT' });
  assert.throws(() => quote('base', [{ kind: 'operator', estimateUnits: '1', enforceableByEnvelope: false }, extra('1')]), { code: 'INVALID_INPUT' });
  assert.throws(() => quote('rollux', [extra('1'), { kind: 'operator', estimateUnits: '1', enforceableByEnvelope: false }]), { code: 'INVALID_INPUT' });
  for (const id of ['ethereum', 'syscoin-nevm', 'syscoin-nevm-testnet', 'arbitrum'] as const) {
    assert.throws(() => quote(id, [extra('1')]), { code: 'INVALID_INPUT' });
  }
  assert.throws(() => quote('zksys-testnet'), { code: 'UNQUALIFIED_PROFILE' });
});

test('component accessors cannot run while assembling an uncapped fee quote', () => {
  let calls = 0;
  const extras = [extra('1')];
  Object.defineProperty(extras, '0', { get() { calls++; return extra('0'); }, enumerable: true });
  assert.throws(() => quote('rollux', extras), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});

test('expiry and refresh use one explicit monotonic millisecond clock', () => {
  const issued = quote('ethereum', [], {}, 1000);
  const refreshed = quote('ethereum', [], {}, 1200);
  assert.equal(issued.expiresAtMonotonicMilliseconds, 1000);
  assert.doesNotThrow(() => assertFeeRefreshApproved(issued, refreshed, 999));
  assert.throws(() => assertFeeRefreshApproved(issued, refreshed, 1000), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => assertFeeRefreshApproved(issued, refreshed, Number.NaN), { code: 'REVIEW_REQUIRED' });
});
