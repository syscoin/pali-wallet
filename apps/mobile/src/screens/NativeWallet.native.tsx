import { NativeInfrastructure as NativeInfrastructureScreen } from './NativeInfrastructure';
import { PALI_RECOVERY_ALERTS_URL } from '../../../../source/shared/smartAccountLinks.ts';
import { getNativeGuardianRecoveryChoices } from '../smartAccount/guardianRecovery';
import { NativeNoteMaintenance } from './NativeNoteMaintenance';
import { NativePrivacyControls } from './NativePrivacyControls';
import { NativeEncryptionReviewScreen } from './NativeEncryptionReview';
import { NativeSlhDsaManagementScreen } from './NativeSlhDsaManagement';
import { NativeSmartAccountModulesScreen } from './NativeSmartAccountModules';
import { NativeSentryHub } from './NativeSentryHub';
import { NativeSentryReview } from './NativeSentryReview';
import { NativeSmartPreparationReview } from './NativeSmartPreparationReview';
import { NativePsbtReview } from './NativePsbtReview';
import { NativeSmartAccountSend } from './NativeSmartAccountSend';
import { NativeSmartTransactionReviewScreen } from './NativeSmartTransactionReview';
import { NativeSmartAccountOperationRoute } from './NativeSmartAccountOperation';
import { NativeSmartAccountAuthenticator } from './NativeSmartAccountAuthenticator';
import { findUtxoNetwork, supportsUtxoSoftwareCustody } from '../core/utxoNetworks';
import { findWifAddressType, UTXO_IMPORT_LABELS, UTXO_IMPORT_TYPES, type UtxoImportAddressType } from '../core/utxoAddresses';
import { walletFetch } from '../platform/http';
import { custodyIdle, securityPreferences } from '../platform/security';
import { AutoLockSettings, type IdlePreferenceSave } from './AutoLockSettings';
import { IdleTextInput } from './IdleActivityBoundary';
import { isNativeNewPassword, NEW_PASSWORD_HELP } from '../custody/password';
import { nativeAccountSelection } from '../core/accountDirectory';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeRecoveryCoordinator, createNativeWalletControllers } from '../platform/nativeFactory';
import { NativeControllerLifecycle } from '../custody/nativeControllerLifecycle';
import { NativeRecoveryFlow, type RecoveryOutcome } from '../custody/recoveryFlow';
import { NativeRecovery } from './NativeRecovery';
import { NativeNoteRestore, NoteRestoreUnconfirmedNotice } from './NativeNoteRestore';
import { NativeNoteCapacity } from './NativeNoteCapacity';
import { NativeNoteExport, NativeNoteFilesMenu } from './NativeNoteExport';
import { NativeNoteInventory } from './NativeNoteInventory';
import { NativeNoteImport } from './NativeNoteImport';
import { NativePrivateDeposit } from './NativePrivateDeposit';
import { useNativeNoteBackup } from './useNativeNoteBackup';
import { ensurePrivacyShield } from '../platform/privacyShield.native';
import type { CustodySnapshot } from '../custody/types';
import type { SeedBackupPresentation } from '../custody/seedBackup';
import { Button, colors, Header, Notice, PaliMark, Screen, styles, Text } from '../ui';
import { NativePortfolio } from './NativePortfolio';
import { NativeSend, type NativeRecipientPicker } from './NativeSend';
import { NativeUtxoSendScreen } from './NativeUtxoSend';
import { NativeSecurity } from './NativeSecurity';
import { NativeWalletRemovalScreen, type RemovalScreenOutcome } from './NativeWalletRemoval';
import { WalletRemovalError, type WalletRemovalTicket } from '../custody/walletRemoval';
import { NativeImport } from './NativeImport';
import type { NativeImportView } from '../custody/importedAccounts';
import { sptBalanceTotalUnits, supportsSptUtxoChain } from '../../../../source/shared/sptInventory';
import { formatBaseUnits } from '../core/amounts';
import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks';
import { PRIVACY_CHAIN_ID } from '../../../../source/utils/privacy/registry';
import { NativeCustodyFeedback } from './NativeCustodyFeedback';
import { NativeNetworks } from './NativeNetworks';
import { createNativeNetworkView, type NativeNetworkView } from '../custody/networkView';
import { getNativeNetwork, getNativeSendContext, nativeSigningEnabled, type EvmNetworkId } from '../custody/networkContext';
import { NativeAccounts } from './NativeAccounts';
import { NativeLedger } from './NativeLedger';
import { NativeTrezor, NativeTrezorResumeNotice } from './NativeTrezor';
import { trezorResumeDraft } from './trezorResumeDraft';
import type { NativeTrezorView, NativeTrezorResumeIntent } from '../custody/trezorAccounts';
import type { NativeUtxoAsset } from '../custody/utxoSend';
import type { NativeLedgerConnectionView, NativeLedgerImportView } from '../custody/ledgerAccounts';
import { WalletAccounts, type WatchWalletBridge } from './WalletAccounts';
import { NativeActivityScreen } from './NativeActivity';
import { UtxoActivityScreen } from './UtxoActivityScreen';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue';
import type { PublicCustodySource } from '../portfolio/nativePortfolio';
import type { Erc20Metadata } from '../../../../source/shared/erc20';
import type { SavedCollectible } from '../portfolio/tokenRegistry';
import { RealAppShell, UnavailableActivity, type RealTab } from './RealAppShell';
import { RealTools } from './RealTools';
import { NativeConnections, NativeCallsStatus } from './NativeConnections';
import type { NativePairingEntry } from '../connections/pairingLinks';
import { NativeMessageReviewScreen } from './NativeMessageReview';
import { NativeDappControlReview } from './NativeDappControlReview';
import { NativeTransactionReviewScreen } from './NativeTransactionReview';
import type { NativeConnectionsSnapshot, NativeSigningReview } from '../connections/types';
import { RealSettings } from './RealSettings';
import { useRealShell } from './useRealShell';

type Controllers = ReturnType<typeof createNativeWalletControllers>;
const nativeLifecycle = new NativeControllerLifecycle({ create: createNativeWalletControllers, protect: ensurePrivacyShield, recovery: createNativeRecoveryCoordinator });
// Nonsecret operation outcome survives route departure while cleanup is pending.
let savedRecoveryOutcome: RecoveryOutcome | null = null;
type RootOrigin = Readonly<{ tab: RealTab; stage: Stage; context: string; identity: string; epoch: number }>;
type SendTarget = Readonly<
  { kind: 'native' } | { kind: 'spt'; asset: NativeUtxoAsset; maximumAmount: string } | { kind: 'utxo'; asset?: NativeUtxoAsset } | { kind: 'token'; token: Erc20Metadata } |
  { kind: 'collectible'; collectible: SavedCollectible } | { kind: 'saved' | 'cancel' | 'cancel-saved' | 'speed-up'; hash: string }
>;
type RemovalScope = { local: Controllers; authority: CustodySnapshot; epoch: number; phase: 'reviewing' | 'working' | 'settled'; outcome?: RemovalScreenOutcome };
type Stage = 'choose' | 'create' | 'import' | 'backup-auth' | 'words' | 'challenge' | 'send' | 'accounts' | 'manage-hd' | 'networks' | 'security' | 'remove-wallet' | 'import-key' | 'recovery' | 'auto-lock' | 'private-notes' | 'note-inventory' | 'note-import' | 'note-deposit' | 'note-capacity' | 'note-maintenance' | 'privacy-settings' | 'restore-notes' | 'backup-notes' | 'connections' | 'device-unlock' | 'ledger' | 'trezor' | 'smart-deploy' | 'smart-resume' | 'smart-authenticator' | 'slh-dsa' | 'smart-modules' | 'sentry-keys' | 'smart-infrastructure';
const INITIAL: CustodySnapshot = { phase: 'opening', revision: 0, presence: 'unknown', backup: 'unknown', account: null, error: null };

function custodyContext(state?: CustodySnapshot, catalogue?: NativeWalletCatalogueSnapshot | null) {
  if (state?.phase !== 'ready' || !state.account || !catalogue) return null;
  const identity = `${catalogue.active.accountId}:${state.account.network}`;
  return { context: `${state.revision}:${identity}`, identity };
}

function message(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_CREDENTIAL') return 'That password is incorrect. Please try again.';
  if (code === 'DEVICE_UNLOCK_UNAVAILABLE') return 'Biometric unlock was not completed. Use your password to unlock.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect passwords. Wait a few minutes before trying again.';
  if (code === 'BACKUP_WORDS_MISMATCH') return 'Those words do not match. Check your written backup.';
  if (code === 'INVALID_INPUT') return 'Check your recovery phrase and password.';
  if (code === 'CANCELLED' || code === 'BACKUP_EXPIRED') return 'Your session was locked. Unlock to continue.';
  return 'This operation could not be completed. Your saved wallet has been preserved.';
}

function SecretInput({ label, value, onChange, multiline = false, disabled = false }: {
  label: string; value: string; onChange(value: string): void; multiline?: boolean; disabled?: boolean;
}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><IdleTextInput
    accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled}
    autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
    importantForAutofill="noExcludeDescendants" textContentType="none"
    secureTextEntry={!multiline} multiline={multiline} contextMenuHidden={false}
    maxLength={multiline ? 4096 : 1024} selectionColor={colors.pink}
    placeholderTextColor={colors.muted} style={[s.input, multiline && s.phraseInput]}
  /></View>;
}

export type NativeWalletProps = { onExit(): void; accounts?: WatchWalletBridge; initialAccountId?: string; onSelectedNative?(id: string): void; onWalletRemoved?(): void;
  incomingPairing?: NativePairingEntry | null; onPairingHandled?(id: string): void;
};

