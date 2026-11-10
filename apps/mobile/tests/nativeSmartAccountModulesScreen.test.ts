import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture, englishI18n } from './localizationFixture.ts';
import { listCompositeChildCandidates } from '../../../source/utils/smartAccount/custom.ts';
import { canRemoveValidatorModule } from '../../../source/utils/smartAccount/moduleCommands.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { getNativeNetwork, getNativeSendContext } from '../src/custody/networkContext.ts';
import type { ISmartAccountMetadata } from '../../../source/types/network.ts';
import type { NativeSmartAccountOperationSnapshot } from '../src/smartAccount/operation.ts';

const t = englishI18n.t.bind(englishI18n);
const ownerAddress = '0x1111111111111111111111111111111111111111';
const childAddress = '0x2222222222222222222222222222222222222222';
const compositeAddress = '0x3333333333333333333333333333333333333333';
const customAddress = '0x4444444444444444444444444444444444444444';
const spareAddress = '0x5555555555555555555555555555555555555555';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function metadata(): ISmartAccountMetadata {
  return { chainId: 1, contractVersion: '1', isDeployed: true, deploymentSalt: '0x00',
    auth: { validator: ownerAddress, data: '0x', module: 'ecdsa' },
    customModules: [{ address: customAddress, name: 'Discovery only', moduleType: 1, initData: '0x' }],
    installedModules: [
      { type: 'validator', id: 'ecdsa', address: ownerAddress, config: { owners: [ownerAddress], threshold: 1 } },
      { type: 'validator', id: 'custom', address: childAddress, config: { name: 'Installed child', moduleType: 1, compositeCompatible: true } },
      { type: 'validator', id: 'composite', address: compositeAddress, config: { childValidators: [ownerAddress, childAddress], threshold: 1 } },
      { type: 'validator', id: 'custom', address: spareAddress, config: { name: 'Spare validator', moduleType: 1, compositeCompatible: false } },
    ] };
}
const ui = { ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} };
function fixture() {
  let returned = 0, reads = 0, opens = 0, disposed = 0;
  let readWait: Promise<void> = Promise.resolve(), openWait: Promise<void> = Promise.resolve();
  const drafts: any[] = [], preflights: string[] = [], events = new Map<string, (...args: any[]) => void>();
  const native = { AppState: { currentState: 'active', addEventListener(event: string, callback: (...args: any[]) => void) { events.set(event, callback); return { remove() { events.delete(event); } }; } },
    BackHandler: { addEventListener(_event: string, callback: () => boolean) { events.set('back', callback); return { remove() { events.delete('back'); } }; } }, Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value }, View: 'View', Switch: 'Switch', ActivityIndicator: 'ActivityIndicator' };
  const operation = { async dispose() { disposed++; } };
  const manager = { accountAddress: ownerAddress, networkName: 'Ethereum', async read() { reads++; await readWait; return metadata(); },
    async preflightCustom(address: string) { preflights.push(address); return { ok: true, failures: [], compositeCompatible: true }; },
    async openChange(draft: any, signal: AbortSignal, guard: () => void) { assert.equal(signal.aborted, false); guard(); drafts.push(draft); await openWait; return operation; } };
  const open = async (_signal: AbortSignal, guard: () => void) => { guard(); opens++; return manager; };
  const screen = screenFixture(new URL('../src/screens/NativeSmartAccountModules.tsx', import.meta.url), 'NativeSmartAccountModulesScreen', {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../../../../source/utils/smartAccount/custom': { listCompositeChildCandidates },
    '../../../../source/utils/smartAccount/moduleCommands': { canRemoveValidatorModule },
    '../platform/localization': nativeTranslationFixture,
    './NativeSend': { NativeSendInput: 'Input' }, './NativeSmartAccountOperation': { NativeSmartAccountOperationScreen: 'Operation' },
  }, { AbortController });
  const render = () => screenElements(screen.render({ open, onBack: () => { returned++; } }));
  const button = (title: string) => { const value = render().find(element => element.type === 'Button' && element.props.title === title); assert(value, `Missing button ${title}`); return value; };
  const edit = (label: string, value: string) => { const field = render().find(element => element.type === 'Input' && element.props.label === label); assert(field); field.props.onChange(value); };
  const switchValue = (label: string, value: boolean) => { const field = render().find(element => element.type === 'Switch' && element.props.accessibilityLabel === label); assert(field); field.props.onValueChange(value); };
  return { render, button, edit, switchValue, drafts, preflights, operation, close: screen.close,
    get returned() { return returned; }, get disposed() { return disposed; }, get opens() { return opens; }, get reads() { return reads; },
    holdRead(value: Promise<void>) { readWait = value; }, holdOpen(value: Promise<void>) { openWait = value; },
    back: () => events.get('back')?.(), blur: () => events.get('blur')?.(),
    background() { native.AppState.currentState = 'background'; events.get('change')?.('background'); } };
}
const contents = (elements: ReturnType<ReturnType<typeof fixture>['render']>) => elements.flatMap(element => element.children.filter(value => typeof value === 'string')).join(' ');

