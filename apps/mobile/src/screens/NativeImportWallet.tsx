import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Icon, Notice, Screen, SegmentedControl, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export type NativeImportWalletProps = {
  preview(phrase: string, assertCurrent: () => void): Promise<readonly { label: string; address: string }[]>;
  onConfirmed(phrase: string): void;
  onBack(): void;
};
type PreviewAddress = Readonly<{ label: string; address: string }>;
const blank = (count: number) => Array<string>(count).fill('');

/** Phrase entry and public address review; derivation belongs to the private host. */
export function NativeImportWallet({ preview, onConfirmed, onBack }: NativeImportWalletProps) {
  const [count, setCount] = useState<12 | 24>(12);
  const [words, setWords] = useState(() => blank(12));
  const [addresses, setAddresses] = useState<readonly PreviewAddress[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owner = useRef({ mounted: false, generation: 0, working: false, reviewing: false });
  const inputs = useRef(blank(12)), length = useRef<12 | 24>(12), checkedPhrase = useRef('');
  const latest = useRef({ preview, onConfirmed, onBack });
  useLayoutEffect(() => { latest.current = { preview, onConfirmed, onBack }; }, [preview, onConfirmed, onBack]);
  const clear = useCallback(() => {
    owner.current.generation++; owner.current.working = false; owner.current.reviewing = false;
    inputs.current = blank(length.current); checkedPhrase.current = '';
    setWords(inputs.current); setAddresses(null); setBusy(false); setError('');
    Keyboard.dismiss();
  }, []);
  const back = useCallback(() => {
    if (!owner.current.mounted) return;
    const reviewing = owner.current.reviewing;
    clear();
    if (!reviewing) latest.current.onBack();
  }, [clear]);
  useLayoutEffect(() => {
    const current = owner.current;
    current.mounted = true;
    clear();
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    const activity = AppState.addEventListener('change', state => { if (state !== 'active') clear(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', clear) : null;
    return () => {
      current.mounted = false; current.generation++; current.working = false; current.reviewing = false;
      inputs.current = []; checkedPhrase.current = '';
      hardware.remove(); activity.remove(); blur?.remove();
    };
  }, [preview, back, clear]);
  const edit = (index: number, value: string) => {
    if (!owner.current.mounted || owner.current.working || owner.current.reviewing || AppState.currentState !== 'active') return;
    const normalized = value.trim().toLowerCase();
    // A full phrase must arrive through an explicit first-field input. Never read the clipboard.
    const pasted = index === 0 ? normalized.split(/\s+/) : [];
    if (pasted.length === 12 || pasted.length === 24) {
      length.current = pasted.length; setCount(pasted.length); inputs.current = pasted;
    } else inputs.current = inputs.current.map((word, position) => position === index ? normalized : word);
    owner.current.generation++; checkedPhrase.current = '';
    setWords([...inputs.current]); setError('');
  };
  const complete = words.length === count && words.every(word => !!word && !/\s/.test(word));
  const checkPhrase = async () => {
    const current = owner.current, host = latest.current.preview;
    if (!current.mounted || current.working || current.reviewing || AppState.currentState !== 'active') return;
    if (inputs.current.length !== length.current || inputs.current.some(word => !word || /\s/.test(word))) {
      setError('Enter each recovery word in order.'); return;
    }
    const generation = ++current.generation, phrase = inputs.current.join(' ');
    const check = () => {
      if (!current.mounted || current.generation !== generation || latest.current.preview !== host || AppState.currentState !== 'active')
        throw new Error('CANCELLED');
    };
    current.working = true; setBusy(true); setError(''); Keyboard.dismiss();
    try {
      check();
      const result = await host(phrase, check);
      check();
      if (!Array.isArray(result) || result.length < 1 || result.length > 32) throw new Error('INVALID_PREVIEW');
      const rows = result.map(row => {
        if (!row || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 80 ||
            typeof row.address !== 'string' || !row.address.trim() || row.address.length > 256 ||
            /[\u0000-\u001f\u007f-\u009f]/.test(row.label + row.address)) throw new Error('INVALID_PREVIEW');
        return Object.freeze({ label: row.label, address: row.address });
      });
      check(); checkedPhrase.current = phrase; current.reviewing = true;
      setAddresses(Object.freeze(rows));
    } catch {
      if (current.mounted && current.generation === generation) setError('That recovery phrase could not be checked. Review the words and try again.');
    } finally {
      if (current.mounted && current.generation === generation) { current.working = false; setBusy(false); }
    }
  };
  const confirm = () => {
    if (!owner.current.mounted || owner.current.working || !owner.current.reviewing ||
        !checkedPhrase.current || AppState.currentState !== 'active') return;
    const phrase = checkedPhrase.current;
    clear(); latest.current.onConfirmed(phrase);
  };

  return <SafeAreaView edges={['top', 'bottom']} style={s.root}>
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scrollResetKey={addresses ? 'confirm-wallet' : 'phrase'} footer={addresses
        ? <Button title="Continue to security setup" onPress={confirm} />
        : <Button title={busy ? 'Checking phrase…' : 'Check phrase'} disabled={busy || !complete} onPress={() => void checkPhrase()} />}>
        <Header title={addresses ? 'Confirm wallet' : 'Import wallet'} onBack={back} />
        {addresses ? <>
          <View style={s.confirmIntro}>
            <View style={s.walletIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="wallet" size={38} color={colors.blue} /></View>
            <Text accessibilityRole="header" style={[s.title, s.center]}>Is this your wallet?</Text>
            <Text style={[s.description, s.center]}>Check these addresses against a trusted copy before continuing.</Text>
          </View>
          <Card style={s.addresses}>{addresses.map((row, index) => <View key={index} style={[s.addressRow, index < addresses.length - 1 && s.divider]}>
            <Text style={s.addressLabel}>{row.label}</Text>
            <Text selectable style={s.address} accessibilityLabel={`${row.label} address ${row.address}`}>{row.address}</Text>
          </View>)}</Card>
        </> : <>
          <Text accessibilityRole="header" style={s.title}>Enter your recovery phrase</Text>
          <Text style={s.description}>Enter each word in order to restore your Pali wallet.</Text>
          <SegmentedControl label="Recovery phrase length" value={count === 12 ? '12' : '24'}
            options={[{ value: '12', label: '12 words' }, { value: '24', label: '24 words' }]}
            onChange={value => {
              if (owner.current.working || !owner.current.mounted) return;
              length.current = value === '24' ? 24 : 12; setCount(length.current); clear();
            }} />
          <View style={s.grid}>{words.map((word, index) => <View key={index} style={s.word}>
            <Text style={s.number}>{index + 1}</Text>
            <IdleTextInput accessibilityLabel={`Recovery word ${index + 1}`} placeholder={`Word ${index + 1}`} placeholderTextColor={colors.muted}
              value={word} editable={!busy} onChangeText={value => edit(index, value)} autoCapitalize="none" autoCorrect={false} spellCheck={false}
              autoComplete="off" textContentType="none" importantForAutofill="noExcludeDescendants" maxLength={index === 0 ? 4096 : 64} style={s.input} />
          </View>)}</View>
          <Notice title="Keep your phrase private" body="Only enter your phrase in Pali when you intentionally restore your wallet." tone="amber" />
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        </>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 26, lineHeight: 34, fontWeight: '600', letterSpacing: -0.6 },
  description: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  word: { width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.blue, backgroundColor: colors.surface, paddingHorizontal: 12 },
  number: { color: colors.muted, fontSize: 13, minWidth: 16 },
  input: { minWidth: 0, flex: 1, color: colors.text, fontSize: 15, paddingVertical: 14 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  confirmIntro: { alignItems: 'center', gap: 18, paddingVertical: 24 },
  center: { textAlign: 'center' },
  walletIcon: { width: 88, height: 88, borderRadius: 26, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  addresses: { overflow: 'hidden' },
  addressRow: { padding: 16, gap: 8 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  addressLabel: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  address: { color: colors.text, fontSize: 15, lineHeight: 23, flexShrink: 1 },
});
