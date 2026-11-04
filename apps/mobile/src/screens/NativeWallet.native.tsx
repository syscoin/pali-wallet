import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { createNativeWalletControllers } from '../platform/nativeFactory';
import { ensurePrivacyShield } from '../platform/privacyShield.native';
import type { CustodySnapshot } from '../custody/types';
import type { SeedBackupPresentation } from '../custody/seedBackup';
import { Button, colors, Header, Notice, PaliMark, Screen, styles, Text } from '../ui';
import { NativePortfolio } from './NativePortfolio';
import { NativeSend } from './NativeSend';
import { NativeCustodyFeedback } from './NativeCustodyFeedback';
import { NativeNetworks } from './NativeNetworks';
import { createNativeNetworkView, type NativeNetworkView } from '../custody/networkView';
import { nativeSigningEnabled, type EvmNetworkId } from '../custody/networkContext';
import { NativeAccounts } from './NativeAccounts';
import { NativeActivityScreen } from './NativeActivity';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue';
import type { PublicCustodySource } from '../portfolio/nativePortfolio';
import type { Erc20Metadata } from '../../../../source/shared/erc20';

type Controllers = ReturnType<typeof createNativeWalletControllers>;
type Stage = 'choose' | 'create' | 'import' | 'backup-auth' | 'words' | 'challenge' | 'send' | 'accounts' | 'networks' | 'activity';
const INITIAL: CustodySnapshot = { phase: 'opening', revision: 0, presence: 'unknown', backup: 'unknown', account: null, error: null };

function message(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_CREDENTIAL') return 'That password is incorrect. Please try again.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect passwords. Wait a few minutes before trying again.';
  if (code === 'BACKUP_WORDS_MISMATCH') return 'Those words do not match. Check your written backup.';
  if (code === 'INVALID_INPUT') return 'Check your recovery phrase and password.';
  if (code === 'CANCELLED' || code === 'BACKUP_EXPIRED') return 'Your session was locked. Unlock to continue.';
  return 'This operation could not be completed. Your saved wallet has been preserved.';
}

function SecretInput({ label, value, onChange, multiline = false, disabled = false }: {
  label: string; value: string; onChange(value: string): void; multiline?: boolean; disabled?: boolean;
}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput
    accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled}
    autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
    importantForAutofill="noExcludeDescendants" textContentType="none"
    secureTextEntry={!multiline} multiline={multiline} contextMenuHidden={false}
    maxLength={multiline ? 4096 : 1024} selectionColor={colors.pink}
    placeholderTextColor={colors.muted} style={[s.input, multiline && s.phraseInput]}
  /></View>;
}