test('Modules lists only observed validators and protects active and composite-referenced children', async () => {
  const f = fixture(); f.render(); await tick();
  try {
    const elements = f.render(), text = contents(elements);
    assert(text.includes(ownerAddress)); assert(text.includes(childAddress)); assert(!text.includes(customAddress)); assert(!text.includes('Discovery only'));
    assert.equal(elements.filter(element => element.type === 'Icon' && element.props.name === 'check').length, 4);
    assert.equal(elements.filter(element => element.props.accessibilityLabel === t('smartAccountHub.active')).length, 1);
    assert.equal(elements.filter(element => element.props.accessibilityLabel === t('smartAccountHub.installed')).length, 3);
    const uninstalls = elements.filter(element => element.type === 'Button' && element.props.title === t('smartAccountHub.uninstall'));
    assert.equal(uninstalls.length, 2); assert.deepEqual(uninstalls.map(element => element.props.disabled), [false, false]);
    uninstalls[1]!.props.onPress(); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [{ kind: 'uninstall', address: spareAddress }]);
    assert.equal(f.render()[0]!.type, 'Operation');
  } finally { f.close(); }
});

test('custom install preflights public fields and opens review without a risk acknowledgment', async () => {
  const f = fixture(); f.render(); await tick();
  try {
    f.button(t('smartAccountHub.customModule')).props.onPress();
    f.edit(t('smartAccountHub.moduleAddress'), customAddress); f.edit(t('smartAccountHub.moduleName'), 'My validator');
    assert(f.button(t('smartAccountHub.install')).props.disabled);
    f.button(t('smartAccountHub.checkModule')).props.onPress(); await tick();
    assert.deepEqual(f.preflights, [customAddress]); assert.equal(f.button(t('smartAccountHub.install')).props.disabled, false);
    assert(!f.render().some(element => element.type === 'Switch'));
    assert(!f.render().some(element => element.type === 'Notice' && element.props.body === t('smartAccountHub.customRisk')));
    f.edit(t('smartAccountHub.moduleInitData'), '0x1'); assert(f.button(t('smartAccountHub.install')).props.disabled);
    f.edit(t('smartAccountHub.moduleInitData'), '0xab'); assert.equal(f.button(t('smartAccountHub.install')).props.disabled, false);
    f.edit(t('smartAccountHub.moduleAddress'), spareAddress); assert(f.button(t('smartAccountHub.install')).props.disabled);
    f.edit(t('smartAccountHub.moduleAddress'), customAddress); f.button(t('smartAccountHub.checkModule')).props.onPress(); await tick();
    const press = f.button(t('smartAccountHub.install')).props.onPress; press(); press(); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [{ kind: 'install-custom', address: customAddress, name: 'My validator', initData: '0xab' }]);
  } finally { f.close(); }
});

