import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeNoteMaintenanceRuntime } from '../src/custody/noteBackupRuntime.ts';
import type { IPrivateNoteView } from '../../../source/utils/privacy/privateVaultTypes.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { isOperationAuthenticationCancellation, operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const notes: IPrivateNoteView[] = [1, 2, 3].map(value => ({ id: String(value), amount: '1', createdAt: value, poolId: 'eth-1', phase: 'verified' }));

function fixture(fail = false, recover = false) {
  let reads = 0, clears = 0, recoveries = 0;
  let refusal: Error | undefined;
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const shown: IPrivateNoteView[] = recover ? [{ ...notes[0]!, withdrawal: { canCheckRecovery: true, mode: 'direct', phase: 'submitted' } }] : notes;
  const runtime = {
    async dispose() {},
    async getNotes() { reads++; return { notes: shown }; },
    async clearCompletedNotes(ids, check, progress, reload) {
      clears++; assert.deepEqual(ids, notes.map(note => note.id)); check();
      if (refusal) { const error = refusal; refusal = undefined; throw error; }
      progress({ checked: 1, total: 3 }); reload({ notes: fail ? notes : [] });
      if (fail) throw Error('Synthetic late failure');
      return { removed: [...ids], unresolved: [] };
    },
    async recoverFailedWithdrawal(_id, check, reload) { recoveries++; check(); reload({ notes: [] }); },
  } satisfies NativeNoteMaintenanceRuntime;
  const f = screenFixture(new URL('../src/screens/NativeNoteMaintenance.tsx', import.meta.url), 'NativeNoteMaintenance', {
    'react-native': { AppState: appState,
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'Avoid', Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string) => key }) },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope: () => ({ retire() {}, isAuthenticating: () => false }) },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption: () => false },
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Row: 'Row', Screen: 'Screen', Text: 'Text', colors: {}, styles: {} },
  }, { AbortController });
  const open = async () => runtime, onBack = () => {};
  const render = () => screenElements(f.render({ open, onBack }));
  const press = (title: string) => {
    const button = render().find(element => element.props.title === title); assert(button); button.props.onPress();
  };
  return { render, press, reads: () => reads, clears: () => clears, recoveries: () => recoveries,
    refuse(error: Error) { refusal = error; }, background() { appState.currentState = 'background'; }, close: f.close };
}

for (const fail of [false, true]) test(`maintenance screen uses one batch and its final inventory after ${fail ? 'failure' : 'success'}`, async () => {
  const f = fixture(fail);
  try {
    f.render(); await settle(); assert.equal(f.reads(), 1);
    f.press('privacy.capacity.clear'); f.press('privacy.capacity.confirmClear'); await settle();
    assert.equal(f.clears(), 1); assert.equal(f.reads(), 1, 'The screen must not start another authorized reload');
    const elements = f.render();
    assert.equal(elements.some(element => element.children.includes('privacy.capacity.clearError')), fail);
    assert.equal(elements.some(element => element.children.includes('privacy.capacity.clearResult')), !fail);
  } finally { f.close(); }
});

test('maintenance recovery consumes its action inventory without a second reload', async () => {
  const f = fixture(false, true);
  try {
    f.render(); await settle(); f.press('1 ETH'); f.press('privacy.recovery.confirm'); await settle();
    assert.equal(f.recoveries(), 1); assert.equal(f.reads(), 1);
    assert(!f.render().some(element => element.props.title === 'privacy.recovery.confirm'));
  } finally { f.close(); }
});

test('maintenance pre-access OS Cancel keeps the inventory and confirmation available for retry', async () => {
  const f = fixture();
  try {
    f.render(); await settle(); f.press('privacy.capacity.clear'); f.refuse(operationAuthenticationCancellation());
    f.press('privacy.capacity.confirmClear'); await settle();
    assert.equal(f.reads(), 1); assert.equal(f.clears(), 1);
    assert(f.render().some(element => element.children.includes(3)));
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
    f.render(); await settle(); f.press('privacy.capacity.clear');
    f.refuse(failure === 'owner' ? operationAuthenticationCancellation() : Error(failure === 'generic' ? 'CANCELLED' : 'DEVICE_UNLOCK_UNAVAILABLE'));
    f.press('privacy.capacity.confirmClear'); if (failure === 'owner') f.background(); await settle();
    assert.equal(f.reads(), 1); assert.equal(f.clears(), 1);
    assert(f.render().some(element => element.children.includes('privacy.capacity.clearError')));
    assert(!f.render().some(element => element.props.title === 'privacy.capacity.confirmClear'));
  } finally { f.close(); }
});
