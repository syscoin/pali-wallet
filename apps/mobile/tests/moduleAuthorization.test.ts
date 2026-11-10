import assert from 'node:assert/strict';
import test from 'node:test';
import { buildECDSAAuthenticator } from '../../../source/utils/smartAccount/authenticators.ts';
import { buildSmartAccountUserOperation, encodeSmartAccountGasFees, encodeSmartAccountGasLimits } from '../../../source/utils/smartAccount/account.ts';
import type { ISmartAccountMetadata } from '../../../source/types/network.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { buildNativeSmartModuleCommand, type NativeSmartModuleConsent, type NativeSmartModuleDraft } from '../src/smartAccount/modules.ts';
import { NativeSmartAccountOperation, type NativeSmartAccountOperationHost, type NativeSmartAccountResolvedIntent, type PreparedSmartAccountOperation } from '../src/smartAccount/operation.ts';

const account = '0x1111111111111111111111111111111111111111', owner = '0x2222222222222222222222222222222222222222', external = '0x3333333333333333333333333333333333333333';
const hash = '0x' + 'aa'.repeat(32);
const install: NativeSmartModuleDraft = { kind: 'install-custom', address: external, name: 'External validator', initData: '0x1234' };
function moduleIntent(kind: NativeSmartModuleDraft['kind'] = 'install-custom'): Extract<NativeSmartAccountResolvedIntent, { kind: 'modules' }> {
  const built = buildECDSAAuthenticator({ chainId: 1, config: { owners: [owner], threshold: 1 } });
  const metadata: ISmartAccountMetadata = { chainId: 1, contractVersion: '1', deploymentSalt: '0x00', isDeployed: true, auth: built.auth, ...built.metadata };
  if (kind === 'uninstall') metadata.installedModules!.push({ id: 'custom', type: 'validator', address: external, data: '0x1234', config: { name: 'External validator', moduleType: 1, initData: '0x1234' } });
  const draft: NativeSmartModuleDraft = kind === 'install-custom' ? install : kind === 'uninstall' ? { kind, address: external } : { kind, children: [built.auth.validator], threshold: 1 };
  return { kind: 'modules', command: buildNativeSmartModuleCommand({ accountAddress: account, metadata, draft, removalPolicy: 'active-composite', deploymentAdmission: 'deployed-only', isAlgorithmAvailable: module => module.id === 'ecdsa' }) };
}
function fixture(intent: NativeSmartAccountResolvedIntent = moduleIntent()) {
  let ownerSdkCalls = 0, submitted = 0, refreshed = 0, live = true, failRefresh = false;
  const executions = intent.kind === 'modules' ? intent.command.executions.map(execution => ({ ...execution })) : [{ target: external, data: '0x', value: '1' }];
  const prepared = { actionHash: hash, executions, userOperation: buildSmartAccountUserOperation({ sender: account, nonce: '0', callData: '0x',
    accountGasLimits: encodeSmartAccountGasLimits({ callGasLimit: 1, verificationGasLimit: 1 }), gasFees: encodeSmartAccountGasFees({ maxFeePerGas: 2, maxPriorityFeePerGas: 1 }), preVerificationGas: '1' }) } as PreparedSmartAccountOperation;
  const host: NativeSmartAccountOperationHost = {
    account, intent, network: getNativeNetwork('ethereum'), authorizationExpiresAt: Date.now() + 60000, background() {},
    assertCurrent() { assert(live, 'Owner changed'); },
    async prepare() { return { kind: 'authorization', intent, operation: prepared }; },
    // This is the operation's private owner-signing boundary. Invalid public
    // consent must be rejected before the real runtime can invoke its SDK.
    async sign() { ownerSdkCalls++; return '0xsigned'; },
    async submit(_prepared, _signature, _signal, guard, reviewPayer, broadcast) {
      guard(); submitted++;
      await reviewPayer({ transaction: { from: owner, to: account, nonce: '0', value: '0', data: '0x', gasLimit: '1', type: 2, chainId: '1', maxFeePerGas: '2', maxPriorityFeePerGas: '1', accessList: [] }, maximumFeeUnits: '2', coveredFeeUnits: '0', maximumTotalUnits: '2', purpose: 'submit-operation' }, guard);
      guard(); broadcast(hash, 'submit-operation'); return hash;
    },
    async refreshMetadata(_signal, guard) { guard(); refreshed++; if (failRefresh) throw Error('Read unavailable'); },
  };
  const model = new NativeSmartAccountOperation(host);
  return { model, host, counts: () => ({ ownerSdkCalls, submitted, refreshed }), revoke() { live = false; }, refreshFails(value: boolean) { failRefresh = value; } };
}
async function complete(f: ReturnType<typeof fixture>, consent?: NativeSmartModuleConsent) {
  const revision = f.model.getSnapshot().revision;
  const work = consent ? f.model.authorizeModuleChange(revision, consent) : f.model.authorize(revision);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.model.getSnapshot().phase, 'review-fee');
  f.model.confirmPayer(f.model.getSnapshot().payerReview!.id);
  await work;
  assert.equal(f.model.getSnapshot().phase, 'complete');
}

