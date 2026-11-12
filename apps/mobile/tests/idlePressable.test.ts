import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';
import { createSecurityRuntime } from '../src/core/securityRuntime.ts';

// Exercise the actual component callbacks and idle authority. Only React's
// element/ref machinery and native host elements are replaced in this Node test.
const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const source = readFileSync(new URL('../src/screens/IdleActivityBoundary.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
type Event = { nativeEvent: Record<string, unknown> };
const touch: Event = { nativeEvent: { identifier: 0, touches: [{}], changedTouches: [{}] } };
const cases: { name: string; payload: Event; transition?: 'rearm' | 'expiry'; expected: number; startExpired?: boolean }[] = [
  { name: 'ordinary native release', payload: touch, expected: 1 },
  { name: 'old native release after rearm', payload: touch, transition: 'rearm', expected: 0 },
  { name: 'old native release after expiry', payload: touch, transition: 'expiry', expected: 0 },
  { name: 'fresh native accessibility after canceled press', payload: { nativeEvent: {} }, transition: 'rearm', expected: 1 },
  { name: 'fresh web accessibility after canceled press', payload: { nativeEvent: { type: 'click', detail: 0 } }, transition: 'rearm', expected: 1 },
  { name: 'old web physical release', payload: { nativeEvent: { type: 'click', detail: 1 } }, transition: 'rearm', expected: 0 },
  { name: 'old pointer release', payload: { nativeEvent: { type: 'click', pointerType: 'touch', detail: 0 } }, transition: 'rearm', expected: 0 },
  { name: 'virtual press cannot revive expired owner', payload: { nativeEvent: {} }, transition: 'expiry', expected: 0 },
  { name: 'expired start cannot release after rearm', payload: touch, transition: 'rearm', startExpired: true, expected: 0 },
  ...['identifier', 'touches', 'changedTouches'].map((field) => ({ name: `old responder ${field}`, payload: { nativeEvent: { [field]: field === 'identifier' ? 0 : [] } }, transition: 'rearm' as const, expected: 0 })),
];
for (const scenario of cases) test(scenario.name, () => {
  let time = 0, calls = 0;
  const runtime = createSecurityRuntime({ get: async () => null, set: async () => undefined }, () => ({ monotonic: time, wall: time }));
  runtime.watchIdle.setPolicy(5);
  const owner = {}, begin = () => runtime.watchIdle.begin(owner, () => runtime.watchIdle.stop(owner));
  const slot = { current: null }, React = { forwardRef: (fn: unknown) => fn, createElement: (type: unknown, props: unknown) => ({ type, props }) };
  const module = { exports: {} as { IdlePressable: (props: { onPress(): void }, ref: null) => { props: { onPressIn(event: Event): void; onPress(event: Event): void } } } };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    if (name === 'react') return { ...React, default: React, useRef: () => slot };
    if (name === 'react-native') return { View: 'View', TextInput: 'Input', Pressable: 'Pressable' };
    if (name === '../platform/security') return runtime;
    throw Error(`Unexpected component dependency: ${name}`);
  } });
  begin();
  try {
    const element = module.exports.IdlePressable({ onPress: () => calls++ }, null);
    if (scenario.startExpired) time = 300001;
    element.props.onPressIn(touch);
    if (scenario.transition === 'rearm') { runtime.watchIdle.stop(owner); begin(); }
    if (scenario.transition === 'expiry') time += 300001;
    element.props.onPress(scenario.payload);
    assert.equal(calls, scenario.expected);
  } finally { runtime.watchIdle.stop(); runtime.custodyIdle.stop(); }
});