test('composite editor restores installed choices and threshold and admits only shared eligible children', async () => {
  const f = fixture(); f.render(); await tick();
  try {
    f.button(t('settings.compositeAuthenticator')).props.onPress();
    const elements = f.render(), choices = elements.filter(element => element.type === 'Switch');
    assert.equal(choices.length, 2); assert(choices.every(element => element.props.value === true));
    assert.equal(elements.find(element => element.type === 'Input')!.props.value, '1');
    f.edit(t('smartAccountHub.compositeThreshold'), '3'); assert(f.button(t('smartAccountHub.compositeSavePolicy')).props.disabled);
    f.edit(t('smartAccountHub.compositeThreshold'), '1'); f.button(t('smartAccountHub.compositeSavePolicy')).props.onPress(); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [{ kind: 'composite', children: [ownerAddress, childAddress], threshold: 1 }]);
  } finally { f.close(); }
});

for (const close of ['back', 'background', 'blur', 'close'] as const) test(`${close} retires stale module callbacks before opening an operation`, async () => {
  const f = fixture(); f.render(); await tick();
  const stale = f.render().filter(element => element.type === 'Button' && element.props.title === t('smartAccountHub.uninstall'))[1]!.props.onPress;
  try { f[close](); stale(); await tick(); assert.equal(f.drafts.length, 0); }
  finally { f.close(); }
});

test('leaving during operation opening drains and disposes the late operation before returning', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(); f.render(); await tick(); f.holdOpen(held.promise);
  try {
    f.render().filter(element => element.type === 'Button' && element.props.title === t('smartAccountHub.uninstall'))[1]!.props.onPress(); await tick();
    assert.equal(f.drafts.length, 1); f.back(); await tick(); assert.equal(f.returned, 0);
    held.resolve(); await tick(); assert.equal(f.returned, 1); assert.equal(f.disposed, 1); assert.notEqual(f.render()[0]!.type, 'Operation');
  } finally { held.resolve(); f.close(); }
});

test('a cancelled initial screen never opens its manager', async () => {
  const f = fixture(); f.render(); f.back(); await tick();
  try { assert.equal(f.opens, 0); assert.equal(f.reads, 0); assert.equal(f.returned, 1); }
  finally { f.close(); }
});

test('leaving during inventory read drains the read and never publishes an actionable stale screen', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(); f.holdRead(held.promise); f.render(); await tick();
  try {
    assert.equal(f.reads, 1); f.background(); await tick(); assert.equal(f.returned, 0);
    held.resolve(); await tick(); assert.equal(f.returned, 1); assert.equal(f.drafts.length, 0);
    assert(!f.render().some(element => element.type === 'Button' && element.props.title === t('smartAccountHub.uninstall')));
  } finally { held.resolve(); f.close(); }
});

test('returning from a module operation disposes its owner and reloads observed inventory', async () => {
  const f = fixture(); f.render(); await tick();
  try {
    const stale = f.render().filter(element => element.type === 'Button' && element.props.title === t('smartAccountHub.uninstall'))[1]!.props.onPress;
    stale(); await tick(); const operation = f.render()[0]!; assert.equal(operation.type, 'Operation');
    operation.props.onBack(); await tick(); f.render(); await tick();
    assert.equal(f.opens, 2); assert.equal(f.reads, 2); assert.equal(f.disposed, 1); assert.notEqual(f.render()[0]!.type, 'Operation');
    stale(); await tick(); assert.equal(f.drafts.length, 1);
  } finally { f.close(); }
});

