import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeRecoveryFlow, type RecoveryOutcome } from '../src/custody/recoveryFlow.ts';
import type { RecoveryProof } from '../src/custody/recovery.ts';
import type { RecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const phrase = Array(12).fill('publicfixture').join(' ');
const inventory: RecoveryInventory = { status: 'needs-matching-phrase-verification', reason: null, backup: 'unconfirmed',
  counts: { hdAccounts: 2, importedKeys: 1, retainedSignedTransactions: 3, tokenEntries: 4, historySummaries: 5, cachedTransactions: 6, activityPreferences: 1 },
  privateNotes: 'requires-matching-phrase-verification' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function owner() {
  const prepared: { phrase: string; pin: string }[] = [], outcomes: RecoveryOutcome[] = [];
  let commits = 0;
  const flow = new NativeRecoveryFlow({
    async readInventory() { return inventory; }, isCurrent: () => true, now: () => 100,
    createCoordinator() { return {
      async prepare(phrase, pin, check) { check(); prepared.push({ phrase, pin }); return Object.freeze({}) as RecoveryProof; },
      async commit() { commits++; return 'committed-locked'; }, cancel() {},
    }; },
    async finish(result) { outcomes.push(result); },
  });
  return { flow, prepared, outcomes, get commits() { return commits; } };
}
function fixture() {
  let state = 'active';
  const events = new Set<(state: string) => void>();
  const current = owner();
  let flow = current.flow;
  const host = screenFixture(new URL('../src/screens/NativeRecovery.tsx', import.meta.url), 'NativeRecovery', {
    'react-native': {
      View: 'View', Text: 'NativeText', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss() {} },
      AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null,
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      AppState: { get currentState() { return state; }, addEventListener: (_name: string, callback: (next: string) => void) => { events.add(callback); return { remove: () => events.delete(callback) }; } },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Icon', 'Notice', 'Screen', 'SegmentedControl', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    './PinEntry': { PinSetup: 'PinSetup' },
  });
  const render = () => { host.render({ flow }); return screenElements(host.render({ flow })); };
  const press = (title: string) => button(render(), title).props.onPress();
  return { ...current, get commits() { return current.commits; }, render, press, close: host.close,
    background() { state = 'background'; for (const callback of events) callback(state); },
    replace(next: NativeRecoveryFlow) { flow = next; },
  };
}
function button(tree: ScreenElement[], title: string) {
  const found = tree.find(element => element.type === 'Button' && element.props.title === title);
  assert(found, title); return found;
}
function firstWord(tree: ScreenElement[]) {
  const found = tree.find(element => element.type === 'Input' && element.props.accessibilityLabel === 'Recovery word 1');
  assert(found); return found;
}
function pinSetup(tree: ScreenElement[]) {
  const found = tree.find(element => element.type === 'PinSetup'); assert(found); return found;
}
async function words(f: ReturnType<typeof fixture>) {
  f.render(); await tick(); f.press('Restore Wallet'); f.render();
  firstWord(f.render()).props.onChangeText(phrase); f.render();
}

test('recovery opens on the compact reference intro with data details collapsed', async () => {
  const f = fixture(); f.render(); await tick();
  const shown = f.render();
  assert(shown.some(element => element.type === 'Icon' && element.props.name === 'key'));
  assert(shown.some(element => element.children.includes('Forgot your PIN?')));
  assert.equal(button(shown, 'Restore Wallet').props.disabled, false);
  assert.equal(button(shown, 'Cancel').props.variant, 'secondary');
  assert(!shown.some(element => typeof element.type === 'function' && element.type.name === 'Inventory'));
  f.press('Saved-data details');
  const details = f.render().find(element => typeof element.type === 'function' && element.type.name === 'Inventory');
  assert(details); assert.strictEqual(details.props.inventory, inventory);
  assert.equal(f.prepared.length, 0); f.close();
});

test('numbered phrase entry precedes PIN confirmation and a separate commit review', async () => {
  const f = fixture(); await words(f);
  assert.equal(f.render().filter(element => element.type === 'Input').length, 12);
  f.press('Continue');
  const pin = pinSetup(f.render());
  assert.equal(pin.props.offerBiometrics, false); assert.equal(f.prepared.length, 0);
  assert(!f.render().some(element => element.type === 'Input'));
  pin.props.onComplete('123456', false); pin.props.onComplete('123456', false); await tick();
  assert.deepEqual(f.prepared, [{ phrase, pin: '123456' }]);
  assert.equal(f.flow.getSnapshot().phase, 'review'); assert.equal(f.commits, 0);
  const current = f.render(); assert(!JSON.stringify(current).includes(phrase)); assert(!JSON.stringify(current).includes('123456'));
  f.press('Change PIN'); await tick(); assert.equal(f.commits, 1);
  assert.equal(f.outcomes[0]?.kind, 'success'); assert.match(f.outcomes[0]!.message, /PIN changed/); f.close();
});

test('24-word paste selects the numbered grid without invoking recovery authority', async () => {
  const f = fixture(); f.render(); await tick(); f.press('Restore Wallet');
  firstWord(f.render()).props.onChangeText(Array(24).fill('publicword').join(' '));
  const grid = f.render(); assert.equal(grid.filter(element => element.type === 'Input').length, 24);
  assert.equal(grid.find(element => element.type === 'SegmentedControl')?.props.value, '24');
  assert.equal(button(grid, 'Continue').props.disabled, false); assert.equal(f.prepared.length, 0); f.close();
});

test('Back restores phrase editing and an old PIN callback cannot submit the new attempt', async () => {
  const f = fixture(); await words(f); f.press('Continue');
  const old = pinSetup(f.render()); old.props.onBack();
  assert.equal(firstWord(f.render()).props.value, 'publicfixture');
  f.press('Continue'); pinSetup(f.render()); old.props.onComplete('654321', false);
  assert.equal(f.prepared.length, 0);
  pinSetup(f.render()).props.onComplete('123456', false); await tick(); assert.equal(f.prepared.length, 1); f.close();
});

test('background cancellation clears the local phrase and invalidates the PIN callback', async () => {
  const f = fixture(); await words(f); f.press('Continue'); const old = pinSetup(f.render());
  f.background(); old.props.onComplete('123456', false); await tick();
  assert.equal(f.prepared.length, 0); assert.equal(f.outcomes[0]?.kind, 'cancelled');
  assert(!JSON.stringify(f.render()).includes(phrase)); f.close();
});

test('a replacement recovery owner never inherits inputs or the previous PIN callback', async () => {
  const f = fixture(); await words(f); f.press('Continue'); const old = pinSetup(f.render());
  const next = owner(); f.replace(next.flow); f.render(); await tick(); f.render(); old.props.onComplete('123456', false);
  assert.equal(f.prepared.length, 0); assert.equal(next.prepared.length, 0);
  f.press('Restore Wallet'); assert.equal(firstWord(f.render()).props.value, '');
  f.close();
});
