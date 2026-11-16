import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import * as fees from '../../../source/shared/transactionFeeChoice.ts';
import { normalizeDecimalInput } from '../../../source/shared/decimalInput.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { languageMessages } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function fixture(language = 'en', unavailable = false, options: { mode?: 'evm' | 'utxo'; choice?: fees.EvmFeeChoice | fees.UtxoFeeChoice; load?(signal: AbortSignal): Promise<fees.EvmFeeRates | string> } = {}) {
  const i18n = createInstance(); await i18n.init({ lng: language, resources: { [language]: { translation: languageMessages(language) } }, fallbackLng: false });
  const screen = screenFixture(new URL('../src/screens/NetworkFeeSheet.tsx', import.meta.url), 'NetworkFeeSheet', {
    'react-native': { KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (value: unknown) => value }, Platform: { OS: 'ios' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/transactionFeeChoice': { ...fees, snapshotEvmFeeChoice: (value: unknown) => fees.snapshotEvmFeeChoice(JSON.parse(JSON.stringify(value))), snapshotUtxoFeeChoice: (value: unknown) => fees.snapshotUtxoFeeChoice(JSON.parse(JSON.stringify(value))) },
    '../../../../source/shared/decimalInput': { normalizeDecimalInput },
    '../core/amounts': { formatBaseUnits },
    '../platform/localization': { useNativeTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) },
    '../ui': { Button: 'Button', Card: 'Card', Icon: 'Icon', IconButton: 'IconButton', Text: 'Text', colors: {}, styles: {} },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
  }, { AbortController });
  const selected: unknown[] = []; let request: AbortSignal | undefined;
  const props = { mode: options.mode ?? 'evm', choice: options.choice ?? fees.AUTOMATIC_FEE,
    load: async (signal: AbortSignal) => { request = signal; if (unavailable) throw Error('offline'); if (options.load) return options.load(signal); if (options.mode === 'utxo') return '2'; return { type: 2, maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000' }; },
    onApply: (choice: unknown) => selected.push(choice), onClose() {} };
  const render = () => screen.render(props);
  render(); await tick();
  const press = (key: string) => { const item = screenElements(render()).find(n => n.type === 'Button' && n.props.title === i18n.t(key)); assert(item, key); item.props.onPress(); };
  return { screen, render, selected, press, i18n, request: () => request };
}
test('custom fees normalize local decimal input and return exact reviewed units', async () => {
  const f = await fixture('fr');
  f.press('mobile.feeChoice.custom');
  const edit = (key: string, value: string) => {
    const input = screenElements(f.render()).find(n => n.type === 'Input' && n.props.accessibilityLabel === f.i18n.t(key)); assert(input); input.props.onChangeText(value);
  };
  edit('mobile.feeChoice.maximumPrice', '7,5'); edit('mobile.feeChoice.priorityPrice', '1,25'); edit('send.gasLimit', '30000');
  f.press('mobile.feeChoice.apply');
  assert.deepEqual(f.selected, [{ kind: 'custom', type: 2, maxFeePerGas: '7500000000', maxPriorityFeePerGas: '1250000000', gasLimit: '30000' }]);
  const keyboard = screenElements(f.render()).find(n => n.type === 'KeyboardAvoidingView'); assert.equal(keyboard?.props.behavior, 'padding');
  assert(screenElements(f.render()).some(n => n.type === 'ScrollView' && n.props.keyboardShouldPersistTaps === 'handled'));
  f.screen.close();
});
test('failed fee loading preserves Automatic without accepting custom fees', async () => {
  const f = await fixture('en', true);
  assert(screenElements(f.render()).some(n => n.props.accessibilityRole === 'alert'));
  f.press('mobile.feeChoice.apply'); assert.deepEqual(f.selected, [fees.AUTOMATIC_FEE]); f.screen.close();
});

test('closing a fee sheet retires its read and late Apply cannot publish', async () => {
  const f = await fixture();
  const apply = screenElements(f.render()).find(n => n.type === 'Button' && n.props.title === f.i18n.t('mobile.feeChoice.apply'));
  assert(apply); assert.equal(f.request()?.aborted, false);
  f.screen.close(); assert.equal(f.request()?.aborted, true);
  apply.props.onPress(); assert.deepEqual(f.selected, []);
});


test('a late UTXO recommendation preserves a custom rate through Apply', async () => {
  const recommendation = Promise.withResolvers<string>();
  const f = await fixture('en', false, { mode: 'utxo', load: () => recommendation.promise });
  try {
    f.press('mobile.feeChoice.custom');
    const field = () => screenElements(f.render()).find(node => node.type === 'Input')!;
    field().props.onChangeText('25');
    recommendation.resolve('2'); await tick();
    assert.equal(field().props.value, '25');
    f.press('mobile.feeChoice.apply');
    assert.deepEqual(f.selected, [{ kind: 'custom', satPerVbyte: '25' }]);
  } finally { f.screen.close(); }
});

test('an initial custom UTXO rate remains selected after recommendations load', async () => {
  const f = await fixture('en', false, { mode: 'utxo', choice: { kind: 'custom', satPerVbyte: '25' } });
  try {
    assert.equal(screenElements(f.render()).find(node => node.type === 'Input')!.props.value, '25');
    f.press('mobile.feeChoice.apply');
    assert.deepEqual(f.selected, [{ kind: 'custom', satPerVbyte: '25' }]);
  } finally { f.screen.close(); }
});

test('an untouched UTXO field is seeded and preserves an edit after loading', async () => {
  const f = await fixture('en', false, { mode: 'utxo' });
  try {
    f.press('mobile.feeChoice.custom');
    const input = screenElements(f.render()).find(node => node.type === 'Input')!;
    assert.equal(input.props.value, '2'); input.props.onChangeText('25');
    f.press('mobile.feeChoice.apply');
    assert.deepEqual(f.selected, [{ kind: 'custom', satPerVbyte: '25' }]);
  } finally { f.screen.close(); }
});