test('module review displays exact public changes, both authorization stages and confirmed metadata retry', () => {
  const calls: string[] = [];
  const screen = screenFixture(new URL('../src/screens/NativeSmartAccountOperation.tsx', import.meta.url), 'NativeSmartAccountOperationContent', {
    'react-native': { StyleSheet: { create: (value: unknown) => value }, View: 'View', Switch: 'Switch', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../../../../source/shared/erc20': { formatTokenUnits: () => '' }, '../core/amounts': { formatBaseUnits }, '../custody/networkContext': { getNativeSendContext },
    '../platform/localization': nativeTranslationFixture, './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' }, './guardianPolicyLabels': { guardianDelayLabel: () => '' },
    './useDappLedgerConnection': { useOwnedLedgerConnection: () => ({}) },
  });
  const state: NativeSmartAccountOperationSnapshot = { phase: 'authorize', revision: 1, account: ownerAddress, network: getNativeNetwork('ethereum'), maximumPrefundUnits: '1', userOperationHash: null, authorization: null, payerReview: null, transactionHash: null, userOperationSubmissionStarted: false, error: null,
    intent: { kind: 'modules', command: { accountAddress: ownerAddress, chainId: 1, targetAddress: compositeAddress, deploymentAdmission: 'deployed-only', removalPolicy: 'all-installed-composites', sourceIsDeployed: true, sourceAuthHash: '0x', sourceAuthModule: 'ecdsa', sourceModuleFingerprint: 'public', executions: [], draft: { kind: 'composite', children: [ownerAddress, childAddress], threshold: 1 } } } };
  const render = (snapshot = state) => screenElements(screen.render({ state: snapshot, onBack() {}, authorize() { calls.push('authorize'); }, confirmPayer(id: number) { calls.push(`payer:${id}`); }, retryMetadata() { calls.push('refresh'); } }));
  try {
    const initial = render(), text = contents(initial);
    assert(text.includes(compositeAddress)); assert(text.includes(childAddress)); assert(text.includes('1 of 2 selected methods must approve.'));
    initial.find(element => element.type === 'Button' && element.props.title === t('mobile.smartAccountModules.authorize'))!.props.onPress();
    const fee = render({ ...state, phase: 'review-fee', payerReview: { id: 7, purpose: 'submit-operation', transaction: { from: spareAddress, value: '0' } as any, maximumFeeUnits: '2', maximumTotalUnits: '2', coveredFeeUnits: '0' } });
    assert(!fee.some(element => element.type === 'Button' && element.props.title === t('mobile.smartAccountModules.authorize')));
    fee.find(element => element.type === 'Button' && element.props.title === t('mobile.smartAccountModules.confirm'))!.props.onPress();
    const complete = render({ ...state, phase: 'complete', transactionHash: '0xconfirmed', metadataRefresh: 'failed' });
    assert(complete.some(element => element.type === 'Notice' && element.props.title === t('mobile.smartAccountModules.confirmed')));
    assert(complete.some(element => element.type === 'Notice' && element.props.body === t('mobile.smartAccountModules.refreshHint')));
    complete.find(element => element.type === 'Button' && element.props.title === t('mobile.smartAccountModules.refresh'))!.props.onPress();
    assert.deepEqual(calls, ['authorize', 'payer:7', 'refresh']);
    for (const kind of ['install-custom', 'uninstall'] as const) {
      const draft = kind === 'install-custom' ? { kind, address: customAddress, name: 'Exact custom name', initData: '0xabcd' as const } : { kind, address: customAddress };
      const elements = render({ ...state, intent: { kind: 'modules', command: { ...(state.intent.kind === 'modules' ? state.intent.command : {} as never), draft, targetAddress: customAddress } } });
      assert(contents(elements).includes(customAddress));
      if (kind === 'install-custom') { assert(contents(elements).includes('Exact custom name')); assert(contents(elements).includes('0xabcd')); }
    }
  } finally { screen.close(); }
});

function customReviewState(): NativeSmartAccountOperationSnapshot {
  return { phase: 'authorize', revision: 7, account: ownerAddress, network: getNativeNetwork('ethereum'), maximumPrefundUnits: '1', userOperationHash: '0x' + 'ab'.repeat(32), authorization: null, payerReview: null, transactionHash: null, userOperationSubmissionStarted: false, error: null,
    intent: { kind: 'modules', command: { accountAddress: ownerAddress, chainId: 1, targetAddress: customAddress, deploymentAdmission: 'deployed-only', removalPolicy: 'all-installed-composites', sourceIsDeployed: true, sourceAuthHash: '0x', sourceAuthModule: 'ecdsa', sourceModuleFingerprint: 'public', executions: [], draft: { kind: 'install-custom', address: customAddress, name: 'Reviewed validator', initData: '0xabcd' } } } };
}

