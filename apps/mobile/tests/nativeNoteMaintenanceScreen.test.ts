import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeNoteMaintenanceRuntime } from '../src/custody/noteBackupRuntime.ts';
import type { IPrivateNoteView } from '../../../source/utils/privacy/privateVaultTypes.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { isOperationAuthenticationCancellation, operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const notes: IPrivateNoteView[] = Array.from({ length: 41 }, (_, index) => ({ id: String(index + 1), amount: '1', createdAt: Date.UTC(2026, 0, index + 1), poolId: 'eth-1', phase: 'verified' }));

function fixture(fail = false, withHistory = false, count = 7, unresolved = false) {
  let reads = 0, clears = 0, backs = 0;
  const idsChecked: string[][] = [];
  const selections: ('earlier' | undefined)[] = [];
  let pending: Promise<void> | undefined;
  let runtimeSource = 0;
  const listeners = new Map<string, (next: string) => void>();
  let refusal: Error | undefined;
  const appState = { currentState: 'active', addEventListener: (event: string, listener: (next: string) => void) => { listeners.set(event, listener); return { remove() { listeners.delete(event); } }; } };
  let shown: IPrivateNoteView[] = withHistory ? [{ ...notes[0]!, archiveEarlierAttempts: 1, withdrawal: { mode: 'direct', phase: 'submitted' } }] : notes.slice(0, count);
  const runtime = {
    async dispose() {},
    async getNotes() { reads++; return { notes: shown }; },
    async clearCompletedNotes(ids, check, progress, reload, selection) {
      clears++; idsChecked.push([...ids]); selections.push(selection); assert.equal(ids.length, 1); check();
      if (refusal) { const error = refusal; refusal = undefined; throw error; }
      if (pending) await pending; check();
      progress({ checked: 1, total: 1 });
      if (!fail && !unresolved) shown = shown.filter(note => note.id !== ids[0]);
      reload({ notes: shown });
      if (fail) throw Error('Synthetic late failure');
      return { removed: unresolved ? [] : [...ids], unresolved: unresolved ? [...ids] : [] };
    },
  } satisfies NativeNoteMaintenanceRuntime;
  const f = screenFixture(new URL('../src/screens/NativeNoteMaintenance.tsx', import.meta.url), 'NativeNoteMaintenance', {
    'react-native': { AppState: appState, View: 'View',
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'Avoid', Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string, values: Record<string, unknown> = {}) => key === 'mobile.noteFlows.inventory.poolAmount' ? `${values.amount} ETH pool` : key === 'mobile.noteFlows.inventory.noteDate' ? `Note ${values.number} · ${values.date}` : key === 'mobile.noteFlows.inventory.recorded' ? `Recorded ${values.date}` : key }) },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope: () => ({ retire() {}, isAuthenticating: () => false }) },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption: () => false },
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Notice: 'Notice', Row: 'Row', Screen: 'Screen', Text: 'Text', colors: {}, styles: {} },
  }, { AbortController });
  const open = async () => runtime, replacementOpen = async () => runtime, onBack = () => { backs++; };
  const render = () => screenElements(f.render({ open: runtimeSource ? replacementOpen : open, onBack }));
  const press = (title: string) => {
    const button = render().find(element => element.props.title === title); assert(button); button.props.onPress();
  };
  const select = (number = 7) => { const row = render().find(element => element.props.icon === 'trash' && element.props.subtitle?.startsWith(`Note ${number} ·`)); assert(row); row.props.onPress(); };
  return { render, press, select, idsChecked, selections, backs: () => backs, pause(value: Promise<void>) { pending = value; }, replaceSource() { runtimeSource++; }, reads: () => reads, clears: () => clears,
    refuse(error: Error) { refusal = error; }, background(notify = false) { appState.currentState = 'background'; if (notify) listeners.get('change')?.('background'); }, close: f.close };
}

for (const fail of [false, true]) test(`maintenance screen targets the last of seven notes and uses final inventory after ${fail ? 'failure' : 'success'}`, async () => {
  const f = fixture(fail);
  try {
    f.render(); await settle(); assert.equal(f.reads(), 1);
    f.select(); f.press('privacy.capacity.confirmClear'); await settle();
    assert.equal(f.clears(), 1); assert.deepEqual(f.idsChecked, [['7']]);
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.confirmClear'));
    assert.equal(f.render().filter(element => element.props.icon === 'trash').length, fail ? 7 : 6);
    assert.equal(f.reads(), 1, 'The screen must not start another authorized reload');
    const elements = f.render();
    assert.equal(elements.some(element => element.children.includes('privacy.capacity.clearError')), fail);
    assert.equal(elements.some(element => element.children.includes('privacy.capacity.clearResult')), !fail);
  } finally { f.close(); }
});

test('maintenance keeps a cleanup choice for notes with prior history', async () => {
  const f = fixture(false, true);
  try {
    f.render(); await settle(); f.select(1);
    assert.equal(f.reads(), 1);
    assert(f.render().some(element => element.props.title === 'privacy.capacity.confirmClear'));
  } finally { f.close(); }
});

