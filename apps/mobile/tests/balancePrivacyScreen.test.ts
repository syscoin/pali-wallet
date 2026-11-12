import assert from 'node:assert/strict';
import test from 'node:test';
import { createBalancePrivacy } from '../src/core/balancePrivacy.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { PALI_LANGUAGE_OPTIONS } from '../../../source/shared/languagePolicy.ts';
import { currencyFlag } from '../../../source/shared/currencyFlags.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import * as privateAuthenticationLifecycle from '../src/screens/privateAuthenticationLifecycle.ts';

function privacyControl(preference: ReturnType<typeof createBalancePrivacy>) {
  return screenFixture(new URL('../src/screens/BalancePrivacySetting.tsx', import.meta.url), 'BalancePrivacySetting', {
    '../platform/balancePrivacy': { useBalancePrivacy: preference.getSnapshot, saveBalancePrivacy: preference.save, reloadBalancePrivacy: preference.reload },
    'react-native': { Switch: 'Switch' },
    '../ui': { Button: 'Button', Row: 'Row', Text: 'Text', colors: {} },
  });
}
function withPrivacy(tree: unknown, control: ReturnType<typeof privacyControl>) {
  const elements = screenElements(tree);
  return [...elements, ...elements.filter(element => element.type === 'BalancePrivacySetting').flatMap(() => screenElements(control.render({})))];
}

async function fixture(failSave = false, restoreAccessAvailable = false) {
  let raw: string | null = null;
  const preference = createBalancePrivacy({ async get() { return raw; }, async set(value) { if (failSave) throw Error('unavailable'); raw = value; } });
  await preference.reload();
  const privacy = privacyControl(preference);
  let autoLock = 0, recovery = 0, restoreAccess = 0, cancelled = 0;
  const f = screenFixture(new URL('../src/screens/NativeSecurity.tsx', import.meta.url), 'NativeSecurity', {
    '../platform/balancePrivacy': { useBalancePrivacy: preference.getSnapshot, saveBalancePrivacy: preference.save, reloadBalancePrivacy: preference.reload },
    './BalancePrivacySetting': { BalancePrivacySetting: 'BalancePrivacySetting' },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../platform/localization': nativeTranslationFixture,
    './privateAuthenticationLifecycle': privateAuthenticationLifecycle,
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Switch', 'View'].map(name => [name, name])),
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
  });
  const props = { keyExport: { onClear: () => () => {}, cancel() { cancelled++; }, isCurrent: () => false, isAuthenticating: () => false }, keyFormat: null,
    accountId: 'hd:60:0', accountType: 'HDAccount', accountLabel: 'Account 1', address: '0x1111111111111111111111111111111111111111',
    onViewRecovery() { recovery++; }, onAutoLock() { autoLock++; }, ...(restoreAccessAvailable ? { onRestoreAccess() { restoreAccess++; } } : {}), onLock() {}, onBack() {}, captureFailureHandler: () => () => {} };
  return { preference, render(backupConfirmed = true) { return withPrivacy(f.render({ ...props, backupConfirmed }), privacy); }, close() { f.close(); privacy.close(); },
    counts: () => ({ autoLock, recovery }), restoreCounts: () => ({ restoreAccess, cancelled }), raw: () => raw };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Security shows compact backup status, real auto-lock navigation and persisted privacy switch', async () => {
  const f = await fixture();
  try {
    let rows = f.render();
    assert.equal(rows.some(row => row.type === 'Notice'), false, 'No large backup banner in the hub');
    const phrase = rows.find(row => row.type === 'Row' && row.props.icon === 'shield'); assert(phrase);
    assert.equal(phrase.props.subtitle, 'Backed up'); phrase.props.onPress();
    const autoLock = rows.find(row => row.type === 'Row' && row.props.title === 'Auto-lock'); assert(autoLock); autoLock.props.onPress();
    assert.deepEqual(f.counts(), { autoLock: 1, recovery: 1 });
    assert.equal(f.render(false).find(row => row.type === 'Row' && row.props.icon === 'shield')?.props.subtitle, 'Back up needed');
    const privacyRow = rows.find(row => row.type === 'Row' && row.props.title === 'Privacy mode'); assert(privacyRow);
    assert.equal(privacyRow.props.subtitle, 'Hide balances and Activity summaries');
    const toggle = privacyRow.props.right;
    assert.equal(toggle.type, 'Switch'); assert.equal(toggle.props.value, false);
    toggle.props.onValueChange(true);
    assert.equal(f.preference.getSnapshot().hidden, true, 'Mask before storage finishes');
    await settle(); assert.equal(f.raw(), 'hidden');
    rows = f.render(); assert.equal(rows.find(row => row.type === 'Row' && row.props.title === 'Privacy mode')?.props.right.props.value, true);
    assert(!JSON.stringify(rows).includes('Change PIN'));
  } finally { f.close(); }
});

