import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeNoteInventory, NativeNoteArchiveInventory } from '../src/custody/noteBackupRuntime.ts';
import { operationAuthenticationCancellation, isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(count = 41) {
  let archived = Array.from({ length: count }, (_, index) => Object.freeze({ amount: '1', createdAt: index + 1000, archivedAt: index + 2000 }));
  const active: typeof archived = [];
  let restores = 0, clears = 0, reveals = 0, reads = 0, opens = 0, exports = 0, refused: Error | undefined;
  let pending: Promise<void> | undefined;
  const events = new Map<string, (next: string) => void>();
  const appState = { currentState: 'active', addEventListener: (event: string, callback: (next: string) => void) => { events.set(event, callback); return { remove() {} }; } };
  const archiveInventory = (): NativeNoteArchiveInventory => ({
    notes: [...archived], limit: 512, storedBytes: 1234, bundleLimitBytes: 4194304,
    async revealNote(_note, guard) { guard(); reveals++; return 'private-note'; },
    async restoreNote(note, guard) {
      restores++; guard(); if (refused) throw refused;
      if (pending) await pending; guard();
      assert(archived.includes(note as typeof archived[number]));
      archived = archived.filter(value => value !== note); active.push(note as typeof archived[number]);
      return { inventory: inventory(), archive: archiveInventory() };
    },
    async clearArchive(guard) {
      clears++; guard(); if (refused) throw refused;
      const removed = archived.length; archived = [];
      return { removed, inventory: inventory(), archive: archiveInventory() };
    },
  });
  const inventory = (): NativeNoteInventory => ({
    notes: [...active], async revealNote() { throw Error('No active reveal expected'); },
    archiveSummary: { noteCount: archived.length, limit: 512, storedBytes: 1234, bundleLimitBytes: 4194304 },
    archive: { async open(guard) { guard(); opens++; return archiveInventory(); } },
  });
  const read = async (guard: () => void) => { guard(); reads++; return inventory(); };
  const f = screenFixture(new URL('../src/screens/NativeNoteInventory.tsx', import.meta.url), 'NativeNoteInventory', {
    'react-native': { AppState: appState, View: 'View', Pressable: 'Pressable', BackHandler: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string, values: Record<string, unknown> = {}) => key === 'mobile.noteFlows.inventory.noteDate' ? `Note ${values.number}` : key }) },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope: () => ({ retire() {}, isAuthenticating: () => false }), createNativePrivateAuthenticationChild: () => ({ retire() {}, isAuthenticating: () => false }) },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption: () => false },
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    './NativeNoteReveal': { NativeNoteReveal: 'NativeNoteReveal' },
    './NativePrivateWithdrawal': { NativePrivateWithdrawal: 'NativePrivateWithdrawal' },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Icon: 'Icon', Notice: 'Notice', Row: 'Row', Screen: 'Screen', Text: 'Text', colors: {}, styles: {} },
  });
  let readerRevision = 0;
  const alternateRead = (guard: () => void) => read(guard);
  const render = () => screenElements(f.render({ readInventory: readerRevision ? alternateRead : read, onBack() {}, onLock() {}, onExport() { exports++; } }));
  const press = (title: string) => { const button = render().find(value => value.props.title === title); assert(button, title); assert.notEqual(button.props.disabled, true); button.props.onPress(); };
  const enter = async () => { render(); await settle(); press(`privacy.archive.title (${count})`); await settle(); };
  const select = (number = 1) => { const row = render().find(value => value.props.subtitle === `Note ${number}`); assert(row); row.props.onPress(); };
  return { render, press, enter, select, reads: () => reads, opens: () => opens, restores: () => restores, clears: () => clears, reveals: () => reveals, exports: () => exports,
    replaceReader() { readerRevision++; },
    refuse(error: Error) { refused = error; }, pause(work: Promise<void>) { pending = work; },
    background() { appState.currentState = 'background'; events.get('change')?.('background'); }, close: f.close };
}

test('native archive is separate, paged and revealed through the existing protected screen without status RPCs', async () => {
  const f = fixture();
  try {
    await f.enter();
    assert.equal(f.render().filter(value => value.props.subtitle?.startsWith('Note ')).length, 20);
    f.press('buttons.next'); f.select(21);
    assert(!f.render().some(value => value.props.title === 'mobile.noteFlows.inventory.checkPoolStatus'));
    assert(!f.render().some(value => value.props.title === 'transactions.methodNames.withdraw'));
    assert.equal(f.render().find(value => value.props.title === 'mobile.noteFlows.reveal.backUpThisNote')?.props.icon, 'eye');
    assert.equal(f.render().find(value => value.props.title === 'privacy.archive.restore')?.props.icon, 'refresh');
    f.press('mobile.noteFlows.reveal.backUpThisNote');
    const reveal = f.render().find(value => value.type === 'NativeNoteReveal'); assert(reveal);
    assert.equal(reveal.props.note.archivedAt, 2020);
    assert.equal(reveal.props.inventory.notes.length, 41);
    assert.equal(f.reveals(), 0, 'Opening reveal does not itself release a secret');
  } finally { f.close(); }
});

