import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
for (const ending of ['failure', 'back', 'background', 'account-change', 'cancel'] as const) {
  test(`key reveal ${ending} only publishes feedback for its current request`, async () => {
    const listeners = new Set<() => void>(), activity = new Set<(state: string) => void>();
    const pending = Promise.withResolvers<never>();
    const app = { currentState: 'active', addEventListener(_event: string, cb: (state: string) => void) { activity.add(cb); return { remove() { activity.delete(cb); } }; } };
    const clear = () => { for (const listener of listeners) listener(); };
    const keyExport = { onClear(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }, cancel: clear,
      begin() { clear(); return pending.promise; }, isAuthenticating: () => false, isCurrent: () => false };
    const f = screenFixture(new URL('../src/screens/NativeSecurity.tsx', import.meta.url), 'NativeSecurity', {
      'react-native': { View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator', Switch: 'Switch', AppState: app,
        BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: (x: unknown) => x } },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(x => [x, x])), colors: {}, styles: {} },
      '../platform/balancePrivacy': { useBalancePrivacy: () => ({ status: 'ready', hidden: false }), reloadBalancePrivacy() {}, saveBalancePrivacy() {} },
      './BalancePrivacySetting': { BalancePrivacySetting: 'BalancePrivacySetting' },
      '../platform/localization': { useNativeTranslation: () => ({ t: (key: string) => key }) },
      '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'Face ID', icon: 'face-id' }) },
    });
    let props = { keyExport, keyFormat: 'evm', accountId: 'hd:60:0', accountType: 'HDAccount', accountLabel: 'Wallet', address: '0x' + '1'.repeat(40), backupConfirmed: true,
      onViewRecovery() {}, onLock() {}, onBack() {}, captureFailureHandler: () => () => {} };
    const nodes = () => screenElements(f.render(props));
    const control = (type: string, prop: string, value?: string) => { const node = nodes().find(n => n.type === type && (value === undefined || n.props[prop] === value)); assert(node); return node; };
    try {
      control('Row', 'title', 'mobile.security.revealAccountKey').props.onPress();
      const work = control('Button', 'title', 'mobile.security.reveal').props.onPress();
      if (ending === 'back') control('Header', '').props.onBack();
      if (ending === 'background') { app.currentState = 'background'; for (const cb of activity) cb('background'); }
      if (ending === 'account-change') { props = { ...props, accountId: 'hd:60:1', address: '0x' + '2'.repeat(40) }; nodes(); }
      clear(); pending.reject(new Error(ending === 'cancel' ? 'CANCELLED' : 'AUTH_THROTTLED')); await work;
      const feedback = nodes().filter(n => n.props.accessibilityRole === 'alert');
      assert.equal(feedback.length, ending === 'failure' ? 1 : 0);
      if (ending === 'failure') assert.deepEqual(feedback[0]!.children, ['mobile.security.revealFailed']);
    } finally { f.close(); }
  });
}
