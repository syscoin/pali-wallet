import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, BackHandler, findNodeHandle, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text as NativeText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeRecoveryFlow } from '../custody/recoveryFlow';
import type { RecoveryInventory } from '../custody/recoveryInventory';
import { Button, Card, colors, Icon, Notice, Screen, SegmentedControl, styles, Text } from '../ui';
import { PinSetup } from './PinEntry';

type Snapshot = ReturnType<NativeRecoveryFlow['getSnapshot']>;
const blankWords = (count: number) => Array<string>(count).fill('');
const titles: Record<Snapshot['phase'], string> = {
  reading: 'Recover access', scope: 'Recover access', entry: 'Recovery phrase',
  verifying: 'Verifying your wallet', review: 'Wallet verified', pin: 'Create PIN', committing: 'Changing your PIN',
  reopening: 'Reopening your wallet', closed: 'Recovery closed', blocked: 'Recovery unavailable',
};

/** Transient phrase/PIN inputs only. The supplied flow owns all recovery authority. */
export function NativeRecovery({ flow }: { flow: NativeRecoveryFlow }) {
  const snapshot = useSyncExternalStore(useCallback(listener => flow.subscribe(listener), [flow]),
    useCallback(() => flow.getSnapshot(), [flow]), useCallback(() => flow.getSnapshot(), [flow]));
  const [count, setCount] = useState<12 | 24>(12);
  const [words, setWords] = useState(() => blankWords(12));
  const [details, setDetails] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [entrySequence, setEntrySequence] = useState(0);
  const entered = useRef(blankWords(12)), wordCount = useRef<12 | 24>(12);
  const sequence = useRef(0);
  const alive = useRef(false), cancelled = useRef(false), activeFlow = useRef(flow);
  const latestBack = useRef<() => void>(() => undefined);
  const heading = useRef<React.ElementRef<typeof NativeText>>(null);
  const error = useRef<React.ElementRef<typeof NativeText>>(null);
  const clear = useCallback((render = true) => {
    sequence.current++; entered.current = blankWords(wordCount.current);
    if (render && alive.current) { setWords(entered.current); setEntrySequence(sequence.current); setEntryError(''); }
    Keyboard.dismiss();
  }, []);
  const back = useCallback(() => {
    if (!alive.current || activeFlow.current !== flow) return;
    clear(); flow.back();
  }, [clear, flow]);
  useLayoutEffect(() => { latestBack.current = back; }, [back]);
  useLayoutEffect(() => {
    alive.current = true; cancelled.current = false; activeFlow.current = flow;
    clear();
    const cancel = () => { cancelled.current = true; clear(); flow.cancel(); };
    const change = AppState.addEventListener('change', state => { if (state !== 'active') cancel(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', cancel) : null;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => { latestBack.current(); return true; });
    if (AppState.currentState === 'active') flow.start(); else cancel();
    return () => {
      alive.current = false; cancelled.current = true; clear(false);
      hardware.remove(); change.remove(); blur?.remove(); flow.cancel();
    };
  }, [clear, flow]);
  useLayoutEffect(() => { if (snapshot.phase !== 'entry') clear(); }, [clear, snapshot.phase]);
  useLayoutEffect(() => {
    const target = snapshot.error ? error.current : heading.current;
    if (!target) return;
    if (Platform.OS === 'web') {
      const node = target as unknown as { setAttribute?: (name: string, value: string) => void; focus?: () => void };
      node.setAttribute?.('tabindex', '-1'); node.focus?.();
    } else {
      const handle = findNodeHandle(target);
      if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
    }
  }, [snapshot.phase, snapshot.error]);
  const current = () => alive.current && !cancelled.current && activeFlow.current === flow && AppState.currentState === 'active';
  const editWord = (index: number, value: string) => {
    if (!current() || sequence.current !== entrySequence || flow.getSnapshot().phase !== 'entry') return;
    const normalized = value.normalize('NFKD').trim().toLowerCase();
    const pasted = index === 0 ? normalized.split(/\s+/u) : [];
    if (pasted.length === 12 || pasted.length === 24) {
      wordCount.current = pasted.length; setCount(pasted.length); entered.current = pasted;
    } else entered.current = entered.current.map((word, position) => position === index ? normalized : word);
    setWords([...entered.current]); setEntryError('');
  };
  const verifyPhrase = () => {
    if (!current() || sequence.current !== entrySequence || flow.getSnapshot().phase !== 'entry') return;
    if (entered.current.length !== wordCount.current || entered.current.some(word => !word || /\s/u.test(word))) {
      setEntryError('Enter each recovery word in order.'); return;
    }
    const phrase = entered.current.join(' ');
    if (flow.submit({ phrase })) clear();
  };
  if (snapshot.phase === 'pin') return <PinSetup
    key={`recovery-pin-${entrySequence}`} title="Create a new 6-digit PIN" offerBiometrics={false}
    error={snapshot.fieldErrors.pin || snapshot.error}
    onBack={back}
    onComplete={pin => {
      if (!current() || flow.getSnapshot().phase !== 'pin') return;
      if (flow.submitPin(pin)) clear();
    }} />;

  const progress = snapshot.phase === 'reading' ? ['Checking saved wallet data…', 'Checking saved data']
    : snapshot.phase === 'verifying' ? ['Verifying your wallet…', 'Verifying wallet']
      : snapshot.phase === 'committing' ? ['Changing your PIN…', 'Changing PIN']
        : snapshot.phase === 'reopening' ? ['Reopening your wallet securely…', 'Reopening wallet'] : null;
  const inventory = snapshot.inventory?.status === 'needs-matching-phrase-verification' && snapshot.inventory.counts ? snapshot.inventory : null;
  const showInventory = snapshot.phase === 'scope' || snapshot.phase === 'review';
  const complete = words.length === count && words.every(word => !!word && !/\s/u.test(word));
  const footer = snapshot.phase === 'scope' ? <>
    <Button title="Restore Wallet" disabled={!inventory} onPress={() => { if (current() && flow.getSnapshot().phase === 'scope') { clear(); flow.enter(); } }} />
    <Button title="Cancel" variant="secondary" onPress={back} />
  </> : snapshot.phase === 'entry' ? <>
    <Button title="Continue" disabled={!complete} onPress={verifyPhrase} />
    <Button title="Cancel" variant="secondary" onPress={back} />
  </> : snapshot.phase === 'review' ? <>
    <Button title="Create new PIN" onPress={() => { if (current() && flow.getSnapshot().phase === 'review') { clear(); flow.commit(); } }} />
    <Button title="Cancel recovery" variant="secondary" onPress={back} />
  </> : <Button title={snapshot.phase === 'committing' || snapshot.phase === 'reopening' ? 'Leave recovery'
    : snapshot.phase === 'blocked' || snapshot.phase === 'closed' ? 'Back to unlock' : 'Cancel recovery'} variant="secondary" onPress={back} />;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen key={snapshot.phase} footer={<View style={s.actions}>{footer}</View>} gap={18}>
        <View style={s.header}>
          <IdlePressable accessibilityRole="button" accessibilityLabel="Back" onPress={back}
            style={({ pressed }) => [s.back, pressed && { opacity: 0.65 }]}><Icon name="arrow-left" /></IdlePressable>
          <NativeText ref={heading} accessibilityRole="header" allowFontScaling style={[styles.text, s.title]}>{titles[snapshot.phase]}</NativeText>
        </View>
        {progress && <View style={s.progress}><ActivityIndicator color={colors.pink} accessibilityLabel={progress[1]} /><Text accessibilityLiveRegion="polite" style={s.body}>{progress[0]}</Text></View>}
        {snapshot.phase === 'scope' && <>
          <View style={s.intro}><View style={s.keyIcon}><Icon name="key" size={40} color={colors.blue} /></View>
            <Text accessibilityRole="header" style={s.heroTitle}>Forgot your PIN?</Text>
            <Text style={s.introBody}>Restore with your recovery phrase, then create a new Pali PIN.</Text></View>
          <Notice title="Your phrase restores the wallet" body="You cannot recover your old PIN. Your recovery phrase is required to regain access." tone="amber" />
          <Text style={s.caption}>This checks the wallet saved on this phone. Nothing is erased automatically.</Text>
        </>}
        {snapshot.phase === 'review' && <Notice title="Your phrase matches this saved wallet." body="Only the PIN for this phone will change. Saved accounts, imported-key records, tokens and transaction records will be kept." />}
        {showInventory && inventory && <>
          <Button title={details ? 'Hide saved-data details' : 'Saved-data details'} variant="secondary" size="compact" icon={details ? 'chevron-up' : 'chevron-down'} expanded={details} onPress={() => setDetails(!details)} />
          {details && <Inventory inventory={inventory} />}
        </>}
        {showInventory && !inventory && <Notice title="Saved data unavailable" body="Your saved wallet could not be verified for this recovery. Nothing has been reset." tone="amber" />}
        {snapshot.phase === 'entry' && <>
          <Text accessibilityRole="header" style={s.heroTitle}>Enter your recovery phrase</Text>
          <Text style={s.body}>Enter each word in its original order. Pali will check that the phrase matches this wallet.</Text>
          <SegmentedControl label="Recovery phrase length" value={String(count)} options={[{ value: '12', label: '12 words' }, { value: '24', label: '24 words' }]}
            onChange={value => {
              if (!current() || sequence.current !== entrySequence || flow.getSnapshot().phase !== 'entry') return;
              wordCount.current = value === '24' ? 24 : 12; setCount(wordCount.current); clear();
            }} />
          <View style={s.grid}>{words.map((word, index) => <View key={index} style={s.word}>
            <Text style={s.number}>{index + 1}</Text>
            <IdleTextInput accessibilityLabel={`Recovery word ${index + 1}`} placeholder={`Word ${index + 1}`} placeholderTextColor={colors.muted}
              value={word} onChangeText={value => editWord(index, value)} autoCapitalize="none" autoCorrect={false} spellCheck={false}
              autoComplete="off" textContentType="none" importantForAutofill="noExcludeDescendants" maxLength={index === 0 ? 4096 : 64} style={s.input} />
          </View>)}</View>
          <Notice title="Keep your phrase private" body="Pali support will never ask for these words." tone="amber" />
          {!!(entryError || snapshot.fieldErrors.phrase) && <Text accessibilityRole="alert" style={s.error}>{entryError || snapshot.fieldErrors.phrase}</Text>}
        </>}
        {snapshot.phase === 'committing' && <Text style={s.body}>Leaving now stops this screen. The PIN change may already have completed.</Text>}
        {snapshot.phase === 'closed' && !snapshot.error && <Text style={s.body}>Returning to unlock…</Text>}
        {snapshot.phase === 'blocked' && !snapshot.error && <Text style={s.body}>Your saved wallet could not be verified for this recovery. Nothing has been reset.</Text>}
        {!!snapshot.error && <NativeText ref={error} allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.text, s.error]}>{snapshot.error}</NativeText>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Inventory({ inventory }: { inventory: RecoveryInventory }) {
  const counts = inventory.counts!;
  const rows = [
    ['Seed-derived accounts', counts.hdAccounts], ['Imported keys saved on this device', counts.importedKeys],
    ['Saved transactions', counts.retainedSignedTransactions], ['Tokens and saved activity', `${counts.tokenEntries} tokens · ${counts.historySummaries} summaries`],
    ['Cached transactions', counts.cachedTransactions], ['Activity preferences', counts.activityPreferences],
  ] as const;
  return <>
    <Card style={s.inventory}>{rows.map(([label, value]) => <View key={label} style={s.inventoryRow}><Text style={s.inventoryLabel}>{label}</Text><Text style={s.count}>{value}</Text></View>)}</Card>
    <Text style={s.caption}>Observed local records, not a complete transaction history. Recovery does not change your saved backup status ({inventory.backup === 'confirmed' ? 'confirmed' : inventory.backup === 'unconfirmed' ? 'not confirmed' : 'unknown'}).</Text>
    <Notice title="Imported keys still need separate backups" body="Imported keys saved on this phone will be kept. Your recovery phrase cannot recreate them on a new or lost phone; keep their original keys backed up separately." tone="amber" />
    <Text style={s.caption}>{inventory.privateNotes === 'requires-matching-phrase-verification' ? 'Saved private notes will be verified and kept. Keep a separate backup for a new or lost phone.' : 'No private notes are saved on this phone.'}</Text>
  </>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  title: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 },
  actions: { gap: 10 }, body: { fontSize: 16, lineHeight: 25 }, caption: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  intro: { alignItems: 'center', gap: 22, paddingTop: 24, paddingBottom: 12 },
  keyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 26, lineHeight: 34, fontWeight: '600', textAlign: 'center' }, introBody: { color: colors.muted, fontSize: 17, lineHeight: 26, textAlign: 'center' },
  progress: { gap: 15, alignItems: 'center', paddingVertical: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  word: { width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.blue, backgroundColor: colors.surface, paddingHorizontal: 12 },
  number: { color: colors.muted, fontSize: 13, minWidth: 16 }, input: { minWidth: 0, flex: 1, color: colors.text, fontSize: 15, paddingVertical: 14 },
  error: { color: colors.red, fontSize: 15, lineHeight: 23 }, inventory: { padding: 14, gap: 12 },
  inventoryRow: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' }, inventoryLabel: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.muted }, count: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
});
