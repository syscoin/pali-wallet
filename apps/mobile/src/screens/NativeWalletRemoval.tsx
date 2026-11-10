import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WalletRemovalError, type NativeWalletRemoval as Removal, type WalletRemovalTicket } from '../custody/walletRemoval';
import { Button, colors, Header, Icon, Notice, Screen, styles, Text } from '../ui';
import { PinField } from './PinEntry';

export type RemovalScreenOutcome = 'removed' | 'unchanged' | 'unconfirmed';
type Props = {
  backupConfirmed: boolean;
  removal: Pick<Removal, 'authorize' | 'cancel'>;
  isCurrent(): boolean;
  confirm(ticket: WalletRemovalTicket, assertCurrent: () => void): Promise<RemovalScreenOutcome>;
  onBack(): void;
  onContinue(outcome: 'removed' | 'unchanged'): Promise<void>;
};
type Step = { phase: 'password'; error?: string } | { phase: 'authorizing' } |
  { phase: 'review' } | { phase: 'working'; cancelling?: true } |
  { phase: 'outcome'; outcome: RemovalScreenOutcome } | { phase: 'blocked' };
type Attempt = { cancelled: boolean; confirming: boolean; ticket?: WalletRemovalTicket; timer?: ReturnType<typeof setTimeout> };
type Owner = { live: boolean; attempt?: Attempt; finishing: boolean };
const CONFIRM_MS = 30_000;
const failure = (cause: unknown) => {
  const code = cause instanceof WalletRemovalError ? cause.code : undefined;
  if (code === 'INVALID_CREDENTIAL') return 'That PIN is incorrect.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect PINs. Wait before trying again.';
  return 'Could not verify your PIN for removal.';
};

function discardTicket(attempt: Attempt) {
  if (attempt.timer !== undefined) clearTimeout(attempt.timer);
  attempt.timer = undefined;
  attempt.ticket = undefined;
}

