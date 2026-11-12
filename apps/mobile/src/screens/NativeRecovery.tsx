import { useNativeTranslation } from '../platform/localization';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, BackHandler, findNodeHandle, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text as NativeText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeRecoveryFlow } from '../custody/recoveryFlow';
import type { RecoveryInventory } from '../custody/recoveryInventory';
import { Button, Card, colors, Icon, Notice, Screen, SegmentedControl, styles, Text } from '../ui';

type Snapshot = ReturnType<NativeRecoveryFlow['getSnapshot']>;
const blankWords = (count: number) => Array<string>(count).fill('');


/** Transient recovery phrase inputs only. The supplied flow owns all recovery authority. */
export function NativeRecovery({ flow }: { flow: NativeRecoveryFlow }) {
  const { t } = useNativeTranslation();
  const titles: Record<Snapshot['phase'], string> = {
    reading: t('mobile.recoveryDevices.recovery.recoverAccess'), scope: t('mobile.recoveryDevices.recovery.recoverAccess'), entry: t('mobile.recoveryDevices.recovery.recoveryPhrase'),
    verifying: t('mobile.recoveryDevices.recovery.verifyingYourWallet'), review: t('mobile.recoveryDevices.recovery.walletVerified'), committing: t('mobile.recoveryDevices.recovery.restoringAccess'),
    reopening: t('mobile.recoveryDevices.recovery.reopeningYourWallet'), closed: t('mobile.recoveryDevices.recovery.recoveryClosed'), blocked: t('mobile.recoveryDevices.recovery.recoveryUnavailable'),
  };
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
    const expectedPrompt = () => flow.getSnapshot().phase === 'committing' && flow.isAuthenticating();
    const change = AppState.addEventListener('change', state => {
      if (state !== 'active' && !allowsPrivateAuthenticationInterruption({ isAuthenticating: expectedPrompt }, state)) cancel();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!expectedPrompt()) cancel(); }) : null;
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
      setEntryError(t('mobile.recoveryDevices.recovery.enterEachRecoveryWordInOrder')); return;
    }
    const phrase = entered.current.join(' ');
    if (flow.submit({ phrase })) clear();
  };
  const progress = snapshot.phase === 'reading' ? [t('mobile.recoveryDevices.recovery.checkingSavedWalletData'), t('mobile.recoveryDevices.recovery.checkingSavedData')]
    : snapshot.phase === 'verifying' ? [t('mobile.recoveryDevices.recovery.verifyingYourWallet3'), t('mobile.recoveryDevices.recovery.verifyingWallet')]
      : snapshot.phase === 'committing' ? [t('mobile.recoveryDevices.recovery.restoringSecureAccess'), t('mobile.recoveryDevices.recovery.restoringAccess')]
        : snapshot.phase === 'reopening' ? [t('mobile.recoveryDevices.recovery.reopeningYourWalletSecurely'), t('mobile.recoveryDevices.recovery.reopeningWallet')] : null;
  const inventory = snapshot.inventory?.status === 'needs-matching-phrase-verification' && snapshot.inventory.counts ? snapshot.inventory : null;
  const showInventory = snapshot.phase === 'scope' || snapshot.phase === 'review';
  const complete = words.length === count && words.every(word => !!word && !/\s/u.test(word));
  const footer = snapshot.phase === 'scope' ? <>
    <Button title={t('mobile.recoveryDevices.recovery.restoreWallet')} disabled={!inventory} onPress={() => { if (current() && flow.getSnapshot().phase === 'scope') { clear(); flow.enter(); } }} />
    <Button title={t('buttons.cancel')} variant="secondary" onPress={back} />
  </> : snapshot.phase === 'entry' ? <>
    <Button title={t('buttons.continue')} disabled={!complete} onPress={verifyPhrase} />
    <Button title={t('buttons.cancel')} variant="secondary" onPress={back} />
  </> : snapshot.phase === 'review' ? <>
    <Button title={t('mobile.recoveryDevices.recovery.restoreSecureAccess')} onPress={() => { if (current() && flow.getSnapshot().phase === 'review') { clear(); flow.commit(); } }} />
    <Button title={t('mobile.recoveryDevices.recovery.cancelRecovery')} variant="secondary" onPress={back} />
  </> : <Button title={snapshot.phase === 'committing' || snapshot.phase === 'reopening' ? t('mobile.recoveryDevices.recovery.leaveRecovery')
    : snapshot.phase === 'blocked' || snapshot.phase === 'closed' ? t('mobile.recoveryDevices.recovery.backToUnlock') : t('mobile.recoveryDevices.recovery.cancelRecovery')} variant="secondary" onPress={back} />;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen key={snapshot.phase} footer={<View style={s.actions}>{footer}</View>} gap={18}>
        <View style={s.header}>
          <IdlePressable accessibilityRole="button" accessibilityLabel={t('buttons.back')} onPress={back}
            style={({ pressed }) => [s.back, pressed && { opacity: 0.65 }]}><Icon name="arrow-left" /></IdlePressable>
          <NativeText ref={heading} accessibilityRole="header" allowFontScaling style={[styles.text, s.title]}>{titles[snapshot.phase]}</NativeText>
        </View>
        {progress && <View style={s.progress}><ActivityIndicator color={colors.pink} accessibilityLabel={progress[1]} /><Text accessibilityLiveRegion="polite" style={s.body}>{progress[0]}</Text></View>}
        {snapshot.phase === 'scope' && <>
          <View style={s.intro}><View style={s.keyIcon}><Icon name="key" size={40} color={colors.blue} /></View>
            <Text accessibilityRole="header" style={s.heroTitle}>{t('mobile.recoveryDevices.recovery.restoreWalletAccess')}</Text>
            <Text style={s.introBody}>{t('mobile.recoveryDevices.recovery.verifyYourRecoveryPhraseThenProtectYour')}</Text></View>
          <Notice title={t('mobile.recoveryDevices.recovery.yourPhraseRestoresTheWallet')} body={t('mobile.recoveryDevices.recovery.yourRecoveryPhraseVerifiesThisWalletBefore')} tone="amber" />
          <Text style={s.caption}>{t('mobile.recoveryDevices.recovery.thisChecksTheWalletSavedOnThis')}</Text>
        </>}
        {snapshot.phase === 'review' && <Notice title={t('mobile.recoveryDevices.recovery.yourPhraseMatchesThisSavedWallet')} body={t('mobile.recoveryDevices.recovery.deviceProtectedAccessWillBeRestoredSaved')} />}
        {showInventory && inventory && <>
          <Button title={details ? t('mobile.recoveryDevices.recovery.hideSavedDataDetails') : t('mobile.recoveryDevices.recovery.savedDataDetails')} variant="secondary" size="compact" icon={details ? 'chevron-up' : 'chevron-down'} expanded={details} onPress={() => setDetails(!details)} />
          {details && <Inventory inventory={inventory} />}
        </>}
        {showInventory && !inventory && <Notice title={t('mobile.recoveryDevices.recovery.savedDataUnavailable')} body={t('mobile.recoveryDevices.recovery.yourSavedWalletCouldNotBeVerified')} tone="amber" />}
        {snapshot.phase === 'entry' && <>
          <Text accessibilityRole="header" style={s.heroTitle}>{t('mobile.recoveryDevices.recovery.enterYourRecoveryPhrase')}</Text>
          <Text style={s.body}>{t('mobile.recoveryDevices.recovery.enterEachWordInItsOriginalOrder')}</Text>
          <SegmentedControl label={t('mobile.recoveryDevices.recovery.recoveryPhraseLength')} value={String(count)} options={[{ value: '12', label: t('mobile.recoveryDevices.common.wordCount', { count: 12 }) }, { value: '24', label: t('mobile.recoveryDevices.common.wordCount', { count: 24 }) }]}
            onChange={value => {
              if (!current() || sequence.current !== entrySequence || flow.getSnapshot().phase !== 'entry') return;
              wordCount.current = value === '24' ? 24 : 12; setCount(wordCount.current); clear();
            }} />
          <View style={s.grid}>{words.map((word, index) => <View key={index} style={s.word}>
            <Text style={s.number}>{index + 1}</Text>
            <IdleTextInput accessibilityLabel={t('mobile.recoveryDevices.common.recoveryWord', { index: index + 1 })} placeholder={t('mobile.recoveryDevices.common.word', { index: index + 1 })} placeholderTextColor={colors.muted}
              value={word} onChangeText={value => editWord(index, value)} autoCapitalize="none" autoCorrect={false} spellCheck={false}
              autoComplete="off" textContentType="none" importantForAutofill="noExcludeDescendants" maxLength={index === 0 ? 4096 : 64} style={s.input} />
          </View>)}</View>
          <Notice title={t('mobile.recoveryDevices.recovery.keepYourPhrasePrivate')} body={t('mobile.recoveryDevices.recovery.paliSupportWillNeverAskForThese')} tone="amber" />
          {!!(entryError || snapshot.fieldErrors.phrase) && <Text accessibilityRole="alert" style={s.error}>{entryError || snapshot.fieldErrors.phrase}</Text>}
        </>}
        {snapshot.phase === 'committing' && <Text style={s.body}>{t('mobile.recoveryDevices.recovery.leavingNowStopsThisScreenTheAccess')}</Text>}
        {snapshot.phase === 'closed' && !snapshot.error && <Text style={s.body}>{t('mobile.recoveryDevices.recovery.returningToUnlock')}</Text>}
        {snapshot.phase === 'blocked' && !snapshot.error && <Text style={s.body}>{t('mobile.recoveryDevices.recovery.yourSavedWalletCouldNotBeVerified')}</Text>}
        {!!snapshot.error && <NativeText ref={error} allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.text, s.error]}>{snapshot.error}</NativeText>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Inventory({ inventory }: { inventory: RecoveryInventory }) {
  const { t } = useNativeTranslation();
  const counts = inventory.counts!;
  const rows = [
    [t('mobile.recoveryDevices.recovery.seedDerivedAccounts'), counts.hdAccounts], [t('mobile.recoveryDevices.recovery.importedKeysSavedOnThisDevice'), counts.importedKeys],
    [t('mobile.recoveryDevices.recovery.savedTransactions'), counts.retainedSignedTransactions], [t('mobile.recoveryDevices.recovery.tokensAndSavedActivity'), t('mobile.recoveryDevices.recovery.tokenSummary', { tokens: counts.tokenEntries, summaries: counts.historySummaries })],
    [t('mobile.recoveryDevices.recovery.cachedTransactions'), counts.cachedTransactions], [t('mobile.recoveryDevices.recovery.activityPreferences'), counts.activityPreferences],
  ] as const;
  return <>
    <Card style={s.inventory}>{rows.map(([label, value]) => <View key={label} style={s.inventoryRow}><Text style={s.inventoryLabel}>{label}</Text><Text style={s.count}>{value}</Text></View>)}</Card>
    <Text style={s.caption}>{t('mobile.recoveryDevices.recovery.backupStatus', { status: t(inventory.backup === 'confirmed' ? 'mobile.recoveryDevices.common.confirmed' : inventory.backup === 'unconfirmed' ? 'mobile.recoveryDevices.recovery.notConfirmed' : 'mobile.recoveryDevices.common.unknown') })}</Text>
    <Notice title={t('mobile.recoveryDevices.recovery.importedKeysStillNeedSeparateBackups')} body={t('mobile.recoveryDevices.recovery.importedKeysSavedOnThisPhoneWill')} tone="amber" />
    <Text style={s.caption}>{inventory.privateNotes === 'requires-matching-phrase-verification' ? t('mobile.recoveryDevices.recovery.savedPrivateNotesWillBeVerifiedAnd') : t('mobile.recoveryDevices.recovery.noPrivateNotesAreSavedOnThis')}</Text>
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