function consentReviewFixture() {
  const events = new Map<string, () => void>(), acknowledgements: boolean[] = [];
  const native = { StyleSheet: { create: (value: unknown) => value }, View: 'View', Switch: 'Switch', Platform: { OS: 'android' },
    AppState: { currentState: 'active', addEventListener(event: string, callback: () => void) { events.set(event, callback); return { remove() { events.delete(event); } }; } } };
  const screen = screenFixture(new URL('../src/screens/NativeSmartAccountOperation.tsx', import.meta.url), 'NativeSmartAccountOperationContent', {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../../../../source/shared/erc20': { formatTokenUnits: () => '' }, '../core/amounts': { formatBaseUnits }, '../custody/networkContext': { getNativeSendContext },
    '../platform/localization': nativeTranslationFixture, './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' }, './guardianPolicyLabels': { guardianDelayLabel: () => '' },
    './useDappLedgerConnection': { useOwnedLedgerConnection: () => ({}) },
  });
  let state = customReviewState(), disabled = false;
  const render = (value = state) => { state = value; return screenElements(screen.render({ state, disabled, onBack() {}, authorize(acknowledged: boolean) { acknowledgements.push(acknowledged); }, confirmPayer() {} })); };
  const button = () => { const result = render().find(element => element.type === 'Button' && element.props.title === t('mobile.smartAccountModules.authorize')); assert(result); return result; };
  const checkbox = () => { const result = render().find(element => element.type === 'Switch' && element.props.accessibilityLabel === t('smartAccountHub.customRiskAck')); assert(result); return result; };
  return { render, button, checkbox, acknowledgements, close: screen.close, state: () => state, block(value: boolean) { disabled = value; },
    background() { native.AppState.currentState = 'background'; events.get('change')?.(); }, active() { native.AppState.currentState = 'active'; }, blur() { events.get('blur')?.(); } };
}

test('shared custom authorization requires the current local checkbox and revokes a cleared acknowledgment synchronously', () => {
  const f = consentReviewFixture();
  try {
    assert(f.button().props.disabled); assert.equal(f.checkbox().props.value, false); f.button().props.onPress(); assert.deepEqual(f.acknowledgements, []);
    assert.equal(f.render().filter(element => element.type === 'Notice' && element.props.body === t('smartAccountHub.customRisk')).length, 1);
    f.checkbox().props.onValueChange(true); assert.equal(f.button().props.disabled, false);
    const held = f.button().props.onPress; held(); assert.deepEqual(f.acknowledgements, [true]);
    f.checkbox().props.onValueChange(false); held(); assert.deepEqual(f.acknowledgements, [true]); assert(f.button().props.disabled);
  } finally { f.close(); }
});

for (const change of ['intent', 'hash'] as const) test(`custom consent cannot survive an exact ${change} replacement, including held old callbacks`, () => {
  const f = consentReviewFixture();
  try {
    f.checkbox().props.onValueChange(true); const held = f.button().props.onPress, heldCheckbox = f.checkbox().props.onValueChange;
    const state = f.state();
    const next = change === 'hash' ? { ...state, userOperationHash: '0x' + 'cd'.repeat(32) } : { ...state, intent: { ...state.intent } };
    const first = f.render(next);
    assert(first.find(element => element.type === 'Button' && element.props.title === t('mobile.smartAccountModules.authorize'))!.props.disabled);
    assert.equal(first.find(element => element.type === 'Switch')!.props.value, false);
    held(); heldCheckbox(true); assert.deepEqual(f.acknowledgements, []); assert(f.button().props.disabled);
    f.checkbox().props.onValueChange(true); f.button().props.onPress(); assert.deepEqual(f.acknowledgements, [true]);
  } finally { f.close(); }
});

for (const phase of ['preparing', 'review-fee', 'failed', 'complete'] as const) test(`custom consent resets across ${phase} and cannot replay on the same operation`, () => {
  const f = consentReviewFixture();
  try {
    f.checkbox().props.onValueChange(true); const held = f.button().props.onPress, state = f.state();
    const other = f.render({ ...state, phase });
    assert(!other.some(element => element.type === 'Switch')); held(); assert.deepEqual(f.acknowledgements, []);
    f.render(state); assert.equal(f.checkbox().props.value, false); assert(f.button().props.disabled); held(); assert.deepEqual(f.acknowledgements, []);
  } finally { f.close(); }
});