test('earlier attempts require an unresolved newest check and a separate confirmed press', async () => {
  const f = fixture(false, true, 1, true);
  try {
    f.render(); await settle(); f.select(1);
    assert(f.render().some(element => element.children.includes('privacy.capacity.earlierAttempts')));
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.checkEarlier'));
    f.press('privacy.capacity.confirmClear'); await settle();
    assert.deepEqual(f.idsChecked, [['1']]);
    assert.deepEqual(f.selections, [undefined]);
    assert(f.render().some(element => element.props.title === 'privacy.capacity.checkEarlierHelp'));
    const earlier = f.render().find(element => element.props.title === 'privacy.capacity.checkEarlier');
    assert(earlier);
    f.press('buttons.cancel');
    earlier.props.onPress(); await settle();
    assert.deepEqual(f.selections, [undefined], 'A cancelled confirmation cannot be replayed');
    f.select(1); f.press('privacy.capacity.confirmClear'); await settle();
    f.press('privacy.capacity.checkEarlier'); await settle();
    assert.deepEqual(f.idsChecked, [['1'], ['1'], ['1']]);
    assert.deepEqual(f.selections, [undefined, undefined, 'earlier']);
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.checkEarlier'));
  } finally { f.close(); }
});

test('maintenance pre-access OS Cancel keeps the inventory and confirmation available for retry', async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.select(); f.refuse(operationAuthenticationCancellation());
    f.press('privacy.capacity.confirmClear'); await settle();
    assert.equal(f.reads(), 1); assert.equal(f.clears(), 1);
    assert(f.render().some(element => element.props.subtitle?.startsWith('Note 7 ·')));
    assert(!f.render().some(element => element.children.includes('privacy.capacity.clearError')));
    const retry = f.render().find(element => element.props.title === 'privacy.capacity.confirmClear'); assert(retry); assert.equal(retry.props.disabled, false);
    f.press('privacy.capacity.confirmClear'); await settle();
    assert.equal(f.clears(), 2); assert.equal(f.reads(), 1);
    assert(f.render().some(element => element.children.includes('privacy.capacity.clearResult')));
  } finally { f.close(); }
});

for (const failure of ['generic', 'unavailable', 'owner'] as const) test(`maintenance ${failure} failure without reload clears stale inventory and retry`, async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.select();
    f.refuse(failure === 'owner' ? operationAuthenticationCancellation() : Error(failure === 'generic' ? 'CANCELLED' : 'DEVICE_UNLOCK_UNAVAILABLE'));
    f.press('privacy.capacity.confirmClear'); if (failure === 'owner') f.background(); await settle();
    assert.equal(f.reads(), 1); assert.equal(f.clears(), 1);
    assert(f.render().some(element => element.children.includes('privacy.capacity.clearError')));
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.confirmClear'));
  } finally { f.close(); }
});


test('choosing a note shows amount and date without invoking cleanup; cancel can select another', async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.select(1);
    assert(f.render().some(element => element.props.title === '1 ETH pool' && element.props.subtitle?.startsWith('Note 1 ·')));
    const warning = f.render().find(element => element.type === 'Notice' && element.props.title === 'privacy.capacity.clearHelp');
    assert(warning?.props.compact && warning.props.tone === 'amber');
    assert.deepEqual(f.idsChecked, []); f.press('buttons.cancel'); f.select();
    f.press('privacy.capacity.confirmClear'); await settle(); assert.deepEqual(f.idsChecked, [['7']]);
  } finally { f.close(); }
});

test('unresolved cleanup resets selection while retaining the note for a fresh attempt', async () => {
  const f = fixture(false, false, 7, true);
  try {
    f.render(); await settle(); f.select(); f.press('privacy.capacity.confirmClear'); await settle();
    assert.equal(f.render().filter(element => element.props.icon === 'trash').length, 7);
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.confirmClear'));
    f.select(); f.press('privacy.capacity.confirmClear'); await settle(); assert.deepEqual(f.idsChecked, [['7'], ['7']]);
  } finally { f.close(); }
});

test('maintenance renders twenty notes per page and can target the final note', async () => {
  const f = fixture(false, false, 41);
  try {
    f.render(); await settle(); assert.equal(f.render().filter(element => element.props.icon === 'trash').length, 20);
    f.press('buttons.next'); f.press('buttons.next'); assert.equal(f.render().filter(element => element.props.icon === 'trash').length, 1);
    f.select(41); f.press('privacy.capacity.confirmClear'); await settle(); assert.deepEqual(f.idsChecked, [['41']]);
    assert.equal(f.render().filter(element => element.props.icon === 'trash').length, 20);
  } finally { f.close(); }
});

test('backgrounding invalidates cleanup before late reload and a retained action cannot retry', async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.select();
    let finish!: () => void; f.pause(new Promise<void>(resolve => { finish = resolve; }));
    const action = f.render().find(element => element.props.title === 'privacy.capacity.confirmClear'); assert(action);
    action.props.onPress(); f.background(true); assert.equal(f.backs(), 1); finish(); await settle();
    action.props.onPress(); await settle(); assert.deepEqual(f.idsChecked, [['7']]);
  } finally { f.close(); }
});


test('switching runtime source retires a selected action before it can check a note', async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.select();
    const action = f.render().find(element => element.props.title === 'privacy.capacity.confirmClear'); assert(action);
    f.replaceSource(); f.render(); action.props.onPress(); await settle();
    assert.deepEqual(f.idsChecked, []);
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.confirmClear'));
  } finally { f.close(); }
});

test('a duplicate press cannot start another selected-note cleanup while busy', async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.select();
    let finish!: () => void; f.pause(new Promise<void>(resolve => { finish = resolve; }));
    const action = f.render().find(element => element.props.title === 'privacy.capacity.confirmClear'); assert(action);
    action.props.onPress(); action.props.onPress();
    assert.deepEqual(f.idsChecked, [['7']]);
    assert.equal(f.render().find(element => element.props.title === 'privacy.capacity.confirmClear')?.props.disabled, true);
    finish(); await settle();
  } finally { f.close(); }
});
