import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { nativeTranslationFixture } from './localizationFixture.ts';

type Element = { type: string; props: Record<string, any>; children: (Element | string | null)[] };
const react = { createElement: (type: string, props: object, ...children: Element['children']) => ({ type, props, children }) };
const dependencies: Record<string, unknown> = {
  './IdleActivityBoundary': { IdlePressable: 'IdlePressable' }, react,
  '../platform/localization': nativeTranslationFixture,
  'react-native': { StyleSheet: { create: (value: unknown) => value }, View: 'View' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '../ui': { colors: {}, Header: 'Header', Icon: 'Icon', Notice: 'Notice', Screen: 'Screen', Text: 'Text' },
};
const module = { exports: {} as { UnavailableActivity(props: object): Element } };
const code = ts.transpileModule(readFileSync(new NodeURL('../src/screens/RealAppShell.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
runInNewContext(code, { module, exports: module.exports, require(name: string) {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected shell dependency ${name}`); return dependencies[name];
} });
const nodes = (element: Element): Element[] => [element, ...element.children.flat(Infinity).filter((child) => child && typeof child === 'object').flatMap((child) => nodes(child as Element))];
for (const watchOnly of [false, true]) test(`actual ${watchOnly ? 'watch' : 'custody'} fallback describes its capability without an Ethereum-only claim`, () => {
  let back = 0;
  const tree = module.exports.UnavailableActivity({ accountLabel: 'Current account · Current network', watchOnly, onBack() { back++; } });
  const all = nodes(tree), notice = all.find((node) => node.type === 'Notice')!, header = all.find((node) => node.type === 'Header')!;
  assert.equal(notice.props.title, 'Activity unavailable');
  assert.equal(notice.props.body, watchOnly
    ? 'Transaction history for this watch account is not available on the selected network yet. Balance and receive remain available.'
    : 'Transaction history is unavailable right now. Your account and receive address remain available.');
  assert.doesNotMatch(notice.props.body, /Ethereum|no transactions|empty/i);
  assert.equal(header.props.subtitle, 'Current account · Current network'); header.props.onBack(); assert.equal(back, 1);
});
