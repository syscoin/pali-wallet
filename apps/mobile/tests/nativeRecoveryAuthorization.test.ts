import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeRecoveryFlow, type RecoveryOutcome } from '../src/custody/recoveryFlow.ts';
import { credentialPromptActivityState } from '../src/platform/credentialPort.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import type { RecoveryProof } from '../src/custody/recovery.ts';
import type { RecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const phrase = Array(12).fill('publicfixture').join(' ');
const inventory: RecoveryInventory = { status: 'needs-matching-phrase-verification', reason: null, backup: 'unconfirmed',
  counts: { hdAccounts: 2, importedKeys: 1, retainedSignedTransactions: 3, tokenEntries: 4, historySummaries: 5, cachedTransactions: 6, activityPreferences: 1 },
  privateNotes: 'requires-matching-phrase-verification' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function owner(activity: { state(): string; subscribe(listener: (state: string) => void): () => void } = { state: () => 'active', subscribe: () => () => {} }, promptAllowed = () => true) {
  const prepared: { phrase: string }[] = [], outcomes: RecoveryOutcome[] = [];
  let commits = 0, durableWrites = 0, cancelled = false, pending: Promise<void> | undefined, authenticate = false;
  const prompt = new DeviceUnlockPrompt(activity); let promptOwner: AbortController | undefined;
  const flow = new NativeRecoveryFlow({
    async readInventory() { return inventory; }, isCurrent: () => true, now: () => 100,
    createCoordinator() { return {
      async prepare(phrase, check) { check(); prepared.push({ phrase }); return Object.freeze({}) as RecoveryProof; },
      isAuthenticating: () => promptAllowed() && !!promptOwner && prompt.isActive(promptOwner.signal),
      async commit() { commits++;
        if (authenticate) { promptOwner = new AbortController(); await prompt.run(promptOwner.signal, async () => { await pending; }); }
        else await pending;
        if (cancelled) throw Error('CANCELLED'); durableWrites++; return 'committed-locked';
      }, cancel() { cancelled = true; promptOwner?.abort(); prompt.cancel(); },
    }; },
    async finish(result) { outcomes.push(result); },
  });
  return { flow, prepared, outcomes, holdCommit(wait: Promise<void>, ownedPrompt = false) { pending = wait; authenticate = ownedPrompt; }, get commits() { return commits; }, get durableWrites() { return durableWrites; } };
}
function fixture(platform = 'android') {
  let state = 'active', nativePromptActive = false;
  const native = { isCredentialPromptActive: () => nativePromptActive };
  const normalized = (value: string) => credentialPromptActivityState(platform, value, native);
  const events = new Map<string, Set<(state: string) => void>>();
  const listen = (event: string, listener: (state: string) => void) => {
    const group = events.get(event) ?? new Set<(state: string) => void>(); events.set(event, group); group.add(listener);
    return () => { group.delete(listener); };
  };
  const activity = (next: string) => {
    const event = next === 'blur' || next === 'focus' ? next : 'change';
    if (event === 'change') state = next;
    for (const callback of [...events.get(event) ?? []]) callback(next);
    for (const callback of [...events.get('prompt') ?? []]) callback(normalized(next));
  };
  const current = owner({ state: () => normalized(state), subscribe: listener => listen('prompt', listener) }, () => normalized(state) !== 'background');
  let flow = current.flow;
  const host = screenFixture(new URL('../src/screens/NativeRecovery.tsx', import.meta.url), 'NativeRecovery', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': {
      View: 'View', Text: 'NativeText', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: platform }, StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss() {} },
      AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null,
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      AppState: { get currentState() { return state; }, addEventListener: (name: string, callback: (next: string) => void) => ({ remove: listen(name, callback) }) },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Icon', 'Notice', 'Screen', 'SegmentedControl', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
  });
  const render = () => { host.render({ flow }); return screenElements(host.render({ flow })); };
  const press = (title: string) => button(render(), title).props.onPress();
  return { ...current, get commits() { return current.commits; }, get durableWrites() { return current.durableWrites; }, render, press, close: host.close,
    nativeWindow(value: boolean) { nativePromptActive = value; }, activity, background() { activity('background'); },
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
async function words(f: ReturnType<typeof fixture>) {
  f.render(); await tick(); f.press('Restore Wallet'); f.render();
  firstWord(f.render()).props.onChangeText(phrase); f.render();
}

test('recovery opens on the compact reference intro with data details collapsed', async () => {
  const f = fixture(); f.render(); await tick();
  const shown = f.render();
  assert(shown.some(element => element.type === 'Icon' && element.props.name === 'key'));
  assert(shown.some(element => element.children.includes('Restore wallet access')));
  assert.equal(button(shown, 'Restore Wallet').props.disabled, false);
  assert.equal(button(shown, 'Cancel').props.variant, 'secondary');
  assert(!shown.some(element => typeof element.type === 'function' && element.type.name === 'Inventory'));
  f.press('Saved-data details');
  const details = f.render().find(element => typeof element.type === 'function' && element.type.name === 'Inventory');
  assert(details); assert.strictEqual(details.props.inventory, inventory);
  assert.equal(f.prepared.length, 0); f.close();
});

test('phrase verification and wallet review precede device-protected restore', async () => {
  const f = fixture(); await words(f);
  f.press('Continue'); await tick();
  assert.deepEqual(f.prepared, [{ phrase }]); assert.equal(f.commits, 0);
  assert.equal(f.flow.getSnapshot().phase, 'review');
  const restore = button(f.render(), 'Restore secure access');
  restore.props.onPress(); restore.props.onPress(); await tick();
  assert.equal(f.commits, 1); assert.equal(f.durableWrites, 1);
  assert(!f.render().some(element => element.type === 'Input' || element.type === 'PinSetup'));
  assert.equal(f.outcomes[0]?.kind, 'success'); f.close();
});

test('24-word paste selects the numbered grid without invoking recovery authority', async () => {
  const f = fixture(); f.render(); await tick(); f.press('Restore Wallet');
  firstWord(f.render()).props.onChangeText(Array(24).fill('publicword').join(' '));
  const grid = f.render(); assert.equal(grid.filter(element => element.type === 'Input').length, 24);
  assert.equal(grid.find(element => element.type === 'SegmentedControl')?.props.value, '24');
  assert.equal(button(grid, 'Continue').props.disabled, false); assert.equal(f.prepared.length, 0); f.close();
});

test('Back after wallet verification retires the old restore callback', async () => {
  const f = fixture(); await words(f); f.press('Continue'); await tick();
  const old = button(f.render(), 'Restore secure access'); f.press('Cancel recovery'); old.props.onPress(); await tick();
  assert.equal(f.commits, 0); assert.equal(f.outcomes[0]?.kind, 'cancelled'); f.close();
});

test('background during device enrollment prevents a late durable restore', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdCommit(held.promise);
  await words(f); f.press('Continue'); await tick(); f.press('Restore secure access');
  assert.equal(f.commits, 1); f.background(); held.resolve(); await tick();
  assert.equal(f.durableWrites, 0); assert.equal(f.outcomes[0]?.kind, 'uncertain');
  assert(!JSON.stringify(f.render()).includes(phrase)); f.close();
});