for (const retire of ['close', 'background', 'blur', 'unmount'] as const) test(`${retire} retires custom consent and held input/authorization callbacks`, () => {
  const f = consentReviewFixture();
  try {
    f.checkbox().props.onValueChange(true); const held = f.button().props.onPress, heldCheckbox = f.checkbox().props.onValueChange;
    if (retire === 'close') f.render().find(element => element.type === 'Button' && element.props.title === 'Close')!.props.onPress();
    else if (retire === 'unmount') f.close(); else f[retire]();
    f.active(); heldCheckbox(true); held(); assert.deepEqual(f.acknowledgements, []);
  } finally { f.close(); }
});

test('Ledger blocking also blocks custom checkbox and authorization without changing ordinary consent', () => {
  const f = consentReviewFixture();
  try {
    f.block(true); assert(f.checkbox().props.disabled); f.checkbox().props.onValueChange(true); f.button().props.onPress(); assert.deepEqual(f.acknowledgements, []);
    f.block(false); f.checkbox().props.onValueChange(true); f.button().props.onPress(); assert.deepEqual(f.acknowledgements, [true]);
    const ordinary = f.render({ ...f.state(), intent: { kind: 'deploy' } });
    assert(!ordinary.some(element => element.type === 'Switch'));
    ordinary.find(element => element.type === 'Button' && element.props.title === 'Authorize deployment')!.props.onPress(); assert.deepEqual(f.acknowledgements, [true, false]);
  } finally { f.close(); }
});

test('wallet wrapper routes only checked current module consent through the explicit operation method and preserves Ledger gating', async () => {
  const moduleAuthorizations: unknown[][] = [], ordinaryAuthorizations: number[] = [];
  let state = customReviewState(), connected = true;
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, authorizationExpiresAt: 9999999999999,
    async prepare() {}, async dispose() {}, async authorize(revision: number) { ordinaryAuthorizations.push(revision); },
    async authorizeModuleChange(...args: unknown[]) { moduleAuthorizations.push(args); }, async confirmPayer() {}, async retryMetadata() {} };
  const screen = screenFixture(new URL('../src/screens/NativeSmartAccountOperation.tsx', import.meta.url), 'NativeSmartAccountOperationScreen', {
    'react-native': { StyleSheet: { create: (value: unknown) => value }, View: 'View', Switch: 'Switch' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../../../../source/shared/erc20': { formatTokenUnits: () => '' }, '../core/amounts': { formatBaseUnits }, '../custody/networkContext': { getNativeSendContext },
    '../platform/localization': nativeTranslationFixture, './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' }, './guardianPolicyLabels': { guardianDelayLabel: () => '' },
    './useDappLedgerConnection': { useOwnedLedgerConnection: () => ({ blocked: !connected, canApprove: () => connected, showConnect: false, modal: null }) },
  });
  const render = () => screen.render({ controller, onBack() {} });
  try {
    const first = render(); first.props.authorize(false); assert.deepEqual(moduleAuthorizations, []); assert.deepEqual(ordinaryAuthorizations, []);
    connected = false; first.props.authorize(true); assert.deepEqual(moduleAuthorizations, []);
    connected = true; first.props.authorize(true); assert.deepEqual(JSON.parse(JSON.stringify(moduleAuthorizations)), [[7, { kind: 'install-custom', riskAcknowledged: true }]]);
    state = { ...state, userOperationHash: '0x' + 'ef'.repeat(32) }; first.props.authorize(true); assert.equal(moduleAuthorizations.length, 1);
    for (const kind of ['uninstall', 'composite'] as const) {
      const previous = state.intent; assert(previous.kind === 'modules');
      state = { ...state, intent: { kind: 'modules', command: { ...previous.command, draft: kind === 'uninstall' ? { kind, address: customAddress } : { kind, children: [ownerAddress], threshold: 1 } } } };
      render().props.authorize(false);
      assert.deepEqual(JSON.parse(JSON.stringify(moduleAuthorizations.at(-1))), [7, { kind }]);
    }
    state = { ...state, intent: { kind: 'deploy' } }; render().props.authorize(false); assert.deepEqual(ordinaryAuthorizations, [7]);
  } finally { screen.close(); }
});
