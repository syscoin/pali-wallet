import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSmartAccountOperation, type NativeSmartAccountOperationHost, type PreparedSmartAccountOperation } from '../src/smartAccount/operation.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { buildGuardianPolicyExecutions } from '../../../source/utils/smartAccount/guardianPolicy.ts';
import { encodeSmartAccountGasLimits, encodeSmartAccountGasFees } from '../../../source/utils/smartAccount/account.ts';

const command = Object.freeze({ kind: 'install' as const, accountAddress: '0x' + '11'.repeat(20), chainId: 1,
  guardian: '0x' + '22'.repeat(20), delaySeconds: 259200 });
const intent = Object.freeze({ kind: 'guardian-policy' as const, command });
const hash = '0x' + 'aa'.repeat(32);
const prepared = { actionHash: hash, executions: buildGuardianPolicyExecutions(command), userOperation: {
  accountGasLimits: encodeSmartAccountGasLimits({ callGasLimit: 1, verificationGasLimit: 1 }),
  gasFees: encodeSmartAccountGasFees({ maxFeePerGas: 2, maxPriorityFeePerGas: 1 }),
  preVerificationGas: '1', paymasterAndData: '0x', nonce: '0', initCode: '0x', callData: '0x',
} } as PreparedSmartAccountOperation;
function fixture() {
  let signed = 0, submitted = 0, refreshed = 0, live = true, failRefresh = true;
  const host: NativeSmartAccountOperationHost = {
    intent, account: command.accountAddress, network: getNativeNetwork('ethereum'),
    assertCurrent() { assert(live, 'owner changed'); },
    async prepare() { return { kind: 'authorization', intent, operation: prepared }; },
    async sign() { signed++; return '0xsigned'; },
    async submit(_prepared, _signature, _signal, guard, _payer, broadcast) { guard(); submitted++; broadcast(hash); return hash; },
    async refreshMetadata(_signal, guard) { guard(); refreshed++; if (failRefresh) throw Error('read unavailable'); },
  };
  return { model: new NativeSmartAccountOperation(host), host, counts: () => ({ signed, submitted, refreshed }),
    restore() { failRefresh = false; }, revoke() { live = false; } };
}

test('policy intent requires metadata reconciliation and exact shared executions', async () => {
  const f = fixture();
  try {
    assert.throws(() => new NativeSmartAccountOperation({ ...f.host, refreshMetadata: undefined }), /reconciliation/);
    const invalid = new NativeSmartAccountOperation({ ...f.host, async prepare() {
      return { kind: 'authorization', intent, operation: { ...prepared, executions: [] } };
    } });
    try { await invalid.prepare(); assert.equal(invalid.getSnapshot().phase, 'failed'); }
    finally { invalid.dispose(); }
    assert.deepEqual(f.counts(), { signed: 0, submitted: 0, refreshed: 0 });
  } finally { f.model.dispose(); }
});

test('metadata-only retry preserves the completed transaction and cannot repeat signing or submission', async () => {
  const f = fixture();
  try {
    await f.model.prepare(); await f.model.authorize(f.model.getSnapshot().revision);
    assert.equal(f.model.getSnapshot().phase, 'complete');
    assert.equal(f.model.getSnapshot().transactionHash, hash);
    assert.equal(f.model.getSnapshot().metadataRefresh, 'failed');
    assert.deepEqual(f.counts(), { signed: 1, submitted: 1, refreshed: 1 });
    f.restore(); await f.model.retryMetadata();
    await f.model.authorize(f.model.getSnapshot().revision); await f.model.retryMetadata();
    assert.equal(f.model.getSnapshot().metadataRefresh, 'complete');
    assert.deepEqual(f.counts(), { signed: 1, submitted: 1, refreshed: 2 });
  } finally { f.model.dispose(); }
});

test('a retired owner cannot retry metadata or alter its retained completion', async () => {
  const f = fixture();
  try {
    await f.model.prepare(); await f.model.authorize(f.model.getSnapshot().revision);
    f.restore(); f.revoke(); await f.model.retryMetadata();
    assert.equal(f.model.getSnapshot().phase, 'complete');
    assert.equal(f.model.getSnapshot().transactionHash, hash);
    assert.deepEqual(f.counts(), { signed: 1, submitted: 1, refreshed: 1 });
  } finally { f.model.dispose(); }
});
