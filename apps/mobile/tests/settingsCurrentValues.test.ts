import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { createInstance } from 'i18next';
import { PALI_LANGUAGE_OPTIONS } from '../../../source/shared/languagePolicy.ts';
import { currencyFlag } from '../../../source/shared/currencyFlags.ts';
import { languageMessages } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

test('Settings shows the selected language, currency and scoped notification state', async () => {
  const i18n = createInstance();
  await i18n.init({ initImmediate: false, lng: 'de', fallbackLng: false,
    resources: { de: { translation: languageMessages('de') } }, interpolation: { escapeValue: false } });
  let currency = 'eur', current = true, loads = 0;
  let notice = { status: 'ready', enabledScopeIds: ['owned'], permission: 'granted' };
  const f = screenFixture(new URL('../src/screens/RealSettings.tsx', import.meta.url), 'RealSettings', {
    './DisplayCurrency': { DisplayCurrency: 'DisplayCurrency' }, './BalancePrivacySetting': { BalancePrivacySetting: 'BalancePrivacySetting' },
    './HelpAbout': { HelpAbout: 'HelpAbout' }, './WalletUpdatePanel': { WalletUpdatePanel: 'WalletUpdatePanel' },
    './NativePreferences': { NativePreferences: 'NativePreferences' }, './WalletBackupBadge': { WalletBackupBadge: 'WalletBackupBadge' },
    './ActivityNotifications': { ActivityNotifications: 'ActivityNotifications' },
    '../platform/localization': { useNativeTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency }) },
    '../notifications/service': { nativeActivityNotifications: {
      subscribe: () => () => undefined, getSnapshot: () => notice, async load() { loads++; },
    } },
    '../../../../source/shared/languagePolicy': { PALI_LANGUAGE_OPTIONS },
    '../../../../source/shared/currencyFlags': { currencyFlag },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { colors: {}, ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])) },
  });
  const props = { accountLabel: 'Account', watchOnly: true, onLock() {}, onBack() {}, notifications: {
    scope: 'owned', assertCurrent() { if (!current) throw Error('CANCELLED'); },
    readChoices: () => [{ scope: { id: 'owned' } }],
  } };
  const row = (key: string) => screenElements(f.render(props)).find(node => node.props.title === i18n.t(key))!;
  try {
    assert.equal(row('generalMenu.languages').props.subtitle, '🇩🇪 Deutsch');
    assert.equal(row('mobile.settings.currencyTitle').props.subtitle, '🇪🇺 EUR');
    assert.equal(row('mobile.notifications.title').props.subtitle, i18n.t('components.enabled'));
    currency = 'usd';
    assert.equal(row('mobile.settings.currencyTitle').props.subtitle, '🇺🇸 USD');
    notice = { ...notice, permission: 'denied' };
    assert.equal(row('mobile.notifications.title').props.subtitle, i18n.t('components.disabled'));
    notice = { ...notice, permission: 'granted', enabledScopeIds: ['unrelated'] };
    assert.equal(row('mobile.notifications.title').props.subtitle, i18n.t('components.disabled'));
    current = false;
    assert.equal(row('mobile.notifications.title').props.subtitle, i18n.t('settings.unavailable'));
    assert.equal(loads, 1);
  } finally { f.close(); }
});
