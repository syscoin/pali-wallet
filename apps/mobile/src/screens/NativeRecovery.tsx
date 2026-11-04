import { NEW_PASSWORD_HELP } from '../custody/password';
import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, BackHandler, findNodeHandle, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text as NativeText, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeRecoveryFlow } from '../custody/recoveryFlow';
import type { RecoveryInventory } from '../custody/recoveryInventory';
import { Button, Card, colors, Icon, Notice, Screen, styles, Text } from '../ui';

type Inputs = { phrase: string; password: string; confirmation: string };
const emptyInputs = (): Inputs => ({ phrase: '', password: '', confirmation: '' });
type Snapshot = ReturnType<NativeRecoveryFlow['getSnapshot']>;

const titles: Record<Snapshot['phase'], string> = {
  reading: 'Recover access', scope: 'Recover access', entry: 'Matching recovery phrase',
  verifying: 'Verifying your wallet', review: 'Wallet verified', committing: 'Changing your password',
  reopening: 'Reopening your wallet', closed: 'Recovery closed', blocked: 'Recovery unavailable',
};

/** Transient secret input only. The supplied flow owns all recovery authority. */
export function NativeRecovery({ flow }: { flow: NativeRecoveryFlow }) {
  const snapshot = useSyncExternalStore(useCallback((listener) => flow.subscribe(listener), [flow]),
    useCallback(() => flow.getSnapshot(), [flow]), useCallback(() => flow.getSnapshot(), [flow]));
  const [inputs, setInputs] = useState<Inputs>(emptyInputs);
  const [details, setDetails] = useState(false);
  const entered = useRef<Inputs>(emptyInputs());
  const alive = useRef(false);
  const cancelled = useRef(false);
  const latestBack = useRef<() => void>(() => undefined);
  const heading = useRef<React.ElementRef<typeof NativeText>>(null);
  const error = useRef<React.ElementRef<typeof NativeText>>(null);
  const clear = useCallback((render = true) => {
    entered.current = emptyInputs();
    if (render && alive.current) setInputs(emptyInputs());
    Keyboard.dismiss();
  }, []);
  const back = useCallback(() => { clear(); flow.back(); }, [clear, flow]);
  useLayoutEffect(() => { latestBack.current = back; }, [back]);
  useLayoutEffect(() => {
    alive.current = true;
    cancelled.current = false;
    const cancel = () => { cancelled.current = true; clear(); flow.cancel(); };
    const change = AppState.addEventListener('change', (state) => { if (state !== 'active') cancel(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', cancel) : null;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => { latestBack.current(); return true; });
    if (AppState.currentState === 'active') flow.start(); else cancel();
    return () => {
      alive.current = false; cancelled.current = true; clear(false);
      hardware.remove(); change.remove(); blur?.remove(); flow.cancel();
    };
  }, [clear, flow]);
  useLayoutEffect(() => {
    // A verification transition removes the fields before any async result can
    // return. A retry starts with empty inputs; neither snapshot nor route owns them.
    if (snapshot.phase !== 'entry') clear();
  }, [clear, snapshot.phase]);
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

  const update = (field: keyof Inputs, value: string) => {
    if (!alive.current || cancelled.current || snapshot.phase !== 'entry' || AppState.currentState !== 'active') return;
    entered.current = { ...entered.current, [field]: value }; setInputs(entered.current);
  };
  const submit = () => {
    if (!alive.current || cancelled.current || AppState.currentState !== 'active' || flow.getSnapshot().phase !== 'entry') return;
    if (flow.submit({ ...entered.current })) clear();
  };
  const progress = snapshot.phase === 'reading' ? ['Checking saved wallet data…', 'Checking saved data']
    : snapshot.phase === 'verifying' ? ['Verifying your wallet…', 'Verifying wallet']
      : snapshot.phase === 'committing' ? ['Changing your password…', 'Changing password']
        : snapshot.phase === 'reopening' ? ['Reopening your wallet securely…', 'Reopening wallet'] : null;
  const inventory = snapshot.inventory?.status === 'needs-matching-phrase-verification' && snapshot.inventory.counts
    ? snapshot.inventory : null;
  const showInventory = snapshot.phase === 'scope' || snapshot.phase === 'review';
  const footer = snapshot.phase === 'scope' ? <>
    <Button title="Continue" disabled={!inventory} onPress={() => {
      if (alive.current && !cancelled.current && AppState.currentState === 'active' && flow.getSnapshot().phase === 'scope') { clear(); flow.enter(); }
    }} />
    <Button title="Back to unlock" variant="secondary" onPress={back} />
  </> : snapshot.phase === 'entry' ? <>
    <Button title="Verify wallet" onPress={submit} />
    <Button title="Back" variant="secondary" onPress={back} />
  </> : snapshot.phase === 'review' ? <>
    <Button title="Change password" onPress={() => {
      if (alive.current && !cancelled.current && AppState.currentState === 'active' && flow.getSnapshot().phase === 'review') { clear(); flow.commit(); }
    }} />
    <Button title="Cancel recovery" variant="secondary" onPress={back} />
  </> : <Button title={snapshot.phase === 'committing' || snapshot.phase === 'reopening' ? 'Leave recovery'
    : snapshot.phase === 'blocked' || snapshot.phase === 'closed' ? 'Back to unlock' : 'Cancel recovery'} variant="secondary" onPress={back} />;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<View style={s.actions}>{footer}</View>}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back}
            style={({ pressed }) => [s.back, pressed && { opacity: 0.65 }]}><Icon name="arrow-left" /></Pressable>
          <NativeText ref={heading} accessibilityRole="header" allowFontScaling style={[styles.text, s.title]}>{titles[snapshot.phase]}</NativeText>
        </View>
        {progress && <View style={s.progress}>
          <ActivityIndicator color={colors.pink} accessibilityLabel={progress[1]} />
          <Text accessibilityLiveRegion="polite" style={s.body}>{progress[0]}</Text>
        </View>}
        {snapshot.phase === 'scope' && <Text style={s.body}>Use the recovery phrase for this wallet to set a new password on this device.</Text>}
        {snapshot.phase === 'review' && <>
          <Notice title="Your phrase matches this saved wallet." body="Only the password for this device will change. Saved accounts, imported-key records, tokens and transaction records will be kept." />
        </>}
        {showInventory && inventory && <Inventory inventory={inventory} details={details} toggle={() => setDetails(!details)} />}
        {showInventory && !inventory && <Notice title="Saved data unavailable" body="Your saved wallet could not be verified for this recovery. Nothing has been reset." tone="amber" />}
        {snapshot.phase === 'entry' && <>
          <Text style={s.body}>Enter your 12 or 24 words in their original order.</Text>
          <Notice title="Keep your phrase private" body="Pali support will never ask for these words." tone="amber" />
          <SecretField name="phrase" label="Matching recovery phrase" value={inputs.phrase} update={update} error={snapshot.fieldErrors.phrase} multiline />
          <Text style={styles.muted}>{inputs.phrase.trim() ? inputs.phrase.trim().split(/\s+/u).length : 0} words entered</Text>
          <Text style={s.body}>{NEW_PASSWORD_HELP}</Text>
          <SecretField name="password" label="New password" value={inputs.password} update={update} error={snapshot.fieldErrors.password} />
          <SecretField name="confirmation" label="Confirm new password" value={inputs.confirmation} update={update} error={snapshot.fieldErrors.confirmation} />
        </>}
        {snapshot.phase === 'committing' && <Text style={s.body}>Leaving now stops this screen. The password change may already have completed.</Text>}
        {snapshot.phase === 'closed' && !snapshot.error && <Text style={s.body}>Returning to unlock…</Text>}
        {snapshot.phase === 'blocked' && !snapshot.error && <Text style={s.body}>Your saved wallet could not be verified for this recovery. Nothing has been reset.</Text>}
        {!!snapshot.error && <NativeText ref={error} allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.text, s.error]}>{snapshot.error}</NativeText>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function SecretField({ name, label, value, update, error, multiline = false }: {
  name: keyof Inputs; label: string; value: string; update(name: keyof Inputs, value: string): void; error?: string; multiline?: boolean;
}) {
  const id = `recovery-${name}`;
  return <View style={s.field}>
    <Text nativeID={`${id}-label`} style={s.label}>{label}</Text>
    <TextInput accessibilityLabel={label} accessibilityHint={error}
      aria-labelledby={error ? `${id}-label ${id}-error` : `${id}-label`}
      value={value} onChangeText={(next) => update(name, next)}
      autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
      importantForAutofill="noExcludeDescendants" textContentType="none"
      secureTextEntry={!multiline} multiline={multiline} contextMenuHidden={false}
      maxLength={multiline ? 4096 : 1024} selectionColor={colors.pink} placeholderTextColor={colors.muted}
      style={[s.input, multiline && s.phraseInput]} />
    {!!error && <Text nativeID={`${id}-error`} accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
  </View>;
}

function Inventory({ inventory, details, toggle }: { inventory: RecoveryInventory; details: boolean; toggle(): void }) {
  const counts = inventory.counts!;
  const rows = [
    ['Seed-derived accounts', counts.hdAccounts], ['Imported keys saved on this device', counts.importedKeys],
    ['Pending transaction records', counts.pendingTransactions],
    ['Tokens and saved activity', `${counts.tokenEntries} tokens · ${counts.historySummaries} saved summaries`],
  ] as const;
  const more = [
    ['Retired seed-derived account records', counts.retiredHdAccounts], ['Retired imported account records', counts.retiredImportedAccounts],
    ['Journal records', counts.journalRecords], ['Terminal transaction records', counts.terminalTransactions],
    ['Cached transactions', counts.cachedTransactions], ['Activity preferences', counts.activityPreferences],
  ] as const;
  return <>
    <Text style={styles.muted}>Observed saved records. These counts describe local data; they are not a complete transaction history.</Text>
    <Card style={s.inventory}>{rows.map(([label, count]) => <View key={label} style={s.inventoryRow}>
      <Text style={s.inventoryLabel}>{label}</Text><Text style={s.count}>{count}</Text>
    </View>)}</Card>
    <Pressable accessibilityRole="button" accessibilityLabel="Saved-data details" accessibilityState={{ expanded: details }} onPress={toggle} style={s.details}>
      <Text style={s.link}>{details ? 'Hide saved-data details' : 'Saved-data details'}</Text>
      <Icon name="chevron-down" color={colors.blue} />
    </Pressable>
    {details && <Card style={s.inventory}>{more.map(([label, count]) => <View key={label} style={s.inventoryRow}>
      <Text style={s.inventoryLabel}>{label}</Text><Text style={s.count}>{count}</Text>
    </View>)}</Card>}
    <Text style={styles.muted}>Existing recovery phrase backup: {inventory.backup === 'confirmed' ? 'confirmed' : inventory.backup === 'unconfirmed' ? 'not confirmed' : 'unknown'}. Recovery does not change this saved status.</Text>
    <Notice title="Imported keys still need separate backups" body="Imported-key records already saved on this device will be kept. The recovery phrase alone cannot recreate imported accounts on a new or lost device. Keep their original keys backed up separately." tone="amber" />
    <Text style={styles.muted}>Private notes are not supported by this recovery.</Text>
  </>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  title: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 },
  actions: { gap: 10 }, body: { fontSize: 16, lineHeight: 25 }, progress: { gap: 15, alignItems: 'center', paddingVertical: 18 },
  field: { gap: 9 }, label: { fontSize: 15, lineHeight: 22, color: colors.muted, fontWeight: '600' },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 17, minHeight: 56, fontSize: 16 },
  phraseInput: { minHeight: 144, textAlignVertical: 'top' }, error: { color: colors.red, fontSize: 15, lineHeight: 23 },
  inventory: { padding: 18, gap: 16 }, inventoryRow: { gap: 5 }, inventoryLabel: { fontSize: 14, lineHeight: 21, color: colors.muted },
  count: { fontSize: 18, lineHeight: 25, fontWeight: '600' }, details: { minHeight: 48, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  link: { flex: 1, color: colors.blue, fontSize: 15, lineHeight: 23, fontWeight: '600' },
});