test('restore confirms first, uses the captured archived handle and refreshes active/archive counts', async () => {
  const f = fixture(2);
  try {
    await f.enter(); f.select(); f.press('privacy.archive.restore');
    assert.equal(f.restores(), 0);
    f.press('buttons.confirm'); await settle();
    assert.equal(f.restores(), 1); assert.equal(f.reads(), 1);
    assert(f.render().some(value => value.children.includes('privacy.archive.restored')));
    assert.equal(f.render().filter(value => value.props.subtitle?.startsWith('Note ')).length, 1);
  } finally { f.close(); }
});

test('permanent archive deletion requires warning, spent-or-backup acknowledgement and confirmation', async () => {
  const f = fixture(2);
  try {
    await f.enter(); assert.equal(f.render().find(value => value.props.title === 'privacy.bundle.exportTitle')?.props.icon, 'share'); f.press('privacy.bundle.exportTitle'); assert.equal(f.exports(), 1);
    f.press('privacy.archive.clear');
    assert(f.render().some(value => value.children.includes('privacy.archive.warning')));
    const confirm = f.render().find(value => value.props.title === 'privacy.archive.confirmClear'); assert(confirm); assert.equal(confirm.props.disabled, true);
    assert.equal(f.clears(), 0);
    f.press('buttons.cancel'); assert.equal(f.clears(), 0);
    f.press('privacy.archive.clear');
    const checkbox = f.render().find(value => value.props.accessibilityRole === 'checkbox'); assert(checkbox); checkbox.props.onPress();
    const acknowledgedRow = f.render().find(value => value.props.title === 'privacy.archive.confirmBackup'); assert(acknowledgedRow);
    assert(screenElements(acknowledgedRow.props.right).some(value => value.type === 'Icon' && value.props.name === 'check'));
    assert.equal(f.render().find(value => value.props.title === 'privacy.archive.confirmClear')?.props.icon, 'trash');
    f.press('privacy.archive.confirmClear'); await settle();
    assert.equal(f.clears(), 1);
    assert(f.render().some(value => value.children.includes('privacy.archive.empty')));
  } finally { f.close(); }
});

test('refused OS authorization preserves archive and permits an explicit retry', async () => {
  const f = fixture(2);
  try {
    await f.enter(); f.select(); f.press('privacy.archive.restore'); f.refuse(operationAuthenticationCancellation());
    f.press('buttons.confirm'); await settle();
    assert.equal(f.restores(), 1); assert.equal(f.reads(), 1);
    assert(f.render().some(value => value.props.title === 'buttons.confirm' && !value.props.disabled));
    assert(!f.render().some(value => value.children.includes('privacy.archive.actionError')));
  } finally { f.close(); }
});

test('background retires an in-flight archive mutation without publishing stale success', async () => {
  const f = fixture(2);
  let resume!: () => void;
  try {
    await f.enter(); f.select(); f.press('privacy.archive.restore');
    f.pause(new Promise(resolve => { resume = resolve; }));
    f.press('buttons.confirm'); f.background(); resume(); await settle();
    assert.equal(f.restores(), 1); assert.equal(f.reads(), 1);
    assert(!f.render().some(value => value.children.includes('privacy.archive.restored')));
    assert(f.render().some(value => value.children.includes('mobile.noteFlows.inventory.openSavedNotesAgainToContinue')));
  } finally { f.close(); }
});

test('a full active inventory keeps the archived record and displays the separate restore limit error', async () => {
  const f = fixture(2);
  try {
    await f.enter(); f.select(); f.press('privacy.archive.restore'); f.refuse(Error('privacy_note_limit'));
    f.press('buttons.confirm'); await settle();
    assert.equal(f.restores(), 1); assert.equal(f.reads(), 1);
    assert(f.render().some(value => value.children.includes('privacy.archive.activeFull')));
    assert(f.render().some(value => value.props.title === 'buttons.confirm' && !value.props.disabled));
    assert(!f.render().some(value => value.children.includes('privacy.archive.restored')));
  } finally { f.close(); }
});


test('ordinary native note inventory uses only the archive summary until an explicit open', async () => {
  const f = fixture(512);
  try {
    f.render(); await settle();
    assert.equal(f.reads(), 1); assert.equal(f.opens(), 0);
    assert(f.render().some(value => value.props.title === 'privacy.archive.title (512)' && value.props.icon === 'archive'));
    assert.equal(f.render().filter(value => value.props.subtitle?.startsWith('Note ')).length, 0);
  } finally { f.close(); }
});


test('a new inventory reader clears the previous archive confirmation before showing its owned ready view', async () => {
  const f = fixture(2);
  try {
    await f.enter(); f.select(); f.press('privacy.archive.restore');
    assert(f.render().some(value => value.props.title === 'buttons.confirm'));
    f.replaceReader(); f.render(); await settle();
    f.press('privacy.archive.title (2)'); await settle();
    assert(!f.render().some(value => value.props.title === 'buttons.confirm'));
    assert(!f.render().some(value => value.props.title === 'privacy.archive.confirmClear'));
    assert.equal(f.restores(), 0); assert.equal(f.clears(), 0);
    f.select();
    assert(f.render().some(value => value.props.title === 'privacy.archive.restore' && !value.props.disabled));
    assert(!f.render().some(value => value.props.title === 'buttons.confirm'));
  } finally { f.close(); }
});
