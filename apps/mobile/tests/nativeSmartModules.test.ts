import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress } from '../../../source/utils/ethersV6Compat.ts';
import type { ISmartAccountMetadata, SmartAccountValidatorModule } from '../../../source/types/network.ts';
import { buildECDSAAuthenticator } from '../../../source/utils/smartAccount/authenticators.ts';
import { encodeCompositeValidatorInitData } from '../../../source/utils/smartAccount/account.ts';
import { getPaliModuleAddress, paliSmartAccountInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { buildCompositeValidatorExecutions, buildCustomValidatorInstallExecutions, buildValidatorUninstallExecutions } from '../../../source/utils/smartAccount/moduleCommands.ts';
import { assertNativeSmartModuleCommandApplied, assertNativeSmartModuleCommandCurrent, buildNativeSmartModuleCommand, snapshotNativeSmartModuleDraft, type NativeSmartModuleDraft } from '../src/smartAccount/modules.ts';

const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, '0')}`);
const accountAddress = address(100), customAddress = address(200), owner = address(300), chainId = 5700;
const compositeAddress = getAddress(getPaliModuleAddress(chainId, 'composite'));
const install: NativeSmartModuleDraft = { kind: 'install-custom', address: customAddress, name: 'External validator', initData: '0xabcd', riskAcknowledged: true };
const available = (module: SmartAccountValidatorModule) => module.id === 'ecdsa';
function metadata(): ISmartAccountMetadata {
  const built = buildECDSAAuthenticator({ chainId, config: { owners: [owner], threshold: 1 } });
  return { chainId, contractVersion: '1', deploymentSalt: '0x' + '00'.repeat(32), ...built.metadata, auth: built.auth, isDeployed: true };
}
function custom(): SmartAccountValidatorModule {
  return { id: 'custom', type: 'validator', address: customAddress, data: '0xabcd', config: { name: 'External validator', moduleType: 1, compositeCompatible: true, initData: '0xabcd' } };
}
function composite(children: string[], threshold: number): SmartAccountValidatorModule {
  return { id: 'composite', type: 'validator', address: compositeAddress, data: encodeCompositeValidatorInitData(children, threshold), config: { childValidators: children, threshold } };
}
const build = (draft: NativeSmartModuleDraft, value = metadata()) => buildNativeSmartModuleCommand({ accountAddress, metadata: value, draft, isAlgorithmAvailable: available });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('module drafts copy public fields and freeze caller-owned children', () => {
  const original = { kind: 'composite', children: [customAddress], threshold: 1 };
  const captured = snapshotNativeSmartModuleDraft(original);
  original.children[0] = accountAddress;
  assert.equal(captured.kind, 'composite');
  if (captured.kind !== 'composite') return;
  assert.deepEqual(captured.children, [customAddress]);
  assert(Object.isFrozen(captured));
  assert(Object.isFrozen(captured.children));
  assert.deepEqual(snapshotNativeSmartModuleDraft({ ...install, name: ' External validator ', initData: '0xABCD' }), install);
  assert.equal((snapshotNativeSmartModuleDraft({ ...install, name: ' ' }) as typeof install).name, customAddress);
  assert.equal((snapshotNativeSmartModuleDraft({ ...install, initData: '' }) as typeof install).initData, '0x');
});

test('module drafts reject missing consent, accessors, unbounded fields and malformed parameters', () => {
  let reads = 0;
  const getter = { ...install };
  Object.defineProperty(getter, 'address', { get() { reads++; return customAddress; }, enumerable: true });
  const childGetter = [customAddress];
  Object.defineProperty(childGetter, '0', { get() { reads++; return customAddress; }, enumerable: true });
  const invalid: unknown[] = [null, {}, { ...install, riskAcknowledged: false }, { ...install, address: address(0) }, { ...install, initData: '0x1' }, { ...install, name: 'a'.repeat(121) }, { ...install, initData: '0x' + '00'.repeat(65537) }, { ...install, capability: () => undefined }, getter,
    { kind: 'uninstall', address: 'not-an-address' }, { kind: 'composite', children: [customAddress, customAddress], threshold: 1 }, { kind: 'composite', children: [customAddress], threshold: 2 }, { kind: 'composite', children: Array(65).fill(customAddress), threshold: 1 }, { kind: 'composite', children: new Array(1), threshold: 1 }, { kind: 'composite', children: childGetter, threshold: 1 }];
  for (const draft of invalid) assert.throws(() => snapshotNativeSmartModuleDraft(draft));
  assert.equal(reads, 0);
});

test('custom command reuses shared install and restore calls without claiming preflight', () => {
  const value = metadata(), command = build(install, value), active = value.installedModules![0]!;
  assert.deepEqual(command.executions, buildCustomValidatorInstallExecutions({ accountAddress, activeValidatorAddress: active.address, activeValidatorData: active.data!, customValidatorAddress: customAddress, customInitData: install.initData }));
  assert.equal(command.targetAddress, customAddress);
  assert.equal(command.chainId, chainId);
  assert.equal(Object.hasOwn(command, 'preflight'), false);
  assert(Object.isFrozen(command));
  assert(Object.isFrozen(command.executions));
  assert(command.executions.every(Object.isFrozen));
  assert.throws(() => build(install, { ...value, isDeployed: false }));
  assert.throws(() => build(install, { ...value, installedModules: [...value.installedModules!, custom()] }));
  assert.throws(() => build(install, { ...value, auth: { ...value.auth!, data: '0x' } }));
});

test('uninstall uses shared guard for active validators and every installed composite child', () => {
  const value = metadata(), activeAddress = value.auth!.validator;
  value.installedModules!.push(custom());
  const draft = { kind: 'uninstall' as const, address: customAddress };
  assert.deepEqual(build(draft, value).executions, buildValidatorUninstallExecutions({ accountAddress, validatorAddress: customAddress }));
  assert.throws(() => build({ ...draft, address: activeAddress }, value));
  assert.throws(() => build({ ...draft, address: address(999) }, value));
  value.installedModules!.push(composite([customAddress, activeAddress], 1));
  assert.throws(() => build(draft, value), 'inactive composite dependencies also block removal');
});

for (const state of ['absent', 'active', 'inactive'] as const) {
  test(`composite ${state} command matches shared catalogue builder and canonical applied auth`, () => {
    const value = metadata(), child = value.auth!.validator;
    value.installedModules!.push(custom());
    if (state !== 'absent') value.installedModules!.push(composite([child], 1));
    if (state === 'active') value.auth = { module: 'composite', validator: compositeAddress, data: encodeCompositeValidatorInitData([child], 1) };
    const draft = { kind: 'composite' as const, children: [customAddress, child], threshold: 1 }, command = build(draft, value);
    assert.equal(command.targetAddress, compositeAddress);
    assert.deepEqual(command.executions, buildCompositeValidatorExecutions({ accountAddress, metadata: value, children: draft.children, threshold: 1, compositeValidatorAddress: compositeAddress, isAlgorithmAvailable: available }));
    assert.deepEqual(command.executions.map(execution => paliSmartAccountInterface.parseTransaction({ data: execution.data })!.name), state === 'active' ? ['rotateValidator'] : state === 'inactive' ? ['uninstallModule', 'installModule'] : ['installModule']);
    assert.throws(() => assertNativeSmartModuleCommandApplied(command, value));
    const applied = copy(value), target = composite([...draft.children], 1);
    applied.installedModules = [...applied.installedModules!.filter(module => module.id !== 'composite'), target];
    applied.auth = { module: 'composite', validator: compositeAddress, data: target.data! };
    assert.doesNotThrow(() => assertNativeSmartModuleCommandApplied(command, applied));
    const reordered = copy(applied), bad = reordered.installedModules!.find(module => module.id === 'composite')!;
    if (bad.id === 'composite') bad.config.childValidators.reverse();
    assert.throws(() => assertNativeSmartModuleCommandApplied(command, reordered));
    const inactive = copy(applied); inactive.auth = metadata().auth;
    assert.throws(() => assertNativeSmartModuleCommandApplied(command, inactive));
  });
}

test('composite availability and lockout decisions remain in the shared builder', () => {
  const value = metadata(), child = value.auth!.validator;
  value.installedModules!.push(custom());
  assert.throws(() => build({ kind: 'composite', children: [child, customAddress], threshold: 2 }, value), /COMPOSITE_LOCKOUT/);
  assert.throws(() => buildNativeSmartModuleCommand({ accountAddress, metadata: value, draft: { kind: 'composite', children: [child], threshold: 1 }, isAlgorithmAvailable: () => false }), /COMPOSITE_LOCKOUT/);
  const incompatible = copy(value), module = incompatible.installedModules![1]!;
  if (module.id === 'custom') module.config.compositeCompatible = false;
  assert.throws(() => build({ kind: 'composite', children: [child, customAddress], threshold: 1 }, incompatible), /INVALID_COMPOSITE/);
});

test('current assertion ignores incidental metadata/key/inventory order while binding configs and auth', () => {
  const value = metadata(); value.installedModules!.push(custom());
  const command = build({ kind: 'uninstall', address: customAddress }, value), reordered = copy(value);
  reordered.installedModules!.reverse();
  for (const module of reordered.installedModules!) module.config = Object.fromEntries(Object.entries(module.config).reverse()) as typeof module.config;
  const unchanged = Object.assign({ refreshedAt: Date.now() }, reordered);
  assert.doesNotThrow(() => assertNativeSmartModuleCommandCurrent(command, unchanged));
  const config = copy(value); const ecdsa = config.installedModules![0]!;
  if (ecdsa.id === 'ecdsa') ecdsa.config.owners = [address(301)];
  assert.throws(() => assertNativeSmartModuleCommandCurrent(command, config));
  const customConfig = copy(value); const external = customConfig.installedModules![1]!;
  if (external.id === 'custom') external.config.compositeCompatible = false;
  assert.throws(() => assertNativeSmartModuleCommandCurrent(command, customConfig));
  assert.throws(() => assertNativeSmartModuleCommandCurrent(command, { ...value, chainId: 1 }));
  assert.throws(() => assertNativeSmartModuleCommandCurrent(command, { ...value, auth: { ...value.auth!, module: 'custom' } }));
});

test('custom installation application requires the installed target and preserves the original active auth', () => {
  const value = metadata(), command = build(install, value), applied = copy(value);
  assert.throws(() => assertNativeSmartModuleCommandApplied(command, applied));
  applied.installedModules!.push(custom());
  assert.doesNotThrow(() => assertNativeSmartModuleCommandApplied(command, applied));
  const rotated = copy(applied); rotated.auth = { module: 'custom', validator: customAddress, data: '0xabcd' };
  assert.throws(() => assertNativeSmartModuleCommandApplied(command, rotated));
  // Custom hydration observes installation. Its init data comes from the saved
  // public record and does not establish an independent on-chain config read.
  const hints = copy(applied); hints.installedModules![1]!.data = '0xbeef';
  assert.doesNotThrow(() => assertNativeSmartModuleCommandApplied(command, hints));
});

test('uninstall application requires target absence and unchanged original active auth', () => {
  const value = metadata(); value.installedModules!.push(custom());
  const command = build({ kind: 'uninstall', address: customAddress }, value);
  assert.throws(() => assertNativeSmartModuleCommandApplied(command, value));
  const applied = copy(value); applied.installedModules!.pop();
  assert.doesNotThrow(() => assertNativeSmartModuleCommandApplied(command, applied));
  assert.throws(() => assertNativeSmartModuleCommandApplied(command, { ...applied, isDeployed: false }));
});
