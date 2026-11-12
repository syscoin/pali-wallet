import assert from 'node:assert/strict';
import test from 'node:test';
import { PALI_INFORMATION } from '../../../source/shared/paliInformation.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture(watchOnly: boolean) {
  let back: (() => boolean) | undefined, exits = 0, locks = 0, immersive = false, checks = 0;
  const ui = { colors: {}, ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])) };
  const settings = screenFixture(new URL('../src/screens/RealSettings.tsx', import.meta.url), 'RealSettings', {
    './DisplayCurrency': { DisplayCurrency: 'DisplayCurrency' }, './BalancePrivacySetting': { BalancePrivacySetting: 'BalancePrivacySetting' },
    './HelpAbout': { HelpAbout: 'HelpAbout' }, './WalletUpdatePanel': { WalletUpdatePanel: 'WalletUpdatePanel' },
    './NativePreferences': { NativePreferences: 'NativePreferences' }, './WalletBackupBadge': { WalletBackupBadge: 'WalletBackupBadge' },
    './ActivityNotifications': { ActivityNotifications: 'ActivityNotifications' }, '../platform/localization': nativeTranslationFixture,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
  });
  const createHelp = () => screenFixture(new URL('../src/screens/HelpAbout.tsx', import.meta.url), 'HelpAbout', {
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' }, View: 'View',
      Linking: { openURL() { throw Error('Unexpected link action'); } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-clipboard': {},
    '../../../../source/shared/paliInformation': { PALI_INFORMATION }, '../../app.json': { expo: { version: '5.0.0' } }, '../ui': ui,
    '../updates/service': { mobileUpdates: { getSnapshot: () => ({ release: null }), subscribe: () => () => {}, check() { checks++; } } },
  });
  let help: ReturnType<typeof createHelp> | undefined;
  const props = { accountLabel: 'Current account', watchOnly, onLock() { locks++; }, onUpdate() { locks++; }, onBack() { exits++; },
    navigation: { registerBack(listener: () => boolean) { back = listener; return () => { if (back === listener) back = undefined; }; },
      setImmersive(value: boolean) { immersive = value; } } };
  const render = () => {
    const route = settings.render(props);
    if (route.type === 'HelpAbout') { help ??= createHelp(); return help.render(route.props); }
    help?.close(); help = undefined;
    return route;
  };
  return { render, hardwareBack: () => back?.(), get exits() { return exits; }, get locks() { return locks; },
    get immersive() { return immersive; }, get checks() { return checks; },
    close() { help?.close(); settings.close(); } };
}
function control(tree: ScreenElement, title: string) {
  const value = screenElements(tree).find(node => node.props.title === title); assert(value, title); return value;
}

for (const watchOnly of [false, true]) for (const mode of ['button', 'hardware'])
  test(`${watchOnly ? 'watch' : 'custody'} About > Updates > Back > About > Back uses ${mode} navigation and preserves install gating`, () => {
    const f = fixture(watchOnly);
    try {
      control(f.render(), 'Help & about').props.onPress();
      const about = f.render(); assert.equal(f.immersive, true);
      assert.equal(screenElements(about).some(node => node.type === 'WalletUpdatePanel'), false);
      control(about, 'App updates').props.onPress();
      const updates = f.render(), panel = screenElements(updates).find(node => node.type === 'WalletUpdatePanel'); assert(panel);
      assert.equal(panel.props.allowInstall, watchOnly);
      assert.equal(f.locks, 0); assert.equal(f.exits, 0);
      if (!watchOnly) { panel.props.onCloseWallet(); assert.equal(f.locks, 1); }
      if (mode === 'hardware') assert.equal(f.hardwareBack(), true);
      else control(updates, 'Done').props.onPress();
      const returned = f.render(); assert(control(returned, 'Help & about'));
      assert(control(returned, 'App updates')); assert.equal(f.immersive, true); assert.equal(f.exits, 0);
      if (mode === 'hardware') assert.equal(f.hardwareBack(), true);
      else control(returned, 'Done').props.onPress();
      const root = f.render(); assert(control(root, 'Help & about')); assert.equal(f.immersive, false);
      assert.equal(screenElements(root).some(node => node.type === 'WalletUpdatePanel'), false);
      assert.equal(f.checks, 0, 'Compact About does not perform update checks');
      assert.equal(f.hardwareBack(), true); assert.equal(f.exits, 1);
    } finally { f.close(); }
  });