test('a replacement recovery owner never inherits the previous restore callback', async () => {
  const f = fixture(); await words(f); f.press('Continue'); await tick(); const old = button(f.render(), 'Restore secure access');
  const next = owner(); f.replace(next.flow); f.render(); await tick(); f.render(); old.props.onPress();
  assert.equal(f.commits, 0); assert.equal(next.commits, 0);
  f.press('Restore Wallet'); assert.equal(firstWord(f.render()).props.value, ''); f.close();
});

for (const interruption of ['inactive', 'blur'] as const) test(`owned recovery device prompt survives ${interruption} and completes after focus returns`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdCommit(held.promise, true);
  try {
    await words(f); f.press('Continue'); await tick(); f.press('Restore secure access');
    assert.equal(f.flow.isAuthenticating(), true);
    f.activity(interruption); f.render();
    assert.equal(f.flow.getSnapshot().phase, 'committing'); assert.equal(f.outcomes.length, 0);
    f.activity('active'); f.activity('focus'); held.resolve(); await tick();
    assert.equal(f.durableWrites, 1); assert.equal(f.outcomes[0]?.kind, 'success');
  } finally { f.close(); }
});

for (const interruption of ['inactive', 'blur', 'background'] as const) test(`unowned recovery ${interruption} cancels a pending enrollment before any write`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdCommit(held.promise);
  try {
    await words(f); f.press('Continue'); await tick(); f.press('Restore secure access');
    assert.equal(f.flow.isAuthenticating(), false);
    f.activity(interruption); held.resolve(); await tick();
    assert.equal(f.durableWrites, 0); assert.equal(f.outcomes[0]?.kind, 'uncertain');
  } finally { f.close(); }
});

test('real background cancels even an owned recovery device prompt', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdCommit(held.promise, true);
  try {
    await words(f); f.press('Continue'); await tick(); f.press('Restore secure access');
    assert.equal(f.flow.isAuthenticating(), true); f.background(); held.resolve(); await tick();
    assert.equal(f.durableWrites, 0); assert.equal(f.outcomes[0]?.kind, 'uncertain');
  } finally { f.close(); }
});

test('Android system credential Activity alone permits raw background until foreground return', async () => {
  const f = fixture('android'), held = Promise.withResolvers<void>(); f.holdCommit(held.promise, true);
  try {
    await words(f); f.press('Continue'); await tick(); f.press('Restore secure access');
    f.nativeWindow(true); f.activity('background');
    assert.equal(f.flow.isAuthenticating(), true); assert.equal(f.flow.getSnapshot().phase, 'committing');
    assert.equal(f.outcomes.length, 0); assert.equal(f.durableWrites, 0);
    f.activity('active'); f.nativeWindow(false); held.resolve(); await tick();
    assert.equal(f.durableWrites, 1); assert.equal(f.outcomes[0]?.kind, 'success');
  } finally { f.close(); }
});

test('iOS background never inherits the Android system-credential exception', async () => {
  const f = fixture('ios'), held = Promise.withResolvers<void>(); f.holdCommit(held.promise, true);
  try {
    await words(f); f.press('Continue'); await tick(); f.press('Restore secure access');
    f.nativeWindow(true); f.background(); held.resolve(); await tick();
    assert.equal(f.durableWrites, 0); assert.equal(f.outcomes[0]?.kind, 'uncertain');
  } finally { f.close(); }
});
