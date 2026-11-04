import { walletFetch } from '../platform/http';
import { nativeAccountSelection } from '../core/accountDirectory';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { createNativeRecoveryCoordinator, createNativeWalletControllers } from '../platform/nativeFactory';
import { NativeControllerLifecycle } from '../custody/nativeControllerLifecycle';
import { NativeRecoveryFlow, type RecoveryOutcome } from '../custody/recoveryFlow';
import { NativeRecovery } from './NativeRecovery';
import { ensurePrivacyShield } from '../platform/privacyShield.native';
import type { CustodySnapshot } from '../custody/types';
import type { SeedBackupPresentation } from '../custody/seedBackup';
import { Button, colors, Header, Notice, PaliMark, Screen, styles, Text } from '../ui';
import { NativePortfolio } from './NativePortfolio';
import { NativeSend } from './NativeSend';
import { NativeSecurity } from './NativeSecurity';
import { NativeImport } from './NativeImport';
import type { NativeImportView } from '../custody/importedAccounts';
import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks';
import { NativeCustodyFeedback } from './NativeCustodyFeedback';
import { NativeNetworks } from './NativeNetworks';
import { createNativeNetworkView, type NativeNetworkView } from '../custody/networkView';
import { erc20SigningEnabled, getNativeSendContext, nativeSigningEnabled, type EvmNetworkId } from '../custody/networkContext';
import { NativeAccounts } from './NativeAccounts';
import { WalletAccounts, type WatchWalletBridge } from './WalletAccounts';
import { NativeActivityScreen } from './NativeActivity';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue';
import type { PublicCustodySource } from '../portfolio/nativePortfolio';
import type { Erc20Metadata } from '../../../../source/shared/erc20';
import { RealAppShell, UnavailableActivity, type RealTab } from './RealAppShell';
import { RealTools } from './RealTools';
import { RealSettings } from './RealSettings';
import { useRealShell } from './useRealShell';

type Controllers = ReturnType<typeof createNativeWalletControllers>;
const nativeLifecycle = new NativeControllerLifecycle({ create: createNativeWalletControllers, protect: ensurePrivacyShield, recovery: createNativeRecoveryCoordinator });
// Nonsecret operation outcome survives route departure while cleanup is pending.
let savedRecoveryOutcome: RecoveryOutcome | null = null;
type RootOrigin = Readonly<{ tab: RealTab; context: string; identity: string; epoch: number }>;
type Stage = 'choose' | 'create' | 'import' | 'backup-auth' | 'words' | 'challenge' | 'send' | 'accounts' | 'manage-hd' | 'networks' | 'security' | 'import-key' | 'recovery';
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

export type NativeWalletProps = { onExit(): void; accounts?: WatchWalletBridge; initialAccountId?: string; onSelectedNative?(id: string): void };

