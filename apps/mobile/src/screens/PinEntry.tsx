import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, Header, Icon, PaliMark, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import type { BiometricPresentation } from '../core/biometricPresentation';
import { useBiometricPresentation } from '../platform/useBiometricPresentation';
export { genericBiometrics, type BiometricPresentation } from '../core/biometricPresentation';

export const isWalletPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{6}$/.test(pin);

/** Six digits remain inside the active input. No clipboard, keyboard learning or public snapshot. */
export function PinPad({ onComplete, disabled = false, resetKey = '', error, spacious = false }: {
  onComplete(pin: string): void; disabled?: boolean; resetKey?: string | number; error?: string; spacious?: boolean;
}) {
  const compact = useWindowDimensions().height < 700;
  const scope = useMemo(() => ({ resetKey }), [resetKey]);
  const [entry, setEntry] = useState<{ scope: object; count: number } | null>(null);
  const digitCount = entry?.scope === scope ? entry.count : 0;
  const owner = useRef<{ scope: object; active: boolean; sealed: boolean; digits: string } | null>(null);
  const latest = useRef({ onComplete, disabled });
  useLayoutEffect(() => { latest.current = { onComplete, disabled }; }, [onComplete, disabled]);
  useLayoutEffect(() => {
    const current = { scope, active: true, sealed: false, digits: '' };
    owner.current = current;
    const clear = () => { current.digits = ''; current.sealed = false; if (owner.current === current) setEntry({ scope, count: 0 }); };
    const activity = AppState.addEventListener('change', state => { if (state !== 'active') clear(); });
    return () => { current.active = false; current.digits = ''; activity.remove(); };
  }, [scope]);
  const edit = (digit: string | null) => {
    const current = owner.current;
    if (!current || current.scope !== scope || !current.active || current.sealed || latest.current.disabled || AppState.currentState !== 'active') return;
    const next = digit === null ? current.digits.slice(0, -1) : current.digits + digit;
    if (next.length > 6) return;
    current.digits = next; setEntry({ scope, count: next.length });
    if (next.length === 6) {
      current.sealed = true;
      latest.current.onComplete(next);
    }
  };
  return <View style={[s.pad, spacious && s.padSpacious, compact && s.padCompact]}>
    <View accessible accessibilityLabel={`PIN, ${digitCount} of 6 digits entered`} style={[s.dots, compact && s.dotsCompact]}>
      {Array.from({ length: 6 }, (_, index) => <View key={index} style={[s.dot, index < digitCount && s.filled]} />)}
    </View>
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    <View style={s.keys}>
      {['123', '456', '789', ' 0x'].map((row, index) => <View key={index} style={s.keyRow}>
        {[...row].map((digit, column) => digit === ' ' ? <View key={column} style={s.key} /> :
          <IdlePressable key={column} accessibilityRole="button" accessibilityLabel={digit === 'x' ? 'Delete PIN digit' : `PIN digit ${digit}`}
            disabled={disabled} onPress={() => edit(digit === 'x' ? null : digit)}
            style={({ pressed }) => [s.key, compact && s.keyCompact, pressed && s.pressed, disabled && s.disabled]}>
            {digit === 'x' ? <Icon name="backspace" color={colors.muted} size={25} /> : <Text style={s.digit}>{digit}</Text>}
          </IdlePressable>)}
      </View>)}
    </View>
  </View>;
}

