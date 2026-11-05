import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeNoteInventory, NativeSavedNote } from '../custody/noteBackupRuntime';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';
import { NoteBackupPasswordField } from './NoteBackupPasswordField';

type Props = {
  inventory: NativeNoteInventory;
  note: NativeSavedNote;
  onBack(): void;
  onLock(): void;
};
type State = { phase: 'password'; feedback?: 'failed' | 'expired' } |
  { phase: 'working' } | { phase: 'shown'; secret: string };
type Attempt = { timer?: ReturnType<typeof setTimeout> };
type Owner = { live: boolean; attempt?: Attempt };
const REVEAL_MS = 30_000;

function clearAttempt(owner: Owner) {
  if (owner.attempt?.timer !== undefined) clearTimeout(owner.attempt.timer);
  owner.attempt = undefined;
}

export function NativeNoteReveal({ inventory, note, onBack, onLock }: Props) {
  const life = useRef<Owner>({ live: false });
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>({ phase: 'password' });

  const clear = useCallback(() => {
    const owner = life.current;
    owner.live = false;
    clearAttempt(owner);
    setPassword('');
    setState({ phase: 'password' });
    Keyboard.dismiss();
  }, []);

  useLayoutEffect(() => {
    const owner: Owner = { live: true };
    life.current = owner;
    const hide = () => { if (life.current === owner) clear(); };
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active') hide();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', hide) : null;
    return () => {
      owner.live = false;
      clearAttempt(owner);
      change.remove();
      blur?.remove();
    };
  }, [clear, inventory, note]);

  const back = useCallback(() => { clear(); onBack(); }, [clear, onBack]);
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const reveal = async () => {
    const owner = life.current;
    if (!owner.live || owner.attempt || !password || AppState.currentState !== 'active') return;
    const attempt: Attempt = {};
    owner.attempt = attempt;
    const entered = password;
    setPassword('');
    setState({ phase: 'working' });
    Keyboard.dismiss();
    const isCurrent = () => owner.live && owner.attempt === attempt && AppState.currentState === 'active';
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error('CANCELLED');
    };
    try {
      const secret = await inventory.revealNote(note, entered, assertCurrent);
      assertCurrent();
      if (typeof secret !== 'string' || !secret || secret.length > 512) throw new Error('UNAVAILABLE');
      const expiresAt = performance.now() + REVEAL_MS;
      const expire = () => {
        if (!isCurrent()) return;
        const remaining = expiresAt - performance.now();
        if (remaining > 0) { attempt.timer = setTimeout(expire, remaining); return; }
        clearAttempt(owner);
        setState({ phase: 'password', feedback: 'expired' });
      };
      attempt.timer = setTimeout(expire, REVEAL_MS);
      setState({ phase: 'shown', secret });
    } catch {
      if (!isCurrent()) return;
      clearAttempt(owner);
      setState({ phase: 'password', feedback: 'failed' });
    }
  };

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button title="Lock wallet" variant="secondary" onPress={() => { clear(); onLock(); }} />}>
        <Header title="Back up this note" onBack={back} />
        <Notice title="Anyone with this note can withdraw" body="Keep your backup private. Your recovery phrase can’t restore this note." tone="amber" />
        {state.phase === 'shown' ? <>
          <Card style={s.secret}><Text style={s.note}>{state.secret}</Text></Card>
          <Text style={styles.muted}>This note is hidden after 30 seconds.</Text>
          <Button title="Hide note" onPress={back} />
        </> : <>
          <NoteBackupPasswordField label="Confirm your wallet password" value={password}
            onChange={setPassword} busy={state.phase !== 'password'} />
          <Button title={state.phase === 'working' ? 'Confirming password…' : 'Reveal private note'}
            disabled={state.phase !== 'password' || !password} onPress={() => void reveal()} />
          {state.phase === 'password' && state.feedback === 'failed' && <Text accessibilityRole="alert" style={s.error}>
            Could not show this note. Confirm your wallet password and try again.
          </Text>}
          {state.phase === 'password' && state.feedback === 'expired' && <Text accessibilityLiveRegion="polite" style={styles.muted}>
            Private note hidden. Confirm your password to view it again.
          </Text>}
        </>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  secret: { padding: 16, borderColor: colors.amber },
  note: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, lineHeight: 22 },
  error: { color: colors.red },
});
