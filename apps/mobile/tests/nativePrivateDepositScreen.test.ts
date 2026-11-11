import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { KeyringAccountType } from '@sidhujag/sysweb3-keyring';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { NativePrivateDeposit } from '../src/custody/privateDeposit.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import type { IPrivacyDepositReview } from '../../../source/utils/privacy/transactionTypes.ts';
import type { PrivacyPoolId } from '../../../source/utils/privacy/types.ts';
import { screenElements, type ScreenElement } from './screenFixture.ts';
import { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';

type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
type Component = (props: any) => ScreenElement;
const pools = [{ id: 'eth-1', amount: '1' }, { id: 'eth-10', amount: '10' }] as const;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

// Separate hook storage for the actual owner and its actual content component.
function mount(file: string, name: string) {
  const owners = new Map<Component, Cell[]>();
  let cells: Cell[] = [], cursor = 0, dirty = false;
  const effects: (() => void)[] = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const effect = (callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const c = cell();
    if (deps && c.deps && deps.length === c.deps.length && deps.every((d, i) => Object.is(d, c.deps![i]))) return;
    c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = callback() || undefined; });
  };
  const react = {
    createElement: (type: unknown, props: object | null, ...children: unknown[]): ScreenElement => ({ type, props: props ?? {}, children }),
    useState(initial: any) { const c = cell(); if (!Object.hasOwn(c, 'value')) c.value = typeof initial === 'function' ? initial() : initial;
      return [c.value, (next: any) => { c.value = typeof next === 'function' ? next(c.value) : next; dirty = true; }]; },
    useRef(initial: any) { const c = cell(); c.value ??= { current: initial }; return c.value; },
    useMemo(create: () => any, deps: readonly unknown[]) { const c = cell();
      if (!c.deps || deps.length !== c.deps.length || deps.some((d, i) => !Object.is(d, c.deps![i]))) { c.value = create(); c.deps = deps; } return c.value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { return react.useMemo(() => callback, deps); },
    useEffect: effect, useLayoutEffect: effect,
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) { return read(); },
  };
  let active = 'active';
  const listeners = new Map<string, Set<(state: string) => void>>();
  const native = {
    AppState: { get currentState() { return active; }, addEventListener(event: string, callback: (state: string) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback);
      return { remove() { listeners.get(event)!.delete(callback); } };
    } },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' },
    StyleSheet: { create: (style: unknown) => style, hairlineWidth: 1 },
    ActivityIndicator: 'ActivityIndicator', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', Keyboard: { dismiss() {} },
  };
  const imports: Record<string, unknown> = {
    react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/utils/privacy/registry': { PRIVACY_POOLS: pools },
    '../core/amounts': { formatBaseUnits }, '../platform/security': { recordIdleActivity: () => true },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(value => [value, value])), colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    './NoteBackupPasswordField': { NoteBackupPasswordField: 'NoteBackupPasswordField' }, './PinEntry': { PinField: 'PinField' },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
  };
  const module = { exports: {} as Record<string, Component> };
  const code = ts.transpileModule(readFileSync(new URL(`../src/screens/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, Date, setTimeout, clearTimeout,
    require(path: string) { assert(Object.hasOwn(imports, path), `Missing screen port ${path}`); return imports[path]; } });
  const expand = (value: any, visited: Set<Component>): any => {
    if (Array.isArray(value)) return value.map(child => expand(child, visited));
    if (!value || typeof value !== 'object' || !('type' in value)) return value;
    if (typeof value.type === 'function') {
      const component = value.type as Component; visited.add(component);
      cells = owners.get(component) ?? []; owners.set(component, cells); cursor = 0;
      return expand(component({ ...value.props, children: value.children }), visited);
    }
    return { ...value, children: expand(value.children, visited), props: { ...value.props, ...(value.props.footer ? { footer: expand(value.props.footer, visited) } : {}) } };
  };
  return {
    render(props: object): ScreenElement {
      for (let pass = 0; pass < 20; pass++) {
        dirty = false; const visited = new Set<Component>();
        const tree = expand(react.createElement(module.exports[name], props), visited);
        for (const [component, owned] of owners) if (!visited.has(component)) { owned.forEach(c => c.cleanup?.()); owners.delete(component); }
        effects.splice(0).forEach(run => run()); if (!dirty) return tree;
      }
      throw Error('Unsettled screen');
    },
    background() { active = 'background'; for (const fn of [...listeners.get('change') ?? []]) fn(active); },
    close() { owners.forEach(owned => owned.forEach(c => c.cleanup?.())); owners.clear(); },
  };
}
function button(tree: ScreenElement, title: string) {
  const value = screenElements(tree).find(node => node.type === 'Button' && node.props.title === title); assert(value, title); return value;
}
function fixture() {
  const requests: { poolId: PrivacyPoolId; noteId?: string }[] = [];
  const events: string[] = [];
  let submissions = 0;
  let closing: Promise<void> | undefined;
  let serial = 0;
  const open = async (signal: AbortSignal, check: () => void) => {
    check(); events.push('open');
    return new NativePrivateDeposit({ assertCurrent: check, async close() { events.push('close'); await closing; },
      async readStatus() { return { phase: 'verified' }; },
      transactions: { close() {}, async discardDeposit() { events.push('discard'); },
        async prepareDeposit(request) {
          requests.push({ ...request }); serial++;
          return { account: { type: KeyringAccountType.HDAccount, id: 0, address: '0x' + '11'.repeat(20) }, amount: request.poolId === 'eth-10' ? '10' : '1', chainId: 1,
            createdAt: Date.now(), expiresAt: Date.now() + 90_000, feeMode: 'legacy', gasLimit: '21000', gasPrice: '1',
            intentId: `review-${serial}`, maxNetworkFeeWei: '21000', maxTotalWei: '1000000000000021000', nonce: '0',
            noteId: request.noteId ?? 'saved-note', poolAddress: '0x' + '22'.repeat(20), poolId: request.poolId, valueWei: '1000000000000000000',
          } satisfies IPrivacyDepositReview;
        },
        async submitDeposit(intentId) { submissions++; return { intentId, noteId: 'saved-note', phase: 'submitted', transactionHash: '0x' + '33'.repeat(32) }; },
      },
    }, signal);
  };
  return { open, requests, events, get submissions() { return submissions; }, holdClose(value: Promise<void>) { closing = value; } };
}

test('backup detour drains its old controller and reopens the same public note with a fresh unapproved review', async () => {
  const host = fixture(), first = mount('NativePrivateDeposit', 'NativePrivateDeposit');
  const returns: unknown[] = [];
  const props = { open: host.open, onBack() {}, onBackup(task: unknown) { returns.push(task); } };
  let second: ReturnType<typeof mount> | undefined;
  try {
    first.render(props); await tick();
    const ten = screenElements(first.render(props)).find(node => node.props.accessibilityLabel === '10 ETH pool'); assert(ten); ten.props.onPress();
    button(first.render(props), 'Review deposit').props.onPress(); await tick();
    let tree = first.render(props);
    const ack = screenElements(tree).find(node => node.props.accessibilityRole === 'checkbox'); assert(ack); ack.props.onPress();
    assert.equal(button(first.render(props), 'Confirm deposit').props.disabled, false);
    const held = Promise.withResolvers<void>(); host.holdClose(held.promise);
    const oldBackup = button(first.render(props), 'Back up private notes'); oldBackup.props.onPress(); await tick();
    assert.deepEqual(returns, [], 'navigation waits for old work to drain');
    held.resolve(); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(returns)), [{ poolId: 'eth-10', noteId: 'saved-note' }]);
    first.close(); oldBackup.props.onPress(); assert.equal(returns.length, 1);
    second = mount('NativePrivateDeposit', 'NativePrivateDeposit');
    const resumed = { ...props, initialTask: returns[0] };
    second.render(resumed); await tick(); second.render(resumed); await tick(); tree = second.render(resumed);
    assert.deepEqual(JSON.parse(JSON.stringify(host.requests)), [{ poolId: 'eth-10' }, { poolId: 'eth-10', noteId: 'saved-note' }]);
    assert.equal(host.events.filter(event => event === 'open').length, 2);
    assert.equal(button(tree, 'Confirm deposit').props.disabled, true, 'old acknowledgement is not reused');
    assert.equal(host.submissions, 0);
  } finally { first.close(); second?.close(); }
});

test('an old backup action cannot carry a superseded review into the return route', async () => {
  const host = fixture(), screen = mount('NativePrivateDeposit', 'NativePrivateDeposit'); let returns = 0;
  const props = { open: host.open, onBack() {}, onBackup() { returns++; } };
  try {
    screen.render(props); await tick(); button(screen.render(props), 'Review deposit').props.onPress(); await tick();
    const old = button(screen.render(props), 'Back up private notes');
    button(screen.render(props), 'Change amount').props.onPress();
    button(screen.render(props), 'Review deposit').props.onPress(); await tick();
    old.props.onPress(); await tick(); assert.equal(returns, 0); assert.equal(host.submissions, 0);
  } finally { screen.close(); }
});

test('submitted-note backup carries no new deposit task', async () => {
  const host = fixture(), screen = mount('NativePrivateDeposit', 'NativePrivateDeposit'); const returns: unknown[] = [];
  const props = { open: host.open, onBack() {}, onBackup(task: unknown) { returns.push(task); } };
  try {
    screen.render(props); await tick(); button(screen.render(props), 'Review deposit').props.onPress(); await tick();
    const ack = screenElements(screen.render(props)).find(node => node.props.accessibilityRole === 'checkbox'); assert(ack); ack.props.onPress();
    button(screen.render(props), 'Confirm deposit').props.onPress(); await tick();
    button(screen.render(props), 'Back up private notes').props.onPress(); await tick();
    assert.deepEqual(returns, [undefined]); assert.equal(host.submissions, 1);
  } finally { screen.close(); }
});

test('only a saved or verified backup shows Continue deposit', () => {
  const screen = mount('NativeNoteExport', 'NativeNoteExport');
  const props = { busy: false, error: '', doneLabel: 'Continue deposit', onChoose() {}, onSave() {}, onShowVerify() {}, onVerify() {}, onBack() {} };
  try {
    for (const phase of ['saved', 'verified'] as const) assert(button(screen.render({ ...props, step: { phase, noteCount: 1 } }), 'Continue deposit'));
    const unknown = screen.render({ ...props, step: { phase: 'unconfirmed' } });
    assert(button(unknown, 'Done'));
    assert(!screenElements(unknown).some(node => node.props.title === 'Continue deposit'));
  } finally { screen.close(); }
});
