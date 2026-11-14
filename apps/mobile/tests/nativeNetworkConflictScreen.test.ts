import { NativeUtxoNetworkConflictError } from '../src/custody/accounts.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture, languageMessages } from './localizationFixture.ts';
import { getUtxoNetwork, isCustomUtxoNetworkId } from '../src/core/utxoNetworks.ts';

const endpoint = 'https://bitcoin-test.invalid';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(builtin = false) {
  let context = 3, revision = 5, held: Promise<void> = Promise.resolve();
  let cause: Error = new NativeUtxoNetworkConflictError('testnet', 'Syscoin Testnet');
  const drafts: unknown[] = [];
  const network = getUtxoNetwork('syscoin');
  const controller = { getSnapshot: () => ({ revision, selectedId: 'ethereum', networks: builtin ? [{ id: network.id, name: network.name,
    symbol: network.symbol, testnet: network.testnet, canSign: true, utxoEndpoint: network.endpoint }] : [] }),
    getContextRevision: () => context, subscribe: () => () => {}, cancel() {},
    async addUtxo(...args: unknown[]) { drafts.push(args); await held; throw cause; },
    async editUtxo(...args: unknown[]) { drafts.push(args); await held; }, async removeUtxo() { throw Error('Built-in removal forbidden'); } };
  const f = screenFixture(new URL('../src/screens/NativeNetworks.tsx', import.meta.url), 'NativeNetworks', {
    '../platform/localization': nativeTranslationFixture,
    '../custody/accounts': { NativeUtxoNetworkConflictError },
    '../core/utxoNetworks': { isCustomUtxoNetworkId },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    'react-native': { Platform: { OS: 'android' }, View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
      StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss() {} },
      BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/chainCatalogue': { rankChainSuggestions: () => [] },
    '../custody/networkContext': { createNativeNetwork: () => { throw Error('EVM save forbidden'); } },
    '../custody/networkCatalogue': { withBundledNativeNetworkSuggestions: () => [] },
    './NetworkSourceSheet': { NetworkSourceSheet: 'NetworkSourceSheet' },
    '../ui': { ...Object.fromEntries(['Button', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
  });
  const render = () => screenElements(f.render({ controller, onBack() {} }));
  const button = (title: string) => { const found = render().find(element => element.type === 'Button' && element.props.title === title); assert(found, title); return found; };
  const input = (label: string) => { const found = render().find(element => element.type === 'Input' && element.props.accessibilityLabel === label); assert(found, label); return found; };
  const messages = languageMessages('en').mobile.networks;
  const open = () => {
    button(messages.addUtxo).props.onPress();
    input(messages.optionalName).props.onChangeText('My Bitcoin testnet');
    input(messages.blockbook).props.onChangeText(endpoint);
  };
  const alerts = () => render().filter(element => element.type === 'Text' && element.props.accessibilityRole === 'alert').flatMap(element => element.children).join(' ');
  return { render, button, input, open, alerts, messages, drafts, close: f.close,
    hold(value: Promise<void>) { held = value; }, fail(error: Error) { cause = error; }, staleContext() { context++; }, staleCatalogue() { revision++; } };
}

test('a valid Blockbook URL conflict names the existing network and keeps the editable draft', async () => {
  const f = fixture();
  try {
    f.open(); f.button(f.messages.save).props.onPress(); await settle();
    assert.match(f.alerts(), /testnet network is already saved \(Syscoin Testnet\)/);
    assert(!f.alerts().includes(f.messages.addBlockbook));
    assert.doesNotMatch(f.alerts(), /remove|active at a time/i);
    assert.equal(f.input(f.messages.optionalName).props.value, 'My Bitcoin testnet');
    assert.equal(f.input(f.messages.blockbook).props.value, endpoint);
    assert.equal(f.button(f.messages.save).props.disabled, false);
    assert.deepEqual(structuredClone(f.drafts), [[{ endpoint, name: 'My Bitcoin testnet', explorer: '' }, 3, 5]]);
  } finally { f.close(); }
});

test('built-in UTXO editor keeps its name fixed and removal absent while serializing endpoint saves', async () => {
  const f = fixture(true), held = Promise.withResolvers<void>();
  try {
    const row = f.render().find(element => element.props.network?.id === 'syscoin'); assert(row?.props.onEdit);
    row.props.onEdit(row.props.network);
    assert.equal(f.input(f.messages.name).props.editable, false);
    f.input(f.messages.name).props.onChangeText('Wrong name');
    assert.equal(f.input(f.messages.name).props.value, getUtxoNetwork('syscoin').name);
    assert(!f.render().some(element => element.type === 'Button' && element.props.title === f.messages.remove));
    f.input(f.messages.blockbook).props.onChangeText('https://alternate.example/blockbook');
    f.hold(held.promise);
    const save = f.button(f.messages.saveChanges);
    save.props.onPress(); save.props.onPress();
    assert.equal(f.drafts.length, 1);
    assert.deepEqual(structuredClone(f.drafts), [['syscoin', { name: getUtxoNetwork('syscoin').name, endpoint: 'https://alternate.example/blockbook' }, 3, 5]]);
    assert.equal(f.button(f.messages.saving).props.disabled, true);
    held.resolve(); await settle();
  } finally { held.resolve(); f.close(); }
});

for (const code of ['INVALID_INPUT', 'NETWORK_MISMATCH', 'UNAVAILABLE']) test(`non-conflict ${code} keeps generic Blockbook feedback`, async () => {
  const f = fixture();
  try { f.fail(Object.assign(new Error('private provider response'), { code })); f.open(); f.button(f.messages.save).props.onPress(); await settle();
    assert.equal(f.alerts(), f.messages.addBlockbook); assert(!f.alerts().includes('private provider response'));
  } finally { f.close(); }
});

for (const end of ['back', 'context', 'catalogue', 'unmount'] as const) test(`a late network conflict is suppressed after ${end}`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); let closed = false;
  try {
    f.hold(held.promise); f.open(); f.button(f.messages.save).props.onPress();
    if (end === 'back') f.render().find(element => element.type === 'Header')!.props.onBack();
    else if (end === 'context') f.staleContext(); else if (end === 'catalogue') f.staleCatalogue();
    else { f.close(); closed = true; }
    held.resolve(); await settle();
    if (!closed) assert.equal(f.alerts(), '');
  } finally { held.resolve(); if (!closed) f.close(); }
});