export function NativeWalletScreen({ onExit, accounts, initialAccountId, onSelectedNative }: NativeWalletProps) {
  const bridge = useRef(accounts);
  const selectedNative = useRef(onSelectedNative);
  useLayoutEffect(() => { bridge.current = accounts; selectedNative.current = onSelectedNative; }, [accounts, onSelectedNative]);
  const requestedAccount = useRef(initialAccountId);
  const controllers = useRef<Controllers | null>(null);
  const screenToken = useRef<object>({});
  const detachSubscriptions = useRef<() => void>(() => undefined);
  const recoveryRef = useRef<NativeRecoveryFlow | null>(null);
  const [recoveryFlow, setRecoveryFlow] = useState<NativeRecoveryFlow | null>(null);
  const [recoveryOutcome, setRecoveryOutcome] = useState<RecoveryOutcome | null>(savedRecoveryOutcome);
  const [publicSource, setPublicSource] = useState<PublicCustodySource | null>(null);
  const [balanceReader, setBalanceReader] = useState<Controllers['balanceReader'] | null>(null);
  const [accountView, setAccountView] = useState<Controllers['accounts'] | null>(null);
  const [networkView, setNetworkView] = useState<NativeNetworkView<EvmNetworkId> | null>(null);
  const [catalogue, setCatalogue] = useState<NativeWalletCatalogueSnapshot | null>(null);
  const [transferView, setTransferView] = useState<Controllers['transfers'] | null>(null);
  const [tokenView, setTokenView] = useState<Controllers['tokens'] | null>(null);
  const [keyExportView, setKeyExportView] = useState<Controllers['keyExport'] | null>(null);
  const [activityView, setActivityView] = useState<Controllers['activity'] | null>(null);
  const [importScope, setImportScope] = useState<{ contextRevision: number; catalogueRevision: number; networkLabel: string; token: number; imports: NativeImportView } | null>(null);
  const importRequest = useRef({ token: 0, active: false });
  const [importActiveToken, setImportActiveToken] = useState<number | null>(null);
  const [sendToken, setSendToken] = useState<Erc20Metadata | null>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const submitting = useRef(false);
  const feedbackRequest = useRef(0);
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
  const rootOrigin = useRef<RootOrigin | null>(null);

  const clearSecrets = useCallback(() => {
    setPassword(''); setConfirmation(''); setPhrase(''); setPresentation(null); setAnswers(['', '', '']);
  }, []);
  const revoke = useCallback(() => {
    epoch.current++;
    recoveryRef.current?.cancel();
    rootOrigin.current = null;
    importRequest.current.active = false; setImportActiveToken(null); setImportScope(null);
    controllers.current?.keyExport.cancel(); controllers.current?.backup.cancel(); controllers.current?.authority.lock();
    Keyboard.dismiss(); clearSecrets(); setSendToken(null); if (!recoveryRef.current) setStage('choose'); setError('');
  }, [clearSecrets]);
  const exit = useCallback(() => { revoke(); onExit(); }, [onExit, revoke]);
  const readyContext = useCallback(() => {
    const local = controllers.current, state = local?.authority.getSnapshot(), current = local?.authority.getCatalogue();
    return state?.phase === 'ready' && state.account && current
      ? { context: `${state.revision}:${current.active.accountId}:${state.account.network}`, identity: `${current.active.accountId}:${state.account.network}` } : null;
  }, []);
  const currentShellScope = () => stage === 'choose' ? readyContext()?.context ?? null : null;
  const shellIdentity = stage === 'choose' && snapshot.phase === 'ready' && snapshot.account && catalogue
    ? `${catalogue.active.accountId}:${snapshot.account.network}` : null;
  const shell = useRealShell(shellIdentity, currentShellScope, exit);
  const openStage = (next: Stage) => {
    const current = readyContext();
    if (stage !== 'choose' || AppState.currentState !== 'active' || !current) return;
    rootOrigin.current = { tab: shell.tab, ...current, epoch: epoch.current };
    setStage(next);
  };
  const closeStage = () => {
    const origin = rootOrigin.current; rootOrigin.current = null;
    const current = readyContext();
    setStage('choose');
    if (origin && current && AppState.currentState === 'active' && origin.context === current.context && origin.identity === current.identity && origin.epoch === epoch.current)
      shell.restoreRoot(origin.tab, origin.identity);
  };
  const latestBack = useRef<() => boolean>(() => true);
  useLayoutEffect(() => {
    latestBack.current = () => {
      // Full-screen leaf flows own their Back behavior regardless of listener order.
      if (stage === 'recovery' || stage === 'accounts' && accounts && snapshot.phase !== 'authenticating' ||
          stage === 'manage-hd' && accountView && ['ready', 'authenticating'].includes(snapshot.phase) ||
          stage === 'networks' && networkView && ['ready', 'authenticating'].includes(snapshot.phase) ||
          stage === 'security' && snapshot.phase === 'ready' && catalogue && snapshot.account && keyExportView ||
          stage === 'send' && snapshot.phase === 'ready' && transferView && snapshot.account && nativeSigningEnabled(snapshot.account.network) ||
          stage === 'import-key' && importScope && ['ready', 'authenticating'].includes(snapshot.phase) &&
            (snapshot.revision === importScope.contextRevision || importActiveToken === importScope.token && snapshot.revision === importScope.contextRevision + 1)) return false;
      if (snapshot.phase === 'ready' && stage === 'choose') shell.goBack(); else exit();
      return true;
    };
  });

  const clearOwnerView = useCallback(() => {
    detachSubscriptions.current(); detachSubscriptions.current = () => undefined;
    controllers.current = null;
    setPublicSource(null); setBalanceReader(null); setAccountView(null); setNetworkView(null);
    setCatalogue(null); setTransferView(null); setTokenView(null); setKeyExportView(null); setActivityView(null);
    bridge.current?.onNativeCatalogue(null);
  }, []);
  const attach = useCallback((local: Controllers) => {
    detachSubscriptions.current(); controllers.current = local;
    const networks = createNativeNetworkView(local.authority, { fetch: walletFetch });
    const publicView: PublicCustodySource = Object.freeze({
      getSnapshot: () => local.authority.getSnapshot(),
      getCatalogue: () => local.authority.getCatalogue(),
      subscribe: (listener: Parameters<PublicCustodySource['subscribe']>[0]) => local.authority.subscribe(listener),
    });
    const update = (state: CustodySnapshot) => {
      if (!mounted.current || controllers.current !== local) return;
      setSnapshot(state); setPublicSource(publicView); setBalanceReader(local.balanceReader); setTransferView(local.transfers); setTokenView(local.tokens); setActivityView(local.activity); setKeyExportView(local.keyExport); setNetworkView(networks);
      const nextCatalogue = local.authority.getCatalogue();
      setCatalogue(nextCatalogue); bridge.current?.onNativeCatalogue(nextCatalogue);
      if (nextCatalogue) selectedNative.current?.(nextCatalogue.active.accountId);
      setAccountView(local.authority.supportsAccountManagement() ? local.accounts : null);
      if (['locked', 'unavailable', 'disposed'].includes(state.phase)) rootOrigin.current = null;
      if (!['ready', 'backup-required', 'authenticating'].includes(state.phase)) clearSecrets();
    };
    const unsubscribe = local.authority.subscribe(update);
    update(local.authority.getSnapshot());
    const clear = local.backup.onClear(() => { setPresentation(null); setAnswers(['', '', '']); });
    detachSubscriptions.current = () => { unsubscribe(); clear(); };
    setProtectedScreen(true);
  }, [clearSecrets]);
  const install = useCallback(async () => {
    try {
      const local = await nativeLifecycle.acquire(screenToken.current, () => mounted.current && AppState.currentState === 'active');
      if (local && mounted.current && nativeLifecycle.current(screenToken.current) === local) attach(local);
    } catch {
      if (mounted.current) { setProtectedScreen(false); setError('Secure wallet storage is unavailable. Close and reopen Pali to try again.'); }
      throw new Error('REOPEN_REQUIRED');
    }
  }, [attach]);
  useEffect(() => {
    const lifecycleEpoch = epoch, ownedToken = screenToken.current;
    mounted.current = true;
    void install().catch(() => undefined);
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') revoke();
      else if (!controllers.current && !recoveryRef.current) void install().catch(() => undefined);
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', revoke) : null;
    return () => {
      mounted.current = false; lifecycleEpoch.current++; recoveryRef.current?.cancel();
      detachSubscriptions.current(); detachSubscriptions.current = () => undefined;
      bridge.current?.onNativeCatalogue(null); controllers.current = null;
      lifecycle.remove(); blur?.remove();
      void nativeLifecycle.release(ownedToken).catch(() => undefined);
    };
  }, [install, revoke]);

  const openRecovery = () => {
    const local = controllers.current;
    if (!local || recoveryRef.current || submitting.current || !protectedScreen || AppState.currentState !== 'active' ||
        local.authority.getSnapshot().phase !== 'locked' || nativeLifecycle.current(screenToken.current) !== local) return;
    rootOrigin.current = null; requestedAccount.current = undefined; feedbackRequest.current++;
    clearSecrets(); setError(''); setSendToken(null); const captured = ++epoch.current;
    let flow!: NativeRecoveryFlow, recoveryStarted = false;
    flow = new NativeRecoveryFlow({
      readInventory: () => local.readRecoveryInventory(),
      createCoordinator: () => { recoveryStarted = true; return nativeLifecycle.startRecovery(screenToken.current, local); },
      isCurrent: () => mounted.current && recoveryRef.current === flow && controllers.current === local && epoch.current === captured && AppState.currentState === 'active',
      leave: exit,
      finish: async (outcome) => {
        savedRecoveryOutcome = outcome;
        const retired = recoveryStarted || nativeLifecycle.hasRecovery(screenToken.current);
        // Install the process-wide drain before rendering or invoking the bridge.
        const draining = retired ? nativeLifecycle.release(screenToken.current, outcome.cleanupFailed === true) : null;
        if (mounted.current) setRecoveryOutcome(outcome);
        try {
          if (retired) {
            clearOwnerView(); setSnapshot(INITIAL); setProtectedScreen(false);
            await draining;
          }
          if (mounted.current && recoveryRef.current === flow) {
            if (retired && AppState.currentState === 'active') await install();
            recoveryRef.current = null; setRecoveryFlow(null); setStage('choose');
          }
        } catch {
          const failed = Object.freeze({ ...outcome, cleanupFailed: true }); savedRecoveryOutcome = failed;
          if (mounted.current) { setRecoveryOutcome(failed); recoveryRef.current = null; setRecoveryFlow(null); setStage('choose'); }
          throw new Error('REOPEN_REQUIRED');
        }
      },
    });
    recoveryRef.current = flow; setRecoveryFlow(flow); setStage('recovery');
  };

  // Keep listener order stable so Receive can consume Back before wallet exit.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => latestBack.current());
    return () => sub.remove();
  }, []);

  const perform = async (action: (local: Controllers) => Promise<void>) => {
    if (submitting.current || !protectedScreen || AppState.currentState !== 'active') return;
    const local = controllers.current; if (!local) return;
    const captured = epoch.current;
    feedbackRequest.current++;
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

  const openImport = () => {
    const local = controllers.current;
    const context = local?.authority.getSnapshot();
    const current = local?.authority.getCatalogue();
    if (!local?.imports || !context?.account || context.phase !== 'ready' || !current) return;
    const token = ++importRequest.current.token;
    importRequest.current.active = false; setImportActiveToken(null);
    local.keyExport.cancel(); local.backup.cancel(); setError('');
    const scoped: NativeImportView = Object.freeze({
      submit: (...args: Parameters<NativeImportView['submit']>) => local.imports.submit(...args),
      cancel: () => {
        const now = local.authority.getSnapshot();
        if (controllers.current === local && importRequest.current.token === token && importRequest.current.active &&
            now.phase === 'authenticating' && now.revision === context.revision + 1) local.imports.cancel();
      },
    });
    setImportScope({ contextRevision: context.revision, catalogueRevision: current.revision,
      networkLabel: getNativeSendContext(context.account!.network, current.networks).name, token, imports: scoped });
    setStage('import-key');
  };
  const locked = snapshot.phase === 'locked';
  const unavailable = snapshot.phase === 'unavailable' || !!error && !protectedScreen;
  const title = locked ? 'Welcome back' : snapshot.phase === 'ready' && stage === 'choose' ? 'Your wallet' :
    stage === 'words' ? 'Your recovery phrase' : stage === 'challenge' ? 'Check your backup' :
    stage === 'backup-auth' ? 'Back up your wallet' : stage === 'import' ? 'Restore your wallet' : stage === 'create' ? 'Protect your wallet' : 'Make it yours';
  const accountLabel = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId)?.label ?? 'Account 1';
  const selectWatch = (selection: import('../core/accountDirectory').AccountSelection) => {
    if (selection.kind !== 'watch') return;
    // Revoke credentials, reviews, transfer work and secret presentation before routing.
    revoke();
    bridge.current?.onSelectWatch(selection);
  };
  if (stage === 'recovery' && recoveryFlow) return <NativeRecovery flow={recoveryFlow} />;
  if (stage === 'accounts' && accounts && snapshot.phase !== 'authenticating')
    return <WalletAccounts {...accounts} catalogue={catalogue} active={catalogue ? nativeAccountSelection(catalogue.active.accountId) : null}
      onBack={closeStage} onSelect={async (selection) => {
        if (selection.kind === 'watch') { selectWatch(selection); return; }
        if (snapshot.phase === 'ready' && accountView && catalogue && selection.id !== catalogue.active.accountId)
          await accountView.execute({ kind: 'select', id: selection.id }, accountView.getContextRevision(), catalogue.revision);
        setStage('choose');
      }} onManageHd={snapshot.phase === 'ready' && accountView ? () => setStage('manage-hd') : undefined}
      onAdd={async (input) => { revoke(); setStage('accounts'); await accounts.onAdd(input); }} />;
  if (stage === 'manage-hd' && accountView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeAccounts controller={accountView} onImport={openImport} onBack={() => setStage(accounts ? 'accounts' : 'choose')} />;
  if (stage === 'import-key' && importScope && ['ready', 'authenticating'].includes(snapshot.phase) &&
      (snapshot.revision === importScope.contextRevision || importActiveToken === importScope.token && snapshot.revision === importScope.contextRevision + 1))
    return <NativeImport key={`${importScope.token}:${importScope.contextRevision}:${importScope.catalogueRevision}`} imports={importScope.imports} contextRevision={importScope.contextRevision} catalogueRevision={importScope.catalogueRevision}
      networkLabel={importScope.networkLabel}
      onSubmitStart={() => { if (mounted.current && importRequest.current.token === importScope.token) { importRequest.current.active = true; setImportActiveToken(importScope.token); } }}
      onSubmitEnd={() => { if (importRequest.current.token === importScope.token) importRequest.current.active = false; if (mounted.current) setImportActiveToken((value) => value === importScope.token ? null : value); }}
      onBack={() => { setImportScope(null); setStage('manage-hd'); }}
      onImported={() => {
        const local = controllers.current, now = local?.authority.getSnapshot(), current = local?.authority.getCatalogue();
        if (mounted.current && importRequest.current.token === importScope.token && now?.phase === 'ready' &&
            now.revision === importScope.contextRevision + 1 && current?.accounts.some((account) => account.id === current.active.accountId && account.type === 'Imported')) {
          rootOrigin.current = null; setImportScope(null); setStage('choose');
        }
      }} />;
  if (stage === 'networks' && networkView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeNetworks controller={networkView} onBack={closeStage} />;
  if (stage === 'security' && snapshot.phase === 'ready' && catalogue && snapshot.account && keyExportView)
    return <NativeSecurity key={`${snapshot.revision}:${catalogue.active.accountId}:${snapshot.account.network}`}
      keyExport={keyExportView} accountId={catalogue.active.accountId} accountType={catalogue.accounts.find((account) => account.id === catalogue.active.accountId)!.type} accountLabel={accountLabel} address={snapshot.account.address}
      onBack={closeStage} onLock={revoke} onViewRecovery={() => setStage('backup-auth')}
      captureFailureHandler={() => {
        const local = controllers.current;
        const context = local?.authority.getSnapshot();
        const capturedEpoch = epoch.current;
        const request = ++feedbackRequest.current;
        return (cause) => {
          const code = cause instanceof Error ? cause.message : '';
          if (!local || !context || context.phase !== 'ready' || !context.account ||
              !mounted.current || controllers.current !== local || epoch.current !== capturedEpoch || feedbackRequest.current !== request ||
              (code !== 'INVALID_CREDENTIAL' && code !== 'AUTH_THROTTLED')) return;
          const current = local.authority.getSnapshot();
          // Only this request's own failure lock may publish feedback. A new
          // unlock, explicit lock, account/network change or departure revokes it.
          if (current.phase === 'locked' && current.revision === context.revision + 1 && current.error === null)
            setError(message(cause));
        };
      }} />;
  let body: React.ReactNode;
  if (unavailable) body = <Notice title="Wallet unavailable" body="Your saved wallet has been preserved. Close and reopen Pali to try again." tone="amber" />;
  else if (!protectedScreen || snapshot.phase === 'opening') body = <View style={s.center}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Opening your wallet securely…</Text></View>;
  else if (snapshot.phase === 'authenticating') body = <View style={s.center}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Unlocking your wallet securely…</Text></View>;
  else if (locked) body = <>
    <Text style={styles.muted}>Enter your password to unlock this device.</Text>
    <SecretInput label="Password" value={password} onChange={setPassword} disabled={busy} />
    <Button title="Unlock wallet" disabled={busy || !password} onPress={() => {
      const entered = password; setPassword(''); void perform(async ({ authority }) => {
        await authority.unlock(entered);
        const requested = requestedAccount.current; const current = authority.getCatalogue();
        // Consume the hint once authenticated, even if backup must finish first.
        // Later unlocks use the native catalogue's durable active selection.
        if (['ready', 'backup-required'].includes(authority.getSnapshot().phase)) {
          requestedAccount.current = undefined;
          savedRecoveryOutcome = null; setRecoveryOutcome(null);
        }
        if (requested && current && authority.getSnapshot().phase === 'ready' && current.active.accountId !== requested && current.accounts.some((entry) => entry.id === requested)) {
          await controllers.current!.accounts.execute({ kind: 'select', id: requested }, authority.getSnapshot().revision, current.revision);
        }
        if (authority.getSnapshot().phase === 'ready' || authority.getSnapshot().phase === 'backup-required')
          setStage(authority.getSnapshot().backup === 'confirmed' ? 'choose' : 'backup-auth');
      });
    }} />
    <Button title="Forgot password?" variant="quiet" disabled={busy} onPress={openRecovery} />
    {accounts && !busy && <Button title="View watch accounts" variant="secondary" onPress={() => { revoke(); setStage('accounts'); }} />}
  </>;
  else if (snapshot.phase === 'empty' && stage === 'choose') body = <>
    <PaliMark size={72} /><Text style={styles.h1}>A wallet that stays yours.</Text>
    <Text style={styles.muted}>Create a recovery phrase, or bring one you already own.</Text>
    <Button title="Create a wallet" onPress={() => setStage('create')} />
    <Button title="I have a recovery phrase" variant="secondary" onPress={() => setStage('import')} />
    {accounts && <Button title="View watch accounts" variant="quiet" onPress={() => setStage('accounts')} />}
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
      void perform(async ({ authority, backup }) => { await backup.confirm(id, entered); if (authority.getSnapshot().phase === 'ready') { clearSecrets(); closeStage(); } });
    }} />
  </>;
  else if (snapshot.phase === 'backup-required' || stage === 'backup-auth' || stage === 'words' || stage === 'challenge') body = <>
    <Text style={styles.muted}>Your recovery phrase restores this wallet’s derived accounts if you lose your phone. Imported accounts need their original private keys backed up separately.</Text>
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
  else if (snapshot.phase === 'ready' && stage === 'send' && transferView && snapshot.account && nativeSigningEnabled(snapshot.account.network)) return <NativeSend controller={transferView} context={getNativeSendContext(snapshot.account.network, catalogue?.networks)} token={sendToken ?? undefined} accountLabel={accountLabel} onBack={() => { setSendToken(null); closeStage(); }} />;
  else if (snapshot.phase === 'ready' && publicSource) {
    const onAccounts = () => openStage(accounts ? 'accounts' : 'manage-hd');
    let content: React.ReactNode;
    if (shell.tab === 'wallet') content = <NativePortfolio
    reader={balanceReader ?? undefined}
    tokenView={tokenView ?? undefined}
    source={publicSource} accountLabel={accountLabel} onManageAccounts={accounts || accountView ? onAccounts : undefined} onExit={exit} onLock={revoke}
    onSend={snapshot.account && nativeSigningEnabled(snapshot.account.network) ? () => { setSendToken(null); openStage('send'); } : undefined}
    onSendToken={snapshot.account && erc20SigningEnabled(snapshot.account.network) ? (token) => { setSendToken(token); openStage('send'); } : undefined}
    onManageNetworks={networkView ? () => openStage('networks') : undefined}
    onViewRecovery={() => openStage('backup-auth')} onSecurity={() => openStage('security')}
    onActivity={() => shell.select('activity')}
    navigation={shell.navigation}
  />;
    else if (shell.tab === 'activity') content = activityView
      ? <NativeActivityScreen controller={activityView} accountLabel={accountLabel} onBack={() => shell.finishLeave('wallet')} navigation={shell.navigation} />
      : <UnavailableActivity accountLabel={accountLabel} watchOnly={false} onBack={() => shell.select('wallet')} />;
    else if (shell.tab === 'tools') content = <RealTools accountLabel={accountLabel}
      networkLabel={EVM_NETWORK_DEFINITIONS.find((network) => network.id === snapshot.account?.network)?.name ?? 'Network unavailable'} watchOnly={false}
      onAccounts={onAccounts} onNetworks={networkView ? () => openStage('networks') : undefined} onBack={() => shell.select('wallet')} />;
    else content = <RealSettings accountLabel={accountLabel} watchOnly={false} onSecurity={() => openStage('security')} onLock={revoke} onBack={() => shell.select('wallet')} />;
    return <RealAppShell tab={shell.tab} onTab={shell.select} immersive={shell.immersive}>{content}</RealAppShell>;
  }
  else body = <Notice title="Wallet unavailable" body="Close and reopen Pali to try again." tone="amber" />;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen><Header title={title} onBack={exit} subtitle="Development build · Use a test wallet" />
      {recoveryOutcome && <Notice title={recoveryOutcome.kind === 'success' ? 'Password change completed' : recoveryOutcome.kind === 'uncertain' ? 'Check your password' : 'Recovery update'} body={recoveryOutcome.message + (recoveryOutcome.cleanupFailed ? ' The wallet could not be reopened. Close and reopen Pali to unlock.' : '')} tone={recoveryOutcome.kind === 'success' ? undefined : 'amber'} />}
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
