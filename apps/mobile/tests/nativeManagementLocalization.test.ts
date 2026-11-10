import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { PALI_LANGUAGE_OPTIONS } from '../../../source/shared/languagePolicy.ts';
import { languageMessages } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';

const names = ['NativeConnections', 'NativeSecurity', 'NativeAccounts', 'NativeImport', 'NativeNetworks', 'RealTools'] as const;
type Name = typeof names[number];
const titleKeys: Record<Name, string> = {
  NativeConnections: 'mobile.connections.title', NativeSecurity: 'mobile.security.title',
  NativeAccounts: 'mobile.accounts.title', NativeImport: 'mobile.accounts.importKey',
  NativeNetworks: 'mobile.networks.title', RealTools: 'mobile.tools.title',
};
async function fixture(language = 'en') {
  const engine = createInstance();
  await engine.init({ initImmediate: false, lng: language, fallbackLng: 'en',
    resources: { [language]: { translation: languageMessages(language) }, en: { translation: languageMessages('en') } },
    interpolation: { escapeValue: false } });
  const returned: unknown[][] = [], selected: unknown[][] = [];
  const session = { id: 'exact-session', name: 'App', origin: 'https://app.example', accountLabel: 'Account', networkLabel: 'Network', returnTarget: {}, address: null, methods: ['eth_accounts'], expiresAt: Date.now() + 60_000 };
  const connectionSnapshot = { revision: 7, status: 'ready', pairingExpiresAt: null, proposals: [], accounts: [], selectedAccountId: null,
    network: { id: 'ethereum', label: 'Ethereum', chainId: '1' }, sessions: [session], signingReview: null, error: null };
  const account = { id: 'hd:60:0', label: 'My account', address: `0x${'12'.repeat(20)}`, type: 'HDAccount', index: 0 };
  const catalogue = { revision: 3, active: { accountId: account.id }, accounts: [account] };
  const connections = { getSnapshot: () => connectionSnapshot, subscribe: () => () => {}, cancel() {},
    async returnToDapp(...args: unknown[]) { returned.push(args); }, async disconnect() {} };
  const props: Record<Name, Record<string, unknown>> = {
    NativeConnections: { controller: connections, onBack() {} },
    NativeSecurity: { keyExport: { onClear: () => () => {}, cancel() {}, isCurrent: () => false, isAuthenticating: () => false }, keyFormat: 'evm',
      accountId: account.id, accountType: 'HDAccount', accountLabel: account.label, address: account.address,
      onViewRecovery() {}, onLock() {}, onBack() {}, captureFailureHandler: () => () => {} },
    NativeAccounts: { controller: { getSnapshot: () => catalogue, subscribe: () => () => {}, getContextRevision: () => 9,
      cancel() {}, async execute(...args: unknown[]) { selected.push(structuredClone(args)); } }, onBack() {}, networkLabel: 'Ethereum' },
    NativeImport: { imports: { cancel() {} }, contextRevision: 9, catalogueRevision: 3, networkLabel: 'Ethereum', utxo: false,
      onImported() {}, onBack() {}, onSubmitStart() {}, onSubmitEnd() {} },
    NativeNetworks: { controller: { getSnapshot: () => ({ revision: 3, selectedId: 'ethereum', networks: [] }),
      subscribe: () => () => {}, cancel() {} }, onBack() {} },
    RealTools: { accountLabel: account.label, networkLabel: 'Ethereum', watchOnly: false, onAccounts() {}, onBack() {},
      navigation: { registerBack: () => () => {}, setImmersive() {} } },
  };
  const imported = {
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../platform/localization': { useNativeTranslation: () => ({ t: engine.t.bind(engine), i18n: engine }) },
    'react-native': { View: 'View', FlatList: 'FlatList', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
      Switch: 'Switch', Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'IconButton', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    'expo-clipboard': {}, './DappSiteStatus': { DappSiteStatus: 'DappSiteStatus' }, './ConnectionQrScanner': { ConnectionQrScanner: 'ConnectionQrScanner' },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    './PinEntry': { PinField: 'PinField' },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../custody/importedAccounts': { isUtxoAccountPrivateKey: () => false },
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ status: 'ready', hidden: false }),
      async reloadBalancePrivacy() {}, async saveBalancePrivacy() {} },
    '../core/utxoAddresses': { UTXO_IMPORT_TYPES: ['p2wpkh'], UTXO_IMPORT_LABELS: { p2wpkh: 'Native SegWit' } },
    '../../../../source/shared/chainCatalogue': { rankChainSuggestions: () => [] }, '../custody/networkContext': {},
    './TrustedSiteLookup': { TrustedSiteLookup: 'TrustedSiteLookup' }, './WatchGuardianRecovery': { WatchGuardianRecovery: 'WatchGuardianRecovery' },
    './NativeConnections': { NativeConnections: 'NativeConnections' },
  };
  function screen(name: Name) {
    const host = screenFixture(new URL(`../src/screens/${name}.tsx`, import.meta.url), name, imported);
    const render = () => {
      const tree = host.render(props[name]), values = screenElements(tree);
      return [...values, ...values.flatMap(value => screenElements(value.props.ListHeaderComponent))];
    };
    return { render, close: host.close };
  }
  return { engine, screen, returned, selected, props };
}