test('failed privacy save stays hidden and Security offers an honest reload action', async () => {
  const f = await fixture(true);
  try {
    f.render().find(row => row.type === 'Row' && row.props.title === 'Privacy mode')!.props.right.props.onValueChange(true);
    await settle();
    const rows = f.render();
    assert.equal(f.preference.getSnapshot().hidden, true);
    assert(rows.some(row => row.props.accessibilityRole === 'alert'));
    assert.equal(rows.find(row => row.type === 'Row' && row.props.title === 'Privacy mode')?.props.right.props.disabled, true);
    rows.find(row => row.type === 'Button' && row.props.title === 'Retry privacy setting')!.props.onPress();
    await settle(); assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: false });
  } finally { f.close(); }
});


test('Security exposes Restore secure access only with a real action and clears private presentation before navigation', async () => {
  const f = await fixture(false, true);
  try {
    const row = f.render().find(element => element.type === 'Row' && element.props.title === 'Restore secure access'); assert(row);
    row.props.onPress();
    assert.deepEqual(f.restoreCounts(), { restoreAccess: 1, cancelled: 1 });
  } finally { f.close(); }
});

test('watch Settings can recover a failed privacy read without opening a custody wallet or revealing early', async () => {
  let fail = true, reads = 0, writes = 0;
  const held = Promise.withResolvers<void>();
  const preference = createBalancePrivacy({
    async get() { reads++; if (fail) throw Error('Storage temporarily unavailable'); await held.promise; return 'visible'; },
    async set() { writes++; },
  });
  await preference.reload();
  const privacy = privacyControl(preference);
  const settings = screenFixture(new URL('../src/screens/RealSettings.tsx', import.meta.url), 'RealSettings', {
    './BalancePrivacySetting': { BalancePrivacySetting: 'BalancePrivacySetting' },
    './DisplayCurrency': { DisplayCurrency: 'DisplayCurrency' }, './HelpAbout': { HelpAbout: 'HelpAbout' },
    './WalletUpdatePanel': { WalletUpdatePanel: 'WalletUpdatePanel' },
    './NativePreferences': { NativePreferences: 'NativePreferences' }, './WalletBackupBadge': { WalletBackupBadge: 'WalletBackupBadge' },
    './ActivityNotifications': { ActivityNotifications: 'ActivityNotifications' },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../notifications/service': { nativeActivityNotifications: { subscribe: () => () => undefined,
      getSnapshot: () => ({ status: 'ready', enabledScopeIds: [], permission: 'denied' }), load: async () => undefined } },
    '../../../../source/shared/languagePolicy': { PALI_LANGUAGE_OPTIONS },
    '../../../../source/shared/currencyFlags': { currencyFlag },
    '../platform/localization': nativeTranslationFixture,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
  });
  const render = (watchOnly = true) => withPrivacy(settings.render({ accountLabel: 'Watch account', watchOnly, onLock() {}, onBack() {} }), privacy);
  try {
    let rows = render();
    assert(rows.some(row => row.props.accessibilityRole === 'alert'));
    assert.equal(rows.find(row => row.props.title === 'Privacy mode')!.props.right.props.value, true);
    assert.equal(rows.find(row => row.props.title === 'Privacy mode')!.props.right.props.disabled, true);
    assert.equal(rows.some(row => row.props.title === 'Security & backups'), false);
    fail = false;
    rows.find(row => row.props.title === 'Retry privacy setting')!.props.onPress();
    await settle(); rows = render();
    assert.equal(preference.getSnapshot().hidden, true, 'Retry must retain masking until the read is confirmed');
    assert.equal(rows.find(row => row.props.title === 'Privacy mode')!.props.right.props.disabled, true);
    held.resolve(); await settle(); rows = render();
    assert.deepEqual(preference.getSnapshot(), { status: 'ready', hidden: false });
    assert.equal(rows.some(row => row.props.accessibilityRole === 'alert'), false);
    assert.equal(rows.find(row => row.props.title === 'Privacy mode')!.props.right.props.value, false);
    assert.equal(rows.find(row => row.props.title === 'Privacy mode')!.props.right.props.disabled, false);
    assert.equal(reads, 2); assert.equal(writes, 0, 'Recovery only reads the stored preference');
    assert.equal(render(false).some(row => row.props.title === 'Privacy mode'), false, 'Custody keeps its existing Security control');
  } finally { held.resolve(); settings.close(); privacy.close(); }
});
