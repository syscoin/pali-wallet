import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createIdleComponentFixture, expandIdleElements } from './idleComponentFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

type Element = { type: string | ((props: object) => Element); props: Record<string, unknown>; children: unknown[] };
function shell() {
  const dependencies: Record<string, unknown> = {
    react: { createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children }) },
    'react-native': { Text: 'NativeText', Pressable: 'Pressable', View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
    'react-native-svg': {},
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../platform/localization': nativeTranslationFixture,
  };
  const load = (path: string) => {
    const module = { exports: {} as Record<string, (props: object) => Element> };
    const source = readFileSync(new NodeURL(path, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
    } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name];
    } });
    return module.exports;
  };
  const react = dependencies.react as Record<string, any>;
  react.useRef = (current: unknown) => ({ current });
  const idle = createIdleComponentFixture(react, dependencies['react-native'] as Record<string, unknown>);
  dependencies['./screens/IdleActivityBoundary'] = idle.components;
  dependencies['./IdleActivityBoundary'] = idle.components;
  dependencies['./screens/useWelcomeBackdropMotion'] = load('../src/screens/useWelcomeBackdropMotion.ts');
  dependencies['../ui'] = load('../src/ui.tsx');
  return expandIdleElements(load('../src/screens/RealAppShell.tsx').RealAppShell!({ tab: 'wallet', onTab() {}, children: null }));
}
function elements(node: unknown): Element[] {
  if (!node || typeof node !== 'object' || !('children' in node)) return [];
  const element = node as Element;
  return [element, ...element.children.flat(Infinity).flatMap(elements)];
}

test('compact tab captions retain full accessible names and bounded native Dynamic Type with a large-content viewer', () => {
  const tree = elements(shell());
  const tabs = tree.filter((node) => node.type === 'Pressable');
  assert.deepEqual(tabs.map((tab) => tab.props.accessibilityLabel), ['Wallet', 'Activity', 'Tools', 'Settings']);
  for (const tab of tabs) {
    const caption = elements(tab).find((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('main-tab-caption-'))!;
    assert.equal(caption.children[0], tab.props.accessibilityLabel);
    assert.equal(caption.props.numberOfLines, 1);
    assert.equal(caption.props.maxFontSizeMultiplier, 1.25);
    assert.equal(caption.props.adjustsFontSizeToFit, true);
    assert.equal(caption.props.minimumFontScale, 1);
    const style = Object.assign({}, ...(caption.props.style as object[]).filter(Boolean)) as { fontSize: number; lineHeight: number };
    assert.equal(style.fontSize, 12);
    assert.equal(style.lineHeight, 17);
    assert.equal(tab.props.accessibilityShowsLargeContentViewer, true);
    assert.equal(tab.props.accessibilityLargeContentTitle, tab.props.accessibilityLabel);
    assert.equal(typeof caption.type, 'function');
    const nativeText = (caption.type as (props: object) => Element)(caption.props);
    assert.equal(nativeText.type, 'NativeText');
    assert.equal(nativeText.props.allowFontScaling, true);
    assert.equal(nativeText.props.maxFontSizeMultiplier, 1.25);
    assert.equal(nativeText.props.numberOfLines, 1);
  }
});
