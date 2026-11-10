import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { NotificationChoice } from '../src/notifications/choices.ts';
import type { NotificationSnapshot } from '../src/notifications/types.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const address = '0x' + '11'.repeat(20);
const choice = (id = 'ethereum'): NotificationChoice => ({ label: 'Account 1', networkName: getNativeNetwork(id).name, symbol: getNativeNetwork(id).symbol,
  scope: { id: `native:hd:60:0:${id}`, accountId: 'hd:60:0', accountType: 'HDAccount', accountAddress: address, network: getNativeNetwork(id) } });

function fixture(initiallyEnabled = false) {
  let choices = [choice()];
  let live = true, closed = 0;
  let pending: Promise<void> | undefined;
  let state: NotificationSnapshot = { status: 'ready', enabledScopeIds: initiallyEnabled ? [choices[0]!.scope.id] : [],
    permission: 'granted', background: 'available', pendingEventId: null, lastRunAt: null };
  const events: string[] = [];
  const service = {
    getSnapshot: () => state, subscribe: () => () => {},
    async load() { events.push('load'); },
    async enable(scopes: readonly NotificationChoice['scope'][], check: () => void) {
      events.push('permission'); check(); await pending; check();
      state = { ...state, enabledScopeIds: scopes.map(scope => scope.id) }; events.push('enrolled');
    },
    async disableScope(id: string) { events.push(`disable:${id}`); state = { ...state, enabledScopeIds: [] }; },
    async disableAll() { events.push('disable-all'); state = { ...state, enabledScopeIds: [] }; },
    async runForeground() { events.push('check'); },
  };
  const target = { scope: 'current-wallet', readChoices: () => choices, assertCurrent() { if (!live) throw Error('CANCELLED'); } };
  const screen = screenFixture(new URL('../src/screens/ActivityNotifications.tsx', import.meta.url), 'ActivityNotifications', {
    '../platform/localization': nativeTranslationFixture,
    '../notifications/service': { nativeActivityNotifications: service },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    'react-native': { AppState: { currentState: 'active' }, View: 'View', StyleSheet: { hairlineWidth: 1, create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
  });
  const render = () => screenElements(screen.render({ target, onBack() { closed++; } }));
  return { screen, render, events, target, state: () => state, closed: () => closed,
    hold(value: Promise<void>) { pending = value; }, replace() { choices = [choice(), choice('base')]; }, retire() { live = false; } };
}

test('opening and searching alerts never requests permission or changes enrollment', async () => {
  const f = fixture();
  try {
    const nodes = f.render();
    assert.equal(nodes.find(node => node.props.accessibilityRole === 'checkbox')?.props.accessibilityState.checked, false);
    nodes.find(node => node.type === 'Input')!.props.onChangeText('missing');
    assert.equal(f.render().filter(node => node.props.accessibilityRole === 'checkbox').length, 0);
    await settle(); assert.deepEqual(f.events, ['load']);
  } finally { f.screen.close(); }
});

test('only an explicit unchecked row requests enrollment and a repeated tap cannot duplicate it', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.hold(held.promise);
  try {
    const row = f.render().find(node => node.props.accessibilityRole === 'checkbox')!;
    row.props.onPress(); row.props.onPress();
    assert.deepEqual(f.events, ['load', 'permission']);
    held.resolve(); await settle();
    assert.deepEqual(Array.from(f.state().enabledScopeIds), [choice().scope.id]);
    assert.equal(f.render().find(node => node.props.accessibilityRole === 'checkbox')?.props.accessibilityState.checked, true);
  } finally { f.screen.close(); }
});

for (const ending of ['catalogue', 'owner', 'close', 'unmount'] as const) test(`${ending} change rejects a permission result before enrollment`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.hold(held.promise);
  try {
    const nodes = f.render(); nodes.find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress();
    if (ending === 'catalogue') f.replace();
    else if (ending === 'owner') f.retire();
    else if (ending === 'close') nodes.find(node => node.type === 'Header')!.props.onBack();
    else f.screen.close();
    held.resolve(); await settle();
    assert.deepEqual(f.state().enabledScopeIds, []);
    assert.equal(f.events.includes('enrolled'), false);
  } finally { f.screen.close(); }
});

test('disabling a row and Check now use their existing public service actions without permission', async () => {
  const f = fixture(true);
  try {
    const nodes = f.render();
    nodes.find(node => node.props.title === 'Check now')!.props.onPress(); await settle();
    assert.deepEqual(f.events, ['load', 'load', 'check']);
    f.render().find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress(); await settle();
    assert.equal(f.events.includes('permission'), false);
    assert.equal(f.events.at(-1), `disable:${choice().scope.id}`);
  } finally { f.screen.close(); }
});

test('Turn off all alerts is an explicit global action', async () => {
  const f = fixture(true);
  try {
    f.render().find(node => node.props.title === 'Turn off all alerts')!.props.onPress(); await settle();
    assert.deepEqual(f.events, ['load', 'disable-all']); assert.deepEqual(f.state().enabledScopeIds, []);
  } finally { f.screen.close(); }
});