export function NativeWalletRemovalScreen({ removal, isCurrent, confirm, onBack, onContinue, backupConfirmed }: Props) {
  const life = useRef<Owner>({ live: false, finishing: false });
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ phase: 'password' });
  const [finishing, setFinishing] = useState(false);

  const cancel = useCallback((owner: Owner) => {
    const attempt = owner.attempt;
    if (attempt) {
      attempt.cancelled = true;
      discardTicket(attempt);
      if (!attempt.confirming) owner.attempt = undefined;
    }
    removal.cancel();
  }, [removal]);

  const clearInput = useCallback(() => { setPassword(''); Keyboard.dismiss(); }, []);
  useLayoutEffect(() => {
    const owner: Owner = { live: true, finishing: false };
    life.current = owner;
    const hide = () => {
      if (life.current !== owner || !owner.live) return;
      cancel(owner);
      clearInput();
      setStep((current) => current.phase === 'working' ? { phase: 'working', cancelling: true }
        : current.phase === 'outcome' || current.phase === 'blocked' ? current : { phase: 'password' });
    };
    const change = AppState.addEventListener('change', (state) => { if (state !== 'active') hide(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', hide) : null;
    return () => { owner.live = false; cancel(owner); change.remove(); blur?.remove(); };
  }, [cancel, clearInput]);

  const back = useCallback(() => {
    if (step.phase === 'outcome' || step.phase === 'blocked') return;
    const owner = life.current;
    const confirming = owner.attempt?.confirming;
    cancel(owner);
    clearInput();
    if (confirming) setStep({ phase: 'working', cancelling: true });
    else onBack();
  }, [cancel, clearInput, onBack, step.phase]);
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const authorize = async () => {
    const owner = life.current;
    if (!owner.live || owner.attempt || !password || !isCurrent()) return;
    const attempt: Attempt = { cancelled: false, confirming: false };
    owner.attempt = attempt;
    const entered = password;
    clearInput();
    setStep({ phase: 'authorizing' });
    const current = () => owner.live && owner.attempt === attempt && !attempt.cancelled && isCurrent();
    const check = () => { if (!current()) throw new Error('CANCELLED'); };
    try {
      const ticket = await removal.authorize(entered, check);
      check();
      attempt.ticket = ticket;
      attempt.timer = setTimeout(() => {
        if (!current() || attempt.confirming) return;
        cancel(owner);
        setStep({ phase: 'password', error: 'Confirmation expired. Enter your PIN again.' });
      }, CONFIRM_MS);
      setStep({ phase: 'review' });
    } catch (cause) {
      if (!current()) return;
      owner.attempt = undefined;
      setStep({ phase: 'password', error: failure(cause) });
    }
  };

  const remove = async () => {
    const owner = life.current, attempt = owner.attempt, ticket = attempt?.ticket;
    if (!owner.live || !attempt || !ticket || attempt.cancelled || attempt.confirming || !isCurrent()) return;
    discardTicket(attempt);
    attempt.confirming = true;
    setStep({ phase: 'working' });
    const check = () => {
      if (!owner.live || owner.attempt !== attempt || attempt.cancelled || !isCurrent()) throw new Error('CANCELLED');
    };
    let outcome: RemovalScreenOutcome;
    try { outcome = await confirm(ticket, check); } catch { outcome = 'unconfirmed'; }
    if (owner.live && owner.attempt === attempt) {
      owner.attempt = undefined;
      setStep({ phase: 'outcome', outcome });
    }
  };

  const finish = async (outcome: 'removed' | 'unchanged') => {
    const owner = life.current;
    if (!owner.live || owner.finishing || AppState.currentState !== 'active') return;
    owner.finishing = true;
    setFinishing(true);
    try { await onContinue(outcome); }
    catch { if (owner.live) setStep({ phase: 'blocked' }); }
    finally { owner.finishing = false; if (owner.live) setFinishing(false); }
  };

  const title = step.phase === 'outcome' ? step.outcome === 'removed' ? 'Wallet removed' : step.outcome === 'unchanged' ? 'Wallet kept' : 'Removal could not be confirmed'
    : step.phase === 'blocked' ? 'Wallet storage unavailable' : 'Remove wallet';
  const footer = step.phase === 'password' ? <>
    <Button title="Continue" disabled={!password} onPress={() => void authorize()} />
    <Button title="Cancel" variant="secondary" onPress={back} />
  </> : step.phase === 'review' ? <>
    {!backupConfirmed && <Notice title="Backup not verified" body="This wallet has not been verified as backed up." tone="red" />}
    <Button title="Remove wallet" variant="danger" onPress={() => void remove()} />
    <Button title="Cancel" variant="secondary" onPress={back} />
  </> : step.phase === 'authorizing' ? <Button title="Cancel" variant="secondary" onPress={back} />
    : step.phase === 'working' && !step.cancelling ? <Button title="Cancel removal" variant="secondary" onPress={back} />
    : step.phase === 'outcome' && step.outcome !== 'unconfirmed' ? <Button title={step.outcome === 'removed' ? 'Continue' : 'Return to wallet'} disabled={finishing} onPress={() => {
      if (step.outcome !== 'unconfirmed') void finish(step.outcome);
    }} /> : undefined;
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen gap={16} footer={footer}>
        <Header title={title} onBack={step.phase === 'outcome' || step.phase === 'blocked' ? undefined : back} />
        {step.phase === 'password' && <>
          <Text>Removing this wallet deletes its accounts, Sentry keys, private notes, and saved transaction records from this device.</Text>
          <Notice title="Check your backups" body="Your recovery phrase restores derived accounts. Imported accounts, Sentry keys, and private notes need their own backups." tone="amber" />
          <Text style={styles.muted}>Transfers already sent can still complete. Watch accounts and device settings stay saved.</Text>
          <PinField label="Confirm your wallet PIN" value={password} onChange={setPassword} busy={false} />
          {step.error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{step.error}</Text>}
        </>}
        {step.phase === 'authorizing' && <>
          <Text accessibilityLiveRegion="polite">Confirming your PIN…</Text>
        </>}
        {step.phase === 'review' && <>
          <View style={s.reviewHero}>
            <View style={s.trash} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="trash" size={32} color={colors.pink} /></View>
            <Text style={s.question}>Remove wallet from this phone?</Text>
            <Text style={s.reviewCopy}>You will need your recovery phrase and separate key or note backups to restore access. This cannot be undone.</Text>
          </View>
        </>}
        {step.phase === 'working' && <>
          <Text accessibilityLiveRegion="polite">{step.cancelling ? 'Checking whether removal completed…' : 'Removing wallet and checking storage…'}</Text>
        </>}
        {step.phase === 'outcome' && <>
          {step.outcome === 'removed' && <Text accessibilityLiveRegion="polite">Pali verified that the local wallet records were removed. Saved watch accounts remain available.</Text>}
          {step.outcome === 'unchanged' && <Text accessibilityLiveRegion="polite">Removal did not complete. Your wallet records are still saved on this device.</Text>}
          {step.outcome === 'unconfirmed' && <Text accessibilityRole="alert">Pali could not verify whether removal completed. Close and reopen Pali to check this device.</Text>}
        </>}
        {step.phase === 'blocked' && <Text accessibilityRole="alert">Close and reopen Pali to check this device.</Text>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  reviewHero: { alignItems: 'center', paddingVertical: 24, gap: 20 },
  trash: { width: 72, height: 72, borderRadius: 22, backgroundColor: '#301f2c', borderWidth: 1, borderColor: '#784153', alignItems: 'center', justifyContent: 'center' },
  question: { color: colors.text, fontSize: 24, lineHeight: 33, fontWeight: '600', textAlign: 'center' },
  reviewCopy: { color: colors.muted, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  error: { color: colors.red },
});
