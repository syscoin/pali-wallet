import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeNoteRestoreStep } from '../src/screens/NativeNoteRestore';
import { screenElements, screenFixture } from './screenFixture.ts';

test('note restore keeps Back available outside the commit in progress', () => {
  let hardwareBack: (() => boolean) | undefined;
  let backs = 0;
  let submitted: string | undefined;
  const screen = screenFixture(new URL('../src/screens/NativeNoteRestore.tsx', import.meta.url), 'NativeNoteRestore', {
    'react-native': {
      AppState: { currentState: 'active' },
      BackHandler: { addEventListener: (_event: string, listener: () => boolean) => {
        hardwareBack = listener;
        return { remove() { hardwareBack = undefined; } };
      } },
      View: 'View', StyleSheet: { create: <T>(style: T) => style },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Notice: 'Notice', Screen: 'Screen', Text: 'Text', colors: {}, styles: {} },
    './NoteBackupPasswordField': { NoteBackupPasswordField: 'NoteBackupPasswordField' },
  });
  const onBack = () => { backs++; };
  const render = (step: NativeNoteRestoreStep, busy: boolean) => screenElements(screen.render({
    step, busy, error: '', onBack, onChoose() {}, onOpen() {}, onRestore(id: string) { submitted = id; },
  }));
  const review: NativeNoteRestoreStep = { phase: 'review', preview: { id: 'restore-id', added: 2, duplicates: 1, guarded: 0, expiresAt: 1234 } };
  try {
    const picker = render({ phase: 'select' }, true);
    assert.equal(picker.find(element => element.type === 'Header')?.props.onBack, onBack);
    assert.equal(hardwareBack?.(), true);
    assert.equal(backs, 1);

    const password = render({ phase: 'password' }, true);
    assert.equal(password.find(element => element.props.header)?.props.header.props.onBack, onBack);
    assert.equal(hardwareBack?.(), true);
    assert.equal(backs, 2);

    const idle = render(review, false);
    assert.equal(idle.find(element => element.type === 'Header')?.props.onBack, onBack);
    const confirm = idle.find(element => element.type === 'Button');
    assert(confirm);
    confirm.props.onPress();
    assert.equal(submitted, 'restore-id');

    const committing = render(review, true);
    const committingHeader = committing.find(element => element.type === 'Header');
    assert(committingHeader);
    assert.equal(committingHeader.props.onBack, undefined);
    assert.equal(committing.find(element => element.type === 'Button')?.props.disabled, true);
    assert.equal(hardwareBack?.(), true);
    assert.equal(backs, 2);

    const restored = render({ phase: 'restored', receipt: { id: 'restore-id', added: 2, duplicates: 1, guarded: 0, confirmed: true } }, false);
    assert.equal(restored.find(element => element.type === 'Header')?.props.onBack, onBack);
    assert.equal(hardwareBack?.(), true);
    assert.equal(backs, 3);
  } finally { screen.close(); }
});