export function PinEntryScreen({ title, description, onComplete, onBack, footer, error, busy = false, resetKey = '', step, brand = false, notice }: {
  title: string; description?: string; onComplete(pin: string): void; onBack?(): void; footer?: React.ReactNode;
  error?: string; busy?: boolean; resetKey?: string | number; step?: string; brand?: boolean; notice?: React.ReactNode;
}) {
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 700;
  // Reserve space for retry actions and multi-line errors before expanding the hero.
  const spacious = height >= 800 && fontScale <= 1.2 && !footer && !error && !notice;
  useLayoutEffect(() => { const back = BackHandler.addEventListener('hardwareBackPress', () => { onBack?.(); return true; }); return () => back.remove(); }, [onBack]);
  return <SafeAreaView style={s.root} edges={['top', 'bottom']}>
    <Screen footer={footer} gap={compact ? notice ? 8 : 12 : 20}>
      {brand ? <View style={[s.brand, compact && s.brandCompact]}><PaliMark size={compact ? 32 : 44} /><Text style={s.brandName}>Pali Wallet</Text></View> :
        <Header title="" onBack={onBack} right={step ? <Text style={s.step}>{step}</Text> : undefined} />}
      <View style={[s.intro, spacious && s.introSpacious, compact && s.introCompact]}>
        <Text accessibilityRole="header" style={[s.title, compact && s.titleCompact]}>{title}</Text>
        {!!description && <Text style={[s.description, compact && s.descriptionCompact]}>{description}</Text>}
      </View>
      {notice}
      <PinPad onComplete={onComplete} disabled={busy} resetKey={resetKey} error={error} spacious={spacious} />
    </Screen>
  </SafeAreaView>;
}

