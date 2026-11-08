import { sentrySettingsStorageKey } from '../../../../source/shared/sentrySettings.ts';
import { NativePrivateWithdrawal } from './privateWithdrawal.ts';
import { createPrivacyWithdrawalsController, PRIVACY_WITHDRAWAL_GAS } from '../../../../source/wallet/privacyWithdrawals.ts';
import { capturePrivateWithdrawalAttempt, privateWithdrawalUnsignedBytes } from '../../../../source/utils/privacy/withdrawalMetadata.ts';
import type { IPrivacyWithdrawalsHost } from '../../../../source/utils/privacy/withdrawTypes.ts';
import type { EvmGasPolicy } from '../../../../source/shared/evmDappPreparation.ts';
import { openOwnedPrivatePool } from './ownedPrivatePool.ts';
import { NativePrivateDeposit } from './privateDeposit.ts';
import { createPrivacyTransactionsController } from '../../../../source/wallet/privacyTransactions.ts';
import { capturePrivateDepositAttempt, privateDepositUnsignedBytes } from '../../../../source/utils/privacy/depositMetadata.ts';
import type { IPrivacyDepositAttempt, IPrivacyDepositSession } from '../../../../source/utils/privacy/transactionTypes.ts';
import type { IPrivacyWithdrawalAttempt } from '../../../../source/utils/privacy/withdrawalTransactionTypes.ts';
import { authorizePrivateNoteReplay } from '../../../../source/wallet/privateNoteReplay.ts';
import { Contract } from '../../../../source/utils/ethersV6Compat.ts';
import { hexlify } from 'ethers/utils';
import {
  NativeGuardianRecoveryController,
  type NativeGuardianRecoveryDraft,
  type NativeGuardianRecoveryAction,
  type NativeGuardianRecoveryStatus,
} from '../smartAccount/guardianRecovery.ts';
import {
  buildGuardianRecoveryStart,
  buildGuardianRecoveryScheduleTransaction,
  buildGuardianRecoveryFinalizeTransaction,
  validateGuardianRecoveryOperation,
} from '../../../../source/utils/smartAccount/guardianRecoveryCommands.ts';
import { captureGuardianRecoveryIntent } from '../../../../source/utils/smartAccount/guardianRecoveryIntent.ts';
import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getSmartAccountAuthHash,
} from '../../../../source/utils/smartAccount/account.ts';
import {
  paliSmartAccountInterface,
  paliGuardianRecoveryModuleInterface,
} from '../../../../source/utils/smartAccount/contracts.ts';
import { EVM_SIGNED_RECORD_LIMITS } from '../../../../source/wallet/evmSignedRecords.ts';
import type {
  NativeGuardianRecoveryIntent,
  CatalogueMutation,
  NativeWalletCatalogueSnapshot,
  NativeCatalogueAccount,
} from './walletCatalogue.ts';
import { snapshotNftTransferSelection } from './nftTransferAdmission.ts';
import { NATIVE_EVM_FEE_FUNDING, type EvmFeeFunding } from '../../../../source/shared/evmFeeApproval.ts';
import { blacklistService } from '../../../../source/utils/security/blacklistService.ts';
import type { IBlacklistCheckResult } from '../../../../source/types/security.ts';
import { parseTokenAmount } from '../../../../source/shared/erc20.ts';
import { parseDecimalAmount } from '../core/amounts.ts';
import { createNativeSmartOperation } from '../smartAccount/runtime.ts';
import { createSmartAccountCallsExecutions, normalizeDappCallsRequest } from '../../../../source/shared/dappCalls.ts';
import { captureSmartAccountCallsIdentity } from '../../../../source/shared/dappCallsStatus.ts';
import {
  getSmartAccountLocalEcdsaOwners,
  signSmartAccountEcdsaOperation,
  type SmartAccountLocalOwner,
} from '../../../../source/utils/smartAccount/signOperation.ts';
import type { NativeSmartOperationPorts } from '../smartAccount/runtime.ts';
import { snapshotSmartAccountDappTransaction } from '../../../../source/shared/smartAccountDappTransaction.ts';
import { summarizeApproval, decodeApprovalData } from '../../../../source/shared/approval.ts';
import type { NativeGuardianPolicyDraft, NativeSmartAccountAmount, NativeSmartAccountIntent, NativeSmartAccountOperation } from '../smartAccount/operation.ts';
import { guardianPolicyObservationIdentity, inspectGuardianRemovals, type GuardianRemovalInspection } from '../../../../source/wallet/guardianRemoval.ts';
import { loadNativeKeyringSdk, type NativeKeyringSdk } from './keyringSdk.ts';
import { createNativeLedgerHost } from '../hardware/ledgerHost.ts';
import type { NativeLedgerTransport, NativeLedgerOwner } from '../hardware/ownedLedgerTransport.ts';
import type { NativeLedgerRuntime } from './ledgerAccounts.ts';
import { prepareNativeConnectionTransaction } from '../connections/transactionRuntime.ts';
import { readNativeApprovalMetadata } from '../connections/approvalMetadata.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import { walletFetch } from '../platform/http.ts';
import { normalizeDappTransaction } from '../../../../source/shared/dappTransaction.ts';
import { serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { requireSmartAccountAddressIdentity } from '../../../../source/utils/smartAccount/addressIdentity.ts';
import { readSmartAccountValidatorMetadata } from '../../../../source/utils/smartAccount/executionMetadata.ts';
import { buildGuardianPolicyExecutions, projectGuardianPolicyModule } from '../../../../source/utils/smartAccount/guardianPolicy.ts';
import {
  getGuardianRecoveryOperationId,
  type GuardianRecoveryObservation,
} from '../../../../source/utils/smartAccount/guardianStatus.ts';
import { createNativeSmartAccountProvider } from '../smartAccount/provider.ts';
import type { NativeConnectionHost } from '../connections/host.ts';
import { createDeviceUnlockEnrollment } from '../../../../source/wallet/deviceUnlockEnrollment.ts';
import type { DeviceUnlockControls } from '@sidhujag/sysweb3-keyring/cjs/keyring-core.js';
import {
  prepareSmartAccountMessage,
  encodeSmartAccountMessageSignature,
} from '../../../../source/utils/smartAccount/messageSigning.ts';
import { matchesDappMessageRequest, readDappMessageRequest } from '../../../../source/shared/dappMessageRequest.ts';
import { openNativeConnectionRepository, type NativeConnectionRepository } from '../connections/storage.ts';
import type { EvmObservationRequest, EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';
import { sameRecoverySnapshot } from '../storage/recoverySnapshot.ts';
import { EvmSignedRecords, createEvmSignedRecordLifecycle, type EvmVerifiedReplacementBinding, type EvmSignedRetirementReadMethod, type EvmSignedRetirementReadForChain } from '../../../../source/wallet/evmSignedRecords.ts';
import { UTXO_SIGNED_RECORD_KEY } from '../../../../source/wallet/utxoSignedBundle.ts';
import { EvmSignedReplay, observeRetainedEvmTransaction } from '../../../../source/wallet/evmSignedReplay.ts';
import { observeSmartAccountActivity } from '../../../../source/wallet/smartAccountActivity.ts';
import { getObservedEvmTerminalPhase } from '../../../../source/shared/evmTransactionObservation.ts';
import { assertNativeRecordDomains } from './recoveryInventory.ts';
import { createNativeAutomaticNoncePlanner, createNativeSignedRecordView } from './sharedSignedRecords.ts';
import type { EvmSubmissionContext } from '@sidhujag/sysweb3-keyring';
import { isNativeNewPassword, isNativePasswordInput } from './password.ts';
import type { IKeyringAccountState, INetwork as SdkNetwork } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { canonicalUtxoEndpoint, findUtxoNetwork, getUtxoSdkNetwork, isCustomUtxoNetworkId, projectUtxoRegistration, supportsUtxoSoftwareCustody, utxoRegistrationData, type UtxoNetwork, type UtxoNetworkId } from '../core/utxoNetworks.ts';
import { exactUtxoResponseFetch, verifyUtxoRegistration } from '../core/utxoReadSession.ts';
import type { UtxoActivityContext, UtxoActivitySource } from '../core/utxoActivity.ts';
import type { UtxoBalance } from '../core/utxoBalanceReader.ts';
import { findWifAddressType, normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { parseUtxoPublicIdentifier, type UtxoPublicIdentifier } from '../core/utxoIdentifier.ts';
import { WalletStorageError, type OpenWalletStorage, type RecoveryStorageSnapshot, type WalletIdentityRead } from '../storage/types.ts';
import type { CustodyRuntime, CustodyRuntimeFactory } from './types.ts';
import { CustodyRuntimeError } from './types.ts';
import { TransferJournalError } from './transferJournal.ts';
import { NativeWalletCatalogue, WalletCatalogueError,
  catalogueAccountGroup,
  catalogueEvmNetworks,
  catalogueUtxoNetworks,
  createNativeAccountRecord,
  recoveryVerificationRecords,
  sentryRootPublicIdentity,
  WALLET_CATALOGUE_KEY,
} from './walletCatalogue.ts';
import { getNativeNetwork, snapshotNativeNetwork, nativeSigningEnabled } from './networkContext.ts';
import type { NativeAccountRequest, NativeAccountRuntime, NativeNetworkRuntime } from './accounts.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import { NativeTransferError, type NativeTransferDispatchValidation, type NativeReplacementApproval, type NativeTransferRuntime } from './transfers.ts';
import { assertTransferIntentEnvelope, equalTransferIntent, snapshotErc20TransferIntent, snapshotNativeAssetTransferIntent, type NativeAssetTransferIntent } from './transferIntent.ts';
import { NativeTransferRpc, assertSpeedUpEnvelope } from './transferRpc.ts';
import { readOwnData, snapshotCancellationTransfer, snapshotNftQuoteEnvelope, snapshotUnsignedTransfer, unsignedTransferBytes } from './evmFeeContracts.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import { NativeTokenRegistry, snapshotSavedCollectible } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenInventory, NativeTokenScope, SavedCollectible } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenRuntime } from '../portfolio/nativeTokens.ts';
import { NativeActivityHistory } from '../activity/historyStore.ts';
import { createActivityScope, type ActivityScope, type EvmActivityReadScope } from '../activity/types.ts';
import type { NativeActivityRuntime } from '../activity/nativeActivity.ts';
import { computeAddress, Transaction, recoverAddress } from 'ethers/transaction';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { keyExportRegistrationHash, snapshotHdKeyExportScope, type NativeHdKeyExportRuntime } from './hdKeyExport.ts';
import { parseNativeAccountId, type NativeAccountType } from './accountIdentity.ts';
import { importedKeyIdentity, isUtxoAccountPrivateKey, isUtxoWifText, normalizeImportedKey, normalizeUtxoImport } from './importedAccounts.ts';
import { importAccountWithRecovery } from '../../../../source/wallet/importedAccountRecovery.ts';
import type { NativeImportRuntime } from './importedAccounts.ts';
import { stageInitialWallet, type RecoveryAccountGroup } from '../../../../source/wallet/accountRecovery.ts';
import type { IPrivateVaultSession } from '../../../../source/wallet/privateVault.ts';
import type { NativeNoteBackupRuntime, NativeNoteCapacityRuntime, NativeNoteInventory } from './noteBackupRuntime.ts';
import { createNativeNoteImport, type NativeNoteImportRuntime } from './noteImport.ts';
import type { createNativePrivacyPoolSync } from '../privacy/nativePrivacyPoolSync.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { NativeUtxoSend } from './utxoSend.ts';
import { SENTRY_NETWORKS, type SentryNetwork } from '../../../../source/shared/sentryNetworks.ts';
import { deriveSentryVaultId } from '../../../../source/wallet/sentryKeyVault.ts';
import type { DeriveSentryPublicKey, NativeSentryKeyManagement } from './sentryKeyManagement.ts';

type SoftwareSdk = NativeKeyringSdk;
type IndexedKeyring = InstanceType<SoftwareSdk['HostKeyring']> & {
  deriveEvmHdRuntimeAccount?: (request: { index: number }, options: { assertCurrent(): void }) => Promise<IKeyringAccountState>;
};

class NativePrivateSubmissionError extends Error {
  readonly failure: Readonly<{ transactionNotBroadcast: boolean; signedTransactionHash?: string }>;
  constructor(failure: Readonly<{ transactionNotBroadcast: boolean; signedTransactionHash?: string }>) {
    super('privacy_deposit_submission_failed');
    this.failure = Object.freeze({ ...failure });
  }
}

function supportsPrivateWithdrawal(type: string, account: IKeyringAccountState | undefined) {
  return (type === 'HDAccount' || type === 'Imported') && !!account &&
    !account.isLedgerWallet && !account.isTrezorWallet && !account.isSmartAccount;
}

export class KeyringRuntimeError extends CustodyRuntimeError {
  constructor(code: KeyringRuntimeError['code']) {
    super(code);
    this.name = 'KeyringRuntimeError';
  }
}

export type KeyringRuntimeDependencies = Readonly<{
  ensureCryptoReady(): Promise<void>;
  checkSmartAccountAddress?: (address: string) => Promise<IBlacklistCheckResult>;
  connectionFetch?: typeof walletFetch;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<SoftwareSdk>;
  createLedgerTransport?: (owner: NativeLedgerOwner) => Promise<NativeLedgerTransport>;
  openPrivacyPool?: (network: NativeNetworkRegistration, poolId: PrivacyPoolId, signal: AbortSignal, assertCurrent: () => void) => Promise<ReturnType<typeof createNativePrivacyPoolSync>>;
  openPrivacyWithdrawal?: (signal: AbortSignal, assertCurrent: () => void) => Promise<Readonly<{
    prove: IPrivacyWithdrawalsHost['prove'];
    relayers: IPrivacyWithdrawalsHost['relayers'];
    fetcher: typeof fetch;
  }>>;
  assertActive?: () => void;
  deviceUnlock?: Pick<Parameters<typeof createDeviceUnlockEnrollment>[0], 'credentials' | 'randomId'>;
  readEvmRetirement: ((network: NativeNetworkRegistration, method: EvmSignedRetirementReadMethod,
    params: readonly unknown[], signal: AbortSignal, guard: () => void) => Promise<unknown>) | null;
  readUtxoBalance?: (network: UtxoNetwork, address: string, signal: AbortSignal, guard: () => void) => Promise<UtxoBalance>;
  readUtxoAccount?: (network: UtxoNetwork, xpub: string, signal: AbortSignal, guard: () => void) => Promise<UtxoBalance>;
  utxoFetch?: typeof globalThis.fetch;
  prepareSmartAccount?: (network: NativeNetworkRegistration, accountIndex: number, managementAddress: string, signal: AbortSignal, guard: () => void) => Promise<{ address: string; metadata: NonNullable<IKeyringAccountState['smartAccount']> }>;
  /** Only a separately qualified host can install the Sentry derivation executor. */
  deriveSentryPublicKey?: DeriveSentryPublicKey;
  observeActivity?: (network: NativeNetworkRegistration, expected: EvmObservationRequest, signal: AbortSignal, guard: () => void) => Promise<EvmTransactionObservation>;
}>;

/** Internal native read adapter. Registry snapshots never come from retained transaction metadata. */
export function createNativeRetirementReadForChain(
  registrations: readonly NativeNetworkRegistration[],
  read: NonNullable<KeyringRuntimeDependencies['readEvmRetirement']>,
  contextSignal: AbortSignal,
  assertOwner: () => void
): EvmSignedRetirementReadForChain {
  const networks = new Map(registrations.map((entry) => {
    const network = snapshotNativeNetwork(entry);
    return [network.chainId, network] as const;
  }));
  return (chainId, signal, assertRetirementCurrent) => {
    const check = () => {
      checkGuard(assertOwner); checkGuard(assertRetirementCurrent);
      if (contextSignal.aborted || signal.aborted) throw new KeyringRuntimeError('CANCELLED');
    };
    check();
    const network = networks.get(chainId);
    if (!network) return null;
    return async (method, params) => {
      check();
      const abort = new AbortController();
      const cancel = () => abort.abort();
      contextSignal.addEventListener('abort', cancel, { once: true });
      signal.addEventListener('abort', cancel, { once: true });
      try {
        check();
        const result = await read(network, method, params, abort.signal, check);
        check();
        return result;
      } finally {
        contextSignal.removeEventListener('abort', cancel);
        signal.removeEventListener('abort', cancel);
        abort.abort();
      }
    };
  };
}

/** Internal host capabilities consumed by context-bound controllers, never public DTOs. */
export interface KeyringRuntime extends CustodyRuntime {
  readonly ledger: NativeLedgerRuntime;
  openConnectionHost(): Promise<NativeConnectionHost>;
  openSmartAccountDeployment(assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  openSmartAccountSend(recipient: string, amount: NativeSmartAccountAmount, assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  refreshSmartAccountMetadata(signal: AbortSignal, assertCurrent: () => void): Promise<GuardianRecoveryObservation | null>;
  getGuardianRecoveryIntent(): NativeGuardianRecoveryIntent | null;
  openGuardianRecovery(draft: NativeGuardianRecoveryDraft, signal: AbortSignal, assertCurrent: () => void): Promise<NativeGuardianRecoveryController>;
  openGuardianPolicy(draft: NativeGuardianPolicyDraft, signal: AbortSignal, assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  canManageGuardianPolicy(): boolean;
  inspectGuardianRemoval(signal: AbortSignal, assertCurrent: () => void): Promise<GuardianRemovalInspection>;
  readonly readUtxoBalance?: (id: UtxoNetworkId, address: string, signal: AbortSignal) => Promise<UtxoBalance>;
  /** Owns the private Blockbook identifier; a screen receives only projected rows. */
  withUtxoActivityRead<T>(
    expected: UtxoActivityContext,
    signal: AbortSignal,
    assertOwner: () => void,
    assertView: () => void,
    read: (source: UtxoActivitySource & { readonly readSentry?: never }, signal: AbortSignal, check: () => void) => Promise<T>,
  ): Promise<T>;
  /** Selected software key only, consumed by the context-bound secret presentation flow. */
  readonly keyExport?: NativeHdKeyExportRuntime;
  readonly activity?: NativeActivityRuntime;
  resetActivity(assertOwner: () => void, invalidateViews: () => void): Promise<void>;
  /** Local public token descriptors only; never exposes the underlying store. */
  readonly tokens?: NativeTokenRuntime & {
    addCollectible(revision: number, collectible: SavedCollectible, guard: () => void): Promise<NativeTokenInventory>;
    removeCollectible(revision: number, collectible: SavedCollectible, guard: () => void): Promise<NativeTokenInventory>;
  };
  /** Native transfer host only; never exposed directly to a screen. */
  readonly transfers?: NativeTransferRuntime;
  openUtxoSend?(assertCurrent: () => void): Promise<NativeUtxoSend>;
  /** Internal Sentry review and encrypted storage only. */
  getSentryKeyNetwork?(): SentryNetwork | undefined;
  openSentryKeyManagement?(lifetime: AbortSignal, assertCurrent: () => void): Promise<NativeSentryKeyManagement>;
  /** Trusted note file adapter only. Never part of a public wallet snapshot. */
  openNoteBackup?(assertCurrent: () => void): Promise<NativeNoteBackupRuntime>;
  openNoteCapacity?(assertCurrent: () => void): Promise<NativeNoteCapacityRuntime>;
  readNoteInventory?(assertCurrent: () => void): Promise<NativeNoteInventory>;
  openNoteImport?(assertCurrent: () => void): Promise<NativeNoteImportRuntime>;
  openPrivateDeposit?(signal: AbortSignal, assertCurrent: () => void): Promise<NativePrivateDeposit>;
  /** Internal removal authorization. The protected snapshot never reaches a screen. */
  authorizeWalletRemoval?(password: string, assertCurrent: () => void, beforeSnapshot: (assertCurrent: () => void) => Promise<void>): Promise<Readonly<{
    snapshot: RecoveryStorageSnapshot;
    assertCurrent(): void;
  }>>;
  /** Public metadata only; no selection/signing authority. Cleared on lock. */
  readonly catalogue: { getSnapshot(): NativeWalletCatalogueSnapshot | null };
  readonly backup: {
    readPhrase(password: string): Promise<readonly string[]>;
    fingerprint(): Promise<string>;
    confirm(fingerprint: string): Promise<void>;
  };
}

function validPassword(password: unknown, creating: boolean): asserts password is string {
  if (
    !(creating ? isNativeNewPassword(password) : isNativePasswordInput(password))
  ) throw new KeyringRuntimeError('INVALID_INPUT');
}

/** A Promise/thenable return cannot satisfy the host's synchronous revocation check. */
function checkGuard(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
    throw new KeyringRuntimeError('CANCELLED');
  }
}

/**
 * Adapt the shared keyring without exposing it, account secrets or
 * storage to a screen. The factory cannot load SDK code before native crypto
 * qualification and cannot silently substitute an in-memory store.
 */
export function createKeyringRuntimeFactory(
  dependencies: KeyringRuntimeDependencies
): CustodyRuntimeFactory {
  if (dependencies.readEvmRetirement !== null && typeof dependencies.readEvmRetirement !== 'function')
    throw new Error('A signed-record retirement capability is required');
  return {
    async open(): Promise<KeyringRuntime> {
      await dependencies.ensureCryptoReady();
      const storage = await dependencies.openStorage();
      try {
        const sdk = await (dependencies.loadSdk?.() ?? loadNativeKeyringSdk());
        if (typeof sdk.captureEvmSubmission !== 'function' || typeof sdk.submitSignedEvmTransaction !== 'function') throw new Error('Shared EVM submission SDK is required');
        const deviceUnlock = dependencies.deviceUnlock && storage.deviceUnlockEnrollment
          ? createDeviceUnlockEnrollment({ ...dependencies.deviceUnlock, enrollment: storage.deviceUnlockEnrollment }) : undefined;
        const host = sdk.createKeyringHost(storage.keyringStorage, deviceUnlock ? { deviceUnlock: deviceUnlock.sdkPort } : undefined);
        const deviceControls = new WeakMap<IndexedKeyring, DeviceUnlockControls>();
        const initialEvmNetwork = getNativeNetwork('ethereum');
        const sdkEvmNetwork = (network: NativeNetworkRegistration): SdkNetwork => ({
          kind: sdk.INetworkType.Ethereum, chainId: Number(network.chainId), slip44: network.slip44,
          url: network.rpcUrl, currency: network.symbol, label: network.name,
        });
        const initialState = () => ({
          activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
          activeNetwork: sdkEvmNetwork(initialEvmNetwork),
          accounts: {
            HDAccount: {} as Record<number, IKeyringAccountState>,
            Imported: {} as Record<number, IKeyringAccountState>, Ledger: {} as Record<number, IKeyringAccountState>, Trezor: {} as Record<number, IKeyringAccountState>, SmartAccount: {} as Record<number, IKeyringAccountState>,
          },
        });
        type State = ReturnType<typeof initialState>;
        let ledgerTransport: NativeLedgerTransport | undefined;
        let ledgerLifetime: AbortController | undefined;
        let ledgerVerified: { accountId: string; generation: number; snapshot: NativeWalletCatalogueSnapshot; transport: NativeLedgerTransport } | undefined;
        let ledgerCleanup: Promise<void> | undefined;
        let ledgerOpening: { retire(): Promise<void> } | undefined;
        let ledgerScanOrdinal = 0;
        let unsubscribeLedgerStatus: (() => void) | undefined;
        const ledgerStatusListeners = new Set<() => void>();
        const publishLedgerStatus = () => {
          for (const listener of ledgerStatusListeners) {
            try { listener(); } catch { /* Observation cannot change custody. */ }
          }
        };
        const retireLedger = () => {
          const previous = ledgerTransport;
          ledgerTransport = undefined;
          ledgerVerified = undefined;
          unsubscribeLedgerStatus?.();
          unsubscribeLedgerStatus = undefined;
          publishLedgerStatus();
          ledgerLifetime?.abort();
          ledgerLifetime = undefined;
          preparedLedger = undefined;
          const opening = ledgerOpening;
          if (previous || opening) ledgerCleanup = Promise.all([ledgerCleanup, previous?.dispose(), opening?.retire()]).then(() => undefined);
          return ledgerCleanup;
        };
        let preparedLedger: { account: IKeyringAccountState; generation: number; snapshot: NativeWalletCatalogueSnapshot } | undefined;
        const ledgerHost = createNativeLedgerHost(() => ledgerTransport);
        const openKeyring = (scope: State) => {
          let controls: DeviceUnlockControls | undefined;
          const instance = new sdk.HostKeyring(host, { captureEvmSubmission: null,
            ...(deviceUnlock ? { receiveDeviceUnlock: (value: DeviceUnlockControls) => { controls = value; } } : {}),
          }, () => sdk.createLedgerHardware(ledgerHost)) as IndexedKeyring;
          if (controls) deviceControls.set(instance, controls);
          instance.setVaultStateGetter(() => scope);
          return instance;
        };
        let state = initialState();
        let keyring = openKeyring(state);
        const catalogue = new NativeWalletCatalogue(storage.keyringStorage);
        const tokens = new NativeTokenRegistry(storage.keyringStorage);
        const activityHistory = new NativeActivityHistory(storage.keyringStorage);
        const signedRecords = new EvmSignedRecords(storage.signedRecords, Date.now, () => { void lock().catch(() => undefined); });
        const utxoRecords = storage.utxoSignedRecords && new (await import('../../../../source/wallet/utxoSignedRecords.ts')).UtxoSignedRecords(
          storage.utxoSignedRecords, storage.utxoSignedRecords,
          () => { void lock().catch(() => undefined); }
        );
        let catalogueSnapshot: NativeWalletCatalogueSnapshot | null = null;
        let generation = 0;
        let contextReadLifetime: AbortController | undefined;
        const retireContextReadLifetime = () => {
          const previous = contextReadLifetime;
          contextReadLifetime = undefined;
          previous?.abort();
        };
        let pendingBalance: AbortController | null = null;
        let pendingRegistration: AbortController | null = null;
        let utxoSend: NativeUtxoSend | undefined;
        let sentryKeys: NativeSentryKeyManagement | undefined;
        const retireSentryKeys = () => {
          sentryKeys?.dispose();
          sentryKeys = undefined;
        };
        type NoteRuntime = ReturnType<typeof import('./noteBackupRuntime.ts').createNativeNoteBackupRuntime>;
        let noteBackups: NoteRuntime | undefined;
        let privateDomainStorageFault: 'unreported' | 'reopen' | undefined;
        const requirePrivateDomainReopen = () => { privateDomainStorageFault ??= 'unreported'; };
        const requiresReopen = () => catalogue.requiresReopen || tokens.requiresReopen || activityHistory.requiresReopen || signedRecords.requiresReopen || utxoRecords?.requiresReopen === true || privateDomainStorageFault === 'reopen';
        const revokeGeneration = () => {
          const next = ++generation;
          void retireLedger()?.catch(() => undefined);
          retireContextReadLifetime();
          retireSentryKeys();
          noteBackups?.invalidate();
          pendingBalance?.abort();
          pendingRegistration?.abort();
          utxoSend?.cancel(); utxoSend = undefined;
          return next;
        };
        let closed = false;
        let active: Promise<unknown> | null = null;
        const pendingSubmissions = new Set<Promise<unknown>>();
        let reserved: object | null = null;
        let closing: Promise<void> | null = null;
        let recoveryRetirement: Promise<string> | null = null;
        let authenticatedPair: string | null = null;
        let verifiedIdentity: WalletIdentityRead | null = null;
        let connectionWalletBinding: string | null = null;
        let connectionNetworkId: string | null = null;
        let connectionNetwork: SdkNetwork | null = null;
        let connectionRepository: Promise<NativeConnectionRepository> | null = null;
        let connectionRepositoryBinding: string | null = null;
        const readIdentity = async (): Promise<WalletIdentityRead> => {
          if (storage.recovery) {
            const identity = await storage.recovery.readIdentity();
            if (!identity) throw new KeyringRuntimeError('NOT_READY');
            connectionWalletBinding = identity.walletBindingId;
            return identity;
          }
          const pairFingerprint = await storage.getWalletFingerprint();
          connectionWalletBinding = pairFingerprint;
          return { walletBindingId: pairFingerprint, pairFingerprint, root: null, verification: 'requires-unlock' };
        };

        const current = (captured: number) => {
          if (closed || captured !== generation) throw new Error('CANCELLED');
          if (dependencies.assertActive) { try { checkGuard(dependencies.assertActive); } catch { throw new KeyringRuntimeError('CANCELLED'); } }
          if (requiresReopen()) throw new KeyringRuntimeError('CLEANUP_FAILED');
        };
        const lock = (): Promise<void> => {
          generation++;
          // Invoke the SDK now: its secret buffers are retired synchronously.
          const pending = keyring.lockWallet();
          const hardwareCleanup = retireLedger();
          const retired = hardwareCleanup ? Promise.all([pending, hardwareCleanup]) : pending;
          state.accounts = initialState().accounts;
          catalogueSnapshot = null;
          authenticatedPair = null; verifiedIdentity = null;
          retireContextReadLifetime();
          retireSentryKeys();
          noteBackups?.invalidate();
          pendingBalance?.abort();
          pendingRegistration?.abort();
          utxoSend?.cancel(); utxoSend = undefined;
          // Retire secrets synchronously, then report quarantine asynchronously.
          // storage.close() must still install its cleanup promise and drain work.
          return retired.then(() => {
            if (requiresReopen()) throw new KeyringRuntimeError('CLEANUP_FAILED');
          });
        };
        const closeRuntime = (capturePair: boolean, beforeClose?: () => Promise<void>): Promise<void> => {
          if (closing) return closing;
          let resolveClose!: () => void, rejectClose!: (error: KeyringRuntimeError) => void;
          let pairFingerprint: string | undefined;
          // Install both admissions before lock can invoke any injected callback.
          closing = new Promise<void>((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });
          if (capturePair) recoveryRetirement = closing.then(() => {
            if (!pairFingerprint) throw new KeyringRuntimeError('CLEANUP_FAILED');
            return pairFingerprint;
          });
          closed = true;
          const work = active;
          let revocation: Promise<void>;
          try { revocation = lock(); } catch { revocation = Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED')); }
          noteBackups?.dispose();
          void (async () => {
            const [, revoked] = await Promise.allSettled([work, revocation, ...pendingSubmissions]);
            let failed = false;
            try { await keyring.lockWallet(); } catch { failed = true; }
            if (capturePair && !failed) {
              try {
                const fingerprint = await storage.getWalletFingerprint();
                if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Invalid retirement');
                pairFingerprint = fingerprint;
              } catch { failed = true; }
            }
            if (beforeClose && !failed) {
              if (revoked?.status !== 'fulfilled' || requiresReopen()) failed = true;
              else { try { await beforeClose(); } catch { failed = true; } }
            }
            if (connectionRepository) {
              const opened = await Promise.allSettled([connectionRepository]);
              if (opened[0]?.status === 'fulfilled') {
                try { await opened[0].value.dispose(); } catch { failed = true; }
              }
            }
            try { await storage.close(); } catch { failed = true; }
            if (failed) throw new KeyringRuntimeError('CLEANUP_FAILED');
          })().then(resolveClose, () => rejectClose(new KeyringRuntimeError('CLEANUP_FAILED')));
          return closing;
        };
        const run = <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          if (closed) return Promise.reject(new Error('CANCELLED'));
          if (requiresReopen()) {
            void lock().catch(() => undefined);
            return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
          }
          if (active || reserved) return Promise.reject(new Error('BUSY'));
          const captured = generation;
          // Admit before invoking any injected storage/SDK callback.
          const task = Promise.resolve().then(() => operation(captured));
          const handled = task.catch(async (error: unknown) => {
            const wasCurrent = captured === generation && !closed;
            if (!wasCurrent) {
              if (!requiresReopen()) throw new KeyringRuntimeError('CANCELLED');
              // Quarantine belongs to this storage owner, across session changes.
              try { await lock(); } catch { closed = true; }
              throw new KeyringRuntimeError('CLEANUP_FAILED');
            }
            try { await lock(); }
            catch { closed = true; throw new KeyringRuntimeError('CLEANUP_FAILED'); }
            if (closed) throw new KeyringRuntimeError('CANCELLED');
            if (error instanceof KeyringRuntimeError) throw error;
            if (error && typeof error === 'object' && 'code' in error && error.code === 'HARDWARE_REQUEST_CANCELLED')
              throw new KeyringRuntimeError('CANCELLED');
            if (error instanceof TransferJournalError && error.code === 'PENDING_TRANSFER') throw new KeyringRuntimeError('PENDING_TRANSFER');
            if (error instanceof WalletCatalogueError && error.code === 'CATALOGUE_LIMIT') throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (error instanceof WalletCatalogueError && error.code === 'CATALOGUE_NOT_REMOVABLE') throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            if (error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED')
              throw new KeyringRuntimeError('AUTH_THROTTLED');
            throw new KeyringRuntimeError('OPERATION_FAILED');
          }).finally(() => { if (active === handled) active = null; });
          active = handled;
          return handled;
        };
        const checkedAccount = (account: IKeyringAccountState, index: number, networkId: string, utxos: readonly UtxoNetwork[]) => {
          if (!account || account.id !== index || account.isImported || account.isLedgerWallet ||
              account.isTrezorWallet || account.isSmartAccount) throw new Error('UNAVAILABLE');
          normalizePublicAddress(account.address, networkId, utxos);
          return account;
        };
        const checkedImported = (value: IKeyringAccountState, key: string, index: number) => {
          const expected = importedKeyIdentity(key, index);
          if (!value || value.isImported !== true || value.isLedgerWallet || value.isTrezorWallet || value.isSmartAccount ||
              !Number.isSafeInteger(value.id) || value.id < 0 ||
              normalizePublicAddress(value.address, 'ethereum') !== expected.address ||
              typeof value.xpub !== 'string' || !/^0x(?:(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(value.xpub) || computeAddress(value.xpub) !== expected.address ||
              typeof value.xprv !== 'string' || value.xprv.length < 32 || value.xprv.length > 1024)
            throw new KeyringRuntimeError('OPERATION_FAILED');
          // Imported EVM scalars have no derivation path. The host owns their durable ordinal.
          return { ...value, id: index, address: expected.address };
        };
        const checkedUtxoImport = (account: IKeyringAccountState, network: UtxoNetwork, expectedKind?: UtxoPublicIdentifier['kind']) => {
          if (!account || account.isImported !== true || account.isLedgerWallet ||
              account.isTrezorWallet || account.isSmartAccount ||
              !Number.isSafeInteger(account.id) || account.id < 0 ||
              typeof account.xprv !== 'string' || account.xprv.length < 32 || account.xprv.length > 1024)
            throw new KeyringRuntimeError('OPERATION_FAILED');
          const publicKey = parseUtxoPublicIdentifier(account.xpub, network);
          if (publicKey.identifier !== account.xpub || publicKey.address !== account.address ||
              (publicKey.kind === 'account' && account.xpub.includes('(')) ||
              (expectedKind !== undefined && publicKey.kind !== expectedKind))
            throw new KeyringRuntimeError('OPERATION_FAILED');
          return account;
        };
        const stateFor = (records: typeof catalogue.privateRecords, networkId = records.active.networkId): State => {
          const next = initialState();
          const utxo = findUtxoNetwork(networkId, catalogueUtxoNetworks(records.networks));
          const group = catalogueAccountGroup(records, networkId);
          if (group) next.accounts = group.accounts as State['accounts'];
          const selection = networkId === records.active.networkId
            ? parseNativeAccountId(records.active.accountId)
            : group?.activeAccount;
          if (selection) next.activeAccount = {
            id: 'index' in selection ? selection.index : selection.id,
            type: sdk.KeyringAccountType[selection.type],
          };
          if (utxo) next.activeNetwork = getUtxoSdkNetwork(utxo) as SdkNetwork;
          else next.activeNetwork = sdkEvmNetwork(getNativeNetwork(networkId, catalogueEvmNetworks(records)));
          return next;
        };
        const publishAccounts = (next: NativeWalletCatalogueSnapshot) => {
          const changed = catalogueSnapshot !== next;
          Object.assign(state, stateFor(catalogue.privateRecords));
          catalogueSnapshot = next;
          connectionNetworkId = next.active.networkId;
          connectionNetwork = Object.freeze({ ...state.activeNetwork });
          if (changed) { retireContextReadLifetime(); retireSentryKeys(); }
        };
        // Transfer only inside an admitted mutation. No await separates the
        // ownership move from publishing the private instance used by lock().
        const switchAccountGroup = async (networkId: string, guard: () => void): Promise<RecoveryAccountGroup | undefined> => {
          const records = catalogue.privateRecords;
          const next = stateFor(records, networkId);
          if (next.activeNetwork.slip44 === state.activeNetwork.slip44) return;
          const source = keyring;
          const target = openKeyring(next);
          try {
            guard();
            await ledgerCleanup;
            guard();
            const preparedTransfer = await source.prepareSessionTransfer(target, guard);
            preparedTransfer.transfer();
            keyring = target;
            state = next;
            if (catalogueAccountGroup(records, networkId)) return;
            const created = await target.createFirstAccount();
            guard();
            const account = checkedAccount(created, 0, networkId, catalogueUtxoNetworks(records.networks));
            return {
              key: String(next.activeNetwork.slip44),
              activeNetwork: next.activeNetwork as RecoveryAccountGroup['activeNetwork'],
              activeAccount: next.activeAccount as RecoveryAccountGroup['activeAccount'],
              accounts: { ...next.accounts, HDAccount: { 0: account } } as RecoveryAccountGroup['accounts'],
            };
          } finally {
            await (keyring === target ? source : target).destroy();
          }
        };
        function captureSignedSubmission(context: EvmSubmissionContext, externalGuard: () => void,
          metadata?: Readonly<Record<string, unknown>>, replacement?: EvmVerifiedReplacementBinding,
          verifyDispatch?: NativeTransferDispatchValidation) {
          const selected = selectedAccount();
          if (selected.index !== context.account.id || selected.type !== context.account.type ||
              selected.address.toLowerCase() !== context.account.address.toLowerCase())
            throw new KeyringRuntimeError('CANCELLED');
          return capturePayerSubmission(context, selected, externalGuard, metadata, replacement, verifyDispatch);
        }
        function capturePayerSubmission(context: EvmSubmissionContext, selected: NativeCatalogueAccount, externalGuard: () => void,
          metadata?: Readonly<Record<string, unknown>>, replacement?: EvmVerifiedReplacementBinding,
          verifyDispatch?: NativeTransferDispatchValidation) {
          const captured = generation;
          const payerType = context.account.type as keyof typeof state.accounts;
          const payer = state.accounts[payerType]?.[context.account.id];
          if (!payer || payer.address.toLowerCase() !== context.account.address.toLowerCase())
            throw new KeyringRuntimeError('CANCELLED');
          const check = () => {
            current(captured); checkGuard(externalGuard);
            const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
            if (selectedAccount() !== selected || state.accounts[payerType]?.[context.account.id] !== payer ||
                payer.address.toLowerCase() !== context.account.address.toLowerCase() ||
                context.network.chainId !== Number(network.chainId) || context.network.url !== network.rpcUrl)
              throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          const requiresReplacement = context.operation === 'cancel' || context.operation === 'speed-up';
          if (requiresReplacement !== (replacement !== undefined) || (replacement && verifyDispatch) ||
              (!requiresReplacement && !verifyDispatch))
            throw new NativeTransferError('EXPIRED');
          const session = { keyring, assertCurrent: check };
          const capturedCatalogue = catalogueSnapshot!;
          const readRetirement = dependencies.readEvmRetirement;
          const contextSignal = (contextReadLifetime ??= new AbortController()).signal;
          return createEvmSignedRecordLifecycle(signedRecords, session, {
            retirementReadForChain: readRetirement === null ? null : createNativeRetirementReadForChain(
              capturedCatalogue.networks, readRetirement, contextSignal, () => {
                check();
                if (catalogueSnapshot !== capturedCatalogue) throw new KeyringRuntimeError('CANCELLED');
              }
            ),
            metadata, replacement,
            automaticNonceEndpoint: requiresReplacement ? undefined : context.network.url,
            preflight: verifyDispatch ? (_record, assertCurrent, snapshot) => verifyDispatch(
              createNativeAutomaticNoncePlanner(signedRecords, session, String(context.network.chainId), context.account.address, context.network.url, snapshot),
              assertCurrent
            ) : undefined,
          });
        }
        const enteredPrivateSubmissions = new WeakSet<object>();
        function prepareOwnedEvmTransaction(input: unknown, selected: NativeCatalogueAccount,
          selectedContext: NativeCatalogueAccount, signal: AbortSignal, check: () => void, metadata: Readonly<Record<string, unknown>> | undefined, funding: EvmFeeFunding, gasPolicy: EvmGasPolicy) {
          check();
          if (selected.type !== 'HDAccount' && selected.type !== 'Imported') throw new KeyringRuntimeError('INVALID_INPUT');
          const signerType = selected.type, ring = keyring;
          const normalized = normalizeDappTransaction(input);
          if (normalized.from !== undefined && normalized.from.toLowerCase() !== selected.address.toLowerCase())
            throw new KeyringRuntimeError('INVALID_INPUT');
          const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
          const fetch = dependencies.connectionFetch ?? walletFetch;
          const rpc = new EvmTransferReadRpc(network, { fetch });
          const sender = new NativeTransferRpc({ registration: network, fetch });
          const planner = createNativeAutomaticNoncePlanner(signedRecords, { keyring: ring, assertCurrent: check },
            network.chainId, selected.address, network.rpcUrl);
          return prepareNativeConnectionTransaction({ ...normalized, from: selected.address }, {
            network, rpc, signal, planner, funding, gasPolicy, assertCurrent: check,
            readApprovalMetadata: (contract, assertCurrent) => readNativeApprovalMetadata({
              network, owner: selected.address, contract, signal, assertCurrent, fetch,
            }),
            sign(transaction, assertSigningCurrent) {
              return run(async (ownerGeneration) => {
                const guard = () => { current(ownerGeneration); check(); checkGuard(assertSigningCurrent); };
                guard();
                const signed = ring.signPreparedEvmTransaction({
                  selectedAccount: { id: selectedContext.index, type: selectedContext.type, expectedAddress: selectedContext.address },
                  account: { id: selected.index, type: signerType, expectedAddress: selected.address },
                  network: { kind: 'ethereum', chainId: network.chainId, slip44: 60, url: network.rpcUrl },
                  transaction,
                }, { assertCurrent: guard });
                guard();
                return Object.freeze({ rawTransaction: signed.rawTransaction, hash: signed.hash });
              });
            },
            submit(transaction, signed, assertSubmittingCurrent, verifyDispatch, onBroadcast) {
              if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
              const guard = () => { check(); checkGuard(assertSubmittingCurrent); };
              guard();
              const context: EvmSubmissionContext = {
                account: { id: selected.index, type: signerType, address: selected.address },
                network: { kind: 'ethereum', chainId: Number(network.chainId), slip44: 60, url: network.rpcUrl },
                operation: 'send',
              };
              const boundary = sdk.captureEvmSubmission(context, guard, () =>
                capturePayerSubmission(context, selectedContext, guard, metadata, undefined, verifyDispatch));
              if (metadata) enteredPrivateSubmissions.add(metadata);
              const work = sdk.submitSignedEvmTransaction<string>(signed.rawTransaction, ({ rawTransaction, admit }) =>
                sender.broadcastDapp(rawTransaction, signed.hash, transaction, signal, admit, guard, onBroadcast),
              boundary, undefined, serializePreparedEvmTransaction(transaction));
              const pending = work.finally(() => { pendingSubmissions.delete(pending); });
              pendingSubmissions.add(pending);
              return pending;
            },
          });
        }
        function snapshotReviewedTransfer(transaction: Parameters<NativeTransferRuntime['sign']>[0],
          intent: NativeAssetTransferIntent | undefined, replacement?: NativeReplacementApproval) {
          const selected = selectedAccount();
          const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
          if (intent?.kind === 'nft-transfer' && replacement) throw new KeyringRuntimeError('INVALID_INPUT');
          const prepared = replacement?.mode === 'cancel'
            ? snapshotCancellationTransfer(transaction, network, selected.address, replacement.feePlan)
            : intent?.kind === 'nft-transfer'
              ? snapshotNftQuoteEnvelope(transaction, network, intent)
              : snapshotUnsignedTransfer(transaction, network);
          assertTransferIntentEnvelope(prepared, intent);
          if (prepared.from.toLowerCase() !== selected.address.toLowerCase()) throw new KeyringRuntimeError('INVALID_INPUT');
          if (replacement) {
            const { original, mode } = replacement;
            if ((mode === 'cancel' && intent) || !/^0x[0-9a-f]{64}$/.test(original.hash) ||
                replacement.binding.originalHash !== original.hash ||
                original.from.toLowerCase() !== selected.address.toLowerCase() ||
                String(original.nonce) !== prepared.nonce || original.type !== prepared.type ||
                original.registrationHash !== network.registrationHash)
              throw new KeyringRuntimeError('INVALID_INPUT');
            if (mode === 'speed-up') assertSpeedUpEnvelope(original, prepared);
          }
          return prepared;
        }
        const signedView = (captured: number, externalGuard: () => void, walletBindingId: string, account = selectedAccount()) => {
          const check = () => { current(captured); checkGuard(externalGuard); };
          const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
          return createNativeSignedRecordView(signedRecords,{keyring,assertCurrent:check},walletBindingId,account,network);
        };
        const hydrate = async (captured: number) => {
          current(captured);
          verifiedIdentity = null;
          const identity = await readIdentity(); current(captured);
          const admitted = await storage.recovery!.readSnapshot(); current(captured);
          assertNativeRecordDomains(admitted.records);
          if (
            !identity.root ||
            (authenticatedPair !== null && authenticatedPair !== identity.pairFingerprint)
          )
            throw new KeyringRuntimeError('CANCELLED');
          const profileId = await keyring.getPrivateRecordProfileId(); current(captured);
            if (profileId !== identity.root.profileId) throw new KeyringRuntimeError('OPERATION_FAILED');
          const next = await catalogue.reconcile(
            {
              walletFingerprint: identity.walletBindingId,
              address: identity.root.address, publicKey: identity.root.publicKey,
            }, () => current(captured));
            current(captured);
          if (
            catalogue.privateRecords.recovery.some(
              (entry) => entry.envelope.profileId !== profileId
            )
          )
            throw new KeyringRuntimeError('OPERATION_FAILED');
          publishAccounts(next);
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          current(captured);
          await signedRecords.validate({keyring,assertCurrent:()=>current(captured)}); current(captured);
          if (admitted.records.some(({ key }) => key === UTXO_SIGNED_RECORD_KEY)) {
            if (!utxoRecords) throw new KeyringRuntimeError('OPERATION_FAILED');
            await utxoRecords.validate({ keyring, assertCurrent: () => current(captured) }); current(captured);
          }
          authenticatedPair = identity.pairFingerprint;
          verifiedIdentity = identity;
        };
        const createStoredWallet = async (
          phrase: string,
          password: string,
          captured: number
        ) => {
          const guard = () => current(captured);
              const before = await storage.readState();
          guard();
          if (
            before.presence !== 'empty' ||
            !storage.recovery?.fingerprintPair ||
            !storage.recovery.prepareCreation ||
            !storage.recovery.plannedSnapshot ||
            !storage.recovery.commitReplacement
          )
            throw new KeyringRuntimeError('NOT_READY');
          const admitted = await storage.recovery.readSnapshot();
          guard();
          assertNativeRecordDomains(admitted.records);
          if (
            admitted.records.some((row) => row.key !== 'utf8Error') ||
            admitted.notes.length ||
            admitted.signedRecords.length
          )
            throw new KeyringRuntimeError('NOT_READY');
          const staged = await stageInitialWallet(
            { key: String(initialEvmNetwork.slip44), network: sdkEvmNetwork(initialEvmNetwork), password, phrase },
            { assertCurrent: guard, loadSdk: dependencies.loadSdk }
          );
          guard();
          const fingerprint = await storage.recovery.fingerprintPair(
            staged.pair
          );
          guard();
          const records = createNativeAccountRecord(staged, fingerprint);
          const first = staged.groups[0]!.accounts.HDAccount[0]!;
          const plan = await storage.recovery.prepareCreation(
            admitted,
            { ...staged.pair, accountRecords: records },
            {
              address: first.address,
              publicKey: first.xpub.toLowerCase(),
              profileId: staged.profileId,
            }
          );
          guard();
          const expected = storage.recovery.plannedSnapshot(plan);
          await storage.recovery.commitReplacement(plan, guard); guard();
              const observed = await storage.recovery.readSnapshot(); guard();
          if (!sameRecoverySnapshot(observed, expected))
            throw new KeyringRuntimeError('CLEANUP_FAILED');
          Object.assign(state, stateFor(records));
          const unlocked = await keyring.unlock(password);
          guard();
          if (!unlocked.canLogin)
            throw new KeyringRuntimeError('CLEANUP_FAILED');
          await hydrate(captured);
          guard();
        };
        const selectedAccount = () => {
          if (!catalogueSnapshot || !keyring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
          const catalogue = catalogueSnapshot;
          const selected = catalogue.accounts.find((a) => a.id === catalogue.active.accountId);
          if (!selected || selected.index !== state.activeAccount.id || selected.type !== state.activeAccount.type ||
              selected.slip44 !== state.activeNetwork.slip44)
            throw new KeyringRuntimeError('CANCELLED');
          const runtime = state.accounts[selected.type][selected.index];
          if (!runtime || runtime.address !== selected.address || (selected.type === 'Imported') !== runtime.isImported)
            throw new KeyringRuntimeError('CANCELLED');
          return selected;
        };
        const authenticate = async (password: string, captured: number, live?: {
          identity: WalletIdentityRead; assertCurrent(): void;
        }, prove = () => keyring.unlock(password)) => {
          const check = () => {
            current(captured);
            if (live) { checkGuard(live.assertCurrent); current(captured); }
          };
          validPassword(password, false);
          if (live) check();
          await storage.authGuard.checkAllowed();
          check();
          const identity = await readIdentity(); check();
          if (live) {
            // Reauthenticate the already verified owner without replacing its account state.
            if (JSON.stringify(identity) !== JSON.stringify(live.identity)) throw new KeyringRuntimeError('CANCELLED');
          } else {
            const records = recoveryVerificationRecords(
              await storage.keyringStorage.get(WALLET_CATALOGUE_KEY),
              identity.walletBindingId
            );
            check();
            Object.assign(state, stateFor(records));
          }
          const result = await prove();
          if (!result || typeof result.canLogin !== 'boolean') throw new Error('UNAVAILABLE');
          if (!result.canLogin) {
            // A definitive rejected credential still counts when lock/background
            // revokes the session while its unabortable KDF is finishing.
            if (storage.recovery?.recordFailureForPair) await storage.recovery.recordFailureForPair(identity.pairFingerprint);
            else await storage.authGuard.recordFailure();
            check();
            return false;
          }
          check();
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          check();
          await storage.authGuard.recordSuccess();
          check();
          if (!live) { authenticatedPair = identity.pairFingerprint; verifiedIdentity = null; }
          return true;
        };
        const dataBinding = async (captured: number, guard: () => void = () => undefined): Promise<string> => {
          current(captured); checkGuard(guard);
          const identity = await readIdentity(); current(captured); checkGuard(guard);
          if (!keyring.isUnlocked() || !verifiedIdentity || JSON.stringify(identity) !== JSON.stringify(verifiedIdentity))
            throw new KeyringRuntimeError('CANCELLED');
          return verifiedIdentity.walletBindingId;
        };
        const connectionOwner = (walletBindingId: string) => () => {
          if (closed || requiresReopen() || connectionWalletBinding !== walletBindingId)
            throw new KeyringRuntimeError('CANCELLED');
        };
        const getConnectionRepository = async (captured: number): Promise<NativeConnectionRepository> => {
          const walletBindingId = await dataBinding(captured);
          const assertOwner = connectionOwner(walletBindingId);
          assertOwner();
          if (connectionRepositoryBinding !== null && connectionRepositoryBinding !== walletBindingId)
            throw new KeyringRuntimeError('CANCELLED');
          if (connectionRepository === null) {
            connectionRepositoryBinding = walletBindingId;
            connectionRepository = openNativeConnectionRepository({
              storage: storage.keyringStorage, walletBindingId, assertOwner,
            });
          }
          const repository = await connectionRepository;
          current(captured);
          repository.assertHealthy();
          return repository;
        };
        const assertPrivateDomainAvailable = () => {
          current(generation);
          if (active || reserved || pendingSubmissions.size) throw new KeyringRuntimeError('BUSY');
        };
        const finalizePrivateDomain = async () => {
          if (privateDomainStorageFault === 'unreported') {
            privateDomainStorageFault = 'reopen';
            try { await lock(); } catch { /* The owner remains quarantined. */ }
          }
        };
        const runPrivateDomain = async <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          assertPrivateDomainAvailable();
          const captured = generation;
          let resolve!: (result: Promise<T>) => void, reject!: (error: unknown) => void;
          const task = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; }).finally(async () => {
            // Let the service classify an ambiguous receipt before revoking its session.
            await finalizePrivateDomain();
            if (active === task) active = null;
          });
          // Install admission before callbacks, while allowing the shared codec
          // to snapshot caller bytes in this same turn.
          active = task;
          try { resolve(operation(captured)); } catch (error) { reject(error); }
          return task;
        };
        const privateDomainWalletSession = (captured: number): IPrivateVaultSession => {
          const ring = keyring, identity = verifiedIdentity;
          const assertUnlocked = ring.captureUnlockedSessionGuard();
          const assertCurrent = () => {
            current(generation);
            checkGuard(assertUnlocked);
            if (!identity?.root || verifiedIdentity !== identity || keyring !== ring || !ring.isUnlocked() ||
                authenticatedPair !== identity.pairFingerprint ||
                verifiedIdentity?.walletBindingId !== identity.walletBindingId ||
                verifiedIdentity.root?.profileId !== identity.root.profileId)
              throw new KeyringRuntimeError('CANCELLED');
          };
          assertCurrent();
          return Object.freeze({ generation: captured, keyring: ring, assertCurrent });
        };
        const privateDomainSession = (captured: number, assertOwner: () => void): IPrivateVaultSession => {
          const wallet = privateDomainWalletSession(captured), revision = catalogueSnapshot?.revision;
          const assertCurrent = () => {
            current(captured); wallet.assertCurrent(); checkGuard(assertOwner); current(captured); wallet.assertCurrent();
            if (catalogueSnapshot?.revision !== revision || revision === undefined)
              throw new KeyringRuntimeError('CANCELLED');
          };
          assertCurrent();
          return Object.freeze({ ...wallet, assertCurrent });
        };
        const authenticateVerifiedOwner = async (password: string, request: IPrivateVaultSession) => {
          request.assertCurrent();
          const owner = keyring, identity = verifiedIdentity;
          if (!identity || request.keyring !== owner) throw new KeyringRuntimeError('CANCELLED');
          try {
            const authenticated = await authenticate(password, request.generation, {
              identity, assertCurrent: request.assertCurrent,
            });
            request.assertCurrent();
            return authenticated;
          } catch (error) {
            if (request.generation !== generation && owner.isUnlocked()) await owner.lockWallet();
            if (error instanceof WalletStorageError && error.code === 'STORAGE_REOPEN_REQUIRED') requirePrivateDomainReopen();
            throw error;
          }
        };
        const getSentryKeyNetwork = (): SentryNetwork | undefined => {
          if (!keyring.isUnlocked() || !catalogueSnapshot) return undefined;
          const registration = findUtxoNetwork(
            catalogueSnapshot.active.networkId, catalogueSnapshot.utxoNetworks
          );
          return (Object.keys(SENTRY_NETWORKS) as SentryNetwork[]).find((name) =>
            registration?.chainId === SENTRY_NETWORKS[name].chainId &&
            registration.genesisHash === SENTRY_NETWORKS[name].genesisHash
          );
        };
        const openSentryKeyManagement: NonNullable<
          KeyringRuntime['openSentryKeyManagement']
        > = (lifetime, assertOwner) =>
          runPrivateDomain(async (captured) => {
            const derivePublicKey = dependencies.deriveSentryPublicKey;
            if (
              !storage.sentryKeys ||
              typeof derivePublicKey !== 'function' ||
              typeof assertOwner !== 'function' ||
              typeof lifetime?.aborted !== 'boolean' ||
              typeof lifetime.addEventListener !== 'function' ||
              typeof lifetime.removeEventListener !== 'function'
            )
              throw new KeyringRuntimeError('NOT_READY');
            const session = privateDomainSession(captured, () => {
              if (lifetime.aborted) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertOwner);
            });
            const identity = verifiedIdentity!;
            const network = getSentryKeyNetwork();
            if (!network) throw new KeyringRuntimeError('NOT_READY');
            const root = sentryRootPublicIdentity(catalogue.privateRecords, network);
            const { createNativeSentryKeyManagement, NativeSentryKeysError } =
              await import('./sentryKeyManagement.ts');
            session.assertCurrent();
            const crypto = globalThis.crypto;
            const vaultId = await deriveSentryVaultId(
              root,
              async (bytes) =>
                new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
            );
            session.assertCurrent();
            const owned = storage.sentryKeys.bind(
              {
                network,
                vaultId,
                profileId: identity.root!.profileId,
                walletBindingId: identity.walletBindingId,
                pairFingerprint: identity.pairFingerprint,
              },
              session.assertCurrent
            );
            retireSentryKeys();
            const settingsKey = sentrySettingsStorageKey(vaultId, network);
            sentryKeys = createNativeSentryKeyManagement({
              assertCurrent: session.assertCurrent,
              async readSettings() {
                session.assertCurrent();
                const saved = await storage.keyringStorage.get(settingsKey);
                session.assertCurrent();
                return saved;
              },
              async writeSettings(settings, assertCurrent) {
                const check = () => { session.assertCurrent(); checkGuard(assertCurrent); session.assertCurrent(); };
                check();
                const expected = await storage.keyringStorage.get(settingsKey);
                check();
                const saved = await storage.keyringStorage.compareAndSetMany([
                  { key: settingsKey, expected, value: settings },
                ], check);
                check();
                if (!saved) throw new KeyringRuntimeError('CANCELLED');
              },
              async authenticate(password, assertCurrent) {
                const authenticated = await authenticateVerifiedOwner(password, {
                  ...session,
                  assertCurrent,
                });
                assertCurrent();
                if (!authenticated) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              },
              derivePublicKey,
              lifetime,
              network,
              async readSeed(password, assertCurrent) {
                assertCurrent();
                const phrase = await keyring.getSeed(password);
                assertCurrent();
                if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase))
                  throw new KeyringRuntimeError('OPERATION_FAILED');
                return phrase;
              },
              run: (operation) =>
                runPrivateDomain(async () => {
                  try {
                    return await operation();
                  } catch (error) {
                    if (
                      error instanceof NativeSentryKeysError ||
                      error instanceof KeyringRuntimeError
                    )
                      throw error;
                    if (error instanceof WalletStorageError) {
                      if (error.code === 'STORAGE_REOPEN_REQUIRED')
                        requirePrivateDomainReopen();
                      if (error.code === 'AUTH_THROTTLED')
                        throw new KeyringRuntimeError(error.code);
                      if (error.code === 'STORAGE_CHANGED')
                        throw new KeyringRuntimeError('CANCELLED');
                    }
                    throw new KeyringRuntimeError('OPERATION_FAILED');
                  }
                }),
              vaultHost: { ...owned, crypto: () => crypto },
              vaultId,
            });
            return sentryKeys;
          });
        const openNotes = <T>(assertOwner: () => void, bind: (notes: NoteRuntime, session: IPrivateVaultSession) => T | Promise<T>) => runPrivateDomain(async (captured): Promise<T> => {
          const session = privateDomainSession(captured, assertOwner);
          if (!noteBackups) {
            const notes = storage.notes;
            if (!notes || !storage.recovery) throw new KeyringRuntimeError('NOT_READY');
            const { createNativeNoteBackupRuntime } = await import('./noteBackupRuntime.ts');
            session.assertCurrent();
            noteBackups = createNativeNoteBackupRuntime({
              notes,
              assertAvailable: assertPrivateDomainAvailable,
              run: runPrivateDomain,
              requireReopen: requirePrivateDomainReopen,
              async binding() {
                const walletBindingId = await dataBinding(generation);
                const profileId = verifiedIdentity?.root?.profileId;
                if (!profileId) throw new KeyringRuntimeError('CANCELLED');
                return { walletBindingId, profileId };
              },
              async authenticate(password, request, reveal) {
                request.assertCurrent();
                if (!isNativePasswordInput(password)) throw new Error('BACKUP_AUTHENTICATION_FAILED');
                let authenticated: boolean;
                try {
                  authenticated = await authenticateVerifiedOwner(password, request);
                } catch (error) {
                  if (error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED')
                    throw new Error('BACKUP_AUTHENTICATION_FAILED');
                  throw error;
                }
                request.assertCurrent();
                if (!authenticated) throw new Error('BACKUP_AUTHENTICATION_FAILED');
                return reveal();
              },
            });
          }
          return bind(noteBackups, session);
        });
        const openNoteBackup: NonNullable<KeyringRuntime['openNoteBackup']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => notes.bind(session));
        const openNoteCapacity: NonNullable<KeyringRuntime['openNoteCapacity']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => notes.bindCapacity(session));
        const readNoteInventory: NonNullable<KeyringRuntime['readNoteInventory']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => {
            const network = catalogueSnapshot?.networks.find(item => item.id === catalogueSnapshot!.active.networkId);
            const openPool = dependencies.openPrivacyPool;
            const selected = selectedAccount();
            const account = state.accounts[selected.type][selected.index];
            return notes.readInventory(session, network?.chainId === '1' && openPool ? async (id, poolId, guard) => {
              const lifetime = new AbortController();
              const pool = await openOwnedPrivatePool(poolId,
                (selected, signal) => openPool(network, selected, signal, guard), lifetime.signal, guard);
              try { await pool.refresh(); guard(); return await notes.readNoteStatus(session, id, pool.readNote); }
              finally { lifetime.abort(); await pool.dispose(); }
            } : null, network?.chainId === '1' && openPool && dependencies.openPrivacyWithdrawal && supportsPrivateWithdrawal(selected.type, account)
              ? (id, poolId, restored, signal, guard) => openPrivateWithdrawal(id, poolId, restored, signal, guard)
              : null);
          });
        const openPrivateWithdrawal = async (
          noteId: string,
          poolId: PrivacyPoolId,
          restored: boolean,
          signal: AbortSignal,
          assertOwner: () => void
        ): Promise<NativePrivateWithdrawal> => {
          const model = await openNotes(assertOwner, async (notes, session) => {
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            const captured = generation;
            const selected = selectedAccount();
            const snapshot = catalogueSnapshot;
            const network = getNativeNetwork(
              snapshot!.active.networkId,
              snapshot!.networks
            );
            const openPool = dependencies.openPrivacyPool;
            const openServices = dependencies.openPrivacyWithdrawal;
            const account = state.accounts[selected.type][selected.index];
            if (network.chainId !== '1' || !openPool || !openServices || !supportsPrivateWithdrawal(selected.type, account))
              throw new Error('privacy_withdrawal_unsupported_account');
            const canSign =
              (selected.type === 'HDAccount' || selected.type === 'Imported') &&
              !!account?.xprv;
            const lifetime = new AbortController();
            const abort = () => lifetime.abort();
            const check = () => {
              current(captured);
              checkGuard(assertOwner);
              session.assertCurrent();
              if (
                signal.aborted ||
                lifetime.signal.aborted ||
                catalogueSnapshot !== snapshot ||
                selectedAccount() !== selected ||
                state.accounts[selected.type][selected.index] !== account
              )
                throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            signal.addEventListener('abort', abort, { once: true });
            let pool: Awaited<ReturnType<typeof openOwnedPrivatePool>> | undefined;
            try {
              const services = await openServices(lifetime.signal, check);
              check();
              pool = await openOwnedPrivatePool(
                poolId,
                (id, owner) => openPool(network, id, owner, check),
                lifetime.signal,
                check
              );
              check();
              const ownedPool = pool;
              const acknowledgementSession = privateDomainWalletSession(captured);
              const vault = notes.openWithdrawal(
                { ...session, assertCurrent: check },
                acknowledgementSession,
                ownedPool.readNote
              );
              const rpc = new EvmTransferReadRpc(network, {
                fetch: dependencies.connectionFetch ?? walletFetch,
              });
              const planner = createNativeAutomaticNoncePlanner(
                signedRecords,
                { keyring, assertCurrent: check },
                network.chainId,
                selected.address,
                network.rpcUrl
              );
              type Prepared = Awaited<ReturnType<typeof prepareOwnedEvmTransaction>>;
              const prepared = new WeakMap<
                IPrivacyDepositSession['context'],
                {
                  quote: Prepared;
                  metadata: Readonly<Record<string, unknown>>;
                }
              >();
              const withdrawal = new NativePrivateWithdrawal(
                {
                  assertCurrent: check,
                  canSign,
                  restored,
                  noteId,
                  poolId,
                  createWithdrawals(onProgress) {
                    return createPrivacyWithdrawalsController(
                      {
                        captureSession(requireSigner = false) {
                          check();
                          if (!supportsPrivateWithdrawal(selected.type, account))
                            throw new Error('privacy_withdrawal_unsupported_account');
                          if (requireSigner && !canSign)
                            throw new Error('privacy_withdrawal_unsupported_account');
                          return {
                            assertCurrent: check,
                            context: {
                              account: {
                                id: selected.index,
                                type: sdk.KeyringAccountType[selected.type],
                                address: selected.address,
                              },
                              chainId: 1,
                              rpcUrl: network.rpcUrl,
                              slip44: 60,
                              sessionGeneration: captured,
                            },
                          };
                        },
                        onProgress,
                        prove: services.prove,
                        relayers: services.relayers,
                        async getSnapshot(id) {
                          check();
                          if (id !== poolId) throw new Error('privacy_note_invalid');
                          return ownedPool.readSnapshot(id);
                        },
                        async withNote(id, _owner, use) {
                          check();
                          if (id !== noteId) throw new Error('privacy_note_missing');
                          await ownedPool.refresh();
                          check();
                          return vault.withNote(id, use);
                        },
                        getWithdrawalAttempt(id) {
                          check();
                          if (id !== noteId) throw new Error('privacy_note_missing');
                          return vault.getAttempt(id);
                        },
                        quoteDirectFees: () =>
                          rpc.withdrawalFees(
                            selected.address,
                            planner,
                            lifetime.signal,
                            check
                          ),
                        quoteRelayerGasPrice: () =>
                          rpc.withdrawalGasPrice(lifetime.signal, check),
                        async beforeSubmission(attempt) {
                          check();
                          if (attempt.noteId !== noteId || attempt.poolId !== poolId)
                            throw new Error('privacy_note_invalid');
                          if (attempt.mode === 'direct') {
                            if (!canSign)
                              throw new Error('privacy_withdrawal_unsupported_account');
                            const canonical = capturePrivateWithdrawalAttempt(attempt);
                            const metadata = Object.freeze({
                              privateWithdrawal: canonical,
                            });
                            const quote = await prepareOwnedEvmTransaction(
                              attempt.transaction,
                              selected,
                              selected,
                              lifetime.signal,
                              check,
                              metadata,
                              NATIVE_EVM_FEE_FUNDING,
                              { kind: 'fixed', gasLimit: PRIVACY_WITHDRAWAL_GAS }
                            );
                            check();
                            if (
                              privateWithdrawalUnsignedBytes(canonical) !==
                              serializePreparedEvmTransaction(quote.transaction)
                            )
                              throw new Error('privacy_withdrawal_context_changed');
                            prepared.set(attempt.context, { quote, metadata });
                          }
                          let fence!: () => void;
                          await vault.reserve(attempt, (guard) => {
                            fence = guard;
                          });
                          return () => {
                            check();
                            fence();
                          };
                        },
                        async sendTransaction(
                          _transaction,
                          owner,
                          onBroadcast,
                          assertBeforeSign
                        ) {
                          const saved = prepared.get(owner.context);
                          if (!saved)
                            throw new NativePrivateSubmissionError({
                              transactionNotBroadcast: true,
                            });
                          try {
                            assertBeforeSign();
                            const hash = await saved.quote.submit(
                              assertBeforeSign,
                              () => undefined
                            );
                            await onBroadcast({ hash });
                            return { hash };
                          } catch (error) {
                            const failure = sdk.evmSubmissionFailure(error);
                            throw new NativePrivateSubmissionError({
                              transactionNotBroadcast:
                                !enteredPrivateSubmissions.has(saved.metadata) ||
                                failure?.transactionNotBroadcast === true,
                              ...(failure?.signedTransactionHash
                                ? {
                                    signedTransactionHash:
                                      failure.signedTransactionHash,
                                  }
                                : {}),
                            });
                          }
                        },
                        classifySubmissionFailure: (error) =>
                          error instanceof NativePrivateSubmissionError
                            ? error.failure
                            : { transactionNotBroadcast: false },
                        async recordSubmission(attempt, acknowledgement) {
                          try {
                            await vault.recordSubmission(attempt, acknowledgement);
                          } finally {
                            await finalizePrivateDomain();
                          }
                        },
                        async recordNotBroadcast(attempt) {
                          try {
                            await vault.recordNotBroadcast(attempt);
                          } finally {
                            await finalizePrivateDomain();
                          }
                        },
                        recordJobStatus: (id, attemptHash, acknowledgement) => {
                          check();
                          if (id !== noteId || !acknowledgement.jobId)
                            throw new Error('privacy_withdrawal_ack_invalid');
                          return vault.recordJobStatus(id, attemptHash, {
                            jobId: acknowledgement.jobId,
                            transactionHash: acknowledgement.transactionHash,
                          });
                        },
                      },
                      { fetcher: services.fetcher }
                    );
                  },
                  async readNoteStatus() {
                    await ownedPool.refresh();
                    check();
                    return vault.readStatus(noteId);
                  },
                  async reviewRestored(password) {
                    await ownedPool.refresh();
                    check();
                    return vault.reviewRestored(noteId, password);
                  },
                  async close() {
                    lifetime.abort();
                    signal.removeEventListener('abort', abort);
                    try {
                      await ownedPool.dispose();
                    } finally {
                      await finalizePrivateDomain();
                    }
                  },
                },
                signal
              );
              return withdrawal;
            } catch (error) {
              lifetime.abort();
              signal.removeEventListener('abort', abort);
              try {
                await pool?.dispose();
              } finally {
                await finalizePrivateDomain();
              }
              throw error;
            }
          });
          try {
            await model.refresh();
            checkGuard(assertOwner);
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            return model;
          } catch (error) {
            await model.dispose();
            throw error;
          }
        };
        const openPrivateDeposit: NonNullable<KeyringRuntime['openPrivateDeposit']> = (
          signal,
          assertOwner
        ) =>
          openNotes(assertOwner, (notes, session) => {
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            const captured = generation,
              selected = selectedAccount(),
              snapshot = catalogueSnapshot;
            const network = getNativeNetwork(snapshot!.active.networkId, snapshot!.networks);
            const account = state.accounts[selected.type][selected.index];
            const openPool = dependencies.openPrivacyPool;
            if (
              !openPool ||
              network.chainId !== '1' ||
              (selected.type !== 'HDAccount' && selected.type !== 'Imported') ||
              !account?.xprv
            )
              throw new Error('privacy_deposit_unsupported_account');
            const lifetime = new AbortController();
            const abort = () => lifetime.abort();
            const check = () => {
              current(captured);
              checkGuard(assertOwner);
              session.assertCurrent();
              if (
                signal.aborted ||
                lifetime.signal.aborted ||
                catalogueSnapshot !== snapshot ||
                selectedAccount() !== selected ||
                state.accounts[selected.type][selected.index] !== account
              )
                throw new KeyringRuntimeError('CANCELLED');
            };
            const acknowledgementSession = privateDomainWalletSession(captured);
            let pool: Awaited<ReturnType<typeof openOwnedPrivatePool>> | undefined;
            let vault: ReturnType<NoteRuntime['openDeposit']> | undefined;
            const ensurePool = async (poolId: PrivacyPoolId) => {
              check();
              if (pool && pool.poolId !== poolId) {
                await pool.dispose();
                pool = undefined;
                vault = undefined;
              }
              pool ??= await openOwnedPrivatePool(
                poolId,
                (id, owner) => openPool(network, id, owner, check),
                lifetime.signal,
                check
              );
              check();
              vault ??= notes.openDeposit(
                { ...session, assertCurrent: check },
                acknowledgementSession,
                pool.readNote
              );
              return vault;
            };
            type Prepared = Awaited<ReturnType<typeof prepareOwnedEvmTransaction>>;
            const prepared = new WeakMap<
              IPrivacyDepositSession['context'],
              { quote: Prepared; metadata: Record<string, unknown> }
            >();
            const transactions = createPrivacyTransactionsController({
              captureContext: () => ({
                assertCurrent: check,
                context: {
                  account: {
                    id: selected.index,
                    type: sdk.KeyringAccountType[selected.type],
                    address: selected.address,
                  },
                  chainId: 1,
                  rpcUrl: network.rpcUrl,
                  slip44: 60,
                  sessionGeneration: captured,
                },
              }),
              prepareNote: async (poolId, noteId) =>
                (await ensurePool(poolId)).prepareNote(poolId, noteId),
              withCommitment: (noteId, _owner, use) => {
                check();
                if (!vault) throw new Error('privacy_vault_unavailable');
                return vault.withCommitment(noteId, use);
              },
              prepareFees: async (transaction, owner) => {
                check();
                const metadata: Record<string, unknown> = {};
                const quote = await prepareOwnedEvmTransaction(
                  transaction,
                  selected,
                  selected,
                  lifetime.signal,
                  check,
                  metadata,
                  NATIVE_EVM_FEE_FUNDING,
                  { kind: 'estimate' }
                );
                check();
                prepared.set(owner.context, { quote, metadata });
                const tx = quote.transaction;
                return {
                  gasLimit: tx.gasLimit,
                  nonce: tx.nonce!,
                  ...(tx.type === 0
                    ? { gasPrice: tx.gasPrice! }
                    : { maxFeePerGas: tx.maxFeePerGas!, maxPriorityFeePerGas: tx.maxPriorityFeePerGas! }),
                };
              },
              beforeSubmission: async (attempt) => {
                check();
                const saved = prepared.get(attempt.context);
                if (!saved || !vault || !pool) throw new Error('privacy_deposit_context_changed');
                const canonical = capturePrivateDepositAttempt(attempt);
                if (
                  privateDepositUnsignedBytes(canonical) !==
                  serializePreparedEvmTransaction(saved.quote.transaction)
                )
                  throw new Error('privacy_deposit_context_changed');
                saved.metadata.privateDeposit = canonical;
                Object.freeze(saved.metadata);
                let fence!: () => void;
                await vault.reserve(attempt, (guard) => {
                  fence = guard;
                });
                return () => {
                  check();
                  fence();
                };
              },
              sendTransaction: async (_transaction, owner, onBroadcast, assertBeforeSign) => {
                const saved = prepared.get(owner.context);
                if (!saved) throw new Error('privacy_deposit_context_changed');
                try {
                  assertBeforeSign();
                  const hash = await saved.quote.submit(assertBeforeSign, () => undefined);
                  await onBroadcast({ hash });
                  return { hash };
                } catch (error) {
                  const failure = sdk.evmSubmissionFailure(error);
                  throw new NativePrivateSubmissionError({
                    transactionNotBroadcast:
                      !enteredPrivateSubmissions.has(saved.metadata) ||
                      failure?.transactionNotBroadcast === true,
                    ...(failure?.signedTransactionHash
                      ? { signedTransactionHash: failure.signedTransactionHash }
                      : {}),
                  });
                }
              },
              classifySubmissionFailure: (error) =>
                error instanceof NativePrivateSubmissionError
                  ? error.failure
                  : { transactionNotBroadcast: false },
              recordBroadcast: async (attempt, hash) => {
                if (!vault) throw new Error('privacy_vault_unavailable');
                try {
                  await vault.recordBroadcast(attempt, hash);
                } finally {
                  await finalizePrivateDomain();
                }
              },
              recordNotBroadcast: async (attempt) => {
                if (!vault) throw new Error('privacy_vault_unavailable');
                try {
                  await vault.recordNotBroadcast(attempt);
                } finally {
                  await finalizePrivateDomain();
                }
              },
            });
            const model = new NativePrivateDeposit(
              {
                assertCurrent: check,
                transactions,
                async readStatus(noteId) {
                  check();
                  if (!pool || !vault) throw new Error('privacy_vault_unavailable');
                  await pool.refresh();
                  check();
                  return vault.readStatus(noteId);
                },
                async close() {
                  lifetime.abort();
                  signal.removeEventListener('abort', abort);
                  await pool?.dispose();
                },
              },
              signal
            );
            signal.addEventListener('abort', abort, { once: true });
            return model;
          });
        const openNoteImport: NonNullable<KeyringRuntime['openNoteImport']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => {
            const openPool = dependencies.openPrivacyPool;
            if (!openPool || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            const network = catalogueSnapshot.networks.find((entry) => entry.id === catalogueSnapshot!.active.networkId);
            if (!network) throw new Error('privacy_wrong_chain');
            const signal = (contextReadLifetime ??= new AbortController()).signal;
            return createNativeNoteImport({
              signal,
              assertCurrent: session.assertCurrent,
              openPool: (poolId, owner) => openPool(network, poolId, owner, session.assertCurrent),
              importNote: (note, readNote, assertCurrent) => notes.importNote(session, note, readNote, assertCurrent),
            });
          });
        const authorizeWalletRemoval: NonNullable<KeyringRuntime['authorizeWalletRemoval']> = (password, assertOwner, beforeSnapshot) => runPrivateDomain(async (captured) => {
          if (typeof beforeSnapshot !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
          const recovery = storage.recovery;
          if (!recovery || !storage.removal) throw new KeyringRuntimeError('NOT_READY');
          const session = privateDomainSession(captured, assertOwner);
          const identity = verifiedIdentity;
          if (!(await authenticateVerifiedOwner(password, session))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
          session.assertCurrent();
          await beforeSnapshot(session.assertCurrent);
          session.assertCurrent();
          const snapshot = await recovery.readSnapshot();
          session.assertCurrent();
          if (snapshot.state.presence !== 'existing' || !identity || JSON.stringify(snapshot.identity) !== JSON.stringify(identity))
            throw new KeyringRuntimeError('CANCELLED');
          return Object.freeze({ snapshot, assertCurrent() {
            try { session.assertCurrent(); }
            catch (error) {
              if (captured !== generation || closed) throw new KeyringRuntimeError('CANCELLED');
              throw error;
            }
          } });
        });
        type UtxoNetworkApproval = import('./accounts.ts').NativeUtxoNetworkApproval;
        const registrationApprovals = new WeakMap<UtxoNetworkApproval, Readonly<{
          network: UtxoNetwork; generation: number; snapshot: NativeWalletCatalogueSnapshot; signal: AbortSignal;
        }>>();
        const utxoSettingsContext = (expectedRevision: number, signal: AbortSignal, assertOwner: () => void) => {
          const captured = generation, snapshot = catalogueSnapshot;
          const fetch = dependencies.utxoFetch;
          if (!fetch || !dependencies.readUtxoAccount || !dependencies.readUtxoBalance || !utxoRecords ||
              !snapshot || snapshot.revision !== expectedRevision || !keyring.isUnlocked())
            throw new KeyringRuntimeError('NOT_READY');
          if (pendingRegistration || active || reserved) throw new KeyringRuntimeError('BUSY');
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (signal.aborted || snapshot !== catalogueSnapshot ||
                !keyring.isUnlocked() || active || reserved) throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          return { captured, snapshot, fetch, check, records: utxoRecords };
        };
        const verifyUtxoSettings = async (
          draft: import('./accounts.ts').NativeUtxoNetworkDraft, previous: UtxoNetwork | undefined,
          owner: ReturnType<typeof utxoSettingsContext>, signal: AbortSignal
        ): Promise<UtxoNetwork> => {
          const controller = new AbortController();
          const abort = () => controller.abort();
          owner.check();
          pendingRegistration = controller;
          signal.addEventListener('abort', abort, { once: true });
          try {
            return await verifyUtxoRegistration(draft, previous, { fetch: exactUtxoResponseFetch(owner.fetch), timeoutMs: 10_000 }, controller.signal, owner.check);
          } finally {
            if (pendingRegistration === controller) pendingRegistration = null;
            signal.removeEventListener('abort', abort);
            controller.abort();
          }
        };
        const prepareUtxo: NonNullable<NativeNetworkRuntime['prepareUtxo']> = async (
          input, expectedRevision, signal, assertOwner
        ) => {
          const owner = utxoSettingsContext(expectedRevision, signal, assertOwner);
          const draft = decodeStorageValue(encodeStorageValue(input)) as typeof input;
          if (!draft || Object.keys(draft).sort().join(',') !== 'endpoint,explorer,name' ||
              typeof draft.endpoint !== 'string' || typeof draft.explorer !== 'string' || typeof draft.name !== 'string')
            throw new KeyringRuntimeError('INVALID_INPUT');
          const network = await verifyUtxoSettings(draft, undefined, owner, signal);
          owner.check();
          if (!supportsUtxoSoftwareCustody(network) ||
              owner.snapshot.utxoNetworks.some(({ chainId, slip44 }) => chainId === network.chainId || slip44 === network.slip44))
            throw new KeyringRuntimeError('INVALID_INPUT');
          const proof = Object.freeze({ kind: 'add-utxo-network' } as const);
          registrationApprovals.set(proof, { network, generation: owner.captured, snapshot: owner.snapshot, signal });
          return proof;
        };
        const withUtxoChangeApproval: NonNullable<NativeNetworkRuntime['withUtxoChangeApproval']> = async (
          request, expectedRevision, signal, assertOwner, commit
        ) => {
          const owner = utxoSettingsContext(expectedRevision, signal, assertOwner);
          const { id, kind } = request;
          const previous = findUtxoNetwork(id, owner.snapshot.utxoNetworks);
          if (!previous || !isCustomUtxoNetworkId(previous.id))
            throw new KeyringRuntimeError('INVALID_INPUT');
          const approve = async (network: UtxoNetwork) => {
            owner.check();
            const proof = Object.freeze({ kind });
            registrationApprovals.set(proof, { network, generation: owner.captured, snapshot: owner.snapshot, signal });
            try { await commit(proof); }
            finally { registrationApprovals.delete(proof); }
          };
          if (kind === 'remove-utxo-network') {
            if (owner.snapshot.active.networkId === previous.id)
              throw new KeyringRuntimeError('INVALID_INPUT');
            if (catalogueAccountGroup(catalogue.privateRecords, previous.id))
              throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            return owner.records.removeRegistration(
              { keyring, assertCurrent: owner.check }, previous, () => approve(previous)
            );
          }
          const draft = decodeStorageValue(encodeStorageValue(request.draft)) as typeof request.draft;
          if (!draft || Object.keys(draft).sort().join(',') !== 'endpoint,name' ||
              typeof draft.endpoint !== 'string' || typeof draft.name !== 'string')
            throw new KeyringRuntimeError('INVALID_INPUT');
          const candidate = projectUtxoRegistration({
            ...utxoRegistrationData(previous), name: draft.name, endpoint: canonicalUtxoEndpoint(draft.endpoint),
          });
          if (candidate.endpoint === previous.endpoint) return approve(candidate);
          const network = await verifyUtxoSettings({ endpoint: candidate.endpoint, name: candidate.name, explorer: previous.explorer }, previous, owner, signal);
          const { utxoSubmissionUrl } = await import('../../../../source/wallet/utxoSignedBinding.ts');
          owner.check();
          // Enter the same journal admission as extension before retiring the
          // current owner. An expected pending transfer leaves Settings usable.
          return owner.records.replaceEndpoint(
            { keyring, assertCurrent: owner.check }, previous, utxoSubmissionUrl(previous.endpoint), () => approve(network)
          );
        };
        const reserveContext = (input:
            | NativeAccountRequest | import('./accounts.ts').NativeNetworkRequest, expectedRevision: number, networkSelection = false) => {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const request = decodeStorageValue(encodeStorageValue(input)) as NativeAccountRequest | import('./accounts.ts').NativeNetworkRequest;
            if (!request || typeof request !== 'object' || Array.isArray(request) || (!networkSelection && ['select-network', 'save-network', 'add-utxo-network', 'edit-utxo-network', 'remove-utxo-network', 'remove-network'].includes(request.kind))) throw new KeyringRuntimeError('INVALID_INPUT');
            const accountTarget = 'id' in request && !['select-network', 'remove-network'].includes(request.kind);
            const requiresUtxoApproval = request.kind === 'add-utxo-network' ||
              request.kind === 'edit-utxo-network' || request.kind === 'remove-utxo-network';
            const fields = request.kind === 'import-ledger' ? ['kind', 'label'] : request.kind === 'create' || request.kind === 'create-smart' ? ['kind', 'label', 'password'] : request.kind === 'rename' ? ['kind', 'id', 'label']
              : request.kind === 'remove' ? ['kind', 'id', 'password'] : request.kind === 'save-network' ? ['kind', 'registration'] : requiresUtxoApproval ? ['kind'] : request.kind === 'select' || request.kind === 'select-network' || request.kind === 'remove-network' ? ['kind', 'id'] : [];
            if (!fields.length || Object.keys(request).sort().join(',') !== fields.sort().join(',') ||
                (accountTarget && (typeof request.id !== 'string' || (() => { try { parseNativeAccountId(request.id); return false; } catch { return true; } })())) ||
                ('label' in request && (typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label || request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label))))
              throw new KeyringRuntimeError('INVALID_INPUT');
            if ('password' in request) validPassword(request.password, false);
            if (request.kind === 'create-smart' && (!dependencies.prepareSmartAccount || findUtxoNetwork(catalogueSnapshot.active.networkId, catalogueSnapshot.utxoNetworks)))
              throw new KeyringRuntimeError('NOT_READY');
            // Expected eligibility failures leave the current authority/reviews intact.
            if (request.kind === 'remove-network' ||
                (request.kind === 'select-network' && !findUtxoNetwork(request.id, catalogueSnapshot.utxoNetworks)))
              getNativeNetwork(request.id, catalogueSnapshot.networks);
            if (request.kind === 'save-network') snapshotNativeNetwork(request.registration);
            const approval = requiresUtxoApproval ? registrationApprovals.get(input as UtxoNetworkApproval) : undefined;
            if (requiresUtxoApproval) {
              registrationApprovals.delete(input as UtxoNetworkApproval);
              if (!approval || approval.signal.aborted || approval.generation !== generation || approval.snapshot !== catalogueSnapshot)
                throw new KeyringRuntimeError('CANCELLED');
            }
            if (accountTarget) {
              const target = catalogueSnapshot.accounts.find((account) => account.id === request.id);
              if (!target) throw new KeyringRuntimeError('INVALID_INPUT');
              if (request.kind === 'remove' && ((target.type === 'HDAccount' && target.index === 0) || target.id === catalogueSnapshot.active.accountId || catalogueSnapshot.accounts.length <= 1))
                throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            }
            const ledger = request.kind === 'import-ledger' ? preparedLedger : undefined;
            if (request.kind === 'import-ledger' && (!ledger || ledger.generation !== generation || ledger.snapshot !== catalogueSnapshot))
              throw new KeyringRuntimeError('CANCELLED');
            const token = {};
            reserved = token;
            const generationAtAdmission = revokeGeneration();
            let used = false;
            return {
              cancel() { if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent: () => void) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  return Promise.reject(new KeyringRuntimeError('CANCELLED'));
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  current(captured); checkGuard(assertCurrent);
                  if ('password' in request) {
                    if (!(await authenticate(request.password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                    current(captured); checkGuard(assertCurrent);
                    await hydrate(captured);
                    current(captured); checkGuard(assertCurrent);
                  }
                  const before = catalogueSnapshot;
                  if (!before || before.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
                  let derived: IKeyringAccountState | undefined;
                  let mutation;
                  if (request.kind === 'import-ledger') {
                    if (!ledger || ledger.snapshot !== before) throw new KeyringRuntimeError('CANCELLED');
                    derived = { ...ledger.account, label: request.label };
                    mutation = { kind: 'import-ledger', account: derived } as const;
                  } else if (request.kind === 'create') {
                  const created = await keyring.addNewAccount(request.label);
                      current(captured); checkGuard(assertCurrent);
                      if (!created || !Number.isSafeInteger(created.id) || created.id < 1 ||
                          before.accounts.some((account) => account.type === 'HDAccount' && account.index === created.id))
                        throw new KeyringRuntimeError('CANCELLED');
                      derived = checkedAccount(created, created.id, before.active.networkId, before.utxoNetworks);
                  mutation = { kind: 'create', account: derived } as const;
                  } else if (request.kind === 'create-smart') {
                    const prepare = dependencies.prepareSmartAccount;
                    if (!prepare || findUtxoNetwork(before.active.networkId, before.utxoNetworks)) throw new KeyringRuntimeError('NOT_READY');
                    const network = getNativeNetwork(before.active.networkId, before.networks);
                    const managementAddress = state.accounts.HDAccount[0]?.address;
                    if (!managementAddress) throw new KeyringRuntimeError('NOT_READY');
                    const signal = new AbortController();
                    pendingRegistration = signal;
                    const check = () => { current(captured); checkGuard(assertCurrent); if (signal.signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
                    try {
                      const created = await keyring.createSmartAccount({ label: request.label,
                        deriveAccount: (accountIndex) => prepare(network, accountIndex, managementAddress, signal.signal, check),
                      });
                      check();
                      if (!created.isSmartAccount || created.isImported || created.isLedgerWallet || created.isTrezorWallet || created.xprv !== '')
                        throw new KeyringRuntimeError('OPERATION_FAILED');
                      requireSmartAccountAddressIdentity({ address: created.address, xpub: created.xpub, smartAccount: created.smartAccount }, Number(network.chainId));
                      derived = created;
                      mutation = { kind: 'create-smart', account: created } as const;
                    } finally { if (pendingRegistration === signal) pendingRegistration = null; signal.abort(); }
                  } else if (requiresUtxoApproval) {
                    if (!approval || approval.signal.aborted || approval.snapshot !== before)
                      throw new KeyringRuntimeError('CANCELLED');
                    mutation = request.kind === 'remove-utxo-network'
                      ? { kind: request.kind, id: approval.network.id } as const
                      : { kind: request.kind, registration: utxoRegistrationData(approval.network) } as const;
                  } else {
                    mutation = request;
                    if (request.kind === 'select-network') {
                      const guard = () => { current(captured); checkGuard(assertCurrent); };
                      const utxo = findUtxoNetwork(request.id, before.utxoNetworks);
                      if (utxo && !supportsUtxoSoftwareCustody(utxo)) throw new KeyringRuntimeError('INVALID_INPUT');
                      if ((utxo?.slip44 ?? 60) !== state.activeNetwork.slip44) {
                        await dataBinding(captured, guard); guard();
                        const initialGroup = await switchAccountGroup(request.id, guard); guard();
                        if (initialGroup) mutation = { ...request, initialGroup };
                      }
                    } else if (request.kind === 'remove') {
                      const account = before.accounts.find((a) => a.id === request.id);
                      if (!account) throw new KeyringRuntimeError('CANCELLED');
                      if (account.slip44 === 60) {
                        await dataBinding(captured, assertCurrent);
                        current(captured); checkGuard(assertCurrent);
                        const retained = await signedRecords.listAddress({ keyring, assertCurrent: () => { current(captured); checkGuard(assertCurrent); } }, account.address);
                        const hasAlias = before.accounts.some((candidate) => candidate.id !== account.id && candidate.address.toLowerCase() === account.address.toLowerCase());
                        if (!hasAlias && retained.some((entry) => !['confirmed','reverted','nonce-consumed'].includes(entry.phase))) throw new TransferJournalError('PENDING_TRANSFER');
                        current(captured); checkGuard(assertCurrent);
                      } else {
                        const network = findUtxoNetwork(before.active.networkId, before.utxoNetworks);
                        const source = state.accounts[account.type][account.index];
                        if (!utxoRecords || !network || network.slip44 !== account.slip44 ||
                            !source?.xpub || source.address !== account.address)
                          throw new KeyringRuntimeError('NOT_READY');
                        const guard = () => { current(captured); checkGuard(assertCurrent); };
                        await dataBinding(captured, guard); guard();
                        const pending = await utxoRecords.hasUnresolvedForAccount(
                          { keyring, assertCurrent: guard },
                          account.slip44,
                          { type: account.type, id: account.index, xpub: source.xpub },
                        );
                        guard();
                        if (pending) throw new TransferJournalError('PENDING_TRANSFER');
                      }
                    }
                  }
                  const guard = () => { current(captured); checkGuard(assertCurrent); };
                  if (mutation.kind === 'remove') {
                    const target = parseNativeAccountId(mutation.id);
                    const repository = await getConnectionRepository(captured);
                    guard();
                    await repository.retireAccount({
                      accountId: target.index,
                      accountType: sdk.KeyringAccountType[target.type],
                      slip44: target.slip44,
                    }, async (commit) => {
                      const next = await catalogue.mutate(expectedRevision, mutation, guard, commit);
                      guard();
                      publishAccounts(next);
                    }, guard);
                  } else {
                    const next = await catalogue.mutate(expectedRevision, mutation, guard);
                    guard();
                    if (derived) state.accounts[derived.isLedgerWallet ? 'Ledger' : derived.isSmartAccount ? 'SmartAccount' : 'HDAccount'][derived.id] = derived;
                    publishAccounts(next);
                  }
                });
              },
            };
        };
        const imports: NativeImportRuntime = {
          async previewUtxo(input, expectedRevision, assertCurrent) {
            const captured = generation, snapshot = catalogueSnapshot, ring = keyring;
            const network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            const guard = () => {
              current(captured); checkGuard(assertCurrent); current(captured);
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
              if (!ring.isUnlocked() || catalogueSnapshot !== snapshot || keyring !== ring ||
                  snapshot?.revision !== expectedRevision)
                throw new KeyringRuntimeError('CANCELLED');
            };
            guard();
            if (!network || network.decimals !== 8 || !utxoRecords || !dependencies.utxoFetch || !dependencies.readUtxoBalance)
              throw new KeyringRuntimeError('NOT_READY');
            try {
              const { privateKey, utxoAddressType } = normalizeUtxoImport(input);
              if (!supportsUtxoSoftwareCustody(network, utxoAddressType === 'p2tr' ? 1 : 0))
                throw new KeyringRuntimeError('INVALID_INPUT');
              guard();
              const account = await ring.importAccount(privateKey, undefined, utxoAddressType ? { utxoAddressType } : undefined);
              guard();
              return checkedUtxoImport(account, network, utxoAddressType ? 'address' : 'account').address;
            } catch (cause) {
              guard();
              // The SDK importer currently reports duplicates without a code.
              if (cause instanceof Error && cause.message === 'Account already exists, try again with another Private Key.')
                throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
              throw new KeyringRuntimeError('INVALID_INPUT');
            }
          },
          reserve(input, password, expectedRevision) {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot)
              throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const networkId = catalogueSnapshot.active.networkId;
            const utxo = findUtxoNetwork(networkId, catalogueSnapshot.utxoNetworks);
            if (utxo && (utxo.decimals !== 8 || !utxoRecords || !dependencies.utxoFetch || !dependencies.readUtxoBalance))
              throw new KeyringRuntimeError('NOT_READY');
            let request: typeof input;
            try {
              request = decodeStorageValue(encodeStorageValue(input)) as typeof input;
              const fields = request && Object.keys(request).sort().join(',');
              if (!request || typeof request !== 'object' || Array.isArray(request) ||
                  (fields !== 'expectedAddress,label,privateKey' &&
                    !(utxo && fields === 'expectedAddress,label,privateKey,utxoAddressType')) ||
                  typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label ||
                  request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label)) throw new Error('INVALID_INPUT');
              if (utxo && !supportsUtxoSoftwareCustody(utxo, request.utxoAddressType === 'p2tr' ? 1 : 0))
                throw new KeyringRuntimeError('INVALID_INPUT');
              const key = utxo
                ? normalizeUtxoImport({ privateKey: request.privateKey, utxoAddressType: request.utxoAddressType }).privateKey
                : normalizeImportedKey(request.privateKey);
              const address = utxo ? normalizeUtxoAddress(request.expectedAddress, utxo) : importedKeyIdentity(key, 0).address;
              if (request.expectedAddress !== address) throw new Error('INVALID_INPUT');
              request = Object.freeze({ ...request, privateKey: key });
              validPassword(password, false);
            } catch { throw new KeyringRuntimeError('INVALID_INPUT'); }
            if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
              throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
            const token = {}; reserved = token; const generationAtAdmission = revokeGeneration(); let used = false;
            return {
              cancel() { if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  return Promise.reject(new KeyringRuntimeError('CANCELLED'));
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  const guard = () => { current(captured); checkGuard(assertCurrent); current(captured); };
                  guard();
                  if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                  guard(); await hydrate(captured); guard();
                  if (!catalogueSnapshot || catalogueSnapshot.revision !== expectedRevision ||
                      catalogueSnapshot.active.networkId !== networkId) throw new KeyringRuntimeError('CANCELLED');
                  if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
                    throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
                  const prepared = await importAccountWithRecovery(keyring, { secret: request.privateKey, label: request.label,
                    network: utxo ? { kind: 'syscoin', slip44: utxo.slip44 } : { kind: 'ethereum', slip44: 60 },
                    ...(utxo && request.utxoAddressType && { options: { utxoAddressType: request.utxoAddressType } }) }, guard); guard();
                  const index = prepared.account.id;
                  const imported = utxo
                    ? checkedUtxoImport(prepared.account, utxo, request.utxoAddressType ? 'address' : 'account')
                    : checkedImported(prepared.account, request.privateKey, index);
                  if (imported.address !== request.expectedAddress) throw new KeyringRuntimeError('INVALID_INPUT');
                  const next = await catalogue.mutate(expectedRevision, { kind: 'import',
                      account: imported, recovery: prepared.recovery }, guard); guard();
                  state.accounts.Imported[index] = imported;
                  publishAccounts(next);
                });
              },
            };
          },
        };
        const accounts: NativeAccountRuntime = {
          supported: () => typeof keyring.addNewAccount === 'function',
          supportsSmartAccounts: () => !!dependencies.prepareSmartAccount && !!catalogueSnapshot && !findUtxoNetwork(catalogueSnapshot.active.networkId, catalogueSnapshot.utxoNetworks),
          getSnapshot: () => closed || requiresReopen() || !keyring.isUnlocked() ? null : catalogueSnapshot,
          reserve: (input, expectedRevision) => reserveContext(input, expectedRevision),
        };
        const networks: NativeNetworkRuntime = {
          prepareUtxo,
          withUtxoChangeApproval,
          getSelectedId: () => closed || requiresReopen() || !keyring.isUnlocked() ? null : catalogueSnapshot?.active.networkId ?? null,
          reserve: (input, expectedRevision) => {
            const request = typeof input === 'string' ? { kind: 'select-network' as const, id: input } : input;
            return reserveContext(request, expectedRevision, true);
          },
        };
        const canSign = () => !!catalogueSnapshot && ['HDAccount', 'Imported', 'Ledger'].includes(selectedAccount().type) && nativeSigningEnabled(catalogueSnapshot.active.networkId, catalogueSnapshot.networks);
        const activityContext = async (assertCurrent: () => void): Promise<{ scope: ActivityScope; guard: () => void; index: number; type: NativeAccountType }> => {
          const captured = generation;
          const guard = () => { current(captured); checkGuard(assertCurrent); if (reserved) throw new KeyringRuntimeError('BUSY'); if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY'); };
          guard();
          const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
          const networkId = catalogueSnapshot!.active.networkId;
          const fingerprint = await dataBinding(captured, guard); guard();
          return { scope: createActivityScope(fingerprint, selected.id, selected.address, getNativeNetwork(networkId, catalogueSnapshot!.networks)), guard, index: selected.index, type: selected.type };
        };
        const checkActivityContext = async (scope: EvmActivityReadScope, assertCurrent: () => void) => {
          const context = await activityContext(assertCurrent);
          if (context.scope.key !== scope.key || context.scope.sourceId !== scope.sourceId) throw new KeyringRuntimeError('CANCELLED');
          return context;
        };
        const tokenOperation = <T>(
          assertCurrent: () => void,
          action: (scope: NativeTokenScope, guard: () => void) => Promise<T>,
          kind?: 'registry-write'
        ): Promise<T> => {
          if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
          const captured = generation;
          const check = () => {
            current(captured); checkGuard(assertCurrent);
            if (closed || captured !== generation) throw new KeyringRuntimeError('CANCELLED');
            if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
          };
          // Reserve through the synchronous caller guard. Nothing can enter
          // between successful admission, epoch retirement and task installation.
          reserved = {};
          try {
            check();
            // A write that later fails still retires earlier inventory proofs.
            if (kind === 'registry-write') retireContextReadLifetime();
          } catch (error) {
            return Promise.reject(error);
          } finally {
            reserved = null;
          }
          const task = Promise.resolve().then(async () => {
            check();
            const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
            const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
            const walletFingerprint = await dataBinding(captured, check); check();
            const result = await action(Object.freeze({ walletFingerprint, accountId: selected.id, address: selected.address,
              network: network.id, chainId: network.chainId, registrationHash: network.registrationHash }), check);
            check(); return result;
          }).catch(async (error: unknown) => {
            if (tokens.requiresReopen) {
              try { await lock(); } catch { /* Quarantine remains visible to authority cleanup. */ }
              throw new KeyringRuntimeError('CLEANUP_FAILED');
            }
            throw error;
          }).finally(() => { if (active === task) active = null; });
          active = task;
          return task;
        };
        const ledger: NativeLedgerRuntime = {
          subscribeStatus(listener) {
            ledgerStatusListeners.add(listener);
            return () => { ledgerStatusListeners.delete(listener); };
          },
          isConnected() {
            const verified = ledgerVerified;
            return (
              !!verified &&
              !closed &&
              !requiresReopen() &&
              keyring.isUnlocked() &&
              verified.generation === generation &&
              verified.snapshot === catalogueSnapshot &&
              verified.accountId === catalogueSnapshot?.active.accountId &&
              verified.transport === ledgerTransport &&
              verified.transport.host.getStatus().connected
            );
          },
          async scan(request, signal, assertOwner, onDevices, onError) {
            if (
              !request ||
              !['import', 'connect'].includes(request.purpose) ||
              Object.keys(request).join() !== 'purpose'
            )
              throw new KeyringRuntimeError('INVALID_INPUT');
            const before = catalogueSnapshot,
              ring = keyring,
              captured = generation;
            const target =
              request.purpose === 'connect' ? selectedAccount() : undefined;
            if (target && target.type !== 'Ledger')
              throw new KeyringRuntimeError('NOT_READY');
            const saved = target && state.accounts.Ledger[target.index];
            if (target && !saved) throw new KeyringRuntimeError('NOT_READY');
            const assertWallet = () => {
              current(captured);
              if (
                !before ||
                catalogueSnapshot !== before ||
                keyring !== ring ||
                !ring.isUnlocked() ||
                (target &&
                  (before.active.accountId !== target.id ||
                    state.accounts.Ledger[target.index]?.xpub !== saved!.xpub ||
                    state.accounts.Ledger[target.index]?.address !==
                      saved!.address))
              )
                throw new KeyringRuntimeError('CANCELLED');
            };
            const check = () => {
              assertWallet();
              checkGuard(assertOwner);
              assertWallet();
              if (signal.aborted || active || reserved)
                throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            if (!dependencies.createLedgerTransport)
              throw new KeyringRuntimeError('NOT_READY');
            await retireLedger();
            check();
            let cleanupFailure: unknown;
            let handedOff = false;
            const lifetime = new AbortController();
            ledgerLifetime = lifetime;
            const assertTransport = () => {
              assertWallet();
              if (!handedOff) check();
            };
            const created = Promise.resolve().then(async () => {
              check();
              const value = await dependencies.createLedgerTransport!({
                signal: lifetime.signal,
                assertCurrent: assertTransport,
              });
              try {
                check();
              } catch (error) {
                try {
                  await value.dispose();
                } catch (failure) {
                  cleanupFailure = failure;
                  throw failure;
                }
                throw error;
              }
              return value;
            });
            const acquisition = {
              async retire() {
                await created.then(
                  (value) => value.dispose(),
                  () => {
                    if (cleanupFailure) throw cleanupFailure;
                  }
                );
              },
            };
            ledgerOpening = acquisition;
            let transport: NativeLedgerTransport;
            try {
              transport = await created;
              check();
            } finally {
              if (ledgerOpening === acquisition) ledgerOpening = undefined;
            }
            ledgerTransport = transport;
            try {
              unsubscribeLedgerStatus = transport.host.subscribeStatus(() => {
                if (ledgerTransport !== transport) return;
                if (!transport.host.getStatus().connected) ledgerVerified = undefined;
                publishLedgerStatus();
              });
              const selection = transport.host.beginDeviceSelection(signal);
              const ordinal = ++ledgerScanOrdinal;
              const candidates = new Map<
                string,
                { device: object; name: string }
              >();
              const handles = new Map<string, string>();
              let nextHandle = 0;
              const text = (value: unknown, fallback: string) =>
                typeof value === 'string' && value.isWellFormed()
                  ? value
                      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
                      .trim()
                      .slice(0, 64) || fallback
                  : fallback;
              const stop = await transport.observeDevices(
                (devices) => {
                  check();
                  candidates.clear();
                  const seen = new Set<string>();
                  const visible = devices.slice(0, 32).flatMap((device) => {
                    const identity = JSON.stringify([
                      device.transport,
                      device.id,
                    ]);
                    if (seen.has(identity)) return [];
                    seen.add(identity);
                    const id =
                      handles.get(identity) ?? `${ordinal}:${nextHandle++}`;
                    handles.set(identity, id);
                    const name = text(device.name, 'Ledger');
                    candidates.set(id, { device, name });
                    return [
                      Object.freeze({
                        id,
                        name,
                        model: text(device.deviceModel?.name, 'Ledger'),
                      }),
                    ];
                  });
                  for (const identity of handles.keys())
                    if (!seen.has(identity)) handles.delete(identity);
                  onDevices(Object.freeze(visible));
                },
                (error) => {
                  try {
                    check();
                    onError(error);
                  } catch {
                    /* A retired screen receives no update. */
                  }
                }
              );
              let selected = false;
              let verified = false;
              return {
                async select(id) {
                  check();
                  const candidate = candidates.get(id);
                  if (!candidate || selected)
                    throw new KeyringRuntimeError('INVALID_INPUT');
                  selected = true;
                  await stop();
                  check();
                  await selection(candidate.device);
                  check();
                  if (request.purpose === 'import') {
                    const account = await ring.importLedgerAccount();
                    check();
                    if (
                      !account.isLedgerWallet ||
                      account.isImported ||
                      account.isTrezorWallet ||
                      account.isSmartAccount ||
                      account.xprv !== ''
                    )
                      throw new KeyringRuntimeError('OPERATION_FAILED');
                    preparedLedger = {
                      account,
                      generation: captured,
                      snapshot: before!,
                    };
                    return Object.freeze({
                      name: candidate.name,
                      address: account.address,
                    });
                  }
                  const signer = ring.ledgerSigner!;
                  if (target!.slip44 === 60) {
                    const actual = await signer.evm.getEvmAddressAndPubKey({
                      accountIndex: target!.index,
                    });
                    check();
                    if (
                      actual.address.toLowerCase() !==
                        saved!.address.toLowerCase() ||
                      actual.publicKey.replace(/^0x/, '').toLowerCase() !==
                        saved!.xpub.replace(/^0x/, '').toLowerCase()
                    )
                      throw new KeyringRuntimeError('INVALID_INPUT');
                  } else {
                    const network = findUtxoNetwork(
                      before!.active.networkId,
                      before!.utxoNetworks
                    );
                    if (!network) throw new KeyringRuntimeError('NOT_READY');
                    const actual = await signer.utxo.getXpub({
                      index: target!.index,
                      coin: state.activeNetwork.currency,
                      slip44: target!.slip44,
                    });
                    check();
                    if (
                      sdk.convertExtendedKeyVersion(
                        actual,
                        network.publicKeyVersion
                      ) !== saved!.xpub
                    )
                      throw new KeyringRuntimeError('INVALID_INPUT');
                  }
                  verified = true;
                  return Object.freeze({
                    name: candidate.name,
                    address: target!.address,
                  });
                },
                handoff() {
                  check();
                  if (
                    request.purpose !== 'connect' ||
                    !verified ||
                    !target ||
                    !transport.host.getStatus().connected
                  )
                    throw new KeyringRuntimeError('NOT_READY');
                  handedOff = true;
                  ledgerVerified = {
                    accountId: target.id,
                    generation: captured,
                    snapshot: before!,
                    transport,
                  };
                  publishLedgerStatus();
                },
                async close() {
                  if (handedOff) {
                    await stop();
                    return;
                  }
                  if (ledgerTransport === transport) await retireLedger();
                  else await transport.dispose();
                },
              };
            } catch (error) {
              if (ledgerTransport === transport) await retireLedger();
              else await transport.dispose();
              throw error;
            }
          },
        };
        const refreshSmartAccountMetadata = async (signal: AbortSignal, assertOwner: () => void) => {
            const captured = generation, snapshot = catalogueSnapshot, ring = keyring;
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (!snapshot || !ring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
            const selected = selectedAccount();
            const account = state.accounts.SmartAccount[selected.index];
            const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            if (selected.type !== 'SmartAccount' || !account?.smartAccount ||
                account.smartAccount.chainId !== Number(network.chainId)) throw new KeyringRuntimeError('INVALID_INPUT');
            requireSmartAccountAddressIdentity(account, Number(network.chainId));
            const contextSignal = (contextReadLifetime ??= new AbortController()).signal;
            const request = new AbortController();
            const abort = () => request.abort();
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || contextSignal.aborted || request.signal.aborted || keyring !== ring || !ring.isUnlocked() ||
                  catalogueSnapshot !== snapshot || selectedAccount() !== selected ||
                  state.accounts.SmartAccount[selected.index] !== account) throw new KeyringRuntimeError('CANCELLED');
            };
            signal.addEventListener('abort', abort, { once: true });
            contextSignal.addEventListener('abort', abort, { once: true });
            try {
              check(); await dataBinding(captured, check); check();
              const rpc = new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch });
              const provider = createNativeSmartAccountProvider(network, rpc, request.signal, check);
              const metadata = await readSmartAccountValidatorMetadata({ account: account as IKeyringAccountState & { smartAccount: NonNullable<IKeyringAccountState['smartAccount']> },
                chainId: Number(network.chainId), provider, assertCurrent: check });
              check();
              let observation: GuardianRecoveryObservation | null = null;
              if (metadata.isDeployed) {
                const guardian = await rpc.readGuardianRecoveryStatus(account.address, request.signal, check);
                check();
                if (guardian.status !== 'observed') throw new KeyringRuntimeError('NOT_READY');
                observation = guardian.observation;
                if (guardian.observation.exists) metadata.installedModules = [
                  ...(metadata.installedModules ?? []), projectGuardianPolicyModule(guardian.observation),
                ];
              }
              await dataBinding(captured, check); check();
              const committed = await run(async () => {
                // A read may be cancelled before this queued mutation starts.
                try { check(); } catch { return false; }
                const next = await catalogue.mutate(snapshot.revision, { kind: 'refresh-smart-metadata', id: selected.id,
                  metadata: { auth: metadata.auth, availableModules: metadata.availableModules,
                    isDeployed: metadata.isDeployed === true, installedModules: metadata.installedModules } }, check);
                check(); publishAccounts(next);
                return true;
              });
              if (!committed) throw new KeyringRuntimeError('CANCELLED');
              return observation;
            } finally {
              signal.removeEventListener('abort', abort);
              contextSignal.removeEventListener('abort', abort);
              request.abort();
            }
        };
        const inspectGuardianRemoval = async (signal: AbortSignal, assertOwner: () => void): Promise<GuardianRemovalInspection> => {
          const captured = generation, snapshot = catalogueSnapshot, ring = keyring;
          if (!snapshot || !ring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
          const selected = selectedAccount(), account = state.accounts.SmartAccount[selected.index];
          if (selected.type !== 'SmartAccount' || !account?.smartAccount) throw new KeyringRuntimeError('INVALID_INPUT');
          const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
          if (account.smartAccount.chainId !== Number(network.chainId)) throw new KeyringRuntimeError('INVALID_INPUT');
          requireSmartAccountAddressIdentity(account, Number(network.chainId));
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (signal.aborted || ring !== keyring || catalogueSnapshot !== snapshot || selectedAccount() !== selected ||
                state.accounts.SmartAccount[selected.index] !== account) throw new KeyringRuntimeError('CANCELLED');
          };
          check(); await dataBinding(captured, check); check();
          const rpc = new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch });
          const status = await rpc.readGuardianRecoveryStatus(account.address, signal, check);
          check();
          if (status.status !== 'observed') throw new KeyringRuntimeError('NOT_READY');
          if (!status.observation.exists) {
            await dataBinding(captured, check); check();
            return { status: 'removed', transactions: [], totalPending: 0 };
          }
          const records = await signedRecords.captureSmartAccountPendingRecords({ keyring: ring, assertCurrent: check }, network.chainId, account.address);
          const inspected = await inspectGuardianRemovals({ account: account.address, chainId: Number(network.chainId), moduleAddress: status.observation.moduleAddress,
            records, read: (method, params) => rpc.retirementRead(method, params, signal, check), assertCurrent: check });
          if (inspected.status === 'retry-ready') {
            const latest = await rpc.readGuardianRecoveryStatus(account.address, signal, check);
            check();
            if (latest.status !== 'observed' || guardianPolicyObservationIdentity(latest.observation) !== guardianPolicyObservationIdentity(status.observation))
              throw new Error('GUARDIAN_POLICY_CHANGED');
          }
          await dataBinding(captured, check); check();
          return inspected;
        };
        const canManageGuardianPolicy = () => {
          if (!catalogueSnapshot || !keyring.isUnlocked()) return false;
          const selected = selectedAccount();
          const metadata = selected.type === 'SmartAccount' ? state.accounts.SmartAccount[selected.index]?.smartAccount : undefined;
          if (!metadata) return false;
          try {
            getSmartAccountLocalEcdsaOwners(metadata, address => {
              for (const type of ['HDAccount', 'Imported'] as const) {
                const owner = Object.values(state.accounts[type]).find(candidate => candidate.address.toLowerCase() === address.toLowerCase());
                if (owner) return { id: owner.id, type: sdk.KeyringAccountType[type] };
              }
              return null;
            });
            return true;
          } catch { return false; }
        };
        const getGuardianRecoveryIntent = () => {
          if (!catalogueSnapshot || !keyring.isUnlocked()) return null;
          const selected = selectedAccount();
          return (
            catalogue.privateRecords.guardianRecoveryIntents?.find(
              (entry) => entry.accountId === selected.id
            ) ?? null
          );
        };
        const openGuardianRecovery = async (
          draft: NativeGuardianRecoveryDraft,
          parentSignal: AbortSignal,
          assertOwner: () => void
        ) => {
          const kind = Object.getOwnPropertyDescriptor(draft, 'kind')?.value;
          const input = readOwnData(
            draft,
            kind === 'start' ? ['kind', 'guardianId', 'replacementId'] : ['kind']
          );
          if (
            (kind !== 'start' && kind !== 'resume') ||
            (kind === 'start' &&
              (typeof input.guardianId !== 'string' ||
                typeof input.replacementId !== 'string'))
          )
            throw new KeyringRuntimeError('INVALID_INPUT');
          const request = Object.freeze({
            kind,
            guardianId: input.guardianId as string,
            replacementId: input.replacementId as string,
          });
          const lifetime = new AbortController();
          const signal = lifetime.signal;
          const abort = () => lifetime.abort();
          const dispose = () => {
            parentSignal.removeEventListener('abort', abort);
            abort();
          };
          parentSignal.addEventListener('abort', abort, { once: true });
          if (parentSignal.aborted) abort();
          let handedOff = false;
          try {
            const captured = generation,
              ring = keyring;
            const initialSnapshot = catalogueSnapshot;
            let selected = selectedAccount();
            const initialAccount = state.accounts.SmartAccount[selected.index];
            if (
              !initialSnapshot ||
              !ring.isUnlocked() ||
              selected.type !== 'SmartAccount' ||
              !initialAccount?.smartAccount
            )
              throw new KeyringRuntimeError('NOT_READY');
            let snapshot = initialSnapshot,
              account = initialAccount;
            const network = getNativeNetwork(
              snapshot.active.networkId,
              snapshot.networks
            );
            requireSmartAccountAddressIdentity(account, Number(network.chainId));
            const check = () => {
              checkGuard(assertOwner);
              current(captured);
              if (
                signal.aborted ||
                keyring !== ring ||
                !ring.isUnlocked() ||
                catalogueSnapshot !== snapshot ||
                selectedAccount() !== selected ||
                state.accounts.SmartAccount[selected.index] !== account
              )
                throw new KeyringRuntimeError('CANCELLED');
            };
            const rpc = new EvmTransferReadRpc(network, {
              fetch: dependencies.connectionFetch ?? walletFetch,
            });
            const provider = createNativeSmartAccountProvider(
              network,
              rpc,
              signal,
              check
            );
            const contract = new Contract(
              account.address,
              paliSmartAccountInterface,
              provider
            );
            const reference = (id: string) => {
              const saved = snapshot!.accounts.find(
                (entry) =>
                  entry.id === id &&
                  entry.slip44 === 60 &&
                  (entry.type === 'HDAccount' || entry.type === 'Imported')
              );
              if (!saved) throw new KeyringRuntimeError('INVALID_INPUT');
              const key = state.accounts[saved.type]?.[saved.index];
              if (
                !key?.xprv ||
                key.address.toLowerCase() !== saved.address.toLowerCase()
              )
                throw new KeyringRuntimeError('INVALID_INPUT');
              return {
                saved,
                key,
                ref: Object.freeze({ id, address: saved.address, xpub: key.xpub }),
              };
            };
            const commit = async (
              mutation: Exclude<CatalogueMutation, { kind: 'remove' }>
            ) => {
              await run(async () => {
                check();
                const next = await catalogue.mutate(
                  snapshot!.revision,
                  mutation,
                  check
                );
                check();
                publishAccounts(next);
                snapshot = next;
                selected = selectedAccount();
                account = state.accounts.SmartAccount[selected.index]!;
              });
            };
            const readPolicy = async (operationId?: string) => {
              check();
              const result = operationId
                ? await rpc.readGuardianRecoveryOperation(
                    account.address,
                    operationId,
                    signal,
                    check
                  )
                : await rpc.readGuardianRecoveryStatus(
                    account.address,
                    signal,
                    check
                  );
              check();
              if (result.status !== 'observed')
                throw new KeyringRuntimeError('NOT_READY');
              return result.observation;
            };
            const policyPorts = {
              assertCurrent: check,
              readModuleAddress: async () => {
                const status = await readPolicy();
                return status.exists ? status.moduleAddress : undefined;
              },
              readPolicyEpoch: async (_address: string, module: string) =>
                new Contract(module, paliGuardianRecoveryModuleInterface, provider)
                  .policyEpoch(account.address)
                  .then((value: bigint) => value.toString()),
            };
            let intent = getGuardianRecoveryIntent();
            check();
            await dataBinding(captured, check);
            check();
            if (request.kind === 'start') {
              if (intent)
                throw new Error('Resume or clear the existing recovery first');
              const guardian = reference(request.guardianId),
                replacement = reference(request.replacementId);
              const status = await readPolicy();
              if (
                !status.exists ||
                status.threshold !== 1 ||
                !status.guardians.some(
                  (address) =>
                    address.toLowerCase() === guardian.ref.address.toLowerCase()
                ) ||
                status.pending
              )
                throw new Error('The selected guardian cannot start this recovery');
              const target = {
                auth: {
                  module: 'ecdsa' as const,
                  validator: getConfiguredAuthenticatorAddress(
                    Number(network.chainId),
                    'ecdsa'
                  ),
                  data: encodeEcdsaValidatorInitData([replacement.ref.address], 1),
                },
              };
              const operation = await buildGuardianRecoveryStart(
                {
                  account: account.address,
                  chainId: Number(network.chainId),
                  target,
                  salt: hexlify(
                    globalThis.crypto.getRandomValues(new Uint8Array(32))
                  ),
                },
                {
                  ...policyPorts,
                  isValidatorInstalled: async (_address, validator) =>
                    contract.isModuleInstalled(1, validator, '0x'),
                  readCurrentValidator: async () => contract.activeValidator(),
                }
              );
              check();
              const canonical = captureGuardianRecoveryIntent({ operation, target });
              intent = Object.freeze({
                accountId: selected.id,
                ...canonical,
                guardian: guardian.ref,
                replacement: replacement.ref,
              });
              await commit({
                kind: 'store-guardian-recovery',
                id: selected.id,
                intent,
                expectedOperationHash: null,
              });
            } else if (!intent) throw new Error('No saved recovery is available');
            const savedIntent = intent!;
            const operationId = getGuardianRecoveryOperationId(savedIntent.operation);
            const guardian = reference(savedIntent.guardian.id),
              replacement = reference(savedIntent.replacement.id);
            for (const [actual, saved] of [
              [guardian.ref, savedIntent.guardian],
              [replacement.ref, savedIntent.replacement],
            ] as const)
              if (actual.address !== saved.address || actual.xpub !== saved.xpub)
                throw new KeyringRuntimeError('INVALID_INPUT');
            const validate = async () => {
              await validateGuardianRecoveryOperation(
                {
                  account: account.address,
                  chainId: Number(network.chainId),
                  operation: savedIntent.operation,
                },
                {
                  ...policyPorts,
                  readScheduleHash: async (operation) =>
                    new Contract(
                      operation.recoveryModule,
                      paliGuardianRecoveryModuleInterface,
                      provider
                    ).getRecoveryScheduleHash(
                      operation.account,
                      operation.salt,
                      operation.mode,
                      operation.executionCalldata
                    ),
                }
              );
              check();
            };
            const pendingTransaction = async (): Promise<string | null> => {
              const session = { keyring: ring, assertCurrent: check };
              const saved = await signedRecords.readRecent(
                session,
                network.chainId,
                guardian.ref.address,
                EVM_SIGNED_RECORD_LIMITS.transactions
              );
              check();
              const matching = saved.entries.filter((entry) => {
                const transaction = Transaction.from(entry.rawTransaction);
                if (
                  transaction.to?.toLowerCase() !==
                    savedIntent.operation.recoveryModule.toLowerCase() ||
                  transaction.value !== 0n
                )
                  return false;
                try {
                  const call = paliGuardianRecoveryModuleInterface.parseTransaction({
                    data: transaction.data,
                  });
                  if (
                    !call ||
                    !['scheduleRecovery', 'executeRecovery'].includes(call.name) ||
                    call.args[0].toLowerCase() !==
                      savedIntent.operation.account.toLowerCase() ||
                    call.args[1] !== savedIntent.operation.salt ||
                    call.args[2] !== savedIntent.operation.mode ||
                    call.args[3] !== savedIntent.operation.executionCalldata
                  )
                    return false;
                  if (
                    call.name === 'scheduleRecovery' &&
                    (call.args[4].length !== 1 ||
                      call.args[4][0].guardian.toLowerCase() !==
                        guardian.ref.address.toLowerCase() ||
                      recoverAddress(
                        savedIntent.operation.hash,
                        call.args[4][0].signature
                      ).toLowerCase() !== guardian.ref.address.toLowerCase())
                  )
                    return false;
                  return (
                    paliGuardianRecoveryModuleInterface
                      .encodeFunctionData(call.fragment, call.args)
                      .toLowerCase() === transaction.data.toLowerCase()
                  );
                } catch {
                  return false;
                }
              });
              let consumed = 0n,
                queries = 0;
              for (const entry of matching.sort(
                (left, right) => right.nonce - left.nonce
              )) {
                if (BigInt(entry.nonce) < consumed) continue;
                if (++queries > 48)
                  throw new Error('Recovery transaction observation is incomplete');
                const observed = await observeRetainedEvmTransaction(
                  signedRecords,
                  session,
                  network.chainId,
                  guardian.ref.address,
                  entry.hash,
                  (request) =>
                    rpc.observation(
                      {
                        hash: request.hash,
                        from: request.from,
                        to: request.to,
                        nonce: request.nonce,
                      },
                      signal,
                      check
                    ),
                  check
                );
                check();
                const bound =
                  observed.observation.status === 'mined'
                    ? BigInt(entry.nonce) + 1n
                    : BigInt(observed.observation.latestNonce);
                if (bound > consumed) consumed = bound;
                if (!observed.terminalPhase) return entry.hash;
              }
              const current = await signedRecords.listSender(
                session,
                network.chainId,
                guardian.ref.address
              );
              check();
              if (
                current.map((entry) => entry.hash).join(',') !==
                saved.entries.map((entry) => entry.hash).join(',')
              )
                throw new Error('Recovery transactions changed during observation');
              return null;
            };
            const observe = async (): Promise<NativeGuardianRecoveryStatus> => {
              const pending = await pendingTransaction();
              const observation = await readPolicy(operationId);
              const known = observation.knownOperation;
              if (known?.status === 'executed')
                return {
                  intent: savedIntent,
                  observation,
                  action: null,
                  terminal: 'executed',
                  transactionHash: null,
                  canAbandon: true,
                };
              check();
              if (pending)
                return {
                  intent: savedIntent,
                  observation,
                  action: null,
                  terminal: null,
                  transactionHash: pending,
                  canAbandon: false,
                };
              const obsolete =
                !observation.exists ||
                observation.policyEpoch !== savedIntent.operation.policyEpoch ||
                ['expired', 'canceled', 'inactive'].includes(known?.status ?? '');
              if (obsolete)
                return {
                  intent: savedIntent,
                  observation,
                  action: null,
                  terminal: 'obsolete',
                  transactionHash: null,
                  canAbandon: true,
                };
              if (
                observation.active &&
                observation.active.operationId !== operationId &&
                ['pending', 'ready'].includes(observation.active.status)
              )
                return {
                  intent: savedIntent,
                  observation,
                  action: null,
                  terminal: null,
                  transactionHash: null,
                  canAbandon: true,
                };
              if (known?.status === 'ready')
                return {
                  intent: savedIntent,
                  observation,
                  action: 'finalize',
                  terminal: null,
                  transactionHash: null,
                  canAbandon: false,
                };
              if (known?.status === 'pending')
                return {
                  intent: savedIntent,
                  observation,
                  action: null,
                  terminal: null,
                  transactionHash: null,
                  canAbandon: false,
                };
              return {
                intent: savedIntent,
                observation,
                action: 'schedule',
                terminal: null,
                transactionHash: null,
                canAbandon: true,
              };
            };
            const sign = async (owner: typeof guardian) =>
              run(async (ownerGeneration) => {
                const guard = () => {
                  current(ownerGeneration);
                  check();
                };
                guard();
                const signature = await ring.ethereumTransaction.ethSign(
                  [owner.ref.address, savedIntent.operation.hash],
                  {
                    selectedAccount: {
                      id: selected.index,
                      type: selected.type,
                      expectedAddress: selected.address,
                    },
                    targetAccount: {
                      id: owner.saved.index,
                      type: owner.saved.type,
                      expectedAddress: owner.ref.address,
                    },
                    assertCurrent: guard,
                  }
                );
                guard();
                return signature;
              });
            handedOff = true;
            return new NativeGuardianRecoveryController(
              {
                assertCurrent: check,
                dispose,
                observe,
                submissionFailure: (error) => sdk.evmSubmissionFailure(error),
                async prepare(action: NativeGuardianRecoveryAction) {
                  const status = await observe();
                  if (status.action !== action)
                    throw new Error('Recovery status changed');
                  await validate();
                  let transaction;
                  if (action === 'schedule') {
                    await sign(replacement);
                    const signature = await sign(guardian);
                    transaction = buildGuardianRecoveryScheduleTransaction({
                      account: account.address,
                      guardian: guardian.ref.address,
                      approval: { guardian: guardian.ref.address, signature },
                      operation: savedIntent.operation,
                    });
                  } else
                    transaction = buildGuardianRecoveryFinalizeTransaction({
                      account: account.address,
                      operation: savedIntent.operation,
                    });
                  check();
                  const prepared = await prepareOwnedEvmTransaction(
                    transaction,
                    guardian.saved,
                    selected,
                    signal,
                    check,
                    {
                      smartAccountGuardianRecovery: action === 'schedule',
                      smartAccountGuardianRecoveryFinalize: action === 'finalize',
                      smartAccountRecoveryAccount: account.address,
                    },
                    NATIVE_EVM_FEE_FUNDING,
                    { kind: 'estimate' }
                  );
                  check();
                  return Object.freeze({
                    ...prepared,
                    async submit(assertCurrent, onBroadcast) {
                      check();
                      checkGuard(assertCurrent);
                      if ((await observe()).action !== action)
                        throw new Error('Recovery status changed');
                      await validate();
                      check();
                      checkGuard(assertCurrent);
                      return prepared.submit(assertCurrent, onBroadcast);
                    },
                  });
                },
                async reconcile() {
                  if (
                    (await readPolicy(operationId)).knownOperation?.status !==
                    'executed'
                  )
                    throw new Error('Recovery is not executed');
                  const metadata = await readSmartAccountValidatorMetadata({
                    account: account as IKeyringAccountState & {
                      smartAccount: NonNullable<IKeyringAccountState['smartAccount']>;
                    },
                    chainId: Number(network.chainId),
                    provider,
                    assertCurrent: check,
                  });
                  check();
                  if (
                    !metadata.isDeployed ||
                    metadata.auth?.module !== savedIntent.target.auth.module ||
                    getSmartAccountAuthHash(metadata.auth) !==
                      getSmartAccountAuthHash(savedIntent.target.auth)
                  )
                    throw new Error('Recovery metadata has not caught up');
                  const policy = await readPolicy(operationId);
                  if (policy.knownOperation?.status !== 'executed')
                    throw new Error('Recovery status changed');
                  if (policy.exists)
                    metadata.installedModules = [
                      ...(metadata.installedModules ?? []),
                      projectGuardianPolicyModule(policy),
                    ];
                  await commit({
                    kind: 'complete-guardian-recovery',
                    id: selected.id,
                    operationHash: savedIntent.operation.hash,
                    metadata: {
                      auth: metadata.auth,
                      availableModules: metadata.availableModules,
                      isDeployed: metadata.isDeployed === true,
                      installedModules: metadata.installedModules,
                    },
                  });
                },
                async abandon() {
                  if (!(await observe()).canAbandon)
                    throw new Error('Recovery is still pending');
                  await commit({
                    kind: 'retire-guardian-recovery',
                    id: selected.id,
                    operationHash: savedIntent.operation.hash,
                  });
                },
              },
              parentSignal
            );
          } finally {
            if (!handedOff) dispose();
          }
        };
        const openSmartAccountOperation = async (intent: NativeSmartAccountIntent, assertOwner: () => void, submitBatch?: NativeSmartOperationPorts['submitBatch'], assertGuardianPolicy?: NativeSmartOperationPorts['assertGuardianPolicy']): Promise<NativeSmartAccountOperation> => {
            if (active || reserved || !catalogueSnapshot || !keyring.isUnlocked() ||
                !nativeSigningEnabled(catalogueSnapshot.active.networkId, catalogueSnapshot.networks)) throw new KeyringRuntimeError('NOT_READY');
            let snapshot = catalogueSnapshot!, selected = selectedAccount();
            const ring = keyring, captured = generation;
            const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            let account = state.accounts.SmartAccount[selected.index];
            if (selected.type !== 'SmartAccount' || !account?.smartAccount ||
                account.smartAccount.chainId !== Number(network.chainId)) throw new KeyringRuntimeError('INVALID_INPUT');
            requireSmartAccountAddressIdentity(account, Number(network.chainId));
            const accountAddress = account.address;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (keyring !== ring || !ring.isUnlocked() || catalogueSnapshot !== snapshot || selectedAccount() !== selected ||
                  state.accounts.SmartAccount[selected.index] !== account) throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            const rpc = new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch });
            const pendingRecords = await signedRecords.captureSmartAccountPendingRecords(
              { keyring: ring, assertCurrent: check }, network.chainId, account.address);
            check();
            return createNativeSmartOperation({
              intent, pendingRecords, ...(submitBatch ? { submitBatch } : {}), ...(assertGuardianPolicy ? { assertGuardianPolicy } : {}),
              checkAddress: dependencies.checkSmartAccountAddress ?? (address => blacklistService.checkAddress(address)),
              account: account as IKeyringAccountState & { smartAccount: NonNullable<IKeyringAccountState['smartAccount']> },
              wallet: state, network, rpc, assertCurrent: check,
              signOwner(address, digest, owner, assertCurrent) {
                return run(async ownerGeneration => {
                  const guard = () => { current(ownerGeneration); check(); checkGuard(assertCurrent); };
                  guard();
                  const target = state.accounts[owner.type]?.[owner.id];
                  if ((owner.type !== 'HDAccount' && owner.type !== 'Imported') || !target ||
                      target.address.toLowerCase() !== address.toLowerCase()) throw new KeyringRuntimeError('INVALID_INPUT');
                  const signature = await ring.ethereumTransaction.ethSign([address, digest], {
                    selectedAccount: { id: selected.index, type: selected.type, expectedAddress: selected.address },
                    targetAccount: { id: owner.id, type: owner.type, expectedAddress: address },
                    assertCurrent: guard,
                  });
                  guard();
                  return signature;
                });
              },
              preparePayer(request, payer, signal, assertCurrent, metadata, funding) {
                check(); checkGuard(assertCurrent);
                const owned = snapshot.accounts.find(candidate => candidate.index === payer.id && candidate.type === payer.type);
                if (!owned || owned.address.toLowerCase() !== payer.address.toLowerCase()) throw new KeyringRuntimeError('INVALID_INPUT');
                const payerRecord = state.accounts[payer.type]?.[payer.id];
                const guard = () => {
                  check(); checkGuard(assertCurrent);
                  if (state.accounts[payer.type]?.[payer.id] !== payerRecord || payerRecord?.address.toLowerCase() !== owned.address.toLowerCase())
                    throw new KeyringRuntimeError('CANCELLED');
                };
                return prepareOwnedEvmTransaction(request, owned, selected, signal, guard, metadata, funding, { kind: 'estimate' });
              },
              async waitForReceipt(hash, transaction, signal, assertCurrent, operation) {
                const guard = () => { check(); checkGuard(assertCurrent); if (signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
                for (;;) {
                  guard();
                  if (operation) {
                    const observed = await observeSmartAccountActivity({ ...operation, hash, account: accountAddress,
                      chainId: network.chainId, nonce: Number(transaction.nonce) },
                    (method, params) => rpc.retirementRead(method, params, signal, guard), guard);
                    guard();
                    if (observed.status === 'mined') {
                      if (observed.outcome !== 'confirmed') throw new Error('Smart account operation did not succeed');
                      return observed;
                    }
                    if (BigInt(observed.latestNonce) > BigInt(transaction.nonce)) throw new Error('Smart account transaction nonce was consumed');
                  }
                  const observed = operation ? null : await rpc.receipt({ hash, from: transaction.from, to: transaction.to, nonce: transaction.nonce }, signal, guard);
                  guard();
                  if (observed) {
                    if (observed.status !== 'included' || observed.outcome !== 'succeeded') throw new Error('Smart account transaction did not succeed');
                    return observed;
                  }
                  await new Promise<void>((resolve, reject) => {
                    const abort = () => { clearTimeout(timer); reject(new KeyringRuntimeError('CANCELLED')); };
                    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 3000);
                    signal.addEventListener('abort', abort, { once: true });
                    if (signal.aborted) abort();
                  });
                }
              },
              async markDeployed(assertCurrent) {
                const guard = () => { check(); checkGuard(assertCurrent); };
                guard();
                const next = await catalogue.mutate(snapshot.revision, { kind: 'mark-smart-deployed', id: selected.id }, guard);
                guard();
                publishAccounts(next);
                snapshot = next;
                selected = selectedAccount();
                account = state.accounts.SmartAccount[selected.index]!;
              },
              async refreshMetadata(signal, assertCurrent) {
                const observation = await refreshSmartAccountMetadata(signal, assertCurrent);
                snapshot = catalogueSnapshot!;
                selected = selectedAccount();
                account = state.accounts.SmartAccount[selected.index]!;
                if (intent.kind === 'guardian-policy') {
                  if (intent.command.kind === 'remove') {
                    if (!observation || observation.exists) throw new Error('Guardian removal metadata has not caught up');
                  } else if (!observation?.exists || observation.threshold !== 1 || observation.guardians.length !== 1 ||
                    observation.guardians[0]?.toLowerCase() !== intent.command.guardian.toLowerCase() ||
                    observation.delaySeconds !== intent.command.delaySeconds || observation.expirationSeconds !== intent.command.delaySeconds * 2)
                    throw new Error('Guardian policy metadata has not caught up');
                }
              },
            });
        };
        return {
          ledger,
          getGuardianRecoveryIntent,
          openGuardianRecovery,
          canManageGuardianPolicy,
          inspectGuardianRemoval,
          refreshSmartAccountMetadata,
          async openGuardianPolicy(draft, signal, assertOwner) {
            const action = draft && Object.getOwnPropertyDescriptor(draft, 'action')?.value;
            if (action !== 'set' && action !== 'remove') throw new KeyringRuntimeError('INVALID_INPUT');
            const input = readOwnData(draft, action === 'set'
              ? ['action', 'guardian', 'delaySeconds', 'acknowledgedPendingOperationId']
              : ['action', 'recoveryLossAcknowledged', 'acknowledgedPendingOperationId']);
            if ((action === 'set' && (typeof input.guardian !== 'string' || !Number.isSafeInteger(input.delaySeconds) || Number(input.delaySeconds) <= 0)) ||
                (action === 'remove' && input.recoveryLossAcknowledged !== true) || input.acknowledgedPendingOperationId !== null &&
                (typeof input.acknowledgedPendingOperationId !== 'string' || !/^0x[0-9a-f]{64}$/i.test(input.acknowledgedPendingOperationId)))
              throw new KeyringRuntimeError('INVALID_INPUT');
            const request = action === 'set'
              ? Object.freeze({ action: 'set' as const, guardian: normalizePublicAddress(input.guardian as string, 'ethereum'),
                delaySeconds: input.delaySeconds as number, acknowledgedPendingOperationId: input.acknowledgedPendingOperationId })
              : Object.freeze({ action: 'remove' as const, acknowledgedPendingOperationId: input.acknowledgedPendingOperationId });
            const captured = generation, before = catalogueSnapshot;
            if (!before || !canManageGuardianPolicy()) throw new KeyringRuntimeError('NOT_READY');
            const address = selectedAccount().address;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot?.active.accountId !== before.active.accountId ||
                  catalogueSnapshot.active.networkId !== before.active.networkId || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const observation = await refreshSmartAccountMetadata(signal, check);
            check();
            const selected = selectedAccount();
            const account = state.accounts.SmartAccount[selected.index];
            if (!account?.smartAccount || !canManageGuardianPolicy()) throw new KeyringRuntimeError('NOT_READY');
            if (observation?.pending && observation.pending.operationId !== request.acknowledgedPendingOperationId)
              throw new Error('GUARDIAN_POLICY_CONFIRMATION_REQUIRED');
            if (request.action === 'remove') {
              if (!observation?.exists) throw new Error('GUARDIAN_ALREADY_REMOVED');
              const state = await inspectGuardianRemoval(signal, check);
              check();
              if (state.status !== 'retry-ready') throw new Error('GUARDIAN_REMOVAL_PENDING');
            }
            const command = Object.freeze(request.action === 'remove'
              ? { accountAddress: account.address, kind: 'remove' as const, moduleAddress: observation!.moduleAddress }
              : { accountAddress: account.address, chainId: account.smartAccount.chainId, guardian: request.guardian, delaySeconds: request.delaySeconds,
                ...(observation?.exists ? { kind: 'update' as const, previousModuleAddress: observation.moduleAddress } : { kind: 'install' as const }) });
            buildGuardianPolicyExecutions(command);
            const expectedPolicy = guardianPolicyObservationIdentity(observation);
            const network = getNativeNetwork(before.active.networkId, before.networks);
            const assertPolicy = async (operationSignal: AbortSignal, assertCurrent: () => void) => {
              check(); checkGuard(assertCurrent);
              if (request.action === 'remove') {
                const state = await inspectGuardianRemoval(operationSignal, assertCurrent);
                if (state.status !== 'retry-ready') throw new Error('GUARDIAN_REMOVAL_PENDING');
              }
              const result = await new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch })
                .readGuardianRecoveryStatus(address, operationSignal, assertCurrent);
              check(); checkGuard(assertCurrent);
              const currentPolicy = result.status === 'observed' ? result.observation : null;
              if (result.status === 'unsupported' || guardianPolicyObservationIdentity(currentPolicy) !== expectedPolicy)
                throw new Error('GUARDIAN_POLICY_CHANGED');
            };
            return openSmartAccountOperation({ kind: 'guardian-policy', command }, assertOwner, undefined, assertPolicy);
          },
          openSmartAccountDeployment: (assertOwner) => openSmartAccountOperation({ kind: 'deploy' }, assertOwner),
          async openSmartAccountSend(recipient, amount, assertOwner) {
            let intent: NativeSmartAccountIntent;
            try {
              const target = normalizePublicAddress(recipient, 'ethereum');
              if (amount.kind === 'maximum') intent = Object.freeze({ kind: 'native-max', recipient: target });
              else if (amount.kind === 'exact') intent = Object.freeze({ kind: 'native-transfer', recipient: target,
                amountUnits: parseDecimalAmount(amount.amount, 18).toString() });
              else if (amount.kind === 'erc20') {
                const contract = normalizeErc20Address(amount.contractAddress);
                const request = Object.freeze({ amount: amount.amount, target, contract });
                const captured = generation, snapshot = catalogueSnapshot;
                const check = () => { current(captured); checkGuard(assertOwner); if (catalogueSnapshot !== snapshot) throw new KeyringRuntimeError('CANCELLED'); };
                const token = await tokenOperation(check, async (scope, guard) => {
                  const inventory = await tokens.load(scope, guard);
                  guard();
                  const saved = inventory.items.find(item => item.contractAddress === request.contract);
                  if (!saved) throw new KeyringRuntimeError('NOT_READY');
                  return saved;
                });
                check();
                intent = Object.freeze({ kind: 'erc20-transfer', token, recipient: request.target,
                  amountUnits: parseTokenAmount(request.amount, token.decimals) });
              } else if (amount.kind === 'nft') {
                const saved = snapshotSavedCollectible(amount.collectible);
                const request = Object.freeze({ tokenId: amount.tokenId, amountUnits: amount.amountUnits, recipient: target });
                const captured = generation, snapshot = catalogueSnapshot;
                const check = () => { current(captured); checkGuard(assertOwner); if (catalogueSnapshot !== snapshot) throw new KeyringRuntimeError('CANCELLED'); };
                intent = await tokenOperation(check, async (scope, guard) => {
                  const inventory = await tokens.load(scope, guard); guard();
                  const owned = inventory.collectibles?.find(item => item.contractAddress === saved.contractAddress && item.tokenStandard === saved.tokenStandard &&
                    (item.tokenStandard !== 'ERC-1155' || saved.tokenStandard === 'ERC-1155' && item.tokenId === saved.tokenId));
                  if (!owned) throw new KeyringRuntimeError('NOT_READY');
                  const network = getNativeNetwork(scope.network, snapshot!.networks);
                  return snapshotNftTransferSelection({ network, owner: scope.address, saved: owned }, request, network);
                });
                check();
              } else throw new KeyringRuntimeError('INVALID_INPUT');
            } catch (error) { if (error instanceof KeyringRuntimeError) throw error; throw new KeyringRuntimeError('INVALID_INPUT'); }
            return openSmartAccountOperation(intent, assertOwner);
          },
          async openConnectionHost(): Promise<NativeConnectionHost> {
            const captured = generation;
            const repository = await getConnectionRepository(captured);
            const walletBindingId = connectionRepositoryBinding;
            if (!walletBindingId) throw new KeyringRuntimeError('CANCELLED');
            const assertOwner = connectionOwner(walletBindingId);
            assertOwner();
            const captureTransaction = (
              input: Parameters<NativeConnectionHost['prepareTransaction']>[0],
              assertRequestCurrent: () => void
            ) => {
              assertOwner();
              checkGuard(assertRequestCurrent);
              const snapshot = catalogueSnapshot,
                ring = keyring,
                captured = generation,
                approval = input.approval;
              if (!ring.isUnlocked() || !snapshot || active || reserved)
                throw new KeyringRuntimeError('NOT_READY');
              const selected = snapshot.accounts.find(
                (account) => account.id === snapshot.active.accountId
              );
              if (
                !selected ||
                (selected.type !== 'HDAccount' &&
                  selected.type !== 'Imported' &&
                  selected.type !== 'SmartAccount') ||
                selected.id !== input.accountId ||
                selected.slip44 !== 60 ||
                snapshot.active.networkId !== input.networkId
              )
                throw new KeyringRuntimeError('INVALID_INPUT');
              const account = state.accounts[selected.type][selected.index];
              const network = getNativeNetwork(
                snapshot.active.networkId,
                snapshot.networks
              );
              const isCurrent = () =>
                !closed &&
                generation === captured &&
                keyring === ring &&
                ring.isUnlocked() &&
                catalogueSnapshot === snapshot &&
                state.activeAccount.id === selected.index &&
                state.activeAccount.type === selected.type &&
                state.accounts[selected.type][selected.index] === account &&
                account?.address === selected.address &&
                state.activeNetwork.kind === sdk.INetworkType.Ethereum &&
                state.activeNetwork.chainId === Number(network.chainId) &&
                state.activeNetwork.url === network.rpcUrl;
              approval.bindSigner('native-transaction', isCurrent);
              const check = () => {
                current(captured);
                assertOwner();
                checkGuard(approval.assertCurrent);
                checkGuard(assertRequestCurrent);
                if (!isCurrent()) throw new KeyringRuntimeError('CANCELLED');
              };
              check();
              return { snapshot, selected, account, network, approval, check };
            };
            const findLocalEcdsaOwner = (
              address: string
            ): SmartAccountLocalOwner | null => {
              for (const type of ['HDAccount', 'Imported'] as const) {
                const owner = Object.values(state.accounts[type]).find(
                  (entry) =>
                    !entry.isSmartAccount &&
                    !entry.isLedgerWallet &&
                    !entry.isTrezorWallet &&
                    entry.address.toLowerCase() === address.toLowerCase()
                );
                if (owner)
                  return {
                    id: owner.id,
                    type: type as SmartAccountLocalOwner['type'],
                  };
              }
              return null;
            };
            const supportsLocalEcdsaSmartAccount = (accountId: string) => {
              assertOwner();
              const record = catalogueSnapshot?.accounts.find(
                (entry) => entry.id === accountId
              );
              if (
                !record ||
                record.type !== 'SmartAccount' ||
                record.slip44 !== 60
              )
                return false;
              const saved = state.accounts.SmartAccount[record.index];
              const network = catalogueSnapshot!.networks.find(
                (entry) => entry.id === catalogueSnapshot!.active.networkId
              );
              if (
                !keyring.isUnlocked() ||
                !saved?.smartAccount ||
                !network ||
                saved.smartAccount.chainId !== Number(network.chainId)
              )
                return false;
              try {
                requireSmartAccountAddressIdentity(
                  saved,
                  Number(network.chainId)
                );
                getSmartAccountLocalEcdsaOwners(
                  saved.smartAccount,
                  findLocalEcdsaOwner
                );
                return true;
              } catch {
                return false;
              }
            };
            return Object.freeze({
              repository,
              walletBindingId,
              assertOwner,
              sessionGeneration() {
                assertOwner();
                return generation;
              },
              calls: repository.calls,
              supportsAtomicCalls: supportsLocalEcdsaSmartAccount,
              supportsSmartAccountMessages: supportsLocalEcdsaSmartAccount,
              async readCallsStatus(origin, id, assertRequestCurrent) {
                const snapshot = catalogueSnapshot;
                const guard = () => {
                  assertOwner();
                  checkGuard(assertRequestCurrent);
                  if (catalogueSnapshot !== snapshot)
                    throw new KeyringRuntimeError('CANCELLED');
                };
                return repository.calls.resolveCallsStatus(
                  {
                    assertCurrent: guard,
                    forChain(chainId) {
                      guard();
                      const network = snapshot?.networks.find(
                        (entry) => entry.chainId === String(chainId)
                      );
                      if (!network) return null;
                      const rpc = new EvmTransferReadRpc(network, {
                        fetch: dependencies.connectionFetch ?? walletFetch,
                      });
                      return {
                        async getTransactionReceipt(hash) {
                          const signal = (contextReadLifetime ??= new AbortController())
                            .signal;
                          await rpc.verifyNetwork(signal, guard);
                          const receipt = await rpc.retirementRead(
                            'eth_getTransactionReceipt',
                            [hash],
                            signal,
                            guard
                          );
                          await rpc.verifyNetwork(signal, guard);
                          return receipt;
                        },
                      };
                    },
                  },
                  origin,
                  id
                );
              },
              async prepareCalls(input, assertRequestCurrent) {
                const { selected, network, approval, check } = captureTransaction(
                  { ...input, transaction: {} },
                  assertRequestCurrent
                );
                const { origin, bundleId, reservationId } = input;
                if (selected.type !== 'SmartAccount')
                  throw new KeyringRuntimeError('INVALID_INPUT');
                const calls = normalizeDappCallsRequest(input.calls);
                if (
                  calls.from?.toLowerCase() !== selected.address.toLowerCase() ||
                  BigInt(calls.chainId!) !== BigInt(network.chainId)
                )
                  throw new KeyringRuntimeError('INVALID_INPUT');
                createSmartAccountCallsExecutions(calls.calls);
                const descriptor = {
                  atomic: true,
                  chainId: Number(network.chainId),
                  smartAccount: true,
                };
                let previousSubmissionId: string | undefined;
                const operation = await openSmartAccountOperation(
                  { kind: 'dapp-batch', calls: calls.calls },
                  check,
                  async (prepared, submit) => {
                    check();
                    const submissionId = repository.calls.generateWalletBundleId();
                    await repository.calls.recordSendCallsBundle(origin, bundleId, {
                      ...descriptor,
                      reservationId,
                      previousSubmissionId,
                      submissionId,
                      submissionStarted: true,
                      smartAccountIdentity: captureSmartAccountCallsIdentity(
                        prepared.userOperation,
                        Number(network.chainId)
                      ),
                      txHashes: [],
                    });
                    previousSubmissionId = submissionId;
                    let entered = false;
                    try {
                      check();
                      entered = true;
                      const hash = await submit();
                      await repository.calls.recordSendCallsBundle(origin, bundleId, {
                        ...descriptor,
                        reservationId,
                        submissionId,
                        submissionCompleted: true,
                        txHashes: [hash],
                      });
                      return hash;
                    } catch (error) {
                      const failure = error as {
                        transactionNotBroadcast?: boolean;
                        transactionHash?: string;
                      };
                      if (
                        failure.transactionHash &&
                        /^0x[\da-f]{64}$/i.test(failure.transactionHash)
                      )
                        await repository.calls.recordSendCallsBundle(origin, bundleId, {
                          ...descriptor,
                          reservationId,
                          submissionId,
                          submissionCompleted: true,
                          txHashes: [failure.transactionHash],
                        });
                      else if (!entered || failure.transactionNotBroadcast === true)
                        await repository.calls.recordSendCallsBundle(origin, bundleId, {
                          ...descriptor,
                          reservationId,
                          submissionId,
                          submissionNotBroadcast: true,
                          txHashes: [],
                        });
                      throw error;
                    }
                  }
                );
                try {
                  const batchApprovals = [];
                  for (const call of calls.calls) {
                    const metadata = decodeApprovalData(call.data).isApproval
                      ? await readNativeApprovalMetadata({
                          network,
                          owner: selected.address,
                          contract: call.to!,
                          signal: approval.signal,
                          assertCurrent: check,
                          fetch: dependencies.connectionFetch ?? walletFetch,
                        })
                      : undefined;
                    check();
                    batchApprovals.push(summarizeApproval(call.data, call.to!, metadata));
                  }
                  return Object.freeze({
                    operation,
                    approval: null,
                    batchApprovals: Object.freeze(batchApprovals),
                  });
                } catch (error) {
                  operation.dispose();
                  throw error;
                }
              },
              async prepareTransaction(input, assertRequestCurrent) {
                const { selected, network, approval, check } = captureTransaction(
                  input,
                  assertRequestCurrent
                );
                const normalized = normalizeDappTransaction(input.transaction);
                if (
                  normalized.from !== undefined &&
                  normalized.from.toLowerCase() !== selected.address.toLowerCase()
                )
                  throw new KeyringRuntimeError('INVALID_INPUT');
                if (selected.type === 'SmartAccount') {
                  const request = snapshotSmartAccountDappTransaction(normalized);
                  const operation = await openSmartAccountOperation(
                    {
                      kind: 'dapp-call',
                      recipient: request.to!,
                      amountUnits: BigInt(request.value ?? '0x0').toString(),
                      data: request.data ?? '0x',
                      ...(request.maxFeePerGas === undefined
                        ? {}
                        : {
                            maxFeePerGas: BigInt(request.maxFeePerGas).toString(),
                          }),
                      ...(request.maxPriorityFeePerGas === undefined
                        ? {}
                        : {
                            maxPriorityFeePerGas: BigInt(
                              request.maxPriorityFeePerGas
                            ).toString(),
                          }),
                    },
                    check
                  );
                  try {
                    const metadata = decodeApprovalData(request.data ?? '0x').isApproval
                      ? await readNativeApprovalMetadata({
                          network,
                          owner: selected.address,
                          contract: request.to!,
                          signal: approval.signal,
                          assertCurrent: check,
                          fetch: dependencies.connectionFetch ?? walletFetch,
                        })
                      : undefined;
                    check();
                    return Object.freeze({
                      operation,
                      approval: summarizeApproval(
                        request.data ?? '0x',
                        request.to!,
                        metadata
                      ),
                    });
                  } catch (error) {
                    operation.dispose();
                    throw error;
                  }
                }
                return prepareOwnedEvmTransaction(
                  normalized,
                  selected,
                  selected,
                  approval.signal,
                  check,
                  undefined,
                  NATIVE_EVM_FEE_FUNDING,
                  { kind: 'estimate' }
                );
              },
              signMessage(input) {
                assertOwner();
                const approval = input.approval;
                const snapshot = catalogueSnapshot;
                if (!keyring.isUnlocked() || !snapshot)
                  return Promise.reject(new KeyringRuntimeError('NOT_READY'));
                const selected = snapshot.accounts.find(
                  (account) => account.id === snapshot.active.accountId
                );
                if (
                  !selected ||
                  selected.id !== input.accountId ||
                  selected.slip44 !== 60 ||
                  snapshot.active.networkId !== input.networkId ||
                  !approval ||
                  typeof approval.assertCurrent !== 'function' ||
                  typeof approval.bindSigner !== 'function'
                )
                  return Promise.reject(
                    new KeyringRuntimeError('INVALID_INPUT')
                  );
                const params =
                  input.request?.method === 'personal_sign'
                    ? [input.request.message, input.request.address]
                    : [input.request?.address, input.request?.typedData];
                const request = readDappMessageRequest(
                  input.request?.method,
                  params,
                  selected.address
                );
                if (
                  !request ||
                  (request.method !== 'personal_sign' &&
                    (input.request.method === 'personal_sign' ||
                      request.version !== input.request.version))
                )
                  return Promise.reject(
                    new KeyringRuntimeError('INVALID_INPUT')
                  );
                const ring = keyring,
                  captured = generation;
                const account = state.accounts[selected.type][selected.index];
                const network = getNativeNetwork(
                  snapshot.active.networkId,
                  snapshot.networks
                );
                const isCurrent = () =>
                  !closed &&
                  generation === captured &&
                  keyring === ring &&
                  ring.isUnlocked() &&
                  catalogueSnapshot === snapshot &&
                  state.activeAccount.id === selected.index &&
                  state.activeAccount.type === selected.type &&
                  state.accounts[selected.type][selected.index] === account &&
                  account?.address === selected.address &&
                  state.activeNetwork.kind === sdk.INetworkType.Ethereum &&
                  state.activeNetwork.chainId === Number(network.chainId) &&
                  state.activeNetwork.url === network.rpcUrl;
                approval.bindSigner('native-software-message', isCurrent);
                return run(async (ownerGeneration) => {
                  const guard = () => {
                    current(ownerGeneration);
                    assertOwner();
                    checkGuard(approval.assertCurrent);
                    if (!isCurrent())
                      throw new KeyringRuntimeError('CANCELLED');
                  };
                  guard();
                  if (selected.type === 'SmartAccount') {
                    if (
                      !account?.smartAccount ||
                      account.smartAccount.chainId !== Number(network.chainId)
                    )
                      throw new KeyringRuntimeError('INVALID_INPUT');
                    requireSmartAccountAddressIdentity(
                      account,
                      Number(network.chainId)
                    );
                    const prepared = prepareSmartAccountMessage({
                      accountAddress: account.address,
                      chainId: Number(network.chainId),
                      request,
                    });
                    const rpc = new EvmTransferReadRpc(network, {
                      fetch: dependencies.connectionFetch ?? walletFetch,
                    });
                    const provider = createNativeSmartAccountProvider(
                      network,
                      rpc,
                      approval.signal,
                      guard
                    );
                    const metadata = await readSmartAccountValidatorMetadata({
                      account: account as IKeyringAccountState & {
                        smartAccount: NonNullable<
                          IKeyringAccountState['smartAccount']
                        >;
                      },
                      chainId: Number(network.chainId),
                      provider,
                      assertCurrent: guard,
                    });
                    guard();
                    const validator = metadata.auth?.validator;
                    if (!validator)
                      throw new KeyringRuntimeError('INVALID_INPUT');
                    const { owners } = getSmartAccountLocalEcdsaOwners(
                      metadata,
                      findLocalEcdsaOwner
                    );
                    for (const { address, owner } of owners) {
                      const record = state.accounts[owner.type][owner.id];
                      if (!record)
                        throw new KeyringRuntimeError('INVALID_INPUT');
                      approval.bindSigner(
                        `native-smart-message:${owner.type}:${owner.id}`,
                        () =>
                          state.accounts[owner.type][owner.id] === record &&
                          record.address.toLowerCase() === address.toLowerCase()
                      );
                    }
                    guard();
                    const signature = await signSmartAccountEcdsaOperation({
                      metadata,
                      actionHash: prepared.actionHash,
                      findOwner: findLocalEcdsaOwner,
                      assertCurrent: guard,
                      async signOwner(address, digest, owner) {
                        guard();
                        const signature =
                          await ring.ethereumTransaction.ethSign(
                            [address, digest],
                            {
                              selectedAccount: {
                                id: selected.index,
                                type: selected.type,
                                expectedAddress: selected.address,
                              },
                              targetAccount: {
                                id: owner.id,
                                type: owner.type,
                                expectedAddress: address,
                              },
                              assertCurrent: guard,
                            }
                          );
                        guard();
                        if (
                          typeof signature !== 'string' ||
                          !/^0x[0-9a-f]{130}$/i.test(signature)
                        )
                          throw new KeyringRuntimeError('OPERATION_FAILED');
                        return signature;
                      },
                    });
                    guard();
                    return encodeSmartAccountMessageSignature(prepared, {
                      validator,
                      signature,
                    });
                  }
                  const transactions = ring.ethereumTransaction;
                  const args =
                    request.method === 'personal_sign'
                      ? [[request.address, request.message]]
                      : [request.address, request.typedData, request.version];
                  if (!matchesDappMessageRequest(request, args))
                    throw new KeyringRuntimeError('INVALID_INPUT');
                  const signature =
                    request.method === 'personal_sign'
                      ? await transactions.signPersonalMessage([
                          request.address,
                          request.message,
                        ])
                      : await transactions.signTypedData(
                          request.address,
                          request.typedData as Parameters<
                            typeof transactions.signTypedData
                          >[1],
                          request.version as Parameters<
                            typeof transactions.signTypedData
                          >[2]
                        );
                  guard();
                  if (
                    typeof signature !== 'string' ||
                    !/^0x[0-9a-f]{130}$/i.test(signature)
                  )
                    throw new KeyringRuntimeError('OPERATION_FAILED');
                  return signature;
                });
              },
              context() {
                assertOwner();
                if (connectionNetworkId === null || connectionNetwork === null)
                  throw new KeyringRuntimeError('NOT_READY');
                const snapshot = catalogueSnapshot;
                const unlocked = keyring.isUnlocked() && snapshot !== null;
                const accounts = unlocked
                  ? snapshot.accounts.flatMap((account) => {
                      if (account.type === 'Ledger') return [];
                      const type = account.type;
                      const source =
                        state.accounts[account.type][account.index];
                      if (
                        !source ||
                        source.address !== account.address ||
                        typeof source.xpub !== 'string' ||
                        !source.xpub
                      )
                        throw new KeyringRuntimeError('CANCELLED');
                      return [
                        Object.freeze({
                          id: account.id,
                          index: account.index,
                          type,
                          address: account.address,
                          xpub: source.xpub,
                          label: account.label,
                        }),
                      ];
                    })
                  : [];
                return Object.freeze({
                  network: connectionNetwork,
                  networkId: connectionNetworkId,
                  networkLabel: connectionNetwork.label,
                  activeAccountId:
                    unlocked &&
                    accounts.some(
                      (account) => account.id === snapshot.active.accountId
                    )
                      ? snapshot.active.accountId
                      : null,
                  accounts: Object.freeze(accounts),
                  unlocked,
                });
              },
            });
          },
          resetActivity(assertOwner, invalidateViews) {
            if (closed || reserved || !canSign()) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
            checkGuard(assertOwner);
            const snapshot = catalogueSnapshot!, ring = keyring;
            const selected = selectedAccount();
            const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            const prior = [active, ...pendingSubmissions];
            const reservation = {};
            reserved = reservation;
            const captured = revokeGeneration();
            const guard = () => {
              current(captured); checkGuard(assertOwner);
              if (reserved !== reservation || keyring !== ring || !ring.isUnlocked() ||
                  catalogueSnapshot !== snapshot || selectedAccount() !== selected)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const task = Promise.resolve().then(async () => {
              guard();
              await Promise.allSettled(prior);
              guard();
              const fingerprint = await dataBinding(captured, guard); guard();
              const profileId = await ring.getPrivateRecordProfileId(); guard();
              const session = signedRecords.captureSession({ keyring: ring, assertCurrent: guard });
              await signedRecords.clearScope(session, { profileId, chainId: network.chainId, from: selected.address });
              guard();
              await activityHistory.clearScope(createActivityScope(fingerprint, selected.id, selected.address, network), guard);
              guard();
            }).catch(async (error: unknown) => {
              if (requiresReopen()) {
                try { await lock(); } catch { /* The storage owner remains quarantined. */ }
                throw new KeyringRuntimeError('CLEANUP_FAILED');
              }
              throw error;
            }).finally(() => {
              if (reserved === reservation) reserved = null;
              pendingSubmissions.delete(task);
            });
            pendingSubmissions.add(task);
            try { checkGuard(invalidateViews); }
            catch (error) { revokeGeneration(); return task.then(() => { throw error; }); }
            return task;
          },
          ...(storage.notes && storage.recovery ? { openNoteBackup, openNoteCapacity, readNoteInventory,
            ...(dependencies.openPrivacyPool ? { openNoteImport, openPrivateDeposit } : {}) } : {}),
          ...(storage.sentryKeys && typeof dependencies.deriveSentryPublicKey === 'function'
            ? { getSentryKeyNetwork, openSentryKeyManagement } : {}),
          ...(storage.removal && storage.recovery ? { authorizeWalletRemoval } : {}),
          accounts,
          security: {
            reauthenticateIdlePolicy: (password, assertCurrent) => run(async (captured) => {
              current(captured); checkGuard(assertCurrent);
              if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
              if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              current(captured); checkGuard(assertCurrent);
              await hydrate(captured); current(captured); checkGuard(assertCurrent);
            }),
          },
          ...(deviceUnlock && dependencies.deviceUnlock ? { deviceUnlock: {
            async status() {
              const captured = generation;
              current(captured);
              const available = await dependencies.deviceUnlock!.credentials.available();
              current(captured);
              const reference = await storage.deviceUnlockEnrollment!.read();
              current(captured);
              return Object.freeze({ available, enabled: !!reference?.enrollmentId });
            },
            enroll: (password: string, assertCurrent: () => void) => run(async (captured) => {
              const ring = keyring, controls = deviceControls.get(ring), identity = verifiedIdentity;
              const check = () => { current(captured); checkGuard(assertCurrent); if (keyring !== ring) throw new KeyringRuntimeError('CANCELLED'); };
              check();
              if (!controls || !identity || !ring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
              const authenticated = await deviceUnlock.issue((guard) => authenticate(password, captured,
                { identity, assertCurrent: check }, async () => ({ canLogin: await controls.issue(password, guard) })), check);
              check();
              return { authenticated };
            }),
            disable: (password: string, assertCurrent: () => void) => run(async (captured) => {
              const identity = verifiedIdentity;
              const check = () => { current(captured); checkGuard(assertCurrent); };
              check();
              if (!identity || !keyring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
              const authenticated = await authenticate(password, captured, { identity, assertCurrent: check });
              check();
              if (authenticated) { await deviceUnlock.disable(check); check(); }
              return { authenticated };
            }),
            unlock: (assertCurrent: () => void) => run(async (captured) => {
              const ring = keyring, controls = deviceControls.get(ring);
              const check = () => { current(captured); checkGuard(assertCurrent); if (keyring !== ring) throw new KeyringRuntimeError('CANCELLED'); };
              check();
              if (!controls || ring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
              await storage.authGuard.checkAllowed(); check();
              const identity = await readIdentity(); check();
              const records = recoveryVerificationRecords(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), identity.walletBindingId);
              check(); Object.assign(state, stateFor(records));
              const authenticated = await deviceUnlock.resume(controls.resume, check, () => ring.lockWallet());
              check();
              if (authenticated) {
                if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
                check(); await storage.authGuard.recordSuccess(); check();
                authenticatedPair = identity.pairFingerprint; verifiedIdentity = null;
                await hydrate(captured); check();
              }
              return { authenticated };
            }),
          } } : {}),
          imports,
          networks,
          tokens: {
            load: async (guard) => {
              // Connection replay may retire a read while its storage call is draining.
              // Wait for that reservation, then validate the new caller before reading.
              while (active) { await active.catch(() => undefined); checkGuard(guard); }
              return tokenOperation(guard, (scope, check) => tokens.load(scope, check));
            },
            add: (revision, metadata, guard) => tokenOperation(guard,
              (scope, check) => tokens.add(scope, revision, metadata, check), 'registry-write'),
            remove: (revision, contract, guard) => tokenOperation(guard,
              (scope, check) => tokens.remove(scope, revision, contract, check), 'registry-write'),
            async addCollectible(revision, collectible, guard) {
              const target = snapshotSavedCollectible(collectible);
              return tokenOperation(guard,
                (scope, check) => tokens.addCollectible(scope, revision, target, check), 'registry-write');
            },
            async removeCollectible(revision, collectible, guard) {
              const target = snapshotSavedCollectible(collectible);
              return tokenOperation(guard,
                (scope, check) => tokens.removeCollectible(scope, revision, target, check), 'registry-write');
            },
          },
          catalogue: { getSnapshot: () => closed || requiresReopen() || !keyring.isUnlocked() ? null : catalogueSnapshot },
          keyExport: {
            readSelected: (input, password, assertCurrent) => {
              if (closed || requiresReopen()) return run(async () => { throw new KeyringRuntimeError('NOT_READY'); });
              if (!catalogueSnapshot) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let scope;
              try {
                scope = snapshotHdKeyExportScope(input, catalogueSnapshot.utxoNetworks);
                if (typeof assertCurrent !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
                const ring = keyring;
                const utxo = catalogueSnapshot && findUtxoNetwork(scope.networkId, catalogueSnapshot.utxoNetworks);
                const sdkNetwork = utxo && getUtxoSdkNetwork(utxo);
                const type = parseNativeAccountId(scope.accountId).type;
                const xpub = state.accounts[type][scope.index]?.xpub;
                const extended = type === 'HDAccount' || (xpub !== undefined && xpub !== scope.address);
                const script = utxo && !extended && findWifAddressType(scope.address, utxo);
                const check = () => {
                  current(captured); checkGuard(assertCurrent);
                  current(captured);
                  const catalogue = catalogueSnapshot;
                  const selected = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId);
                  if (ring !== keyring || !ring.isUnlocked() || !catalogue || !selected) throw new KeyringRuntimeError('NOT_READY');
                  if (catalogue.revision !== scope.catalogueRevision || selected.type !== type ||
                      selected.slip44 !== (utxo?.slip44 ?? 60) || selected.id !== scope.accountId || selected.index !== scope.index ||
                      selected.address !== scope.address || catalogue.active.networkId !== scope.networkId ||
                      keyExportRegistrationHash(catalogue.active.networkId, catalogue) !== scope.registrationHash ||
                      state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type)
                    throw new KeyringRuntimeError('CANCELLED');
                  if (utxo && sdkNetwork) {
                    const actual = state.activeNetwork, account = state.accounts[type][selected.index];
                    if (!account || account.id !== selected.index || account.address !== selected.address || account.xpub !== xpub ||
                        actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId ||
                        actual.slip44 !== sdkNetwork.slip44 || actual.currency !== sdkNetwork.currency ||
                        actual.utxoBackendChain !== sdkNetwork.utxoBackendChain || actual.url !== sdkNetwork.url)
                      throw new KeyringRuntimeError('CANCELLED');
                    if (type === 'HDAccount') checkedAccount(account, selected.index, utxo.id, catalogue.utxoNetworks);
                  }
                };
                check();
                if (type !== 'HDAccount' && type !== 'Imported') throw new KeyringRuntimeError('INVALID_INPUT');
                if (utxo && type === 'Imported') {
                  if (!extended && !script) throw new KeyringRuntimeError('CANCELLED');
                  checkedUtxoImport(state.accounts.Imported[scope.index]!, utxo, extended ? 'account' : 'address');
                }
                const stored = await storage.readState(); check();
                if (stored.presence !== 'existing' || stored.backup !== 'confirmed') throw new KeyringRuntimeError('NOT_READY');
                if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                check();
                await hydrate(captured); check();
                // The SDK selector is fixed here; no account type or alternate index comes from a screen.
                const privateKey = await ring.getPrivateKeyByAccountId(scope.index, type === 'HDAccount' ? sdk.KeyringAccountType.HDAccount : sdk.KeyringAccountType.Imported, password);
                check();
                if (utxo && sdkNetwork) {
                  if (extended) {
                    if (!isUtxoAccountPrivateKey(privateKey, utxo.testnet)) throw new KeyringRuntimeError('OPERATION_FAILED');
                    const result = ring.validateZprv(privateKey, sdkNetwork);
                    if (!result.isValid || !result.node || result.node.neutered().toBase58() !== xpub)
                      throw new KeyringRuntimeError('OPERATION_FAILED');
                    check();
                    return privateKey;
                  }
                  if (!script || !isUtxoWifText(privateKey)) throw new KeyringRuntimeError('OPERATION_FAILED');
                  const { ECPair, payments } = syscoinUtils.bitcoinjs;
                  const network = utxo.addressNetwork;
                  const pair = ECPair.fromWIF(privateKey, network);
                  const pubkey = pair.publicKey;
                  if (script !== 'p2pkh' && !pair.compressed) throw new KeyringRuntimeError('OPERATION_FAILED');
                  const payment = script === 'p2tr' ? payments.p2tr({ internalPubkey: pubkey.slice(1), network })
                    : payments[script]({ pubkey, network });
                  if (payment.address !== scope.address) throw new KeyringRuntimeError('OPERATION_FAILED');
                  check();
                  return privateKey;
                }
                if (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey) ||
                    BigInt(privateKey) === 0n || BigInt(privateKey) >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n ||
                    computeAddress(privateKey) !== scope.address) throw new KeyringRuntimeError('OPERATION_FAILED');
                check();
                return privateKey.toLowerCase();
              });
            },
          },
          session: {
            createWallet: (password) => run(async (captured) => {
              validPassword(password, true);
              current(captured);
              const phrase = keyring.createNewSeed(12);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              await createStoredWallet(phrase, password, captured);
            }),
            importWallet: (phrase, password) => run(async (captured) => {
              validPassword(password, true);
              if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096) throw new KeyringRuntimeError('INVALID_INPUT');
              const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
              if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) throw new KeyringRuntimeError('INVALID_INPUT');
              current(captured);
              await createStoredWallet(normalized, password, captured);
            }),
            unlock: (password) => run(async (captured) => {
              const authenticated = await authenticate(password, captured);
              if (authenticated) await hydrate(captured);
              return { authenticated };
            }),
            async readSelectedAddress() {
              if (closed || requiresReopen() || !keyring.isUnlocked()) throw new Error('NOT_READY');
              const selected = selectedAccount();
              return normalizePublicAddress(selected.address, catalogueSnapshot!.active.networkId, catalogueSnapshot!.utxoNetworks);
            },
            lock,
          },
          async withUtxoActivityRead(expected, signal, assertOwner, assertView, read) {
            const captured = generation, ring = keyring, snapshot = catalogueSnapshot;
            const { accountId, networkId, address } = expected;
            const network = snapshot && findUtxoNetwork(networkId, snapshot.utxoNetworks);
            if (!network || snapshot.active.networkId !== networkId || snapshot.active.accountId !== accountId)
              throw new KeyringRuntimeError('NOT_READY');
            const selected = selectedAccount(), account = state.accounts[selected.type][selected.index]!;
            const identifier = account.xpub;
            const assertScope = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              if (ring !== keyring || snapshot !== catalogueSnapshot || selectedAccount() !== selected ||
                  state.accounts[selected.type][selected.index] !== account || account.xpub !== identifier || selected.address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const check = () => {
              assertScope(); checkGuard(assertView);
              if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            await dataBinding(captured, check);
            const parsed = parseUtxoPublicIdentifier(identifier, network);
            if (parsed.identifier !== identifier || parsed.address !== address ||
                (selected.type === 'HDAccount' && parsed.kind !== 'account'))
              throw new KeyringRuntimeError('CANCELLED');
            check();
            const result = await read(Object.freeze({ context: expected, identifier: parsed.identifier,
              isAccount: parsed.kind === 'account', registration: network, assertCurrent: assertScope }), signal, check);
            await dataBinding(captured, check);
            return result;
          },
          ...(dependencies.readUtxoAccount ? { async readUtxoBalance(id: UtxoNetworkId, address: string, external: AbortSignal) {
            const captured = generation, snapshot = catalogueSnapshot;
            const network = snapshot && findUtxoNetwork(id, snapshot.utxoNetworks);
            if (!network) throw new KeyringRuntimeError('NOT_READY');
            const controller = new AbortController();
            const abort = () => controller.abort();
            const guard = () => {
              current(captured);
              if (controller.signal.aborted || external.aborted ||
                  catalogueSnapshot !== snapshot || snapshot.active.networkId !== id || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            guard();
            const previous = pendingBalance;
            pendingBalance = controller;
            external.addEventListener('abort', abort, { once: true });
            previous?.abort();
            try {
              await dataBinding(captured, guard); guard();
              const { type, index } = selectedAccount();
              const xpub = state.accounts[type][index]!.xpub;
              const result = await (xpub === address
                ? dependencies.readUtxoBalance?.(network, address, controller.signal, guard)
                : dependencies.readUtxoAccount!(network, xpub, controller.signal, guard));
              if (!result) throw new KeyringRuntimeError('NOT_READY');
              guard();
              return result;
            } finally {
              external.removeEventListener('abort', abort);
              if (pendingBalance === controller) pendingBalance = null;
              controller.abort();
            }
          } } : {}),
          ...(dependencies.utxoFetch && utxoRecords ? { async openUtxoSend(assertOwner: () => void) {
            const captured = generation, ring = keyring, snapshot = catalogueSnapshot;
            const selected = selectedAccount(), network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            if (!network || selected.type === 'SmartAccount' || !supportsUtxoSoftwareCustody(network)) throw new KeyringRuntimeError('NOT_READY');
            const sdkNetwork = getUtxoSdkNetwork(network), account = state.accounts[selected.type][selected.index]!;
            const { xpub } = account;
            if (selected.type === 'Imported') checkedUtxoImport(account, network);
            const guard = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              const actual = state.activeNetwork, live = state.accounts[selected.type][selected.index];
              if (ring !== keyring || !ring.isUnlocked() || catalogueSnapshot !== snapshot ||
                  live !== account || live.xpub !== xpub || live.address !== selected.address ||
                  state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type ||
                  actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId ||
                  actual.slip44 !== sdkNetwork.slip44 || actual.currency !== sdkNetwork.currency ||
                  actual.utxoBackendChain !== sdkNetwork.utxoBackendChain || actual.url !== sdkNetwork.url)
                throw new KeyringRuntimeError('CANCELLED');
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
            };
            guard(); await dataBinding(captured, guard); guard();
            const profileId = await ring.getPrivateRecordProfileId(); guard();
            utxoSend?.cancel();
            const { createNativeUtxoSend } = await import('./utxoSend.ts'); guard();
            if (selected.type !== 'HDAccount' && selected.type !== 'Imported' && selected.type !== 'Ledger') throw new KeyringRuntimeError('NOT_READY');
            const opened = createNativeUtxoSend(network, {
              profileId,
              account: { address: selected.address, id: selected.index, type: selected.type, xpub },
              network: { kind: 'syscoin', currency: sdkNetwork.currency, chainId: sdkNetwork.chainId,
                genesisHash: network.genesisHash, slip44: sdkNetwork.slip44, url: sdkNetwork.url },
            }, { keyring: ring, assertCurrent: guard }, ring.syscoinTransaction, utxoRecords, dependencies.utxoFetch!, ring.getAddress);
            utxoSend = opened;
            return Object.freeze<NativeUtxoSend>({ ...opened, async confirm(view) {
              const pending = opened.confirm(view);
              pendingSubmissions.add(pending);
              try { return await pending; }
              finally {
                pendingSubmissions.delete(pending);
                if (utxoRecords.requiresReopen) void lock().catch(() => undefined);
              }
            } });
          } } : {}),
          activity: {
            async load(assertCurrent) {
              const { scope, guard, index, type } = await activityContext(assertCurrent);
              const journal = createNativeSignedRecordView(signedRecords,{keyring,assertCurrent:guard},scope.walletFingerprint,{index,type,address:scope.address},scope.network);
              const recent = await journal.activities(); guard();
              const saved = await activityHistory.load(scope, guard); guard();
              const locals = type === 'SmartAccount' ? recent.records.map(local => {
                const archived = saved.archived.find(record => record.hash === local.hash &&
                  record.recipient === local.recipient && record.amountUnits === local.amountUnits &&
                  record.maximumFeeUnits === local.maximumFeeUnits && record.nonce === local.nonce &&
                  record.createdAt === local.createdAt);
                return archived ? { ...local, phase: archived.phase } : local;
              }) : recent.records;
              const inventory = await tokens.load({ walletFingerprint: scope.walletFingerprint, accountId: scope.accountId,
                address: scope.address, network: scope.network.id, chainId: scope.network.chainId,
                registrationHash: scope.network.registrationHash }, guard); guard();
              return { scope, locals, assets: inventory.items,
                saved: { ...saved, archived: type === 'SmartAccount'
                  ? saved.archived.map(record => ({ ...record, inspectionOnly: true as const })) : saved.archived,
                  truncated: saved.truncated || recent.truncated } };
            },
            async loadSavedPending(previousScope, beforeHash, assertCurrent) {
              const { scope, guard, index, type } = await checkActivityContext(previousScope, assertCurrent);
              const journal = createNativeSignedRecordView(signedRecords, { keyring, assertCurrent: guard }, scope.walletFingerprint,
                { index, type, address: scope.address }, scope.network);
              const page = await journal.pendingActivities(beforeHash); guard();
              if (type !== 'SmartAccount') return page;
              const saved = await activityHistory.load(scope, guard); guard();
              return { ...page, records: page.records.filter(local => !saved.archived.some(record => record.hash === local.hash && record.phase !== 'submitted')) };
            },
            async observeLocal(local, assertCurrent, signal) {
              const { hash, chainId, address, walletFingerprint } = local;
              const { scope, guard, type } = await activityContext(assertCurrent);
              if (chainId !== scope.network.chainId || address !== scope.address || walletFingerprint !== scope.walletFingerprint || local.accountId !== scope.accountId)
                throw new KeyringRuntimeError('CANCELLED');
              if (type === 'SmartAccount') {
                const transfer = await signedRecords.readSmartAccountActivityExact({ keyring, assertCurrent: guard }, chainId, address, hash);
                guard();
                const saved = transfer ? null : await activityHistory.load(scope, guard);
                guard();
                const record = transfer ? {
                  walletFingerprint, accountId: scope.accountId, address, networkId: scope.network.id,
                  registrationHash: scope.network.registrationHash, chainId, hash,
                  nonce: transfer.entry.nonce, createdAt: transfer.entry.createdAt,
                  recipient: transfer.recipient, amountUnits: transfer.amountUnits, maximumFeeUnits: transfer.maximumAccountCharge,
                  ...(transfer.token ? { token: transfer.token } : {}),
                  ...(transfer.collectibleTransfer ? { collectibleTransfer: transfer.collectibleTransfer } : {}),
    ...(transfer.contractInteraction ? { contractInteraction: true as const } : {}),
                  smartAccount: { payer: normalizePublicAddress(transfer.entry.from, scope.network.id), operationHash: transfer.operationHash, operationNonce: transfer.operationNonce },
                } : saved?.archived.find(item => item.hash === hash);
                if (!record?.smartAccount) throw new KeyringRuntimeError('NOT_READY');
                const rpc = new EvmTransferReadRpc(scope.network, { fetch: dependencies.connectionFetch ?? walletFetch });
                const observation = await observeSmartAccountActivity({ chainId, hash, account: address, nonce: record.nonce, ...record.smartAccount },
                  (method, params) => rpc.retirementRead(method, params, signal, guard), guard);
                guard();
                const phase = getObservedEvmTerminalPhase(observation, record.nonce);
                const observed = phase ? { ...record, phase }
                  : { ...record, smartAccount: record.smartAccount, phase: 'submitted' as const };
                await activityHistory.recordObservation(observed, guard);
                guard();
                return observation;
              }
              if (!dependencies.observeActivity) throw new KeyringRuntimeError('NOT_READY');
              const observe = dependencies.observeActivity;
              try {
                const result = await observeRetainedEvmTransaction(signedRecords, { keyring, assertCurrent: guard },
                  scope.network.chainId, scope.address, hash,
                  expected => observe(scope.network, expected, signal, guard), guard);
                guard(); return result.observation;
              } catch (error) {
                if (signedRecords.requiresReopen) {
                  try { await lock(); } catch { /* The poisoned storage owner must reopen. */ }
                  throw new KeyringRuntimeError('CLEANUP_FAILED');
                }
                throw error;
              }
            },
            async saveCache(scope, candidates, assertCurrent) {
              const { scope: checkedScope, guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveCache(checkedScope, candidates, guard);
            },
            async saveView(scope, view, assertCurrent) {
              const { scope: checkedScope, guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveView(checkedScope, view, guard);
            },
          },
          transfers: {
            async replacementOriginal(hash, mode, assertCurrent, signal) {
              if (active || reserved || closed || !canSign()) return null;
              const captured = generation, selected = selectedAccount();
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
              const check = () => { current(captured); checkGuard(assertCurrent); };
              const session = { keyring, assertCurrent: check };
              const load = () => signedRecords.readReplacement(session, network.chainId, selected.address, hash, mode);
              let retained = await load();
              check();
              if (!retained) return null;
              if (!retained.binding) {
                const observe = dependencies.observeActivity;
                if (!observe) return null;
                try {
                  const result = await observeRetainedEvmTransaction(
                    signedRecords, session, network.chainId, selected.address, hash,
                    (expected) => observe(network, expected, signal, check), check
                  );
                  if (result.terminalPhase) return null;
                  retained = await load();
                  check();
                  if (!retained) return null;
                } catch (error) {
                  if (signedRecords.requiresReopen) throw new TransferJournalError('REOPEN_REQUIRED');
                  check();
                  if (signal.aborted) throw error;
                  return null;
                }
              }
              const { original, binding, rates } = retained;
              if (!binding) return null;
              const intent = mode === 'speed-up' && original.metadata?.intent !== undefined
                ? snapshotErc20TransferIntent(original.metadata.intent) : undefined;
              return Object.freeze({ rawTransaction: original.rawTransaction, binding, rates, ...(intent ? { intent } : {}) });
            },
            replay(assertCurrent, transport, options) {
              if (active || reserved || closed || !canSign()) throw new KeyringRuntimeError('NOT_READY');
              const captured = generation,
                selected = selectedAccount();
              const network = getNativeNetwork(
                catalogueSnapshot!.active.networkId,
                catalogueSnapshot!.networks
              );
              const context: EvmSubmissionContext = {
                account: { id: selected.index, type: selected.type, address: selected.address },
                network: {
                  kind: 'ethereum',
                  chainId: Number(network.chainId),
                  slip44: 60,
                  url: network.rpcUrl,
                },
                operation: 'send',
              };
              const check = () => {
                current(captured);
                checkGuard(assertCurrent);
                const live = selectedAccount();
                const currentNetwork = getNativeNetwork(
                  catalogueSnapshot!.active.networkId,
                  catalogueSnapshot!.networks
                );
                if (
                  live !== selected ||
                  currentNetwork.chainId !== network.chainId ||
                  currentNetwork.rpcUrl !== network.rpcUrl
                )
                  throw new KeyringRuntimeError('CANCELLED');
              };
              type PrivateReplayOwner = {
                lifetime: AbortController;
                pool?: Awaited<ReturnType<typeof openOwnedPrivatePool>>;
              };
              let privateOwner: PrivateReplayOwner | undefined;
              let reviewedId: string | undefined;
              const closePrivatePool = async (owner: PrivateReplayOwner | undefined) => {
                try {
                  owner?.lifetime.abort();
                  await owner?.pool?.dispose();
                } finally { await finalizePrivateDomain(); }
              };
              const authorizePrivate = async (
                input:
                  | { kind: 'deposit'; attempt: IPrivacyDepositAttempt }
                  | {
                      kind: 'withdrawal';
                      attempt: Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>;
                    },
              ) => {
                const owner = privateOwner;
                if (!owner) throw new KeyringRuntimeError('CANCELLED');
                const checkPool = () => {
                  check();
                  if (privateOwner !== owner || owner.lifetime.signal.aborted)
                    throw new KeyringRuntimeError('CANCELLED');
                };
                if (!noteBackups) await openNotes(checkPool, () => undefined);
                checkPool();
                const openPool = dependencies.openPrivacyPool;
                if (!openPool) throw new KeyringRuntimeError('NOT_READY');
                if (owner.pool && owner.pool.poolId !== input.attempt.poolId)
                  throw new KeyringRuntimeError('CANCELLED');
                owner.pool ??= await openOwnedPrivatePool(
                  input.attempt.poolId,
                  (id, signal) => openPool(network, id, signal, checkPool),
                  owner.lifetime.signal,
                  checkPool,
                );
                checkPool();
                let lease: Awaited<ReturnType<NoteRuntime['authorizeDepositReplay']>>;
                try {
                  const session = privateDomainWalletSession(captured);
                  lease =
                    input.kind === 'deposit'
                      ? await noteBackups!.authorizeDepositReplay(
                          session,
                          input.attempt,
                          owner.pool.readNote,
                        )
                      : await noteBackups!.authorizeWithdrawalReplay(
                          session,
                          input.attempt,
                          owner.pool.readNote,
                        );
                } catch (error) {
                  try {
                    await closePrivatePool(owner);
                  } catch {
                    /* Preserve the authorization failure. */
                  }
                  throw error;
                }
                checkPool();
                return Object.freeze({
                  assertCurrent: lease.assertCurrent,
                  withAdmission: lease.withAdmission,
                  async onAcknowledged(hash: string) {
                    try {
                      await lease.onAcknowledged(hash);
                    } finally {
                      await closePrivatePool(owner);
                    }
                  },
                });
              };
              const replay = new EvmSignedReplay(
                signedRecords,
                () => ({
                  context,
                  recordSession: { keyring, assertCurrent: check },
                  assertCurrent: check,
                  ...transport,
                  authorizeReplay: (entry) => authorizePrivateNoteReplay(entry, check,
                    (attempt) => authorizePrivate({kind:'deposit',attempt}),
                    (attempt) => authorizePrivate({kind:'withdrawal',attempt})),
                }),
                options.now,
                options.randomBytes
              );
              return {
                async prepare(hash) {
                  replay.cancel();
                  reviewedId = undefined;
                  const previous = privateOwner;
                  const owner = { lifetime: new AbortController() };
                  privateOwner = owner;
                  await closePrivatePool(previous);
                  if (privateOwner !== owner) throw new KeyringRuntimeError('CANCELLED');
                  try {
                    const prepared = await replay.prepare(hash);
                    if (prepared.status === 'review') reviewedId = prepared.review.id;
                    return prepared;
                  } catch (error) {
                    if (privateOwner === owner) privateOwner = undefined;
                    await closePrivatePool(owner);
                    throw error;
                  }
                },
                cancel(id) {
                  const cancelled = replay.cancel(id);
                  if (cancelled) {
                    reviewedId = undefined;
                    const owner = privateOwner;
                    privateOwner = undefined;
                    void closePrivatePool(owner).catch(() => undefined);
                  }
                  return cancelled;
                },
                list: replay.list.bind(replay),
                confirm(id) {
                  if (id !== reviewedId) return replay.confirm(id);
                  reviewedId = undefined;
                  const owner = privateOwner;
                  const work = replay.confirm(id);
                  const pending = work.finally(async () => {
                    pendingSubmissions.delete(pending);
                    await closePrivatePool(owner);
                  });
                  pendingSubmissions.add(pending);
                  return pending;
                },
              };
            },
            async token(contractAddress, assertCurrent) {
              const contract = normalizeErc20Address(contractAddress);
              while (active) { await active.catch(() => undefined); checkGuard(assertCurrent); }
              return tokenOperation(assertCurrent, async (scope, check) => {
                const inventory = await tokens.load(scope, check);
                check();
                const token = inventory.items.find((item) => item.contractAddress === contract);
                if (!token) throw new KeyringRuntimeError('NOT_READY');
                return token;
              });
            },
            async collectible(input, assertCurrent) {
              let target: SavedCollectible;
              try { target = snapshotSavedCollectible(input); }
              catch { throw new KeyringRuntimeError('INVALID_INPUT'); }
              if (pendingSubmissions.size) throw new KeyringRuntimeError('BUSY');
              if (!canSign()) throw new KeyringRuntimeError('NOT_READY');
              return tokenOperation(assertCurrent, async (scope, check) => {
                const captured = generation;
                const catalogue = catalogueSnapshot;
                const signal = (contextReadLifetime ??= new AbortController()).signal;
                // This proof outlives the lookup. The invocation guard is
                // used only for I/O and returning the result below.
                const assertSavedCurrent = () => {
                  current(captured);
                  if (contextReadLifetime?.signal !== signal || signal.aborted ||
                      catalogueSnapshot !== catalogue || !keyring.isUnlocked())
                    throw new KeyringRuntimeError('CANCELLED');
                };
                const checkRead = () => { check(); assertSavedCurrent(); };
                const inventory = await tokens.load(scope, checkRead);
                checkRead();
                const collectible = inventory.collectibles?.find((item) =>
                  item.contractAddress === target.contractAddress &&
                  item.tokenStandard === target.tokenStandard &&
                  (item.tokenStandard === 'ERC-721' ||
                    (target.tokenStandard === 'ERC-1155' && item.tokenId === target.tokenId))
                );
                if (!collectible) throw new KeyringRuntimeError('NOT_READY');
                return Object.freeze({ collectible, assertCurrent: assertSavedCurrent, signal });
              });
            },
            async journal(assertCurrent) {
              if (closed || reserved || !keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              if (!canSign()) throw new KeyringRuntimeError('NOT_READY');
              const captured = generation;
              current(captured); checkGuard(assertCurrent);
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              const selected = selectedAccount();
              const fingerprint = await dataBinding(captured, assertCurrent);
              current(captured); checkGuard(assertCurrent);
              const address = normalizePublicAddress(selected.address, 'ethereum');
              void address;
              return signedView(captured,assertCurrent,fingerprint,selected);
            },
            evmSubmissionFailure: (error) => sdk.evmSubmissionFailure(error),
            submit: (rawTransaction, hash, assertCurrent, transport, inputIntent, inputApproval, replacement, verifyDispatch) => {
              if (active || reserved || closed) return Promise.reject(new KeyringRuntimeError('BUSY'));
              const { broadcast, verifyChain } = transport ?? {};
              if (typeof broadcast !== 'function' || typeof verifyChain !== 'function')
                return Promise.reject(new KeyringRuntimeError('INVALID_INPUT'));
              const captured = generation;
              let review: {
                context: EvmSubmissionContext;
                intent: NativeAssetTransferIntent | undefined;
                expectedUnsigned: string;
              };
              const check = () => {
                current(captured);
                checkGuard(assertCurrent);
                if (!keyring.isUnlocked() || !canSign())
                  throw new KeyringRuntimeError('NOT_READY');
              };
              try {
                check();
                const selected = selectedAccount();
                const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
                const intent = inputIntent === undefined ? undefined : snapshotNativeAssetTransferIntent(inputIntent);
                const approved = snapshotReviewedTransfer(inputApproval, intent, replacement);
                const expectedUnsigned = unsignedTransferBytes(approved);
                const context: EvmSubmissionContext = {
                  account: { id: selected.index, type: selected.type, address: selected.address },
                  network: { kind: 'ethereum', chainId: Number(network.chainId), slip44: 60, url: network.rpcUrl },
                  operation: replacement?.mode ?? (intent?.kind === 'nft-transfer'
                    ? intent.tokenStandard === 'ERC-721' ? 'erc721' : 'erc1155'
                    : intent ? 'erc20' : 'send'),
                  ...(replacement ? { originalHash: replacement.original.hash } : {}),
                };
                review = { context, intent, expectedUnsigned };
              } catch (error) {
                return Promise.reject(error);
              }
              const work = Promise.resolve().then(async () => {
                check();
                const { context, intent, expectedUnsigned } = review;
                const boundary = sdk.captureEvmSubmission(
                  context,
                  check,
                  () => captureSignedSubmission(context, check, intent?.kind === 'erc20-transfer' ? { intent } : undefined,
                    replacement?.binding, verifyDispatch)
                );
                const tx = Transaction.from(rawTransaction);
                if (tx.to === null || tx.hash !== hash)
                  throw new KeyringRuntimeError('INVALID_INPUT');
                assertTransferIntentEnvelope({
                  chainId: tx.chainId.toString(), from: tx.from ?? '', to: tx.to,
                  value: tx.value.toString(), data: tx.data,
                }, intent);
                try {
                  if (replacement?.mode === 'speed-up') {
                    const retained = await signedRecords.readExact({ keyring, assertCurrent: check }, tx.chainId.toString(), context.account.address, replacement.original.hash);
                    if (!retained) throw new NativeTransferError('EXPIRED');
                    const original = Transaction.from(retained.rawTransaction);
                    const savedIntent = retained.metadata?.intent === undefined ? undefined : snapshotErc20TransferIntent(retained.metadata.intent);
                    if (intent?.kind === 'nft-transfer' || !equalTransferIntent(savedIntent, intent) || original.accessList?.length || !tx.from || !tx.to)
                      throw new NativeTransferError('EXPIRED');
                    assertSpeedUpEnvelope({ ...replacement.original, from: original.from!, to: original.to,
                      valueUnits: original.value.toString(), data: original.data, nonce: original.nonce, type: original.type as 0 | 2 }, {
                      from: tx.from, to: tx.to, value: tx.value.toString(), data: tx.data, nonce: String(tx.nonce), type: tx.type!,
                    });
                  }
                  if (context.account.type === 'Ledger') {
                    await sdk.submitSignedHardwareEvmTransaction(rawTransaction, broadcast, boundary, undefined, expectedUnsigned,
                      async () => { check(); await verifyChain(); check(); });
                  } else {
                    await sdk.submitSignedEvmTransaction(rawTransaction, broadcast, boundary, undefined, expectedUnsigned);
                  }
                } catch (error) {
                  if (signedRecords.requiresReopen || (error && typeof error === 'object' && 'code' in error && error.code === 'STORAGE_REOPEN_REQUIRED'))
                    throw Object.assign(new TransferJournalError('REOPEN_REQUIRED'), { transactionNotBroadcast: true });
                  if (error instanceof Error && error.message === 'EVM_SIGNED_RECORD_ORIGINAL_CHANGED')
                    throw new NativeTransferError('EXPIRED');
                  throw error;
                }
              });
              const pending = work.finally(() => { pendingSubmissions.delete(pending); });
              pendingSubmissions.add(pending);
              return pending;
            },
            assertUnlocked: (assertCurrent) => {
              const captured = generation;
              current(captured); checkGuard(assertCurrent); current(captured);
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
              if (!keyring.isUnlocked() || !canSign()) throw new KeyringRuntimeError('NOT_READY');
            },
            sign: (transaction, authority, inputIntent, replacement) => {
              const assertCurrent = () => {
                if (authority.signal.aborted)
                  throw new KeyringRuntimeError('CANCELLED');
                checkGuard(authority.assertCurrent);
              };
              if (closed || !keyring.isUnlocked())
                return Promise.reject(new KeyringRuntimeError('CANCELLED'));
              if (!canSign())
                return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let intent;
              let prepared: typeof transaction;
              try {
                intent =
                  inputIntent === undefined
                    ? undefined
                    : snapshotNativeAssetTransferIntent(inputIntent);
                prepared = snapshotReviewedTransfer(
                  transaction,
                  intent,
                  replacement
                );
              } catch {
                return Promise.reject(new KeyringRuntimeError('INVALID_INPUT'));
              }
              return run(async (captured) => {
                if (!keyring.isUnlocked())
                  throw new KeyringRuntimeError('CANCELLED');
                checkGuard(assertCurrent);
                current(captured);
                checkGuard(assertCurrent);
                assertTransferIntentEnvelope(prepared, intent);
                const network = getNativeNetwork(
                  catalogueSnapshot!.active.networkId,
                  catalogueSnapshot!.networks
                );
                if (
                  !nativeSigningEnabled(
                    network.id,
                    catalogueSnapshot!.networks
                  ) ||
                  prepared.chainId !== network.chainId
                )
                  throw new KeyringRuntimeError('INVALID_INPUT');
                snapshotReviewedTransfer(prepared, intent, replacement);
                const selected = selectedAccount();
                if (
                  prepared.from.toLowerCase() !== selected.address.toLowerCase()
                )
                  throw new KeyringRuntimeError('INVALID_INPUT');
                if (selected.type === 'Ledger') {
                  if (!ledger.isConnected())
                    throw new KeyringRuntimeError('NOT_READY');
                  const signed = await sdk.signLedgerEvmTransaction(
                    keyring.ledgerSigner!,
                    {
                      accountIndex: selected.index,
                      expectedAddress: selected.address,
                      unsignedTransaction:
                        serializePreparedEvmTransaction(prepared),
                    },
                    {
                      signal: authority.signal,
                      assertCurrent: () => {
                        current(captured);
                        assertCurrent();
                      },
                    }
                  );
                  current(captured);
                  assertCurrent();
                  return signed;
                }
                if (
                  selected.type !== 'HDAccount' &&
                  selected.type !== 'Imported'
                )
                  throw new KeyringRuntimeError('NOT_READY');
                const signed = keyring.signPreparedEvmTransaction(
                  {
                    selectedAccount: { id: selected.index, type: selected.type, expectedAddress: selected.address },
                    account: {
                      id: selected.index,
                      type: selected.type,
                      expectedAddress: prepared.from,
                    },
                    network: {
                      kind: 'ethereum',
                      chainId: network.chainId,
                      slip44: 60,
                      url: network.rpcUrl,
                    },
                    transaction: prepared,
                  },
                  {
                    assertCurrent: () => {
                      current(captured);
                      checkGuard(assertCurrent);
                    },
                  }
                );
                current(captured);
                checkGuard(assertCurrent);
                return Object.freeze({
                  rawTransaction: signed.rawTransaction,
                  hash: signed.hash,
                });
              });
            },

          },
          storage: {
            readState: () => storage.readState(),
            retireForRecovery() {
              if (recoveryRetirement) return recoveryRetirement;
              if (closing) return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
              closeRuntime(true);
              return recoveryRetirement!;
            },
            retireForRemoval(remove) {
              if (closing) return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
              return closeRuntime(false, remove);
            },
            close: () => closeRuntime(false),
          },
          backup: {
            readPhrase: (password) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              await hydrate(captured); current(captured);
              const phrase = await keyring.getSeed(password);
              current(captured);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              return Object.freeze(phrase.split(' '));
            }),
            fingerprint: () => storage.getWalletFingerprint(),
            confirm: (fingerprint) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              current(captured);
              await storage.confirmBackup(fingerprint);
              current(captured);
            }),
          },
        };
      } catch {
        try { await storage.close(); } catch { /* the factory remains unavailable */ }
        throw new Error('UNAVAILABLE');
      }
    },
  };
}
