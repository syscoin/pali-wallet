import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  NativeImportedNote,
  NativeNoteImportRuntime,
} from '../custody/noteImport';
import { Button, colors, Header, Notice, Screen, styles, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type Props = {
  openImport(assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteImportRuntime>;
  onBack(): void;
};
type State =
  | { phase: 'entry'; error?: string }
  | { phase: 'working' }
  | { phase: 'saved'; note: NativeImportedNote };
type Owner = {
  live: boolean;
  request?: object;
  importer?: NativeNoteImportRuntime;
  authentication: NativePrivateAuthenticationScope;
};

function importError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'privacy_note_invalid')
    return 'Check the private note and try again.';
  if (code === 'privacy_note_not_found')
    return 'This note was not found in the verified pool history.';
  if (code === 'privacy_note_limit')
    return 'Your saved note limit has been reached.';
  if (code === 'privacy_wrong_chain')
    return 'Select Ethereum to import this note.';
  if (code === 'privacy_verification_pending')
    return 'Pool verification is not ready. Try again later.';
  return 'Could not confirm the import. Check Saved notes before trying again.';
}

export function NativeNoteImport({ openImport, onBack }: Props) {
  const owner = useRef<Owner>({ live: false, authentication: createNativePrivateAuthenticationScope() });
  const close = useRef(onBack);
  useLayoutEffect(() => {
    close.current = onBack;
  }, [onBack]);
  const [note, setNote] = useState('');
  const [state, setState] = useState<State>({ phase: 'entry' });
  const retire = useCallback(() => {
    owner.current.live = false;
    owner.current.authentication.retire();
    void owner.current.importer?.dispose().catch(() => undefined);
    setNote('');
    Keyboard.dismiss();
  }, []);
  const back = useCallback(() => {
    retire();
    close.current();
  }, [retire]);
  useLayoutEffect(() => {
    const current: Owner = { live: true, authentication: createNativePrivateAuthenticationScope() };
    owner.current = current;
    const hide = back;
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, next)) hide();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => { if (!allowsPrivateAuthenticationInterruption(current.authentication, 'blur')) hide(); })
        : undefined;
    const hardwareBack = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        back();
        return true;
      }
    );
    return () => {
      current.live = false;
      current.authentication.retire();
      void current.importer?.dispose().catch(() => undefined);
      change.remove();
      blur?.remove();
      hardwareBack.remove();
    };
  }, [back, openImport, retire]);

  const submit = async () => {
    const current = owner.current;
    if (
      !current.live ||
      current.request ||
      !note.trim() ||
      AppState.currentState !== 'active'
    )
      return;
    const request = {};
    current.request = request;
    const raw = note;
    setNote('');
    setState({ phase: 'working' });
    Keyboard.dismiss();
    const check = () => {
      if (
        owner.current !== current || !current.live ||
        current.request !== request ||
        (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication, AppState.currentState))
      )
        throw new Error('privacy_cancelled');
    };
    let importer: NativeNoteImportRuntime | undefined;
    try {
      importer = await openImport(check, current.authentication);
      current.importer = importer;
      check();
      const imported = await importer.importNote(raw);
      check();
      if (AppState.currentState !== 'active') throw new Error('privacy_cancelled');
      setState({ phase: 'saved', note: imported });
    } catch (error) {
      if (current.live && current.request === request && AppState.currentState === 'active')
        setState({ phase: 'entry', error: importError(error) });
    } finally {
      await importer?.dispose().catch(() => undefined);
      if (current.request === request) {
        current.request = undefined;
        current.importer = undefined;
      }
    }
  };
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={state.phase === 'saved' ? <Button title="Done" onPress={back} /> : <> <Button
                title={
                  state.phase === 'working' ? 'Checking pool…' : 'Import note'
                }
                disabled={state.phase !== 'entry' || !note.trim()}
                onPress={() => void submit()}
              /> <Button title="Cancel" variant="secondary" onPress={back} /> </>}>
          <Header title="Import private note" onBack={back} />
          {state.phase === 'saved' ? (
            <>
              <Notice
                title="Note saved"
                body={`${state.note.amount} ETH pool · ${
                  state.note.phase === 'spent'
                    ? 'Already spent'
                    : state.note.phase === 'verified'
                    ? 'Verified in pool history'
                    : 'Status needs another check'
                }`}
              />

            </>
          ) : (
            <>
              <Text style={styles.muted}>
                Enter one private note. Pali checks its public pool history
                before saving it.
              </Text>
              <Text style={styles.muted}>
                Anyone with this note can withdraw. Keep it private.
              </Text>
              <Text style={s.label}>Private note</Text>
              <IdleTextInput
                accessibilityLabel="Private note"
                value={note}
                onChangeText={(value) => {
                  if (owner.current.live && !owner.current.request)
                    setNote(value);
                }}
                editable={state.phase === 'entry'}
                multiline
                maxLength={256}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                importantForAutofill="noExcludeDescendants"
                textContentType="none"
                placeholderTextColor={colors.muted}
                style={s.input}
              />
              {state.phase === 'entry' && state.error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {state.error}
                </Text>
              )}


            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  label: { color: colors.text, fontWeight: '600' },
  input: {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
    textAlignVertical: 'top',
    fontSize: 14,
    lineHeight: 22,
  },
  error: { color: colors.red },
});
