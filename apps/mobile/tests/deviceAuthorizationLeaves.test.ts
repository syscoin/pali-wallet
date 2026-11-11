import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import * as importedAccounts from '../src/custody/importedAccounts.ts';

const components = (names: string[]) => Object.fromEntries(names.map(name => [name, name]));
function environment() {
  const listeners = new Set<(state: string) => void>();
  const native = {
    ...components(['KeyboardAvoidingView', 'View', 'Modal']),
    AppState: { currentState: 'active', addEventListener(_event: string, callback: (state: string) => void) {
      listeners.add(callback); return { remove() { listeners.delete(callback); } };
    } },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} },
    Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value },
  };
  return {
    ports: {
      'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': { ...components(['Button', 'Card', 'Header', 'Icon', 'Notice', 'PaliMark', 'Row', 'Screen', 'Text']), colors: {}, styles: {} },
      './IdleActivityBoundary': { IdlePressable: 'IdlePressable', IdleTextInput: 'IdleTextInput' },
      '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
      './usePinErrorFeedback': { usePinErrorFeedback: () => ({ style: {}, shaking: false, clear() {} }) },
      '../core/biometricPresentation': { genericBiometrics: { label: 'biometrics', icon: 'fingerprint' } },
      './PinEntry': { PinField: 'PinField' }, './NoteBackupPasswordField': { NoteBackupPasswordField: 'FilePassword' },
    },
    background() { native.AppState.currentState = 'background'; [...listeners].forEach(callback => callback('background')); },
    change(state: string) { native.AppState.currentState = state; [...listeners].forEach(callback => callback(state)); },
  };
}
function find(tree: unknown, type: unknown, label?: string) {
  const value = screenElements(tree).find(node => node.type === type && (!label || node.props.label === label || node.props.title === label));
  assert(value, `Missing ${String(type)} ${label ?? ''}`); return value;
}
// The file form is a private child component; execute it with the same hook owner.
function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object' || !('type' in value)) return value;
  const element = value as ScreenElement;
  if (typeof element.type === 'function') return expand(element.type({ ...element.props, children: element.children }));
  return { ...element, children: element.children.map(expand), props: { ...element.props, footer: expand(element.props.footer) } };
}

for (const cancel of [false, true]) test(`key import submits only its reviewed key and owned authentication scope (${cancel ? 'Back cancels' : 'success'})`, async () => {
  const env = environment(), held = Promise.withResolvers<void>();
  let imported = 0, cancelled = 0;
  let submitted: { input: importedAccounts.NativeImportRequest; signal: AbortSignal; authentication: privateAuthentication.NativePrivateAuthenticationScope } | undefined;
  const f = screenFixture(new URL('../src/screens/NativeImport.tsx', import.meta.url), 'NativeImport', {
    ...env.ports, '../custody/importedAccounts': importedAccounts, '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string) => key }) },
    '../core/utxoAddresses': { UTXO_IMPORT_LABELS: {}, UTXO_IMPORT_TYPES: [] },
  }, { AbortController });
  const props = { imports: {
    previewUtxo() { assert.fail('EVM key review does not request UTXO discovery'); },
    async submit(input: importedAccounts.NativeImportRequest, context: number, catalogue: number, signal: AbortSignal, authentication: privateAuthentication.NativePrivateAuthenticationScope) {
      assert.equal(context, 4); assert.equal(catalogue, 8); submitted = { input, signal, authentication }; await held.promise;
    }, cancel() { cancelled++; },
  }, contextRevision: 4, catalogueRevision: 8, networkLabel: 'Ethereum', utxo: false, onImported() { imported++; }, onBack() {}, onSubmitStart() {}, onSubmitEnd() {} };
  const render = () => f.render(props);
  try {
    let tree = render();
    const inputs = screenElements(tree).filter(node => node.type === 'IdleTextInput');
    inputs.find(node => node.props.accessibilityLabel === 'mobile.accounts.accountName')!.props.onChangeText('Imported');
    inputs.find(node => node.props.accessibilityLabel === 'mobile.importAccount.evmKey')!.props.onChangeText('0x' + '11'.repeat(32));
    tree = render(); find(tree, 'Button', 'mobile.importAccount.review').props.onPress();
    tree = render(); screenElements(tree).find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress();
    tree = render(); assert.equal(screenElements(tree).some(node => node.type === 'PinField'), false);
    const sending = find(tree, 'Button', 'mobile.importAccount.import').props.onPress();
    assert(submitted); assert.equal(submitted.input.label, 'Imported'); assert.equal(submitted.signal.aborted, false);
    if (cancel) find(render(), 'Header').props.onBack();
    assert.equal(submitted.signal.aborted, cancel); held.resolve(); await sending;
    assert.equal(imported, cancel ? 0 : 1); assert.equal(cancelled, cancel ? 1 : 0);
    assert.equal(submitted.signal.aborted, true);
  } finally { held.resolve(); f.close(); }
});

