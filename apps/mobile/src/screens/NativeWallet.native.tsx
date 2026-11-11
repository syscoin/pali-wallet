import type { NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
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
import { useNativeTranslation } from '../platform/localization';
import { AutoLockSettings, type IdlePreferenceSave } from './AutoLockSettings';
import { isWalletPin, PinSetup, PinEntryScreen, PinField } from './PinEntry';
import { useBiometricPresentation } from '../platform/useBiometricPresentation';
import { BackupVerification } from './BackupVerification';
import { nativeAccountSelection } from '../core/accountDirectory';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from 'react-native';
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
import { NativePrivateDeposit, type NativePrivateDepositTask } from './NativePrivateDeposit';
import { useNativeNoteBackup } from './useNativeNoteBackup';
import { ensurePrivacyShield } from '../platform/privacyShield.native';
import type { CustodySnapshot } from '../custody/types';
import type { SeedBackupPresentation } from '../custody/seedBackup';
import { Button, Card, colors, Header, Icon, Notice, PaliMark, Row, Screen, styles, Text } from '../ui';
import { type NativeReceiveContinuation } from './NativePortfolio';
import { NativePortfolioRoute, type NativeAccountDetail } from './NativeAccountOverview';
import { AccountPortfolioController } from '../portfolio/accountPortfolio';
import { AccountActivityController, type AccountActivityRow } from '../activity/accountActivity';
import { portfolioFilter } from '../platform/portfolioFilter';
import { createNativeCoinQuoteReader, nativeCoinQuoteSource } from '../portfolio/nativeCoinQuote';
import { createNativeAssetMarketReader, nativeAssetMarketSource, rememberNativeAssetMarketIcon } from '../portfolio/nativeAssetMarket';
import type { NotificationChoice } from '../notifications/choices';
import { sendDraftForNetwork, NETWORK_CHANGED_DRAFT_NOTICE, type NativeUnsignedSendDraft } from './sendNetworkDraft';
import type { NativeNetworkSelectionReceipt } from '../custody/accounts';
import { NativeSend, type NativeRecipientPicker } from './NativeSend';
import { NativeUtxoSendScreen } from './NativeUtxoSend';
import { NativeSecurity } from './NativeSecurity';
import { NativeWalletRemovalScreen, type RemovalScreenOutcome } from './NativeWalletRemoval';
import { WalletRemovalError, type WalletRemovalTicket } from '../custody/walletRemoval';
import { NativeImport } from './NativeImport';
import { NativeImportWallet } from './NativeImportWallet';
import { BackupIntroduction } from './BackupIntroduction';
import { TransactionAuthentication } from './TransactionAuthentication';
import { NativeOperationAuthentication } from './NativeOperationAuthentication';
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
import { AllNetworksActivity, type AccountActivityAction } from './AllNetworksActivity';
import { UtxoActivityScreen } from './UtxoActivityScreen';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue';
import { NativePortfolioController, sameNativePortfolioAccount, type PublicCustodySource } from '../portfolio/nativePortfolio';
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
import { nativeActivityNotifications, isNotificationPermissionPromptActive } from '../notifications/service';

type Controllers = ReturnType<typeof createNativeWalletControllers>;
const nativeLifecycle = new NativeControllerLifecycle({ create: createNativeWalletControllers, protect: ensurePrivacyShield, recovery: createNativeRecoveryCoordinator });
// Nonsecret operation outcome survives route departure while cleanup is pending.
let savedRecoveryOutcome: RecoveryOutcome | null = null;
type RootOrigin = Readonly<{ tab: RealTab; stage: Stage; context: string; identity: string; epoch: number }>;
type SendTarget = Readonly<
  { kind: 'native' } | { kind: 'spt'; asset: NativeUtxoAsset; maximumAmount: string } | { kind: 'utxo'; asset?: NativeUtxoAsset } | { kind: 'token'; token: Erc20Metadata } |
  { kind: 'collectible'; collectible: SavedCollectible } | { kind: 'saved' | 'cancel' | 'cancel-saved' | 'speed-up'; hash: string }
>;
type NetworkReturn = Readonly<{ local: Controllers; origin: RootOrigin; sourceRevision: number; sourceCatalogueRevision: number } & (
  { kind: 'send'; target: SendTarget; form: NativeUnsignedSendDraft } |
  { kind: 'receive'; continuation: NativeReceiveContinuation }
)>;
type AccountNavigation = Readonly<{ local: Controllers; origin: RootOrigin; choice: NotificationChoice; sourceRevision: number; sourceCatalogueRevision: number }>;
type RemovalScope = { local: Controllers; authority: CustodySnapshot; epoch: number; phase: 'reviewing' | 'working' | 'settled'; outcome?: RemovalScreenOutcome };
type PinChangeScope = { token: object; local: Controllers; authority: CustodySnapshot; catalogue: NativeWalletCatalogueSnapshot; epoch: number; pin: string };
type Stage = 'choose' | 'create' | 'import' | 'import-security' | 'backup-intro' | 'backup-auth' | 'words' | 'backup-complete' | 'backup-verify' | 'change-pin' | 'change-pin-new' | 'send' | 'accounts' | 'manage-hd' | 'networks' | 'security' | 'remove-wallet' | 'import-key' | 'recovery' | 'auto-lock' | 'private-notes' | 'note-inventory' | 'note-import' | 'note-deposit' | 'note-capacity' | 'note-maintenance' | 'privacy-settings' | 'restore-notes' | 'backup-notes' | 'connections' | 'device-unlock' | 'ledger' | 'trezor' | 'smart-deploy' | 'smart-resume' | 'smart-authenticator' | 'slh-dsa' | 'smart-modules' | 'sentry-keys' | 'smart-infrastructure';
const INITIAL: CustodySnapshot = { phase: 'opening', revision: 0, presence: 'unknown', backup: 'unknown', account: null, error: null };
const noBalanceSubscribe = () => () => undefined;
const noBalanceSnapshot = () => null;

function custodyContext(state?: CustodySnapshot, catalogue?: NativeWalletCatalogueSnapshot | null) {
  if (state?.phase !== 'ready' || !state.account || !catalogue) return null;
  const identity = `${catalogue.active.accountId}:${state.account.network}`;
  return { context: `${state.revision}:${identity}`, identity };
}

function message(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_CREDENTIAL') return 'That PIN is incorrect. Please try again.';
  if (code === 'DEVICE_UNLOCK_UNAVAILABLE') return 'Biometric unlock was not completed. Use your PIN to unlock.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect PINs. Wait a few minutes before trying again.';
  if (code === 'BACKUP_WORDS_MISMATCH') return 'The words are not in the right order. Check your written backup and try again.';
  if (code === 'INVALID_INPUT') return 'Check your recovery phrase and PIN.';
  if (code === 'CANCELLED' || code === 'BACKUP_EXPIRED') return 'Your session was locked. Unlock to continue.';
  return 'This operation could not be completed. Your saved wallet has been preserved.';
}

export type NativeWalletProps = { onExit(): void; accounts?: WatchWalletBridge; initialAccountId?: string; initialSetup?: 'create' | 'import'; onSelectedNative?(id: string): void; onWalletRemoved?(): void;
  incomingPairing?: NativePairingEntry | null; onPairingHandled?(id: string): void;
};

export function NativeWalletScreen({ onExit, accounts, initialAccountId, initialSetup, onSelectedNative, onWalletRemoved, incomingPairing, onPairingHandled }: NativeWalletProps) {
  const controllerRef = useRef<Controllers | null>(null);
  return <><NativeWalletContent {...{ onExit, accounts, initialAccountId, initialSetup, onSelectedNative, onWalletRemoved, incomingPairing, onPairingHandled, controllerRef }} /><NativeOperationAuthentication isProtectedPromptActive={() => controllerRef.current?.authentication?.isActive() === true} /></>;
}

export function NativeWalletContent({ onExit, accounts, initialAccountId, initialSetup, onSelectedNative, onWalletRemoved, incomingPairing, onPairingHandled, controllerRef: controllersRef }: NativeWalletProps & { controllerRef: React.MutableRefObject<Controllers | null> }) {
  const { t } = useNativeTranslation();
  const biometrics = useBiometricPresentation();
  const bridge = useRef(accounts);
  const selectedNative = useRef(onSelectedNative);
  useLayoutEffect(() => { bridge.current = accounts; selectedNative.current = onSelectedNative; }, [accounts, onSelectedNative]);
  const requestedAccount = useRef(initialAccountId);
  const requestedSetup = useRef(initialSetup);
  useLayoutEffect(() => { if (incomingPairing) requestedAccount.current = undefined; }, [incomingPairing]);
  const screenToken = useRef<object>({});
  const detachSubscriptions = useRef<() => void>(() => undefined);
  const recoveryRef = useRef<NativeRecoveryFlow | null>(null);
  const removalRef = useRef<RemovalScope | null>(null);
  const pinChangeRef = useRef<PinChangeScope | null>(null);
  const [removalScope, setRemovalScope] = useState<RemovalScope | null>(null);
  const [canRemoveWallet, setCanRemoveWallet] = useState(false);
  const [recoveryFlow, setRecoveryFlow] = useState<NativeRecoveryFlow | null>(null);
  const [recoveryOutcome, setRecoveryOutcome] = useState<RecoveryOutcome | null>(savedRecoveryOutcome);
  const [publicSource, setPublicSource] = useState<PublicCustodySource | null>(null);
  const [controllerOwner, setControllerOwner] = useState<Controllers | null>(null);
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
  const [depositTask, setDepositTask] = useState<NativePrivateDepositTask | null>(null);
  const depositBackupReturn = useRef<{ owner: Controllers; identity: string; task: NativePrivateDepositTask } | null>(null);
  const [depositBackupRoute, setDepositBackupRoute] = useState<{ owner: Controllers; identity: string; task: NativePrivateDepositTask } | null>(null);
  const [transactionActivity, setTransactionActivity] = useState<{ context: string; hash: string } | null>(null);
  const [activityView, setActivityView] = useState<Controllers['activity'] | null>(null);
  const [accountActivity, setAccountActivity] = useState<AccountActivityController | null>(null);
  const [utxoActivityView, setUtxoActivityView] = useState<Controllers['utxoActivity'] | null>(null);
  const [importScope, setImportScope] = useState<{ contextRevision: number; catalogueRevision: number; networkLabel: string; utxo: boolean; utxoAddressTypes?: readonly UtxoImportAddressType[]; token: number; imports: NativeImportView } | null>(null);
  const importRequest = useRef({ token: 0, active: false });
  const [importActiveToken, setImportActiveToken] = useState<number | null>(null);
  const [sendDraft, setSendDraft] = useState<Readonly<{ origin: RootOrigin; target: SendTarget; recipientPicker?: NativeRecipientPicker; resume?: ReturnType<typeof trezorResumeDraft>; resumeId?: string; form?: NativeUnsignedSendDraft; notice?: string }> | null>(null);
  const [portfolioSend, setPortfolioSend] = useState<{ choice: NotificationChoice; target: SendTarget; epoch: number; assertCurrent(): void; release(): void } | null>(null);
  const accountNavigation = useRef<AccountNavigation | null>(null);
  const [portfolioDetail, setPortfolioDetail] = useState<{ owner: Controllers; context: string; detail: NativeAccountDetail } | null>(null);
  const [networkReturn, setNetworkReturn] = useState<NetworkReturn | null>(null);
  const networkReturnOwner = useRef<NetworkReturn | null>(null);
  const [receiveContinuation, setReceiveContinuation] = useState<NativeReceiveContinuation | undefined>(undefined);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const submitting = useRef(false);
  const feedbackRequest = useRef(0);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [protectedScreen, setProtectedScreen] = useState(false);
  const [stage, setStage] = useState<Stage>('choose');
  const notificationSnapshot = useSyncExternalStore(nativeActivityNotifications.subscribe, nativeActivityNotifications.getSnapshot, nativeActivityNotifications.getSnapshot);
  const notificationTransition = useRef<object | null>(null);
  const [notificationWake, setNotificationWake] = useState(0);
  const lastNotificationAttempt = useRef('');
  const notificationView = useRef({ stage, busy: false, immersive: false });
  const sendBalanceModel = useMemo(() => publicSource && balanceReader ? new NativePortfolioController(publicSource, balanceReader) : null, [publicSource, balanceReader]);
  const accountPortfolio = useMemo(() => {
    const local = controllerOwner;
    if (!publicSource || !balanceReader || !local?.getNotificationChoices || !local.readPortfolioAssets) return null;
    const readQuote = createNativeCoinQuoteReader(walletFetch), readMarket = createNativeAssetMarketReader(walletFetch);
    const pendingQuotes = new Map<string, Promise<number | null>>();
    return new AccountPortfolioController({ source: publicSource, reader: balanceReader, choices: () => local.getNotificationChoices(), filter: portfolioFilter,
      assets: (scope, signal, check) => local.readPortfolioAssets(scope, signal, check),
      async nativePrice(choice, currency, signal) {
        const registration = 'kind' in choice.scope.network && choice.scope.network.kind === 'evm' ? choice.scope.network : null;
        const source = nativeCoinQuoteSource(choice.scope.network.id, registration);
        if (!source) return null;
        const key = JSON.stringify([source, currency]);
        let pending = pendingQuotes.get(key);
        if (!pending) { pending = readQuote(source, currency, signal).then(value => value?.price ?? null).finally(() => pendingQuotes.delete(key)); pendingQuotes.set(key, pending); }
        return pending;
      },
      async tokenPrice(choice, token, currency, signal) {
        const registration = 'kind' in choice.scope.network && choice.scope.network.kind === 'evm' ? choice.scope.network : null;
        const asset = { kind: 'token' as const, networkId: choice.scope.network.id, registration, contractAddress: token.contractAddress };
        const source = nativeAssetMarketSource(asset);
        const data = source ? await readMarket(source, currency, signal) : null;
        if (data && !signal.aborted) rememberNativeAssetMarketIcon(asset, data);
        return data?.price ?? null;
      },
    });
  }, [publicSource, balanceReader, controllerOwner]);
  const sendBalance = useSyncExternalStore(sendBalanceModel?.subscribe ?? noBalanceSubscribe, sendBalanceModel?.getSnapshot ?? noBalanceSnapshot, noBalanceSnapshot);
  const showSendBalance = stage === 'send' || stage === 'networks' && networkReturn !== null;
  useEffect(() => showSendBalance ? sendBalanceModel?.connect() : undefined, [showSendBalance, sendBalanceModel]);
  useEffect(() => {
    // Welcome can request a setup screen, but only the real empty-vault result
    // admits it. Never carry that request into an existing or later-reset wallet.
    if (snapshot.presence === 'existing') { requestedSetup.current = undefined; return; }
    if (snapshot.phase !== 'empty' || stage !== 'choose' || !requestedSetup.current) return;
    const target = requestedSetup.current;
    requestedSetup.current = undefined;
    setStage(target);
  }, [snapshot.phase, snapshot.presence, stage]);
  const closePrivateLeaf = useCallback(() => setStage('private-notes'), []);
  const [pin, setPin] = useState('');
  const [pinChangeAttempt, setPinChangeAttempt] = useState(0);
  const [pinChangeOwner, setPinChangeOwner] = useState<object | null>(null);
  const [deviceUnlockStatus, setDeviceUnlockStatus] = useState<Readonly<{ available: boolean; enabled: boolean }> | null>(null);
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [phrase, setPhrase] = useState('');
  const [presentation, setPresentation] = useState<SeedBackupPresentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rootOrigin = useRef<RootOrigin | null>(null);
  const noteRestore = useNativeNoteBackup(() => {
    const local = controllersRef.current;
    return mounted.current && local && !recoveryRef.current &&
      nativeLifecycle.current(screenToken.current) === local && !nativeLifecycle.hasRecovery(screenToken.current) ? local : null;
  }, mode => setStage(mode === 'restore' ? 'restore-notes' : 'backup-notes'));
  const { cancel: cancelNoteRestore, lock: lockNoteRestore } = noteRestore;

  const clearSecrets = useCallback(() => {
    pinChangeRef.current = null;
    setPinChangeOwner(null);
    setPin(''); setPhrase(''); setPresentation(null);
  }, []);
  const revoke = useCallback((background = false) => {
    // The AppState owner records exact Suite suspension before authority.lock
    // synchronously revalidates and removes the old request consent.
    const local = controllersRef.current;
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
    accountNavigation.current = null; setPortfolioSend(null); setPortfolioDetail(null);
    networkReturnOwner.current = null; setNetworkReturn(null); setReceiveContinuation(undefined);
    setSentryScope(null);
    importRequest.current.active = false; setImportActiveToken(null); setImportScope(null);
    controllersRef.current?.authentication?.cancel();
    setRecoveryActivity(null); setResumeGuardianScope(null); setTransactionActivity(null);
    controllersRef.current?.keyExport.cancel(); controllersRef.current?.backup.cancel(); controllersRef.current?.authority.lock();
    Keyboard.dismiss(); clearSecrets(); setSendDraft(null); setSmartResumeId(null); if (!recoveryRef.current && !retainRemoval) setStage('choose'); setError('');
  }, [clearSecrets, lockNoteRestore, controllersRef]);
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
    const local = controllersRef.current;
    return custodyContext(local?.authority.getSnapshot(), local?.authority.getCatalogue());
  }, [controllersRef]);
  const openResumedSmartOperation = useCallback(async (assertView: () => void, signal: AbortSignal, authentication: NativePrivateAuthenticationScope) => {
    if (AppState.currentState !== 'active') throw new Error('CANCELLED');
    const local = controllersRef.current, origin = rootOrigin.current, id = smartResumeId;
    const check = () => {
      assertView();
      if (!local || !id || !origin || origin.stage !== 'smart-resume' || signal.aborted ||
          !mounted.current || controllersRef.current !== local || rootOrigin.current !== origin ||
          epoch.current !== origin.epoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) || readyContext()?.identity !== origin.identity)
        throw new Error('CANCELLED');
    };
    check();
    const operation = await local!.openResumedSmartAccountOperation(id!, signal, check, authentication);
    try { check(); return operation; } catch (error) { await operation.dispose(); throw error; }
  }, [readyContext, smartResumeId, controllersRef]);
  const currentShellScope = () => {
    if (stage !== 'choose') return null;
    const local = controllersRef.current, state = local?.authority.getSnapshot(), saved = local?.authority.getCatalogue();
    if (!state || !saved || !state.account || !['ready', 'backup-required'].includes(state.phase)) return null;
    return `${state.revision}:${saved.active.accountId}:${state.account.network}`;
  };
  const utxo = findUtxoNetwork(snapshot.account?.network, catalogue?.utxoNetworks);
  const sendAvailable = sendBalance?.status === 'available' && sendBalance.units !== null && snapshot.account &&
    sameNativePortfolioAccount(sendBalance.account, { ...snapshot.account, revision: snapshot.revision })
    ? formatBaseUnits(sendBalance.units, utxo?.decimals ?? 18) : undefined;
  const selectedCatalogueAccount = catalogue?.accounts.find(account => account.id === catalogue.active.accountId);
  const publicPortfolioContext = snapshot.account && catalogue && ['ready', 'backup-required'].includes(snapshot.phase)
    ? `${snapshot.revision}:${catalogue.active.accountId}:${snapshot.account.network}` : null;
  const visiblePortfolioDetail = portfolioDetail?.owner === controllerOwner && portfolioDetail.context === publicPortfolioContext ? portfolioDetail.detail : undefined;
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
      open: (draft: Parameters<Controllers['openGuardianPolicy']>[0], signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => openGuardianPolicy(draft, signal, () => {
        assertView();
        if (!mounted.current || epoch.current !== guardianEpoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) || readyContext()?.context !== guardianContext)
          throw new Error('CANCELLED');
      }, authentication),
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
      open: (draft: Parameters<Controllers['guardianRecovery']['open']>[0], signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => guardianRecoveryController.open(draft, signal, () => {
        assertView();
        if (!mounted.current || epoch.current !== guardianEpoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) || readyContext()?.context !== guardianContext)
          throw new Error('CANCELLED');
      }, authentication),
    } : undefined,
    read: (signal: AbortSignal, assertView: () => void) => readGuardianRecovery(signal, () => {
      assertView();
      if (!mounted.current || epoch.current !== guardianEpoch || AppState.currentState !== 'active' || readyContext()?.context !== guardianContext)
        throw new Error('CANCELLED');
    }),
  } : undefined;

  const closeGuardian = useCallback(() => {
    const local = controllersRef.current;
    if (!mounted.current || !local || epoch.current !== guardianEpoch || AppState.currentState !== 'active' ||
        readyContext()?.context !== guardianContext) return;
    const next = local.authority.getCatalogue();
    setCatalogue(next); bridge.current?.onNativeCatalogue(next);
  }, [guardianEpoch, guardianContext, readyContext, controllersRef]);

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
  const shellIdentity = stage === 'choose' && ['ready', 'backup-required'].includes(snapshot.phase) && snapshot.account && catalogue
    ? `${catalogue.active.accountId}:${snapshot.account.network}` : null;
  const shell = useRealShell(shellIdentity, currentShellScope, exit);
  const restoreRoot = shell.restoreRoot;
  useLayoutEffect(() => { notificationView.current = { stage, busy, immersive: shell.immersive }; });
  const notificationOwner = controllerOwner;
  const notificationSettings = notificationOwner && snapshot.account && catalogue && ['ready', 'backup-required'].includes(snapshot.phase) ? {
    scope: `${guardianEpoch}:${snapshot.revision}:${catalogue.revision}`,
    assertCurrent() {
      const current = notificationOwner.authority.getSnapshot(), saved = notificationOwner.authority.getCatalogue();
      if (!mounted.current || controllersRef.current !== notificationOwner || AppState.currentState !== 'active' ||
          current.revision !== snapshot.revision || saved?.revision !== catalogue.revision ||
          !['ready', 'backup-required'].includes(current.phase) || notificationView.current.stage !== 'choose' || rootOrigin.current)
        throw Error('CANCELLED');
    },
    readChoices: () => notificationOwner.getNotificationChoices(),
  } : undefined;
  const notificationCatalogueRevision = catalogue?.revision;
  useEffect(() => {
    const local = controllersRef.current;
    if (!local || !protectedScreen || notificationCatalogueRevision === undefined || !['ready', 'backup-required'].includes(snapshot.phase)) return;
    try {
      const choices = local.getNotificationChoices(), catalogueKey = JSON.stringify(choices);
      const check = () => {
        const current = local.authority.getSnapshot(), saved = local.authority.getCatalogue();
        if (!mounted.current || controllersRef.current !== local || !['ready', 'backup-required'].includes(current.phase) ||
            current.revision !== snapshot.revision || saved?.revision !== notificationCatalogueRevision ||
            JSON.stringify(local.getNotificationChoices()) !== catalogueKey) throw Error('CANCELLED');
      };
      check();
      void nativeActivityNotifications.replaceAccountTypes(['HDAccount', 'Imported', 'SmartAccount', 'Ledger', 'Trezor'], choices.map(choice => choice.scope), check).catch(() => undefined);
    } catch { /* A locked or replaced owner keeps its existing enrollment until current data is available. */ }
  }, [snapshot.phase, snapshot.revision, notificationCatalogueRevision, protectedScreen, controllersRef]);
  const sentryAvailable = snapshot.phase === 'ready' && !!utxo && sentry?.available() === true;
  const sentryRoute = stage === 'sentry-keys' && sentryAvailable &&
    sentryScope?.context === custodyContext(snapshot, catalogue)?.context;
  const openRecoveryActivity = async (payerId: string, chainId: number, hash: string) => {
    const local = controllersRef.current;
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
    if (!mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch || AppState.currentState !== 'active' ||
        !after || !context || after.active.accountId !== payerId || Number(getNativeNetwork(after.active.networkId, after.networks).chainId) !== chainId)
      throw Error('CANCELLED');
    setRecoveryActivity({ local, epoch: capturedEpoch, context: context.context, targetId, payerId, chainId, hash });
    shell.restoreRoot('activity', context.identity);
  };
  const returnToRecovery = async () => {
    const saved = recoveryActivity;
    if (!saved || !mounted.current || controllersRef.current !== saved.local || epoch.current !== saved.epoch ||
        AppState.currentState !== 'active' || readyContext()?.context !== saved.context) return;
    const before = saved.local.authority.getCatalogue();
    if (!before || !before.accounts.some(account => account.id === saved.targetId && account.type === 'SmartAccount' &&
        account.smartAccount?.chainId === saved.chainId)) return;
    setRecoveryActivity(null);
    await saved.local.accounts.execute({ kind: 'select', id: saved.targetId }, saved.local.authority.getSnapshot().revision, before.revision);
    const context = readyContext();
    const after = saved.local.authority.getCatalogue();
    if (!mounted.current || controllersRef.current !== saved.local || epoch.current !== saved.epoch || AppState.currentState !== 'active' ||
        !context || !after || after.active.accountId !== saved.targetId || Number(getNativeNetwork(after.active.networkId, after.networks).chainId) !== saved.chainId) return;
    setResumeGuardianScope(`${saved.epoch}:${context.context}`);
    shell.restoreRoot('tools', context.identity);
  };
  useEffect(() => {
    if (recoveryActivity && (controllersRef.current !== recoveryActivity.local || epoch.current !== recoveryActivity.epoch ||
        readyContext()?.context !== recoveryActivity.context)) setRecoveryActivity(null);
  }, [recoveryActivity, snapshot.revision, readyContext, controllersRef]);
  const openStage = (next: Stage, sendTarget?: SendTarget) => {
    const local = controllersRef.current;
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
            if (AppState.currentState !== 'active' || controllersRef.current !== local ||
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
  const networkRouteCurrent = (route: NetworkReturn) => mounted.current && networkReturnOwner.current === route &&
    controllersRef.current === route.local && epoch.current === route.origin.epoch && rootOrigin.current === route.origin && AppState.currentState === 'active';
  const changeSendAsset = (form: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>, token?: Erc20Metadata) => {
    const local = controllersRef.current, saved = sendDraft, before = readyContext(), captured = epoch.current;
    if (!local || !saved || !before || stage !== 'send' || rootOrigin.current !== saved.origin || before.context !== saved.origin.context ||
        AppState.currentState !== 'active' || (saved.target.kind !== 'native' && saved.target.kind !== 'token')) return;
    local.transfers.cancel();
    const closing = selectedAccountType === 'Trezor' ? local.trezor?.cancel() : Promise.resolve();
    void Promise.resolve(closing).then(() => {
      if (!mounted.current || controllersRef.current !== local || epoch.current !== captured || rootOrigin.current !== saved.origin ||
          AppState.currentState !== 'active' || readyContext()?.context !== before.context) return;
      setSendDraft({ ...saved, target: token ? { kind: 'token', token } : { kind: 'native' },
        form: { kind: 'evm', recipient: form.recipient, amount: '', nonce: '', max: false, advanced: false } });
    }).catch(() => undefined);
  };
  const navigateAccount = async (choice: NotificationChoice, assertView: () => void,
    complete: (context: { context: string; identity: string }, check: () => void, local: Controllers, release: () => void) => void | 'queued') => {
    assertView();
    const local = controllersRef.current, state = local?.authority.getSnapshot(), saved = local?.authority.getCatalogue();
    if (!mounted.current || !local || !state?.account || !saved || stage !== 'choose' || accountNavigation.current || rootOrigin.current ||
        AppState.currentState !== 'active' || !['ready', 'backup-required'].includes(state.phase) ||
        saved.active.accountId !== choice.scope.accountId || state.account.address !== choice.scope.accountAddress ||
        !local.getNotificationChoices().some(current => JSON.stringify(current.scope) === JSON.stringify(choice.scope))) throw Error('CANCELLED');
    const origin: RootOrigin = { tab: shell.tab, stage: 'networks', epoch: epoch.current,
      context: `${state.revision}:${saved.active.accountId}:${state.account.network}`, identity: `${saved.active.accountId}:${state.account.network}` };
    const intent: AccountNavigation = { local, origin, choice, sourceRevision: state.revision, sourceCatalogueRevision: saved.revision };
    // From here the wallet owns navigation. Expected authentication may unmount the initiating public view.
    accountNavigation.current = intent; rootOrigin.current = origin;
    let queued = false;
    const release = () => {
      if (accountNavigation.current === intent) accountNavigation.current = null;
      if (rootOrigin.current === origin) rootOrigin.current = null;
    };
    const check = () => {
      const current = local.authority.getSnapshot();
      if (!mounted.current || controllersRef.current !== local || accountNavigation.current !== intent || rootOrigin.current !== origin ||
          epoch.current !== origin.epoch || AppState.currentState !== 'active' ||
          !['ready', 'backup-required', 'authenticating'].includes(current.phase) ||
          current.revision < intent.sourceRevision || current.revision > intent.sourceRevision + 1) throw Error('CANCELLED');
    };
    try {
      check();
      if (saved.active.networkId !== choice.scope.network.id) {
        const receipt = await local.authority.selectNetwork(choice.scope.network.id, state.revision, saved.revision, proof => {
          check(); proof.assertCurrent();
          if (proof.sourceCatalogueRevision !== saved.revision || proof.selection.accountId !== choice.scope.accountId ||
              proof.selection.address !== choice.scope.accountAddress || proof.selection.networkId !== choice.scope.network.id ||
              JSON.stringify(proof.target) !== JSON.stringify(choice.scope.network)) throw Error('CANCELLED');
        });
        check(); receipt.assertCurrent();
      }
      const current = local.authority.getSnapshot(), selected = local.authority.getCatalogue();
      check();
      if (!current.account || !['ready', 'backup-required'].includes(current.phase) || selected?.active.accountId !== choice.scope.accountId ||
          current.account.address !== choice.scope.accountAddress || current.account.network !== choice.scope.network.id ||
          !local.getNotificationChoices().some(value => JSON.stringify(value.scope) === JSON.stringify(choice.scope))) throw Error('CANCELLED');
      const context = { context: `${current.revision}:${selected.active.accountId}:${current.account.network}`,
        identity: `${selected.active.accountId}:${current.account.network}` };
      const checkDestination = () => {
        check();
        const next = local.authority.getSnapshot(), catalogue = local.authority.getCatalogue();
        if (!mounted.current || controllersRef.current !== local || epoch.current !== origin.epoch || AppState.currentState !== 'active' ||
            !next.account || !['ready', 'backup-required'].includes(next.phase) ||
            `${next.revision}:${catalogue?.active.accountId}:${next.account.network}` !== context.context ||
            next.account.address !== choice.scope.accountAddress) throw Error('CANCELLED');
      };
      checkDestination(); queued = complete(context, checkDestination, local, release) === 'queued';
    } finally {
      if (!queued) release();
    }
  };
  const cancelAccountNavigation = () => {
    const intent = accountNavigation.current;
    if (!intent) return;
    accountNavigation.current = null;
    if (rootOrigin.current === intent.origin) rootOrigin.current = null;
    setPortfolioSend(null); intent.local.authority.cancelAccountOperation();
  };
  const selectPortfolioNetwork = (choice: NotificationChoice, assertView: () => void) => navigateAccount(choice, assertView, () => {});
  const sendFromPortfolio = (choice: NotificationChoice, token: Erc20Metadata | undefined, assertView: () => void) => {
    if (controllersRef.current?.authority.getSnapshot().backup === 'unconfirmed') { assertView(); openRequiredBackup(); return Promise.resolve(); }
    return navigateAccount(choice, assertView, (_context, check, _local, release) => {
      setPortfolioSend({ choice, target: token ? { kind: 'token', token } : { kind: 'native' }, epoch: epoch.current, assertCurrent: check, release }); return 'queued';
    });
  };
  const openPortfolioDetail = (choice: NotificationChoice, receive: boolean, token: string | undefined, assertView: () => void) =>
    navigateAccount(choice, assertView, (context, _check, local) => {
      setPortfolioDetail({ owner: local, context: context.context, detail: { accountId: choice.scope.accountId, networkId: choice.scope.network.id, receive, token } });
      restoreRoot('wallet', context.identity);
    });
  const openPortfolioActivity = async (choice: NotificationChoice | undefined, assertView: () => void) => {
    if (!choice) { assertView(); shell.select('activity'); return; }
    await navigateAccount(choice, assertView, context => restoreRoot('activity', context.identity));
  };
  const openAccountActivityAction = (entry: AccountActivityRow, action: AccountActivityAction, hash: string, assertView: () => void) => {
    if (!/^0x[0-9a-f]{64}$/i.test(hash) || entry.row.hash !== hash) return Promise.reject(Error('CANCELLED'));
    return navigateAccount(entry.choice, assertView, (_context, check, _local, release) => {
      setPortfolioSend({ choice: entry.choice, target: { kind: action, hash }, epoch: epoch.current, assertCurrent: check, release }); return 'queued';
    });
  };
  useEffect(() => {
    if (!portfolioSend) return;
    let current = true;
    queueMicrotask(() => {
      if (!current || !mounted.current) return;
      const saved = controllersRef.current?.authority.getCatalogue(), state = controllersRef.current?.authority.getSnapshot();
      setPortfolioSend(pending => pending === portfolioSend ? null : pending);
      try { portfolioSend.assertCurrent(); } catch { portfolioSend.release(); return; }
      if (epoch.current !== portfolioSend.epoch || stage !== 'choose' || state?.phase !== 'ready' ||
          saved?.active.accountId !== portfolioSend.choice.scope.accountId || state.account?.network !== portfolioSend.choice.scope.network.id ||
          state.account.address !== portfolioSend.choice.scope.accountAddress) { portfolioSend.release(); return; }
      portfolioSend.release();
      openStage('send', portfolioSend.target);
    });
    return () => { current = false; };
  });
  const openSendNetwork = (form: NativeUnsignedSendDraft) => {
    const local = controllersRef.current, before = readyContext(), saved = sendDraft, captured = epoch.current;
    if (!local || !before || !saved || rootOrigin.current !== saved.origin || before.context !== saved.origin.context ||
        stage !== 'send' || AppState.currentState !== 'active') return;
    if (form.kind === 'evm') local.transfers.cancel();
    const closeHardware = form.kind === 'evm' && selectedAccountType === 'Trezor' ? local.trezor?.cancel() : Promise.resolve();
    void Promise.resolve(closeHardware).then(() => {
      const current = readyContext(), catalogue = local.authority.getCatalogue();
      if (!mounted.current || controllersRef.current !== local || epoch.current !== captured || rootOrigin.current !== saved.origin ||
          AppState.currentState !== 'active' || current?.context !== before.context || !catalogue) return;
      const origin: RootOrigin = { ...saved.origin, stage: 'networks' };
      const route: NetworkReturn = { kind: 'send', local, origin, sourceRevision: local.authority.getSnapshot().revision,
        sourceCatalogueRevision: catalogue.revision, target: saved.target, form: Object.freeze({ ...form }) };
      networkReturnOwner.current = route; setNetworkReturn(route); rootOrigin.current = origin;
      setSendDraft(null); setStage('networks');
    }).catch(() => { if (mounted.current && controllersRef.current === local && epoch.current === captured) setError('The current request is still closing. Try again.'); });
  };
  const openReceiveNetwork = (continuation: NativeReceiveContinuation) => {
    const local = controllersRef.current, current = readyContext(), catalogue = local?.authority.getCatalogue(), account = local?.authority.getSnapshot().account;
    if (!local || !current || !catalogue || !account || stage !== 'choose' || AppState.currentState !== 'active' ||
        continuation.account.revision !== local.authority.getSnapshot().revision || continuation.account.network !== account.network || continuation.account.address !== account.address) return;
    const origin: RootOrigin = { tab: shell.tab, stage: 'networks', ...current, epoch: epoch.current };
    const route: NetworkReturn = { kind: 'receive', local, origin, sourceRevision: local.authority.getSnapshot().revision,
      sourceCatalogueRevision: catalogue.revision, continuation };
    networkReturnOwner.current = route; setNetworkReturn(route); rootOrigin.current = origin; setStage('networks');
  };
  const finishNetworkSelection = (route: NetworkReturn, receipt?: NativeNetworkSelectionReceipt) => {
    if (!networkRouteCurrent(route)) return;
    const current = readyContext();
    if (receipt) {
      try { receipt.assertCurrent(); } catch { return; }
      if (!current || receipt.sourceContextRevision !== route.sourceRevision || receipt.sourceCatalogueRevision !== route.sourceCatalogueRevision ||
          receipt.selection.networkId !== route.local.authority.getSnapshot().account?.network || receipt.selection.address !== route.local.authority.getSnapshot().account?.address) return;
    }
    networkReturnOwner.current = null; setNetworkReturn(null);
    if (!current || !receipt && current.context !== route.origin.context) { rootOrigin.current = null; setSendDraft(null); setReceiveContinuation(undefined); setStage('choose'); return; }
    if (route.kind === 'send') {
      const origin: RootOrigin = { tab: route.origin.tab, stage: 'send', ...current, epoch: epoch.current };
      rootOrigin.current = origin;
      setSendDraft({ origin, target: receipt ? { kind: 'native' } : route.target,
        form: receipt ? sendDraftForNetwork(route.form, receipt.target) : route.form,
        ...(receipt ? { notice: NETWORK_CHANGED_DRAFT_NOTICE } : {}) });
      setStage('send');
    } else {
      const account = route.local.authority.getSnapshot().account!;
      setReceiveContinuation(receipt ? { account: { ...account, revision: receipt.contextRevision }, backupAcknowledged: false } : route.continuation);
      rootOrigin.current = null; setStage('choose'); shell.restoreRoot(route.origin.tab, current.identity);
    }
  };
  useEffect(() => {
    const eventId = notificationSnapshot.pendingEventId, local = controllersRef.current;
    const attemptKey = `${eventId}:${snapshot.revision}`;
    if (!eventId || !local || !protectedScreen || snapshot.phase !== 'ready' || stage !== 'choose' || busy || shell.immersive ||
        rootOrigin.current || notificationTransition.current || lastNotificationAttempt.current === attemptKey || AppState.currentState !== 'active') return;
    const connections = local.connections.getSnapshot();
    if (connections.status !== 'ready' || connections.proposals.length || connections.preparationReview || connections.controlReview ||
        connections.sentryReview || connections.psbtReview || connections.signingReview) return;
    const token = {}, capturedEpoch = epoch.current;
    notificationTransition.current = token; lastNotificationAttempt.current = attemptKey;
    const check = () => {
      const view = notificationView.current;
      if (!mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch || notificationTransition.current !== token ||
          AppState.currentState !== 'active' || view.stage !== 'choose' || view.busy || view.immersive || rootOrigin.current) throw Error('CANCELLED');
    };
    void (async () => {
      const owner = await nativeActivityNotifications.getPendingOwner();
      check();
      if (!owner || owner.accountType === 'watch' || nativeActivityNotifications.getSnapshot().pendingEventId !== eventId) return;
      const choices = local.getNotificationChoices();
      const catalogueKey = JSON.stringify(choices);
      const currentChoice = (id: string) => {
        check();
        const current = local.getNotificationChoices();
        if (JSON.stringify(current) !== catalogueKey) throw Error('CANCELLED');
        return current.find(choice => choice.scope.id === id);
      };
      const route = await nativeActivityNotifications.resolveTapAfterUnlock(eventId, scope => {
        try { return JSON.stringify(currentChoice(scope.id)?.scope) === JSON.stringify(scope); } catch { return false; }
      });
      if (!route) return;
      const choice = currentChoice(route.scopeId);
      if (!choice || route.accountId !== choice.scope.accountId || route.networkId !== choice.scope.network.id) return;
      let saved = local.authority.getCatalogue();
      if (!saved) return;
      if (saved.active.networkId !== route.networkId) {
        const receipt = await local.authority.selectNetwork(route.networkId, local.authority.getSnapshot().revision, saved.revision, () => {});
        check(); receipt.assertCurrent(); currentChoice(route.scopeId);
      }
      saved = local.authority.getCatalogue();
      if (!saved || !saved.accounts.some(account => account.id === route.accountId && account.address === choice.scope.accountAddress)) return;
      if (saved.active.accountId !== route.accountId) {
        await local.accounts.execute({ kind: 'select', id: route.accountId }, local.authority.getSnapshot().revision, saved.revision);
        check(); currentChoice(route.scopeId);
      }
      const current = readyContext(), selected = local.authority.getCatalogue(), account = local.authority.getSnapshot().account;
      if (!current || selected?.active.accountId !== route.accountId || account?.network !== route.networkId || account.address !== choice.scope.accountAddress) return;
      if (route.kind.startsWith('transaction-')) {
        setTransactionActivity(route.transactionHash ? { context: current.context, hash: route.transactionHash } : null);
        restoreRoot('activity', current.identity);
      } else {
        setResumeGuardianScope(`${capturedEpoch}:${current.context}`);
        restoreRoot('tools', current.identity);
      }
    })().catch(() => undefined).finally(() => {
      if (notificationTransition.current !== token) return;
      notificationTransition.current = null;
      const pending = nativeActivityNotifications.getSnapshot().pendingEventId;
      if (mounted.current && pending && pending !== eventId) setNotificationWake(value => value + 1);
    });
  }, [notificationSnapshot.pendingEventId, notificationWake, snapshot.phase, snapshot.revision, protectedScreen, stage, busy, shell.immersive, connectionSnapshot, controllersRef, readyContext, restoreRoot]);
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
    networkReturnOwner.current = null; setNetworkReturn(null); setReceiveContinuation(undefined);
    depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null);
    const origin = rootOrigin.current; rootOrigin.current = null;
    const current = readyContext();
    if (stage === 'smart-infrastructure' || stage === 'smart-deploy' || stage === 'smart-resume' || stage === 'smart-authenticator' || stage === 'slh-dsa' || stage === 'smart-modules' || stage === 'send' && selectedAccountType === 'SmartAccount') setCatalogue(controllersRef.current?.authority.getCatalogue() ?? null);
    const local = controllersRef.current;
    setCanSignSmart(local?.canSignSmartAccount() === true); setCanManageSlh(local?.canManageSlhDsa() === true); setCanManageModules(local?.canManageSmartAccountModules() === true);
    setCanUseWalletAuthenticator(local?.canUseWalletAuthenticator() === true);
    setSendDraft(null);
    setSmartResumeId(null);
    setSentryScope(null);
    setStage('choose');
    if (origin && current && AppState.currentState === 'active' && origin.context === current.context && origin.identity === current.identity && origin.epoch === epoch.current)
      shell.restoreRoot(origin.tab, origin.identity);
  };
  const closeBackup = () => {
    // In-flight credential work keeps the existing lock-on-leave behavior.
    if (submitting.current) { revoke(); return; }
    controllersRef.current?.backup.cancel(); clearSecrets(); setError(''); closeStage();
  };
  const openRequiredBackup = () => {
    const local = controllersRef.current;
    if (!local || submitting.current || !protectedScreen || AppState.currentState !== 'active' ||
        local.authority.getSnapshot().phase !== 'backup-required') return;
    local.backup.cancel(); clearSecrets(); setError(''); setStage('backup-intro');
  };
  const sendTarget = stage === 'send' && sendDraft &&
    sendDraft.origin.context === custodyContext(snapshot, catalogue)?.context
    ? sendDraft.target : undefined;
  const latestBack = useRef<() => boolean>(() => true);
  useLayoutEffect(() => {
    latestBack.current = () => {
      if (accountNavigation.current) { revoke(); return true; }
      if (['backup-intro', 'backup-auth', 'words', 'backup-verify'].includes(stage) && ['ready', 'backup-required'].includes(snapshot.phase)) { closeBackup(); return true; }
      if (stage === 'backup-complete' && snapshot.phase === 'ready') {
        closeStage();
        return true;
      }
      if (stage === 'device-unlock') {
        closeDeviceUnlock();
        return true;
      }
      if ((stage === 'change-pin' || stage === 'change-pin-new') && snapshot.phase === 'ready') return false;
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
      if (['ready', 'backup-required'].includes(snapshot.phase) && stage === 'choose') shell.goBack(); else exit();
      return true;
    };
  });

  const clearOwnerView = useCallback(() => {
    networkReturnOwner.current = null; setNetworkReturn(null); setReceiveContinuation(undefined);
    depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null);
    cancelNoteRestore();
    detachSubscriptions.current(); detachSubscriptions.current = () => undefined;
    controllersRef.current = null;
    accountNavigation.current = null; setPortfolioSend(null); setPortfolioDetail(null);
    setControllerOwner(null);
    setSentry(null); setSentryScope(null);
    if (rootOrigin.current?.stage === 'send' || rootOrigin.current?.stage === 'smart-resume') {
      rootOrigin.current = null;
      setSendDraft(null);
      setStage((current) => current === 'send' || current === 'smart-resume' ? 'choose' : current);
    }
    setCanRemoveWallet(false); setDeviceUnlockStatus(null); setPinConfigured(null);
    setCanSignSmart(false); setCanManageSlh(false); setOpenSlhDsaManagement(null); setCanManageModules(false); setOpenSmartAccountModules(null); setOpenSmartInfrastructure(null);
    setCanUseWalletAuthenticator(false); setOpenWalletAuthenticator(null); setSmartResumeId(null);
    setPublicSource(null); setBalanceReader(null); setRecipientResolver(undefined); setReadGuardianRecovery(null); setOpenGuardianPolicy(null); setInspectGuardianRemoval(null); setGuardianRecoveryController(null); setRecoveryActivity(null); setResumeGuardianScope(null); setAccountView(null); setTrezorView(null); setLedgerView(null); setLedgerConnection(null); setConnectionView(null); setConnectionSnapshot(null); setSigningReview(null); setNetworkView(null);
    setOpenNoteCapacity(null); setReadNoteInventory(null); setOpenPrivateDeposit(null); setTransactionActivity(null); setSaveIdle(null); setCatalogue(null); setTransferView(null); setOpenUtxoSend(null); setOpenSmartDeployment(null); setOpenSmartSend(null); setTokenView(null); setKeyExportView(null); setActivityView(null); setUtxoActivityView(null);
    bridge.current?.onNativeCatalogue(null);
  }, [cancelNoteRestore, controllersRef]);
  const attach = useCallback((local: Controllers) => {
    detachSubscriptions.current(); controllersRef.current = local;
    setCanRemoveWallet(!!local.removal);
    setOpenSlhDsaManagement(() => async (signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => {
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      const origin = rootOrigin.current, address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'slh-dsa' || !address || !mounted.current || controllersRef.current !== local ||
            rootOrigin.current !== origin || epoch.current !== origin.epoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check(); const manager = await local.openSlhDsaManagement(signal, check, authentication); check(); return manager;
    });
    setOpenSmartInfrastructure(() => async (signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => {
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      const origin = rootOrigin.current, address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'smart-infrastructure' || !address || !mounted.current || controllersRef.current !== local ||
            rootOrigin.current !== origin || epoch.current !== origin.epoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check(); const manager = await local.openSmartInfrastructure(signal, check, authentication);
      try { check(); return manager; } catch (error) { manager.dispose(); throw error; }
    });
    setOpenSmartAccountModules(() => async (signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => {
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      const origin = rootOrigin.current, address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'smart-modules' || !address || !mounted.current || controllersRef.current !== local ||
            rootOrigin.current !== origin || epoch.current !== origin.epoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check(); const manager = await local.openSmartAccountModules(signal, check, authentication); check(); return manager;
    });
    setOpenWalletAuthenticator(() => async (signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => {
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      const origin = rootOrigin.current;
      const address = local.authority.getSnapshot().account?.address;
      const check = () => {
        assertView();
        if (!origin || origin.stage !== 'smart-authenticator' || !address ||
            !mounted.current || controllersRef.current !== local || rootOrigin.current !== origin ||
            epoch.current !== origin.epoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)) ||
            readyContext()?.identity !== origin.identity || local.authority.getSnapshot().account?.address !== address)
          throw new Error('CANCELLED');
      };
      check();
      const operation = await local.openWalletAuthenticator(signal, check, authentication);
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
        if (!mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch)
          throw new Error('CANCELLED');
      });
    });
    const networks = createNativeNetworkView(local.authority, { utxoSendAvailable: !!local.openUtxoSend, fetch: walletFetch });
    const publicView: PublicCustodySource = Object.freeze({
      getSnapshot: () => local.authority.getSnapshot(),
      getCatalogue: () => local.authority.getCatalogue(),
      subscribe: (listener: Parameters<PublicCustodySource['subscribe']>[0]) => local.authority.subscribe(listener),
    });
    const allActivity = new AccountActivityController({ source: publicView, choices: () => local.getNotificationChoices(), filter: portfolioFilter,
      runtime: local.getScopedActivityRuntime, ...local.activityReaders });
    const update = (state: CustodySnapshot) => {
      if (!mounted.current || controllersRef.current !== local) return;
      setControllerOwner(local);
      setGuardianEpoch(epoch.current);
      setCanSignSmart(local.canSignSmartAccount()); setCanManageSlh(local.canManageSlhDsa()); setCanManageModules(local.canManageSmartAccountModules());
      setCanUseWalletAuthenticator(local.canUseWalletAuthenticator());
      {
        void local.authority.getAuthenticationStatus().then((status) => {
          if (mounted.current && controllersRef.current === local && local.authority.getSnapshot() === state) {
            setDeviceUnlockStatus(status ? { available: status.biometricsAvailable, enabled: status.biometricsEnabled } : null);
            setPinConfigured(status?.pinConfigured ?? null);
          }
        }).catch(() => {
          if (mounted.current && controllersRef.current === local && local.authority.getSnapshot() === state) { setDeviceUnlockStatus(null); setPinConfigured(null); }
        });
      }
      setSentry(local.sentry);
      setSnapshot(state); setPublicSource(publicView); setBalanceReader(local.balanceReader); setRecipientResolver(local.recipientResolver); setConnectionView(local.connections); setTransferView(local.transfers); setOpenUtxoSend(() => local.openUtxoSend); setOpenSmartDeployment(() => local.openSmartAccountDeployment); setOpenSmartSend(() => local.openSmartAccountSend); setTokenView(local.tokens); setActivityView(local.activity); setUtxoActivityView(local.utxoActivity); setKeyExportView(local.keyExport); setNetworkView(networks);
      setAccountActivity(allActivity);
      setGuardianRecoveryController({
        hasIntent: () => local.guardianRecovery.hasIntent(),
        open: async (draft, signal, assertView, authentication) => {
          if (AppState.currentState !== 'active') throw new Error('CANCELLED');
          const capturedEpoch = epoch.current;
          return local.guardianRecovery.open(draft, signal, () => {
            assertView();
            if (!mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)))
              throw new Error('CANCELLED');
          }, authentication);
        },
      });
      setOpenGuardianPolicy(() => local.canManageGuardianPolicy() ? async (draft: Parameters<Controllers['openGuardianPolicy']>[0], signal: AbortSignal, assertView: () => void, authentication: NativePrivateAuthenticationScope) => {
        if (AppState.currentState !== 'active') throw new Error('CANCELLED');
        const capturedEpoch = epoch.current;
        return local.openGuardianPolicy(draft, signal, () => {
          assertView();
          if (!mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch || (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)))
            throw new Error('CANCELLED');
        }, authentication);
      } : null);
      setInspectGuardianRemoval(() => local.canManageGuardianPolicy() ? (signal: AbortSignal, assertView: () => void) => {
        const capturedEpoch = epoch.current;
        return local.inspectGuardianRemoval(signal, () => {
          assertView();
          if (!mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch || AppState.currentState !== 'active')
            throw new Error('CANCELLED');
        });
      } : null);
      const nextCatalogue = local.authority.getCatalogue();
      const pinChange = pinChangeRef.current;
      if (pinChange && (pinChange.local !== local || pinChange.authority !== state || pinChange.catalogue !== nextCatalogue)) {
        pinChangeRef.current = null;
        setPinChangeOwner(null);
        setStage(current => current === 'change-pin-new' ? 'change-pin' : current);
      }
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
    setSaveIdle(() => (expected: Parameters<IdlePreferenceSave>[0], minutes: number, pin: string, check: () => void) => local.authority.saveIdlePreference(expected, minutes, pin, check));
    setOpenNoteCapacity(() => local.openNoteCapacity ?? null);
    setOpenNoteMaintenance(() => local.openNoteMaintenance ?? null);
    setOpenPrivacyControls(() => local.openPrivacyControls ?? null);
    setReadNoteInventory(() => local.readNoteInventory ?? null);
    setOpenNoteImport(() => local.openNoteImport ?? null);
    setOpenPrivateDeposit(() => local.openPrivateDeposit ?? null);
    const unsubscribe = local.authority.subscribe(update);
    update(local.authority.getSnapshot());
    const updateMessage = () => {
      if (mounted.current && controllersRef.current === local) {
        const next = local.connections.getSnapshot();
        setConnectionSnapshot(next);
        setSigningReview(next.signingReview);
      }
    };
    const unsubscribeMessages = local.connections.subscribe(updateMessage);
    updateMessage();
    const clear = local.backup.onClear(() => { setPresentation(null); });
    detachSubscriptions.current = () => { unsubscribe(); unsubscribeMessages(); clear(); };
    setProtectedScreen(true);
  }, [clearSecrets, readyContext, controllersRef]);
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
    const local = controllersRef.current;
    if (removalRef.current || (stage === 'remove-wallet' && snapshot.phase !== 'locked') || !local?.removal?.requiresControllerReopen()) return;
    const token = screenToken.current;
    const generation = ++epoch.current;
    // Preparation stopped asynchronous producers before sealing the removal
    // snapshot. An abandoned attempt needs a fresh bundle, not its closed view.
    const draining = nativeLifecycle.release(token);
    clearOwnerView(); clearSecrets(); setSnapshot(INITIAL); setProtectedScreen(false); setStage('choose');
    void draining.then(async () => {
      if (mounted.current && epoch.current === generation && screenToken.current === token &&
          AppState.currentState === 'active' && !controllersRef.current) await install();
    }).catch(() => {
      if (mounted.current && epoch.current === generation)
        setError('Secure wallet storage is unavailable. Close and reopen Pali to try again.');
    });
  }, [stage, snapshot.phase, snapshot.revision, clearOwnerView, clearSecrets, install, controllersRef]);
  useEffect(() => {
    const lifecycleEpoch = epoch, ownedToken = screenToken.current;
    mounted.current = true;
    void install().catch(() => undefined);
    const resume = () => {
      if (!mounted.current || AppState.currentState !== 'active') return;
      custodyIdle.begin(screenToken.current, revoke);
      if (!controllersRef.current && !recoveryRef.current && !removalRef.current)
        void install().catch(() => undefined);
    };
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'inactive' && (controllersRef.current?.authentication?.isActive() || isNotificationPermissionPromptActive())) { clearSecrets(); Keyboard.dismiss(); }
      else if (state !== 'active') revoke(true);
      else resume();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (controllersRef.current?.authentication?.isActive() || isNotificationPermissionPromptActive()) { clearSecrets(); Keyboard.dismiss(); } else revoke(true);
    }) : null;
    const focus = AppState.addEventListener('focus', resume);
    return () => {
      mounted.current = false; lifecycleEpoch.current++; recoveryRef.current?.cancel();
      removalRef.current?.local.removal.cancel(); removalRef.current = null;
      detachSubscriptions.current(); detachSubscriptions.current = () => undefined;
      bridge.current?.onNativeCatalogue(null); controllersRef.current = null;
      lifecycle.remove(); blur?.remove(); focus.remove(); custodyIdle.stop(ownedToken);
      void nativeLifecycle.release(ownedToken).catch(() => undefined);
    };
  }, [install, revoke, clearSecrets, controllersRef]);

  const openRemoval = () => {
    const local = controllersRef.current, authority = local?.authority.getSnapshot();
    if (!local?.removal || !onWalletRemoved || !protectedScreen || removalRef.current || !mounted.current ||
        AppState.currentState !== 'active' || stage !== 'security' || !authority || !['ready', 'backup-required'].includes(authority.phase) ||
        nativeLifecycle.current(screenToken.current) !== local) return;
    const scope: RemovalScope = { local, authority, epoch: epoch.current, phase: 'reviewing' };
    removalRef.current = scope; setRemovalScope(scope); setStage('remove-wallet');
  };

  const removalCurrent = (scope: RemovalScope) => {
    if (!mounted.current || removalRef.current !== scope || controllersRef.current !== scope.local || scope.epoch !== epoch.current ||
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
      if (controllersRef.current === scope.local) { clearOwnerView(); setSnapshot(INITIAL); setProtectedScreen(false); }
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
    const local = controllersRef.current;
    if (!local || recoveryRef.current || submitting.current || !protectedScreen || AppState.currentState !== 'active' ||
        local.authority.getSnapshot().phase !== 'locked' || nativeLifecycle.current(screenToken.current) !== local) return;
    cancelNoteRestore();
    rootOrigin.current = null; requestedAccount.current = undefined; feedbackRequest.current++;
    clearSecrets(); setError(''); setSendDraft(null); const captured = ++epoch.current;
    let flow!: NativeRecoveryFlow, recoveryStarted = false;
    flow = new NativeRecoveryFlow({
      readInventory: () => local.readRecoveryInventory(),
      createCoordinator: () => { recoveryStarted = true; return nativeLifecycle.startRecovery(screenToken.current, local); },
      isCurrent: () => mounted.current && recoveryRef.current === flow && controllersRef.current === local && epoch.current === captured && AppState.currentState === 'active',
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
    const local = controllersRef.current; if (!local) return;
    const captured = epoch.current;
    feedbackRequest.current++;
    submitting.current = true; setBusy(true); setError('');
    try { await action(local); }
    catch (cause) { if (mounted.current && epoch.current === captured) setError(message(cause)); }
    finally {
      submitting.current = false;
      if (mounted.current) { setBusy(false); setPin(''); setPhrase(''); }
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
      setStage('choose');
  };

  const createOrImport = (enteredPin: string, enrollBiometrics: boolean) => {
    if (!isWalletPin(enteredPin)) { setError('Enter a 6-digit PIN.'); return; }
    const enteredPhrase = phrase, importing = stage === 'import-security';
    const useDeviceUnlock = enrollBiometrics && deviceUnlockStatus?.available;
    void perform(async (local) => {
      const { authority } = local;
      if (importing) await authority.importPhrase(enteredPhrase, enteredPin);
      else await authority.create(enteredPin);
      clearSecrets();
      if (useDeviceUnlock && ['ready', 'backup-required'].includes(authority.getSnapshot().phase)) {
        const captured = epoch.current;
        await authority.setDeviceUnlock(true, enteredPin, () => {
          if (!mounted.current || controllersRef.current !== local || epoch.current !== captured || AppState.currentState !== 'active') throw new Error('CANCELLED');
        });
      }
      if (['ready', 'backup-required'].includes(authority.getSnapshot().phase)) setStage('choose');
    });
  };

  const openImport = () => {
    const local = controllersRef.current;
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
        if (controllersRef.current === local && importRequest.current.token === token && importRequest.current.active &&
            now.phase === 'authenticating' && now.revision === context.revision + 1) local.imports.cancel();
      },
    });
    const network = findUtxoNetwork(context.account.network, current.utxoNetworks);
    setImportScope({ contextRevision: context.revision, catalogueRevision: current.revision, utxo: !!network,
      utxoAddressTypes: network && UTXO_IMPORT_TYPES.filter((type) => supportsUtxoSoftwareCustody(network, type === 'p2tr' ? 1 : 0)),
      networkLabel: network?.name ?? getNativeSendContext(context.account.network, current.networks).name, token, imports: scoped });
    setStage('import-key');
  };
  const previewImport = useCallback(async (words: string, assertView: () => void) => {
    const local = controllersRef.current, captured = epoch.current;
    const check = () => {
      assertView();
      if (!local || controllersRef.current !== local || !mounted.current || epoch.current !== captured ||
          AppState.currentState !== 'active' || local.authority.getSnapshot().phase !== 'empty') throw new Error('CANCELLED');
    };
    check();
    return local!.authority.previewPhrase(words, check);
  }, [controllersRef]);
  const locked = snapshot.phase === 'locked';
  const quickUnlock = !!deviceUnlockStatus?.available && !!deviceUnlockStatus.enabled;
  const unavailable = snapshot.phase === 'unavailable' || !!error && !protectedScreen;
  const title = locked ? 'Welcome back' : snapshot.phase === 'ready' && stage === 'choose' ? 'Your wallet' :
    stage === 'words' ? 'Your recovery phrase' : stage === 'backup-complete' ? t('mobile.security.backupComplete') :
    stage === 'device-unlock' ? biometrics.label === 'biometrics' ? 'Biometric unlock' : biometrics.label === 'fingerprint' ? 'Fingerprint unlock' : biometrics.label : stage === 'backup-auth' ? 'Back up your wallet' : stage === 'import-security' ? 'Secure your imported wallet' : stage === 'create' ? 'Protect your wallet' : 'Make it yours';
  const accountLabel = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId)?.label ?? 'Account 1';
  const selectWatch = (selection: import('../core/accountDirectory').AccountSelection) => {
    if (selection.kind !== 'watch') return;
    // Revoke credentials, reviews, transfer work and secret presentation before routing.
    revoke();
    bridge.current?.onSelectWatch(selection);
  };
  const recoveryNotice = recoveryOutcome && <Notice title={recoveryOutcome.kind === 'success' ? 'PIN changed' : recoveryOutcome.kind === 'uncertain' ? 'Check your PIN' : 'Recovery update'} body={recoveryOutcome.message + (recoveryOutcome.cleanupFailed ? ' The wallet could not be reopened. Close and reopen Pali to unlock.' : '')} tone={recoveryOutcome.kind === 'success' ? undefined : 'amber'} />;
  if (stage === 'recovery' && recoveryFlow) return <NativeRecovery flow={recoveryFlow} />;
  if (snapshot.phase === 'empty' && stage === 'choose') return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <Screen gap={24}>
      <Header title="Set up your wallet" onBack={exit} />
      <Text style={styles.muted}>Create a wallet or bring one you already use.</Text>
      <Card>
        <Row title="Create a wallet" subtitle="Start with a new recovery phrase" icon="plus" onPress={() => setStage('create')} />
        <Row title="Import existing wallet" subtitle="Use your recovery phrase" icon="key" onPress={() => setStage('import')} last={!accounts} />
        {accounts && <Row title="Watch an account" subtitle="Follow an address without its private keys" icon="eye" onPress={() => setStage('accounts')} last />}
      </Card>
    </Screen>
  </SafeAreaView>;
  if (snapshot.phase === 'empty' && (stage === 'create' || stage === 'import-security' && !!phrase))
    return <PinSetup biometrics={biometrics} key={stage} available={!!deviceUnlockStatus?.available} busy={busy} error={error}
      onBack={() => setStage(stage === 'import-security' ? 'import' : 'choose')} onComplete={createOrImport} />;
  if (locked && protectedScreen && pinConfigured === false) return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <Screen footer={<Button title="Recover access" onPress={openRecovery} />}>
      <Header title="Recover access" onBack={exit} />
      <Notice title="Set up your PIN" body="This development wallet was created before PIN access. Restore access with its recovery phrase to create a PIN. Your saved wallet is preserved." />
    </Screen>
  </SafeAreaView>;
  if (locked && protectedScreen) return <PinEntryScreen brand title="Welcome back" description={recoveryNotice ? undefined : "Enter your Pali PIN."} notice={recoveryNotice}
    busy={busy} error={error || (snapshot.error ? message(new Error(snapshot.error)) : undefined)}
    resetKey={`${snapshot.revision}:${error}`} onComplete={entered => {
      void perform(async local => { await local.authority.unlock(entered); await finishUnlock(local); });
    }} footer={<>
      {quickUnlock && <Button title={`Use ${biometrics.label}`} icon={biometrics.icon} variant="secondary" disabled={busy} onPress={() => {
        clearSecrets(); void perform(async local => {
          const captured = epoch.current;
          await local.authority.unlockWithDevice(() => {
            if (!mounted.current || controllersRef.current !== local || epoch.current !== captured || AppState.currentState !== 'active') throw new Error('CANCELLED');
          }); await finishUnlock(local);
        });
      }} />}
      <Button title="Forgot PIN?" variant="secondary" disabled={busy} onPress={openRecovery} />
    </>} />;
  if (stage === 'change-pin' && snapshot.phase === 'ready') return <PinEntryScreen title="Enter your current PIN"
    busy={busy} error={error} resetKey={pinChangeAttempt} onBack={() => {
      if (submitting.current) revoke(); else { clearSecrets(); setError(''); closeStage(); }
    }}
    onComplete={entered => {
      if (submitting.current) return;
      pinChangeRef.current = null; setPinChangeOwner(null); setPinChangeAttempt(value => value + 1);
      void perform(async local => {
        const authority = local.authority.getSnapshot(), catalogue = local.authority.getCatalogue(), captured = epoch.current;
        const check = () => {
          if (!mounted.current || controllersRef.current !== local || epoch.current !== captured || AppState.currentState !== 'active' ||
              local.authority.getSnapshot() !== authority || local.authority.getCatalogue() !== catalogue || authority.phase !== 'ready' || !catalogue)
            throw new Error('CANCELLED');
        };
        check();
        await local.authority.verifyPin(entered, check);
        check();
        const token = {};
        pinChangeRef.current = { token, local, authority, catalogue: catalogue!, epoch: captured, pin: entered };
        setPinChangeOwner(token);
        setStage('change-pin-new');
      });
    }} />;
  if (stage === 'change-pin-new' && snapshot.phase === 'ready' && pinChangeOwner) return <PinSetup biometrics={biometrics} title="Create a new PIN" offerBiometrics={false}
    busy={busy} error={error} onBack={() => {
      if (submitting.current) revoke(); else { pinChangeRef.current = null; setPinChangeOwner(null); setError(''); setStage('change-pin'); }
    }} onComplete={next => {
      const pinChange = pinChangeRef.current;
      if (!pinChange || pinChange.token !== pinChangeOwner) return;
      void perform(async local => {
        const check = () => {
          if (!mounted.current || controllersRef.current !== local || pinChangeRef.current !== pinChange || pinChange.local !== local ||
              epoch.current !== pinChange.epoch || AppState.currentState !== 'active' ||
              local.authority.getSnapshot() !== pinChange.authority || local.authority.getCatalogue() !== pinChange.catalogue)
            throw new Error('CANCELLED');
        };
        try {
          check(); await local.authority.changePin(pinChange.pin, next, check);
        } catch (cause) {
          if (mounted.current && controllersRef.current === local && epoch.current === pinChange.epoch && AppState.currentState === 'active' &&
              local.authority.getSnapshot().phase === 'ready' && cause instanceof Error &&
              (cause.message === 'INVALID_CREDENTIAL' || cause.message === 'AUTH_THROTTLED')) {
            pinChangeRef.current = null; setPinChangeOwner(null); setStage('change-pin');
          }
          throw cause;
        }
        clearSecrets(); setStage('security');
      });
    }} />;
  if (snapshot.phase === 'empty' && (stage === 'import' || stage === 'import-security' && !phrase))
    return <NativeImportWallet preview={previewImport} onBack={exit} onConfirmed={words => {
      if (AppState.currentState === 'active' && controllersRef.current?.authority.getSnapshot().phase === 'empty') {
        setPhrase(words); setStage('import-security');
      }
    }} />;
  if (stage === 'backup-verify' && presentation && ['ready', 'backup-required'].includes(snapshot.phase))
    return <BackupVerification key={presentation.id} presentation={presentation} busy={busy} error={error} onBack={() => setStage('words')}
      onConfirm={answers => {
        const id = presentation.id;
        void perform(async local => {
          const captured = epoch.current;
          await local.backup.confirm(id, answers);
          if (mounted.current && controllersRef.current === local && epoch.current === captured && AppState.currentState === 'active' && local.authority.getSnapshot().phase === 'ready') {
            clearSecrets(); setStage('backup-complete');
          }
        });
      }} />;
  if (['backup-intro', 'backup-auth'].includes(stage) && ['ready', 'backup-required'].includes(snapshot.phase)) {
    return <>
      <BackupIntroduction onBack={closeBackup} onLater={closeBackup} disabled={busy}
        onStart={() => { if (!submitting.current && AppState.currentState === 'active') { clearSecrets(); setStage('backup-auth'); } }} />
      {stage === 'backup-auth' && <TransactionAuthentication biometrics={biometrics} identity={`backup:${snapshot.revision}`} method={quickUnlock ? 'biometric' : 'pin'}
        title="Unlock recovery phrase" description="Enter your PIN to show your recovery phrase." confirmLabel="Show recovery phrase"
        busy={busy} error={error} onCancel={() => { if (submitting.current) revoke(); else { clearSecrets(); setStage('backup-intro'); } }}
        onConfirm={credential => {
          const entered = credential;
          void perform(async local => {
            const captured = epoch.current;
            const shown = await local.backup.begin(entered);
            if (mounted.current && controllersRef.current === local && epoch.current === captured &&
                AppState.currentState === 'active' && ['ready', 'backup-required'].includes(local.authority.getSnapshot().phase)) {
              setPresentation(shown); setStage('words');
            }
          });
        }} />}
    </>;
  }
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
  if (stage === 'remove-wallet' && removalScope) return <NativeWalletRemovalScreen removal={removalScope.local.removal} backupConfirmed={removalScope.authority.backup === 'confirmed'}
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
      void controllersRef.current?.connections.cancelSigningHandoff().catch(() => undefined);
      if (rootOrigin.current?.stage === 'trezor') closeStage(); else setStage('manage-hd');
    }} onImported={() => { rootOrigin.current = null; setStage('choose'); }} onResumeSend={async (intent: NativeTrezorResumeIntent) => {
      const local = controllersRef.current;
      const current = readyContext();
      const captured = local?.authority.getCatalogue();
      if (!current || !captured || AppState.currentState !== 'active' ||
          captured.active.accountId !== intent.accountId || captured.active.networkId !== intent.networkId)
        throw new Error('CANCELLED');
      if (intent.kind === 'external-psbt' || intent.kind === 'external-signing') {
        if (!local) throw Error('CANCELLED');
        const resumeEpoch = epoch.current;
        await local.connections.resumeSigning(intent.id);
        if (controllersRef.current === local && epoch.current === resumeEpoch && AppState.currentState === 'active') setStage('choose');
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
        const local = controllersRef.current, now = local?.authority.getSnapshot(), current = local?.authority.getCatalogue();
        if (mounted.current && importRequest.current.token === importScope.token && now?.phase === 'ready' &&
            now.revision === importScope.contextRevision + 1 && current?.accounts.some((account) => account.id === current.active.accountId && account.type === 'Imported')) {
          rootOrigin.current = null; setImportScope(null); setStage('choose');
        }
      }} />;
  if (stage === 'networks' && networkView && ['ready', 'authenticating'].includes(snapshot.phase))
    return <NativeNetworks controller={networkView} onBack={networkReturn ? () => finishNetworkSelection(networkReturn) : closeStage}
      selection={networkReturn ? { purpose: networkReturn.kind,
        balance: snapshot.account ? { networkId: snapshot.account.network, available: sendAvailable, loading: sendBalance?.status === 'loading' || sendBalance?.status === 'unknown' } : undefined,
        balances: accountPortfolio?.cachedBalances(),
        assertCurrent() {
        if (!networkRouteCurrent(networkReturn) || readyContext()?.context !== networkReturn.origin.context) throw Error('CANCELLED');
      }, onSelected: receipt => finishNetworkSelection(networkReturn, receipt) } : undefined} />;
  if (sentryRoute && sentry) return <NativeSentryHub key={sentryScope!.context}
    networkLabel={utxo!.name} openKeys={sentry.openKeys} openNodes={sentry.openNodes} onBack={closeStage} />;
  if (stage === 'auto-lock' && snapshot.phase === 'ready' && saveIdle) return <AutoLockSettings mode="custody" save={saveIdle} onBack={closeStage} />;
  if (stage === 'private-notes' && snapshot.phase === 'ready') return <NativeNoteFilesMenu onBack={closeStage}
    onDeposit={canDeposit ? () => {
      if (AppState.currentState === 'active' && readyContext()) { depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null); setStage('note-deposit'); }
    } : undefined}
    onExport={() => { if (noteRestore.begin('export')) { depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null); setStage('backup-notes'); } }}
    onRestore={() => { if (noteRestore.begin('restore')) { depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null); setStage('restore-notes'); } }}
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
    key={snapshot.revision} open={openPrivateDeposit} initialTask={depositTask ?? undefined}
    onBack={() => { depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null); setStage('private-notes'); }}
    onBackup={task => {
      const owner = controllersRef.current, current = readyContext();
      if (!owner || !current || current.context !== guardianContext || AppState.currentState !== 'active') return;
      if (noteRestore.begin('export')) {
        depositBackupReturn.current = task ? { owner, identity: current.identity, task: Object.freeze({ poolId: task.poolId, noteId: task.noteId }) } : null;
        setDepositBackupRoute(depositBackupReturn.current);
        setDepositTask(null); setStage('backup-notes');
      }
    }}
    onActivity={activityView ? (hash) => {
      const current = readyContext();
      if (!current || current.context !== guardianContext || AppState.currentState !== 'active' || !/^0x[0-9a-f]{64}$/i.test(hash)) return;
      setTransactionActivity({ context: current.context, hash });
      depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null);
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
  if (stage === 'backup-notes' && snapshot.phase === 'ready') {
    const returning = depositBackupRoute;
    const canContinue = !!returning && returning.identity === custodyContext(snapshot, catalogue)?.identity;
    return <NativeNoteExport
      step={noteRestore.exportStep} busy={noteRestore.busy} error={noteRestore.error}
      doneLabel={canContinue ? 'Continue deposit' : undefined}
      onChoose={noteRestore.choose} onSave={noteRestore.saveExport} onShowVerify={noteRestore.showVerify} onVerify={noteRestore.verifyExport}
      onBack={() => {
        if (AppState.currentState !== 'active' || depositBackupReturn.current !== returning) return;
        const current = readyContext();
        if (returning && (!current || returning.owner !== controllersRef.current || returning.identity !== current.identity)) {
          depositBackupReturn.current = null; setDepositBackupRoute(null); setDepositTask(null); return;
        }
        cancelNoteRestore(); depositBackupReturn.current = null; setDepositBackupRoute(null);
        if (returning && current) {
          setDepositTask(returning.task); setStage('note-deposit');
        } else { setDepositTask(null); setStage('private-notes'); }
      }} />;
  }
  if (stage === 'security' && ['ready', 'backup-required'].includes(snapshot.phase) && catalogue && snapshot.account && keyExportView) {
    const selected = catalogue.accounts.find((account) => account.id === catalogue.active.accountId)!;
    const extended = selected.type === 'HDAccount' || selected.utxoExtended;
    const script = utxo && !extended ? findWifAddressType(selected.address, utxo) : undefined;
    const keyFormat = snapshot.backup !== 'confirmed' || selected.type === 'Ledger' || selected.type === 'Trezor' ? null : canSign ? 'evm' : utxo && extended
      ? { kind: 'extended' as const, networkLabel: utxo.name, addressType: UTXO_IMPORT_LABELS.p2wpkh }
      : utxo && script ? { kind: 'wif' as const, networkLabel: utxo.name, addressType: UTXO_IMPORT_LABELS[script] } : null;
    return <NativeSecurity key={`${snapshot.revision}:${catalogue.active.accountId}:${snapshot.account.network}`}
      keyExport={keyExportView} keyFormat={keyFormat} accountId={selected.id} accountType={selected.type} accountLabel={accountLabel} address={snapshot.account.address} backupConfirmed={snapshot.backup === 'confirmed'}
      onBack={closeStage} onLock={revoke} onViewRecovery={() => setStage('backup-intro')}
      onRemoveWallet={onWalletRemoved && canRemoveWallet ? openRemoval : undefined}
      onChangePin={snapshot.phase === 'ready' ? () => { clearSecrets(); setStage('change-pin'); } : undefined}
      onDeviceUnlock={deviceUnlockStatus && (deviceUnlockStatus.available || deviceUnlockStatus.enabled) ? () => setStage('device-unlock') : undefined}
      deviceUnlockEnabled={deviceUnlockStatus?.enabled}
      onAutoLock={snapshot.phase === 'ready' && saveIdle ? () => setStage('auto-lock') : undefined}
      captureFailureHandler={() => {
        const local = controllersRef.current;
        const context = local?.authority.getSnapshot();
        const capturedEpoch = epoch.current;
        const request = ++feedbackRequest.current;
        return (cause) => {
          const code = cause instanceof Error ? cause.message : '';
          if (!local || !context || context.phase !== 'ready' || !context.account ||
              !mounted.current || controllersRef.current !== local || epoch.current !== capturedEpoch || feedbackRequest.current !== request ||
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
  else if (stage === 'device-unlock' && deviceUnlockStatus) {
    footer = <>
      <Button title={deviceUnlockStatus.enabled ? `Turn off ${biometrics.label === 'biometrics' ? 'biometric unlock' : biometrics.label === 'fingerprint' ? 'fingerprint unlock' : biometrics.label}` : `Enable ${biometrics.label === 'biometrics' ? 'biometric unlock' : biometrics.label === 'fingerprint' ? 'fingerprint unlock' : biometrics.label}`} disabled={busy || !isWalletPin(pin) || !deviceUnlockStatus.enabled && !deviceUnlockStatus.available} onPress={() => {
      const entered = pin, enabled = !deviceUnlockStatus.enabled;
      setPin('');
      void perform(async (local) => {
        const captured = epoch.current;
        await local.authority.setDeviceUnlock(enabled, entered, () => {
          if (!mounted.current || controllersRef.current !== local || epoch.current !== captured || AppState.currentState !== 'active') throw new Error('CANCELLED');
        });
        if (local.authority.getSnapshot().phase === 'ready') setStage('security');
      });
    }} />
      <Button title="Cancel" variant="secondary" onPress={closeDeviceUnlock} />
    </>;
    body = <>
    <Text style={{ fontSize: 22, fontWeight: '600' }}>{biometrics.label === 'biometrics' ? 'Biometric unlock' : biometrics.label === 'fingerprint' ? 'Fingerprint unlock' : biometrics.label} is {deviceUnlockStatus.enabled ? 'on' : 'off'}</Text>
    <Text style={styles.muted}>{deviceUnlockStatus.enabled ? `Confirm your PIN to turn off ${biometrics.label === 'biometrics' ? 'biometric unlock' : biometrics.label === 'fingerprint' ? 'fingerprint unlock' : biometrics.label}.` : `Confirm your PIN and ${biometrics.label} to enable faster unlock.`} Your PIN remains available.</Text>
    <PinField label="Confirm PIN" value={pin} onChange={setPin} busy={busy} />


  </>;
  }
  else if (stage === 'words' && presentation) {
    footer = <Button title="Continue" disabled={busy} onPress={() => setStage('backup-verify')} />;
    body = <>
      <Notice title="Write these words down in order" body="Anyone with these words can control your wallet. Keep them offline. Pali support will never ask for them." tone="amber" />
      <View style={s.wordGrid}>{presentation.words.map((word, index) => <View key={index} style={s.word}><Text style={s.wordNumber}>{index + 1}</Text><Text style={s.wordText}>{word}</Text></View>)}</View>
    </>;
  }
  else if (stage === 'backup-complete' && snapshot.phase === 'ready') {
    footer = <Button title={t('privacy.deposit.done')} disabled={busy} onPress={closeStage} />;
    body = <View style={s.backupComplete}>
      <View style={s.backupCompleteIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="check" size={40} color={colors.bg} />
      </View>
      <Text accessibilityRole="header" style={s.backupCompleteTitle}>{t('mobile.security.backupComplete')}</Text>
      <Text style={[styles.muted, s.backupCompleteBody]}>Keep your recovery phrase private and offline.</Text>
    </View>;
  }
  else if (snapshot.phase === 'backup-required' && stage === 'choose' && publicSource) {
    const content = shell.tab === 'wallet' ? <NativePortfolioRoute overview={utxo ? null : accountPortfolio} selectNetwork={selectPortfolioNetwork} sendFrom={sendFromPortfolio} detail={visiblePortfolioDetail} closeDetail={() => setPortfolioDetail(null)} navigateDetail={openPortfolioDetail} navigateActivity={openPortfolioActivity} cancelSelection={() => { if (accountNavigation.current) revoke(); else controllersRef.current?.authority.cancelAccountOperation(); }} source={publicSource} reader={balanceReader ?? undefined} accountLabel={accountLabel}
      onExit={exit} onLock={revoke} onViewRecovery={openRequiredBackup} onBackup={openRequiredBackup} navigation={shell.navigation} />
      : shell.tab === 'settings' ? <RealSettings accountLabel={accountLabel} watchOnly={false} navigation={shell.navigation} notifications={notificationSettings}
        backupRequired onBackup={openRequiredBackup} onSecurity={() => setStage('security')} onLock={revoke} onBack={() => shell.select('wallet')} />
      : shell.tab === 'activity' && accountActivity && !utxo ? <AllNetworksActivity controller={accountActivity} accountLabel={accountLabel} navigation={shell.navigation} />
      : shell.tab === 'activity' && activityView && !utxo ? <NativeActivityScreen controller={activityView} accountLabel={accountLabel}
        onBack={() => shell.select('wallet')} navigation={shell.navigation} />
      : shell.tab === 'activity' && utxoActivityView && utxo ? <UtxoActivityScreen authority={utxoActivityView} selectedNetwork={utxo} accountLabel={accountLabel}
        onBack={() => shell.select('wallet')} navigation={shell.navigation} />
      : <Screen><Header title={shell.tab === 'tools' ? 'Tools' : 'Activity'} /><Notice title="Back up your wallet" body="Keep a recovery phrase backup before using wallet tools." />
        <Button title="Back up now" onPress={openRequiredBackup} /></Screen>;
    return <RealAppShell tab={shell.tab} onTab={tab => { cancelAccountNavigation(); notificationTransition.current = null; shell.select(tab); }} immersive={shell.immersive}>{content}</RealAppShell>;
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
    return <NativeSmartAccountSend key={sendTarget.kind === 'token' ? sendTarget.token.contractAddress : sendTarget.kind}
      assetChoices={accountPortfolio?.cachedAssets(snapshot.account.network)?.tokens} availableNative={sendAvailable}
      initialRecipient={sendDraft?.form?.kind === 'evm' ? sendDraft.form.recipient : undefined}
      onChangeAsset={sendTarget.kind === 'native' || sendTarget.kind === 'token' ? changeSendAsset : undefined}
      ledgerConnection={ledgerConnection ?? undefined} recipientResolver={recipientResolver} account={{ ...snapshot.account, revision: snapshot.revision }} source={publicSource} reader={balanceReader} tokenView={tokenView ?? undefined} token={sendTarget.kind === 'token' ? sendTarget.token : undefined} collectible={sendTarget.kind === 'collectible' ? sendTarget.collectible : undefined} open={openSmartSend} context={getNativeSendContext(snapshot.account.network, catalogue?.networks)} accountLabel={accountLabel} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && sendTarget && sendTarget.kind !== 'spt' && sendTarget.kind !== 'utxo' && canSign && transferView && snapshot.account) return <NativeSend availableAmount={sendAvailable} authenticationMethod={deviceUnlockStatus?.available && deviceUnlockStatus.enabled ? 'biometric' : 'pin'} recipientResolver={recipientResolver} key={`${sendDraft?.resumeId ?? ''}:${sendTarget.kind === 'token' ? sendTarget.token.contractAddress : sendTarget.kind}`}
    assetChoices={accountPortfolio?.cachedAssets(snapshot.account.network)?.tokens}
    onChangeAsset={sendTarget.kind === 'native' || sendTarget.kind === 'token' ? changeSendAsset : undefined}
    beforeClose={selectedAccountType === 'Trezor' ? trezorView?.cancel : undefined}
    initialDraft={sendDraft?.form?.kind === 'evm' ? sendDraft.form : sendDraft?.resume && sendDraft.resume.kind !== 'utxo' ? sendDraft.resume.draft : undefined} draftNotice={sendDraft?.notice}
    account={{ ...snapshot.account, revision: snapshot.revision }}
    ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined}
    tokenView={tokenView ?? undefined}
    controller={transferView} context={getNativeSendContext(snapshot.account.network, catalogue?.networks)}
    recipientPicker={sendDraft?.recipientPicker}
    token={sendTarget.kind === 'token' ? sendTarget.token : undefined}
    collectible={sendTarget.kind === 'collectible' ? sendTarget.collectible : undefined}
    savedHash={sendTarget.kind === 'saved' ? sendTarget.hash : undefined}
    replacement={sendTarget.kind === 'cancel' || sendTarget.kind === 'cancel-saved' || sendTarget.kind === 'speed-up' ? { hash: sendTarget.hash, mode: sendTarget.kind } : undefined}
    onChangeNetwork={networkView && !utxo && (!accountPortfolio || accountPortfolio.getSnapshot().filter === 'all') ? openSendNetwork : undefined}
    onViewTransaction={activityView ? hash => {
      const context = readyContext();
      if (!context || context.context !== custodyContext(snapshot, catalogue)?.context ||
          AppState.currentState !== 'active' || !/^0x[0-9a-f]{64}$/i.test(hash)) return;
      setTransactionActivity({ context: context.context, hash });
      rootOrigin.current = null; setStage('choose'); shell.restoreRoot('activity', context.identity);
    } : undefined}
    accountLabel={accountLabel} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && (sendTarget?.kind === 'native' || sendTarget?.kind === 'spt' && canSendSpt || sendTarget?.kind === 'utxo') && utxo && canSendUtxo && openUtxoSend)
    return <NativeUtxoSendScreen authenticationMethod={deviceUnlockStatus?.available && deviceUnlockStatus.enabled ? 'biometric' : 'pin'} beforeClose={selectedAccountType === 'Trezor' ? trezorView?.cancel : undefined} initialDraft={sendDraft?.form?.kind === 'utxo' ? sendDraft.form : sendDraft?.resume?.kind === 'utxo' ? sendDraft.resume.draft : undefined} draftNotice={sendDraft?.notice} key={sendDraft?.resumeId ?? snapshot.revision} network={utxo} open={openUtxoSend}
      ledgerConnection={selectedAccountType === 'Ledger' ? ledgerConnection ?? undefined : undefined}
      availableAmount={sendTarget.kind === 'spt' ? sendTarget.maximumAmount : sendTarget.kind === 'utxo' && sendTarget.asset ? undefined : sendAvailable}
      onChangeNetwork={networkView && !utxo && (!accountPortfolio || accountPortfolio.getSnapshot().filter === 'all') ? openSendNetwork : undefined}
      onViewTransaction={utxoActivityView ? hash => {
        const context = readyContext();
        if (!context || context.context !== guardianContext || AppState.currentState !== 'active' || !/^[0-9a-f]{64}$/i.test(hash)) return;
        setTransactionActivity({ context: context.context, hash }); rootOrigin.current = null; setStage('choose'); shell.restoreRoot('activity', context.identity);
      } : undefined}
      asset={sendTarget.kind === 'spt' || sendTarget.kind === 'utxo' ? sendTarget.asset : undefined} maximumAmount={sendTarget.kind === 'spt' ? sendTarget.maximumAmount : undefined} accountLabel={accountLabel} onBack={closeStage} />;
  else if (snapshot.phase === 'ready' && publicSource) {
    const onAccounts = () => openStage(accounts ? 'accounts' : 'manage-hd');
    let content: React.ReactNode;
    if (shell.tab === 'wallet') content = <NativePortfolioRoute overview={utxo ? null : accountPortfolio} selectNetwork={selectPortfolioNetwork} sendFrom={sendFromPortfolio} detail={visiblePortfolioDetail} closeDetail={() => setPortfolioDetail(null)} navigateDetail={openPortfolioDetail} navigateActivity={openPortfolioActivity} cancelSelection={() => { if (accountNavigation.current) revoke(); else controllersRef.current?.authority.cancelAccountOperation(); }}
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
    onChangeReceiveNetwork={networkView ? openReceiveNetwork : undefined} initialReceive={receiveContinuation}
    onViewRecovery={() => openStage('backup-intro')} onBackup={() => openStage('backup-intro')} onSecurity={() => openStage('security')}
    onActivity={(utxo ? utxoActivityView : activityView) ? () => shell.select('activity') : undefined}
    navigation={shell.navigation}
  />;
    else if (shell.tab === 'activity') content = utxo && utxoActivityView
      ? <UtxoActivityScreen authority={utxoActivityView} selectedNetwork={utxo} accountLabel={accountLabel}
          initialHash={transactionActivity && transactionActivity.context === guardianContext ? transactionActivity.hash : undefined}
          onBack={() => shell.finishLeave('wallet')} navigation={shell.navigation} />
      : accountActivity && !utxo
      ? <AllNetworksActivity controller={accountActivity} accountLabel={accountLabel} navigation={shell.navigation}
          initialTarget={transactionActivity && transactionActivity.context === guardianContext ? { networkId: snapshot.account!.network, hash: transactionActivity.hash }
            : recoveryActivity && recoveryActivity.context === guardianContext ? { networkId: snapshot.account!.network, hash: recoveryActivity.hash } : undefined}
          onAction={canSign ? openAccountActivityAction : undefined} />
      : activityView && !utxo
      ? <NativeActivityScreen controller={activityView} accountLabel={accountLabel}
          initialHash={transactionActivity && transactionActivity.context === guardianContext ? transactionActivity.hash : recoveryActivity && recoveryActivity.context === guardianContext ? recoveryActivity.hash : undefined}
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
    else content = <RealSettings navigation={shell.navigation} notifications={notificationSettings} accountLabel={accountLabel} watchOnly={false} onSecurity={() => openStage('security')} backupRequired={snapshot.backup !== 'confirmed'} onBackup={() => openStage('backup-intro')} onConnections={connectionView ? () => openStage('connections') : undefined}
      onInfrastructure={canSign && openSmartInfrastructure && !utxo && (selectedAccountType === 'HDAccount' || selectedAccountType === 'Imported' || selectedAccountType === 'Ledger' && !!ledgerConnection) ? () => openStage('smart-infrastructure') : undefined}
      activityReset={canSign && catalogue && snapshot.account ? {
        scope: custodyContext(snapshot, catalogue)!.context,
        networkLabel: getNativeNetwork(snapshot.account.network, catalogue.networks).name,
        async reset(assertView) {
          const local = controllersRef.current;
          const expected = custodyContext(snapshot, catalogue)!.context;
          const check = () => {
            assertView();
            if (!mounted.current || !local || local !== controllersRef.current || AppState.currentState !== 'active' ||
                readyContext()?.context !== expected) throw new Error('CANCELLED');
          };
          check();
          await local!.resetActivity(check);
          check();
        },
      } : undefined}
      onLock={revoke} onBack={() => shell.select('wallet')} />;
    return <RealAppShell tab={shell.tab} onTab={tab => { cancelAccountNavigation(); notificationTransition.current = null; shell.select(tab); }} immersive={shell.immersive}>
      {recoveryActivity && recoveryActivity.context === guardianContext && <Button title="Return to recovery" variant="secondary" onPress={() => void returnToRecovery().catch(() => undefined)} />}
      {content}
    </RealAppShell>;
  }
  else body = <Notice title="Wallet unavailable" body="Close and reopen Pali to try again." tone="amber" />;

  const duplicateAuthenticationError = (snapshot.error === 'INVALID_CREDENTIAL' || snapshot.error === 'AUTH_THROTTLED' || snapshot.error === 'DEVICE_UNLOCK_UNAVAILABLE') &&
    error === message(new Error(snapshot.error));
  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={footer} gap={16}>{locked
        ? <View style={s.unlockBrand}><PaliMark size={36} /><Text style={s.unlockBrandName}>Pali Wallet</Text></View>
        : stage === 'backup-complete' ? null : <Header title={title} onBack={stage === 'device-unlock' ? closeDeviceUnlock : ['backup-intro', 'backup-auth', 'words', 'backup-verify'].includes(stage) ? closeBackup : exit} subtitle={typeof __DEV__ !== 'undefined' && __DEV__ ? 'Development build · Use a test wallet' : undefined} />}
        {recoveryNotice}
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
  unlockBrand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 36 },
  unlockBrandName: { fontSize: 18, fontWeight: '600' },
  unlockIntro: { alignItems: 'center', gap: 14, paddingTop: 48, paddingBottom: 18 },
  unlockTitle: { fontSize: 26, lineHeight: 34, fontWeight: '600', textAlign: 'center' },
  unlockCopy: { textAlign: 'center' },
  field: { gap: 10 }, label: { color: colors.muted, fontSize: 13, fontWeight: '500', letterSpacing: 0.2 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 52, fontSize: 16 },
  phraseInput: { minHeight: 120, textAlignVertical: 'top', lineHeight: 26 }, center: { gap: 18, alignItems: 'center', paddingVertical: 50 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, word: { width: '47%', borderRadius: 14, backgroundColor: colors.surface, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordNumber: { color: colors.muted, fontSize: 12, minWidth: 18 }, wordText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 48 },
  checkbox: { width: 24, height: 24, borderColor: colors.muted, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.pink, borderColor: colors.pink }, checkmark: { color: colors.bg, fontWeight: '700' },
  checkLabel: { flex: 1, lineHeight: 22 },
  backupComplete: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 320, gap: 20 },
  backupCompleteIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  backupCompleteTitle: { fontSize: 28, lineHeight: 36, fontWeight: '600', textAlign: 'center' },
  backupCompleteBody: { textAlign: 'center' },
  address: { fontSize: 15, lineHeight: 24, marginTop: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
