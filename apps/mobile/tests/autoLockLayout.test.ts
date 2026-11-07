import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as idlePolicy from '../../../source/shared/idleLockPolicy.ts';

type Element = {
  type: string;
  props: Record<string, any>;
  children: Element[];
};

const code = ts.transpileModule(
  readFileSync(new URL('../src/screens/AutoLockSettings.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }
).outputText;

test('custody and watch auto-lock protect both safe areas around keyboard avoidance', () => {
  for (const platform of ['android', 'ios']) {
    const screenStyle = { flex: 1, backgroundColor: '#071325' };
    const dependencies: Record<string, unknown> = {
      react: {
        createElement: (type: string, props: object, ...children: Element[]) => ({ type, props, children }),
        useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => undefined],
        useRef: (current: unknown) => ({ current }),
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
      },
      'react-native': {
        Platform: { OS: platform },
        StyleSheet: { create: (styles: unknown) => styles },
        KeyboardAvoidingView: 'KeyboardAvoidingView',
        View: 'View',
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../../../../source/shared/idleLockPolicy': idlePolicy,
      '../platform/security': { securityPreferences: { getSnapshot: () => ({ value: { custodyIdleMinutes: 5, watchIdleMinutes: 5 } }) } },
      './IdleActivityBoundary': { IdleTextInput: 'IdleTextInput' },
      '../ui': { Button: 'Button', Header: 'Header', Notice: 'Notice', Screen: 'Screen', Text: 'Text', colors: {}, styles: { screen: screenStyle } },
    };
    const module = { exports: {} as { AutoLockSettings(props: object): Element } };
    runInNewContext(code, { module, exports: module.exports, require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`);
      return dependencies[name];
    } });

    for (const mode of ['custody', 'watch']) {
      const tree = module.exports.AutoLockSettings({ mode, save: () => assert.fail('Layout rendering must not save'), onBack() {} });
      assert.equal(tree.type, 'SafeAreaView', `${platform}/${mode}`);
      assert.deepEqual(Array.from(tree.props.edges), ['top', 'bottom']);
      assert.equal(tree.props.style, screenStyle);
      const keyboard = tree.children[0];
      assert.ok(keyboard);
      assert.equal(keyboard.type, 'KeyboardAvoidingView');
      assert.equal(keyboard.props.behavior, platform === 'ios' ? 'padding' : undefined);
      assert.equal(keyboard.props.style.flex, 1);
      const screen = keyboard.children[0];
      assert.ok(screen);
      assert.equal(screen.type, 'Screen');
      const header = screen.children[0];
      assert.ok(header);
      assert.equal(header.props.subtitle, mode === 'custody' ? 'Native wallet' : 'Watch accounts');
    }
  }
});