/** Actual local PIN setup, split into the reference's create, confirm and biometric pages. */
export function PinSetup({ onComplete, onBack, available = false, biometrics, busy = false, error, title = 'Create a 6-digit PIN', offerBiometrics = true }: {
  onComplete(pin: string, enrollBiometrics: boolean): void; onBack(): void; available?: boolean;
  biometrics?: BiometricPresentation; busy?: boolean; error?: string; title?: string; offerBiometrics?: boolean;
}) {
  const detectedBiometrics = useBiometricPresentation();
  const presentation = biometrics ?? detectedBiometrics;
  const [step, setStep] = useState<'create' | 'confirm' | 'biometric'>('create');
  const [localError, setLocalError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const pin = useRef('');
  const submitted = useRef(false);
  const generation = useRef({ value: 0 });
  const previousBusy = useRef(false);
  const previousError = useRef(error);
  const captured = generation.current.value;
  useLayoutEffect(() => {
    if (!busy && error && (previousBusy.current || previousError.current !== error)) submitted.current = false;
    previousBusy.current = busy;
    previousError.current = error;
  }, [busy, error]);
  useLayoutEffect(() => {
    const current = generation.current;
    const clear = () => { current.value++; pin.current = ''; submitted.current = false; setStep('create'); setLocalError(''); setAttempt(value => value + 1); };
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') clear(); });
    return () => { current.value++; pin.current = ''; subscription.remove(); };
  }, []);
  const back = () => {
    if (captured !== generation.current.value || busy || submitted.current) return;
    generation.current.value++;
    if (step === 'create') { pin.current = ''; onBack(); }
    else { pin.current = ''; setStep('create'); setLocalError(''); setAttempt(value => value + 1); }
  };
  const finish = (enabled: boolean) => {
    if (captured !== generation.current.value || busy || submitted.current || !isWalletPin(pin.current) || AppState.currentState !== 'active') return;
    submitted.current = true;
    onComplete(pin.current, enabled);
  };
  if (step === 'biometric') return <SafeAreaView style={s.root} edges={['top', 'bottom']}>
    <Screen footer={<>
      <Button title={`Use ${presentation.label}`} icon={presentation.icon} disabled={!available || busy} onPress={() => finish(true)} />
      <Button title="Not now" variant="secondary" disabled={busy} onPress={() => finish(false)} />
    </>}>
      <Header title={presentation.label === 'biometrics' ? 'Biometric unlock' : presentation.label === 'fingerprint' ? 'Fingerprint unlock' : presentation.label} onBack={back} right={<Text style={s.step}>3 of 3</Text>} />
      <View style={s.biometricHero}><View style={s.biometricIcon}><Icon name={presentation.icon} size={48} color={colors.blue} /></View>
        <Text accessibilityRole="header" style={s.title}>Unlock faster</Text>
        <Text style={s.description}>Unlock Pali and approve transactions with {presentation.label}. Your PIN always remains available.</Text>
        {!available && <Text style={s.description}>Set up biometrics in your device settings to enable this later.</Text>}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      </View>
    </Screen>
  </SafeAreaView>;
  return <PinEntryScreen title={step === 'create' ? title : 'Confirm your PIN'}
    description={step === 'create' ? 'Use this PIN to unlock Pali and confirm transactions.' : 'Enter the same PIN again.'}
    onBack={back} step={`${step === 'create' ? 1 : 2} of ${offerBiometrics ? 3 : 2}`} busy={busy}
    error={localError || error} resetKey={`${step}:${attempt}`}
    onComplete={entered => {
      if (captured !== generation.current.value) return;
      if (step === 'create') { generation.current.value++; pin.current = entered; setLocalError(''); setStep('confirm'); }
      else if (entered !== pin.current) { setLocalError('Your PINs do not match. Try again.'); setAttempt(value => value + 1); }
      else if (offerBiometrics) { generation.current.value++; setLocalError(''); setStep('biometric'); }
      else finish(false);
    }} />;
}

/** PIN entry for an existing form, without a text keyboard or password field. */
export function PinField({ label, value, onChange, busy }: { label: string; value: string; onChange(value: string): void; busy: boolean }) {
  const scope = useMemo(() => ({ label, populated: value.length > 0 }), [label, value]);
  const [open, setOpen] = useState<{ scope: object; sequence: number } | null>(null);
  const owner = useRef({ active: true, sequence: 0 });
  const latest = useRef({ onChange, busy });
  useLayoutEffect(() => { latest.current = { onChange, busy }; }, [onChange, busy]);
  useLayoutEffect(() => {
    const current = owner.current;
    current.active = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') { current.sequence++; setOpen(null); latest.current.onChange(''); } });
    return () => { current.active = false; current.sequence++; subscription.remove(); };
  }, []);
  useLayoutEffect(() => { owner.current.sequence++; }, [scope]);
  return <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <Button title={value.length === 6 ? '••••••' : 'Enter PIN'} variant="secondary" icon="lock" disabled={busy}
      onPress={() => { const sequence = ++owner.current.sequence; setOpen({ scope, sequence }); }} />
    {open?.scope === scope && <Modal visible animationType="slide" onRequestClose={() => { owner.current.sequence++; setOpen(null); }}>
      <PinEntryScreen title={label} description="Enter your 6-digit Pali PIN." onBack={() => { owner.current.sequence++; setOpen(null); }}
        onComplete={pin => { if (owner.current.active && owner.current.sequence === open.sequence && !latest.current.busy) { owner.current.sequence++; setOpen(null); latest.current.onChange(pin); } }} />
    </Modal>}
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  brand: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, paddingTop: 20 },
  brandCompact: { paddingTop: 0 },
  brandName: { fontSize: 23, fontWeight: '600' }, step: { fontSize: 13, color: colors.muted },
  intro: { alignItems: 'center', gap: 32, paddingTop: 26 }, introCompact: { gap: 6, paddingTop: 0 },
  introSpacious: { gap: 82, paddingTop: 50 },
  title: { fontSize: 27, lineHeight: 35, fontWeight: '600', textAlign: 'center' },
  titleCompact: { fontSize: 24, lineHeight: 30 },
  description: { color: colors.muted, fontSize: 16, lineHeight: 25, textAlign: 'center' },
  descriptionCompact: { fontSize: 14, lineHeight: 20 },
  pad: { flex: 1, justifyContent: 'space-between', gap: 28, paddingTop: 32, paddingBottom: 10 },
  padCompact: { gap: 8, paddingTop: 4, paddingBottom: 0 },
  padSpacious: { paddingTop: 100 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 14 },
  dotsCompact: { paddingVertical: 6 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#7395b5' },
  filled: { backgroundColor: colors.blue, borderColor: colors.blue },
  keys: { gap: 6 }, keyRow: { flexDirection: 'row', justifyContent: 'space-around' },
  key: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  keyCompact: { minHeight: 48 }, digit: { fontSize: 28, lineHeight: 36, fontWeight: '400' },
  pressed: { backgroundColor: colors.raised }, disabled: { opacity: 0.5 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  biometricHero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 36 },
  biometricIcon: { width: 88, height: 88, borderRadius: 26, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 8 }, fieldLabel: { color: colors.muted, fontSize: 13 },
});
