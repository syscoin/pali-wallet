import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { currencyFlag } from '../../../source/shared/currencyFlags.ts';
import { FIAT_QUOTE_CURRENCIES } from '../../../source/shared/nativeCoinQuotes.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const all = (value: any): Element[] => Array.isArray(value) ? value.flatMap(all)
  : value && typeof value === 'object' && 'children' in value ? [value, ...value.children.flatMap(all)] : [];

function fixture() {
  const cells: any[] = [], writes: string[] = [];
  let cursor = 0;
  const react = {
    createElement: (type: string, props: object | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const index = cursor++; if (!(index in cells)) cells[index] = initial; return [cells[index], (value: unknown) => { cells[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
    useMemo(make: () => unknown) { return make(); },
  };
  const imports: Record<string, unknown> = {
    react,
    'react-native': { AppState: { currentState: 'active' }, Platform: { OS: 'android' }, FlatList: 'FlatList', KeyboardAvoidingView: 'KeyboardAvoidingView', View: 'View', StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/currencyFlags.ts': { currencyFlag },
    '../../../../source/shared/nativeCoinQuotes.ts': { FIAT_QUOTE_CURRENCIES },
    '../core/fiatPreference.ts': { DEFAULT_FIAT_CURRENCY: 'usd' },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }), reloadFiatCurrency: async () => undefined,
      saveFiatCurrency: async (code: string) => { writes.push(code); return true; } },
    '../platform/localization': nativeTranslationFixture,
    './IdleActivityBoundary': { IdleTextInput: 'IdleTextInput' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Text'].map((name) => [name, name])), colors: {}, styles: {} },
  };
  const module = { exports: {} as { DisplayCurrency: (props: object) => Element } };
  const source = readFileSync(new NodeURL('../src/screens/DisplayCurrency.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Intl, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const render = () => { cursor = 0; return module.exports.DisplayCurrency({ onBack() {} }); };
  const list = () => all(render()).find((node) => node.type === 'FlatList')!;
  const row = (code: string) => {
    const current = list(), item = current.props.data.find((entry: { code: string }) => entry.code === code);
    assert.ok(item, code);
    return all(current.props.renderItem({ item })).find((node) => node.type === 'Row')!;
  };
  return { render, list, row, writes };
}

test('currency rows show shared flags and symbols beside readable names and codes', () => {
  const f = fixture();
  for (const [code, symbol] of [['cad', '🇨🇦'], ['bits', '₿'], ['bch', '💰']] as const) {
    const row = f.row(code);
    assert.equal(row.props.icon.children[0], symbol);
    assert.equal(row.props.icon.props.accessibilityElementsHidden, true);
    assert.equal(typeof row.props.title, 'string');
    assert.ok(row.props.title.length > 0);
    assert.ok(row.props.subtitle.startsWith(code.toUpperCase()));
  }
  assert.equal(currencyFlag('USD'), '🇺🇸');
  assert.equal(currencyFlag('toString'), '💰');
});

test('currency search and explicit save remain separate from choosing a flagged row', async () => {
  const f = fixture();
  f.row('cad').props.onPress();
  assert.deepEqual(f.writes, []);
  const save = all(f.render()).find((node) => node.type === 'Button')!;
  assert.equal(save.props.disabled, false);
  save.props.onPress();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.writes, ['cad']);
  const search = all(f.render()).find((node) => node.type === 'IdleTextInput')!;
  search.props.onChangeText('jpy');
  assert.deepEqual(Array.from(f.list().props.data, (item: { code: string }) => item.code), ['jpy']);
  assert.equal(f.row('jpy').props.icon.children[0], '🇯🇵');
});
