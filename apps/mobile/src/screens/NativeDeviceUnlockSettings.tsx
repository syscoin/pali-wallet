import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication';
import { createNativePrivateAuthenticationChild, createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { Button, Header, Screen, styles, Text } from '../ui';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type Attempt = { lifetime: AbortController; authentication: NativePrivateAuthenticationScope };
type Owner = { live: boolean; blocked: boolean; authentication: NativePrivateAuthenticationScope; attempt?: Attempt };
export type NativeDeviceUnlockConfigure = (enabled: boolean, signal: AbortSignal, authentication: NativePrivateAuthenticationScope, assertCurrent: () => void) => Promise<void>;

export function NativeDeviceUnlockSettings({ enabled, available, label, configure, onBack, onConfigured }: {
  enabled: boolean;
  available: boolean;
  label: string;
  configure: NativeDeviceUnlockConfigure;
  onBack(): void;
  onConfigured(assertCurrent: () => void): Promise<void>;
}) {
  const [initial] = useState(() => ({ enabled, available }));
  const [phase, setPhase] = useState<'idle' | 'working' | 'unconfirmed' | 'complete'>('idle');
  const life = useRef<Owner | undefined>(undefined);
  const callbacks = useRef({ configure, onBack, onConfigured });
  useLayoutEffect(() => { callbacks.current = { configure, onBack, onConfigured }; }, [configure, onBack, onConfigured]);

  const cancel = useCallback((owner: Owner) => {
    const attempt = owner.attempt;
    owner.attempt = undefined;
    attempt?.lifetime.abort();
    attempt?.authentication.retire();
  }, []);
  useLayoutEffect(() => {
    const owner: Owner = { live: true, blocked: false, authentication: createNativePrivateAuthenticationScope() };
    life.current = owner;
    const hide = () => {
      if (life.current !== owner || !owner.live || !owner.attempt) return;
      cancel(owner); owner.blocked = true; setPhase('unconfirmed');
    };
    const change = AppState.addEventListener('change', state => {
      if (state !== 'active' && !allowsPrivateAuthenticationInterruption(owner.authentication, state)) hide();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (!allowsPrivateAuthenticationInterruption(owner.authentication, 'blur')) hide();
    }) : undefined;
    return () => { owner.live = false; cancel(owner); owner.authentication.retire(); change.remove(); blur?.remove(); };
  }, [cancel]);

  const back = useCallback(() => {
    const owner = life.current;
    if (!owner?.live) return;
    owner.live = false; cancel(owner); owner.authentication.retire(); callbacks.current.onBack();
  }, [cancel]);
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const submit = async () => {
    const owner = life.current;
    if (!owner?.live || owner.blocked || owner.attempt || AppState.currentState !== 'active' || !initial.enabled && !initial.available) return;
    const attempt = { lifetime: new AbortController(), authentication: createNativePrivateAuthenticationChild(owner.authentication) };
    owner.attempt = attempt; setPhase('working');
    const current = () => life.current === owner && owner.live && owner.attempt === attempt && !attempt.lifetime.signal.aborted;
    const check = () => { if (!current()) throw new Error('CANCELLED'); };
    try {
      await callbacks.current.configure(!initial.enabled, attempt.lifetime.signal, attempt.authentication, check);
      check();
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      await callbacks.current.onConfigured(check);
      if (current()) { owner.blocked = true; setPhase('complete'); }
    } catch (cause) {
      if (!current()) return;
      if (isOperationAuthenticationCancellation(cause)) setPhase('idle');
      else { owner.blocked = true; setPhase('unconfirmed'); }
    } finally {
      attempt.lifetime.abort(); attempt.authentication.retire();
      if (owner.attempt === attempt) owner.attempt = undefined;
    }
  };

  const action = initial.enabled ? `Turn off ${label}` : `Enable ${label}`;
  return <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
    <View style={{ flex: 1 }}><Screen gap={16} footer={<>
      <Button title={phase === 'working' ? 'Updating…' : action}
        disabled={phase !== 'idle' || !initial.enabled && !initial.available} onPress={() => void submit()} />
      <Button title="Cancel" variant="secondary" onPress={back} />
    </>}>
      <Header title={label} onBack={back} />
      <Text>{label} is {initial.enabled ? 'on' : 'off'}.</Text>
      <Text style={styles.muted}>{initial.enabled ? `Confirm to turn off ${label}.` : `Enable ${label} to unlock Pali faster.`} Your PIN remains available.</Text>
      {!initial.enabled && !initial.available && <Text accessibilityRole="alert">Biometric unlock is unavailable on this device.</Text>}
      {phase === 'working' && <Text accessibilityLiveRegion="polite">Confirm this change when prompted.</Text>}
      {phase === 'unconfirmed' && <Text accessibilityRole="alert">Could not confirm this change. Return to security settings before trying again.</Text>}
      {phase === 'complete' && <Text accessibilityLiveRegion="polite">Security setting updated.</Text>}
    </Screen></View>
  </SafeAreaView>;
}