export function NativeWalletScreen({ onExit }: { onExit(): void }) {
  const controllers = useRef<Controllers | null>(null);
  const [publicSource, setPublicSource] = useState<PublicCustodySource | null>(null);
  const [accountView, setAccountView] = useState<Controllers['accounts'] | null>(null);
  const [networkView, setNetworkView] = useState<NativeNetworkView<EvmNetworkId> | null>(null);
  const [catalogue, setCatalogue] = useState<NativeWalletCatalogueSnapshot | null>(null);
  const [transferView, setTransferView] = useState<Controllers['transfers'] | null>(null);
  const [tokenView, setTokenView] = useState<Controllers['tokens'] | null>(null);
  const [activityView, setActivityView] = useState<Controllers['activity'] | null>(null);
  const [sendToken, setSendToken] = useState<Erc20Metadata | null>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const submitting = useRef(false);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [protectedScreen, setProtectedScreen] = useState(false);
  const [stage, setStage] = useState<Stage>('choose');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [phrase, setPhrase] = useState('');
  const [presentation, setPresentation] = useState<SeedBackupPresentation | null>(null);
  const [answers, setAnswers] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clearSecrets = useCallback(() => {
    setPassword(''); setConfirmation(''); setPhrase(''); setPresentation(null); setAnswers(['', '', '']);
  }, []);
  const revoke = useCallback(() => {
    epoch.current++;
    controllers.current?.backup.cancel(); controllers.current?.authority.lock();
    Keyboard.dismiss(); clearSecrets(); setSendToken(null); setStage('choose'); setError('');
  }, [clearSecrets]);
  const exit = useCallback(() => { revoke(); onExit(); }, [onExit, revoke]);
  const latestExit = useRef(exit);
  useLayoutEffect(() => { latestExit.current = exit; }, [exit]);

  useEffect(() => {
    const lifecycleEpoch = epoch;
    mounted.current = true;
    const local = createNativeWalletControllers(); controllers.current = local;
    const networks = createNativeNetworkView(local.authority);
    const publicView: PublicCustodySource = Object.freeze({
      getSnapshot: () => local.authority.getSnapshot(),
      subscribe: (listener: Parameters<PublicCustodySource['subscribe']>[0]) => local.authority.subscribe(listener),
    });
    const unsubscribe = local.authority.subscribe((state) => {
      if (!mounted.current || controllers.current !== local) return;
      setSnapshot(state); setPublicSource(publicView); setTransferView(local.transfers); setTokenView(local.tokens); setActivityView(local.activity); setNetworkView(networks);
      setCatalogue(local.authority.getCatalogue());
      setAccountView(local.authority.supportsAccountManagement() ? local.accounts : null);
      if (!['ready', 'backup-required', 'authenticating'].includes(state.phase)) clearSecrets();
    });
    const clear = local.backup.onClear(() => { setPresentation(null); setAnswers(['', '', '']); });
    void (async () => {
      try {
        await ensurePrivacyShield();
        if (!mounted.current || controllers.current !== local) return;
        setProtectedScreen(true);
        await local.authority.initialize();
      } catch { if (mounted.current && controllers.current === local) setError('Secure wallet storage is unavailable. Close and reopen Pali to try again.'); }
    })();
    const lifecycle = AppState.addEventListener('change', (state) => { if (state !== 'active') revoke(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', revoke) : null;
    return () => {
      mounted.current = false; lifecycleEpoch.current++; unsubscribe(); clear(); lifecycle.remove(); blur?.remove();
      local.disposeTokens(); local.disposeTransfers(); local.backup.dispose(); local.authority.lock(); void local.authority.dispose().catch(() => undefined);
      if (controllers.current === local) controllers.current = null;
    };
  }, [clearSecrets, revoke]);

  // Keep listener order stable so Receive can consume Back before wallet exit.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { latestExit.current(); return true; });
    return () => sub.remove();
  }, []);

  const perform = async (action: (local: Controllers) => Promise<void>) => {
    if (submitting.current || !protectedScreen || AppState.currentState !== 'active') return;
    const local = controllers.current; if (!local) return;
    const captured = epoch.current;
    submitting.current = true; setBusy(true); setError('');
    try { await action(local); }
    catch (cause) { if (mounted.current && epoch.current === captured) setError(message(cause)); }
    finally {
      submitting.current = false;
      if (mounted.current) { setBusy(false); setPassword(''); setConfirmation(''); setPhrase(''); }
    }
  };

  const createOrImport = () => {
    if (password !== confirmation) { setError('Your passwords do not match.'); return; }
    if (!password.isWellFormed() || [...password].length < 12 || new TextEncoder().encode(password).length > 1024) {
      setError('Use a password with at least 12 characters.'); return;
    }
    const enteredPassword = password; const enteredPhrase = phrase; const importing = stage === 'import';
    clearSecrets();
    void perform(async ({ authority }) => {
      if (importing) await authority.importPhrase(enteredPhrase, enteredPassword);
      else await authority.create(enteredPassword);
      if (['ready', 'backup-required'].includes(authority.getSnapshot().phase)) setStage('backup-auth');
    });
  };

  const locked = snapshot.phase === 'locked';
  const unavailable = snapshot.phase === 'unavailable' || !!error && !protectedScreen;
  const title = locked ? 'Welcome back' : snapshot.phase === 'ready' && stage === 'choose' ? 'Your wallet' :
    stage === 'words' ? 'Your recovery phrase' : stage === 'challenge' ? 'Check your backup' :
    stage === 'backup-auth' ? 'Back up your wallet' : stage === 'import' ? 'Restore your wallet' : stage === 'create' ? 'Protect your wallet' : 'Make it yours';
  const accountLabel = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId)?.label ?? 'Account 1';
  if (stage === 'accounts' && accountView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeAccounts controller={accountView} onBack={() => setStage('choose')} />;
  if (stage === 'networks' && networkView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeNetworks controller={networkView} onBack={() => setStage('choose')} />;
  if (stage === 'activity' && activityView && snapshot.phase === 'ready')
    return <NativeActivityScreen controller={activityView} accountLabel={accountLabel} onBack={() => setStage('choose')} />;
  let body: React.ReactNode;
  if (unavailable) body = <Notice title="Wallet unavailable" body="Your saved wallet has been preserved. Close and reopen Pali to try again." tone="amber" />;
  else if (!protectedScreen || snapshot.phase === 'opening') body = <View style={s.center}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Opening your wallet securely…</Text></View>;
  else if (snapshot.phase === 'authenticating') body = <View style={s.center}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Unlocking your wallet securely…</Text></View>;
  else if (locked) body = <>
    <Text style={styles.muted}>Enter your password to unlock this device.</Text>
    <SecretInput label="Password" value={password} onChange={setPassword} disabled={busy} />
    <Button title="Unlock wallet" disabled={busy || !password} onPress={() => {
      const entered = password; setPassword(''); void perform(async ({ authority }) => {
        await authority.unlock(entered); setStage(authority.getSnapshot().backup === 'confirmed' ? 'choose' : 'backup-auth');
      });
    }} />
  </>;
  else if (snapshot.phase === 'empty' && stage === 'choose') body = <>
    <PaliMark size={72} /><Text style={styles.h1}>A wallet that stays yours.</Text>
    <Text style={styles.muted}>Create a recovery phrase, or bring one you already own.</Text>
    <Button title="Create a wallet" onPress={() => setStage('create')} />
    <Button title="I have a recovery phrase" variant="secondary" onPress={() => setStage('import')} />
  </>;
  else if (snapshot.phase === 'empty') body = <>
    {stage === 'import' && <SecretInput label="Recovery phrase" multiline value={phrase} onChange={setPhrase} disabled={busy} />}
    <Text style={styles.muted}>{stage === 'import' ? 'Enter your 12 or 24 words in order.' : 'Pali will create a new 12-word recovery phrase.'} Choose a unique password with at least 12 characters.</Text>
    <SecretInput label="New password" value={password} onChange={setPassword} disabled={busy} />
    <SecretInput label="Confirm password" value={confirmation} onChange={setConfirmation} disabled={busy} />
    <Notice title="Your password stays on this device" body="Your recovery phrase can restore your wallet without this password. Keep it private and backed up offline." />
    <Button title={stage === 'import' ? 'Restore wallet' : 'Create wallet'} disabled={busy || !password || !confirmation || stage === 'import' && !phrase} onPress={createOrImport} />
  </>;
  else if (stage === 'words' && presentation) body = <>
    <Notice title="Write these words down in order" body="Anyone with these words can control your wallet. Keep them offline. Pali support will never ask for them." tone="amber" />
    <View style={s.wordGrid}>{presentation.words.map((word, index) => <View key={index} style={s.word}><Text style={s.wordNumber}>{index + 1}</Text><Text style={s.wordText}>{word}</Text></View>)}</View>
    <Button title="I've written them down" onPress={() => setStage('challenge')} />
  </>;
  else if (stage === 'challenge' && presentation) body = <>
    <Text style={styles.muted}>Use your written backup to fill in these words.</Text>
    {presentation.positions.map((position, index) => <SecretInput key={position} label={`Word ${position + 1}`} value={answers[index]!} disabled={busy} onChange={(value) => setAnswers((old) => old.map((answer, i) => i === index ? value : answer))} />)}
    <Button title="Confirm backup" disabled={busy || answers.some((answer) => !answer.trim())} onPress={() => {
      const id = presentation.id; const entered = [...answers];
      void perform(async ({ authority, backup }) => { await backup.confirm(id, entered); if (authority.getSnapshot().phase === 'ready') { clearSecrets(); setStage('choose'); } });
    }} />
  </>;
  else if (snapshot.phase === 'backup-required' || stage === 'backup-auth' || stage === 'words' || stage === 'challenge') body = <>
    <Text style={styles.muted}>A written recovery phrase is the only way to restore this wallet if you lose your phone.</Text>
    <SecretInput label="Confirm your password" value={password} onChange={setPassword} disabled={busy} />
    <Button title="Show recovery phrase" disabled={busy || !password} onPress={() => {
      const entered = password; setPassword('');
      void perform(async ({ backup, authority }) => {
        const shown = await backup.begin(entered);
        if (AppState.currentState === 'active' && ['ready', 'backup-required'].includes(authority.getSnapshot().phase)) { setPresentation(shown); setStage('words'); }
      });
    }} />
    <Button title="Lock wallet" variant="quiet" onPress={revoke} />
  </>;
  else if (snapshot.phase === 'ready' && stage === 'send' && transferView && snapshot.account && nativeSigningEnabled(snapshot.account.network)) return <NativeSend controller={transferView} token={sendToken ?? undefined} accountLabel={accountLabel} onBack={() => { setSendToken(null); setStage('choose'); }} />;
  else if (snapshot.phase === 'ready' && publicSource) return <NativePortfolio
    tokenView={tokenView ?? undefined}
    source={publicSource} accountLabel={accountLabel} onManageAccounts={accountView ? () => setStage('accounts') : undefined} onExit={exit} onLock={revoke}
    onSend={snapshot.account && nativeSigningEnabled(snapshot.account.network) ? () => { setSendToken(null); setStage('send'); } : undefined}
    onSendToken={snapshot.account?.network === 'ethereum' ? (token) => { setSendToken(token); setStage('send'); } : undefined}
    onManageNetworks={networkView ? () => setStage('networks') : undefined}
    onViewRecovery={() => setStage('backup-auth')}
    onActivity={snapshot.account?.network === 'ethereum' ? () => setStage('activity') : undefined}
  />;
  else body = <Notice title="Wallet unavailable" body="Close and reopen Pali to try again." tone="amber" />;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen><Header title={title} onBack={exit} subtitle="Development build · Use a test wallet" />
      {body}
      {snapshot.error && <NativeCustodyFeedback error={snapshot.error} />}
      {busy && <ActivityIndicator accessibilityLabel="Working" color={colors.pink} />}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    </Screen>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  field: { gap: 10 }, label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.8 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 17, minHeight: 56, fontSize: 16 },
  phraseInput: { minHeight: 120, textAlignVertical: 'top', lineHeight: 26 }, center: { gap: 18, alignItems: 'center', paddingVertical: 50 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, word: { width: '47%', borderRadius: 14, backgroundColor: colors.surface, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordNumber: { color: colors.muted, fontSize: 12, minWidth: 18 }, wordText: { fontSize: 16, fontWeight: '600' },
  address: { fontSize: 15, lineHeight: 24, marginTop: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
