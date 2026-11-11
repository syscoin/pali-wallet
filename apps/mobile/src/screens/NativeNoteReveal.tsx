import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeNoteInventory, NativeSavedNote } from '../custody/noteBackupRuntime';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';
import { createNativePrivateAuthenticationChild, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type Props = {
  inventory: NativeNoteInventory;
  note: NativeSavedNote;
  authentication: NativePrivateAuthenticationScope;
  onSecretVisibilityChange(visible: boolean): void;
  onBack(): void;
  onLock(): void;
};
type State = { phase: 'protected'; feedback?: 'failed' | 'expired' } |
  { phase: 'working' } | { phase: 'shown'; secret: string };
type Attempt = { timer?: ReturnType<typeof setTimeout>; authentication: NativePrivateAuthenticationScope };
type Owner = { live: boolean; attempt?: Attempt };
const REVEAL_MS = 30_000;

function clearAttempt(owner: Owner) {
  if (owner.attempt?.timer !== undefined) clearTimeout(owner.attempt.timer);
  owner.attempt?.authentication.retire();
  owner.attempt = undefined;
}

export function NativeNoteReveal({ inventory, note, authentication, onSecretVisibilityChange, onBack, onLock }: Props) {
  const life = useRef<Owner>({ live: false });
  const [state, setState] = useState<State>({ phase: 'protected' });

  const clear = useCallback(() => {
    const owner = life.current;
    owner.live = false;
    clearAttempt(owner);
    onSecretVisibilityChange(false);
    setState({ phase: 'protected' });
    Keyboard.dismiss();
  }, [onSecretVisibilityChange]);

  useLayoutEffect(() => {
    const owner: Owner = { live: true };
    life.current = owner;
    const hide = () => { if (life.current === owner) clear(); };
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && !(owner.attempt && allowsPrivateAuthenticationInterruption(owner.attempt.authentication, next))) hide();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (!owner.attempt || !allowsPrivateAuthenticationInterruption(owner.attempt.authentication, 'blur')) hide();
    }) : null;
    return () => {
      owner.live = false;
      clearAttempt(owner);
      onSecretVisibilityChange(false);
      change.remove();
      blur?.remove();
    };
  }, [authentication, clear, inventory, note, onSecretVisibilityChange]);

  const back = useCallback(() => { clear(); onBack(); }, [clear, onBack]);
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const reveal = async () => {
    const owner = life.current;
    if (!owner.live || owner.attempt || AppState.currentState !== 'active') return;
    const attempt: Attempt = { authentication: createNativePrivateAuthenticationChild(authentication) };
    owner.attempt = attempt;
    setState({ phase: 'working' });
    Keyboard.dismiss();
    const isCurrent = () => owner.live && owner.attempt === attempt && (AppState.currentState === 'active' ||
      allowsPrivateAuthenticationInterruption(attempt.authentication, AppState.currentState));
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error('CANCELLED');
    };
    try {
      const secret = await inventory.revealNote(note, assertCurrent, attempt.authentication);
      assertCurrent();
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      if (typeof secret !== 'string' || !secret || secret.length > 512) throw new Error('UNAVAILABLE');
      const expiresAt = performance.now() + REVEAL_MS;
      const expire = () => {
        if (!isCurrent()) return;
        const remaining = expiresAt - performance.now();
        if (remaining > 0) { attempt.timer = setTimeout(expire, remaining); return; }
        clearAttempt(owner);
        onSecretVisibilityChange(false);
        setState({ phase: 'protected', feedback: 'expired' });
      };
      attempt.timer = setTimeout(expire, REVEAL_MS);
      onSecretVisibilityChange(true);
      assertCurrent();
      setState({ phase: 'shown', secret });
    } catch {
      if (life.current !== owner || !owner.live || owner.attempt !== attempt) return;
      clearAttempt(owner);
      onSecretVisibilityChange(false);
      setState({ phase: 'protected', feedback: 'failed' });
    } finally { attempt.authentication.retire(); }
  };

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<>
        {state.phase === 'shown' ? <Button title="Hide note" icon="eye" onPress={back} /> :
          <Button title={state.phase === 'working' ? 'Authorizing…' : 'Reveal private note'}
            disabled={state.phase !== 'protected'} onPress={() => void reveal()} />}
        <Button title="Lock wallet" icon="lock" variant="secondary" onPress={() => { clear(); onLock(); }} />
      </>}>
        <Header title="Back up this note" onBack={back} />
        <Notice title="Anyone with this note can withdraw" body="Keep your backup private. Your recovery phrase can’t restore this note." tone="amber" />
        {state.phase === 'shown' ? <>
          <Card style={s.secret}><Text style={s.note}>{state.secret}</Text></Card>
          <Text style={styles.muted}>This note is hidden after 30 seconds.</Text>
        </> : <>
          {state.phase === 'protected' && state.feedback === 'failed' && <Text accessibilityRole="alert" style={s.error}>
            Could not show this note. Try again.
          </Text>}
          {state.phase === 'protected' && state.feedback === 'expired' && <Text accessibilityLiveRegion="polite" style={styles.muted}>
            Private note hidden. Authorize again to view it.
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
