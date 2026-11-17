import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { WalletModalState } from '../src/ui/walletModalState.ts';

async function fixture(platform = 'android') {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const listeners = new Map<string, Set<(value?: string) => unknown>>();
  const event = (name: string, callback: (value?: string) => unknown) => {
    const entries = listeners.get(name) ?? new Set(); listeners.set(name, entries); entries.add(callback);
    return { remove: () => entries.delete(callback) };
  };
  const appState = { currentState: 'active', addEventListener: event };
  const emit = (name: string, value?: string) => {
    if (name === 'change') appState.currentState = value!;
    for (const callback of [...(listeners.get(name) ?? [])]) callback(value);
  };
  const motionPreference = Promise.withResolvers<boolean>();
  const motionListeners = new Set<(reduced: boolean) => void>();
  let motionQueries = 0;
  let nativeShows = 0;
  function NativeModal(props: any) {
    React.useLayoutEffect(() => { if (props.visible) { nativeShows++; if (platform === 'android') emit('blur'); } }, [props.visible]);
    return props.visible ? React.createElement('div', { 'data-native-modal': true }, props.children) : null;
  }
  const View = ({ children, pointerEvents, accessibilityElementsHidden, importantForAccessibility, style }: any) => React.createElement('div', {
    'data-pointer': pointerEvents, 'aria-hidden': accessibilityElementsHidden,
    'data-accessibility': importantForAccessibility, 'data-absolute': JSON.stringify(style).includes('absolute'),
  }, children);
  const values: Value[] = [];
  const timings: { value: Value; options: Record<string, unknown>; running: boolean; starts: number; stops: number }[] = [];
  class Value {
    value: number;
    constructor(value: number) { this.value = value; values.push(this); }
    interpolate() { return 0; }
    setValue(value: number) { this.value = value; }
    stopAnimation() { for (const timing of timings) if (timing.value === this && timing.running) { timing.running = false; timing.stops++; } }
  }
  const native = {
    Modal: NativeModal, View, Platform: { OS: platform }, AppState: appState,
    BackHandler: { addEventListener: event }, useWindowDimensions: () => ({ height: 800, width: 400 }),
    StyleSheet: { create: (value: unknown) => value, absoluteFillObject: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 } },
    AccessibilityInfo: {
      isReduceMotionEnabled() { motionQueries++; return motionPreference.promise; },
      addEventListener(name: string, callback: (reduced: boolean) => void) {
        assert.equal(name, 'reduceMotionChanged'); motionListeners.add(callback);
        return { remove() { motionListeners.delete(callback); } };
      },
    },
    Animated: { View, Value, timing(value: Value, options: Record<string, unknown>) {
      const timing = { value, options, running: false, starts: 0, stops: 0 }; timings.push(timing);
      return { start() { timing.running = true; timing.starts++; }, stop() { timing.running = false; timing.stops++; } };
    } },
  };
  const backModule = { exports: {} as Record<string, any> };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/ui/WalletBackHandler.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: backModule, exports: backModule.exports, require(name: string) {
    assert.equal(name, 'react-native'); return native;
  } });
  const module = { exports: {} as Record<string, any> };
  const source = readFileSync(new URL('../src/ui/WalletModal.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, require(name: string) {
      if (name === 'react') return React;
      if (name === 'react-native') return native;
      if (name === './walletModalState') return { WalletModalState };
      if (name === './WalletBackHandler') return backModule.exports;
      throw Error('Unexpected import: ' + name);
    },
  });
  const root = createRoot(dom.window.document.getElementById('root')!);
  return {
    WalletBackHandler: backModule.exports.WalletBackHandler,
    WalletModal: module.exports.WalletModal as React.ComponentType<any>,
    WalletModalHost: module.exports.WalletModalHost as React.ComponentType<any>,
    NativeModal, document: dom.window.document, emit, values, timings, motionPreference, motionListeners,
    get motionQueries() { return motionQueries; },
    emitMotion(reduced: boolean) { for (const callback of [...motionListeners]) callback(reduced); },
    get nativeShows() { return nativeShows; },
    back() { return [...(listeners.get('hardwareBackPress') ?? [])].reverse().some(callback => callback() === true); },
    listen: event,
    async render(element: React.ReactElement) {
      // The test's react-dom type package has its own ReactNode declaration.
      await act(async () => root.render(element as unknown as Parameters<typeof root.render>[0]));
    },
    async dispose() {
      await act(async () => root.unmount()); dom.window.close();
      for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('Android in-tree sheets avoid the native dialog blur that retires the wallet', async () => {
  const f = await fixture(); let locks = 0;
  f.listen('blur', () => { locks++; });
  try {
    // Model the pinned RN Android Modal's focus-taking dialog, with the existing
    // wallet blur policy. This is a JS regression, not an Android device test.
    await f.render(React.createElement(f.NativeModal, { visible: true }, 'old dialog'));
    assert.equal(locks, 1);
    await f.render(React.createElement(f.WalletModalHost, null,
      React.createElement('button', null, 'Bottom tab'),
      React.createElement(f.WalletModal, { visible: true, transparent: true, onRequestClose() {} }, 'Receive on')));
    assert.equal(locks, 1); assert.equal(f.nativeShows, 1);
    assert(f.document.body.textContent!.includes('Receive on'));
    const tab = f.document.querySelector('button')!;
    assert.equal(tab.parentElement!.getAttribute('data-pointer'), 'none');
    assert.equal(tab.parentElement!.getAttribute('aria-hidden'), 'true');
  } finally { await f.dispose(); }
});

test('only the top nested sheet handles Back and removing its owner removes descendants', async () => {
  const f = await fixture(); let parentClosed = 0, childClosed = 0, underlyingBack = 0;
  f.listen('hardwareBackPress', () => { underlyingBack++; return false; });
  function Parent({ visible = true }) {
    const [child, setChild] = React.useState(true);
    return React.createElement(f.WalletModal, { visible, onRequestClose: () => { parentClosed++; } },
      'Parent sheet', React.createElement(f.WalletModal, { visible: child, onRequestClose: () => { childClosed++; setChild(false); } }, 'Child sheet'));
  }
  try {
    await f.render(React.createElement(f.WalletModalHost, null, React.createElement(Parent)));
    assert(f.document.body.textContent!.includes('Child sheet'));
    const lateUnderlay = f.WalletBackHandler.addEventListener('hardwareBackPress', () => { underlyingBack++; return true; });
    await act(async () => { assert.equal(f.back(), true); });
    assert.equal(childClosed, 1); assert.equal(parentClosed, 0); assert.equal(underlyingBack, 0);
    assert(!f.document.body.textContent!.includes('Child sheet'));
    lateUnderlay.remove();
    await f.render(React.createElement(f.WalletModalHost, null, 'Owner left'));
    assert(!f.document.body.textContent!.includes('Parent sheet'));
    assert.equal(f.back(), false); assert.equal(underlyingBack, 1);
  } finally { await f.dispose(); }
});

test('background dismisses sheets and a stale visible render cannot reopen them', async () => {
  const f = await fixture(); let closes = 0;
  const render = (visible: boolean, text: string) => f.render(React.createElement(f.WalletModalHost, null,
    React.createElement(f.WalletModal, { visible, onRequestClose: () => { closes++; } }, text)));
  try {
    await render(true, 'Network choices');
    await act(async () => f.emit('change', 'background'));
    assert.equal(closes, 1); assert(!f.document.body.textContent!.includes('Network choices'));
    await act(async () => f.emit('change', 'active'));
    await render(true, 'Stale choices');
    assert(!f.document.body.textContent!.includes('Stale choices'));
    await render(false, 'Closed'); await render(true, 'Fresh choices');
    assert(f.document.body.textContent!.includes('Fresh choices'));
  } finally { await f.dispose(); }
});

test('unmounting a modal owner removes its still-open nested sheet and releases Back priority', async () => {
  const f = await fixture(); let underlying = 0;
  f.WalletBackHandler.addEventListener('hardwareBackPress', () => { underlying++; return true; });
  const nested = React.createElement(f.WalletModal, { visible: true, onRequestClose() {} }, 'Child owner',
    React.createElement(f.WalletModal, { visible: true, onRequestClose() {} }, 'Nested child'));
  try {
    await f.render(React.createElement(f.WalletModalHost, null, nested));
    assert(f.document.body.textContent!.includes('Nested child'));
    await f.render(React.createElement(f.WalletModalHost, null, 'Owner removed'));
    assert(!f.document.body.textContent!.includes('Nested child'));
    assert.equal(f.back(), true); assert.equal(underlying, 1);
  } finally { await f.dispose(); }
});

test('iOS retains native Modal presentation and its existing close callback', async () => {
  const f = await fixture('ios');
  try {
    await f.render(React.createElement(f.WalletModalHost, null,
      React.createElement(f.WalletModal, { visible: true, animationType: 'slide', onRequestClose() {} }, 'iOS sheet')));
    assert.equal(f.nativeShows, 1);
    assert.equal(f.motionQueries, 0); assert.equal(f.motionListeners.size, 0);
    assert(f.document.querySelector('[data-native-modal]'));
  } finally { await f.dispose(); }
});

// These exercise the AccessibilityInfo/Animated API boundary, not Android OS rendering.
test('motion API: unknown preference shows the layer statically and a late allowance does not replay it', async () => {
  const f = await fixture();
  const render = (visible: boolean) => f.render(React.createElement(f.WalletModalHost, null,
    React.createElement(f.WalletModal, { visible, animationType: 'slide', onRequestClose() {} }, 'Public sheet')));
  try {
    await render(true);
    assert(f.document.body.textContent!.includes('Public sheet'));
    assert.equal(f.values[0]!.value, 1); assert.equal(f.timings.length, 0);
    assert.equal(f.motionQueries, 1); assert.equal(f.motionListeners.size, 1);
    await act(async () => f.motionPreference.resolve(false));
    assert.equal(f.values[0]!.value, 1); assert.equal(f.timings.length, 0);
    await render(false); await render(true);
    assert.equal(f.values[1]!.value, 0);
    assert.equal(f.timings.length, 1);
    assert.equal(f.timings[0]!.running, true);
    assert.equal(f.timings[0]!.options.duration, 200);
    assert.equal(f.timings[0]!.options.useNativeDriver, true);
    assert.equal(f.timings[0]!.options.toValue, 1);
  } finally { await f.dispose(); }
});

test('motion API: an initially reduced preference keeps new slide and fade layers visible without timing', async () => {
  const f = await fixture();
  try {
    await f.render(React.createElement(f.WalletModalHost));
    await act(async () => f.motionPreference.resolve(true));
    await f.render(React.createElement(f.WalletModalHost, null,
      React.createElement(f.WalletModal, { animationType: 'slide', onRequestClose() {} }, 'Public slide'),
      React.createElement(f.WalletModal, { animationType: 'fade', onRequestClose() {} }, 'Public fade')));
    assert(f.document.body.textContent!.includes('Public slide'));
    assert(f.document.body.textContent!.includes('Public fade'));
    assert.deepEqual(f.values.map(value => value.value), [1, 1]);
    assert.equal(f.timings.length, 0);
    await act(async () => f.emitMotion(false));
    assert.deepEqual(f.values.map(value => value.value), [1, 1]);
    assert.equal(f.timings.length, 0);
  } finally { await f.dispose(); }
});

test('motion API: explicit none stays visible without a timing after motion is allowed', async () => {
  const f = await fixture();
  try {
    await f.render(React.createElement(f.WalletModalHost));
    await act(async () => f.motionPreference.resolve(false));
    await f.render(React.createElement(f.WalletModalHost, null,
      React.createElement(f.WalletModal, { animationType: 'none', onRequestClose() {} }, 'Public sheet')));
    assert(f.document.body.textContent!.includes('Public sheet'));
    assert.equal(f.values[0]!.value, 1); assert.equal(f.timings.length, 0);
  } finally { await f.dispose(); }
});

for (const animationType of ['slide', 'fade'] as const) {
  test(`motion API: reducing motion stops an in-flight ${animationType} without replay on later allowance`, async () => {
    const f = await fixture();
    const render = (visible: boolean, content = 'Public sheet') => f.render(React.createElement(f.WalletModalHost, null,
      React.createElement(f.WalletModal, { visible, animationType, onRequestClose() {} }, content)));
    try {
      await render(false);
      await act(async () => f.motionPreference.resolve(false));
      await render(true);
      const timing = f.timings[0]!;
      assert.equal(timing.running, true); assert.equal(timing.value.value, 0);
      await act(async () => f.emitMotion(true));
      assert.equal(timing.running, false); assert(timing.stops > 0);
      assert.equal(timing.value.value, 1);
      assert(f.document.body.textContent!.includes('Public sheet'));
      await act(async () => f.emitMotion(false));
      await render(true, 'Updated public sheet');
      assert.equal(timing.value.value, 1); assert.equal(f.timings.length, 1);
      await render(false); await render(true);
      assert.equal(f.timings.length, 2); assert.equal(f.timings[1]!.running, true);
    } finally { await f.dispose(); }
    assert.equal(f.motionListeners.size, 0);
    assert(f.timings.every(timing => !timing.running));
  });
}

test('motion API: a late query cannot overwrite a newer reduced-motion event', async () => {
  const f = await fixture();
  try {
    await f.render(React.createElement(f.WalletModalHost));
    await act(async () => f.emitMotion(true));
    await act(async () => f.motionPreference.resolve(false));
    await f.render(React.createElement(f.WalletModalHost, null,
      React.createElement(f.WalletModal, { animationType: 'slide', onRequestClose() {} }, 'Public sheet')));
    assert.equal(f.values[0]!.value, 1); assert.equal(f.timings.length, 0);
  } finally { await f.dispose(); }
});

test('motion API: an unavailable preference keeps the layer visible and static', async () => {
  const f = await fixture();
  try {
    await f.render(React.createElement(f.WalletModalHost, null,
      React.createElement(f.WalletModal, { animationType: 'fade', onRequestClose() {} }, 'Public sheet')));
    await act(async () => f.motionPreference.reject(new Error('Preference unavailable')));
    assert(f.document.body.textContent!.includes('Public sheet'));
    assert.equal(f.values[0]!.value, 1); assert.equal(f.timings.length, 0);
  } finally { await f.dispose(); }
});

test('motion API: unmount removes its subscription and ignores a late query and queued event', async () => {
  const f = await fixture(); let disposed = false;
  try {
    await f.render(React.createElement(f.WalletModalHost));
    assert.equal(f.motionQueries, 1);
    const queued = [...f.motionListeners];
    await f.dispose(); disposed = true;
    assert.equal(f.motionListeners.size, 0);
    await act(async () => {
      f.motionPreference.resolve(false);
      for (const callback of queued) callback(false);
    });
    assert.equal(f.timings.length, 0);
  } finally { if (!disposed) await f.dispose(); }
});