for (const outcome of ['active', 'inactive', 'back'] as const) test(`note reveal uses a captured child authentication scope and only publishes in foreground (${outcome})`, async () => {
  const env = environment(), proof = Promise.withResolvers<void>(), visibility: boolean[] = [];
  const parent = privateAuthentication.createNativePrivateAuthenticationScope();
  const binding = privateAuthentication.bindNativePrivateAuthentication(parent, { assertCurrent() {}, isPromptActive: () => true });
  const note = Object.freeze({ amount: '1', createdAt: 1 });
  let opened = 0, backed = 0;
  const inventory = {
    notes: [note],
    async revealNote(selected: unknown, guard: () => void, child: privateAuthentication.NativePrivateAuthenticationScope) {
      assert.equal(selected, note); opened++;
      return privateAuthentication.withNativePrivateAuthentication(
        privateAuthentication.bindNativePrivateAuthenticationChild(binding, child), new AbortController().signal, () => {},
        async () => { await proof.promise; guard(); return 'private-note-fixture'; });
    },
  };
  const f = screenFixture(new URL('../src/screens/NativeNoteReveal.tsx', import.meta.url), 'NativeNoteReveal', {
    ...env.ports, '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
  }, { performance });
  const props = { inventory, note, authentication: parent, onSecretVisibilityChange: (visible: boolean) => visibility.push(visible),
    onBack() { backed++; }, onLock() {} };
  const render = () => f.render(props);
  try {
    let tree = render();
    assert.equal(screenElements(tree).some(node => node.type === 'PinField'), false);
    find(tree, 'Button', 'Reveal private note').props.onPress();
    assert.equal(opened, 1); assert.equal(parent.isAuthenticating(), true);
    tree = render();
    if (outcome === 'back') find(tree, 'Header').props.onBack();
    if (outcome === 'inactive') { env.change('inactive'); assert.equal(parent.isAuthenticating(), true); }
    proof.resolve(); await new Promise(resolve => setImmediate(resolve));
    tree = render();
    const visible = screenElements(tree).some(node => node.children.includes('private-note-fixture'));
    assert.equal(visible, outcome === 'active');
    assert.equal(visibility.includes(true), outcome === 'active');
    assert.equal(parent.isAuthenticating(), false);
    assert.equal(backed, outcome === 'back' ? 1 : 0);
    if (outcome === 'inactive') {
      env.change('active');
      find(render(), 'Button', 'Reveal private note').props.onPress();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(opened, 2, 'An inactive completion must retire its busy attempt before retry');
      assert.equal(screenElements(render()).some(node => node.children.includes('private-note-fixture')), true);
    }
  } finally { proof.resolve(); f.close(); parent.retire(); }
});

test('note export requests shared authorization without an inline PIN and keeps independent file passwords', () => {
  const env = environment(), saved: string[][] = [];
  const f = screenFixture(new URL('../src/screens/NativeNoteExport.tsx', import.meta.url), 'NativeNoteExport', env.ports);
  const props = { step: { phase: 'passwords' }, busy: false, error: '', onChoose() {}, onShowVerify() {}, onVerify() {}, onBack() {},
    onSave(...values: string[]) { saved.push(values); } };
  const render = () => expand(f.render(props));
  try {
    let tree = render();
    assert.equal(screenElements(tree).filter(node => node.type === 'PinField').length, 0);
    assert.equal(screenElements(tree).filter(node => node.type === 'FilePassword').length, 2);
    tree = render(); find(tree, 'FilePassword', 'Backup password').props.onChange('A separate long file password');
    tree = render(); find(tree, 'FilePassword', 'Confirm backup password').props.onChange('A separate long file password');
    tree = render(); const save = find(tree, 'Button', 'Save encrypted backup'); assert.equal(save.props.disabled, false); save.props.onPress();
    assert.deepEqual(saved, [['A separate long file password']]);
    tree = render(); assert.equal(screenElements(tree).filter(node => node.type === 'PinField').length, 0);
    assert.equal(find(tree, 'FilePassword', 'Backup password').props.value, '');
  } finally { f.close(); }
});

for (const review of [false, true]) test(`note restore ${review ? 'requests shared authorization without an inline PIN' : 'file opening retains the file password'}`, () => {
  const env = environment(), submitted: unknown[][] = [];
  const f = screenFixture(new URL('../src/screens/NativeNoteRestore.tsx', import.meta.url), 'NativeNoteRestore', env.ports);
  const props = { step: review ? { phase: 'review', preview: { id: 'preview-1', added: 1, duplicates: 0 } } : { phase: 'password' }, busy: false, error: '',
    onChoose() {}, onBack() {}, onOpen(...values: unknown[]) { submitted.push(values); }, onRestore(...values: unknown[]) { submitted.push(values); } };
  const render = () => expand(f.render(props));
  try {
    let tree = render();
    assert.equal(screenElements(tree).filter(node => node.type === 'PinField').length, 0);
    if (!review) find(tree, 'FilePassword', 'Backup password').props.onChange('A separate long file password');
    else assert.equal(screenElements(tree).filter(node => node.type === 'FilePassword').length, 0);
    tree = render(); find(tree, 'Button', review ? 'Restore notes' : 'Open backup').props.onPress();
    assert.deepEqual(submitted, [review ? ['preview-1'] : ['A separate long file password']]);
    if (!review) assert.equal(find(render(), 'FilePassword', 'Backup password').props.value, '');
  } finally { f.close(); }
});


test('verifying a portable note backup asks only for its file password', () => {
  const env = environment(), verified: string[] = [];
  const f = screenFixture(new URL('../src/screens/NativeNoteExport.tsx', import.meta.url), 'NativeNoteExport', env.ports);
  const props = { step: { phase: 'verify', noteCount: 1 }, busy: false, error: '', onChoose() {}, onShowVerify() {}, onBack() {},
    onSave() { assert.fail('Verify must not save'); }, onVerify(password: string) { verified.push(password); } };
  const render = () => expand(f.render(props));
  try {
    let tree = render();
    assert.equal(screenElements(tree).filter(node => node.type === 'PinField').length, 0);
    assert.equal(screenElements(tree).filter(node => node.type === 'FilePassword').length, 1);
    find(tree, 'FilePassword', 'Backup password').props.onChange('A separate long file password');
    tree = render(); find(tree, 'Button', 'Verify backup').props.onPress();
    assert.deepEqual(verified, ['A separate long file password']);
  } finally { f.close(); }
});
