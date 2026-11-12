import assert from 'node:assert/strict';
import test from 'node:test';
import type { SetStringOptions } from 'expo-clipboard';
import type { HdKeyExportPresentation } from '../src/custody/hdKeyExport.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const copiedLabel = () => nativeTranslationFixture.nativeI18n.t('components.copied');
const copyLabel = () => nativeTranslationFixture.nativeI18n.t('mobile.security.copyPrivateKey');
const failureLabel = () => nativeTranslationFixture.nativeI18n.t('transactions.copyFailed');
const settle = () => new Promise(resolve => setImmediate(resolve));
const keys = {
  evm: `0x${'11'.repeat(32)}`,
  wif: 'L_PUBLIC_TEST_WIF_NOT_A_SECRET',
  extended: 'zprv_PUBLIC_TEST_EXTENDED_KEY_NOT_A_SECRET_'.repeat(3),
};
function fixture(kind: keyof typeof keys = 'evm', platform = 'ios') {
  const listeners = new Set<() => void>(), events = new Map<string, Set<(state: string) => void>>();
  let active: HdKeyExportPresentation | null = null, reveals = 0, copied = 0;
  let copyResult: () => Promise<boolean> = async () => true;
  const writes: { value: string; options: SetStringOptions; time: number }[] = [];
  const app = { currentState: 'active', addEventListener(event: string, cb: (state: string) => void) {
    const group = events.get(event) ?? new Set(); group.add(cb); events.set(event, group);
    return { remove() { group.delete(cb); } };
  } };
  const clear = () => { active = null; for (const fn of listeners) fn(); };
  const keyExport = {
    onClear(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    cancel: clear, isAuthenticating: () => false, isCurrent: (id: string) => active?.id === id,
    async begin() { clear(); reveals++; active = Object.freeze({ id: `presentation-${reveals}`, accountId: props.accountId, address: props.address, privateKey: keys[kind] }); return active; },
  };
  const screen = screenFixture(new URL('../src/screens/NativeSecurity.tsx', import.meta.url), 'NativeSecurity', {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    './BalancePrivacySetting': { BalancePrivacySetting: 'BalancePrivacySetting' },
    'react-native': { View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator', AppState: app,
      BackHandler: { addEventListener: app.addEventListener }, Keyboard: { dismiss() {} }, Platform: { OS: platform }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { StringFormat: { PLAIN_TEXT: 'plainText' },
      async setStringAsync(value: string, options: SetStringOptions) { copied++; writes.push({ value, options, time: Date.now() }); return copyResult(); },
      getStringAsync() { assert.fail('Copy must not read the clipboard'); } },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
  });
  let props = { keyExport, keyFormat: kind === 'evm' ? 'evm' : { kind, networkLabel: 'Bitcoin', addressType: 'Native SegWit' },
    accountId: 'hd:60:0', accountType: kind === 'wif' ? 'Imported' : 'HDAccount', accountLabel: 'Public test account', address: 'public-test-address',
    backupConfirmed: true, onViewRecovery() {}, onBack() {}, onLock() {}, captureFailureHandler: () => () => {} };
  const render = () => screenElements(screen.render(props));
  const button = (title: string) => { const node = render().find(node => node.type === 'Button' && node.props.title === title); assert(node, title); return node; };
  const copy = () => { const node = render().find(node => node.type === 'IconButton'); assert(node); return node; };
  return { render, writes, copy, button, close: screen.close, counts: () => ({ reveals, copied }),
    async reveal() {
      const row = render().find(node => node.type === 'Row' && node.props.title === nativeTranslationFixture.nativeI18n.t('mobile.security.revealAccountKey'));
      if (row) { row.props.onPress(); render(); }
      await button(nativeTranslationFixture.nativeI18n.t('mobile.security.reveal')).props.onPress(); render();
    },
    hide() { button(nativeTranslationFixture.nativeI18n.t('mobile.security.hide')).props.onPress(); render(); },
    back() { render().find(node => node.type === 'Header')!.props.onBack(); render(); },
    replaceAccount() { props = { ...props, accountId: 'hd:60:1', address: 'another-public-address' }; render(); },
    expire() { active = null; },
    emit(event: string, state = '') { if (event === 'change') app.currentState = state; for (const fn of events.get(event) ?? []) fn(state); render(); },
    result(next: () => Promise<boolean>) { copyResult = next; },
  };
}

for (const platform of ['ios', 'android']) for (const kind of ['evm', 'wif', 'extended'] as const) test(`${platform} ${kind} copies only a freshly revealed current key with sensitive plain-text options`, async () => {
  const f = fixture(kind, platform);
  try {
    assert.equal(f.render().some(node => node.type === 'IconButton'), false);
    await f.reveal(); assert.deepEqual(f.counts(), { reveals: 1, copied: 0 });
    const secret = f.render().find(node => node.type === 'Text' && node.children.includes(keys[kind])); assert(secret);
    assert.equal(secret.props.selectable, false);
    assert.equal(f.copy().props.label, copyLabel());
    assert.equal(JSON.stringify(f.copy().props).includes(keys[kind]), false);
    const requestedAt = Date.now();
    await f.copy().props.onPress();
    assert.deepEqual(f.counts(), { reveals: 1, copied: 1 });
    assert.equal(f.writes[0]!.value, keys[kind]);
    const { options, time } = f.writes[0]!;
    assert.equal(options.inputFormat, 'plainText'); assert.equal(options.android?.isSensitive, true);
    assert.deepEqual(Object.keys(options.android!), ['isSensitive']);
    assert.equal(options.ios?.localOnly, true);
    const expiry = options.ios?.expiresAt?.getTime(); assert(expiry);
    assert(expiry >= requestedAt + 120000 && expiry <= time + 120000);
    assert.equal(f.copy().props.icon, 'check'); assert.equal(f.copy().props.label, copiedLabel());
    f.hide(); assert.equal(f.render().some(node => node.type === 'IconButton'), false);
    await f.reveal(); assert.equal(f.copy().props.icon, 'copy'); assert.equal(f.copy().props.label, copyLabel());
  } finally { f.close(); }
});

for (const boundary of ['hide', 'back', 'account', 'expired', 'background', 'inactive', 'blur', 'unmount'] as const) test(`retained key Copy callback refuses ${boundary}`, async () => {
  const f = fixture('evm', 'android');
  try {
    await f.reveal(); const copy = f.copy().props.onPress;
    if (boundary === 'hide') f.hide();
    if (boundary === 'back') f.back();
    if (boundary === 'account') f.replaceAccount();
    if (boundary === 'expired') f.expire();
    if (boundary === 'background' || boundary === 'inactive') f.emit('change', boundary);
    if (boundary === 'blur') f.emit('blur');
    if (boundary === 'unmount') f.close();
    await copy(); assert.equal(f.writes.length, 0);
  } finally { f.close(); }
});

for (const outcome of ['false', 'reject'] as const) test(`clipboard ${outcome} shows only localized generic feedback`, async () => {
  const f = fixture();
  try {
    await f.reveal(); f.result(async () => { if (outcome === 'reject') throw Error(keys.evm); return false; });
    await f.copy().props.onPress();
    const feedback = f.render().filter(node => node.props.accessibilityRole === 'alert');
    assert.equal(feedback.length, 1); assert.deepEqual(feedback[0]!.children, [failureLabel()]);
    assert.equal(f.copy().props.icon, 'copy'); assert.equal(f.copy().props.disabled, false);
  } finally { f.close(); }
});

test('duplicate copy taps share one dispatch and departure suppresses late feedback', async () => {
  const f = fixture(), held = Promise.withResolvers<boolean>();
  try {
    await f.reveal(); f.result(() => held.promise); const copy = f.copy().props.onPress;
    const first = copy(), duplicate = copy(); assert.equal(f.writes.length, 1); assert.equal(f.copy().props.disabled, true);
    f.back(); held.resolve(true); await Promise.all([first, duplicate]);
    assert.equal(f.render().some(node => node.props.label === copiedLabel() || node.props.accessibilityRole === 'alert'), false);
    assert.equal(f.writes.length, 1, 'departure must not add a clipboard overwrite');
  } finally { held.resolve(false); f.close(); }
});

test('an old clipboard rejection cannot clear a newer revealed key copy result', async () => {
  const f = fixture(), old = Promise.withResolvers<boolean>();
  try {
    await f.reveal(); f.result(() => old.promise); const staleCopy = f.copy().props.onPress, pending = staleCopy();
    f.hide(); await f.reveal(); await staleCopy(); assert.equal(f.writes.length, 1);
    f.result(async () => true); await f.copy().props.onPress();
    old.reject(Error(keys.evm)); await pending; await settle();
    assert.equal(f.copy().props.icon, 'check'); assert.equal(f.copy().props.label, copiedLabel());
    assert.equal(f.render().some(node => node.props.accessibilityRole === 'alert'), false);
    assert.deepEqual(f.counts(), { reveals: 2, copied: 2 });
  } finally { f.close(); }
});

for (const boundary of ['hide', 'account', 'background'] as const) test(`a clipboard failure after ${boundary} cannot publish feedback`, async () => {
  const f = fixture(), held = Promise.withResolvers<boolean>();
  try {
    await f.reveal(); f.result(() => held.promise); const pending = f.copy().props.onPress();
    if (boundary === 'hide') f.hide();
    if (boundary === 'account') f.replaceAccount();
    if (boundary === 'background') f.emit('change', 'background');
    held.reject(Error(keys.evm)); await pending;
    assert.equal(f.render().some(node => node.props.label === copiedLabel() || node.props.accessibilityRole === 'alert'), false);
    assert.equal(f.writes.length, 1);
  } finally { f.close(); }
});