export function NativeWalletScreen({ onExit, accounts, initialAccountId, onSelectedNative, onWalletRemoved, incomingPairing, onPairingHandled }: NativeWalletProps) {
  const bridge = useRef(accounts);
  const selectedNative = useRef(onSelectedNative);
  useLayoutEffect(() => { bridge.current = accounts; selectedNative.current = onSelectedNative; }, [accounts, onSelectedNative]);
  const requestedAccount = useRef(initialAccountId);
  useLayoutEffect(() => { if (incomingPairing) requestedAccount.current = undefined; }, [incomingPairing]);
  const controllers = useRef<Controllers | null>(null);
  const screenToken = useRef<object>({});
  const detachSubscriptions = useRef<() => void>(() => undefined);
  const recoveryRef = useRef<NativeRecoveryFlow | null>(null);
  const removalRef = useRef<RemovalScope | null>(null);
  const [removalScope, setRemovalScope] = useState<RemovalScope | null>(null);
  const [canRemoveWallet, setCanRemoveWallet] = useState(false);
  const [recoveryFlow, setRecoveryFlow] = useState<NativeRecoveryFlow | null>(null);
  const [recoveryOutcome, setRecoveryOutcome] = useState<RecoveryOutcome | null>(savedRecoveryOutcome);
  const [publicSource, setPublicSource] = useState<PublicCustodySource | null>(null);
  const [recipientResolver, setRecipientResolver] = useState<Controllers['recipientResolver'] | undefined>(undefined);
  const [balanceReader, setBalanceReader] = useState<Controllers['balanceReader'] | null>(null);
  const [sentry, setSentry] = useState<Controllers['sentry'] | null>(null);
  const [sentryScope, setSentryScope] = useState<RootOrigin | null>(null);
  const [guardianEpoch, setGuardianEpoch] = useState(0);
  const [readGuardianRecovery, setReadGuardianRecovery] = useState<Controllers['readGuardianRecovery'] | null>(null);
  const [openGuardianPolicy, setOpenGuardianPolicy] = useState<Controllers['openGuardianPolicy'] | null>(null);
  const [inspectGuardianRemoval, setInspectGuardianRemoval] = useState<Controllers['inspectGuardianRemoval'] | null>(null);
  const [guardianRecoveryController, setGuardianRecoveryController] = useState<Controllers['guardianRecovery'] | null>(null);
  const [recoveryActivity, setRecoveryActivity] = useState<{
    local: Controllers; epoch: number; context: string; targetId: string; payerId: string; chainId: number; hash: string;
  } | null>(null);
  const [resumeGuardianScope, setResumeGuardianScope] = useState<string | null>(null);
  const [trezorView, setTrezorView] = useState<NativeTrezorView | null>(null);
  const [ledgerView, setLedgerView] = useState<NativeLedgerImportView | null>(null);
  const [ledgerConnection, setLedgerConnection] = useState<NativeLedgerConnectionView | null>(null);
  const [accountView, setAccountView] = useState<Controllers['accounts'] | null>(null);
  const [connectionView, setConnectionView] = useState<Controllers['connections'] | null>(null);
  const [connectionSnapshot, setConnectionSnapshot] = useState<NativeConnectionsSnapshot | null>(null);
  const [signingReview, setSigningReview] = useState<NativeSigningReview | null>(null);
  const [scanIntentExpiresAt, setScanIntentExpiresAt] = useState<number | null>(null);
  const scanStarted = useCallback(() => setScanIntentExpiresAt((previous) => previous && previous > Date.now() ? previous : Date.now() + 5 * 60_000), []);
  const scanFinished = useCallback(() => setScanIntentExpiresAt(null), []);
  useEffect(() => {
    if (scanIntentExpiresAt === null) return;
    const timer = setTimeout(scanFinished, Math.max(0, scanIntentExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [scanIntentExpiresAt, scanFinished]);
  const [networkView, setNetworkView] = useState<NativeNetworkView<EvmNetworkId> | null>(null);
  const [catalogue, setCatalogue] = useState<NativeWalletCatalogueSnapshot | null>(null);
  const [transferView, setTransferView] = useState<Controllers['transfers'] | null>(null);
  const [openSmartSend, setOpenSmartSend] = useState<Controllers['openSmartAccountSend'] | null>(null);
  const [canSignSmart, setCanSignSmart] = useState(false);
  const [canManageSlh, setCanManageSlh] = useState(false);
  const [canManageModules, setCanManageModules] = useState(false);
  const [openSmartAccountModules, setOpenSmartAccountModules] = useState<Controllers['openSmartAccountModules'] | null>(null);
  const [openSmartInfrastructure, setOpenSmartInfrastructure] = useState<Controllers['openSmartInfrastructure'] | null>(null);
  const [openSlhDsaManagement, setOpenSlhDsaManagement] = useState<Controllers['openSlhDsaManagement'] | null>(null);
  const [canUseWalletAuthenticator, setCanUseWalletAuthenticator] = useState(false);
  const [openWalletAuthenticator, setOpenWalletAuthenticator] = useState<Controllers['openWalletAuthenticator'] | null>(null);
  const [openSmartDeployment, setOpenSmartDeployment] = useState<Controllers['openSmartAccountDeployment'] | null>(null);
  const [smartResumeId, setSmartResumeId] = useState<string | null>(null);
  const [openUtxoSend, setOpenUtxoSend] = useState<Controllers['openUtxoSend'] | null>(null);
  const [tokenView, setTokenView] = useState<Controllers['tokens'] | null>(null);
  const [keyExportView, setKeyExportView] = useState<Controllers['keyExport'] | null>(null);
  const [saveIdle, setSaveIdle] = useState<IdlePreferenceSave | null>(null);
  const [openNoteMaintenance, setOpenNoteMaintenance] = useState<Controllers['openNoteMaintenance'] | null>(null);
  const [openPrivacyControls, setOpenPrivacyControls] = useState<Controllers['openPrivacyControls'] | null>(null);
  const [openNoteCapacity, setOpenNoteCapacity] = useState<Controllers['openNoteCapacity'] | null>(null);
  const [readNoteInventory, setReadNoteInventory] = useState<Controllers['readNoteInventory'] | null>(null);
  const [openNoteImport, setOpenNoteImport] = useState<Controllers['openNoteImport'] | null>(null);
  const [openPrivateDeposit, setOpenPrivateDeposit] = useState<Controllers['openPrivateDeposit'] | null>(null);
  const [depositActivity, setDepositActivity] = useState<{ context: string; hash: string } | null>(null);
  const [activityView, setActivityView] = useState<Controllers['activity'] | null>(null);
  const [utxoActivityView, setUtxoActivityView] = useState<Controllers['utxoActivity'] | null>(null);
  const [importScope, setImportScope] = useState<{ contextRevision: number; catalogueRevision: number; networkLabel: string; utxo: boolean; utxoAddressTypes?: readonly UtxoImportAddressType[]; token: number; imports: NativeImportView } | null>(null);
  const importRequest = useRef({ token: 0, active: false });
  const [importActiveToken, setImportActiveToken] = useState<number | null>(null);
  const [sendDraft, setSendDraft] = useState<Readonly<{ origin: RootOrigin; target: SendTarget; recipientPicker?: NativeRecipientPicker; resume?: ReturnType<typeof trezorResumeDraft>; resumeId?: string }> | null>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const submitting = useRef(false);
  const feedbackRequest = useRef(0);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [protectedScreen, setProtectedScreen] = useState(false);
  const [stage, setStage] = useState<Stage>('choose');
  const closePrivateLeaf = useCallback(() => setStage('private-notes'), []);
  const [password, setPassword] = useState('');
  const [deviceUnlockStatus, setDeviceUnlockStatus] = useState<Readonly<{ available: boolean; enabled: boolean }> | null>(null);
  const [enrollDeviceUnlock, setEnrollDeviceUnlock] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [phrase, setPhrase] = useState('');
  const [presentation, setPresentation] = useState<SeedBackupPresentation | null>(null);
  const [answers, setAnswers] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rootOrigin = useRef<RootOrigin | null>(null);
  const noteRestore = useNativeNoteBackup(() => {
    const local = controllers.current;
    return mounted.current && local && !recoveryRef.current &&
      nativeLifecycle.current(screenToken.current) === local && !nativeLifecycle.hasRecovery(screenToken.current) ? local : null;
  }, mode => setStage(mode === 'restore' ? 'restore-notes' : 'backup-notes'));
  const { cancel: cancelNoteRestore, lock: lockNoteRestore } = noteRestore;

  const clearSecrets = useCallback(() => {
    setPassword(''); setConfirmation(''); setPhrase(''); setPresentation(null); setAnswers(['', '', '']);
  }, []);
  const revoke = useCallback((background = false) => {
    // The AppState owner records exact Suite suspension before authority.lock
    // synchronously revalidates and removes the old request consent.
    const local = controllers.current;
    if (background === true) {
      local?.trezor.background();
      local?.connections.backgroundSigning();
    } else {
      void local?.trezor.cancel().catch(() => undefined);
      void local?.connections.cancelSigningHandoff().catch(() => undefined);
    }
    custodyIdle.stop(screenToken.current);
    epoch.current++;
    recoveryRef.current?.cancel();
    const removal = removalRef.current;
    removal?.local.removal.cancel();
    const retainRemoval = removal && removal.phase !== 'reviewing';
    if (removal && !retainRemoval) { removalRef.current = null; setRemovalScope(null); }
    lockNoteRestore();
    rootOrigin.current = null;
    setSentryScope(null);
    importRequest.current.active = false; setImportActiveToken(null); setImportScope(null);
    controllers.current?.authentication?.cancel();
    setRecoveryActivity(null); setResumeGuardianScope(null); setDepositActivity(null);
    controllers.current?.keyExport.cancel(); controllers.current?.backup.cancel(); controllers.current?.authority.lock();
    Keyboard.dismiss(); clearSecrets(); setSendDraft(null); setSmartResumeId(null); if (!recoveryRef.current && !retainRemoval) setStage('choose'); setError('');
  }, [clearSecrets, lockNoteRestore]);
  useLayoutEffect(() => {
    if (mounted.current && AppState.currentState === 'active' && securityPreferences.getSnapshot().status === 'ready') custodyIdle.begin(screenToken.current, revoke);
  });
  useLayoutEffect(() => { const owner = screenToken.current; custodyIdle.begin(owner, revoke); return () => custodyIdle.stop(owner); }, [revoke]);
  const exit = useCallback(() => { cancelNoteRestore(); revoke(); onExit(); }, [cancelNoteRestore, onExit, revoke]);
  const closeDeviceUnlock = () => {
    if (submitting.current) revoke();
    else { clearSecrets(); setStage('security'); }
  };
  const readyContext = useCallback(() => {
    const local = controllers.current;
    return custodyContext(local?.authority.getSnapshot(), local?.authority.getCatalogue());
  }, []);
  const openResumedSmartOperation = useCallback(async (assertView: () => void, signal: AbortSignal) => {
    const local = controllers.current, origin = rootOrigin.current, id = smartResumeId;
    const check = () => {
      assertView();
      if (!local || !id || !origin || origin.stage !== 'smart-resume' || signal.aborted ||
          !mounted.current || controllers.current !== local || rootOrigin.current !== origin ||
          epoch.current !== origin.epoch || AppState.currentState !== 'active' || readyContext()?.identity !== origin.identity)
        throw new Error('CANCELLED');
    };
    check();
    const operation = await local!.openResumedSmartAccountOperation(id!, signal, check);
    try { check(); return operation; } catch (error) { await operation.dispose(); throw error; }
  }, [readyContext, smartResumeId]);
  const currentShellScope = () => stage === 'choose' ? readyContext()?.context ?? null : null;
  const utxo = findUtxoNetwork(snapshot.account?.network, catalogue?.utxoNetworks);
  const selectedCatalogueAccount = catalogue?.accounts.find(account => account.id === catalogue.active.accountId);
  const selectedAccountType = selectedCatalogueAccount?.type;
  const guardianContext = custodyContext(snapshot, catalogue)?.context;
  const guardianRecovery = selectedAccountType === 'SmartAccount' && snapshot.account && readGuardianRecovery && guardianContext ? {
    scope: `${guardianEpoch}:${guardianContext}`,
    address: snapshot.account.address,
    manage: openGuardianPolicy && inspectGuardianRemoval ? {
      ledgerConnection: ledgerConnection ?? undefined,
      chainId: Number(getNativeNetwork(snapshot.account.network, catalogue?.networks).chainId),
      inspectRemoval: (signal: AbortSignal, assertView: () => void) => inspectGuardianRemoval(signal, () => {
        assertView();
        if (!mounted.current || epoch.current !== guardianEpoch || AppState.currentState !== 'active' || readyContext()?.context !== guardianContext)
          throw new Error('CANCELLED');
      }),
      open: (draft: Parameters<Controllers['openGuardianPolicy']>[0], signal: AbortSignal, assertView: () => void) => openGuardianPolicy(draft, signal, () => {
        assertView();
        if (!mounted.current || epoch.current !== guardianEpoch || AppState.currentState !== 'active' || readyContext()?.context !== guardianContext)
          throw new Error('CANCELLED');
      }),
    } : undefined,
    recovery: guardianRecoveryController ? {
      chainId: Number(getNativeNetwork(snapshot.account.network, catalogue?.networks).chainId),
      currency: getNativeNetwork(snapshot.account.network, catalogue?.networks).symbol,
      ...getNativeGuardianRecoveryChoices(catalogue?.accounts ?? [], Number(getNativeNetwork(snapshot.account.network, catalogue?.networks).chainId)),
      openRecoveryAlerts: async () => {
        if (!mounted.current || epoch.current !== guardianEpoch || AppState.currentState !== 'active' || readyContext()?.context !== guardianContext)
          throw new Error('CANCELLED');
        await Linking.openURL(PALI_RECOVERY_ALERTS_URL);
      },
      hasIntent: guardianRecoveryController.hasIntent(),
      onActivity: (payerId: string, chainId: number, hash: string) => openRecoveryActivity(payerId, chainId, hash),
      open: (draft: Parameters<Controllers['guardianRecovery']['open']>[0], signal: AbortSignal, assertView: () => void) => guardianRecoveryController.open(draft, signal, () => {
        assertView();
        if (!mounted.current || epoch.current !== guardianEpoch || AppState.currentState !== 'active' || readyContext()?.context !== guardianContext)
          throw new Error('CANCELLED');
      }),
    } : undefined,
    read: (signal: AbortSignal, assertView: () => void) => readGuardianRecovery(signal, () => {
      assertView();
      if (!mounted.current || epoch.current !== guardianEpoch || AppState.currentState !== 'active' || readyContext()?.context !== guardianContext)
        throw new Error('CANCELLED');
    }),
  } : undefined;

  const closeGuardian = useCallback(() => {
    const local = controllers.current;
    if (!mounted.current || !local || epoch.current !== guardianEpoch || AppState.currentState !== 'active' ||
        readyContext()?.context !== guardianContext) return;
    const next = local.authority.getCatalogue();
    setCatalogue(next); bridge.current?.onNativeCatalogue(next);
  }, [guardianEpoch, guardianContext, readyContext]);

  const hasSigningAccount = selectedAccountType === 'HDAccount' || selectedAccountType === 'Imported' || selectedAccountType === 'Ledger' && !!ledgerConnection || selectedAccountType === 'Trezor' && !!trezorView;
  const canSign = !!snapshot.account && hasSigningAccount && nativeSigningEnabled(snapshot.account.network, catalogue?.networks);
  const canSendSmart = !!snapshot.account && selectedAccountType === 'SmartAccount' && !!openSmartSend && !!publicSource && !!balanceReader &&
    canSignSmart &&
    nativeSigningEnabled(snapshot.account.network, catalogue?.networks);
  const canSendUtxo = hasSigningAccount && !!openUtxoSend && !!utxo && supportsUtxoSoftwareCustody(utxo);
  const canSendSpt = canSendUtxo && !!utxo && supportsSptUtxoChain(utxo.chainId);
  const canDeposit = !!openPrivateDeposit && !!snapshot.account && !utxo &&
    (selectedAccountType === 'HDAccount' || selectedAccountType === 'Imported') &&
    Number(getNativeNetwork(snapshot.account.network, catalogue?.networks).chainId) === PRIVACY_CHAIN_ID;
  const shellIdentity = stage === 'choose' && snapshot.phase === 'ready' && snapshot.account && catalogue
    ? `${catalogue.active.accountId}:${snapshot.account.network}` : null;
  const shell = useRealShell(shellIdentity, currentShellScope, exit);
  const sentryAvailable = snapshot.phase === 'ready' && !!utxo && sentry?.available() === true;
  const sentryRoute = stage === 'sentry-keys' && sentryAvailable &&
    sentryScope?.context === custodyContext(snapshot, catalogue)?.context;
  const openRecoveryActivity = async (payerId: string, chainId: number, hash: string) => {
    const local = controllers.current;
    const before = local?.authority.getCatalogue();
    const capturedEpoch = epoch.current;
    if (!local || !before || !guardianContext || readyContext()?.context !== guardianContext ||
        AppState.currentState !== 'active' || !/^0x[0-9a-f]{64}$/i.test(hash) ||
        Number(getNativeNetwork(before.active.networkId, before.networks).chainId) !== chainId ||
        !before.accounts.some(account => account.id === payerId && (account.type === 'HDAccount' || account.type === 'Imported'))) throw Error('CANCELLED');
    const targetId = before.active.accountId;
    await local.accounts.execute({ kind: 'select', id: payerId }, local.authority.getSnapshot().revision, before.revision);
    const after = local.authority.getCatalogue();
    const context = readyContext();
    if (!mounted.current || controllers.current !== local || epoch.current !== capturedEpoch || AppState.currentState !== 'active' ||
        !after || !context || after.active.accountId !== payerId || Number(getNativeNetwork(after.active.networkId, after.networks).chainId) !== chainId)
      throw Error('CANCELLED');
    setRecoveryActivity({ local, epoch: capturedEpoch, context: context.context, targetId, payerId, chainId, hash });
    shell.restoreRoot('activity', context.identity);
  };
  const returnToRecovery = async () => {
    const saved = recoveryActivity;
    if (!saved || !mounted.current || controllers.current !== saved.local || epoch.current !== saved.epoch ||
        AppState.currentState !== 'active' || readyContext()?.context !== saved.context) return;
    const before = saved.local.authority.getCatalogue();
    if (!before || !before.accounts.some(account => account.id === saved.targetId && account.type === 'SmartAccount' &&
        account.smartAccount?.chainId === saved.chainId)) return;
    setRecoveryActivity(null);
    await saved.local.accounts.execute({ kind: 'select', id: saved.targetId }, saved.local.authority.getSnapshot().revision, before.revision);
    const context = readyContext();
    const after = saved.local.authority.getCatalogue();
    if (!mounted.current || controllers.current !== saved.local || epoch.current !== saved.epoch || AppState.currentState !== 'active' ||
        !context || !after || after.active.accountId !== saved.targetId || Number(getNativeNetwork(after.active.networkId, after.networks).chainId) !== saved.chainId) return;
    setResumeGuardianScope(`${saved.epoch}:${context.context}`);
    shell.restoreRoot('tools', context.identity);
  };
  useEffect(() => {
    if (recoveryActivity && (controllers.current !== recoveryActivity.local || epoch.current !== recoveryActivity.epoch ||
        readyContext()?.context !== recoveryActivity.context)) setRecoveryActivity(null);
  }, [recoveryActivity, snapshot.revision, readyContext]);
  const openStage = (next: Stage, sendTarget?: SendTarget) => {
    const local = controllers.current;
    const owner = local?.authority.getSnapshot();
    const capturedCatalogue = local?.authority.getCatalogue();
    const current = custodyContext(owner, capturedCatalogue);
    if (stage !== 'choose' || AppState.currentState !== 'active' || !current) return;
    const origin = { tab: shell.tab, stage: next, ...current, epoch: epoch.current };
    if (next === 'slh-dsa' && !local?.canManageSlhDsa()) return;
    if (next === 'smart-modules' && !local?.canManageSmartAccountModules()) return;
    if (next === 'smart-authenticator' && !local?.canUseWalletAuthenticator()) return;
    if (next === 'sentry-keys') {
      if (!local?.sentry.available()) return;
      setSentryScope(origin);
    }
    if (next === 'send') {
      if (!sendTarget || (sendTarget.kind === 'spt' ? !canSendSpt :
        !canSign && !(canSendUtxo && sendTarget.kind === 'native' || canSendSmart && (sendTarget.kind === 'native' || sendTarget.kind === 'token' || sendTarget.kind === 'collectible')))) return;
      const sender = owner?.account?.address.toLowerCase();
      const recipientPicker = sendTarget.kind === 'native' && canSign && local && sender &&
        capturedCatalogue?.accounts.some(({ address }) => address.toLowerCase() !== sender)
        ? {
          current: () => {
            if (AppState.currentState !== 'active' || controllers.current !== local ||
                rootOrigin.current !== origin || epoch.current !== origin.epoch) return false;
            const latest = local.authority.getCatalogue();
            return latest?.revision === capturedCatalogue.revision &&
              custodyContext(local.authority.getSnapshot(), latest)?.context === origin.context;
          },
          accounts: () => capturedCatalogue.accounts.flatMap(({ address, label }) =>
            address.toLowerCase() === sender ? [] : [{ address, label }]),
        } : undefined;
      setSendDraft({ origin, target: sendTarget, recipientPicker });
    }
    rootOrigin.current = origin;
    setStage(next);
  };
  useEffect(() => {
    if (incomingPairing && incomingPairing.expiresAt <= Date.now()) { onPairingHandled?.(incomingPairing.id); return; }
    const pendingLink = incomingPairing && onPairingHandled;
    const resumeScan = scanIntentExpiresAt !== null && scanIntentExpiresAt > Date.now();
    if (!pendingLink && !resumeScan) return;
    if (AppState.currentState !== 'active' || !protectedScreen || busy ||
        snapshot.phase !== 'ready' || stage !== 'choose' || shell.immersive ||
        !connectionView || connectionSnapshot?.status !== 'ready' ||
        connectionSnapshot.proposals.length || connectionSnapshot.preparationReview || connectionSnapshot.controlReview || connectionSnapshot.sentryReview || connectionSnapshot.psbtReview || signingReview) return;
    const current = readyContext();
    if (!current) return;
    const capturedEpoch = epoch.current;
    let active = true;
    queueMicrotask(() => {
      const connections = connectionView.getSnapshot();
      const linkCurrent = incomingPairing && incomingPairing.expiresAt > Date.now();
      const scanCurrent = scanIntentExpiresAt !== null && scanIntentExpiresAt > Date.now();
      if ((!linkCurrent && !scanCurrent) || !active || !mounted.current || rootOrigin.current || epoch.current !== capturedEpoch ||
          AppState.currentState !== 'active' || readyContext()?.context !== current.context ||
          connections.status !== 'ready' || connections.proposals.length || connections.preparationReview || connections.controlReview || connections.sentryReview || connections.psbtReview || connections.signingReview) return;
      rootOrigin.current = { tab: shell.tab, stage: 'connections', ...current, epoch: capturedEpoch };
      setStage('connections');
    });
    return () => { active = false; };
  }, [incomingPairing, onPairingHandled, protectedScreen, busy, snapshot.phase, snapshot.revision, stage,
    shell.immersive, connectionView, connectionSnapshot, signingReview, scanIntentExpiresAt, readyContext, shell.tab]);
  const closeStage = () => {
    const origin = rootOrigin.current; rootOrigin.current = null;
    const current = readyContext();
    if (stage === 'smart-infrastructure' || stage === 'smart-deploy' || stage === 'smart-resume' || stage === 'smart-authenticator' || stage === 'slh-dsa' || stage === 'smart-modules' || stage === 'send' && selectedAccountType === 'SmartAccount') setCatalogue(controllers.current?.authority.getCatalogue() ?? null);
    const local = controllers.current;
    setCanSignSmart(local?.canSignSmartAccount() === true); setCanManageSlh(local?.canManageSlhDsa() === true); setCanManageModules(local?.canManageSmartAccountModules() === true);
    setCanUseWalletAuthenticator(local?.canUseWalletAuthenticator() === true);
    setSendDraft(null);
    setSmartResumeId(null);
    setSentryScope(null);
    setStage('choose');
    if (origin && current && AppState.currentState === 'active' && origin.context === current.context && origin.identity === current.identity && origin.epoch === epoch.current)
      shell.restoreRoot(origin.tab, origin.identity);
  };
  const sendTarget = stage === 'send' && sendDraft &&
    sendDraft.origin.context === custodyContext(snapshot, catalogue)?.context
    ? sendDraft.target : undefined;
  const latestBack = useRef<() => boolean>(() => true);
  useLayoutEffect(() => {
    latestBack.current = () => {
      if (stage === 'device-unlock') {
        closeDeviceUnlock();
        return true;
      }
      // Full-screen leaf flows own their Back behavior regardless of listener order.
      if (snapshot.phase === 'ready' && (stage === 'choose' || stage === 'connections') && (signingReview || connectionSnapshot?.preparationReview || connectionSnapshot?.controlReview || connectionSnapshot?.sentryReview || connectionSnapshot?.psbtReview)) return false;
      if ((stage === 'private-notes' || stage === 'connections') && snapshot.phase === 'ready') {
        if (stage === 'connections') {
          scanFinished();
          if (incomingPairing) onPairingHandled?.(incomingPairing.id);
        }
        closeStage(); return true;
      }
      if ((stage === 'smart-infrastructure' || stage === 'smart-authenticator' || stage === 'slh-dsa' || stage === 'smart-modules' || stage === 'smart-deploy' || stage === 'smart-resume' || stage === 'send' && canSendSmart) && snapshot.phase === 'ready') return false;
      if (sentryRoute || stage === 'recovery' || stage === 'remove-wallet' || stage === 'auto-lock' || (stage === 'restore-notes' || stage === 'backup-notes' || stage === 'note-capacity' || stage === 'note-maintenance' || stage === 'privacy-settings' || stage === 'note-inventory' || stage === 'note-import' || stage === 'note-deposit') && snapshot.phase === 'ready' ||
          stage === 'accounts' && accounts && snapshot.phase !== 'authenticating' ||
          stage === 'trezor' && trezorView && ['ready', 'authenticating'].includes(snapshot.phase) ||
          stage === 'ledger' && ledgerView && ['ready', 'authenticating'].includes(snapshot.phase) ||
          stage === 'manage-hd' && accountView && ['ready', 'authenticating'].includes(snapshot.phase) ||
          stage === 'networks' && networkView && ['ready', 'authenticating'].includes(snapshot.phase) ||
          stage === 'security' && snapshot.phase === 'ready' && catalogue && snapshot.account && keyExportView ||
          stage === 'send' && snapshot.phase === 'ready' && (transferView && canSign || canSendUtxo || canSendSmart) ||
          stage === 'import-key' && importScope && ['ready', 'authenticating'].includes(snapshot.phase) &&
            (snapshot.revision === importScope.contextRevision || importActiveToken === importScope.token && snapshot.revision === importScope.contextRevision + 1)) return false;
      if (snapshot.phase === 'ready' && stage === 'choose') shell.goBack(); else exit();
      return true;
    };
  });

  const clearOwnerView = useCallback(() => {
    cancelNoteRestore();
    detachSubscriptions.current(); detachSubscriptions.current = () => undefined;
    controllers.current = null;
    setSentry(null); setSentryScope(null);
    if (rootOrigin.current?.stage === 'send' || rootOrigin.current?.stage === 'smart-resume') {
      rootOrigin.current = null;
      setSendDraft(null);
      setStage((current) => current === 'send' || current === 'smart-resume' ? 'choose' : current);
    }
    setCanRemoveWallet(false); setDeviceUnlockStatus(null);
    setCanSignSmart(false); setCanManageSlh(false); setOpenSlhDsaManagement(null); setCanManageModules(false); setOpenSmartAccountModules(null); setOpenSmartInfrastructure(null);
    setCanUseWalletAuthenticator(false); setOpenWalletAuthenticator(null); setSmartResumeId(null);
    setPublicSource(null); setBalanceReader(null); setRecipientResolver(undefined); setReadGuardianRecovery(null); setOpenGuardianPolicy(null); setInspectGuardianRemoval(null); setGuardianRecoveryController(null); setRecoveryActivity(null); setResumeGuardianScope(null); setAccountView(null); setTrezorView(null); setLedgerView(null); setLedgerConnection(null); setConnectionView(null); setConnectionSnapshot(null); setSigningReview(null); setNetworkView(null);
    setOpenNoteCapacity(null); setReadNoteInventory(null); setOpenPrivateDeposit(null); setDepositActivity(null); setSaveIdle(null); setCatalogue(null); setTransferView(null); setOpenUtxoSend(null); setOpenSmartDeployment(null); setOpenSmartSend(null); setTokenView(null); setKeyExportView(null); setActivityView(null); setUtxoActivityView(null);
    bridge.current?.onNativeCatalogue(null);
  }, [cancelNoteRestore]);
  const attach = useCallback((local: Controllers) => {
    detachSubscriptions.current(); controllers.current = local;
    setCanRemoveWallet(!!local.removal);
    setOpenSlhDsaManagement(() => async (signal: AbortSignal, assertView: () => void) => {
      const origin = rootOrigin.current, address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'slh-dsa' || !address || !mounted.current || controllers.current !== local ||
            rootOrigin.current !== origin || epoch.current !== origin.epoch || AppState.currentState !== 'active' ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check(); const manager = await local.openSlhDsaManagement(signal, check); check(); return manager;
    });
    setOpenSmartInfrastructure(() => async (signal: AbortSignal, assertView: () => void) => {
      const origin = rootOrigin.current, address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'smart-infrastructure' || !address || !mounted.current || controllers.current !== local ||
            rootOrigin.current !== origin || epoch.current !== origin.epoch || AppState.currentState !== 'active' ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check(); const manager = await local.openSmartInfrastructure(signal, check);
      try { check(); return manager; } catch (error) { manager.dispose(); throw error; }
    });
    setOpenSmartAccountModules(() => async (signal: AbortSignal, assertView: () => void) => {
      const origin = rootOrigin.current, address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'smart-modules' || !address || !mounted.current || controllers.current !== local ||
            rootOrigin.current !== origin || epoch.current !== origin.epoch || AppState.currentState !== 'active' ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check(); const manager = await local.openSmartAccountModules(signal, check); check(); return manager;
    });
    setOpenWalletAuthenticator(() => async (signal: AbortSignal, assertView: () => void) => {
      const origin = rootOrigin.current;
      const address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'smart-authenticator' || !address ||
            !mounted.current || controllers.current !== local || rootOrigin.current !== origin ||
            epoch.current !== origin.epoch || AppState.currentState !== 'active' ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check();
      const operation = await local.openWalletAuthenticator(signal, check);
      try {
        check();
        return operation;
      } catch (error) {
        await operation.dispose().catch(() => undefined);
        throw error;
      }
    });
    setReadGuardianRecovery(() => (signal: AbortSignal, assertView: () => void) => {
      const capturedEpoch = epoch.current;
      return local.readGuardianRecovery(signal, () => {
        assertView();
        if (!mounted.current || controllers.current !== local || epoch.current !== capturedEpoch)
          throw new Error('CANCELLED');
      });
    });
    const networks = createNativeNetworkView(local.authority, { utxoSendAvailable: !!local.openUtxoSend, fetch: walletFetch });
    const publicView: PublicCustodySource = Object.freeze({
      getSnapshot: () => local.authority.getSnapshot(),
      getCatalogue: () => local.authority.getCatalogue(),
      subscribe: (listener: Parameters<PublicCustodySource['subscribe']>[0]) => local.authority.subscribe(listener),
    });
    const update = (state: CustodySnapshot) => {
      if (!mounted.current || controllers.current !== local) return;
      setGuardianEpoch(epoch.current);
      setCanSignSmart(local.canSignSmartAccount()); setCanManageSlh(local.canManageSlhDsa()); setCanManageModules(local.canManageSmartAccountModules());
      setCanUseWalletAuthenticator(local.canUseWalletAuthenticator());
      if (local.authentication) {
        void local.authority.getDeviceUnlockStatus().then((status) => {
          if (mounted.current && controllers.current === local && local.authority.getSnapshot() === state) setDeviceUnlockStatus(status);
        }).catch(() => {
          if (mounted.current && controllers.current === local && local.authority.getSnapshot() === state) setDeviceUnlockStatus(null);
        });
      }
      setSentry(local.sentry);
      setSnapshot(state); setPublicSource(publicView); setBalanceReader(local.balanceReader); setRecipientResolver(local.recipientResolver); setConnectionView(local.connections); setTransferView(local.transfers); setOpenUtxoSend(() => local.openUtxoSend); setOpenSmartDeployment(() => local.openSmartAccountDeployment); setOpenSmartSend(() => local.openSmartAccountSend); setTokenView(local.tokens); setActivityView(local.activity); setUtxoActivityView(local.utxoActivity); setKeyExportView(local.keyExport); setNetworkView(networks);
      setGuardianRecoveryController({
        hasIntent: () => local.guardianRecovery.hasIntent(),
        open: (draft, signal, assertView) => {
          const capturedEpoch = epoch.current;
          return local.guardianRecovery.open(draft, signal, () => {
            assertView();
            if (!mounted.current || controllers.current !== local || epoch.current !== capturedEpoch || AppState.currentState !== 'active')
              throw new Error('CANCELLED');
          });
        },
      });
      setOpenGuardianPolicy(() => local.canManageGuardianPolicy() ? (draft: Parameters<Controllers['openGuardianPolicy']>[0], signal: AbortSignal, assertView: () => void) => {
        const capturedEpoch = epoch.current;
        return local.openGuardianPolicy(draft, signal, () => {
          assertView();
          if (!mounted.current || controllers.current !== local || epoch.current !== capturedEpoch || AppState.currentState !== 'active')
            throw new Error('CANCELLED');
        });
      } : null);
      setInspectGuardianRemoval(() => local.canManageGuardianPolicy() ? (signal: AbortSignal, assertView: () => void) => {
        const capturedEpoch = epoch.current;
        return local.inspectGuardianRemoval(signal, () => {
          assertView();
          if (!mounted.current || controllers.current !== local || epoch.current !== capturedEpoch || AppState.currentState !== 'active')
            throw new Error('CANCELLED');
        });
      } : null);
      const nextCatalogue = local.authority.getCatalogue();
      setCatalogue(nextCatalogue); bridge.current?.onNativeCatalogue(nextCatalogue);
      const origin = rootOrigin.current;
      if ((origin?.stage === 'smart-infrastructure' || origin?.stage === 'smart-authenticator' || origin?.stage === 'slh-dsa' || origin?.stage === 'smart-modules' || origin?.stage === 'smart-resume') && origin.identity !== custodyContext(state, nextCatalogue)?.identity) {
        rootOrigin.current = null;
        setSmartResumeId(null);
        setStage((current) => current === 'smart-infrastructure' || current === 'smart-authenticator' || current === 'slh-dsa' || current === 'smart-modules' || current === 'smart-resume' ? 'choose' : current);
      }
      if (origin?.stage === 'sentry-keys' && origin.context !== custodyContext(state, nextCatalogue)?.context) {
        rootOrigin.current = null; setSentryScope(null);
        setStage((current) => current === 'sentry-keys' ? 'choose' : current);
      }
      if (origin?.stage === 'send' && origin.context !== custodyContext(state, nextCatalogue)?.context) {
        rootOrigin.current = null;
        setSendDraft(null);
        setStage((current) => current === 'send' ? 'choose' : current);
      }
      if (origin?.stage === 'private-notes' && origin.context !== custodyContext(state, nextCatalogue)?.context) {
        rootOrigin.current = null;
        setStage((current) => current === 'note-deposit' || current === 'note-maintenance' || current === 'privacy-settings' ? 'choose' : current);
      }
      if (nextCatalogue) selectedNative.current?.(nextCatalogue.active.accountId);
      setAccountView(local.authority.supportsAccountManagement() ? local.accounts : null);
      setLedgerView(local.ledger); setLedgerConnection(local.ledgerConnection); setTrezorView(local.trezor);
      const removal = removalRef.current;
      if (removal?.local === local && removal.phase === 'reviewing' && state !== removal.authority) {
        local.removal.cancel(); removalRef.current = null; setRemovalScope(null); setStage('choose');
      }
      if (['locked', 'unavailable', 'disposed'].includes(state.phase)) {
        rootOrigin.current = null;
        setStage((current) => current === 'note-inventory' || current === 'note-import' || current === 'note-deposit' || current === 'note-maintenance' || current === 'privacy-settings' ? 'choose' : current);
      }
      if (!['ready', 'backup-required', 'authenticating'].includes(state.phase)) clearSecrets();
    };
    setSaveIdle(() => (expected: Parameters<IdlePreferenceSave>[0], minutes: number, password: string, check: () => void) => local.authority.saveIdlePreference(expected, minutes, password, check));
    setOpenNoteCapacity(() => local.openNoteCapacity ?? null);
    setOpenNoteMaintenance(() => local.openNoteMaintenance ?? null);
    setOpenPrivacyControls(() => local.openPrivacyControls ?? null);
    setReadNoteInventory(() => local.readNoteInventory ?? null);
    setOpenNoteImport(() => local.openNoteImport ?? null);
    setOpenPrivateDeposit(() => local.openPrivateDeposit ?? null);
    const unsubscribe = local.authority.subscribe(update);
    update(local.authority.getSnapshot());
    const updateMessage = () => {
      if (mounted.current && controllers.current === local) {
        const next = local.connections.getSnapshot();
        setConnectionSnapshot(next);
        setSigningReview(next.signingReview);
      }
    };
    const unsubscribeMessages = local.connections.subscribe(updateMessage);
    updateMessage();
    const clear = local.backup.onClear(() => { setPresentation(null); setAnswers(['', '', '']); });
    detachSubscriptions.current = () => { unsubscribe(); unsubscribeMessages(); clear(); };
    setProtectedScreen(true);
  }, [clearSecrets, readyContext]);
  const install = useCallback(async () => {
    try {
      const local = await nativeLifecycle.acquire(screenToken.current, () => mounted.current && AppState.currentState === 'active');
      if (local && mounted.current && nativeLifecycle.current(screenToken.current) === local) attach(local);
    } catch {
      if (mounted.current) { setProtectedScreen(false); setError('Secure wallet storage is unavailable. Close and reopen Pali to try again.'); }
      throw new Error('REOPEN_REQUIRED');
    }
  }, [attach]);
  useLayoutEffect(() => {
    const local = controllers.current;
    if (removalRef.current || (stage === 'remove-wallet' && snapshot.phase !== 'locked') || !local?.removal?.requiresControllerReopen()) return;
    const token = screenToken.current;
    const generation = ++epoch.current;
    // Preparation stopped asynchronous producers before sealing the removal
    // snapshot. An abandoned attempt needs a fresh bundle, not its closed view.
    const draining = nativeLifecycle.release(token);
    clearOwnerView(); clearSecrets(); setSnapshot(INITIAL); setProtectedScreen(false); setStage('choose');
    void draining.then(async () => {
      if (mounted.current && epoch.current === generation && screenToken.current === token &&
          AppState.currentState === 'active' && !controllers.current) await install();
    }).catch(() => {
      if (mounted.current && epoch.current === generation)
        setError('Secure wallet storage is unavailable. Close and reopen Pali to try again.');
    });
  }, [stage, snapshot.phase, snapshot.revision, clearOwnerView, clearSecrets, install]);
  useEffect(() => {
    const lifecycleEpoch = epoch, ownedToken = screenToken.current;
    mounted.current = true;
    void install().catch(() => undefined);
    const resume = () => {
      if (!mounted.current || AppState.currentState !== 'active') return;
      custodyIdle.begin(screenToken.current, revoke);
      if (!controllers.current && !recoveryRef.current && !removalRef.current)
        void install().catch(() => undefined);
    };
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'inactive' && controllers.current?.authentication?.isActive()) { clearSecrets(); Keyboard.dismiss(); }
      else if (state !== 'active') revoke(true);
      else resume();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (controllers.current?.authentication?.isActive()) { clearSecrets(); Keyboard.dismiss(); } else revoke(true);
    }) : null;
    const focus = AppState.addEventListener('focus', resume);
    return () => {
      mounted.current = false; lifecycleEpoch.current++; recoveryRef.current?.cancel();
      removalRef.current?.local.removal.cancel(); removalRef.current = null;
      detachSubscriptions.current(); detachSubscriptions.current = () => undefined;
      bridge.current?.onNativeCatalogue(null); controllers.current = null;
      lifecycle.remove(); blur?.remove(); focus.remove(); custodyIdle.stop(ownedToken);
      void nativeLifecycle.release(ownedToken).catch(() => undefined);
    };
  }, [install, revoke, clearSecrets]);

  const openRemoval = () => {
    const local = controllers.current, authority = local?.authority.getSnapshot();
    if (!local?.removal || !onWalletRemoved || !protectedScreen || removalRef.current || !mounted.current ||
        AppState.currentState !== 'active' || stage !== 'security' || authority?.phase !== 'ready' ||
        nativeLifecycle.current(screenToken.current) !== local) return;
    const scope: RemovalScope = { local, authority, epoch: epoch.current, phase: 'reviewing' };
    removalRef.current = scope; setRemovalScope(scope); setStage('remove-wallet');
  };

  const removalCurrent = (scope: RemovalScope) => {
    if (!mounted.current || removalRef.current !== scope || controllers.current !== scope.local || scope.epoch !== epoch.current ||
        AppState.currentState !== 'active' || nativeLifecycle.current(screenToken.current) !== scope.local) return false;
    const now = scope.local.authority.getSnapshot();
    return now === scope.authority || scope.phase === 'working' && now.phase === 'disposed' && now.revision === scope.authority.revision + 1;
  };

  const confirmRemoval = async (scope: RemovalScope, ticket: WalletRemovalTicket, check: () => void): Promise<RemovalScreenOutcome> => {
    if (scope.phase !== 'reviewing') return 'unconfirmed';
    if (!removalCurrent(scope)) { scope.phase = 'settled'; scope.outcome = 'unchanged'; return 'unchanged'; }
    scope.phase = 'working';
    let outcome: RemovalScreenOutcome;
    try {
      const result = await scope.local.removal.confirm(ticket, check);
      outcome = result === 'wallet-records-removed' && scope.local.removal.hasVerifiedRemoval() ? 'removed'
        : result === 'wallet-records-unchanged' ? 'unchanged' : 'unconfirmed';
    } catch (cause) {
      outcome = cause instanceof WalletRemovalError && ['CANCELLED', 'STATE_CHANGED', 'SELECTION_UNAVAILABLE'].includes(cause.code)
        ? 'unchanged' : 'unconfirmed';
    }
    scope.phase = 'settled'; scope.outcome = outcome;
    return outcome;
  };

  const finishRemoval = async (scope: RemovalScope, outcome: 'removed' | 'unchanged') => {
    if (!mounted.current || removalRef.current !== scope || scope.outcome !== outcome || AppState.currentState !== 'active') return;
    const retired = scope.local.authority.getSnapshot().phase === 'disposed';
    if (outcome === 'removed' && (!retired || !scope.local.removal.hasVerifiedRemoval())) throw new Error('REOPEN_REQUIRED');
    if (retired) {
      const draining = nativeLifecycle.release(screenToken.current);
      if (controllers.current === scope.local) { clearOwnerView(); setSnapshot(INITIAL); setProtectedScreen(false); }
      await draining;
    }
    if (!mounted.current || removalRef.current !== scope || AppState.currentState !== 'active') return;
    removalRef.current = null; setRemovalScope(null);
    if (outcome === 'removed') {
      requestedAccount.current = undefined;
      onWalletRemoved?.();
    } else if (retired) {
      setStage('choose');
      await install();
    } else setStage(scope.local.authority.getSnapshot().phase === 'ready' ? 'security' : 'choose');
  };

  const openRecovery = () => {
    const local = controllers.current;
    if (!local || recoveryRef.current || submitting.current || !protectedScreen || AppState.currentState !== 'active' ||
        local.authority.getSnapshot().phase !== 'locked' || nativeLifecycle.current(screenToken.current) !== local) return;
    cancelNoteRestore();
    rootOrigin.current = null; requestedAccount.current = undefined; feedbackRequest.current++;
    clearSecrets(); setError(''); setSendDraft(null); const captured = ++epoch.current;
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

  const finishUnlock = async (local: Controllers) => {
    const { authority } = local;
    const requested = requestedAccount.current, current = authority.getCatalogue();
    if (['ready', 'backup-required'].includes(authority.getSnapshot().phase)) {
      requestedAccount.current = undefined;
      savedRecoveryOutcome = null; setRecoveryOutcome(null);
    }
    if (requested && current && authority.getSnapshot().phase === 'ready' && current.active.accountId !== requested && current.accounts.some((entry) => entry.id === requested)) {
      await local.accounts.execute({ kind: 'select', id: requested }, authority.getSnapshot().revision, current.revision);
    }
    if (authority.getSnapshot().phase === 'ready' && noteRestore.resume()) return;
    if (['ready', 'backup-required'].includes(authority.getSnapshot().phase))
      setStage(authority.getSnapshot().backup === 'confirmed' ? 'choose' : 'backup-auth');
  };

  const createOrImport = () => {
    if (password !== confirmation) { setError('Your passwords do not match.'); return; }
    if (!isNativeNewPassword(password)) {
      setError(NEW_PASSWORD_HELP); return;
    }
    const enteredPassword = password; const enteredPhrase = phrase; const importing = stage === 'import';
    clearSecrets();
    const useDeviceUnlock = enrollDeviceUnlock && deviceUnlockStatus?.available;
    void perform(async (local) => {
      const { authority } = local;
      if (importing) await authority.importPhrase(enteredPhrase, enteredPassword);
      else await authority.create(enteredPassword);
      if (useDeviceUnlock && ['ready', 'backup-required'].includes(authority.getSnapshot().phase)) {
        const captured = epoch.current;
        await authority.setDeviceUnlock(true, enteredPassword, () => {
          if (!mounted.current || controllers.current !== local || epoch.current !== captured || AppState.currentState !== 'active') throw new Error('CANCELLED');
        });
      }
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
      previewUtxo: (...args: Parameters<NativeImportView['previewUtxo']>) => local.imports.previewUtxo(...args),
      submit: (...args: Parameters<NativeImportView['submit']>) => local.imports.submit(...args),
      cancel: () => {
        const now = local.authority.getSnapshot();
        if (controllers.current === local && importRequest.current.token === token && importRequest.current.active &&
            now.phase === 'authenticating' && now.revision === context.revision + 1) local.imports.cancel();
      },
    });
    const network = findUtxoNetwork(context.account.network, current.utxoNetworks);
    setImportScope({ contextRevision: context.revision, catalogueRevision: current.revision, utxo: !!network,
      utxoAddressTypes: network && UTXO_IMPORT_TYPES.filter((type) => supportsUtxoSoftwareCustody(network, type === 'p2tr' ? 1 : 0)),
      networkLabel: network?.name ?? getNativeSendContext(context.account.network, current.networks).name, token, imports: scoped });
    setStage('import-key');
  };
  const locked = snapshot.phase === 'locked';
  const unavailable = snapshot.phase === 'unavailable' || !!error && !protectedScreen;
  const title = locked ? 'Welcome back' : snapshot.phase === 'ready' && stage === 'choose' ? 'Your wallet' :
    stage === 'words' ? 'Your recovery phrase' : stage === 'challenge' ? 'Check your backup' :
    stage === 'device-unlock' ? 'Biometric unlock' : stage === 'backup-auth' ? 'Back up your wallet' : stage === 'import' ? 'Restore your wallet' : stage === 'create' ? 'Protect your wallet' : 'Make it yours';
  const accountLabel = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId)?.label ?? 'Account 1';
  const selectWatch = (selection: import('../core/accountDirectory').AccountSelection) => {
    if (selection.kind !== 'watch') return;
    // Revoke credentials, reviews, transfer work and secret presentation before routing.
    revoke();
    bridge.current?.onSelectWatch(selection);
  };
  if ((stage === 'choose' || stage === 'connections') && snapshot.phase === 'ready' && connectionSnapshot?.preparationReview && connectionView)
    return <NativeSmartPreparationReview key={connectionSnapshot.preparationReview.id} review={connectionSnapshot.preparationReview} controller={connectionView} />;
  if ((stage === 'choose' || stage === 'connections') && snapshot.phase === 'ready' && connectionSnapshot?.psbtReview && connectionView)
    return <NativePsbtReview key={connectionSnapshot.psbtReview.id} review={connectionSnapshot.psbtReview} controller={connectionView} ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined} />;
  if ((stage === 'choose' || stage === 'connections') && snapshot.phase === 'ready' && connectionSnapshot?.sentryReview && connectionView)
    return <NativeSentryReview key={connectionSnapshot.sentryReview.id} review={connectionSnapshot.sentryReview} controller={connectionView} />;
  if ((stage === 'choose' || stage === 'connections') && snapshot.phase === 'ready' && connectionSnapshot?.controlReview && connectionView)
    return <NativeDappControlReview key={connectionSnapshot.controlReview.id} review={connectionSnapshot.controlReview} controller={connectionView} />;
  if ((stage === 'choose' || stage === 'connections') && snapshot.phase === 'ready' && signingReview && connectionView)
    return signingReview.kind === 'encryption'
      ? <NativeEncryptionReviewScreen key={signingReview.id} review={signingReview} controller={connectionView} />
      : signingReview.kind === 'smart-transaction'
      ? <NativeSmartTransactionReviewScreen key={signingReview.id} review={signingReview} controller={connectionView} ledgerConnection={ledgerConnection ?? undefined} />
      : signingReview.kind === 'transaction'
      ? <NativeTransactionReviewScreen key={signingReview.id} review={signingReview} controller={connectionView} ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined} />
      : <NativeMessageReviewScreen key={signingReview.id} review={signingReview} controller={connectionView} ledgerConnection={selectedAccountType === 'Ledger' || selectedAccountType === 'SmartAccount' ? ledgerConnection ?? undefined : undefined} />;
  if ((stage === 'choose' || stage === 'connections') && snapshot.phase === 'ready' && connectionView && connectionSnapshot?.callsStatus)
    return <NativeCallsStatus key={connectionSnapshot.callsStatus.id} view={connectionSnapshot.callsStatus} controller={connectionView} />;
  if (stage === 'connections' && snapshot.phase === 'ready' && connectionView)
    return <NativeConnections controller={connectionView} incomingPairing={incomingPairing} onPairingHandled={onPairingHandled}
      initialScan={scanIntentExpiresAt !== null} onScanStarted={scanStarted} onScanFinished={scanFinished} onBack={() => {
      scanFinished();
      if (incomingPairing) onPairingHandled?.(incomingPairing.id);
      closeStage();
    }} />;
  if (stage === 'recovery' && recoveryFlow) return <NativeRecovery flow={recoveryFlow} />;
  if (stage === 'remove-wallet' && removalScope) return <NativeWalletRemovalScreen removal={removalScope.local.removal}
    isCurrent={() => removalCurrent(removalScope)} confirm={(ticket, check) => confirmRemoval(removalScope, ticket, check)}
    onBack={() => {
      if (removalRef.current !== removalScope || removalScope.phase !== 'reviewing') return;
      removalRef.current = null; setRemovalScope(null);
      setStage(removalScope.local.authority.getSnapshot().phase === 'ready' ? 'security' : 'choose');
    }} onContinue={(outcome) => finishRemoval(removalScope, outcome)} />;
  if (stage === 'accounts' && accounts && snapshot.phase !== 'authenticating')
    return <WalletAccounts {...accounts} catalogue={catalogue} active={catalogue ? nativeAccountSelection(catalogue.active.accountId) : null}
      onBack={closeStage} onSelect={async (selection) => {
        if (selection.kind === 'watch') { selectWatch(selection); return; }
        if (snapshot.phase === 'ready' && accountView && catalogue && selection.id !== catalogue.active.accountId)
          await accountView.execute({ kind: 'select', id: selection.id }, accountView.getContextRevision(), catalogue.revision);
        setStage('choose');
      }} onManageHd={snapshot.phase === 'ready' && accountView ? () => setStage('manage-hd') : undefined}
      onAdd={async (input) => { revoke(); setStage('accounts'); await accounts.onAdd(input); }} />;
  if (stage === 'trezor' && trezorView && snapshot.phase === 'ready')
    return <NativeTrezor controller={trezorView} onBack={() => {
      void controllers.current?.connections.cancelSigningHandoff().catch(() => undefined);
      if (rootOrigin.current?.stage === 'trezor') closeStage(); else setStage('manage-hd');
    }} onImported={() => { rootOrigin.current = null; setStage('choose'); }} onResumeSend={async (intent: NativeTrezorResumeIntent) => {
      const local = controllers.current;
      const current = readyContext();
      const captured = local?.authority.getCatalogue();
      if (!current || !captured || AppState.currentState !== 'active' ||
          captured.active.accountId !== intent.accountId || captured.active.networkId !== intent.networkId)
        throw new Error('CANCELLED');
      if (intent.kind === 'external-psbt' || intent.kind === 'external-signing') {
        if (!local) throw Error('CANCELLED');
        const resumeEpoch = epoch.current;
        await local.connections.resumeSigning(intent.id);
        if (controllers.current === local && epoch.current === resumeEpoch && AppState.currentState === 'active') setStage('choose');
        return;
      }
      if (intent.kind === 'smart-operation') {
        rootOrigin.current = {tab: shell.tab, stage: 'smart-resume', ...current, epoch: epoch.current};
        setSmartResumeId(intent.id);
        setStage('smart-resume');
        return;
      }
      const resume = trezorResumeDraft(intent);
      const target: SendTarget = resume.kind === 'utxo' ? { kind: 'utxo', asset: resume.asset }
        : resume.kind === 'replacement' ? { kind: resume.replacement.mode, hash: resume.replacement.originalHash }
        : resume.kind === 'token' ? { kind: 'token', token: resume.token }
        : resume.kind === 'collectible' ? { kind: 'collectible', collectible: resume.collectible }
        : { kind: 'native' };
      const origin: RootOrigin = { tab: shell.tab, stage: 'send', ...current, epoch: epoch.current };
      rootOrigin.current = origin;
      setSendDraft({ origin, target, resume, resumeId: intent.id });
      setStage('send');
    }} />;
  if (stage === 'ledger' && ledgerView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeLedger controller={ledgerView} onBack={() => setStage('manage-hd')} onFinished={() => {
      rootOrigin.current = null; setStage('choose');
    }} />;
  if (stage === 'manage-hd' && accountView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeAccounts controller={accountView} networkLabel={utxo?.name} onTrezor={trezorView ? () => setStage('trezor') : undefined} onLedger={ledgerView ? () => setStage('ledger') : undefined} onImport={canSign || canSendUtxo ? openImport : undefined} onBack={() => setStage(accounts ? 'accounts' : 'choose')} />;
  if (stage === 'import-key' && importScope && ['ready', 'authenticating'].includes(snapshot.phase) &&
      (snapshot.revision === importScope.contextRevision || importActiveToken === importScope.token && snapshot.revision === importScope.contextRevision + 1))
    return <NativeImport key={`${importScope.token}:${importScope.contextRevision}:${importScope.catalogueRevision}`} imports={importScope.imports} contextRevision={importScope.contextRevision} catalogueRevision={importScope.catalogueRevision}
      networkLabel={importScope.networkLabel} utxo={importScope.utxo} utxoAddressTypes={importScope.utxoAddressTypes}
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
  if (sentryRoute && sentry) return <NativeSentryHub key={sentryScope!.context}
    networkLabel={utxo!.name} openKeys={sentry.openKeys} openNodes={sentry.openNodes} onBack={closeStage} />;
  if (stage === 'auto-lock' && snapshot.phase === 'ready' && saveIdle) return <AutoLockSettings mode="custody" save={saveIdle} onBack={closeStage} />;
  if (stage === 'private-notes' && snapshot.phase === 'ready') return <NativeNoteFilesMenu onBack={closeStage}
    onDeposit={canDeposit ? () => {
      if (AppState.currentState === 'active' && readyContext()) setStage('note-deposit');
    } : undefined}
    onExport={() => { if (noteRestore.begin('export')) setStage('backup-notes'); }}
    onRestore={() => { if (noteRestore.begin('restore')) setStage('restore-notes'); }}
    onImport={openNoteImport ? () => {
      if (AppState.currentState === 'active' && readyContext()) setStage('note-import');
    } : undefined}
    onInventory={readNoteInventory ? () => {
      if (AppState.currentState === 'active' && readyContext()) setStage('note-inventory');
    } : undefined}
    onMaintenance={openNoteMaintenance && catalogue?.networks.find(network => network.id === catalogue.active.networkId)?.chainId === String(PRIVACY_CHAIN_ID) ? () => {
      if (AppState.currentState === 'active' && readyContext()) setStage('note-maintenance');
    } : undefined}
    onPrivacySettings={openPrivacyControls && catalogue?.networks.find(network => network.id === catalogue.active.networkId)?.chainId === String(PRIVACY_CHAIN_ID) ? () => {
      if (AppState.currentState === 'active' && readyContext()) setStage('privacy-settings');
    } : undefined}
    onCapacity={openNoteCapacity ? () => {
      if (AppState.currentState === 'active' && readyContext()) setStage('note-capacity');
    } : undefined} />;
  if (stage === 'note-inventory' && snapshot.phase === 'ready' && protectedScreen && readNoteInventory) return <NativeNoteInventory
    key={snapshot.revision} readInventory={readNoteInventory} onBack={() => setStage('private-notes')} onLock={revoke} />;
  if (stage === 'note-import' && snapshot.phase === 'ready' && protectedScreen && openNoteImport) return <NativeNoteImport
    key={snapshot.revision} openImport={openNoteImport} onBack={() => setStage('private-notes')} />;
  if (stage === 'note-deposit' && snapshot.phase === 'ready' && protectedScreen && canDeposit && openPrivateDeposit) return <NativePrivateDeposit
    key={snapshot.revision} open={openPrivateDeposit} onBack={() => setStage('private-notes')}
    onBackup={() => { if (noteRestore.begin('export')) setStage('backup-notes'); }}
    onActivity={activityView ? (hash) => {
      const current = readyContext();
      if (!current || current.context !== guardianContext || AppState.currentState !== 'active' || !/^0x[0-9a-f]{64}$/i.test(hash)) return;
      setDepositActivity({ context: current.context, hash });
      rootOrigin.current = null;
      setStage('choose');
      shell.restoreRoot('activity', current.identity);
    } : undefined} />;
  if (stage === 'note-maintenance' && snapshot.phase === 'ready' && protectedScreen && openNoteMaintenance) return <NativeNoteMaintenance
    key={snapshot.revision} open={openNoteMaintenance} onBack={closePrivateLeaf} />;
  if (stage === 'privacy-settings' && snapshot.phase === 'ready' && protectedScreen && openPrivacyControls) return <NativePrivacyControls
    key={snapshot.revision} open={openPrivacyControls} onBack={closePrivateLeaf} />;
  if (stage === 'note-capacity' && snapshot.phase === 'ready' && openNoteCapacity) return <NativeNoteCapacity
    key={snapshot.revision} openCapacity={openNoteCapacity} onBack={() => setStage('private-notes')} />;
  if (stage === 'restore-notes' && snapshot.phase === 'ready') return <NativeNoteRestore
    step={noteRestore.step} busy={noteRestore.busy} error={noteRestore.error}
    onChoose={noteRestore.choose} onOpen={noteRestore.open} onRestore={noteRestore.restore}
    onBack={() => { cancelNoteRestore(); setStage('private-notes'); }} />;
  if (stage === 'backup-notes' && snapshot.phase === 'ready') return <NativeNoteExport
    step={noteRestore.exportStep} busy={noteRestore.busy} error={noteRestore.error}
    onChoose={noteRestore.choose} onSave={noteRestore.saveExport} onShowVerify={noteRestore.showVerify} onVerify={noteRestore.verifyExport}
    onBack={() => { cancelNoteRestore(); setStage('private-notes'); }} />;
  if (stage === 'security' && snapshot.phase === 'ready' && catalogue && snapshot.account && keyExportView) {
    const selected = catalogue.accounts.find((account) => account.id === catalogue.active.accountId)!;
    const extended = selected.type === 'HDAccount' || selected.utxoExtended;
    const script = utxo && !extended ? findWifAddressType(selected.address, utxo) : undefined;
    const keyFormat = selected.type === 'Ledger' || selected.type === 'Trezor' ? null : canSign ? 'evm' : utxo && extended
      ? { kind: 'extended' as const, networkLabel: utxo.name, addressType: UTXO_IMPORT_LABELS.p2wpkh }
      : utxo && script ? { kind: 'wif' as const, networkLabel: utxo.name, addressType: UTXO_IMPORT_LABELS[script] } : null;
    return <NativeSecurity key={`${snapshot.revision}:${catalogue.active.accountId}:${snapshot.account.network}`}
      keyExport={keyExportView} keyFormat={keyFormat} accountId={selected.id} accountType={selected.type} accountLabel={accountLabel} address={snapshot.account.address}
      onBack={closeStage} onLock={revoke} onViewRecovery={() => setStage('backup-auth')}
      onRemoveWallet={onWalletRemoved && canRemoveWallet ? openRemoval : undefined}
      onDeviceUnlock={deviceUnlockStatus && (deviceUnlockStatus.available || deviceUnlockStatus.enabled) ? () => setStage('device-unlock') : undefined}
      deviceUnlockEnabled={deviceUnlockStatus?.enabled}
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
  }
  const restoreUnconfirmed = stage === 'restore-notes' && noteRestore.step.phase === 'unconfirmed';
  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (unavailable) body = restoreUnconfirmed ? <NoteRestoreUnconfirmedNotice reopen /> :
    <Notice title="Wallet unavailable" body="Your saved wallet has been preserved. Close and reopen Pali to try again." tone="amber" />;
  else if (!protectedScreen || snapshot.phase === 'opening') body = <View style={s.center}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Opening your wallet securely…</Text></View>;
  else if (snapshot.phase === 'authenticating') body = <View style={s.center}><ActivityIndicator color={colors.pink} /><Text style={styles.muted}>Unlocking your wallet securely…</Text></View>;
  else if (locked) {
    footer = <>
      {deviceUnlockStatus?.available && deviceUnlockStatus.enabled && <Button title="Unlock with biometrics" disabled={busy} onPress={() => {
      clearSecrets();
      void perform(async (local) => {
        const captured = epoch.current;
        await local.authority.unlockWithDevice(() => {
          if (!mounted.current || controllers.current !== local || epoch.current !== captured || AppState.currentState !== 'active') throw new Error('CANCELLED');
        });
        await finishUnlock(local);
      });
    }} />}
      <Button title="Unlock wallet" variant={deviceUnlockStatus?.available && deviceUnlockStatus.enabled ? 'secondary' : 'primary'} disabled={busy || !password} onPress={() => {
      const entered = password; setPassword(''); void perform(async (local) => {
        await local.authority.unlock(entered);
        await finishUnlock(local);
      });
    }} />
    </>;
    body = <>
    {restoreUnconfirmed && <NoteRestoreUnconfirmedNotice />}
    <Text style={styles.muted}>Enter your password to unlock this device.</Text>
    <SecretInput label="Password" value={password} onChange={setPassword} disabled={busy} />


    <Button title="Forgot password?" variant="quiet" disabled={busy} onPress={openRecovery} />
    {accounts && !busy && <Button title="View watch accounts" variant="secondary" onPress={() => { cancelNoteRestore(); revoke(); setStage('accounts'); }} />}
  </>;
  }
  else if (snapshot.phase === 'empty' && stage === 'choose') {
    footer = <>
      <Button title="Create a wallet" onPress={() => setStage('create')} />
      <Button title="I have a recovery phrase" variant="secondary" onPress={() => setStage('import')} />
    </>;
    body = <>
    <PaliMark size={72} /><Text style={styles.h1}>A wallet that stays yours.</Text>
    <Text style={styles.muted}>Create a recovery phrase, or bring one you already own.</Text>


    {accounts && <Button title="View watch accounts" variant="quiet" onPress={() => setStage('accounts')} />}
  </>;
  }
  else if (snapshot.phase === 'empty') {
    footer = <>
      <Button title={stage === 'import' ? 'Restore wallet' : 'Create wallet'} disabled={busy || !password || !confirmation || stage === 'import' && !phrase} onPress={createOrImport} />
    </>;
    body = <>
    {stage === 'import' && <SecretInput label="Recovery phrase" multiline value={phrase} onChange={setPhrase} disabled={busy} />}
    <Text style={styles.muted}>{stage === 'import' ? 'Enter your 12 or 24 words in order.' : 'Pali will create a new 12-word recovery phrase.'} {NEW_PASSWORD_HELP}</Text>
    <SecretInput label="New password" value={password} onChange={setPassword} disabled={busy} />
    <SecretInput label="Confirm password" value={confirmation} onChange={setConfirmation} disabled={busy} />
    <Notice title="Your password stays on this device" body="Your recovery phrase can restore your wallet without this password. Keep it private and backed up offline." />
    {deviceUnlockStatus?.available && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View style={{ flex: 1 }}><Text>Use biometric unlock</Text><Text style={styles.muted}>Your password remains available.</Text></View>
      <Switch accessibilityLabel="Use biometric unlock" value={enrollDeviceUnlock} onValueChange={setEnrollDeviceUnlock} disabled={busy} trackColor={{ true: colors.pink }} />
    </View>}

  </>;
  }
  else if (stage === 'device-unlock' && deviceUnlockStatus) {
    footer = <>
      <Button title={deviceUnlockStatus.enabled ? 'Turn off biometric unlock' : 'Enable biometric unlock'} disabled={busy || !password || !deviceUnlockStatus.enabled && !deviceUnlockStatus.available} onPress={() => {
      const entered = password, enabled = !deviceUnlockStatus.enabled;
      setPassword('');
      void perform(async (local) => {
        const captured = epoch.current;
        await local.authority.setDeviceUnlock(enabled, entered, () => {
          if (!mounted.current || controllers.current !== local || epoch.current !== captured || AppState.currentState !== 'active') throw new Error('CANCELLED');
        });
        if (local.authority.getSnapshot().phase === 'ready') setStage('security');
      });
    }} />
      <Button title="Cancel" variant="secondary" onPress={closeDeviceUnlock} />
    </>;
    body = <>
    <Text style={{ fontSize: 22, fontWeight: '600' }}>Biometric unlock is {deviceUnlockStatus.enabled ? 'on' : 'off'}</Text>
    <Text style={styles.muted}>{deviceUnlockStatus.enabled ? 'Confirm your wallet password to turn off biometric unlock.' : 'Confirm your wallet password and device biometrics to enable faster unlock.'} Your password remains available.</Text>
    <SecretInput label="Wallet password" value={password} onChange={setPassword} disabled={busy} />


  </>;
  }
  else if (stage === 'words' && presentation) {
    footer = <>
      <Button title="I've written them down" onPress={() => setStage('challenge')} />
    </>;
    body = <>
    <Notice title="Write these words down in order" body="Anyone with these words can control your wallet. Keep them offline. Pali support will never ask for them." tone="amber" />
    <View style={s.wordGrid}>{presentation.words.map((word, index) => <View key={index} style={s.word}><Text style={s.wordNumber}>{index + 1}</Text><Text style={s.wordText}>{word}</Text></View>)}</View>

  </>;
  }
  else if (stage === 'challenge' && presentation) {
    footer = <>
      <Button title="Confirm backup" disabled={busy || answers.some((answer) => !answer.trim())} onPress={() => {
      const id = presentation.id; const entered = [...answers];
      void perform(async ({ authority, backup }) => { await backup.confirm(id, entered); if (authority.getSnapshot().phase === 'ready') { clearSecrets(); closeStage(); } });
    }} />
    </>;
    body = <>
    <Text style={styles.muted}>Use your written backup to fill in these words.</Text>
    {presentation.positions.map((position, index) => <SecretInput key={position} label={`Word ${position + 1}`} value={answers[index]!} disabled={busy} onChange={(value) => setAnswers((old) => old.map((answer, i) => i === index ? value : answer))} />)}

  </>;
  }
  else if (snapshot.phase === 'backup-required' || stage === 'backup-auth' || stage === 'words' || stage === 'challenge') {
    footer = <>
      <Button title="Show recovery phrase" disabled={busy || !password} onPress={() => {
      const entered = password; setPassword('');
      void perform(async ({ backup, authority }) => {
        const shown = await backup.begin(entered);
        if (AppState.currentState === 'active' && ['ready', 'backup-required'].includes(authority.getSnapshot().phase)) { setPresentation(shown); setStage('words'); }
      });
    }} />
    </>;
    body = <>
    <Text style={styles.muted}>Your recovery phrase restores this wallet’s derived accounts if you lose your phone. Imported accounts need their original private keys backed up separately.</Text>
    <SecretInput label="Confirm your password" value={password} onChange={setPassword} disabled={busy} />

    <Button title="Lock wallet" variant="quiet" onPress={revoke} />
  </>;
  }
  else if (snapshot.phase === 'ready' && stage === 'slh-dsa' && openSlhDsaManagement) return <NativeSlhDsaManagementScreen ledgerConnection={ledgerConnection ?? undefined} open={openSlhDsaManagement} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && stage === 'smart-infrastructure' && openSmartInfrastructure) return <NativeInfrastructureScreen ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined} open={openSmartInfrastructure} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && stage === 'smart-modules' && openSmartAccountModules) return <NativeSmartAccountModulesScreen ledgerConnection={ledgerConnection ?? undefined} open={openSmartAccountModules} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && stage === 'smart-authenticator' && openWalletAuthenticator) return <NativeSmartAccountAuthenticator ledgerConnection={ledgerConnection ?? undefined}
    open={openWalletAuthenticator} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && stage === 'smart-deploy' && openSmartDeployment) return <NativeSmartAccountOperationRoute ledgerConnection={ledgerConnection ?? undefined}
    open={openSmartDeployment} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && stage === 'smart-resume' && smartResumeId) return <NativeSmartAccountOperationRoute ledgerConnection={ledgerConnection ?? undefined}
    key={smartResumeId} open={openResumedSmartOperation} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && (sendTarget?.kind === 'native' || sendTarget?.kind === 'token' || sendTarget?.kind === 'collectible') && canSendSmart && openSmartSend && snapshot.account && publicSource && balanceReader)
    return <NativeSmartAccountSend ledgerConnection={ledgerConnection ?? undefined} recipientResolver={recipientResolver} account={{ ...snapshot.account, revision: snapshot.revision }} source={publicSource} reader={balanceReader} tokenView={tokenView ?? undefined} token={sendTarget.kind === 'token' ? sendTarget.token : undefined} collectible={sendTarget.kind === 'collectible' ? sendTarget.collectible : undefined} open={openSmartSend} context={getNativeSendContext(snapshot.account.network, catalogue?.networks)} accountLabel={accountLabel} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && sendTarget && sendTarget.kind !== 'spt' && sendTarget.kind !== 'utxo' && canSign && transferView && snapshot.account) return <NativeSend recipientResolver={recipientResolver} key={sendDraft?.resumeId}
    beforeClose={selectedAccountType === 'Trezor' ? trezorView?.cancel : undefined}
    initialDraft={sendDraft?.resume && sendDraft.resume.kind !== 'utxo' ? sendDraft.resume.draft : undefined}
    account={{ ...snapshot.account, revision: snapshot.revision }}
    ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined}
    tokenView={tokenView ?? undefined}
    controller={transferView} context={getNativeSendContext(snapshot.account.network, catalogue?.networks)}
    recipientPicker={sendDraft?.recipientPicker}
    token={sendTarget.kind === 'token' ? sendTarget.token : undefined}
    collectible={sendTarget.kind === 'collectible' ? sendTarget.collectible : undefined}
    savedHash={sendTarget.kind === 'saved' ? sendTarget.hash : undefined}
    replacement={sendTarget.kind === 'cancel' || sendTarget.kind === 'cancel-saved' || sendTarget.kind === 'speed-up' ? { hash: sendTarget.hash, mode: sendTarget.kind } : undefined}
    accountLabel={accountLabel} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && (sendTarget?.kind === 'native' || sendTarget?.kind === 'spt' && canSendSpt || sendTarget?.kind === 'utxo') && utxo && canSendUtxo && openUtxoSend)
    return <NativeUtxoSendScreen beforeClose={selectedAccountType === 'Trezor' ? trezorView?.cancel : undefined} initialDraft={sendDraft?.resume?.kind === 'utxo' ? sendDraft.resume.draft : undefined} key={sendDraft?.resumeId ?? snapshot.revision} network={utxo} open={openUtxoSend}
      ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined}
      asset={sendTarget.kind === 'spt' || sendTarget.kind === 'utxo' ? sendTarget.asset : undefined} maximumAmount={sendTarget.kind === 'spt' ? sendTarget.maximumAmount : undefined} accountLabel={accountLabel} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && publicSource) {
    const onAccounts = () => openStage(accounts ? 'accounts' : 'manage-hd');
    let content: React.ReactNode;
    if (shell.tab === 'wallet') content = <NativePortfolio
    hardwareRequest={trezorView ? <NativeTrezorResumeNotice controller={trezorView} onResume={() => openStage('trezor')} /> : undefined}
    smartAccount={selectedCatalogueAccount?.smartAccount}
    onManageSmartAccountModules={selectedCatalogueAccount?.smartAccount?.isDeployed && canManageModules && openSmartAccountModules ? () => openStage('smart-modules') : undefined}
    onManageSlhDsa={canManageSlh && openSlhDsaManagement ? () => openStage('slh-dsa') : undefined}
    onUseWalletAuthenticator={canUseWalletAuthenticator && openWalletAuthenticator ? () => openStage('smart-authenticator') : undefined}
    onDeploySmartAccount={selectedCatalogueAccount?.smartAccount && !selectedCatalogueAccount.smartAccount.isDeployed && openSmartDeployment ? () => openStage('smart-deploy') : undefined}
    reader={balanceReader ?? undefined}
    tokenView={tokenView ?? undefined}
    source={publicSource} accountLabel={accountLabel} onManageAccounts={accounts || accountView ? onAccounts : undefined} onExit={exit} onLock={revoke}
    onSend={canSign || canSendUtxo || canSendSmart ? () => openStage('send', { kind: 'native' }) : undefined}
    onSendSpt={canSendSpt ? asset => openStage('send', { kind: 'spt', asset, maximumAmount: formatBaseUnits(sptBalanceTotalUnits(asset), asset.decimals) }) : undefined}
    onSendToken={canSign || canSendSmart ? (token) => openStage('send', { kind: 'token', token }) : undefined}
    onSendCollectible={canSign || canSendSmart ? (collectible) => openStage('send', { kind: 'collectible', collectible }) : undefined}
    onManageNetworks={networkView ? () => openStage('networks') : undefined}
    onViewRecovery={() => openStage('backup-auth')} onSecurity={() => openStage('security')}
    onActivity={(utxo ? utxoActivityView : activityView) ? () => shell.select('activity') : undefined}
    navigation={shell.navigation}
  />;
    else if (shell.tab === 'activity') content = utxo && utxoActivityView
      ? <UtxoActivityScreen authority={utxoActivityView} selectedNetwork={utxo} accountLabel={accountLabel}
          onBack={() => shell.finishLeave('wallet')} navigation={shell.navigation} />
      : activityView && !utxo
      ? <NativeActivityScreen controller={activityView} accountLabel={accountLabel}
          initialHash={depositActivity && depositActivity.context === guardianContext ? depositActivity.hash : recoveryActivity && recoveryActivity.context === guardianContext ? recoveryActivity.hash : undefined}
          onReplay={canSign ? (hash) => openStage('send', { kind: 'saved', hash }) : undefined}
          onCancelPending={canSign ? (hash) => openStage('send', { kind: 'cancel', hash }) : undefined}
          onCancelSaved={canSign ? (hash) => openStage('send', { kind: 'cancel-saved', hash }) : undefined}
          onSpeedUpPending={canSign ? (hash) => openStage('send', { kind: 'speed-up', hash }) : undefined}
          onBack={() => shell.finishLeave('wallet')} navigation={shell.navigation} />
      : <UnavailableActivity accountLabel={accountLabel} watchOnly={false} onBack={() => shell.select('wallet')} />;
    else if (shell.tab === 'tools') content = <RealTools accountLabel={accountLabel} guardianRecovery={guardianRecovery}
      onGuardianClose={closeGuardian}
      initialGuardianScope={resumeGuardianScope} onGuardianOpened={() => setResumeGuardianScope(null)}
      connections={connectionView ?? undefined}
      incomingPairing={incomingPairing} onPairingHandled={onPairingHandled}
      initialScan={scanIntentExpiresAt !== null} onScanStarted={scanStarted} onScanFinished={scanFinished}
      networkLabel={utxo?.name ?? EVM_NETWORK_DEFINITIONS.find((network) => network.id === snapshot.account?.network)?.name ?? 'Network unavailable'} watchOnly={false}
      onAccounts={onAccounts} onNetworks={networkView ? () => openStage('networks') : undefined}
      onPrivateNotes={() => openStage('private-notes')}
      onSentryKeys={sentryAvailable ? () => openStage('sentry-keys') : undefined}
      onBack={() => shell.select('wallet')} navigation={shell.navigation} />;
    else content = <RealSettings navigation={shell.navigation} accountLabel={accountLabel} watchOnly={false} onSecurity={() => openStage('security')} onAutoLock={() => openStage('auto-lock')}
      onInfrastructure={canSign && openSmartInfrastructure && !utxo && (selectedAccountType === 'HDAccount' || selectedAccountType === 'Imported' || selectedAccountType === 'Ledger' && !!ledgerConnection) ? () => openStage('smart-infrastructure') : undefined}
      activityReset={canSign && catalogue && snapshot.account ? {
        scope: custodyContext(snapshot, catalogue)!.context,
        networkLabel: getNativeNetwork(snapshot.account.network, catalogue.networks).name,
        async reset(assertView) {
          const local = controllers.current;
          const expected = custodyContext(snapshot, catalogue)!.context;
          const check = () => {
            assertView();
            if (!mounted.current || !local || local !== controllers.current || AppState.currentState !== 'active' ||
                readyContext()?.context !== expected) throw new Error('CANCELLED');
          };
          check();
          await local!.resetActivity(check);
          check();
        },
      } : undefined}
      onLock={revoke} onBack={() => shell.select('wallet')} />;
    return <RealAppShell tab={shell.tab} onTab={shell.select} immersive={shell.immersive}>
      {recoveryActivity && recoveryActivity.context === guardianContext && <Button title="Return to recovery" variant="secondary" onPress={() => void returnToRecovery().catch(() => undefined)} />}
      {content}
    </RealAppShell>;
  }
  else body = <Notice title="Wallet unavailable" body="Close and reopen Pali to try again." tone="amber" />;

  const duplicateAuthenticationError = (snapshot.error === 'INVALID_CREDENTIAL' || snapshot.error === 'AUTH_THROTTLED' || snapshot.error === 'DEVICE_UNLOCK_UNAVAILABLE') &&
    error === message(new Error(snapshot.error));
  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={footer} gap={16}><Header title={title} onBack={stage === 'device-unlock' ? closeDeviceUnlock : exit} subtitle={typeof __DEV__ !== 'undefined' && __DEV__ ? 'Development build · Use a test wallet' : undefined} />
        {recoveryOutcome && <Notice title={recoveryOutcome.kind === 'success' ? 'Password change completed' : recoveryOutcome.kind === 'uncertain' ? 'Check your password' : 'Recovery update'} body={recoveryOutcome.message + (recoveryOutcome.cleanupFailed ? ' The wallet could not be reopened. Close and reopen Pali to unlock.' : '')} tone={recoveryOutcome.kind === 'success' ? undefined : 'amber'} />}
        {noteRestore.step.phase === 'unconfirmed' && <Notice title="Restore could not be confirmed" body="Open this backup again after unlocking to see which notes are already saved." tone="amber" />}
        {snapshot.error && !duplicateAuthenticationError && <NativeCustodyFeedback error={snapshot.error} />}
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        {body}
        {busy && <ActivityIndicator accessibilityLabel="Working" color={colors.pink} />}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  field: { gap: 10 }, label: { color: colors.muted, fontSize: 13, fontWeight: '500', letterSpacing: 0.2 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 52, fontSize: 16 },
  phraseInput: { minHeight: 120, textAlignVertical: 'top', lineHeight: 26 }, center: { gap: 18, alignItems: 'center', paddingVertical: 50 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, word: { width: '47%', borderRadius: 14, backgroundColor: colors.surface, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordNumber: { color: colors.muted, fontSize: 12, minWidth: 18 }, wordText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  address: { fontSize: 15, lineHeight: 24, marginTop: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