for (const kind of ['install-custom', 'uninstall', 'composite'] as const) test(`generic authorization rejects ${kind} modules before private owner signing`, async () => {
  const f = fixture(moduleIntent(kind));
  try {
    await f.model.prepare(); assert.equal(f.model.getSnapshot().phase, 'authorize');
    await assert.rejects(f.model.authorize(f.model.getSnapshot().revision), /Explicit module authorization is required/);
    assert.deepEqual(f.counts(), { ownerSdkCalls: 0, submitted: 0, refreshed: 0 });
    assert.equal(f.model.getSnapshot().phase, 'authorize');
  } finally { await f.model.dispose(); }
});

test('module authorization rejects omitted, false, wrong-kind and accessor consent without signing', async () => {
  const f = fixture(); let getterCalls = 0;
  const accessor = { kind: 'install-custom' };
  Object.defineProperty(accessor, 'riskAcknowledged', { get() { getterCalls++; return true; }, enumerable: true });
  try {
    await f.model.prepare();
    for (const consent of [undefined, null, {}, { kind: 'install-custom' }, { kind: 'install-custom', riskAcknowledged: false }, { kind: 'uninstall' }, { kind: 'composite' }, { kind: 'install-custom', riskAcknowledged: true, arbitrary: true }, accessor]) {
      await assert.rejects(f.model.authorizeModuleChange(f.model.getSnapshot().revision, consent as NativeSmartModuleConsent), /Explicit module authorization is required/);
      assert.deepEqual(f.counts(), { ownerSdkCalls: 0, submitted: 0, refreshed: 0 });
      assert.equal(f.model.getSnapshot().phase, 'authorize');
    }
    assert.equal(getterCalls, 0);
    await complete(f, { kind: 'install-custom', riskAcknowledged: true });
    assert.deepEqual(f.counts(), { ownerSdkCalls: 1, submitted: 1, refreshed: 1 });
  } finally { await f.model.dispose(); }
});

for (const kind of ['uninstall', 'composite'] as const) test(`${kind} authorization requires matching explicit consent and preserves separate payer consent`, async () => {
  const f = fixture(moduleIntent(kind));
  try {
    await f.model.prepare();
    await assert.rejects(f.model.authorizeModuleChange(f.model.getSnapshot().revision, { kind: 'install-custom', riskAcknowledged: true }), /Explicit module authorization is required/);
    await assert.rejects(f.model.authorizeModuleChange(f.model.getSnapshot().revision, { kind, riskAcknowledged: true } as never), /Explicit module authorization is required/);
    assert.equal(f.counts().ownerSdkCalls, 0);
    await complete(f, { kind });
    assert.deepEqual(f.counts(), { ownerSdkCalls: 1, submitted: 1, refreshed: 1 });
  } finally { await f.model.dispose(); }
});

test('module authorization keeps existing revision, owner and duplicate-approval guards', async () => {
  const f = fixture();
  try {
    await f.model.prepare();
    const revision = f.model.getSnapshot().revision, consent = { kind: 'install-custom', riskAcknowledged: true } as const;
    await f.model.authorizeModuleChange(revision - 1, consent);
    assert.equal(f.counts().ownerSdkCalls, 0);
    const first = f.model.authorizeModuleChange(revision, consent), duplicate = f.model.authorizeModuleChange(revision, consent);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.model.getSnapshot().phase, 'review-fee'); assert.equal(f.counts().ownerSdkCalls, 1);
    f.model.confirmPayer(f.model.getSnapshot().payerReview!.id); await Promise.all([first, duplicate]);
    assert.deepEqual(f.counts(), { ownerSdkCalls: 1, submitted: 1, refreshed: 1 });
  } finally { await f.model.dispose(); }
  const revoked = fixture();
  try {
    await revoked.model.prepare(); revoked.revoke();
    await revoked.model.authorizeModuleChange(revoked.model.getSnapshot().revision, { kind: 'install-custom', riskAcknowledged: true });
    assert.equal(revoked.model.getSnapshot().phase, 'failed'); assert.equal(revoked.counts().ownerSdkCalls, 0);
  } finally { await revoked.model.dispose(); }
});

test('explicit module authorization retains metadata-only retry without repeated owner approval', async () => {
  const f = fixture(); f.refreshFails(true);
  try {
    await f.model.prepare(); await complete(f, { kind: 'install-custom', riskAcknowledged: true });
    assert.equal(f.model.getSnapshot().metadataRefresh, 'failed');
    f.refreshFails(false); await f.model.retryMetadata();
    await f.model.authorizeModuleChange(f.model.getSnapshot().revision, { kind: 'install-custom', riskAcknowledged: true });
    assert.equal(f.model.getSnapshot().metadataRefresh, 'complete');
    assert.deepEqual(f.counts(), { ownerSdkCalls: 1, submitted: 1, refreshed: 2 });
  } finally { await f.model.dispose(); }
});

test('ordinary authorization remains on the same owner and payer lifecycle', async () => {
  const f = fixture({ kind: 'native-transfer', recipient: external, amountUnits: '1' });
  try {
    await f.model.prepare();
    await assert.rejects(f.model.authorizeModuleChange(f.model.getSnapshot().revision, { kind: 'uninstall' }), /Explicit module authorization is required/);
    assert.equal(f.counts().ownerSdkCalls, 0);
    await complete(f);
    assert.deepEqual(f.counts(), { ownerSdkCalls: 1, submitted: 1, refreshed: 0 });
  } finally { await f.model.dispose(); }
});