for (const language of PALI_LANGUAGE_OPTIONS) test(`all six management screens resolve packaged ${language.value} labels`, async () => {
  const f = await fixture(language.value);
  for (const name of names) {
    const screen = f.screen(name), header = screen.render().find(element => element.type === 'Header');
    assert(header, name); assert.equal(header.props.title, f.engine.t(titleKeys[name]));
    assert(!header.props.title.startsWith('mobile.'), name); screen.close();
  }
});

test('language changes preserve exact Open website session and review revision', async () => {
  const f = await fixture('es'), screen = f.screen('NativeConnections');
  screen.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('App,'))!.props.onPress();
  const open = screen.render().find(element => element.type === 'Button' && element.props.title === f.engine.t('mobile.connections.openWebsite'));
  assert(open); open.props.onPress(); await Promise.resolve();
  assert.deepEqual(f.returned, [['exact-session', 7]]); screen.close();
});

test('translated account creation sends only the name and catalogue scope to shared authentication', async () => {
  const f = await fixture('fr'), screen = f.screen('NativeAccounts');
  screen.render().find(element => element.type === 'Header')!.props.right.props.onPress();
  screen.render().find(element => element.type === 'Row' && element.props.title === f.engine.t('mobile.accounts.create'))!.props.onPress();
  const inputs = screen.render().filter(element => element.type === 'Input');
  inputs[0]!.props.onChangeText('Exact account');
  assert.equal(screen.render().some(element => element.type === 'PinField'), false);
  screen.render().find(element => element.type === 'Button' && element.props.title === f.engine.t('mobile.accounts.create'))!.props.onPress();
  await Promise.resolve();
  assert.deepEqual(f.selected, [[{ kind: 'create', label: 'Exact account' }, 9, 3]]);
  screen.close();
});

test('new native management keys and interpolation fields match in every packaged locale', () => {
  const groups = ['common', 'connections', 'security', 'accounts', 'importAccount', 'networks', 'tools'];
  const english = languageMessages('en').mobile;
  const fields = (value: string) => [...value.matchAll(/{{\s*([^}]+)\s*}}/g)].map(match => match[1]!.trim()).sort();
  const compare = (actual: unknown, expected: unknown, path: string): void => {
    if (typeof expected === 'string') {
      assert.equal(typeof actual, 'string', path);
      assert.deepEqual(fields(actual as string), fields(expected), path);
      return;
    }
    assert(expected && typeof expected === 'object' && !Array.isArray(expected), path);
    assert(actual && typeof actual === 'object' && !Array.isArray(actual), path);
    const translated = actual as Record<string, unknown>;
    const canonical = expected as Record<string, unknown>;
    assert.deepEqual(Object.keys(translated), Object.keys(canonical), path);
    for (const key of Object.keys(canonical)) compare(translated[key], canonical[key], `${path}.${key}`);
  };
  for (const language of PALI_LANGUAGE_OPTIONS) {
    const messages = languageMessages(language.value).mobile;
    for (const group of groups) compare(messages[group], english[group], `${language.value}.${group}`);
  }
});
