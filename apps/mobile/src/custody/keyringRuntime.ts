import type { PaliRecoveryTarget } from '../../../../source/utils/smartAccount/account.ts';
import { toP256WebAuthnRecoveryTarget } from '../../../../source/utils/passkey/identity.ts';
import { captureGuardianRecoveryClaim, type GuardianRecoveryReplacement } from '../../../../source/utils/smartAccount/guardianRecoveryClaim.ts';
import { createNativePasskeyRegistry } from '../smartAccount/passkeyRegistry.ts';
import { passkeyRegistrationToProfile } from '../../../../source/utils/passkey/registry.ts';
import { bytesToHex } from '../../../../source/utils/passkey/base64url.ts';
import type { IPasskeyCredentialProfile , ISmartAccountMetadata, SmartAccountValidatorModule, SmartAccountCustomModuleRecord } from '../../../../source/types/network.ts';
import type { NativePasskeyCapability } from '../smartAccount/passkeys.ts';
import { assertNativePrivateAuthentication, bindNativePrivateAuthenticationChild, nativePrivateAuthenticationScope, withNativePrivateAuthentication, type NativePrivateAuthentication } from './privateAuthentication.ts';
import { createNativeInfrastructure, getNativeInfrastructureContinuation, type NativeInfrastructureHandoffCapture } from './nativeInfrastructure.ts';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication.ts';
import { NativeCredentialAction } from './credentialAction.ts';
import type { NativeInfrastructureController } from '../smartAccount/infrastructure.ts';
import { getSmartAccountModulesProjection } from '../../../../source/shared/smartAccountModules.ts';
import { normalizeSmartAccountModuleRequest } from '../../../../source/shared/smartAccountModuleRequest.ts';
import { resolveSmartAccountPreparationTarget } from '../../../../source/shared/smartAccountPreparation.ts';
import type { NativeSmartCreationAllocation, NativeSmartCreationRequest } from '../smartAccount/preparation.ts';
import { buildNativeSmartModuleCommand, snapshotNativeSmartModuleDraft, assertNativeSmartModuleCommandApplied, type NativeSmartModuleDraft, type NativeSmartModuleDeploymentAdmission } from '../smartAccount/modules.ts';
import { preflightCustomValidatorInstall, type CustomValidatorPreflightResult } from '../../../../source/utils/smartAccount/custom.ts';
import { createNativePrivacyControls, type NativePrivacyControls, type NativePrivacyServiceSettingsPort } from '../privacy/privacyControls.ts';
import { createNativePrivacyLifecycle } from '../privacy/privacyLifecycle.ts';
import { createNativeNoteMaintenanceProofs } from './noteMaintenance.ts';
import type { NativeNoteMaintenanceRuntime , NativeNoteBackupRuntime, NativeNoteCapacityRuntime, NativeNoteInventory } from './noteBackupRuntime.ts';
import { NativeSigningHandoffs, captureNativeSigningContinuation, completeNativeSigningOwnerStep, retireNativeSigningHandoff, sameSigningResumeOwner, type NativeSigningHandoff, type LocalSigningResumeScope, type LocalSigningHandoffDescriptor, type LocalInfrastructureHandoffDescriptor, requireNativeSigningHandoff } from '../connections/signingHandoff.ts';
import { signNativeSmartTrezorOwner } from '../hardware/smartOwnerSigning.ts';
import { NativeOwnerProofReceipts, type NativeOwnerProofIdentity } from '../smartAccount/ownerProofReceipts.ts';
import { snapshotNativeSmartLocalAction } from '../smartAccount/localAction.ts';
import { signSmartAccountOwnerIntent, type SmartAccountOwnerSigningSdk } from '../../../../source/utils/smartAccount/ownerSigning.ts';
import { createSmartAccountRawSigningIntent } from '../../../../source/utils/smartAccount/ownerSigningIntent.ts';
import { getPaliErc7739PersonalSignHash } from '../../../../source/utils/smartAccount/erc7739.ts';
import { encodeSmartAccountAuthenticatorSignature } from '../../../../source/utils/smartAccount/signature.ts';
import { supportsDappEncryptionAccount } from '../../../../source/shared/dappEncryptionRequest.ts';
import { bindEoaCallsSignedLifecycle, captureEoaCallsSignedMetadata, readRetainedEoaCall, recoverRetainedEoaCallsAttempt, settleEoaCallsSignedSubmission } from '../../../../source/wallet/dappCallsBundles.ts';
import { sentrySettingsStorageKey } from '../../../../source/shared/sentrySettings.ts';
import { buildECDSAAuthenticator, buildP256WebAuthnAuthenticator, buildSLHDSAAuthenticator, type SmartAccountAuthenticatorBuildResult } from '../../../../source/utils/smartAccount/authenticators.ts';
import { getSLHDSAStateStorageKey } from '../../../../source/utils/slhDsa/constants.ts';
import { parseSLHDSAStateStorageKey } from '../../../../source/wallet/slhDsaState.ts';
import { assertSmartAccountValidatorSwitchApplied, buildSmartAccountValidatorSwitch } from '../../../../source/utils/smartAccount/validatorSwitch.ts';
import { NativePrivateWithdrawal } from './privateWithdrawal.ts';
import { createPrivacyWithdrawalsController, PRIVACY_WITHDRAWAL_GAS } from '../../../../source/wallet/privacyWithdrawals.ts';
import { capturePrivateWithdrawalAttempt, privateWithdrawalUnsignedBytes, readPrivateWithdrawalAttempt } from '../../../../source/utils/privacy/withdrawalMetadata.ts';
import type { IPrivacyWithdrawalsHost } from '../../../../source/utils/privacy/withdrawTypes.ts';
import type { EvmGasPolicy } from '../../../../source/shared/evmDappPreparation.ts';
import { openOwnedPrivatePool } from './ownedPrivatePool.ts';
import { NativePrivateDeposit, type NativePrivateDepositView } from './privateDeposit.ts';
import { createPrivacyTransactionsController } from '../../../../source/wallet/privacyTransactions.ts';
import { capturePrivateDepositAttempt, privateDepositUnsignedBytes, readPrivateDepositAttempt } from '../../../../source/utils/privacy/depositMetadata.ts';
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
import { guardianRecoveryIntentResolved, pendingGuardianRecoveryTransaction } from '../../../../source/utils/smartAccount/guardianRecoveryLifecycle.ts';
import {
  encodeCompositeValidatorInitData,
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
  NativeInfrastructurePending,
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
import type { SmartAccountLocalOwner } from '../../../../source/utils/smartAccount/signOperation.ts';
import type { NativeSmartOperationPorts } from '../smartAccount/runtime.ts';
import { signNativeSmartAccountActionHash, canSignNativeSmartAccountActionHash, getNativeSmartAccountSigningPlan, type NativeSmartAccountSigningOwner } from '../smartAccount/authenticatorSigning.ts';
import type { SmartAccountAuthenticatorPorts } from '../../../../source/utils/smartAccount/authenticatorDispatch.ts';
import type { SLHDSADispatchApproval } from '../../../../source/utils/slhDsa/types.ts';
import { SMART_ACCOUNT_EXECUTION_LIFETIME_MS, requireSmartAccountAuthenticator } from '../../../../source/utils/smartAccount/prepareOperation.ts';
import { createNativeSlhDsaRuntime, readNativeSlhPublicStates, type NativeSlhPublicStates, type NativeSlhDsaRuntime, type NativeSlhExecutionCapability, type NativeSlhInstalledKey } from '../smartAccount/slhDsaRuntime.ts';
import { SLH_DSA_PROFILE_STATE_DOMAIN } from '../../../../source/wallet/slhDsaStateCrypto.ts';
import { normalizeSLHDSAPublicKeyField } from '../../../../source/utils/slhDsa/hex.ts';
import { getInstalledValidatorModule, getInstalledValidatorModuleByAddress } from '../../../../source/utils/smartAccount/modules.ts';
import { isPaliSignableValidator, isPaliValidatorAlgorithmSupported } from '../../../../source/utils/smartAccount/validatorSignability.ts';
import { snapshotSmartAccountDappTransaction } from '../../../../source/shared/smartAccountDappTransaction.ts';
import { summarizeApproval, decodeApprovalData } from '../../../../source/shared/approval.ts';
import { decodeAssetTransfer } from '../../../../source/shared/assetTransfer.ts';
import type { NativeGuardianPolicyDraft, NativeSmartAccountAmount, NativeSmartAccountIntent, NativeSmartAccountOperation } from '../smartAccount/operation.ts';
import { guardianPolicyObservationIdentity, inspectGuardianRemovals, type GuardianRemovalInspection } from '../../../../source/wallet/guardianRemoval.ts';
import { loadNativeKeyringSdk, type NativeKeyringSdk } from './keyringSdk.ts';
import { createNativeLedgerHost } from '../hardware/ledgerHost.ts';
import type { NativeLedgerTransport, NativeLedgerOwner } from '../hardware/ownedLedgerTransport.ts';
import type { NativeLedgerRuntime } from './ledgerAccounts.ts';
import { snapshotNativeInfrastructureLocalAction } from './trezorAccounts.ts';
import type { NativeTrezorView, NativeTrezorResumeIntent, NativeTrezorSnapshot, NativeSmartLocalAction } from './trezorAccounts.ts';
import type { NativeTrezorSessions, NativeTrezorSession } from '../hardware/trezorSessions.ts';
import type { NativeTrezorHandoffOwner } from '../hardware/trezorHandoff.ts';
import type { TrezorHost } from '@sidhujag/sysweb3-keyring/cjs/trezor/host-types.js';
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
import type { NativeConnectionSigningHost } from '../connections/host.ts';
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
import { EvmSignedReplay, observeRetainedEvmTransaction, projectSavedEvmTransaction } from '../../../../source/wallet/evmSignedReplay.ts';
import { observeSmartAccountActivity } from '../../../../source/wallet/smartAccountActivity.ts';
import { getObservedEvmTerminalPhase } from '../../../../source/shared/evmTransactionObservation.ts';
import { assertNativeRecordDomains } from './recoveryInventory.ts';
import { captureInfrastructureCleanupStorage } from './infrastructureCleanup.ts';
import { captureNativePublicSessionRecord, createNativePublicSessionRecord, nativePublicSessionManifest, nativePublicSessionRestoreRequest, nativePublicSessionSlhStates, NATIVE_PUBLIC_SESSION_KEY, type NativePublicSessionRecord } from './publicSession.ts';
import { decodePublicSessionRecord } from '../storage/publicSessionRecordKey.ts';
import { decodeAccountRecord } from '../storage/accountRecordKey.ts';
import { createNativeAutomaticNoncePlanner, createNativeSignedRecordView } from './sharedSignedRecords.ts';
import type { EvmSubmissionContext } from '@sidhujag/sysweb3-keyring';
import { captureNativeCredentialReference, createNativeCredentialVault, settleNativeCredentialRemoval, type NativeCredentialPort, type NativeCredentialReference, type NativeCredentialPurpose } from './credentialVault.ts';
import { isHostWalletAuthentication } from '../../../../source/shared/walletAuthentication.ts';
import { snapshotRecordEncryption, snapshotRecordDecryption } from './recordCodecInput.ts';
import type { IKeyringAccountState, INetwork as SdkNetwork } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { canonicalUtxoEndpoint, findUtxoNetwork, getUtxoSdkNetwork, isCustomUtxoNetworkId, projectUtxoRegistration, supportsUtxoSoftwareCustody, UTXO_NETWORKS, utxoRegistrationData, type UtxoNetwork, type UtxoNetworkId } from '../core/utxoNetworks.ts';
import { exactUtxoResponseFetch, verifySavedUtxoEndpoint, verifyUtxoRegistration } from '../core/utxoReadSession.ts';
import { createOwnedUtxoBlockbookRead } from '../../../../source/wallet/utxoBlockbookReads.ts';
import type { UtxoActivityContext, UtxoActivitySource } from '../core/utxoActivity.ts';
import type { UtxoBalance } from '../core/utxoBalanceReader.ts';
import { findWifAddressType, normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { parseUtxoPublicIdentifier, type UtxoPublicIdentifier } from '../core/utxoIdentifier.ts';
import { WalletStorageError, type OpenWalletStorage, type RecoveryStorageSnapshot, type WalletIdentityRead } from '../storage/types.ts';
import type { CustodyRuntime, CustodyRuntimeFactory, NativeOperationCredential, NativeOperationAuthorization } from './types.ts';
import { CustodyRuntimeError } from './types.ts';
import { previewNativePhraseAddresses } from './phrasePreview.ts';
import { TransferJournalError } from './transferJournal.ts';
import { NativeWalletCatalogue, WalletCatalogueError,
  catalogueAccountGroup,
  catalogueEvmNetworks,
  catalogueUtxoNetworks,
  captureNativeInfrastructurePayerReference,
  previewNativeNetworkSelection,
  createNativeAccountRecord,
  recoveryVerificationRecords,
  sentryRootPublicIdentity,
  WALLET_CATALOGUE_KEY,
} from './walletCatalogue.ts';
import { getNativeNetwork, snapshotNativeNetwork, nativeSigningEnabled } from './networkContext.ts';
import type { NativeAccountRequest, NativeAccountRuntime, NativeNetworkRuntime, NativeNetworkSelectionProof } from './accounts.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import { NativeTransferError, type NativeTransferDispatchValidation, type NativeReplacementApproval, type NativeTransferRuntime } from './transfers.ts';
import { assertTransferIntentEnvelope, equalTransferIntent, snapshotErc20TransferIntent, snapshotNativeAssetTransferIntent, type NativeAssetTransferIntent } from './transferIntent.ts';
import { NativeTransferRpc, assertSpeedUpEnvelope } from './transferRpc.ts';
import { readOwnData, snapshotCancellationTransfer, snapshotNftQuoteEnvelope, snapshotUnsignedTransfer, unsignedTransferBytes } from './evmFeeContracts.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import { NativeTokenRegistry, snapshotSavedCollectible } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenInventory, NativeTokenPortfolioScope, NativeTokenScope, SavedCollectible } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenRuntime } from '../portfolio/nativeTokens.ts';
import { NativeActivityHistory } from '../activity/historyStore.ts';
import { createActivityScope, type ActivityScope, type EvmActivityReadScope } from '../activity/types.ts';
import type { NativeActivityRuntime } from '../activity/nativeActivity.ts';
import { computeAddress, Transaction } from 'ethers/transaction';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { keyExportRegistrationHash, snapshotHdKeyExportScope, type NativeHdKeyExportRuntime } from './hdKeyExport.ts';
import { parseNativeAccountId, type NativeAccountType } from './accountIdentity.ts';
import { importedKeyIdentity, isUtxoAccountPrivateKey, isUtxoWifText, normalizeImportedKey, normalizeUtxoImport } from './importedAccounts.ts';
import { importAccountWithRecovery } from '../../../../source/wallet/importedAccountRecovery.ts';
import type { NativeImportRuntime } from './importedAccounts.ts';
import { stageInitialWallet, type RecoveryAccountGroup } from '../../../../source/wallet/accountRecovery.ts';
import { createPrivateVaultSession, type IPrivateVaultSession } from '../../../../source/wallet/privateVault.ts';
import { createNativeNoteImport, type NativeNoteImportRuntime } from './noteImport.ts';
import type { createNativePrivacyPoolSync } from '../privacy/nativePrivacyPoolSync.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { NativeUtxoSend } from './utxoSend.ts';
import { SENTRY_NETWORKS, type SentryNetwork } from '../../../../source/shared/sentryNetworks.ts';
import { deriveSentryVaultId } from '../../../../source/wallet/sentryKeyVault.ts';
import type { DeriveSentryPublicKey, NativeSentryKeyManagement } from './sentryKeyManagement.ts';
import { createSentryCollateralCoordinator } from '../../../../source/wallet/sentryCollateral.ts';
import { createNativeSentryCollateral, createNativeSentryNodeManagement, type NativeSentryNodeManagement } from './sentryNodeManagement.ts';
import { createNativeSentryApprovals, createNativeSentryJsonReader, type NativeSentryApprovals } from './sentryApprovals.ts';
import { createNativeSentryWalletAuthority } from './sentryWalletAuthority.ts';
import type { RunSentryCrypto } from '../../../../source/wallet/sentryCryptoJobs.ts';
import { createNativeHardwareDappSigning, type NativeHardwareDappAccount, type NativeHardwareDappSigning, type NativeHardwareDappSession } from '../hardware/dappSigning.ts';
import { createOwnedKeyringTransfer } from '../hardware/ownedKeyringTransfer.ts';
import { withOwnedLedgerConnection } from '../hardware/withOwnedLedgerConnection.ts';
import type { createDappSigningApproval } from '../../../../source/wallet/dappSigningApproval.ts';

type SoftwareSdk = NativeKeyringSdk;
type NativeRecordAccess = import('../../../../source/wallet/evmSignedRecords.ts').EvmSignedRecordSession['keyring'] & { dispose(): void };
type IndexedKeyring = InstanceType<SoftwareSdk['HostKeyring']> & {
  deriveEvmHdRuntimeAccount?: (request: { index: number }, options: { assertCurrent(): void }) => Promise<IKeyringAccountState>;
  hasPublicSession(): boolean;
  capturePublicSessionGuard(): () => void;
  withSecretOperation<T>(credential: { withSecret(check: () => void, consume: (secret: string) => Promise<void>): Promise<void> }, options: { signal: AbortSignal; assertCurrent(): void }, work: (secret: string) => T | Promise<T>): Promise<T>;
  createPrivateRecordAccess(domains: readonly string[], options: Readonly<{ transferable: boolean }>): Promise<NativeRecordAccess>;
  getPrivateRecordAccess(domains: readonly string[]): NativeRecordAccess;
};
const transactionRecordDomains = Object.freeze(['org.syscoin.pali.evm.signed.root.v1', 'org.syscoin.pali.evm.signed.chunk.v1',
  'org.syscoin.pali.utxo.signed.root.v1', 'org.syscoin.pali.utxo.signed.chunk.v1']);
const privateNoteRecordDomains = Object.freeze(['org.syscoin.pali.privacy.notes.v1', 'org.syscoin.pali.privacy.notes.shard.v2']);

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
class TrezorReviewChangedError extends Error {
  constructor() { super('Network conditions changed. Review this transfer again and approve the new request on Trezor.'); }
}

export type KeyringRuntimeDependencies = Readonly<{
  ensureCryptoReady(): Promise<void>;
  slhExecution: NativeSlhExecutionCapability | null;
  passkeys: NativePasskeyCapability | null;
  privacyServiceSettings: NativePrivacyServiceSettingsPort | null;
  checkSmartAccountAddress?: (address: string) => Promise<IBlacklistCheckResult>;
  connectionFetch?: typeof walletFetch;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<SoftwareSdk>;
  createLedgerTransport?: (owner: NativeLedgerOwner) => Promise<NativeLedgerTransport>;
  trezorSessions?: NativeTrezorSessions;
  openPrivacyPool?: (network: NativeNetworkRegistration, poolId: PrivacyPoolId, signal: AbortSignal, assertCurrent: () => void) => Promise<ReturnType<typeof createNativePrivacyPoolSync>>;
  openPrivacyWithdrawal?: (signal: AbortSignal, assertCurrent: () => void) => Promise<Readonly<{
    prove: IPrivacyWithdrawalsHost['prove'];
    relayers: IPrivacyWithdrawalsHost['relayers'];
    fetcher: typeof fetch;
  }>>;
  assertActive?: () => void;
  credentialPort: NativeCredentialPort | null;
  isAuthenticationActive(owner: AbortSignal): boolean;
  readEvmRetirement: ((network: NativeNetworkRegistration, method: EvmSignedRetirementReadMethod,
    params: readonly unknown[], signal: AbortSignal, guard: () => void) => Promise<unknown>) | null;
  readUtxoBalance?: (network: UtxoNetwork, address: string, signal: AbortSignal, guard: () => void) => Promise<UtxoBalance>;
  readUtxoAccount?: (network: UtxoNetwork, xpub: string, signal: AbortSignal, guard: () => void) => Promise<UtxoBalance>;
  utxoFetch?: typeof globalThis.fetch;
  prepareSmartAccount?: (network: NativeNetworkRegistration, accountIndex: number, managementAddress: string, signal: AbortSignal, guard: () => void) => Promise<{ address: string; metadata: NonNullable<IKeyringAccountState['smartAccount']> }>;
  /** Only a separately qualified host can install the Sentry derivation executor. */
  deriveSentryPublicKey?: DeriveSentryPublicKey;
  /** Signing execution is qualified separately from public-key import. */
  runSentryCrypto?: RunSentryCrypto;
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
export type NativeSlhDsaAccount = Readonly<{
  installedKeys: readonly NativeSlhInstalledKey[];
  readPrepared(): Promise<readonly import('../smartAccount/slhDsaRuntime.ts').NativeSlhPublicState[]>;
  rebuildPrepared(keyId: string, progress: Parameters<NativeSlhDsaRuntime['rebuildInstalled']>[2]): ReturnType<NativeSlhDsaRuntime['rebuildInstalled']>;
  prepareFresh: (progress: Parameters<NativeSlhDsaRuntime['prepareFresh']>[2]) => ReturnType<NativeSlhDsaRuntime['prepareFresh']>;
  hydrateInstalled(keyId: string): ReturnType<NativeSlhDsaRuntime['hydrateInstalled']>;
  rebuildInstalled(keyId: string, progress: Parameters<NativeSlhDsaRuntime['rebuildInstalled']>[2]): ReturnType<NativeSlhDsaRuntime['rebuildInstalled']>;
  signActionHash(input: Parameters<NativeSlhDsaRuntime['signActionHash']>[0], approval: Parameters<NativeSlhDsaRuntime['signActionHash']>[1], assertDelivery: () => void): ReturnType<NativeSlhDsaRuntime['signActionHash']>;
}>;

export interface KeyringRuntime extends CustodyRuntime {
  readonly ledger: NativeLedgerRuntime;
  readonly trezor: NativeTrezorView;
  openConnectionHost(): Promise<NativeConnectionSigningHost>;
  openSlhDsaAccount(assertCurrent: () => void, signal: AbortSignal, authentication: NativePrivateAuthentication | null): Promise<NativeSlhDsaAccount>;
  canSignSmartAccount(): boolean;
  resumeSmartAccountOperation(id: string, signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  canManageSlhDsa(): boolean;
  openSlhDsaInstallation(keyId: string, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  prepareConnectionPsbt(request: import('../connections/psbtRequests.ts').NativePsbtRequest,
    signal: AbortSignal, assertCurrent: () => void, handoff: import('../connections/signingHandoff.ts').NativeSigningHandoff, authentication: NativePrivateAuthentication | null): Promise<import('../../../../source/wallet/psbtApprovals.ts').PreparedPsbtApproval>;
  readConnectionUtxoPublic(method: 'getChangeAddress' | 'getCurrentAddressPubkey' | 'getBip32Path',
    owner: Readonly<{ accountId: string; xpub: string }>, isChangeAddress: boolean,
    signal: AbortSignal, assertCurrent: () => void): Promise<string>;
  openSmartAccountDeployment(assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  openWalletAuthenticator(signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  canUsePasskeys(): boolean;
  openPasskeyAuthenticator(recreate: boolean, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  canUseWalletAuthenticator(): boolean;
  readSmartAccountModules(signal: AbortSignal, assertCurrent: () => void): Promise<ISmartAccountMetadata>;
  preflightSmartAccountModule(address: string, signal: AbortSignal, assertCurrent: () => void): Promise<CustomValidatorPreflightResult>;
  openSmartAccountModuleChange(draft: NativeSmartModuleDraft, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  openSmartAccountSend(recipient: string, amount: NativeSmartAccountAmount, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
  refreshSmartAccountMetadata(signal: AbortSignal, assertCurrent: () => void): Promise<GuardianRecoveryObservation | null>;
  getGuardianRecoveryIntent(): NativeGuardianRecoveryIntent | null;
  openSmartInfrastructure(signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeInfrastructureController>;
  openResumedSmartInfrastructure(id: string, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeInfrastructureController>;
  openGuardianRecovery(draft: NativeGuardianRecoveryDraft, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeGuardianRecoveryController>;
  openGuardianPolicy(draft: NativeGuardianPolicyDraft, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation>;
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
    refresh?: 'page',
  ): Promise<T>;
  /** Selected software key only, consumed by the context-bound secret presentation flow. */
  readonly keyExport?: NativeHdKeyExportRuntime<NativePrivateAuthentication>;
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
  openSentryKeyManagement?(lifetime: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativeSentryKeyManagement>;
  openSentryNodeManagement?(lifetime: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSentryNodeManagement>;
  openSentryApprovals?(lifetime: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication | null): Promise<NativeSentryApprovals>;
  openConnectionSentryApprovals(): Promise<NativeSentryApprovals>;
  /** Trusted note file adapter only. Never part of a public wallet snapshot. */
  openNoteBackup?(assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativeNoteBackupRuntime>;
  openPrivacyControls?(signal: AbortSignal, assertCurrent: () => void): Promise<NativePrivacyControls>;
  openNoteMaintenance?(signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativeNoteMaintenanceRuntime>;
  openNoteCapacity?(assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativeNoteCapacityRuntime>;
  readNoteInventory?(assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativeNoteInventory>;
  openNoteImport?(assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativeNoteImportRuntime>;
  openPrivateDeposit?(signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthentication): Promise<NativePrivateDepositView>;
  /** Internal removal authorization. The protected snapshot never reaches a screen. */
  authorizeWalletRemoval?(signal: AbortSignal, authentication: NativePrivateAuthentication, assertCurrent: () => void, beforeSnapshot: (assertCurrent: () => void) => Promise<void>): Promise<Readonly<{
    snapshot: RecoveryStorageSnapshot;
    assertCurrent(): void;
    purgePublicCaches(assertCleanupCurrent: () => void): Promise<void>;
    removeCredential(record: NativeCredentialReference): Promise<void>;
  }>>;
  /** Public metadata only; no selection/signing authority. Cleared on lock. */
  readonly catalogue: {
    getSnapshot(): NativeWalletCatalogueSnapshot | null;
    getControlSnapshot(): ReturnType<NativeWalletCatalogue['getControlSnapshot']>;
    getMonitoringSnapshot(): ReturnType<NativeWalletCatalogue['getMonitoringSnapshot']>;
    previewNetworkSelection(id: string, expectedRevision: number): ReturnType<NativeWalletCatalogue['previewNetworkSelection']>;
  };
  readonly backup: {
    isAuthenticationRefusal(error: unknown): boolean;
    readPhrase(credential: NativeOperationCredential): Promise<readonly string[]>;
    fingerprint(): Promise<string>;
    confirm(fingerprint: string): Promise<void>;
  };
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
  if (!Object.hasOwn(dependencies, 'passkeys') || (dependencies.passkeys !== null &&
    (typeof dependencies.passkeys?.create !== 'function' || typeof dependencies.passkeys?.recover !== 'function' || typeof dependencies.passkeys?.sign !== 'function')))
    throw new TypeError('Explicit native passkey capability is required');
  const passkeys = dependencies.passkeys;
  if (dependencies.slhExecution !== null && (typeof dependencies.slhExecution !== 'object' ||
      typeof dependencies.slhExecution.open !== 'function' || typeof dependencies.slhExecution.purgePublicCache !== 'function'))
    throw new Error('An explicit native SLH execution capability is required');
  const slhCapability = dependencies.slhExecution === null ? null : Object.freeze({
    open: dependencies.slhExecution.open.bind(dependencies.slhExecution),
    purgePublicCache: dependencies.slhExecution.purgePublicCache.bind(dependencies.slhExecution),
  });
  if (dependencies.readEvmRetirement !== null && typeof dependencies.readEvmRetirement !== 'function')
    throw new Error('A signed-record retirement capability is required');
  return {
    async open(): Promise<KeyringRuntime> {
      await dependencies.ensureCryptoReady();
      const storage = await dependencies.openStorage();
      let storageRetired = false;
      let infrastructureSettlementFault = false;
      try {
        await settleNativeCredentialRemoval(storage, dependencies.credentialPort);
        const sdk = await (dependencies.loadSdk?.() ?? loadNativeKeyringSdk());
        if (typeof sdk.captureEvmSubmission !== 'function' || typeof sdk.submitSignedEvmTransaction !== 'function') throw new Error('Shared EVM submission SDK is required');
        const credentialVault = dependencies.credentialPort ? createNativeCredentialVault(storage.credential, dependencies.credentialPort) : undefined;
        // Bind the same fixed checkpoint adapter to the SDK and native controllers.
        const checkpointStorage: typeof storage.keyringStorage = Object.freeze({ ...storage.keyringStorage,
          compareAndSet: (key: string, expected: unknown, value: unknown, removeIfEqual?: Readonly<Record<string, unknown>>, guard?: () => void) => {
            if (key !== WALLET_CATALOGUE_KEY && parseSLHDSAStateStorageKey(key) === null)
              return storage.keyringStorage.compareAndSet(key, expected, value, removeIfEqual, guard);
            if (!guard) throw new KeyringRuntimeError('INVALID_INPUT');
            return commitPublicCheckpoint([{ key, expected, value }, ...Object.entries(removeIfEqual ?? {}).map(([key, expected]) => ({ key, expected, value: undefined }))], guard);
          },
          compareAndSetMany: (...args: Parameters<typeof storage.keyringStorage.compareAndSetMany>) => commitPublicCheckpoint(...args),
        });
        const host = sdk.createKeyringHost(checkpointStorage);
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
        let ledgerVerified: { accountId: string; targetIds: readonly string[]; assertCurrent(): void; prepareInfrastructureAdoption(next: NativeWalletCatalogueSnapshot): () => void; generation: number; snapshot: NativeWalletCatalogueSnapshot; transport: NativeLedgerTransport } | undefined;
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
        const openKeyring = (scope: State, trezorHost?: TrezorHost) => {
          const options = { captureEvmSubmission: null, secretLifetime: 'operation' as const };
          const instance = new sdk.HostKeyring(host, options, () => {
            const hardware = sdk.createLedgerHardware(ledgerHost);
            if (!trezorHost) return hardware;
            const trezor = sdk.createTrezorHardware(trezorHost);
            return { ...hardware, trezorSigner: trezor.trezorSigner,
              syscoinHardwareSigners: { ...hardware.syscoinHardwareSigners, ...trezor.syscoinHardwareSigners } };
          }) as IndexedKeyring;
          if (typeof instance.hasPublicSession !== 'function' || typeof instance.capturePublicSessionGuard !== 'function' || typeof instance.withSecretOperation !== 'function' ||
              typeof instance.createPrivateRecordAccess !== 'function' || typeof instance.getPrivateRecordAccess !== 'function' ||
              typeof instance.createPublicSessionCheckpoint !== 'function' || typeof instance.restorePublicSession !== 'function')
            throw new KeyringRuntimeError('NOT_READY');
          instance.setVaultStateGetter(() => scope);
          return instance;
        };
        let state = initialState();
        let keyring = openKeyring(state);
        let trezorSessionGeneration = 0;
        let trezorSession: NativeTrezorSession | undefined;
        let trezorWorker: IndexedKeyring | undefined;
        let trezorDeviceWorker: ReturnType<NativeKeyringSdk['createTrezorHardware']>['trezorSigner'] | undefined;
        let trezorSequence = 0;
        let trezorEpoch = 0;
        let preparedTrezor: { account: IKeyringAccountState; generation: number; snapshot: NativeWalletCatalogueSnapshot } | undefined;
        type SmartTrezorTarget = Readonly<{ smartId: string; smartAddress: string; ownerId: string; ownerIndex: number; ownerAddress: string; ownerLabel: string; ownerStep: number; ownerSteps: number; publicKey: string; cataloguePolicy: string; signingPolicy: string }>;
        let pendingTrezor: {
          owner: NativeTrezorHandoffOwner;
          job: NativeTrezorSession['job'];
          label: string;
          networkLabel: string;
          accountLabel: string;
          operation: 'import' | 'send' | 'utxo-send' | 'external-psbt' | 'external-signing' | 'smart-operation' | 'infrastructure';
          resume?: NativeTrezorResumeIntent;
          target: SmartTrezorTarget | null;
          accepted: boolean;
        } | undefined;
        let trezorError: string | null = null;
        const trezorListeners = new Set<() => void>();
        let trezorSnapshot: NativeTrezorSnapshot = Object.freeze({ phase: 'idle', operation: null,
          networkLabel: '', accountLabel: '', address: null, signer: null, error: null });
        const publishTrezor = () => {
          const pending = pendingTrezor, transport = dependencies.trezorSessions?.getSnapshot();
          const target = pending?.target;
          const candidate = target && transport ? Object.freeze({label:target.ownerLabel,address:target.ownerAddress,step:target.ownerStep,total:target.ownerSteps}) : null;
          const signer = candidate && trezorSnapshot.signer && Object.keys(candidate).every(key => candidate[key as keyof typeof candidate] === trezorSnapshot.signer![key as keyof typeof candidate]) ? trezorSnapshot.signer : candidate;
          const next: NativeTrezorSnapshot = {
            phase: trezorError ? 'error' : !pending || !transport ? 'idle'
              : transport.phase === 'response-ready' ? 'resume'
                : transport.phase === 'awaiting-response' || transport.phase === 'locked' ? 'waiting' : pending.operation === 'import' ? 'importing' : 'opening',
            operation: pending?.operation ?? null, networkLabel: pending?.networkLabel ?? '',
            accountLabel: pending?.accountLabel ?? '', address: pending?.owner.accountAddress ?? null, signer, error: trezorError,
          };
          if ((Object.keys(next) as (keyof NativeTrezorSnapshot)[]).every(key => next[key] === trezorSnapshot[key])) return;
          trezorSnapshot = Object.freeze(next);
          for (const listener of trezorListeners) {
            try { listener(); } catch { /* Observation cannot grant custody. */ }
          }
        };
        const unsubscribeTrezor = dependencies.trezorSessions?.subscribe(publishTrezor);
        let trezorCleanup: Promise<void> | undefined;
        const joinTrezorCleanup = (work: () => readonly (Promise<void> | undefined)[]) => {
          const previous = trezorCleanup;
          let resolve!: () => void, reject!: (error: unknown) => void;
          const closing = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
          trezorCleanup = closing;
          let tasks: readonly (Promise<void> | undefined)[];
          try { tasks = work(); } catch (error) { tasks = [Promise.reject(error)]; }
          void Promise.allSettled([previous, ...tasks]).then(results => {
            const failure = results.find(result => result.status === 'rejected');
            if (failure?.status === 'rejected') reject(failure.reason); else resolve();
          });
          // The barrier remains sticky even when no caller is currently awaiting it.
          void closing.catch(() => undefined);
          return closing;
        };
        type LocalSmartContext = { handoff: NativeSigningHandoff; operation: NativeSmartAccountOperation; disposeOriginal(): Promise<void> };
        let localSmartContext: LocalSmartContext | undefined;
        type LocalInfrastructureContext = { handoff: NativeSigningHandoff; controller: NativeInfrastructureController; drain(): Promise<void> };
        let localInfrastructureContext: LocalInfrastructureContext | undefined;
        const localSmartHandoffs = new NativeSigningHandoffs({
          async cancel(job) { if (pendingTrezor?.job === job) await cancelTrezor(); }, changed: publishTrezor,
        });
        const backgroundLocalSmart = () => {
          const infrastructure = localInfrastructureContext;
          if (infrastructure && !localSmartHandoffs.background(infrastructure.handoff)) {
            if (localInfrastructureContext === infrastructure) localInfrastructureContext = undefined;
            infrastructure.controller.dispose();
          }
          const owned=localSmartContext;
          if (owned && !localSmartHandoffs.background(owned.handoff)) {
            if(localSmartContext===owned)localSmartContext=undefined;
            void owned.operation.dispose().catch(()=>undefined);
          }
        };
        const retireTrezor = () => {
          const session = trezorSession, worker = trezorWorker, device = trezorDeviceWorker;
          trezorSession = undefined; trezorWorker = undefined; trezorDeviceWorker = undefined;
          return session ? joinTrezorCleanup(() => [session.retire(async () => { await Promise.all([worker?.trezorSigner?.destroy(), device?.retire().then(assertRetired => assertRetired())]); })]) : trezorCleanup;
        };
        const cancelTrezor = (invalidate = true): Promise<void> => {
          if (invalidate) trezorEpoch++;
          const pending = pendingTrezor, local=localSmartContext, infrastructure=localInfrastructureContext;
          localSmartContext=undefined; localInfrastructureContext=undefined; localSmartHandoffs.cancelLocal();
          if(infrastructure){retireNativeSigningHandoff(infrastructure.handoff);infrastructure.controller.dispose();}
          if(local){retireNativeSigningHandoff(local.handoff);local.operation.cancel();void local.disposeOriginal().catch(()=>undefined);}
          pendingTrezor = undefined; trezorError = null;
          preparedTrezor = undefined;
          const retirement = retireTrezor();
          publishTrezor();
          return pending
            ? joinTrezorCleanup(() => [retirement, dependencies.trezorSessions?.cancel(pending.job)])
            : retirement ?? Promise.resolve();
        };
        let currentPublicSessionRecord: NativePublicSessionRecord | null = null;
        const commitPublicCheckpoint = async (changes: readonly Readonly<{ key: string; expected: unknown; value: unknown }>[], guard: () => void) => {
          const catalogueChange = changes.find(change => change.key === WALLET_CATALOGUE_KEY);
          const slhChange = changes.some(change => parseSLHDSAStateStorageKey(change.key) !== null);
          if (!catalogueChange && !slhChange) return storage.keyringStorage.compareAndSetMany(changes, guard);
          checkGuard(guard);
          const identity = verifiedIdentity, previous = currentPublicSessionRecord, ring = keyring;
          if (!identity?.root || !previous || !ring.hasPublicSession() || changes.some(change => change.key === NATIVE_PUBLIC_SESSION_KEY))
            throw new KeyringRuntimeError('NOT_READY');
          const stored = await storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY); checkGuard(guard);
          if (encodeStorageValue(stored) !== encodeStorageValue(previous)) throw new KeyringRuntimeError('CANCELLED');
          const records = catalogueChange ? recoveryVerificationRecords(catalogueChange.value, identity.walletBindingId) : catalogue.privateRecords;
          let states = nativePublicSessionSlhStates(previous);
          if (slhChange) {
            if (!ring.isUnlocked() || !storage.recovery) throw new KeyringRuntimeError('NOT_READY');
            const snapshot = await storage.recovery.readSnapshot(); checkGuard(guard);
            const rows = new Map(snapshot.records.filter(row => parseSLHDSAStateStorageKey(row.key) !== null).map(row => [row.key, decodeStorageValue(row.value)]));
            for (const change of changes) if (parseSLHDSAStateStorageKey(change.key) !== null) {
              if (change.value === undefined) rows.delete(change.key); else rows.set(change.key, change.value);
            }
            states = await readNativeSlhPublicStates([...rows].map(([key, value]) => ({ key, value })), ring, guard); checkGuard(guard);
          }
          const expectedManifest = nativePublicSessionManifest(catalogue.privateRecords, identity, previous.slhStates);
          const nextManifest = nativePublicSessionManifest(records, identity, [...states].map(([keyId, value]) => ({ keyId, ...value })));
          let next = previous;
          try {
            if (expectedManifest.length !== nextManifest.length || expectedManifest.some((byte, index) => byte !== nextManifest[index])) {
              if (!ring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
              if (!credentialVault) throw new KeyringRuntimeError('NOT_READY');
              next = await credentialVault.withPublicKey(guard, key => createNativePublicSessionRecord(ring, records, identity, states, key, guard)); checkGuard(guard);
            }
          } finally { expectedManifest.fill(0); nextManifest.fill(0); }
          const saved = await storage.keyringStorage.compareAndSetMany([...changes,
            { key: NATIVE_PUBLIC_SESSION_KEY, expected: stored, value: next }], guard);
          checkGuard(guard);
          if (saved) currentPublicSessionRecord = next;
          return saved;
        };
        const catalogue = new NativeWalletCatalogue(checkpointStorage);
        const infrastructure = createNativeInfrastructure();
        const passkeyRegistry = createNativePasskeyRegistry(storage.keyringStorage);
        const passkeyCeremony = <T>(authentication: NativePrivateAuthentication | null, signal: AbortSignal, guard: () => void, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
          clearCredentialMaterial();
          if (!passkeys || !authentication) throw new KeyringRuntimeError('NOT_READY');
          checkGuard(guard);
          const captured = generation, ring = keyring, snapshot = catalogueSnapshot, account = selectedAccount();
          // The prompt marker is queried by the view's inactive-state guard.
          // Its own guard must check ownership without calling that view again.
          const promptOwner = () => {
            if (closed || signal.aborted || generation !== captured || keyring !== ring || !ring.hasPublicSession() ||
                !snapshot || catalogueSnapshot !== snapshot || selectedAccount() !== account)
              throw new KeyringRuntimeError('CANCELLED');
          };
          return withNativePrivateAuthentication(authentication, signal, promptOwner, async owner => {
            checkGuard(guard);
            const result = await work(owner);
            checkGuard(guard);
            return result;
          });
        };
        const tokens = new NativeTokenRegistry(storage.keyringStorage);
        const activityHistory = new NativeActivityHistory(storage.keyringStorage);
        const signedRecords = new EvmSignedRecords(storage.signedRecords, Date.now, () => { void lock().catch(() => undefined); });
        const utxoRecords = storage.utxoSignedRecords && new (await import('../../../../source/wallet/utxoSignedRecords.ts')).UtxoSignedRecords(
          storage.utxoSignedRecords, storage.utxoSignedRecords,
          () => { void lock().catch(() => undefined); }
        );
        let catalogueSnapshot: NativeWalletCatalogueSnapshot | null = null;
        let generation = 0;
        let activeCredentialAction: NativeCredentialAction | null = null;
        const credentialActions = new Set<NativeCredentialAction>();
        const clearCredentialMaterial = () => { for (const action of credentialActions) action.clear(); };
        const beginCredentialAction = (captured: number) => {
          const action = new NativeCredentialAction(() => { current(captured); if (activeCredentialAction !== action) throw new KeyringRuntimeError('CANCELLED'); });
          credentialActions.add(action); activeCredentialAction = action; return action;
        };
        const endCredentialAction = (action: NativeCredentialAction) => {
          action.dispose(); credentialActions.delete(action); if (activeCredentialAction === action) activeCredentialAction = null;
        };
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
        let sentryNodes: NativeSentryNodeManagement | undefined;
        let sentryApprovals: NativeSentryApprovals | undefined;
        const sentryCollateralCoordinator = createSentryCollateralCoordinator();
        const retireSentryKeys = () => {
          sentryKeys?.dispose();
          sentryKeys = undefined;
          sentryNodes?.dispose(); sentryNodes = undefined;
          sentryApprovals?.dispose(); sentryApprovals = undefined;
        };
        type NoteRuntime = ReturnType<typeof import('./noteBackupRuntime.ts').createNativeNoteBackupRuntime>;
        let noteBackups: NoteRuntime | undefined;
        const privacyLifecycle = createNativePrivacyLifecycle();
        const openPrivacyPool: KeyringRuntimeDependencies['openPrivacyPool'] = dependencies.openPrivacyPool
          ? (network, poolId, signal, guard) => privacyLifecycle.open(signal, guard,
              (ownerSignal, check) => dependencies.openPrivacyPool!(network, poolId, ownerSignal, check), pool => pool.dispose(), (pool, dispose) => Object.freeze({ ...pool, dispose }))
          : undefined;
        let privateDomainStorageFault: 'unreported' | 'reopen' | undefined;
        const requirePrivateDomainReopen = () => { privateDomainStorageFault ??= 'unreported'; };
        let slhDsa: NativeSlhDsaRuntime | undefined;
        let slhPublicStates: NativeSlhPublicStates = new Map();
        let slhRetirement: Promise<void> = Promise.resolve();
        const retireSlhDsa = () => {
          const previous = slhDsa; slhDsa = undefined;
          if (!previous) return slhRetirement;
          const retiring = previous.retire();
          slhRetirement = Promise.allSettled([slhRetirement, retiring]).then(results => {
            if (results.some(result => result.status === 'rejected')) { privateDomainStorageFault = 'reopen'; throw new KeyringRuntimeError('CLEANUP_FAILED'); }
          });
          void slhRetirement.catch(() => undefined);
          return slhRetirement;
        };
        const requiresReopen = () => catalogue.requiresReopen || tokens.requiresReopen || activityHistory.requiresReopen || signedRecords.requiresReopen || utxoRecords?.requiresReopen === true || privateDomainStorageFault === 'reopen';
        const revokeGeneration = () => {
          clearCredentialMaterial();
          const next = ++generation;
          void retireLedger()?.catch(() => undefined);
          void cancelTrezor().catch(() => undefined);
          retireContextReadLifetime();
          void retireSlhDsa().catch(() => undefined);
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
        const privateConfirmationWork = new Set<Promise<unknown>>();
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
        const secretOperations = new Map<AbortController, number>();
        const secretAuthenticationRefusals = new WeakSet<object>();
        const operationAuthenticationRefusals = secretAuthenticationRefusals;
        const credentialFailure = (error: unknown, preserveCancellation = false): never => {
          if (isOperationAuthenticationCancellation(error)) {
            const refusal = preserveCancellation ? error : new KeyringRuntimeError('CANCELLED');
            secretAuthenticationRefusals.add(refusal); throw refusal;
          }
          const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
          if (code === 'CREDENTIAL_MISSING' || code === 'CREDENTIAL_UNAVAILABLE' || code === 'CREDENTIAL_UNSUPPORTED') {
            if (code === 'CREDENTIAL_UNSUPPORTED') credentialUnsupported = true;
            if (code === 'CREDENTIAL_MISSING') credentialMissing = true;
            const refusal = new KeyringRuntimeError('DEVICE_UNLOCK_UNAVAILABLE'); secretAuthenticationRefusals.add(refusal); throw refusal;
          }
          if (code === 'CREDENTIAL_CANCELLED') throw new KeyringRuntimeError('CANCELLED');
          throw error;
        };
        let credentialMissing = false;
        let credentialUnsupported = false;
        const assertDeviceConsent = (credential: NativeOperationCredential, check: () => void) => {
          checkGuard(check); if (!credential || credential.method !== 'device') throw new KeyringRuntimeError('INVALID_INPUT');
        };
        const requestCredential = async (purpose: NativeCredentialPurpose, signal: AbortSignal, check: () => void, preserveCancellation = false) => {
          check(); if (!credentialVault) throw new KeyringRuntimeError('NOT_READY');
          try { await credentialVault.authorize({ purpose, signal, assertCurrent: check }); }
          catch (error) { check(); credentialFailure(error, preserveCancellation); }
          check();
        };
        const withSoftwareSecret = async <T>(
          purpose: NativeCredentialPurpose, signal: AbortSignal, assertOwner: () => void,
          work: (secret: string) => T | Promise<T>, supplied: NativeOperationCredential | null,
          authorization: Readonly<{ receipt: NativeOperationAuthorization; target: string }> | null,
          interruption: Readonly<{ authentication: NativePrivateAuthentication; assertCurrent(): void }> | null = null
        ): Promise<T> => {
          const captured = generation, ring = keyring, identity = verifiedIdentity, owned = new AbortController();
          const abort = () => owned.abort();
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
          secretOperations.set(owned, generation);
          let secretDelivered = false;
          let credentialRejection: unknown;
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (owned.signal.aborted || ring !== keyring || identity !== verifiedIdentity) throw new KeyringRuntimeError('CANCELLED');
          };
          try {
            check(); if (!credentialVault) throw new KeyringRuntimeError('NOT_READY');
            if (supplied !== null) assertDeviceConsent(supplied, check);
            if (authorization !== null) {
              if (supplied !== null) throw new KeyringRuntimeError('INVALID_INPUT');
              consumeOperationAuthorization(authorization.receipt, check, authorization.target);
            }
            const execute = (owner: AbortSignal) => ring.withSecretOperation({ async withSecret(sdkCheck, consume) {
              const guard = () => { check(); checkGuard(sdkCheck); check(); };
              const use = async (secret: string) => { secretDelivered = true; return consume(secret); };
              const read = async (consume: (secret: string) => Promise<void>) => {
                try { await credentialVault.withSecret({ purpose, signal: owner, assertCurrent: guard }, consume); }
                catch (error) { if (!secretDelivered) credentialRejection = error; throw error; }
              };
              if (activeCredentialAction) await activeCredentialAction.withSecret({ purpose, signal, assertCurrent: guard }, read, use);
              else await read(use);
            } }, { signal: owner, assertCurrent: check }, async secret => {
              check();
              if (identity && JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
              check(); return work(secret);
            });
            return interruption
              ? await withNativePrivateAuthentication(interruption.authentication, owned.signal, interruption.assertCurrent, execute)
              : await execute(owned.signal);
          } catch (error) {
            if (!secretDelivered) { check(); credentialFailure(credentialRejection ?? error); }
            throw error;
          } finally { owned.abort(); signal.removeEventListener('abort', abort); secretOperations.delete(owned); }
        };
        // Only fixed transaction-record keys survive the signing operation.
        const transactionRecordKeyring = (ring: IndexedKeyring, assertOwner: () => void): import('../../../../source/wallet/evmSignedRecords.ts').EvmSignedRecordSession['keyring'] => {
          const invoke = async <T>(work: (access: NativeRecordAccess) => Promise<T>): Promise<T> => {
            const captured = generation;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (ring !== keyring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
            };
            check(); const result = await work(ring.getPrivateRecordAccess(transactionRecordDomains));
            try { check(); return result; }
            catch (error) { if (result instanceof Uint8Array) result.fill(0); throw error; }
          };
          return Object.freeze({
            getPrivateRecordProfileId: () => invoke(access => access.getPrivateRecordProfileId()),
            encryptPrivateRecord: input => {
              const captured = snapshotRecordEncryption(input, transactionRecordDomains);
              return invoke(access => access.encryptPrivateRecord(captured)).finally(() => captured.plaintext.fill(0));
            },
            decryptPrivateRecord: input => {
              const captured = snapshotRecordDecryption(input, transactionRecordDomains);
              return invoke(access => access.decryptPrivateRecord(captured));
            },
          });
        };
        const reconcilePublicUtxo = (network: UtxoNetwork, account: Readonly<{ id: number; type: string; xpub: string }>, assertScope: () => void) => {
          if (!utxoRecords || !dependencies.utxoFetch) return;
          const ring = keyring, signal = (contextReadLifetime ??= new AbortController()).signal;
          const check = () => { assertScope(); if (signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
          const work = async () => {
            check();
            const { reconcileRetainedUtxo } = await import('../../../../source/wallet/utxoSubmission.ts');
            check();
            await reconcileRetainedUtxo({
              records: utxoRecords,
              session: { keyring: transactionRecordKeyring(ring, check), assertCurrent: check },
              owner: { chainId: network.chainId, slip44: network.slip44, genesisHash: network.genesisHash, account },
              backendChain: network.backendChain,
              fetch: dependencies.utxoFetch!,
              signal,
            });
            check();
          };
          // Public results remain usable while this scope-owned status pass runs.
          // The journal's onUnavailable callback still locks on storage uncertainty.
          void work().catch(() => undefined);
        };
        const operationAuthorizations = new Map<NativeOperationAuthorization, {
          generation: number; ring: IndexedKeyring;
          snapshot: NativeWalletCatalogueSnapshot | null; target: string; assertCurrent(): void;
        }>();
        type PrivateRecordAction = { policy: 'action' | 'acknowledgement'; generation: number; ring: IndexedKeyring; verified: boolean; closed: boolean; signal: AbortController; tail: Promise<void>; access?: NativeRecordAccess; retained?: boolean };
        let privateRecordAction: PrivateRecordAction | null = null;
        const privateAcknowledgements = new Map<IPrivateVaultSession, PrivateRecordAction>();
        const privateRecordOwners = new WeakMap<object, IndexedKeyring>();
        const privateRecordAuthorizers = new WeakMap<object, () => Promise<void>>();
        const privateRecordKeyring = (ring: IndexedKeyring, assertOwner: () => void, action: PrivateRecordAction, authentication: NativePrivateAuthentication | null = null): IPrivateVaultSession['keyring'] => {
          const identity = verifiedIdentity;
          const checkOwnership = () => {
            if (authentication) assertNativePrivateAuthentication(authentication);
            // An acknowledged submission belongs to its original wallet;
            // changing the selected account must not discard its receipt.
            current(action.policy === 'acknowledgement' ? generation : action.generation);
            if ((action.policy === 'action' && privateRecordAction !== action) || action.closed || action.signal.signal.aborted || action.ring !== ring || ring !== keyring ||
                !identity?.root || identity !== verifiedIdentity)
              throw new KeyringRuntimeError('CANCELLED');
          };
          const check = () => { checkOwnership(); checkGuard(assertOwner); checkOwnership(); };
          const invoke = <T>(work: (access: NativeRecordAccess) => Promise<T>): Promise<T> => {
            const pending = action.tail.then(async () => {
              check();
              let result: T;
              if (!action.access) {
                if (action.policy !== 'action') throw new KeyringRuntimeError('NOT_READY');
                result = await withSoftwareSecret('secret-read', action.signal.signal, check, async () => {
                  check(); action.access = await ring.createPrivateRecordAccess(privateNoteRecordDomains, { transferable: false });
                  check(); action.verified = true; return work(action.access);
                }, null, null, authentication ? { authentication, assertCurrent: checkOwnership } : null);
              } else result = await work(action.access);
              try { check(); return result; }
              catch (error) { if (result instanceof Uint8Array) result.fill(0); throw error; }
            });
            action.tail = pending.then(() => undefined, () => undefined);
            return pending;
          };
          const facade: IPrivateVaultSession['keyring'] = Object.freeze({
            async getPrivateRecordProfileId() { check(); return identity!.root!.profileId; },
            encryptPrivateRecord: input => {
              const captured = snapshotRecordEncryption(input, privateNoteRecordDomains);
              return invoke(access => access.encryptPrivateRecord(captured)).finally(() => captured.plaintext.fill(0));
            },
            decryptPrivateRecord: input => {
              const captured = snapshotRecordDecryption(input, privateNoteRecordDomains);
              return invoke(access => access.decryptPrivateRecord(captured));
            },
          });
          privateRecordOwners.set(facade, ring);
          privateRecordAuthorizers.set(facade, () => invoke(async () => undefined));
          return facade;
        };
        const releaseOperationAuthorization = (receipt: NativeOperationAuthorization) => {
          operationAuthorizations.delete(receipt);
        };
        const consumeOperationAuthorization = (receipt: NativeOperationAuthorization, check: () => void, target: string) => {
          const value = operationAuthorizations.get(receipt);
          operationAuthorizations.delete(receipt);
          if (!value) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
          value.assertCurrent(); checkGuard(check); current(value.generation);
          if (value.ring !== keyring || value.snapshot !== catalogueSnapshot || value.target !== target) throw new KeyringRuntimeError('CANCELLED');
        };
        const revokeCustody = (privacy: 'join' | 'revoke'): Promise<void> => {
          clearCredentialMaterial();
          if (privateRecordAction) { privateRecordAction.closed = true; privateRecordAction.signal.abort(); privateRecordAction.access?.dispose(); privateRecordAction = null; }
          for (const action of privateAcknowledgements.values()) { action.closed = true; action.signal.abort(); action.access?.dispose(); }
          privateAcknowledgements.clear();
          for (const operation of secretOperations.keys()) operation.abort();
          secretOperations.clear();
          for (const receipt of operationAuthorizations.keys()) releaseOperationAuthorization(receipt);
          generation++;
          // Invoke the SDK now: its secret buffers are retired synchronously.
          const pending = keyring.lockWallet();
          // A storage-fault ACK finalizer must finish classifying its retained
          // submission before its view is disposed. Generation revocation still
          // refuses new work and every guarded persistence commit immediately.
          const revocation = privacy === 'join'
            ? Promise.all([pending, privacyLifecycle.invalidate()])
            : pending;
          const ledgerRetirement = retireLedger(), trezorRetirement = retireTrezor();
          const hardwareCleanup = trezorRetirement ? Promise.all([ledgerRetirement, trezorRetirement]) : ledgerRetirement;
          const retired = hardwareCleanup ? Promise.all([revocation, hardwareCleanup]) : revocation;
          state.accounts = initialState().accounts;
          catalogueSnapshot = null;
          authenticatedPair = null; verifiedIdentity = null;
          preparedTrezor = undefined;
          publishTrezor();
          retireContextReadLifetime();
          void retireSlhDsa().catch(() => undefined);
          retireSentryKeys();
          noteBackups?.invalidate();
          pendingBalance?.abort();
          pendingRegistration?.abort();
          utxoSend?.cancel(); utxoSend = undefined;
          // Publish an existing storage fault before waiting for native drainage.
          // closeRuntime independently joins SLH retirement, including on failure.
          return retired.then(() => {
            if (requiresReopen()) throw new KeyringRuntimeError('CLEANUP_FAILED');
            return slhRetirement.then(() => {
              if (requiresReopen()) throw new KeyringRuntimeError('CLEANUP_FAILED');
            });
          });
        };
        const lock = () => {
          const local = localSmartContext;
          localSmartContext = undefined;
          if (local) void local.disposeOriginal().catch(() => undefined);
          return revokeCustody('join');
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
          unsubscribeTrezor?.();
          const trezorRetirement = cancelTrezor();
          const work = active;
          let revocation: Promise<void>;
          try { revocation = lock(); } catch { revocation = Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED')); }
          // Reuse the drain installed by lock. Its physical result is distinct
          // from lock's deliberate rejection of an already-quarantined store.
          const privacyRetirement = privacyLifecycle.invalidate();
          noteBackups?.dispose();
          void (async () => {
            const [, revoked, trezorRetired, slhRetired, privacyRetired] = await Promise.allSettled([work, revocation, trezorRetirement, slhRetirement, privacyRetirement, ...pendingSubmissions]);
            let failed = privacyRetired?.status !== 'fulfilled' || trezorRetired?.status !== 'fulfilled' || slhRetired?.status !== 'fulfilled' || infrastructureSettlementFault;
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
            storageRetired = true;
            try { await storage.close(); } catch { failed = true; }
            if (failed) throw new KeyringRuntimeError('CLEANUP_FAILED');
          })().then(resolveClose, () => rejectClose(new KeyringRuntimeError('CLEANUP_FAILED')));
          return closing;
        };
        const run = <T>(operation: (captured: number) => Promise<T>, privacyRetirement: 'join' | 'revoke' = 'join'): Promise<T> => {
          if (closed) return Promise.reject(new Error('CANCELLED'));
          if (requiresReopen()) {
            void lock().catch(() => undefined);
            return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
          }
          if (active || reserved) return Promise.reject(new Error('BUSY'));
          const captured = generation;
          // Admit before invoking any injected storage/SDK callback.
          let credentialAction: NativeCredentialAction | null = null;
          const task = Promise.resolve().then(() => { credentialAction = beginCredentialAction(captured); return operation(captured); });
          const handled = task.catch(async (error: unknown) => {
            const wasCurrent = captured === generation && !closed;
            if (!wasCurrent) {
              if (!requiresReopen()) throw new KeyringRuntimeError('CANCELLED');
              // Quarantine belongs to this storage owner, across session changes.
              try { await (privacyRetirement === 'revoke' ? revokeCustody('revoke') : lock()); } catch { closed = true; }
              throw new KeyringRuntimeError('CLEANUP_FAILED');
            }
            if (error && typeof error === 'object' && secretAuthenticationRefusals.has(error) &&
                !requiresReopen() && keyring.hasPublicSession() && verifiedIdentity && catalogueSnapshot) {
              current(captured);
              throw error;
            }
            try { await (privacyRetirement === 'revoke' ? revokeCustody('revoke') : lock()); }
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
          }).finally(() => { if (credentialAction) endCredentialAction(credentialAction); if (active === handled) active = null; });
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
        const revalidateLocalSmart = () => {
          if(!localSmartHandoffs.active||!keyring.hasPublicSession()||!verifiedIdentity||!catalogueSnapshot)return;
          localSmartHandoffs.revalidateLocal(descriptor=>{
            try{return sameSigningResumeOwner(descriptor.scope,descriptor.kind === 'local-infrastructure' ? readLocalInfrastructureScope(descriptor.scope.wallet) : readLocalSmartScope(descriptor.scope.wallet));}catch{return false;}
          });
        };
        const publishAccounts = (next: NativeWalletCatalogueSnapshot) => {
          const changed = catalogueSnapshot !== next;
          Object.assign(state, stateFor(catalogue.privateRecords));
          catalogueSnapshot = next;
          connectionNetworkId = next.active.networkId;
          connectionNetwork = Object.freeze({ ...state.activeNetwork });
          if (changed) { clearCredentialMaterial(); retireContextReadLifetime(); retireSentryKeys(); }
          revalidateLocalSmart();
        };
        // Transfer only inside an admitted mutation. No await separates the
        // ownership move from publishing the private instance used by lock().
        const switchAccountGroup = async (networkId: string, guard: () => void,
          commitCreated: (group: RecoveryAccountGroup) => Promise<NativeWalletCatalogueSnapshot>): Promise<NativeWalletCatalogueSnapshot | undefined> => {
          const records = catalogue.privateRecords;
          const next = stateFor(records, networkId);
          if (next.activeNetwork.slip44 === state.activeNetwork.slip44) return;
          const source = keyring;
          const target = openKeyring(next);
          try {
            guard();
            // The reservation already retires new approvals. A dispatched
            // private transfer still owns its original wallet's ACK codec.
            await Promise.allSettled([...pendingSubmissions, ...privateConfirmationWork]);
            guard();
            await ledgerCleanup;
            guard();
            const preparedTransfer = await source.prepareSessionTransfer(target, guard);
            preparedTransfer.transfer();
            keyring = target;
            state = next;
            if (catalogueAccountGroup(records, networkId)) return;
            return await withSoftwareSecret('account-change', new AbortController().signal, guard, async () => {
              const created = await target.createFirstAccount(); guard();
              const account = checkedAccount(created, 0, networkId, catalogueUtxoNetworks(records.networks));
              return commitCreated({
                key: String(next.activeNetwork.slip44),
                activeNetwork: next.activeNetwork as RecoveryAccountGroup['activeNetwork'],
                activeAccount: next.activeAccount as RecoveryAccountGroup['activeAccount'],
                accounts: { ...next.accounts, HDAccount: { 0: account } } as RecoveryAccountGroup['accounts'],
              });
            }, null, null);
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
          const session = { keyring: transactionRecordKeyring(keyring, check), assertCurrent: check };
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
        // One-use private refusal receipts, issued only after the owned hardware
        // request retires. Rethrow outside run() without retiring the result screen.
        const infrastructureSigningFailures = new WeakSet<Error>();
        function prepareOwnedEvmTransaction(input: unknown, selected: NativeCatalogueAccount,
          selectedContext: NativeCatalogueAccount, signal: AbortSignal, check: () => void, metadata: Readonly<Record<string, unknown>> | undefined, funding: EvmFeeFunding, gasPolicy: EvmGasPolicy,
          hardwareSigner: (Pick<NativeHardwareDappSigning, 'signTransaction'> & {keyring(): IndexedKeyring}) | null,
          validateSigningAndBroadcast: (() => Promise<void>) | null,
          authentication: NativePrivateAuthentication | null = null) {
          check();
          if (authentication !== null) assertNativePrivateAuthentication(authentication);
          if (validateSigningAndBroadcast !== null && typeof validateSigningAndBroadcast !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
          const hardware = selected.type === 'Ledger' || selected.type === 'Trezor';
          if (hardware ? !hardwareSigner || typeof hardwareSigner.signTransaction !== 'function' || typeof hardwareSigner.keyring !== 'function'
            : (hardwareSigner !== null || (selected.type !== 'HDAccount' && selected.type !== 'Imported')))
            throw new KeyringRuntimeError('INVALID_INPUT');
          const signerType = selected.type, ring = keyring;
          const normalized = normalizeDappTransaction(input);
          if (normalized.from !== undefined && normalized.from.toLowerCase() !== selected.address.toLowerCase())
            throw new KeyringRuntimeError('INVALID_INPUT');
          const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
          const fetch = dependencies.connectionFetch ?? walletFetch;
          const rpc = new EvmTransferReadRpc(network, { fetch });
          const sender = new NativeTransferRpc({ registration: network, fetch });
          const planner = createNativeAutomaticNoncePlanner(signedRecords, hardwareSigner
            ? {get keyring() {check(); return transactionRecordKeyring(hardwareSigner.keyring(), check);}, assertCurrent: check}
            : {keyring: transactionRecordKeyring(ring, check), assertCurrent: check},
            network.chainId, selected.address, network.rpcUrl);
          return prepareNativeConnectionTransaction({ ...normalized, from: selected.address }, {
            network, rpc, signal, planner, funding, gasPolicy, assertCurrent: check,
            readApprovalMetadata: (contract, assertCurrent) => readNativeApprovalMetadata({
              network, owner: selected.address, contract, signal, assertCurrent, fetch,
            }),
            async sign(transaction, assertSigningCurrent) {
              const result = await run(async (ownerGeneration) => {
                const guard = () => { current(ownerGeneration); check(); checkGuard(assertSigningCurrent); };
                guard();
                if (validateSigningAndBroadcast !== null) await validateSigningAndBroadcast();
                guard();
                if (hardwareSigner) {
                  const transport = ledgerTransport, proof = ledgerVerified;
                  try {
                    const signed = await hardwareSigner.signTransaction(serializePreparedEvmTransaction(transaction), {signal, assertCurrent: guard});
                    return {kind: 'signed' as const, signed};
                  } catch (error) {
                    if (selected.type === 'Trezor' && error instanceof Error && infrastructureSigningFailures.delete(error)) {
                      guard();
                      return {kind: 'infrastructure-signing-failure' as const, error};
                    }
                    if (selected.type !== 'Ledger' || sdk.evmSubmissionFailure(error)?.transactionNotBroadcast !== true) throw error;
                    guard();
                    if (!transport || !proof || ledgerTransport !== transport || (ledgerVerified !== proof && ledgerVerified !== undefined))
                      throw new KeyringRuntimeError('CANCELLED');
                    // Trusted SDK evidence proves this signing call did not broadcast.
                    // Retire its device before allowing the still-current caller to clear an unsent attempt.
                    await retireLedger(); guard();
                    return {kind: 'ledger-signing-failure' as const, error};
                  }
                }
                if (selected.type !== 'HDAccount' && selected.type !== 'Imported') throw new KeyringRuntimeError('INVALID_INPUT');
                const softwareType = selected.type;
                const signed = await withSoftwareSecret('transaction', signal, guard, () => ring.signPreparedEvmTransaction({
                  selectedAccount: { id: selectedContext.index, type: selectedContext.type, expectedAddress: selectedContext.address },
                  account: { id: selected.index, type: softwareType, expectedAddress: selected.address },
                  network: { kind: 'ethereum', chainId: network.chainId, slip44: 60, url: network.rpcUrl },
                  transaction,
                }, { assertCurrent: guard }), null, null, authentication ? {
                  authentication,
                  assertCurrent() {
                    current(ownerGeneration);
                    if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                  },
                } : null);
                guard();
                return {kind: 'signed' as const, signed: Object.freeze({ rawTransaction: signed.rawTransaction, hash: signed.hash })};
              // The enclosing private confirmation owns its drain. Revoke keys
              // on error here, then let that confirmation finish without self-joining.
              }, authentication ? 'revoke' : 'join');
              if (result.kind === 'ledger-signing-failure' || result.kind === 'infrastructure-signing-failure') {
                check(); checkGuard(assertSigningCurrent);
                throw result.error;
              }
              return result.signed;
            },
            async submit(transaction, signed, assertSubmittingCurrent, verifyDispatch, onBroadcast, submission) {
              if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
              const guard = () => { check(); checkGuard(assertSubmittingCurrent); };
              guard();
              const registry = submission.kind === 'eoa-calls' ? (await getConnectionRepository(generation)).calls : undefined;
              const submissionMetadata = submission.kind === 'eoa-calls'
                ? { ...metadata, ...await captureEoaCallsSignedMetadata(
                    registry!, submission.attempt, transaction) }
                : metadata;
              guard();
              const context: EvmSubmissionContext = {
                account: { id: selected.index, type: signerType, address: selected.address },
                network: { kind: 'ethereum', chainId: Number(network.chainId), slip44: 60, url: network.rpcUrl },
                operation: 'send',
              };
              const boundary = sdk.captureEvmSubmission(context, guard, () => {
                const lifecycle = capturePayerSubmission(context, selectedContext, guard, submissionMetadata, undefined, verifyDispatch);
                return submission.kind === 'eoa-calls'
                  ? bindEoaCallsSignedLifecycle(lifecycle, registry!, submission.attempt) : lifecycle;
              });
              if (metadata) enteredPrivateSubmissions.add(metadata);
              const broadcast: Parameters<typeof sdk.submitSignedEvmTransaction<string>>[1] = async ({rawTransaction, admit}) => {
                if (validateSigningAndBroadcast !== null) await validateSigningAndBroadcast();
                guard();
                return sender.broadcastDapp(rawTransaction, signed.hash, transaction, signal, admit, guard, onBroadcast);
              };
              const work = hardwareSigner
                ? sdk.submitSignedHardwareEvmTransaction<string>(signed.rawTransaction, broadcast, boundary, undefined,
                    serializePreparedEvmTransaction(transaction), () => sender.verifyChain(signal, guard))
                : sdk.submitSignedEvmTransaction<string>(signed.rawTransaction, broadcast, boundary, undefined, serializePreparedEvmTransaction(transaction));
              const tracked = submission.kind === 'eoa-calls' ? settleEoaCallsSignedSubmission(work, registry!, submission.attempt) : work;
              const pending = tracked.finally(() => { pendingSubmissions.delete(pending); });
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
          return createNativeSignedRecordView(signedRecords,{keyring: transactionRecordKeyring(keyring, check),assertCurrent:check},walletBindingId,account,network);
        };
        const hydrate = async (captured: number, authenticatedPublic: Readonly<{ record: NativePublicSessionRecord; manifest: Uint8Array }>) => {
          current(captured);
          verifiedIdentity = null;
          const identity = await readIdentity(); current(captured);
          const admitted = await storage.recovery!.readSnapshot(); current(captured);
          assertNativeRecordDomains(admitted.records, identity.root?.profileId ?? null);
          if (
            !identity.root ||
            (authenticatedPair !== null && authenticatedPair !== identity.pairFingerprint)
          )
            throw new KeyringRuntimeError('CANCELLED');
          current(captured);
          const profileId = await keyring.getPrivateRecordAccess(transactionRecordDomains).getPrivateRecordProfileId(); current(captured);
          if (profileId !== identity.root.profileId) throw new KeyringRuntimeError('OPERATION_FAILED');
          slhPublicStates = nativePublicSessionSlhStates(authenticatedPublic.record);
          const saved = admitted.records.filter(row => parseSLHDSAStateStorageKey(row.key) !== null);
          if (saved.length !== slhPublicStates.size || saved.some(row => slhPublicStates.get(parseSLHDSAStateStorageKey(row.key)!)?.seal !== row.value))
            throw new KeyringRuntimeError('OPERATION_FAILED');
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
          if (authenticatedPublic) {
            const manifest = nativePublicSessionManifest(catalogue.privateRecords, identity, authenticatedPublic.record.slhStates);
            try {
              if (manifest.length !== authenticatedPublic.manifest.length || manifest.some((value, index) => value !== authenticatedPublic.manifest[index]))
                throw new KeyringRuntimeError('OPERATION_FAILED');
            } finally { manifest.fill(0); }
          }
          publishAccounts(next);
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          current(captured);
          await signedRecords.validate({keyring: transactionRecordKeyring(keyring, () => current(captured)),assertCurrent:()=>current(captured)}); current(captured);
          if (admitted.records.some(({ key }) => key === UTXO_SIGNED_RECORD_KEY)) {
            if (!utxoRecords) throw new KeyringRuntimeError('OPERATION_FAILED');
            await utxoRecords.validate({ keyring: transactionRecordKeyring(keyring, () => current(captured)), assertCurrent: () => current(captured) }); current(captured);
          }
          authenticatedPair = identity.pairFingerprint;
          verifiedIdentity = identity;
          revalidateLocalSmart();
        };
        const restorePublicView = async (captured: number, assertOwner: () => void) => {
          const ring = keyring, owned = new AbortController();
          secretOperations.set(owned, generation);
          const check = () => { current(captured); checkGuard(assertOwner); if (owned.signal.aborted || ring !== keyring) throw new KeyringRuntimeError('CANCELLED'); };
          let manifest: Uint8Array | undefined;
          try {
            check(); if (!credentialVault || !storage.recovery || ring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
            const identity = await readIdentity(); check();
            const snapshot = await storage.recovery.readSnapshot(); check();
            if (!identity.root || JSON.stringify(snapshot.identity) !== JSON.stringify(identity)) throw new KeyringRuntimeError('OPERATION_FAILED');
            const catalogueRow = snapshot.records.find(row => row.key === WALLET_CATALOGUE_KEY);
            const checkpointRow = snapshot.records.find(row => row.key === NATIVE_PUBLIC_SESSION_KEY);
            if (!catalogueRow || !checkpointRow) throw new KeyringRuntimeError('NOT_READY');
            const records = recoveryVerificationRecords(decodeAccountRecord(catalogueRow.value), identity.walletBindingId);
            const record = captureNativePublicSessionRecord(decodePublicSessionRecord(checkpointRow.value));
            const request = nativePublicSessionRestoreRequest(record, records, identity); manifest = request.publicState;
            await ring.restorePublicSession({ async withKey(sdkCheck, consume) {
              const guard = () => { check(); checkGuard(sdkCheck); check(); };
              await credentialVault.withPublicKey(guard, consume);
            } }, request, { signal: owned.signal, assertCurrent: check }, async authenticatedManifest => {
              check(); Object.assign(state, stateFor(records));
              authenticatedPair = identity.pairFingerprint; verifiedIdentity = null;
              await hydrate(captured, { record, manifest: authenticatedManifest }); check();
              currentPublicSessionRecord = record;
              trezorSessionGeneration = dependencies.trezorSessions?.advanceSessionGeneration() ?? 0;
            });
            check();
          } finally { manifest?.fill(0); secretOperations.delete(owned); owned.abort(); }
        };
        const createStoredWallet = async (
          phrase: string,
          captured: number
        ) => {
          const guard = () => current(captured);
          if (!credentialVault || !dependencies.credentialPort) throw new KeyringRuntimeError('NOT_READY');
          const capability = await dependencies.credentialPort.capabilities(null); guard();
          if (capability.deviceAuth !== 'ready') throw new KeyringRuntimeError('DEVICE_UNLOCK_UNAVAILABLE');
          const password = credentialVault.createSecret();
          const publicKey = credentialVault.createPublicKey();
          const lifetime = new AbortController(); secretOperations.set(lifetime, generation);
          let stagedCredential: NativeCredentialReference | null = null;
          try {
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
          assertNativeRecordDomains(admitted.records, admitted.identity?.root?.profileId ?? null);
          if (
            admitted.records.some((row) => row.key !== 'utf8Error') ||
            admitted.notes.length ||
            admitted.signedRecords.length
          )
            throw new KeyringRuntimeError('NOT_READY');
          let publicSession: NativePublicSessionRecord | null = null;
          const staged = await stageInitialWallet(
            { key: String(initialEvmNetwork.slip44), network: sdkEvmNetwork(initialEvmNetwork), password, phrase },
            { assertCurrent: guard, loadSdk: dependencies.loadSdk,
              fingerprintPair: pair => storage.recovery!.fingerprintPair!(pair),
              validateRetained: async ({ keyring: stagedKeyring, staged: value }) => {
                const fingerprint = await storage.recovery!.fingerprintPair!(value.pair); guard();
                const records = createNativeAccountRecord(value, fingerprint);
                const first = value.groups[0]!.accounts.HDAccount[0]!;
                publicSession = await createNativePublicSessionRecord(stagedKeyring, records, {
                  walletBindingId: fingerprint, pairFingerprint: fingerprint, verification: 'requires-unlock',
                  root: { address: first.address, publicKey: first.xpub.toLowerCase(), profileId: value.profileId },
                }, new Map(), publicKey, guard);
              },
            }
          );
          guard();
          const fingerprint = await storage.recovery.fingerprintPair(
            staged.pair
          );
          guard();
          const reference = credentialVault.createReference({ walletBindingId: fingerprint, pairFingerprint: fingerprint });
          stagedCredential = reference;
          const records = createNativeAccountRecord(staged, fingerprint);
          const first = staged.groups[0]!.accounts.HDAccount[0]!;
          if (!publicSession) throw new KeyringRuntimeError('NOT_READY');
          const plan = await storage.recovery.prepareCreation(
            admitted,
            { ...staged.pair, accountRecords: records, credential: reference, publicSession },
            {
              address: first.address,
              publicKey: first.xpub.toLowerCase(),
              profileId: staged.profileId,
            }, guard
          );
          await credentialVault.stage(reference, password, publicKey, { signal: lifetime.signal, assertCurrent: guard, purpose: 'account-change' });
          guard();
          const expected = storage.recovery.plannedSnapshot(plan);
          await storage.recovery.commitReplacement(plan, guard); guard();
              const observed = await storage.recovery.readSnapshot(); guard();
          if (!sameRecoverySnapshot(observed, expected))
            throw new KeyringRuntimeError('CLEANUP_FAILED');
          Object.assign(state, stateFor(records));
          await restorePublicView(captured, guard);
          guard();
          trezorSessionGeneration = dependencies.trezorSessions?.advanceSessionGeneration() ?? 0;
          } catch (error) {
            if (stagedCredential) await storage.credential.settleCredentialRemoval(async reference => {
              if (encodeStorageValue(reference) !== encodeStorageValue(stagedCredential)) throw new KeyringRuntimeError('CLEANUP_FAILED');
              await dependencies.credentialPort!.remove(reference);
            });
            credentialFailure(error);
          } finally { publicKey.fill(0); lifetime.abort(); secretOperations.delete(lifetime); }
        };
        const selectedAccount = () => {
          if (!catalogueSnapshot || !keyring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
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
        // This validates the caller's consent intent only. It is never OS proof;
        // every software signing/reveal path still performs its protected read.
        const authenticateOperation = async (credential: NativeOperationCredential, assertCurrent: () => void, signal: AbortSignal): Promise<void> => {
          assertDeviceConsent(credential, assertCurrent);
          await requestCredential('transaction', signal, assertCurrent);
        };
        const authorizeOperation = async (credential: NativeOperationCredential, assertCurrent: () => void, target: string): Promise<NativeOperationAuthorization> => {
          const captured = generation, ring = keyring, snapshot = catalogueSnapshot;
          const detached: NativeOperationCredential = Object.freeze({ method: 'device' });
          assertDeviceConsent(credential, assertCurrent);
          assertDeviceConsent(detached, assertCurrent);
          current(captured); checkGuard(assertCurrent);
          if (ring !== keyring || snapshot !== catalogueSnapshot) throw new KeyringRuntimeError('CANCELLED');
          const receipt = Object.freeze({}) as NativeOperationAuthorization;
          operationAuthorizations.set(receipt, { generation: captured, ring, snapshot, target, assertCurrent });
          return receipt;
        };
        const dataBinding = async (captured: number, guard: () => void = () => undefined): Promise<string> => {
          current(captured); checkGuard(guard);
          const identity = await readIdentity(); current(captured); checkGuard(guard);
          if (!keyring.hasPublicSession() || !verifiedIdentity || JSON.stringify(identity) !== JSON.stringify(verifiedIdentity))
            throw new KeyringRuntimeError('CANCELLED');
          return verifiedIdentity.walletBindingId;
        };
        const trezorOwner = async (captured: number, check: () => void, importing: boolean, target: SmartTrezorTarget | null): Promise<NativeTrezorHandoffOwner> => {
          const walletFingerprint = await dataBinding(captured, check); check();
          const snapshot = catalogueSnapshot!;
          const selected = importing ? undefined : selectedAccount();
          if (target !== null) {
            const smart = selected?.type === 'SmartAccount' ? state.accounts.SmartAccount[selected.index] : undefined;
            const owner = snapshot.accounts.find(account => account.id === target.ownerId);
            const saved = owner?.type === 'Trezor' ? state.accounts.Trezor[owner.index] : undefined;
            if (!selected || selected.id !== target.smartId || selected.address !== target.smartAddress || !smart?.smartAccount ||
                JSON.stringify(smart.smartAccount) !== target.cataloguePolicy || !owner || owner.type !== 'Trezor' || owner.slip44 !== 60 ||
                owner.index !== target.ownerIndex || owner.address !== target.ownerAddress || owner.label !== target.ownerLabel || !saved || saved.address !== target.ownerAddress || saved.xpub !== target.publicKey)
              throw new KeyringRuntimeError('CANCELLED');
          } else if (selected && selected.type !== 'Trezor') throw new KeyringRuntimeError('NOT_READY');
          const utxo = findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
          const network = utxo ?? getNativeNetwork(snapshot.active.networkId, snapshot.networks);
          return Object.freeze({ walletFingerprint,
            accountId: selected?.id ?? null, accountIndex: selected?.index ?? null, accountAddress: selected?.address ?? null,
            network: Object.freeze({ id: network.id, kind: utxo ? 'utxo' as const : 'evm' as const,
              chainId: String(network.chainId), slip44: utxo?.slip44 ?? 60,
              registrationHash: keyExportRegistrationHash(network.id, snapshot) }),
          });
        };
        const assertPendingTrezorOwner = async (captured: number, check: () => void) => {
          const pending = pendingTrezor;
          if (!pending || dependencies.trezorSessions?.getSnapshot()?.job !== pending.job)
            throw new KeyringRuntimeError('NOT_READY');
          let owner: NativeTrezorHandoffOwner;
          try { owner = await trezorOwner(captured, check, pending.operation === 'import', pending.target); check(); }
          catch (error) { if (pendingTrezor === pending) await cancelTrezor(); throw error; }
          if (pending !== pendingTrezor || JSON.stringify(owner) !== JSON.stringify(pending.owner)) {
            await cancelTrezor();
            throw new KeyringRuntimeError('CANCELLED');
          }
          return pending;
        };
        const admitTrezorAttempt = async (captured: number, check: () => void,
          operation: 'import' | 'send' | 'utxo-send' | 'external-psbt' | 'external-signing' | 'smart-operation' | 'infrastructure', label: string,
          resume: NativeTrezorResumeIntent | undefined, target: SmartTrezorTarget | null,
          beforeSuiteOpen: ((expiresAt: number, job: object) => (opened: boolean) => void) | undefined) => {
          clearCredentialMaterial();
          const sessions = dependencies.trezorSessions;
          if (!sessions || !trezorSessionGeneration || trezorSession) throw new KeyringRuntimeError('NOT_READY');
          await localSmartHandoffs.retired();
          check();
          await trezorCleanup;
          check();
          const owner = await trezorOwner(captured, check, operation === 'import', target); check();
          const existing = pendingTrezor;
          if (existing && (existing.operation !== operation || !existing.accepted ||
              JSON.stringify(existing.owner) !== JSON.stringify(owner) || JSON.stringify(existing.target) !== JSON.stringify(target) ||
              (resume && JSON.stringify(existing.resume) !== JSON.stringify(resume)))) {
            await cancelTrezor();
            throw new TrezorReviewChangedError();
          }
          const session = existing
            ? sessions.resume({ job: existing.job, owner, sessionGeneration: trezorSessionGeneration, accepted: true, assertCurrent: check, beforeSuiteOpen })
            : sessions.start({ owner, workflow: operation === 'import' ? 'import' : 'send', expiresAt: Date.now() + 5 * 60_000,
                sessionGeneration: trezorSessionGeneration, assertCurrent: check, beforeSuiteOpen });
          const snapshot = catalogueSnapshot!;
          const selected = snapshot.accounts.find(account => account.id === snapshot.active.accountId);
          const network = findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks) ?? getNativeNetwork(snapshot.active.networkId, snapshot.networks);
          pendingTrezor = existing ?? { owner, job: session.job, label, networkLabel: network.name,
            accountLabel: operation === 'import' ? label : selected?.label ?? '', operation, resume, target, accepted: false };
          pendingTrezor.accepted = false;
          trezorError = null;
          trezorSession = session;
          publishTrezor();
          return session;
        };
        const openTrezorAttempt = async (captured: number, check: () => void,
          operation: 'import' | 'send' | 'utxo-send' | 'external-psbt' | 'external-signing' | 'smart-operation' | 'infrastructure', label: string, resume: NativeTrezorResumeIntent | undefined,
          transferred: (source: IndexedKeyring, target: IndexedKeyring, session: NativeTrezorSession) => void,
          beforeSuiteOpen?: (expiresAt: number, job: object) => (opened: boolean) => void) => {
          clearCredentialMaterial();
          const session = await admitTrezorAttempt(captured, check, operation, label, resume, null, beforeSuiteOpen); check();
          const source = keyring, target = openKeyring(state, session.host);
          try {
            check();
            const transfer = await source.prepareSessionTransfer(target, check); check();
            transfer.transfer();
            keyring = target;
            trezorWorker = target;
            checkGuard(() => transferred(source, target, session));
            await source.destroy(); check();
            return { session, ring: target };
          } catch (error) {
            await (keyring === target ? target.lockWallet() : target.destroy()).catch(() => undefined);
            await cancelTrezor();
            throw error;
          }
        };
        const finishTrezor = async (session: NativeTrezorSession, check: () => void) => {
          check();
          if (trezorSession !== session) throw new KeyringRuntimeError('CANCELLED');
          const device = trezorDeviceWorker;
          await session.finish(); check();
          await device?.retire().then(assertRetired => assertRetired()); check();
          trezorSession = undefined; trezorWorker = undefined; trezorDeviceWorker = undefined; pendingTrezor = undefined;
          publishTrezor();
        };
        const failTrezor = async (captured: number, admittedEpoch: number, error?: unknown) => {
          if (admittedEpoch !== trezorEpoch) {
            if (error instanceof TrezorReviewChangedError && !pendingTrezor && !dependencies.trezorSessions?.getSnapshot()) {
              trezorError = error.message; publishTrezor();
            }
            return;
          }
          // Background lock already revoked the SDK invocation. Only its public
          // transcript survives; the next attempt must use a newly unlocked owner.
          if (captured !== generation && dependencies.trezorSessions?.getSnapshot()) return;
          await cancelTrezor();
          trezorError = error instanceof TrezorReviewChangedError ? error.message : 'Could not complete the Trezor request. Try again.';
          publishTrezor();
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
              storage: checkpointStorage, walletBindingId, assertOwner,
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
            try { await revokeCustody('revoke'); } catch { /* The owner remains quarantined. */ }
          }
        };
        const runPrivateDomain = async <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          assertPrivateDomainAvailable();
          const captured = generation;
          const credentialAction = beginCredentialAction(captured);
          const recordAction: PrivateRecordAction = { policy: 'action', generation: captured, ring: keyring, verified: false, closed: false, signal: new AbortController(), tail: Promise.resolve() };
          privateRecordAction = recordAction;
          let resolve!: (result: Promise<T>) => void, reject!: (error: unknown) => void;
          const task = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; }).finally(async () => {
            endCredentialAction(credentialAction);
            recordAction.closed = true; recordAction.signal.abort();
            if (privateRecordAction === recordAction) privateRecordAction = null;
            await recordAction.tail;
            if (!recordAction.retained) recordAction.access?.dispose();
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
        const privateDomainWalletSession = (captured: number, policy: PrivateRecordAction['policy'], authentication: NativePrivateAuthentication | null = null): IPrivateVaultSession => {
          const ring = keyring, identity = verifiedIdentity;
          const assertUnlocked = ring.capturePublicSessionGuard();
          const assertCurrent = () => {
            if (authentication) assertNativePrivateAuthentication(authentication);
            current(generation);
            checkGuard(assertUnlocked);
            if (!identity?.root || verifiedIdentity !== identity || keyring !== ring || !ring.hasPublicSession() ||
                authenticatedPair !== identity.pairFingerprint ||
                verifiedIdentity?.walletBindingId !== identity.walletBindingId ||
                verifiedIdentity.root?.profileId !== identity.root.profileId)
              throw new KeyringRuntimeError('CANCELLED');
          };
          assertCurrent();
          const unavailable = () => Promise.reject(new KeyringRuntimeError('NOT_READY'));
          const baseKeyring: IPrivateVaultSession['keyring'] = Object.freeze({
            getPrivateRecordProfileId: unavailable, encryptPrivateRecord: unavailable, decryptPrivateRecord: unavailable,
          });
          privateRecordOwners.set(baseKeyring, ring);
          const acknowledgement: PrivateRecordAction | null = policy === 'acknowledgement'
            ? { policy, generation: captured, ring, verified: true, closed: false, signal: new AbortController(), tail: Promise.resolve() } : null;
          const session = Object.freeze({ generation: captured, keyring: baseKeyring, assertCurrent,
            captureOperation: (guard: () => void) => {
              assertCurrent(); checkGuard(guard);
              const action = policy === 'action' ? privateRecordAction : acknowledgement;
              if (!action || action.closed || action.ring !== ring || action.generation !== captured ||
                  (policy === 'acknowledgement' && !action.access)) throw new KeyringRuntimeError('NOT_READY');
              const check = () => {
                assertCurrent(); checkGuard(guard);
                if ((policy === 'action' && privateRecordAction !== action) || action.closed) throw new KeyringRuntimeError('CANCELLED');
              };
              check();
              return createPrivateVaultSession({ generation: captured, keyring: privateRecordKeyring(ring, check, action, authentication), assertCurrent: check });
            },
          });
          if (acknowledgement) privateAcknowledgements.set(session, acknowledgement);
          return session;
        };
        const privateAcknowledgement = (captured: number) => {
          const session = privateDomainWalletSession(captured, 'acknowledgement');
          const action = privateAcknowledgements.get(session)!;
          let submissions = 0, disposalRequested = false;
          const settle = () => { action.access?.dispose(); action.access = undefined; };
          const dispose = () => { action.closed = true; action.signal.abort(); settle(); privateAcknowledgements.delete(session); };
          return Object.freeze({ session, settle,
            retain() {
              session.assertCurrent();
              const source = privateRecordAction;
              if (action.closed || action.access || !source?.access || source.closed || source.generation !== captured || source.ring !== action.ring)
                throw new KeyringRuntimeError('CANCELLED');
              action.access = source.access; source.retained = true;
            },
            async run<T>(operation: () => Promise<T>): Promise<T> {
              if (action.closed || disposalRequested) throw new KeyringRuntimeError('CANCELLED');
              submissions++;
              const pending = Promise.resolve().then(operation).finally(() => {
                submissions--;
                if (!submissions) { settle(); if (disposalRequested) dispose(); }
              });
              privateConfirmationWork.add(pending);
              try { return await pending; }
              finally { privateConfirmationWork.delete(pending); }
            },
            dispose() { disposalRequested = true; if (!submissions) dispose(); },
          });
        };
        const privateDomainSession = (captured: number, assertOwner: () => void, authentication: NativePrivateAuthentication | null = null): IPrivateVaultSession => {
          const wallet = privateDomainWalletSession(captured, 'action', authentication), revision = catalogueSnapshot?.revision;
          const assertCurrent = () => {
            current(captured); wallet.assertCurrent(); checkGuard(assertOwner); current(captured); wallet.assertCurrent();
            if (catalogueSnapshot?.revision !== revision || revision === undefined)
              throw new KeyringRuntimeError('CANCELLED');
          };
          assertCurrent();
          return Object.freeze({ ...wallet, assertCurrent });
        };
        const getSlhDsa = async (captured: number) => {
          current(captured);
          if (slhCapability === null || !verifiedIdentity?.root)
            throw new KeyringRuntimeError('NOT_READY');
          await slhRetirement;
          current(captured);
          if (!slhDsa) {
            const session = privateDomainWalletSession(captured, 'action');
            const profileId = verifiedIdentity.root.profileId;
            slhDsa = createNativeSlhDsaRuntime({
              namespace: profileId, publicStates: slhPublicStates, storage: checkpointStorage,
              async authorize(purpose, accountIndex, signal, assertRequest, work, authentication) {
                let access: NativeRecordAccess | undefined;
                try {
                  return await withSoftwareSecret(purpose === 'sign' ? 'transaction' : 'account-change', signal,
                    () => { current(captured); checkGuard(assertRequest); }, async () => {
                      access = await keyring.createPrivateRecordAccess([SLH_DSA_PROFILE_STATE_DOMAIN], { transferable: false });
                      const setup = accountIndex === null ? null : await keyring.deriveSLHDSASetupSecretForAccount({ accountIndex });
                      try { return await work(Object.freeze({ setup, crypto: access, dispose() { access?.dispose(); access = undefined; } })); }
                      finally { access?.dispose(); access = undefined; }
                    }, null, null, authentication ? { authentication, assertCurrent: () => current(captured) } : null);
                } catch (error) { access?.dispose(); throw error; }
              },
              assertCurrent: session.assertCurrent, openExecution: slhCapability.open,
              onStorageFault: () => { requirePrivateDomainReopen(); void finalizePrivateDomain().catch(() => undefined); },
              now: Date.now,
            });
          }
          return slhDsa;
        };
        const slhDsaSigningPort = (
          captured: number, metadata: ISmartAccountMetadata, accountId: number, actionHash: string,
          assertDelivery: () => void, approval: SLHDSADispatchApproval | null, signal: AbortSignal, authentication: NativePrivateAuthentication | null
        ): NonNullable<SmartAccountAuthenticatorPorts['slhDsa']> => {
          if (slhCapability === null) throw new KeyringRuntimeError('NOT_READY');
          const seal = JSON.stringify({ auth: metadata.auth, installedModules: metadata.installedModules });
          const check = () => {
            current(captured); checkGuard(assertDelivery);
            if (JSON.stringify({ auth: metadata.auth, installedModules: metadata.installedModules }) !== seal)
              throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          return Object.freeze({
            signMessageActionHash: null,
            signActionHash(input) {
              const request = Object.freeze({ ...input });
              check();
              if (request.actionHash !== actionHash || request.accountId !== accountId)
                throw new KeyringRuntimeError('CANCELLED');
              // The shared dispatcher selects the actual child and supplies its
              // canonical config. Unused installed keys never gate another child.
              const installed = metadata.installedModules?.find((module): module is Extract<SmartAccountValidatorModule, { id: 'slh-dsa' }> =>
                module.type === 'validator' && module.id === 'slh-dsa' && module.config.keyId === request.keyId);
              if (!installed || installed.config.parameterSet !== request.parameterSet ||
                  normalizeSLHDSAPublicKeyField(installed.config.pkRoot) !== normalizeSLHDSAPublicKeyField(request.pkRoot) ||
                  normalizeSLHDSAPublicKeyField(installed.config.pkSeed) !== normalizeSLHDSAPublicKeyField(request.pkSeed))
                throw new KeyringRuntimeError('CANCELLED');
              const key: NativeSlhInstalledKey = Object.freeze({ keyId: request.keyId, parameterSet: request.parameterSet,
                pkRoot: request.pkRoot, pkSeed: request.pkSeed });
              const work = (async () => {
                const runtime = await getSlhDsa(captured); check();
                await runtime.hydrateInstalled(key, check); check();
                return runtime.signActionHash(request, approval, check, signal, authentication);
              })();
              const pending = work.finally(() => { pendingSubmissions.delete(pending); });
              pendingSubmissions.add(pending);
              return pending;
            },
          });
        };
        const openSlhDsaAccount = async (assertOwner: () => void, signal: AbortSignal, authentication: NativePrivateAuthentication | null): Promise<NativeSlhDsaAccount> => {
          if (authentication !== null) assertNativePrivateAuthentication(authentication);
          const captured = generation, before = catalogueSnapshot, selected = selectedAccount();
          const account = selected.type === 'SmartAccount' ? state.accounts.SmartAccount[selected.index] : undefined;
          const metadata: ISmartAccountMetadata | undefined = account?.smartAccount;
          const network = before?.networks.find(entry => entry.id === before.active.networkId);
          if (!before || !account || !metadata || !network || selected.slip44 !== 60 || metadata.chainId !== Number(network.chainId)) throw new KeyringRuntimeError('NOT_READY');
          requireSmartAccountAddressIdentity(account, Number(network.chainId));
          const descriptor = metadata.descriptor;
          if (!descriptor || !Number.isSafeInteger(descriptor.accountIndex) || descriptor.accountIndex < 0)
            throw new KeyringRuntimeError('NOT_READY');
          const accountIndex = descriptor.accountIndex;
          const seal = JSON.stringify({ auth: metadata.auth, installedModules: metadata.installedModules, descriptor });
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (signal.aborted || catalogueSnapshot !== before || state.accounts.SmartAccount[selected.index] !== account || account.smartAccount !== metadata || metadata.descriptor !== descriptor ||
                JSON.stringify({ auth: metadata.auth, installedModules: metadata.installedModules, descriptor: metadata.descriptor }) !== seal)
              throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          const runtime = await getSlhDsa(captured); check();
          const installed = metadata.installedModules?.filter((module): module is Extract<SmartAccountValidatorModule, { id: 'slh-dsa' }> => module.type === 'validator' && module.id === 'slh-dsa') ?? [];
          const installedKeys = Object.freeze(installed.map(({ config }) => Object.freeze({ keyId: config.keyId, parameterSet: config.parameterSet,
            pkRoot: normalizeSLHDSAPublicKeyField(config.pkRoot), pkSeed: normalizeSLHDSAPublicKeyField(config.pkSeed) })));
          const expectedKey = (keyId: string) => {
            check();
            const key = installedKeys.find(key => key.keyId === keyId);
            if (!key) throw new KeyringRuntimeError('NOT_READY');
            return key;
          };
          const track = <T>(operation: () => Promise<T>) => {
            check();
            const work = Promise.resolve().then(operation);
            const pending = work.finally(() => { pendingSubmissions.delete(pending); });
            pendingSubmissions.add(pending);
            return pending;
          };
          return Object.freeze({
            installedKeys,
            readPrepared: () => track(async () => {
              const snapshot = await storage.recovery!.readSnapshot(); check();
              if (snapshot.identity?.root?.profileId !== verifiedIdentity?.root?.profileId) throw new KeyringRuntimeError('CANCELLED');
              const prepared = [];
              for (const row of snapshot.records) {
                const keyId = parseSLHDSAStateStorageKey(row.key);
                if (keyId === null || installedKeys.some(key => key.keyId === keyId)) continue;
                const entry = await runtime.inspectPrepared(keyId, accountIndex, check); check();
                if (entry) prepared.push(entry);
              }
              return Object.freeze(prepared);
            }),
            rebuildPrepared: (keyId, progress) => track(async () => {
              const prepared = await runtime.inspectPrepared(keyId, accountIndex, check); check();
              if (!prepared || installedKeys.some(key => key.keyId === keyId)) throw new KeyringRuntimeError('NOT_READY');
              return runtime.rebuildInstalled(prepared, check, progress, signal, authentication);
            }),
            prepareFresh(progress) {
              check();
              const auth = requireSmartAccountAuthenticator(metadata);
              const activeModule = getInstalledValidatorModuleByAddress(metadata, auth.validator);
              if (getInstalledValidatorModule(metadata, 'slh-dsa') || auth.module === 'slh-dsa' ||
                  (auth.module === 'composite' && (!activeModule || !isPaliSignableValidator(activeModule, metadata, isPaliValidatorAlgorithmSupported))))
                throw new KeyringRuntimeError('NOT_READY');
              return track(() => runtime.prepareFresh(accountIndex, check, progress, signal, authentication));
            },
            hydrateInstalled: keyId => track(() => runtime.hydrateInstalled(expectedKey(keyId), check)),
            rebuildInstalled: (keyId, progress) => track(() => runtime.rebuildInstalled(expectedKey(keyId), check, progress, signal, authentication)),
            signActionHash(input, approval, assertDelivery) {
              const request = Object.freeze({ ...input });
              const key = expectedKey(request.keyId);
              if (normalizeSLHDSAPublicKeyField(request.pkRoot) !== normalizeSLHDSAPublicKeyField(key.pkRoot) || normalizeSLHDSAPublicKeyField(request.pkSeed) !== normalizeSLHDSAPublicKeyField(key.pkSeed) ||
                  request.parameterSet !== key.parameterSet || (request.accountId !== undefined && request.accountId !== account.id))
                throw new KeyringRuntimeError('CANCELLED');
              const delivery = () => { check(); checkGuard(assertDelivery); };
              return track(() => runtime.signActionHash(request, approval, delivery, signal, authentication));
            },
          });
        };
        const getSentryKeyNetwork = (): SentryNetwork | undefined => {
          if (!keyring.hasPublicSession() || !catalogueSnapshot) return undefined;
          const registration = findUtxoNetwork(
            catalogueSnapshot.active.networkId, catalogueSnapshot.utxoNetworks
          );
          return (Object.keys(SENTRY_NETWORKS) as SentryNetwork[]).find((name) =>
            registration?.chainId === SENTRY_NETWORKS[name].chainId &&
            registration.genesisHash === SENTRY_NETWORKS[name].genesisHash
          );
        };
        const bindSentryNodes = async (captured: number, assertCurrent: () => void) => {
          current(captured); checkGuard(assertCurrent);
          const identity = verifiedIdentity, snapshot = catalogueSnapshot;
          const network = getSentryKeyNetwork();
          if (!storage.sentryNodes || !identity?.root || !snapshot || !network)
            throw new KeyringRuntimeError('NOT_READY');
          const rootPublicIdentity = sentryRootPublicIdentity(catalogue.privateRecords, network);
          const vaultId = await deriveSentryVaultId(rootPublicIdentity, async bytes =>
            new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
          current(captured); checkGuard(assertCurrent);
          const scope = {network,vaultId,profileId:identity.root.profileId,walletBindingId:identity.walletBindingId,pairFingerprint:identity.pairFingerprint};
          return {scope,rootPublicIdentity,coordinator:sentryCollateralCoordinator,
            storage:storage.sentryNodes.bind(scope,assertCurrent),assertCurrent};
        };
        const openSentryNodeManagement: NonNullable<KeyringRuntime['openSentryNodeManagement']> = (lifetime,assertOwner,authentication) =>
          runPrivateDomain(async captured => {
            if (!dependencies.utxoFetch || typeof assertOwner !== 'function' ||
                typeof lifetime?.aborted !== 'boolean' || typeof lifetime.addEventListener !== 'function' || typeof lifetime.removeEventListener !== 'function')
              throw new KeyringRuntimeError('NOT_READY');
            const session = privateDomainSession(captured,()=>{
              if(lifetime.aborted)throw new KeyringRuntimeError('CANCELLED');checkGuard(assertOwner);
            });
            const bound=await bindSentryNodes(captured,session.assertCurrent);
            session.assertCurrent();retireSentryKeys();
            const settingsKey=sentrySettingsStorageKey(bound.scope.vaultId,bound.scope.network);
            sentryNodes=createNativeSentryNodeManagement({...bound,lifetime,fetch:dependencies.utxoFetch,
              async readSettings(){session.assertCurrent();const value=await storage.keyringStorage.get(settingsKey);session.assertCurrent();return value;},
              isAuthenticating() {
                try { return !!authentication && nativePrivateAuthenticationScope(authentication).isAuthenticating(); }
                catch { return false; }
              },
              async authenticate(assertCurrent) {
                const check = () => { session.assertCurrent(); checkGuard(assertCurrent); };
                const checkOwnership = () => { current(captured); if (lifetime.aborted) throw new KeyringRuntimeError('CANCELLED');
                  if (authentication) assertNativePrivateAuthentication(authentication); };
                if (authentication) await withNativePrivateAuthentication(authentication, lifetime, checkOwnership,
                  signal => requestCredential('account-change', signal, check));
                else await requestCredential('account-change', lifetime, check);
                check();
              },
              run:operation=>runPrivateDomain(async()=>{
                try{return await operation();}catch(error){
                  if(error instanceof KeyringRuntimeError)throw error;
                  if(error instanceof WalletStorageError){
                    if(error.code==='STORAGE_REOPEN_REQUIRED')requirePrivateDomainReopen();
                    if(error.code==='AUTH_THROTTLED')throw new KeyringRuntimeError(error.code);
                    if(error.code==='STORAGE_CHANGED')throw new KeyringRuntimeError('CANCELLED');
                  }
                  throw new KeyringRuntimeError('OPERATION_FAILED');
                }
              }),
            });
            return sentryNodes;
          });
        const openSentryApprovals: NonNullable<KeyringRuntime['openSentryApprovals']> = (lifetime, assertOwner, authentication) =>
          runPrivateDomain(async captured => {
            const runCrypto = dependencies.runSentryCrypto;
            if (!storage.sentryKeys || !dependencies.utxoFetch || typeof runCrypto !== 'function' || typeof assertOwner !== 'function' ||
                typeof lifetime?.aborted !== 'boolean' || typeof lifetime.addEventListener !== 'function' || typeof lifetime.removeEventListener !== 'function')
              throw new KeyringRuntimeError('NOT_READY');
            const session = privateDomainSession(captured, () => {
              if (lifetime.aborted) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertOwner);
            });
            const bound = await bindSentryNodes(captured, session.assertCurrent);
            session.assertCurrent();
            const snapshot = catalogueSnapshot!, selected = selectedAccount(), ring = keyring;
            const network = findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            if (!network) throw new KeyringRuntimeError('NOT_READY');
            const sdkNetwork = getUtxoSdkNetwork(network), account = state.accounts[selected.type][selected.index]!;
            const checkOwnership = () => {
              current(captured);
              if (authentication) assertNativePrivateAuthentication(authentication);
              if (lifetime.aborted) throw new KeyringRuntimeError('CANCELLED');
              const actual = state.activeNetwork;
              if (catalogueSnapshot !== snapshot || keyring !== ring || state.accounts[selected.type][selected.index] !== account ||
                  state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type ||
                  actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId || actual.slip44 !== sdkNetwork.slip44 ||
                  actual.url !== sdkNetwork.url || actual.utxoBackendChain !== sdkNetwork.utxoBackendChain)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const check = () => { session.assertCurrent(); checkOwnership(); };
            check();
            const readJson = createNativeSentryJsonReader({assertCurrent: check, lifetime, fetch: dependencies.utxoFetch});
            const settingsKey = sentrySettingsStorageKey(bound.scope.vaultId, bound.scope.network);
            const owned = storage.sentryKeys.bind(bound.scope, check);
            const walletAuthority = createNativeSentryWalletAuthority({
              account: {address: account.address, xpub: account.xpub}, accountId: selected.index,
              assertCurrent: check, imported: selected.type === 'Imported', network,
              readJson: (url, limit, requestCheck) => readJson(url, limit, requestCheck, lifetime),
              hasPrivateMaterial: ['HDAccount', 'Imported'].includes(selected.type) && typeof account.xprv === 'string' && !!account.xprv,
            });
            check(); retireSentryKeys();
            sentryApprovals = createNativeSentryApprovals({
              assertCurrent: check, lifetime, collateral: createNativeSentryCollateral({...bound, assertCurrent: check}),
              network: bound.scope.network, nodeStorage: bound.storage, vaultHost: {...owned, crypto: () => crypto},
              vaultId: bound.scope.vaultId, readJson, walletAuthority, runCrypto,
              scope: {identity: crypto.randomUUID(), rootPublicIdentity: bound.rootPublicIdentity,
                network: {chainId: network.chainId, kind: sdkNetwork.kind, url: network.endpoint}},
              async readSettings() {check(); const value = await storage.keyringStorage.get(settingsKey); check(); return value;},
              isAuthenticating: () => {
                try { return !!authentication && nativePrivateAuthenticationScope(authentication).isAuthenticating(); }
                catch { return false; }
              },
              async withSigningMaterial(request, work) {
                const guard = () => { check(); checkGuard(request.assertCurrent); check();
                  if (request.signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
                guard();
                if (!isHostWalletAuthentication(request.authentication) ||
                    !['HDAccount', 'Imported'].includes(selected.type)) throw new KeyringRuntimeError('INVALID_INPUT');
                return withSoftwareSecret('transaction', request.signal, guard, async secret => {
                  let seed = '', privateAccount: string | null = null;
                  try {
                    seed = await ring.getSeed(secret); guard();
                    if (typeof seed !== 'string' || !ring.isSeedValid(seed)) throw new KeyringRuntimeError('OPERATION_FAILED');
                    if (request.walletAuthorities.length) {
                      privateAccount = await ring.getPrivateKeyByAccountId(selected.index,
                        selected.type === 'HDAccount' ? sdk.KeyringAccountType.HDAccount : sdk.KeyringAccountType.Imported, secret);
                      guard();
                    }
                    return await work(seed, privateAccount);
                  } finally { seed = ''; privateAccount = null; }
                }, null, null, authentication ? { authentication, assertCurrent: checkOwnership } : null);
              },
              run: operation => runPrivateDomain(async () => {
                try {check(); const result = await operation(); check(); return result;}
                catch (error) {
                  if (error instanceof KeyringRuntimeError) throw error;
                  if (error instanceof WalletStorageError) {
                    if (error.code === 'STORAGE_REOPEN_REQUIRED') requirePrivateDomainReopen();
                    if (error.code === 'AUTH_THROTTLED') throw new KeyringRuntimeError(error.code);
                    if (error.code === 'STORAGE_CHANGED') throw new KeyringRuntimeError('CANCELLED');
                  }
                  throw new KeyringRuntimeError('OPERATION_FAILED');
                }
              }),
            });
            return sentryApprovals;
          });
        const openSentryKeyManagement: NonNullable<
          KeyringRuntime['openSentryKeyManagement']
        > = (lifetime, assertOwner, authentication) =>
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
            }, authentication);
            const checkOwnership = () => {
              current(captured);
              if (lifetime.aborted) throw new KeyringRuntimeError('CANCELLED');
              assertNativePrivateAuthentication(authentication);
            };
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
              async authenticate(assertCurrent, signal) {
                assertCurrent();
                await withNativePrivateAuthentication(authentication, signal, checkOwnership,
                  owned => requestCredential('account-change', owned, assertCurrent));
                assertCurrent();
              },
              derivePublicKey,
              lifetime,
              network,
              async readSeed(assertCurrent, signal) {
                assertCurrent();
                const phrase = await withSoftwareSecret('secret-read', signal, assertCurrent, secret => keyring.getSeed(secret), null, null,
                  { authentication, assertCurrent: checkOwnership });
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
        const openNotes = <T>(assertOwner: () => void, bind: (notes: NoteRuntime, session: IPrivateVaultSession) => T | Promise<T>, authentication: NativePrivateAuthentication | null) => runPrivateDomain(async (captured): Promise<T> => {
          if (authentication !== null) assertNativePrivateAuthentication(authentication);
          const session = privateDomainSession(captured, assertOwner, authentication);
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
                if (isHostWalletAuthentication(password)) {
                  if (privateRecordOwners.get(request.keyring) !== keyring) throw new KeyringRuntimeError('CANCELLED');
                  const operation = request.captureOperation(request.assertCurrent);
                  const authorize = privateRecordAuthorizers.get(operation.keyring);
                  if (!authorize) throw new KeyringRuntimeError('CANCELLED');
                  try { await authorize(); }
                  catch (error) {
                    if (error instanceof WalletStorageError && error.code === 'STORAGE_REOPEN_REQUIRED') requirePrivateDomainReopen();
                    if (error && typeof error === 'object' && secretAuthenticationRefusals.has(error))
                      throw new Error('BACKUP_AUTHENTICATION_FAILED');
                    throw error;
                  }
                  operation.assertCurrent();
                  request.assertCurrent();
                  return reveal();
                }
                throw new Error('BACKUP_AUTHENTICATION_FAILED');
              },
            });
          }
          return bind(noteBackups, session);
        });
        const openNoteBackup: NonNullable<KeyringRuntime['openNoteBackup']> = (assertOwner, authentication) =>
          openNotes(assertOwner, (notes, session) => notes.bind(session), authentication);
        const openNoteCapacity: NonNullable<KeyringRuntime['openNoteCapacity']> = (assertOwner, authentication) =>
          openNotes(assertOwner, (notes, session) => notes.bindCapacity(session), authentication);
        const openPrivacyControls: NonNullable<KeyringRuntime['openPrivacyControls']> = (signal, assertOwner) =>
          openNotes(assertOwner, (_notes, session) => {
            const captured = generation, snapshot = catalogueSnapshot, selected = selectedAccount();
            const network = snapshot && getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            const settings = dependencies.privacyServiceSettings;
            if (!network || network.chainId !== '1' || !settings || !openPrivacyPool) throw new KeyringRuntimeError('NOT_READY');
            const check = () => {
              current(captured); session.assertCurrent(); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot !== snapshot || selectedAccount() !== selected) throw new KeyringRuntimeError('CANCELLED');
            };
            return createNativePrivacyControls({ settings, signal, assertCurrent: check, invalidate: () => privacyLifecycle.invalidate(),
              openPool: (poolId, ownerSignal, guard) => openPrivacyPool(network, poolId, ownerSignal, guard) });
          }, null);
        const openNoteMaintenanceUnowned: NonNullable<KeyringRuntime['openNoteMaintenance']> = (signal, assertOwner, authentication) =>
          openNotes(assertOwner, (notes, session) => {
            const captured = generation, snapshot = catalogueSnapshot, selected = selectedAccount();
            const network = snapshot && getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            if (!network || network.chainId !== '1') throw new KeyringRuntimeError('NOT_READY');
            const check = () => {
              current(captured); session.assertCurrent(); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot !== snapshot || selectedAccount() !== selected) throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            const proofs = createNativeNoteMaintenanceProofs({ network, signal, assertCurrent: check,
              rpc: new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch }) });
            return notes.bindMaintenance(session, proofs);
          }, authentication);
        const openNoteMaintenance: NonNullable<KeyringRuntime['openNoteMaintenance']> = (signal, guard, authentication) =>
          privacyLifecycle.open(signal, guard, (ownerSignal, check) => openNoteMaintenanceUnowned(ownerSignal, check, authentication), view => view.dispose(), (view, dispose) => Object.freeze({ ...view, dispose }));
        const readNoteInventory: NonNullable<KeyringRuntime['readNoteInventory']> = (assertOwner, authentication) =>
          openNotes(assertOwner, (notes, session) => {
            const network = catalogueSnapshot?.networks.find(item => item.id === catalogueSnapshot!.active.networkId);
            const openPool = openPrivacyPool;
            const selected = selectedAccount();
            const account = state.accounts[selected.type][selected.index];
            return notes.readInventory(session, network?.chainId === '1' && openPool ? async (id, poolId, guard) => {
              const lifetime = new AbortController();
              const pool = await openOwnedPrivatePool(poolId,
                (selected, signal) => openPool(network, selected, signal, guard), lifetime.signal, guard);
              try { await pool.refresh(); guard(); return await notes.readNoteStatus(session, id, pool.readNote); }
              finally { lifetime.abort(); await pool.dispose(); }
            } : null, network?.chainId === '1' && openPool && dependencies.openPrivacyWithdrawal && supportsPrivateWithdrawal(selected.type, account)
              ? (id, poolId, restored, signal, guard, scope) => openPrivateWithdrawal(id, poolId, restored, signal, guard, bindNativePrivateAuthenticationChild(authentication, scope))
              : null, (id, guard, scope) => openNotes(guard,
                (ownedNotes, ownedSession) => ownedNotes.reveal(ownedSession, id),
                bindNativePrivateAuthenticationChild(authentication, scope)));
          }, authentication);
        const openPrivateWithdrawalUnowned = async (
          noteId: string,
          poolId: PrivacyPoolId,
          restored: boolean,
          signal: AbortSignal,
          assertOwner: () => void,
          authentication: NativePrivateAuthentication
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
            const openPool = openPrivacyPool;
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
            const acknowledgement = privateAcknowledgement(captured);
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
              const vault = notes.openWithdrawal(
                { ...session, assertCurrent: check },
                acknowledgement,
                ownedPool.readNote
              );
              const rpc = new EvmTransferReadRpc(network, {
                fetch: dependencies.connectionFetch ?? walletFetch,
              });
              const planner = createNativeAutomaticNoncePlanner(
                signedRecords,
                { keyring: transactionRecordKeyring(keyring, check), assertCurrent: check },
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
                              { kind: 'fixed', gasLimit: PRIVACY_WITHDRAWAL_GAS }, null, null, authentication
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
                              () => undefined, { kind: 'transaction' }
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
                  async reviewRestored() {
                    await ownedPool.refresh();
                    check();
                    return vault.reviewRestored(noteId);
                  },
                  async close() {
                    lifetime.abort();
                    acknowledgement.dispose();
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
              const confirm = withdrawal.confirm.bind(withdrawal);
              withdrawal.confirm = id => acknowledgement.run(() => confirm(id));
              return withdrawal;
            } catch (error) {
              lifetime.abort();
              acknowledgement.dispose();
              signal.removeEventListener('abort', abort);
              try {
                await pool?.dispose();
              } finally {
                await finalizePrivateDomain();
              }
              throw error;
            }
          }, authentication);
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
        const openPrivateWithdrawal = (noteId: string, poolId: PrivacyPoolId, restored: boolean, signal: AbortSignal, guard: () => void, authentication: NativePrivateAuthentication) =>
          privacyLifecycle.open(signal, guard, (ownerSignal, check) => openPrivateWithdrawalUnowned(noteId, poolId, restored, ownerSignal, check, authentication), view => view.dispose(), (view, dispose) => Object.freeze({
            getSnapshot: view.getSnapshot.bind(view), subscribe: view.subscribe.bind(view), prepare: view.prepare.bind(view),
            confirm: view.confirm.bind(view), refresh: view.refresh.bind(view), loadRelayers: view.loadRelayers.bind(view),
            reviewRestored: view.reviewRestored.bind(view), dispose }));
        const openPrivateDepositUnowned: NonNullable<KeyringRuntime['openPrivateDeposit']> = (
          signal,
          assertOwner,
          authentication
        ) =>
          openNotes(assertOwner, (notes, session) => {
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            const captured = generation,
              selected = selectedAccount(),
              snapshot = catalogueSnapshot;
            const network = getNativeNetwork(snapshot!.active.networkId, snapshot!.networks);
            const account = state.accounts[selected.type][selected.index];
            const openPool = openPrivacyPool;
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
            const acknowledgement = privateAcknowledgement(captured);
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
                acknowledgement,
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
                  { kind: 'estimate' }, null, null, authentication
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
                  const hash = await saved.quote.submit(assertBeforeSign, () => undefined, { kind: 'transaction' });
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
                  acknowledgement.dispose();
                  signal.removeEventListener('abort', abort);
                  await pool?.dispose();
                },
              },
              signal
            );
            const confirm = model.confirm.bind(model);
            model.confirm = id => acknowledgement.run(() => confirm(id));
            signal.addEventListener('abort', abort, { once: true });
            return model;
          }, authentication);
        const openPrivateDeposit: NonNullable<KeyringRuntime['openPrivateDeposit']> = (signal, guard, authentication) =>
          privacyLifecycle.open(signal, guard, (ownerSignal, check) => openPrivateDepositUnowned(ownerSignal, check, authentication), view => view.dispose(), (view, dispose) => Object.freeze({
            getSnapshot: view.getSnapshot.bind(view), subscribe: view.subscribe.bind(view), prepare: view.prepare.bind(view),
            confirm: view.confirm.bind(view), refresh: view.refresh.bind(view), dispose }));
        const openNoteImport: NonNullable<KeyringRuntime['openNoteImport']> = (assertOwner, authentication) =>
          openNotes(assertOwner, (notes, session) => {
            const openPool = openPrivacyPool;
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
          }, authentication);
        const authorizeWalletRemoval: NonNullable<KeyringRuntime['authorizeWalletRemoval']> = (signal, authentication, assertOwner, beforeSnapshot) => runPrivateDomain(async (captured) => {
          if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' ||
              typeof assertOwner !== 'function' || typeof beforeSnapshot !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
          assertNativePrivateAuthentication(authentication);
          const recovery = storage.recovery;
          if (!recovery || !storage.removal) throw new KeyringRuntimeError('NOT_READY');
          const ring = keyring, identity = verifiedIdentity, catalogue = catalogueSnapshot;
          const checkOwnership = () => {
            current(captured);
            assertNativePrivateAuthentication(authentication);
            if (signal.aborted || !identity || !catalogue || verifiedIdentity !== identity || catalogueSnapshot !== catalogue ||
                keyring !== ring || !ring.hasPublicSession() || authenticatedPair !== identity.pairFingerprint)
              throw new KeyringRuntimeError('CANCELLED');
          };
          const check = () => { checkOwnership(); checkGuard(assertOwner); checkOwnership(); };
          check();
          // Removal needs fresh OS authorization, never access to the
          // spending root or private-note record keys. Retire producers only
          // after that proof succeeds and the persisted wallet identity matches.
          await withNativePrivateAuthentication(authentication, signal, checkOwnership,
            owner => requestCredential('account-change', owner, check, true));
          check();
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          check();
          await beforeSnapshot(check);
          check();
          const snapshot = await recovery.readSnapshot();
          check();
          if (snapshot.state.presence !== 'existing' || !identity || JSON.stringify(snapshot.identity) !== JSON.stringify(identity))
            throw new KeyringRuntimeError('CANCELLED');
          const credentialRow = snapshot.metadata.find(row => row.key === 'local-credential-v1');
          const credentialPort = dependencies.credentialPort;
          if (!credentialRow || !credentialPort) throw new KeyringRuntimeError('NOT_READY');
          const credential = captureNativeCredentialReference(decodeStorageValue(credentialRow.value));
          const cacheCapability = slhCapability;
          const cacheNamespace = identity.root?.profileId;
          if (!cacheNamespace) throw new KeyringRuntimeError('NOT_READY');
          return Object.freeze({ snapshot, async purgePublicCaches(assertCleanupCurrent: () => void) {
            checkGuard(assertCleanupCurrent);
            if (cacheCapability !== null) await cacheCapability.purgePublicCache(cacheNamespace, assertCleanupCurrent);
            checkGuard(assertCleanupCurrent);
          }, async removeCredential(record: NativeCredentialReference) {
            if (encodeStorageValue(captureNativeCredentialReference(record)) !== encodeStorageValue(credential))
              throw new KeyringRuntimeError('CANCELLED');
            await credentialPort.remove(credential);
          }, assertCurrent() {
            try { check(); }
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
              !snapshot || snapshot.revision !== expectedRevision || !keyring.hasPublicSession())
            throw new KeyringRuntimeError('NOT_READY');
          if (pendingRegistration || active || reserved) throw new KeyringRuntimeError('BUSY');
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (signal.aborted || snapshot !== catalogueSnapshot ||
                !keyring.hasPublicSession() || active || reserved) throw new KeyringRuntimeError('CANCELLED');
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
              { keyring: transactionRecordKeyring(keyring, owner.check), assertCurrent: owner.check }, previous, () => approve(previous)
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
            { keyring: transactionRecordKeyring(keyring, owner.check), assertCurrent: owner.check }, previous, utxoSubmissionUrl(previous.endpoint), () => approve(network)
          );
        };
        const allocateSmartAccountRecord = async (label: string, expectedRevision: number, lifetime: AbortSignal | null,
          assertOwner: () => void, onCommitted: (next: NativeWalletCatalogueSnapshot, created: IKeyringAccountState) => void,
          credential: NativeOperationCredential | null, beforeCommit: () => void, authentication: NativePrivateAuthentication | null) => {
            checkGuard(assertOwner);
            const before = catalogueSnapshot, ring = keyring, selected = selectedAccount(), captured = generation;
            const prepare = dependencies.prepareSmartAccount, managementOwner = state.accounts.HDAccount[0];
            if (!before || before.revision !== expectedRevision || !ring.hasPublicSession() || !prepare ||
                findUtxoNetwork(before.active.networkId, before.utxoNetworks) || !managementOwner?.address)
              throw new KeyringRuntimeError('NOT_READY');
            const network = getNativeNetwork(before.active.networkId, before.networks), signal = new AbortController();
            const abort = () => signal.abort();
            lifetime?.addEventListener('abort', abort, { once: true });
            pendingRegistration = signal;
            const check = () => {
              checkGuard(assertOwner);
              if (signal.signal.aborted || lifetime?.aborted || keyring !== ring || !ring.hasPublicSession() ||
                  catalogueSnapshot !== before || selectedAccount() !== selected || state.accounts.HDAccount[0] !== managementOwner)
                throw new KeyringRuntimeError('CANCELLED');
            };
            try {
              check();
              const created = await ring.createSmartAccount({ label,
                deriveAccount: accountIndex => prepare(network, accountIndex, managementOwner.address, signal.signal, check) });
              check();
              if (!created.isSmartAccount || created.isImported || created.isLedgerWallet || created.isTrezorWallet || created.xprv !== '')
                throw new KeyringRuntimeError('OPERATION_FAILED');
              requireSmartAccountAddressIdentity({ address: created.address, xpub: created.xpub, smartAccount: created.smartAccount }, Number(network.chainId));
              const next = await withSoftwareSecret('account-change', signal.signal, check, async () => {
                beforeCommit(); check();
                return catalogue.mutate(expectedRevision, { kind: 'create-smart', account: created }, check);
              }, credential, null, authentication ? { authentication, assertCurrent() {
                current(captured); if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
              } } : null);
              check();
              // The request records its durable allocation before publication
              // invalidates observers of the previous selected account.
              try { checkGuard(() => onCommitted(next, created)); }
              finally { publishAccounts(next); }
              return created;
            } finally {
              lifetime?.removeEventListener('abort', abort);
              if (pendingRegistration === signal) pendingRegistration = null;
              signal.abort();
            }
        };
        const smartCreationAllocations = new WeakMap<NativeSmartCreationAllocation, Readonly<{
          signal: AbortSignal; target: NativeSmartCreationAllocation['target']; passkey?: IPasskeyCredentialProfile; ring: IndexedKeyring; generation: number; bootstrapAuthHash: string;
          slh?: { prepared?: Readonly<{ keyId: string; target: SmartAccountAuthenticatorBuildResult }> };
        }>>();
        const reserveContext = (input:
            | NativeAccountRequest | import('./accounts.ts').NativeNetworkRequest, expectedRevision: number, networkSelection: boolean) => {
            if (closed || !keyring.hasPublicSession() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const request = decodeStorageValue(encodeStorageValue(input)) as NativeAccountRequest | import('./accounts.ts').NativeNetworkRequest;
            if (!request || typeof request !== 'object' || Array.isArray(request) || (!networkSelection && ['select-network', 'save-network', 'add-utxo-network', 'edit-utxo-network', 'remove-utxo-network', 'remove-network'].includes(request.kind))) throw new KeyringRuntimeError('INVALID_INPUT');
            const accountTarget = 'id' in request && !['select-network', 'remove-network'].includes(request.kind);
            const requiresUtxoApproval = request.kind === 'add-utxo-network' ||
              request.kind === 'edit-utxo-network' || request.kind === 'remove-utxo-network';
            const fields = request.kind === 'import-ledger' || request.kind === 'import-trezor' || request.kind === 'create' || request.kind === 'create-smart' ? ['kind', 'label'] : request.kind === 'rename' ? ['kind', 'id', 'label']
              : request.kind === 'remove' ? ['kind', 'id'] : request.kind === 'save-network' ? ['kind', 'registration'] : requiresUtxoApproval ? ['kind'] : request.kind === 'select' || request.kind === 'select-network' || request.kind === 'remove-network' ? ['kind', 'id'] : [];
            if (!fields.length || Object.keys(request).sort().join(',') !== fields.sort().join(',') ||
                (accountTarget && (typeof request.id !== 'string' || (() => { try { parseNativeAccountId(request.id); return false; } catch { return true; } })())) ||
                ('label' in request && (typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label || request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label))))
              throw new KeyringRuntimeError('INVALID_INPUT');
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
            const trezor = request.kind === 'import-trezor' ? preparedTrezor : undefined;
            if (request.kind === 'import-ledger' && (!ledger || ledger.generation !== generation || ledger.snapshot !== catalogueSnapshot))
              throw new KeyringRuntimeError('CANCELLED');
            if (request.kind === 'import-trezor' && (!trezor || trezor.generation !== generation || trezor.snapshot !== catalogueSnapshot))
              throw new KeyringRuntimeError('CANCELLED');
            const token = {};
            reserved = token;
            const generationAtAdmission = revokeGeneration();
            let used = false;
            const cancellation = new AbortController();
            const protectedAccount = request.kind === 'create' || request.kind === 'create-smart' || request.kind === 'remove';
            let committing = false;
            return {
              cancel() { cancellation.abort(); if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent: () => void) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  const error = new KeyringRuntimeError('CANCELLED');
                  if (cancellation.signal.aborted && protectedAccount && !committing &&
                      generationAtAdmission === generation && keyring.hasPublicSession() && !requiresReopen())
                    secretAuthenticationRefusals.add(error);
                  return Promise.reject(error);
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  const guard = () => {
                    current(captured); checkGuard(assertCurrent);
                    if (cancellation.signal.aborted) {
                      const error = new KeyringRuntimeError('CANCELLED');
                      if (protectedAccount && !committing) secretAuthenticationRefusals.add(error);
                      throw error;
                    }
                  };
                  guard();
                  const before = catalogueSnapshot;
                  if (!before || before.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
                  let derived: IKeyringAccountState | undefined;
                  let committedSelection: NativeWalletCatalogueSnapshot | undefined;
                  let mutation;
                  if (request.kind === 'import-ledger') {
                    if (!ledger || ledger.snapshot !== before) throw new KeyringRuntimeError('CANCELLED');
                    derived = { ...ledger.account, label: request.label };
                    mutation = { kind: 'import-ledger', account: derived } as const;
                  } else if (request.kind === 'import-trezor') {
                    if (!trezor || trezor.snapshot !== before) throw new KeyringRuntimeError('CANCELLED');
                    derived = { ...trezor.account, label: request.label };
                    mutation = { kind: 'import-trezor', account: derived } as const;
                  } else if (request.kind === 'create') {
                    const created = await withSoftwareSecret('account-change', cancellation.signal, guard, async () => {
                      const account = await keyring.addNewAccount(request.label); guard();
                      if (!account || !Number.isSafeInteger(account.id) || account.id < 1 ||
                          before.accounts.some(candidate => candidate.type === 'HDAccount' && candidate.index === account.id))
                        throw new KeyringRuntimeError('CANCELLED');
                      const derived = checkedAccount(account, account.id, before.active.networkId, before.utxoNetworks);
                      committing = true;
                      const next = await catalogue.mutate(expectedRevision, { kind: 'create', account: derived }, guard);
                      return { next, derived };
                    }, null, null);
                    guard();
                    state.accounts.HDAccount[created.derived.id] = created.derived;
                    publishAccounts(created.next);
                    return null;
                  } else if (request.kind === 'create-smart') {
                    await allocateSmartAccountRecord(request.label, expectedRevision, cancellation.signal,
                      guard, () => undefined, null, () => { guard(); committing = true; }, null);
                    return null;
                  } else if (requiresUtxoApproval) {
                    if (!approval || approval.signal.aborted || approval.snapshot !== before)
                      throw new KeyringRuntimeError('CANCELLED');
                    mutation = request.kind === 'remove-utxo-network'
                      ? { kind: request.kind, id: approval.network.id } as const
                      : { kind: request.kind, registration: utxoRegistrationData(approval.network) } as const;
                  } else {
                    mutation = request;
                    if (request.kind === 'select-network') {
                      const utxo = findUtxoNetwork(request.id, before.utxoNetworks);
                      if (utxo && !supportsUtxoSoftwareCustody(utxo)) throw new KeyringRuntimeError('INVALID_INPUT');
                      if ((utxo?.slip44 ?? 60) !== state.activeNetwork.slip44) {
                        await dataBinding(captured, guard); guard();
                        committedSelection = await switchAccountGroup(request.id, guard, async initialGroup => {
                          committing = true;
                          return catalogue.mutate(expectedRevision, { ...request, initialGroup }, guard);
                        }); guard();
                      }
                    } else if (request.kind === 'remove') {
                      const account = before.accounts.find((a) => a.id === request.id);
                      if (!account) throw new KeyringRuntimeError('CANCELLED');
                      if (account.slip44 === 60) {
                        await dataBinding(captured, assertCurrent);
                        current(captured); checkGuard(assertCurrent);
                        const retained = await signedRecords.listAddress({ keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard }, account.address);
                        const hasAlias = before.accounts.some((candidate) => candidate.id !== account.id && candidate.address.toLowerCase() === account.address.toLowerCase());
                        if (!hasAlias && retained.some((entry) => !['confirmed','reverted','nonce-consumed'].includes(entry.phase))) throw new TransferJournalError('PENDING_TRANSFER');
                        current(captured); checkGuard(assertCurrent);
                      } else {
                        const network = findUtxoNetwork(before.active.networkId, before.utxoNetworks);
                        const source = state.accounts[account.type][account.index];
                        if (!utxoRecords || !network || network.slip44 !== account.slip44 ||
                            !source?.xpub || source.address !== account.address)
                          throw new KeyringRuntimeError('NOT_READY');
                        await dataBinding(captured, guard); guard();
                        const pending = await utxoRecords.hasUnresolvedForAccount(
                          { keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard },
                          account.slip44,
                          { type: account.type, id: account.index, xpub: source.xpub },
                        );
                        guard();
                        if (pending) throw new TransferJournalError('PENDING_TRANSFER');
                      }
                    }
                  }
                  const selection = mutation.kind === 'select-network' ? {
                    expected: previewNativeNetworkSelection(catalogue.privateRecords, mutation.id, null),
                    target: findUtxoNetwork(mutation.id, before.utxoNetworks) ?? getNativeNetwork(mutation.id, before.networks),
                  } : null;
                  guard();
                  if (mutation.kind === 'remove') {
                    const target = parseNativeAccountId(mutation.id);
                    const repository = await getConnectionRepository(captured); guard();
                    const next = await withSoftwareSecret('account-change', cancellation.signal, guard, async () => {
                      committing = true;
                      let next: NativeWalletCatalogueSnapshot | undefined;
                      await repository.retireAccount({ accountId: target.index, accountType: sdk.KeyringAccountType[target.type], slip44: target.slip44 }, async commit => {
                        next = await catalogue.mutate(expectedRevision, mutation, guard, commit);
                      }, guard);
                      if (!next) throw new KeyringRuntimeError('OPERATION_FAILED');
                      return next;
                    }, null, null);
                    guard(); publishAccounts(next);
                  } else {
                    if (protectedAccount) committing = true;
                    const requiresCheckpoint = ['import-ledger', 'import-trezor', 'save-network', 'remove-network', 'add-utxo-network', 'edit-utxo-network', 'remove-utxo-network'].includes(mutation.kind);
                    const next = committedSelection ?? (requiresCheckpoint
                      ? await withSoftwareSecret('account-change', cancellation.signal, guard, () => catalogue.mutate(expectedRevision, mutation, guard), null, null)
                      : await catalogue.mutate(expectedRevision, mutation, guard));
                    guard();
                    if (derived) state.accounts[derived.isLedgerWallet ? 'Ledger' : derived.isTrezorWallet ? 'Trezor' : derived.isSmartAccount ? 'SmartAccount' : 'HDAccount'][derived.id] = derived;
                    publishAccounts(next);
                    if (selection) {
                      const assertSelection = () => {
                        current(captured); checkGuard(assertCurrent);
                        const chosen = next.accounts.find(account => account.id === selection.expected.accountId);
                        const actualTarget = selection.target.kind === 'utxo' ? next.utxoNetworks.find(network => network.id === selection.target.id) : next.networks.find(network => network.id === selection.target.id);
                        if (catalogueSnapshot !== next || !keyring.hasPublicSession() || requiresReopen() || next.revision !== expectedRevision + 1 || next.active.networkId !== selection.expected.networkId || next.active.accountId !== selection.expected.accountId || chosen?.address !== selection.expected.address || JSON.stringify(actualTarget) !== JSON.stringify(selection.target))
                          throw new KeyringRuntimeError('CANCELLED');
                      };
                      assertSelection();
                      return Object.freeze<NativeNetworkSelectionProof>({ sourceCatalogueRevision: expectedRevision,
                        target: selection.target, selection: selection.expected, assertCurrent: assertSelection });
                    }
                  }
                  return null;
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
              if (!ring.hasPublicSession() || catalogueSnapshot !== snapshot || keyring !== ring ||
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
              const account = await withSoftwareSecret('account-change', new AbortController().signal, guard,
                () => ring.importAccount(privateKey, undefined, utxoAddressType ? { utxoAddressType } : undefined), null, null);
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
          reserve(input, expectedRevision, signal, authentication) {
            if (closed || !keyring.hasPublicSession() || !catalogueSnapshot)
              throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            assertNativePrivateAuthentication(authentication);
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            const before = catalogueSnapshot, owner = keyring;
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
            } catch { throw new KeyringRuntimeError('INVALID_INPUT'); }
            if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
              throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
            const token = {}; reserved = token; const generationAtAdmission = revokeGeneration(); let used = false;
            const cancellation = new AbortController();
            const abort = () => cancellation.abort();
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            let committing = false;
            let importEntered = false;
            const refusal = (error: unknown): never => {
              if (!committing && !importEntered && generationAtAdmission === generation && keyring === owner && catalogueSnapshot === before && !requiresReopen()) {
                if (cancellation.signal.aborted) {
                  const cancelled = new KeyringRuntimeError('CANCELLED'); secretAuthenticationRefusals.add(cancelled); throw cancelled;
                }
              }
              throw error;
            };
            return {
              cancel() { cancellation.abort(); signal.removeEventListener('abort', abort); if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  try { refusal(new KeyringRuntimeError('CANCELLED')); } catch (error) { return Promise.reject(error); }
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  const checkOwnership = () => { current(captured); assertNativePrivateAuthentication(authentication);
                    if (cancellation.signal.aborted || keyring !== owner || catalogueSnapshot !== before) throw new KeyringRuntimeError('CANCELLED'); };
                  const guard = () => { checkOwnership(); checkGuard(assertCurrent); checkOwnership(); };
                  try {
                  guard();
                  if (!catalogueSnapshot || catalogueSnapshot.revision !== expectedRevision ||
                      catalogueSnapshot.active.networkId !== networkId) throw new KeyringRuntimeError('CANCELLED');
                  if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
                    throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
                  const created = await withSoftwareSecret('account-change', cancellation.signal, guard, async () => {
                    importEntered = true;
                    const prepared = await importAccountWithRecovery(keyring, { secret: request.privateKey, label: request.label,
                      network: utxo ? { kind: 'syscoin', slip44: utxo.slip44 } : { kind: 'ethereum', slip44: 60 },
                      ...(utxo && request.utxoAddressType && { options: { utxoAddressType: request.utxoAddressType } }) }, guard);
                    guard();
                    const index = prepared.account.id;
                    const imported = utxo
                      ? checkedUtxoImport(prepared.account, utxo, request.utxoAddressType ? 'address' : 'account')
                      : checkedImported(prepared.account, request.privateKey, index);
                    if (imported.address !== request.expectedAddress) throw new KeyringRuntimeError('INVALID_INPUT');
                    committing = true;
                    const next = await catalogue.mutate(expectedRevision, { kind: 'import', account: imported, recovery: prepared.recovery }, guard);
                    return { next, index, imported };
                  }, null, null, { authentication, assertCurrent: checkOwnership });
                  guard(); state.accounts.Imported[created.index] = created.imported;
                  publishAccounts(created.next);
                  } catch (error) { refusal(error); }
                  finally { signal.removeEventListener('abort', abort); }
                });
              },
            };
          },
        };
        const accounts: NativeAccountRuntime = {
          isAuthenticationRefusal: error => !!error && typeof error === 'object' && secretAuthenticationRefusals.has(error),
          supported: () => typeof keyring.addNewAccount === 'function',
          supportsSmartAccounts: () => !!dependencies.prepareSmartAccount && !!catalogueSnapshot && !findUtxoNetwork(catalogueSnapshot.active.networkId, catalogueSnapshot.utxoNetworks),
          getSnapshot: () => closed || requiresReopen() || !keyring.hasPublicSession() ? null : catalogueSnapshot,
          reserve: (input, expectedRevision) => {
            const admitted = reserveContext(input, expectedRevision, false);
            return { cancel: admitted.cancel, execute: async check => { await admitted.execute(check); } };
          },
        };
        const networks: NativeNetworkRuntime = {
          prepareUtxo,
          withUtxoChangeApproval,
          getSelectedId: () => closed || requiresReopen() || !keyring.hasPublicSession() ? null : catalogueSnapshot?.active.networkId ?? null,
          reserve: (input, expectedRevision) => {
            const request = typeof input === 'string' ? { kind: 'select-network' as const, id: input } : input;
            return reserveContext(request, expectedRevision, true);
          },
        };
        const canSign = () => !!catalogueSnapshot && ['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(selectedAccount().type) && nativeSigningEnabled(catalogueSnapshot.active.networkId, catalogueSnapshot.networks);
        const activityContext = async (assertCurrent: () => void, target?: NativeTokenPortfolioScope): Promise<{ scope: ActivityScope; guard: () => void; index: number; type: NativeAccountType }> => {
          const captured = generation;
          const snapshot = catalogueSnapshot;
          const guard = () => { current(captured); checkGuard(assertCurrent); if (reserved) throw new KeyringRuntimeError('BUSY'); if (!keyring.hasPublicSession() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY'); if (target && snapshot !== catalogueSnapshot) throw new KeyringRuntimeError('CANCELLED'); };
          guard();
          const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
          const networkId = target?.networkId ?? catalogueSnapshot!.active.networkId;
          const network = getNativeNetwork(networkId, catalogueSnapshot!.networks);
          if (target && (selected.slip44 !== 60 || selected.id !== target.accountId || selected.address !== target.address ||
            network.registrationHash !== target.registrationHash || selected.type === 'SmartAccount' && selected.smartAccount?.chainId !== Number(network.chainId)))
            throw new KeyringRuntimeError('CANCELLED');
          const fingerprint = await dataBinding(captured, guard); guard();
          return { scope: createActivityScope(fingerprint, selected.id, selected.address, network), guard, index: selected.index, type: selected.type };
        };
        const inspectionOnly = <T extends object>(local: T, navigation = false): T & { inspectionOnly: true } => {
          const eligibility = local as { inspectionOnly?: true; speedUpEligible?: true; smartAccount?: unknown };
          const record = { ...local, inspectionOnly: true as const,
            ...(navigation && !eligibility.inspectionOnly && !eligibility.smartAccount
              ? { reviewNavigation: Object.freeze({ speedUp: eligibility.speedUpEligible === true }) } : {}) };
          delete (record as { speedUpEligible?: true }).speedUpEligible;
          return record;
        };
        let scopedActivityLoad: Promise<unknown> = Promise.resolve();
        const loadActivity = async (assertCurrent: () => void, target?: NativeTokenPortfolioScope) => {
          const { scope, guard, index, type } = await activityContext(assertCurrent, target);
          const journal = createNativeSignedRecordView(signedRecords, { keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard }, scope.walletFingerprint, { index, type, address: scope.address }, scope.network);
          const recent = await journal.activities(); guard();
          const saved = await activityHistory.load(scope, guard); guard();
          let locals = type === 'SmartAccount' ? recent.records.map(local => {
            const archived = saved.archived.find(record => record.hash === local.hash && record.recipient === local.recipient &&
              record.amountUnits === local.amountUnits && record.maximumFeeUnits === local.maximumFeeUnits && record.nonce === local.nonce && record.createdAt === local.createdAt);
            return archived ? { ...local, phase: archived.phase } : local;
          }) : recent.records;
          if (target) locals = locals.map(local => inspectionOnly(local, true));
          const inventory = await tokens.load({ walletFingerprint: scope.walletFingerprint, accountId: scope.accountId,
            address: scope.address, network: scope.network.id, chainId: scope.network.chainId, registrationHash: scope.network.registrationHash }, guard); guard();
          return { scope, locals, assets: inventory.items, saved: { ...saved,
            archived: type === 'SmartAccount' || target ? saved.archived.map(local => inspectionOnly(local, !!target)) : saved.archived,
            truncated: saved.truncated || recent.truncated } };
        };
        const checkActivityContext = async (scope: EvmActivityReadScope, assertCurrent: () => void) => {
          const context = await activityContext(assertCurrent);
          if (context.scope.key !== scope.key || context.scope.sourceId !== scope.sourceId) throw new KeyringRuntimeError('CANCELLED');
          return context;
        };
        const tokenOperation = <T>(
          assertCurrent: () => void,
          action: (scope: NativeTokenScope, guard: () => void) => Promise<T>,
          kind?: 'registry-write',
          target?: NativeTokenPortfolioScope
        ): Promise<T> => {
          if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
          const captured = generation;
          let targetSnapshot: NativeWalletCatalogueSnapshot | null = null;
          const check = () => {
            current(captured); checkGuard(assertCurrent);
            if (closed || captured !== generation) throw new KeyringRuntimeError('CANCELLED');
            if (!keyring.hasPublicSession() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (targetSnapshot && catalogueSnapshot !== targetSnapshot) throw new KeyringRuntimeError('CANCELLED');
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
            const network = getNativeNetwork(target?.networkId ?? catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
            if (target) {
              if (selected.slip44 !== 60 || target.accountId !== selected.id || target.address !== selected.address ||
                  target.registrationHash !== network.registrationHash ||
                  (selected.type === 'SmartAccount' && selected.smartAccount?.chainId !== Number(network.chainId)))
                throw new KeyringRuntimeError('CANCELLED');
              targetSnapshot = catalogueSnapshot!;
            }
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
        const importTrezor = (label: string, resume: boolean) => {
          const admittedEpoch = trezorEpoch;
          return run(async (captured) => {
          const before = catalogueSnapshot;
          const check = () => { current(captured); if (admittedEpoch !== trezorEpoch || !before || catalogueSnapshot !== before || !keyring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED'); };
          check();
          if (typeof label !== 'string' || !label.isWellFormed() || !label || label.trim() !== label || label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(label))
            throw new KeyringRuntimeError('INVALID_INPUT');
          if (resume) {
            const pending = await assertPendingTrezorOwner(captured, check);
            if (pending.operation !== 'import' || pending.label !== label) throw new KeyringRuntimeError('INVALID_INPUT');
            pending.accepted = true;
          } else if (pendingTrezor) throw new KeyringRuntimeError('BUSY');
          try {
            const { session, ring } = await openTrezorAttempt(captured, check, 'import', label, undefined, () => undefined);
            const account = await ring.importTrezorAccount(label); check();
            if (!account.isTrezorWallet || account.isLedgerWallet || account.isImported || account.isSmartAccount || account.xprv !== '')
              throw new KeyringRuntimeError('OPERATION_FAILED');
            await finishTrezor(session, check);
            preparedTrezor = { account, generation: captured, snapshot: before! };
          } catch (error) { await failTrezor(captured, admittedEpoch, error); throw error; }
          });
        };
        const trezor: NativeTrezorView = {
          getSnapshot: () => trezorSnapshot,
          subscribe(listener) { trezorListeners.add(listener); return () => { trezorListeners.delete(listener); }; },
          startImport: label => importTrezor(label, false),
          resumeImport() {
            if (!pendingTrezor || pendingTrezor.operation !== 'import') return Promise.reject(new KeyringRuntimeError('NOT_READY'));
            return importTrezor(pendingTrezor.label, true);
          },
          resumeSend: () => { const admittedEpoch = trezorEpoch; return run(async captured => {
            const check = () => { current(captured); if (admittedEpoch !== trezorEpoch) throw new KeyringRuntimeError('CANCELLED'); };
            const pending = await assertPendingTrezorOwner(captured, check); check();
            if (!pending.resume || pending.operation === 'import') throw new KeyringRuntimeError('NOT_READY');
            pending.accepted = true;
            return Object.freeze(decodeStorageValue(encodeStorageValue(pending.resume)) as NativeTrezorResumeIntent);
          }); },
          background: backgroundLocalSmart,
          cancel: cancelTrezor,
        };
        const captureSmartSigningOwners = () => {
          const localOwners: NativeSmartAccountSigningOwner[] = [];
          const ownerRecords = new Map<string, IKeyringAccountState>();
          for (const type of ['HDAccount', 'Imported', 'Ledger', 'Trezor'] as const) {
            if (type === 'Trezor' && !dependencies.trezorSessions) continue;
            if (type === 'Ledger' && (!dependencies.createLedgerTransport || !keyring.ledgerSigner)) continue;
            for (const owner of Object.values(state.accounts[type]))
              if (!owner.isSmartAccount && (type === 'Trezor' || !owner.isTrezorWallet) && (type === 'Ledger' || !owner.isLedgerWallet)) {
                localOwners.push({address: owner.address, id: owner.id, type});
                ownerRecords.set(`${type}:${owner.id}`, owner);
              }
          }
          return {localOwners, ownerRecords};
        };
        const smartSigningContext = (accountId: string) => {
                if (closed || !keyring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY'); const snapshot = catalogueSnapshot, selected = snapshot?.accounts.find(account => account.id === accountId);
                if (!snapshot || !selected) throw new KeyringRuntimeError('NOT_READY');
                if (selected.type !== 'SmartAccount') return Object.freeze({trezor:selected.type === 'Trezor', binding:JSON.stringify({selected})});
                const metadata = state.accounts.SmartAccount[selected.index]?.smartAccount;
                if (!metadata) throw new KeyringRuntimeError('NOT_READY');
                const plan = getNativeSmartAccountSigningPlan(metadata,captureSmartSigningOwners().localOwners,{p256WebAuthn: passkeys !== null, slhDsa:slhCapability !== null});
                if (!plan) throw new KeyringRuntimeError('NOT_READY');
                const records = captureSmartSigningOwners().ownerRecords;
                const owners = plan.authenticators.flatMap(entry => entry.owners.map(owner => ({...owner, publicKey:records.get(`${owner.type}:${owner.id}`)?.xpub})));
                return Object.freeze({trezor:owners.some(owner=>owner.type==='Trezor'),binding:JSON.stringify({metadata,plan,owners})});
        };
        const ledgerConnectionTargets = (): readonly string[] => {
          if (!catalogueSnapshot || !keyring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
          const selected = selectedAccount();
          if (selected.type === 'Ledger') return Object.freeze([selected.id]);
          if (selected.type !== 'SmartAccount' || selected.slip44 !== 60) throw new KeyringRuntimeError('NOT_READY');
          const metadata = state.accounts.SmartAccount[selected.index]?.smartAccount;
          if (!metadata) throw new KeyringRuntimeError('NOT_READY');
          const plan = getNativeSmartAccountSigningPlan(metadata, captureSmartSigningOwners().localOwners, {p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null});
          if (!plan) throw new KeyringRuntimeError('NOT_READY');
          const result = new Set<string>();
          for (const entry of plan.authenticators) for (const owner of entry.owners) if (owner.type === 'Ledger') {
            const target = catalogueSnapshot.accounts.find(account => account.type === 'Ledger' && account.index === owner.id && account.address.toLowerCase() === owner.address.toLowerCase());
            if (!target || target.slip44 !== 60) throw new KeyringRuntimeError('NOT_READY');
            result.add(target.id);
          }
          return Object.freeze([...result]);
        };
        const withLedgerSigningSession = <T>(ring: IndexedKeyring, signal: AbortSignal, assertCurrent: () => void,
          operation: (session: Extract<NativeHardwareDappSession, {kind: 'Ledger'}>, check: () => void) => Promise<T>): Promise<T> => {
          checkGuard(assertCurrent);
          const signer = ring.ledgerSigner;
          if (!signer) throw new KeyringRuntimeError('NOT_READY');
          return withOwnedLedgerConnection({ signal, assertCurrent,
            connected: () => ledger.isConnected(), current: () => ledgerTransport, retire: retireLedger,
          }, check => operation({kind: 'Ledger', signer, transactions: ring.ethereumTransaction}, check));
        };
        const ledger: NativeLedgerRuntime = {
          subscribeStatus(listener) {
            ledgerStatusListeners.add(listener);
            return () => { ledgerStatusListeners.delete(listener); };
          },
          getConnectionTargets: ledgerConnectionTargets,
          isConnected() {
            let targets: readonly string[];
            try { targets = ledgerConnectionTargets(); } catch { return false; }
            if (!targets.length) return true;
            const verified = ledgerVerified;
            try { verified?.assertCurrent(); } catch { return false; }
            return (
              JSON.stringify(verified?.targetIds) === JSON.stringify(targets) &&
              !!verified &&
              !closed &&
              !requiresReopen() &&
              keyring.hasPublicSession() &&
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
              (request.purpose === 'import' ? Object.keys(request).join() !== 'purpose' :
                Object.keys(request).sort().join() !== 'accountIds,purpose' || !Array.isArray(request.accountIds))
            )
              throw new KeyringRuntimeError('INVALID_INPUT');
            let before = catalogueSnapshot;
            const ring = keyring,
              captured = generation;
            const selected = selectedAccount();
            let selectedRecord = state.accounts[selected.type][selected.index];
            const selectedAddress = selectedRecord?.address, selectedPublicKey = selectedRecord?.xpub;
            const selectedPolicy = JSON.stringify(selectedRecord?.smartAccount);
            const networkIdentity = JSON.stringify(state.activeNetwork);
            const targetIds = request.purpose === 'connect' ? ledgerConnectionTargets() : [];
            if (request.purpose === 'connect' && (!targetIds.length || JSON.stringify(request.accountIds) !== JSON.stringify(targetIds)))
              throw new KeyringRuntimeError('INVALID_INPUT');
            const targets = targetIds.map(id => {
              const target = before!.accounts.find(account => account.id === id && account.type === 'Ledger');
              const saved = target && state.accounts.Ledger[target.index];
              if (!target || !saved) throw new KeyringRuntimeError('NOT_READY');
              return {target, saved, address: saved.address, publicKey: saved.xpub};
            });
            const assertWallet = () => {
              current(captured);
              if (
                !before ||
                catalogueSnapshot !== before ||
                keyring !== ring ||
                !ring.hasPublicSession() ||
                before.active.accountId !== selected.id ||
                state.accounts[selected.type][selected.index] !== selectedRecord ||
                selectedRecord?.address !== selectedAddress || selectedRecord?.xpub !== selectedPublicKey ||
                JSON.stringify(selectedRecord?.smartAccount) !== selectedPolicy || JSON.stringify(state.activeNetwork) !== networkIdentity ||
                targets.some(({target, saved, address, publicKey}) => state.accounts.Ledger[target.index] !== saved ||
                  saved.address !== address || saved.xpub !== publicKey)
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
              let deviceSelected = false;
              let verified = false;
              return {
                async select(id) {
                  check();
                  const candidate = candidates.get(id);
                  if (!candidate || deviceSelected)
                    throw new KeyringRuntimeError('INVALID_INPUT');
                  deviceSelected = true;
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
                  for (const {target, saved} of targets) {
                  if (target.slip44 === 60) {
                    const actual = await signer.evm.getEvmAddressAndPubKey({
                      accountIndex: target.index,
                    });
                    check();
                    if (
                      actual.address.toLowerCase() !==
                        saved.address.toLowerCase() ||
                      actual.publicKey.replace(/^0x/, '').toLowerCase() !==
                        saved.xpub.replace(/^0x/, '').toLowerCase()
                    )
                      throw selected.type === 'SmartAccount'
                        ? Object.assign(new KeyringRuntimeError('INVALID_INPUT'), {code: 'LEDGER_SMART_OWNERS_UNAVAILABLE'})
                        : new KeyringRuntimeError('INVALID_INPUT');
                  } else {
                    const network = findUtxoNetwork(
                      before!.active.networkId,
                      before!.utxoNetworks
                    );
                    if (!network) throw new KeyringRuntimeError('NOT_READY');
                    const actual = await signer.utxo.getXpub({
                      index: target.index,
                      coin: state.activeNetwork.currency,
                      slip44: target.slip44,
                    });
                    check();
                    if (
                      sdk.convertExtendedKeyVersion(
                        actual,
                        network.publicKeyVersion
                      ) !== saved.xpub
                    )
                      throw selected.type === 'SmartAccount'
                        ? Object.assign(new KeyringRuntimeError('INVALID_INPUT'), {code: 'LEDGER_SMART_OWNERS_UNAVAILABLE'})
                        : new KeyringRuntimeError('INVALID_INPUT');
                  }
                  }
                  verified = true;
                  return Object.freeze({
                    name: candidate.name,
                    address: targets[0]!.target.address,
                  });
                },
                handoff() {
                  check();
                  if (
                    request.purpose !== 'connect' ||
                    !verified ||
                    !targets.length ||
                    !transport.host.getStatus().connected
                  )
                    throw new KeyringRuntimeError('NOT_READY');
                  handedOff = true;
                  const connection: NonNullable<typeof ledgerVerified> = {
                    accountId: selected.id,
                    targetIds,
                    assertCurrent: assertWallet,
                    prepareInfrastructureAdoption(next) {
                      assertWallet();
                      if (ledgerVerified !== connection || selected.type !== 'Ledger' ||
                          targetIds.length !== 1 || targetIds[0] !== selected.id ||
                          JSON.stringify({...next, revision: 0}) !== JSON.stringify({...before, revision: 0}))
                        throw new KeyringRuntimeError('CANCELLED');
                      const nextState = stateFor(catalogue.privateRecords);
                      if (JSON.stringify(nextState.accounts.Ledger[selected.index]) !== JSON.stringify(selectedRecord) ||
                          JSON.stringify(nextState.activeNetwork) !== networkIdentity)
                        throw new KeyringRuntimeError('CANCELLED');
                      return () => {
                        current(captured);
                        if (ledgerVerified !== connection || catalogueSnapshot !== next || keyring !== ring ||
                            JSON.stringify(state.accounts.Ledger[selected.index]) !== JSON.stringify(selectedRecord) ||
                            JSON.stringify(state.activeNetwork) !== networkIdentity)
                          throw new KeyringRuntimeError('CANCELLED');
                        // Only the caller's guarded infrastructure-pending CAS may adopt this proof.
                        before = next;
                        selectedRecord = state.accounts.Ledger[selected.index];
                        for (const target of targets) target.saved = state.accounts.Ledger[target.target.index]!;
                        connection.snapshot = next;
                        assertWallet();
                      };
                    },
                    generation: captured,
                    snapshot: before!,
                    transport,
                  };
                  ledgerVerified = connection;
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
        const smartOwnerSigningPorts = (owner: NativeSmartAccountSigningOwner, signal: AbortSignal, assertCurrent: () => void, ring: IndexedKeyring, trezor: SmartAccountOwnerSigningSdk['trezor'], authentication: NativePrivateAuthentication | null): SmartAccountOwnerSigningSdk => {
          const captured = generation;
          return {
          rawSign: (params, options) => withSoftwareSecret('transaction', signal, assertCurrent,
            () => ring.ethereumTransaction.ethSign(params, options), null, null, authentication ? {
              authentication,
              assertCurrent() {
                current(captured);
                if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
              },
            } : null),
          ledger: owner.type === 'Ledger' ? {
            async signTypedData(request: Parameters<NonNullable<SmartAccountOwnerSigningSdk['ledger']>['signTypedData']>[0], authority: {signal: AbortSignal; assertCurrent(): void}) {
              checkGuard(assertCurrent);
              const target = catalogueSnapshot?.accounts.find(account => account.type === 'Ledger' && account.index === owner.id && account.address.toLowerCase() === owner.address.toLowerCase());
              if (!target || !ledgerVerified?.targetIds.includes(target.id) || request.accountIndex !== owner.id ||
                  request.expectedAddress.toLowerCase() !== owner.address.toLowerCase() || authority.signal !== signal || !ring.ledgerSigner)
                throw new KeyringRuntimeError('NOT_READY');
              clearCredentialMaterial();
              return withOwnedLedgerConnection({signal, assertCurrent, connected: () => ledger.isConnected(), current: () => ledgerTransport, retire: retireLedger},
                check => { check(); return ring.ledgerSigner!.evm.signTypedData(request, authority); });
            },
          } : null,
          trezor,
        };
        };
        const smartOwnerProofSequence = (handoff: NativeSigningHandoff | null) => {
          let ordinal = 0, passkeyOrdinal = 0;
          type Intent = Parameters<typeof signSmartAccountOwnerIntent>[0]['intent'];
          type Inventory = ReturnType<typeof captureSmartSigningOwners>;
          type PasskeyRequest = Parameters<NonNullable<SmartAccountAuthenticatorPorts['p256WebAuthn']>['signActionHash']>[0];
          const context = (metadata: ISmartAccountMetadata, intent: Intent, inventory: Inventory, check: () => void) => {
            check();
            const plan = getNativeSmartAccountSigningPlan(metadata, inventory.localOwners, { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null });
            if (!plan) throw new KeyringRuntimeError('NOT_READY');
            if (!plan.authenticators.some(entry => entry.owners.some(candidate => candidate.type === 'Trezor'))) return null;
            requireNativeSigningHandoff(handoff);
            const ownedHandoff = handoff;
            try {
              const continuation = captureNativeSigningContinuation(ownedHandoff, expiresAt => {
                const receipts = new NativeOwnerProofReceipts({ now: Date.now });
                let captured: ReturnType<NativeOwnerProofReceipts['capture']> | undefined;
                let retired = false;
                return {
                  receipts, expiresAt,
                  get captured() { if (retired) throw new KeyringRuntimeError('CANCELLED'); return captured; },
                  capture(input: Parameters<NativeOwnerProofReceipts['capture']>[0], guard: () => void) {
                    if (retired || captured) throw new KeyringRuntimeError('CANCELLED');
                    captured = receipts.capture(input, guard); return captured;
                  },
                  retire() { retired = true; if (captured) receipts.retire(captured.handle); captured = undefined; },
                };
              });
              const selected = selectedAccount(), snapshot = catalogueSnapshot;
              const smart = state.accounts.SmartAccount[selected.index];
              if (!snapshot || selected.type !== 'SmartAccount' || !smart?.smartAccount) throw new KeyringRuntimeError('CANCELLED');
              const identities = new Map<string, NativeOwnerProofIdentity>();
              for (const entry of plan.authenticators) for (const required of entry.owners) {
                if (!['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(required.type)) throw new KeyringRuntimeError('INVALID_INPUT');
                const saved = inventory.ownerRecords.get(`${required.type}:${required.id}`);
                if (!saved || saved.address.toLowerCase() !== required.address.toLowerCase()) throw new KeyringRuntimeError('CANCELLED');
                // The Ledger SDK stores SEC bytes without 0x. Normalize only
                // that representation at receipt capture; the receipt still
                // verifies its exact SEC length and derived owner address.
                const publicKey = required.type === 'Ledger' && /^(?:(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})$/i.test(saved.xpub)
                  ? `0x${saved.xpub}` : saved.xpub;
                identities.set(`${required.type}:${required.id}`, { type: required.type as NativeOwnerProofIdentity['type'], id: required.id, address: saved.address, publicKey });
              }
              const binding = JSON.stringify({ id: ownedHandoff.id,
                account: { id: selected.id, address: smart.address, publicKey: smart.xpub },
                network: getNativeNetwork(snapshot.active.networkId, snapshot.networks), metadata, plan,
                owners: [...identities.values()].map(owner => ({ ...owner, publicKey: inventory.ownerRecords.get(`${owner.type}:${owner.id}`)!.xpub })) });
              const captured = continuation.captured ?? continuation.capture({ binding, intent, plan, owners: [...identities.values()], expiresAt: continuation.expiresAt }, check);
              return { continuation, captured, binding, ownedHandoff };
            } catch (error) { retireNativeSigningHandoff(ownedHandoff); throw error; }
          };
          const isFinal = (captured: ReturnType<NativeOwnerProofReceipts['capture']>) => ordinal + passkeyOrdinal === captured.steps.length + captured.passkeys.length;
          return {
          async owner(owner: NativeSmartAccountSigningOwner, metadata: ISmartAccountMetadata, intent: Intent, inventory: Inventory,
            check: () => void, sign: (acceptTrezorProof: (signature: string) => void, position: Readonly<{step:number;total:number}> | null) => Promise<string>) {
            const ctx = context(metadata, intent, inventory, check);
            if (!ctx) return sign(() => { throw new KeyringRuntimeError('INVALID_INPUT'); }, null);
            const { continuation, captured, binding, ownedHandoff } = ctx;
            try {
              const step = captured.steps[ordinal++];
              if (!step || step.owner.type !== owner.type || step.owner.id !== owner.id || step.owner.address.toLowerCase() !== owner.address.toLowerCase())
                throw new KeyringRuntimeError('CANCELLED');
              const request = { binding, intent, step };
              const previous = continuation.receipts.read(captured.handle, request, check);
              if (previous !== null) { check(); if (isFinal(captured)) completeNativeSigningOwnerStep(ownedHandoff, true); return previous; }
              const deviceSteps = captured.steps.filter(candidate => candidate.owner.type === 'Trezor');
              const position = owner.type === 'Trezor' ? {step:deviceSteps.findIndex(candidate => candidate.ordinal === step.ordinal)+1,total:deviceSteps.length} : null;
              let accepted = false;
              const signature = await sign(verified => {
                check();
                if (owner.type !== 'Trezor' || accepted) throw new KeyringRuntimeError('CANCELLED');
                continuation.receipts.record(captured.handle, request, verified, check); accepted = true;
                completeNativeSigningOwnerStep(ownedHandoff, isFinal(captured)); check();
              }, position);
              check();
              if (owner.type === 'Trezor') {
                if (!accepted || continuation.receipts.read(captured.handle, request, check)?.toLowerCase() !== signature.toLowerCase())
                  throw new KeyringRuntimeError('CANCELLED');
              } else { continuation.receipts.record(captured.handle, request, signature, check); if (isFinal(captured)) completeNativeSigningOwnerStep(ownedHandoff, true); }
              check(); return signature;
            } catch (error) { retireNativeSigningHandoff(ownedHandoff); throw error; }
          },
          async passkey(metadata: ISmartAccountMetadata, intent: Intent, inventory: Inventory, request: PasskeyRequest,
            check: () => void, sign: () => ReturnType<NonNullable<SmartAccountAuthenticatorPorts['p256WebAuthn']>['signActionHash']>) {
            const ctx = context(metadata, intent, inventory, check);
            if (!ctx) return sign();
            const { continuation, captured, binding, ownedHandoff } = ctx;
            try {
              const step = captured.passkeys[passkeyOrdinal++];
              if (!step || request.actionHash !== intent.actionHash ||
                  JSON.stringify(request.expectedPublicKey) !== JSON.stringify(step.config.publicKey) ||
                  request.credentialId !== (step.config.credentialId || undefined) || request.expectedCredentialIdHash !== step.config.credentialIdHash)
                throw new KeyringRuntimeError('CANCELLED');
              const receipt = { binding, intent, step }, previous = continuation.receipts.readPasskey(captured.handle, receipt, check);
              if (previous !== null) { check(); if (isFinal(captured)) completeNativeSigningOwnerStep(ownedHandoff, true); return { signature: previous }; }
              const signed = await sign(); check();
              continuation.receipts.recordPasskey(captured.handle, receipt, signed.signature, check);
              if (isFinal(captured)) completeNativeSigningOwnerStep(ownedHandoff, true);
              check(); return { signature: signed.signature };
            } catch (error) { retireNativeSigningHandoff(ownedHandoff); throw error; }
          },
          };
        };
        const smartTrezorSigningPort = (owner: NativeSmartAccountSigningOwner, metadata: ISmartAccountMetadata,
          intent: Parameters<typeof signSmartAccountOwnerIntent>[0]['intent'], signal: AbortSignal, assertCurrent: () => void,
          handoff: import('../connections/signingHandoff.ts').NativeSigningHandoff, acceptProof: (signature: string) => void, position: Readonly<{step:number;total:number}>): NonNullable<SmartAccountOwnerSigningSdk['trezor']> => ({
          async signTypedData(request, authority) {
            const captured = generation, snapshot = catalogueSnapshot, smart = selectedAccount(), originalRing = keyring, admittedEpoch = trezorEpoch;
            const record = snapshot?.accounts.find(candidate => candidate.type === 'Trezor' && candidate.index === owner.id);
            const saved = state.accounts.Trezor[owner.id], smartRecord = state.accounts.SmartAccount[smart.index];
            const plan = getNativeSmartAccountSigningPlan(metadata, captureSmartSigningOwners().localOwners, {p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null});
            const needed = plan?.authenticators.flatMap(entry => entry.owners.filter(candidate => candidate.type === 'Trezor')) ?? [];
            const planned = needed[position.step-1];
            if (!snapshot || smart.type !== 'SmartAccount' || !smartRecord?.smartAccount || !record || record.slip44 !== 60 || !saved ||
                !Number.isSafeInteger(position.step) || position.step < 1 || position.total !== needed.length || !planned || planned.id !== owner.id || planned.address.toLowerCase() !== owner.address.toLowerCase() ||
                record.address.toLowerCase() !== owner.address.toLowerCase() || saved.address !== record.address ||
                request.index !== owner.id || request.address.toLowerCase() !== owner.address.toLowerCase() || authority.signal !== signal)
              throw new KeyringRuntimeError('NOT_READY');
            const target: SmartTrezorTarget = Object.freeze({smartId: smart.id, smartAddress: smart.address, ownerId: record.id,
              ownerIndex: owner.id, ownerAddress: record.address, publicKey: saved.xpub,
              ownerLabel:record.label, ownerStep:position.step, ownerSteps:position.total,
              cataloguePolicy: JSON.stringify(smartRecord.smartAccount), signingPolicy: JSON.stringify({metadata, plan})});
            const check = () => {
              current(captured); checkGuard(assertCurrent); checkGuard(authority.assertCurrent);
              if (signal.aborted || authority.signal.aborted || trezorEpoch !== admittedEpoch || catalogueSnapshot !== snapshot || keyring !== originalRing ||
                  selectedAccount() !== smart || state.accounts.SmartAccount[smart.index] !== smartRecord || state.accounts.Trezor[owner.id] !== saved ||
                  saved.xpub !== target.publicKey || saved.address !== target.ownerAddress || JSON.stringify(smartRecord.smartAccount) !== target.cataloguePolicy)
                throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            const local=localSmartContext?.handoff===handoff;
            const resume: NativeTrezorResumeIntent = Object.freeze({kind:local?'smart-operation':'external-signing', id:handoff.id, accountId:smart.id, networkId:snapshot.active.networkId});
            const session = await admitTrezorAttempt(captured, check, local?'smart-operation':'external-signing', smart.label, resume, target, handoff.beforeSuiteOpen); check();
            // Public device adapter only: preserve the original vault and its
            // captured journal capability rather than transferring its session.
            const worker = sdk.createTrezorHardware(session.host).trezorSigner;
            trezorDeviceWorker = worker;
            let retirement: Promise<void> | undefined;
            const owned = () => trezorSession === session || pendingTrezor?.job === session.job;
            const retire = () => { if (owned()) { retirement ??= handoff.isSuspended() ? retireTrezor() : cancelTrezor(); void retirement?.catch(() => undefined); } };
            signal.addEventListener('abort', retire, {once:true});
            try {
              const signature = await signNativeSmartTrezorOwner({ worker,
                expected: {index:owner.id,address:owner.address,publicKey:target.publicKey}, request,
                actionHash:intent.actionHash, authority:{signal,assertCurrent:check}, beforeSignature:acceptProof });
              check();
              await finishTrezor(session, check); check();
              return signature;
            } catch (error) {
              if (!handoff.isSuspended()) await failTrezor(captured, admittedEpoch, error);
              throw error;
            } finally {
              signal.removeEventListener('abort', retire);
              if (owned()) retire();
              await retirement;
            }
          },
        });
        const refreshSmartAccountMetadata = async (signal: AbortSignal, assertOwner: () => void) => {
            const captured = generation, snapshot = catalogueSnapshot, ring = keyring;
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (!snapshot || !ring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
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
              if (signal.aborted || contextSignal.aborted || request.signal.aborted || keyring !== ring || !ring.hasPublicSession() ||
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
              await passkeyRegistry.activateObserved(account.address, metadata, check); check();
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
          if (!snapshot || !ring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
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
          const records = await signedRecords.captureSmartAccountPendingRecords({ keyring: transactionRecordKeyring(ring, check), assertCurrent: check }, network.chainId, account.address);
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
        const canSignSmartAccount = () => {
          if (!catalogueSnapshot || !keyring.hasPublicSession()) return false;
          try {
            const selected = selectedAccount(), account = selected.type === 'SmartAccount' ? state.accounts.SmartAccount[selected.index] : undefined;
            if (!account?.smartAccount) return false;
            requireSmartAccountAddressIdentity(account, account.smartAccount.chainId);
            const {localOwners} = captureSmartSigningOwners();
            return canSignNativeSmartAccountActionHash(account.smartAccount, localOwners, { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null });
          } catch { return false; }
        };
        const canManageSlhDsa = () => {
          if (slhCapability === null || !catalogueSnapshot || !keyring.hasPublicSession()) return false;
          try {
            const selected = selectedAccount(), account = selected.type === 'SmartAccount' ? state.accounts.SmartAccount[selected.index] : undefined;
            if (!account?.smartAccount) return false;
            requireSmartAccountAddressIdentity(account, account.smartAccount.chainId); return true;
          } catch { return false; }
        };
        const canManageGuardianPolicy = () => {
          // Policy changes use openSmartAccountOperation's current-validator
          // signer and separate payer consent, including P256 and composites.
          return canSignSmartAccount();
        };
        const getGuardianRecoveryIntent = () => {
          if (!catalogueSnapshot || !keyring.hasPublicSession()) return null;
          const selected = selectedAccount();
          return (
            catalogue.privateRecords.guardianRecoveryIntents?.find(
              (entry) => entry.accountId === selected.id
            ) ?? null
          );
        };
        const readLocalInfrastructureScope = (wallet: string): LocalSigningResumeScope => {
          const snapshot = catalogueSnapshot, selected = snapshot && selectedAccount();
          if (!snapshot || !selected || selected.type !== 'Trezor' || selected.slip44 !== 60 ||
              !keyring.hasPublicSession() || verifiedIdentity?.walletBindingId !== wallet) throw new KeyringRuntimeError('CANCELLED');
          const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks), account = state.accounts.Trezor[selected.index];
          if (!account || !account.isTrezorWallet || account.isLedgerWallet || account.isImported || account.isSmartAccount || account.xprv !== '')
            throw new KeyringRuntimeError('NOT_READY');
          return Object.freeze({wallet, unlockGeneration: trezorSessionGeneration, accountId: selected.id, address: account.address,
            type: selected.type, xpub: account.xpub, registration: JSON.stringify(network),
            signing: JSON.stringify({id: account.id, address: account.address, xpub: account.xpub}), trezor: true});
        };
        type InfrastructureOrigin = Readonly<{kind: 'new'}> | Readonly<{kind: 'suite-resume'; descriptor: LocalInfrastructureHandoffDescriptor}>;
        const openInfrastructure = async (signal: AbortSignal, assertOwner: () => void, origin: InfrastructureOrigin, authentication: NativePrivateAuthentication | null) => {
          if (authentication !== null) assertNativePrivateAuthentication(authentication);
          const captured = generation, ring = keyring;
          let snapshot = catalogueSnapshot;
          const selected = selectedAccount();
          if (!snapshot || selected.slip44 !== 60 || !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(selected.type) ||
              origin.kind === 'suite-resume' && selected.type !== 'Trezor' ||
              selected.type === 'Trezor' && (!dependencies.trezorSessions || !trezorSessionGeneration))
            throw new KeyringRuntimeError('NOT_READY');
          const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
          let payer = state.accounts[selected.type][selected.index];
          if (!payer) throw new KeyringRuntimeError('NOT_READY');
          const publicKey = payer.xpub, address = payer.address, encryptedKey = payer.xprv;
          const role = {ledger: payer.isLedgerWallet, imported: payer.isImported, trezor: payer.isTrezorWallet, smart: payer.isSmartAccount};
          const payerReference = captureNativeInfrastructurePayerReference({id: selected.id, address, xpub: publicKey}, catalogue.privateRecords);
          const identity = Object.freeze({ ...payerReference, label: selected.label });
          const check = () => {
            checkGuard(assertOwner); current(captured);
            if (signal.aborted || !ring.hasPublicSession() || keyring !== ring || catalogueSnapshot !== snapshot ||
                selectedAccount() !== selected || state.accounts[selected.type][selected.index] !== payer || !payer ||
                payer.id !== selected.index || payer.address !== address || payer.xpub !== publicKey || payer.xprv !== encryptedKey ||
                payer.isLedgerWallet !== role.ledger || payer.isImported !== role.imported ||
                payer.isTrezorWallet !== role.trezor || payer.isSmartAccount !== role.smart ||
                Boolean(payer.isLedgerWallet) !== (selected.type === 'Ledger') || Boolean(payer.isImported) !== (selected.type === 'Imported') ||
                Boolean(payer.isTrezorWallet) !== (selected.type === 'Trezor') || payer.isSmartAccount ||
                (selected.type === 'Ledger' || selected.type === 'Trezor' ? encryptedKey !== '' : !encryptedKey) ||
                state.activeNetwork.slip44 !== 60 || state.activeNetwork.chainId !== Number(network.chainId) || state.activeNetwork.url !== network.rpcUrl)
              throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          const walletFingerprint = await dataBinding(captured, check);
          check();
          const recovery = storage.recovery, pairFingerprint = verifiedIdentity?.pairFingerprint;
          if (!recovery || !pairFingerprint || !verifiedIdentity?.root || !currentPublicSessionRecord) throw new KeyringRuntimeError('NOT_READY');
          const cleanupIdentity = { ...verifiedIdentity, root: { ...verifiedIdentity.root } };
          const cleanupStorage = captureInfrastructureCleanupStorage(storage.keyringStorage, () => recovery.readIdentity(), {
            identity: cleanupIdentity, checkpoint: currentPublicSessionRecord, records: catalogue.privateRecords,
          });
          const cleanupRoot = { walletFingerprint, address: cleanupIdentity.root.address, publicKey: cleanupIdentity.root.publicKey };
          let preparedAttemptId: string | undefined = origin.kind === 'suite-resume' ? origin.descriptor.action.attemptId : undefined;
          let admission: { attemptId: string; pending: NativeInfrastructurePending | null } | null = null;
          let admittedWork: Promise<unknown> | undefined;
          let handoff: NativeSigningHandoff | null = null;
          let controller!: NativeInfrastructureController;
          const drain = async () => {controller?.dispose(); await admittedWork?.catch(() => undefined); await trezorCleanup;};
          const localEntry = (action: LocalInfrastructureHandoffDescriptor['action'], scope: LocalSigningResumeScope, expiresAt: number) => ({
            id: origin.kind === 'suite-resume' ? origin.descriptor.id : `local-infrastructure-${++trezorSequence}`,
            action, scope, expiresAt, order: 0, assertCurrent: check,
            eligible: () => {
              if (controller?.getSnapshot().phase !== 'submitting' || !catalogueSnapshot || !keyring.hasPublicSession()) return false;
              const pending = catalogue.privateRecords.infrastructurePending?.find(entry => entry.chainId === network.chainId);
              return pending?.entry.attemptId === action.attemptId && pending.entry.contractId === action.contractId && !pending.entry.transactionHash;
            },
            drain, retire: () => {if (localInfrastructureContext?.handoff === handoff) localInfrastructureContext = undefined; controller?.dispose();},
          });
          try {
          if (origin.kind === 'suite-resume') {
            const scope = readLocalInfrastructureScope(walletFingerprint), saved = origin.descriptor;
            if (localSmartHandoffs.infrastructureDescriptor(saved.id) !== saved || !sameSigningResumeOwner(saved.scope, scope) ||
                scope.unlockGeneration <= saved.scope.unlockGeneration) throw new KeyringRuntimeError('CANCELLED');
            handoff = localSmartHandoffs.resumeInfrastructure(localEntry(saved.action, scope, saved.expiresAt), snapshotNativeInfrastructureLocalAction, saved);
            getNativeInfrastructureContinuation(handoff);
          }
          const rpc = new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch });
          controller = infrastructure.open({
            network, payer: identity, assertCurrent: check,
            createSigningHandoff(context: NativeInfrastructureHandoffCapture) {
              if (selected.type !== 'Trezor') return null;
              check();
              if (context.attemptId !== preparedAttemptId) throw new KeyringRuntimeError('CANCELLED');
              const action = snapshotNativeInfrastructureLocalAction({kind: 'infrastructure', contractId: context.contractId,
                attemptId: context.attemptId, unsignedTransaction: context.unsignedTransaction});
              if (origin.kind === 'suite-resume') {
                if (!handoff || JSON.stringify(action) !== JSON.stringify(origin.descriptor.action)) throw new KeyringRuntimeError('CANCELLED');
                getNativeInfrastructureContinuation(handoff);
              } else {
                if (handoff) retireNativeSigningHandoff(handoff);
                handoff = localSmartHandoffs.captureInfrastructure(localEntry(action, readLocalInfrastructureScope(walletFingerprint), context.expiresAt), snapshotNativeInfrastructureLocalAction);
              }
              localInfrastructureContext = {handoff, controller, drain};
              return handoff;
            },
            background: () => {if (selected.type === 'Trezor') backgroundLocalSmart();},
            dispose() {
              if (localInfrastructureContext?.controller === controller) localInfrastructureContext = undefined;
              if (!handoff) return;
              const suspended = handoff.isSuspended();
              retireNativeSigningHandoff(handoff);
              if (!suspended && pendingTrezor?.operation === 'infrastructure' && pendingTrezor.resume?.id === handoff.id)
                void cancelTrezor().catch(() => undefined);
            },
            admit<T>(work: () => Promise<T>): Promise<T> {
              check();
              if (admission || !preparedAttemptId || storageRetired) return Promise.reject(new KeyringRuntimeError('BUSY'));
              const admitted = { attemptId: preparedAttemptId, pending: null as NativeInfrastructurePending | null };
              admission = admitted;
              const tracked = Promise.resolve().then(work).finally(() => {
                if (admission === admitted) admission = null;
                pendingSubmissions.delete(tracked);
              });
              admittedWork = tracked;
              pendingSubmissions.add(tracked);
              return tracked;
            },
            async settleUnsent(attemptId) {
              if (origin.kind === 'suite-resume') throw new KeyringRuntimeError('CANCELLED');
              const admitted = admission;
              if (!admitted || admitted.attemptId !== attemptId) throw new KeyringRuntimeError('CANCELLED');
              const prior = active;
              if (prior) await Promise.allSettled([prior]);
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
              const token = {}; reserved = token;
              let cleanupCatalogue: NativeWalletCatalogue | undefined, cleanupCommitted = false;
              const storageOwner = () => {
                if (storageRetired || requiresReopen() || reserved !== token || active || admission !== admitted)
                  throw new KeyringRuntimeError('CLEANUP_FAILED');
                const record = catalogue.privateRecords;
                const registered = catalogueEvmNetworks(record).find(candidate => candidate.id === network.id);
                const account = captureNativeInfrastructurePayerReference(payerReference, record);
                if (record.walletFingerprint !== walletFingerprint || !registered || registered.registrationHash !== network.registrationHash ||
                    registered.chainId !== network.chainId || registered.rpcUrl !== network.rpcUrl ||
                    account.id !== identity.id || account.address !== identity.address || account.xpub !== identity.xpub)
                  throw new KeyringRuntimeError('CANCELLED');
                return record;
              };
              try {
                storageOwner();
                const actual = await recovery.readIdentity();
                const record = storageOwner();
                if (!actual || actual.walletBindingId !== walletFingerprint || actual.pairFingerprint !== pairFingerprint)
                  throw new KeyringRuntimeError('CANCELLED');
                const pending = record.infrastructurePending?.find(entry => entry.chainId === network.chainId);
                if (!pending) return;
                if (!admitted.pending || pending.entry.attemptId !== attemptId ||
                    encodeStorageValue(pending) !== encodeStorageValue(admitted.pending)) throw new KeyringRuntimeError('CANCELLED');
                const before = catalogueSnapshot;
                const cleanupGuard = () => { storageOwner(); };
                cleanupCatalogue = new NativeWalletCatalogue(cleanupStorage(record, pending, cleanupGuard));
                await cleanupCatalogue.reconcile(cleanupRoot, cleanupGuard);
                if (encodeStorageValue(cleanupCatalogue.privateRecords) !== encodeStorageValue(record)) throw new KeyringRuntimeError('CANCELLED');
                await cleanupCatalogue.mutate(record.revision, { kind: 'set-infrastructure-pending', chainId: network.chainId, expectedAttemptId: attemptId, pending: null }, cleanupGuard);
                cleanupCommitted = true;
                const next = await catalogue.reconcile(cleanupRoot, cleanupGuard);
                storageOwner();
                if (encodeStorageValue(catalogue.privateRecords) !== encodeStorageValue(cleanupCatalogue.privateRecords))
                  throw new KeyringRuntimeError('CANCELLED');
                storageOwner();
                if (before !== null && !closed && keyring.hasPublicSession()) {
                  if (catalogueSnapshot !== before || JSON.stringify({ ...next, revision: 0 }) !== JSON.stringify({ ...before, revision: 0 }))
                    throw new KeyringRuntimeError('CANCELLED');
                  // Only pending metadata changed: retain live SDK/public identities, never revive a locked view.
                  const adopted = Object.freeze({ ...next, accounts: before.accounts, networks: before.networks, utxoNetworks: before.utxoNetworks, active: before.active });
                  const adoptLedger = selected.type === 'Ledger' && ledger.isConnected()
                    ? ledgerVerified!.prepareInfrastructureAdoption(adopted) : undefined;
                  catalogueSnapshot = adopted;
                  adoptLedger?.();
                  if (snapshot === before && generation === captured && keyring === ring && !signal.aborted) snapshot = adopted;
                }
              } catch (error) {
                if (cleanupCommitted || cleanupCatalogue?.requiresReopen || requiresReopen()) {
                  infrastructureSettlementFault = true; privateDomainStorageFault = 'reopen';
                }
                throw error;
              } finally { if (reserved === token) reserved = null; }
            },
            pending() { check(); return catalogue.privateRecords.infrastructurePending?.find(entry => entry.chainId === network.chainId); },
            async commit(pending, expectedAttemptId) {
              await run(async ownerGeneration => {
                check(); if (ownerGeneration !== captured) throw new KeyringRuntimeError('CANCELLED');
                if (pending !== null && expectedAttemptId === null) {
                  if (!admission || pending.entry.attemptId !== admission.attemptId) throw new KeyringRuntimeError('CANCELLED');
                  admission.pending = pending;
                }
                const before = snapshot!;
                const next = await catalogue.mutate(before.revision, { kind: 'set-infrastructure-pending', chainId: network.chainId, expectedAttemptId, pending }, check);
                check();
                // This private metadata commit may advance revision, never public signing identity.
                if (JSON.stringify({ ...next, revision: 0 }) !== JSON.stringify({ ...before, revision: 0 }))
                  throw new KeyringRuntimeError('CANCELLED');
                const adopted = Object.freeze({ ...next, accounts: before.accounts, networks: before.networks, utxoNetworks: before.utxoNetworks, active: before.active });
                const adoptLedger = selected.type === 'Ledger' && ledger.isConnected()
                  ? ledgerVerified!.prepareInfrastructureAdoption(adopted) : undefined;
                publishAccounts(adopted); snapshot = adopted; payer = state.accounts[selected.type][selected.index];
                adoptLedger?.();
                check();
              });
            },
            observe: requestSignal => rpc.readSmartAccountInfrastructureStatus(requestSignal, check),
            readReceipt: (hash, requestSignal) => rpc.infrastructureAttemptRead('eth_getTransactionReceipt', [hash], requestSignal, check),
            readLatestNonce: (address, requestSignal) => rpc.infrastructureAttemptRead('eth_getTransactionCount', [address, 'latest'], requestSignal, check),
            prepare: (request, requestSignal, validateAuthority, deployment) => prepareOwnedEvmTransaction(request, selected, selected, requestSignal, check,
              { smartAccountInfrastructureDeployment: true, smartAccountInfrastructureId: deployment.contractId, smartAccountInfrastructureAttemptId: deployment.attemptId, smartAccountInfrastructureRpcUrl: network.rpcUrl }, NATIVE_EVM_FEE_FUNDING, { kind: 'estimate' }, selected.type === 'Ledger' ? {
                keyring: () => { check(); return ring; },
                signTransaction(unsignedTransaction, authority) {
                  const guard = () => { check(); checkGuard(authority.assertCurrent); };
                  return withLedgerSigningSession(ring, authority.signal, guard, (session, assertConnected) => sdk.signLedgerEvmTransaction(session.signer,
                    { accountIndex: selected.index, expectedAddress: identity.address, unsignedTransaction }, {signal: authority.signal, assertCurrent: assertConnected}));
                },
              } : selected.type === 'Trezor' ? {
                keyring: () => { check(); return ring; },
                async signTransaction(unsignedTransaction, authority) {
                  requireNativeSigningHandoff(handoff);
                  const ownedHandoff = handoff, continuation = getNativeInfrastructureContinuation(ownedHandoff);
                  const admittedEpoch = trezorEpoch;
                  const guard = () => {
                    check(); checkGuard(authority.assertCurrent); continuation.assertResumeCurrent();
                    if (trezorEpoch !== admittedEpoch || handoff !== ownedHandoff || continuation.unsignedTransaction !== unsignedTransaction)
                      throw new KeyringRuntimeError('CANCELLED');
                  };
                  guard();
                  const resume: NativeTrezorResumeIntent = Object.freeze({kind:'infrastructure', id:ownedHandoff.id,
                    accountId:selected.id, networkId:network.id});
                  const session = await admitTrezorAttempt(captured, guard, 'infrastructure', selected.label, resume, null, ownedHandoff.beforeSuiteOpen);
                  guard();
                  // Hardware-only worker: the public vault and its journal capability stay in place.
                  const worker = sdk.createTrezorHardware(session.host).trezorSigner;
                  trezorDeviceWorker = worker;
                  let retirement: Promise<void> | undefined;
                  const owns = () => trezorSession === session || pendingTrezor?.job === session.job;
                  const retire = () => { if (owns()) { retirement ??= ownedHandoff.isSuspended() ? retireTrezor() : cancelTrezor(); void retirement?.catch(() => undefined); } };
                  authority.signal.addEventListener('abort', retire, {once:true});
                  try {
                    const signed = await sdk.signTrezorEvmTransaction(worker, {
                      accountIndex:selected.index, expectedAddress:identity.address, coin:'eth', slip44:60, unsignedTransaction,
                    }, {signal:authority.signal, assertCurrent:guard});
                    guard(); ownedHandoff.beforeSignature(); guard();
                    await finishTrezor(session, guard); guard();
                    return signed;
                  } catch (error) {
                    if (!ownedHandoff.isSuspended()) {
                      // A foreground device failure retires the hardware request, not
                      // its still-owned result screen. Let confirm() publish the
                      // failure and retain/reconcile the original reservation.
                      let currentOwner = false;
                      try { check(); currentOwner = true; } catch { /* Retired views remain cancelled. */ }
                      const foregroundFailure = currentOwner && localInfrastructureContext?.handoff === ownedHandoff &&
                          localInfrastructureContext.controller === controller;
                      if (foregroundFailure) {
                        localInfrastructureContext = undefined;
                        retireNativeSigningHandoff(ownedHandoff);
                      }
                      await failTrezor(captured, admittedEpoch, error);
                      if (foregroundFailure) {
                        check();
                        const failure = error instanceof Error ? error : new Error('Trezor signing failed', {cause:error});
                        infrastructureSigningFailures.add(failure);
                        throw failure;
                      }
                    }
                    throw error;
                  } finally {
                    authority.signal.removeEventListener('abort', retire);
                    if (owns()) retire();
                    await retirement;
                  }
                },
              } : null, async () => {
                check();
                if (selected.type === 'Ledger' && !ledger.isConnected()) throw new KeyringRuntimeError('NOT_READY');
                await validateAuthority();
              }, authentication),
            randomId() {
              preparedAttemptId = `0x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
              return preparedAttemptId;
            },
            submissionFailure: error => sdk.evmSubmissionFailure(error),
          }, signal, origin.kind === 'suite-resume' ? {kind: 'suite-resume', handoff: handoff!} : {kind: 'new'});
          if (handoff) localInfrastructureContext = {handoff, controller, drain};
          if (origin.kind === 'suite-resume') localSmartHandoffs.discard(origin.descriptor, false);
          return controller;
          } catch (error) {
            if (handoff) retireNativeSigningHandoff(handoff);
            if (localInfrastructureContext?.controller === controller) localInfrastructureContext = undefined;
            controller?.dispose();
            throw error;
          }
        };
        const openSmartInfrastructure = (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthentication | null) => openInfrastructure(signal, assertOwner, {kind: 'new'}, authentication);
        const openResumedSmartInfrastructure = async (id: string, signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthentication | null) => {
          const saved = localSmartHandoffs.infrastructureDescriptor(id), captured = generation;
          if (!saved || signal.aborted) throw new KeyringRuntimeError('NOT_READY');
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (signal.aborted || localSmartHandoffs.infrastructureDescriptor(id) !== saved) throw new KeyringRuntimeError('CANCELLED');
          };
          let controller: NativeInfrastructureController | undefined;
          try {
            check(); await localSmartHandoffs.drain(id); check(); await trezorCleanup; check(); await localSmartHandoffs.retired(); check();
            const pending = await assertPendingTrezorOwner(captured, check); check();
            if (pending.operation !== 'infrastructure' || pending.job !== saved.job || !pending.accepted || pending.resume?.id !== id)
              throw new KeyringRuntimeError('CANCELLED');
            controller = await openInfrastructure(signal, assertOwner, {kind: 'suite-resume', descriptor: saved}, authentication);
            await controller.reviewResume(controller.getSnapshot().revision);
            current(captured); checkGuard(assertOwner);
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            return controller;
          } catch (error) {
            localSmartHandoffs.discard(saved); controller?.dispose(); throw error;
          }
        };
        const openGuardianRecovery = async (
          draft: NativeGuardianRecoveryDraft,
          parentSignal: AbortSignal,
          assertOwner: () => void,
          authentication: NativePrivateAuthentication | null
        ) => {
          if (authentication !== null) assertNativePrivateAuthentication(authentication);
          const kind = Object.getOwnPropertyDescriptor(draft, 'kind')?.value;
          const input = readOwnData(
            draft,
            kind === 'start' ? ['kind', 'guardianId', 'replacement', 'payerId'] : ['kind']
          );
          if (
            (kind !== 'start' && kind !== 'resume') ||
            (kind === 'start' &&
              (typeof input.guardianId !== 'string' ||
                typeof input.payerId !== 'string'))
          )
            throw new KeyringRuntimeError('INVALID_INPUT');
          let replacementRequest: Extract<NativeGuardianRecoveryDraft, {kind:'start'}>['replacement'] | null = null;
          if (kind === 'start') {
            const replacementKind = input.replacement && typeof input.replacement === 'object' ? Object.getOwnPropertyDescriptor(input.replacement, 'kind')?.value : undefined;
            if (replacementKind === 'software') {
              const replacement = readOwnData(input.replacement, ['kind', 'accountId']);
              if (typeof replacement.accountId !== 'string') throw new KeyringRuntimeError('INVALID_INPUT');
              replacementRequest = Object.freeze({ kind: 'software', accountId: replacement.accountId });
            } else if (replacementKind === 'passkey') {
              const replacement = readOwnData(input.replacement, ['kind', 'recreate']);
              if (typeof replacement.recreate !== 'boolean' || !passkeys || !authentication) throw new KeyringRuntimeError('INVALID_INPUT');
              replacementRequest = Object.freeze({ kind: 'passkey', recreate: replacement.recreate });
            } else throw new KeyringRuntimeError('INVALID_INPUT');
          }
          const request = Object.freeze({
            kind,
            guardianId: input.guardianId as string,
            replacement: replacementRequest,
            payerId: input.payerId as string,
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
              !ring.hasPublicSession() ||
              selected.type !== 'SmartAccount' ||
              !initialAccount?.smartAccount
            )
              throw new KeyringRuntimeError('NOT_READY');
            let snapshot = initialSnapshot,
              account = initialAccount;
            const targetIdentity = { address: initialAccount.address, xpub: initialAccount.xpub };
            const network = getNativeNetwork(
              snapshot.active.networkId,
              snapshot.networks
            );
            let roleChecks: readonly (() => void)[] = [];
            let rebindRoles: (() => void) | undefined;
            requireSmartAccountAddressIdentity(account, Number(network.chainId));
            const check = () => {
              checkGuard(assertOwner);
              current(captured);
              if (
                signal.aborted ||
                keyring !== ring ||
                !ring.hasPublicSession() ||
                catalogueSnapshot !== snapshot ||
                selectedAccount() !== selected ||
                state.accounts.SmartAccount[selected.index] !== account ||
                account.address !== targetIdentity.address || account.xpub !== targetIdentity.xpub ||
                state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type ||
                state.activeNetwork.chainId !== Number(network.chainId) || state.activeNetwork.url !== network.rpcUrl || state.activeNetwork.slip44 !== 60
              )
                throw new KeyringRuntimeError('CANCELLED');
              requireSmartAccountAddressIdentity(account, Number(network.chainId));
              for (const assertRoleCurrent of roleChecks) assertRoleCurrent();
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
            const reference = (id: string, role: 'guardian' | 'software') => {
              const saved = snapshot!.accounts.find(
                (entry) =>
                  entry.id === id &&
                  entry.slip44 === 60 &&
                  (entry.type === 'HDAccount' || entry.type === 'Imported' || role === 'guardian' && entry.type === 'SmartAccount')
              );
              if (!saved) throw new KeyringRuntimeError('INVALID_INPUT');
              const key = state.accounts[saved.type]?.[saved.index];
              if (
                !key || (saved.type !== 'SmartAccount' && !key.xprv) ||
                key.address.toLowerCase() !== saved.address.toLowerCase()
              )
                throw new KeyringRuntimeError('INVALID_INPUT');
              if (saved.type === 'SmartAccount') requireSmartAccountAddressIdentity(key, Number(network.chainId));
              const identity = { address: key.address, xpub: key.xpub, xprv: key.xprv };
              return {
                saved,
                key,
                ref: Object.freeze({ id, address: saved.address, xpub: key.xpub.toLowerCase() }),
                assertCurrent() {
                  if (state.accounts[saved.type]?.[saved.index] !== key || key.address !== identity.address || key.xpub !== identity.xpub || key.xprv !== identity.xprv)
                    throw new KeyringRuntimeError('CANCELLED');
                  if (saved.type === 'SmartAccount') requireSmartAccountAddressIdentity(key, Number(network.chainId));
                },
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
                rebindRoles?.();
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
            const readGuardianSigningState = async (guardian: ReturnType<typeof reference>) => {
              check(); guardian.assertCurrent();
              if (guardian.saved.type !== 'SmartAccount') return null;
              if (!guardian.key.smartAccount) throw new KeyringRuntimeError('NOT_READY');
              const metadata = await readSmartAccountValidatorMetadata({
                account: { ...guardian.key, smartAccount: guardian.key.smartAccount },
                chainId: Number(network.chainId), provider, assertCurrent: check,
              });
              check(); guardian.assertCurrent();
              const inventory = captureSmartSigningOwners();
              const localOwners = inventory.localOwners.filter(owner => owner.type === 'HDAccount' || owner.type === 'Imported');
              const plan = getNativeSmartAccountSigningPlan(metadata, localOwners, { p256WebAuthn: passkeys !== null, slhDsa: false });
              if (!metadata.isDeployed || !plan) throw new Error('This Smart guardian requires an unavailable authenticator');
              const owners = plan.authenticators.flatMap(entry => entry.owners).map(owner => {
                const type = owner.type;
                if (type !== 'HDAccount' && type !== 'Imported') throw new KeyringRuntimeError('NOT_READY');
                const record = inventory.ownerRecords.get(`${owner.type}:${owner.id}`);
                if (!record?.xprv) throw new KeyringRuntimeError('NOT_READY');
                const identity = { address: record.address, xpub: record.xpub, xprv: record.xprv };
                return { owner, assertCurrent() {
                  check();
                  if (state.accounts[type]?.[owner.id] !== record || record.address !== identity.address || record.xpub !== identity.xpub || record.xprv !== identity.xprv)
                    throw new KeyringRuntimeError('CANCELLED');
                } };
              });
              return { metadata, localOwners, owners, fingerprint: JSON.stringify({ auth: getSmartAccountAuthHash(metadata.auth!), plan }) };
            };
            let intent = getGuardianRecoveryIntent();
            check();
            await dataBinding(captured, check);
            check();
            if (request.kind === 'start') {
              if (intent)
                throw new Error('Resume or clear the existing recovery first');
              const guardian = reference(request.guardianId, 'guardian'),
                replacement = request.replacement!.kind === 'software' ? reference(request.replacement!.accountId, 'software') : null,
                payer = reference(request.payerId, 'software');
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
              await readGuardianSigningState(guardian);
              let replacementCredential: GuardianRecoveryReplacement | undefined;
              let target: PaliRecoveryTarget;
              if (replacement) {
                target = { auth: { module: 'ecdsa', validator: getConfiguredAuthenticatorAddress(Number(network.chainId), 'ecdsa'),
                  data: encodeEcdsaValidatorInitData([replacement.ref.address], 1) } };
              } else {
                if (!passkeys || !authentication || request.replacement?.kind !== 'passkey') throw new KeyringRuntimeError('NOT_READY');
                const saved = await passkeyRegistry.read(account.address, check); check();
                let profile = request.replacement.recreate ? undefined : saved.pending?.profile;
                if (profile) {
                  try {
                    await passkeyCeremony(authentication, signal, check, owner => passkeys.sign({
                      actionHash: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), credentialId: profile!.credentialId,
                      expectedCredentialIdHash: profile!.credentialIdHash, expectedPublicKey: profile!.publicKey,
                      signal: owner, assertCurrent: check,
                    }));
                  } catch (error) { check(); throw Object.assign(new Error('Passkey could not be verified'), { code: 'PASSKEY_POSSESSION_FAILED', cause: error }); }
                } else {
                  const name = `Pali recovery ${account.label || account.address}`.slice(0, 80);
                  profile = passkeyRegistrationToProfile(await passkeyCeremony(authentication, signal, check,
                    owner => passkeys.create({ accountName: name, signal: owner, assertCurrent: check })), name);
                }
                check(); await passkeyRegistry.savePending(account.address, profile, check); check();
                replacementCredential = { kind: 'p256-webauthn', authenticator: { id: 'p256-webauthn', config: profile },
                  credentialId: profile.credentialId, credentialIdHash: profile.credentialIdHash,
                  ...(profile.backupStatus ? { backupStatus: profile.backupStatus } : {}), ...(profile.userHandle ? {userHandle:profile.userHandle} : {}) };
                target = toP256WebAuthnRecoveryTarget({ validator: getConfiguredAuthenticatorAddress(Number(network.chainId), 'p256-webauthn'), ...profile.publicKey });
              }
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
              guardian.assertCurrent(); replacement?.assertCurrent(); payer.assertCurrent();
              const canonical = captureGuardianRecoveryIntent({ operation, target });
              intent = Object.freeze({
                accountId: selected.id,
                ...canonical,
                guardian: guardian.ref,
                replacement: replacement ? { kind: 'software' as const, account: replacement.ref } : { kind: 'passkey' as const,
                  credential: captureGuardianRecoveryClaim({ intent: canonical, readyAt: 0, guardian: { kind: guardian.saved.type === 'SmartAccount' ? 'contract' : 'ecdsa', guardian: guardian.ref.address }, replacement: replacementCredential! }).replacement },
                payer: payer.ref,
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
            let guardian: ReturnType<typeof reference>, replacement: ReturnType<typeof reference> | null, payer: ReturnType<typeof reference>;
            rebindRoles = () => {
              guardian = reference(savedIntent.guardian.id, 'guardian');
              replacement = savedIntent.replacement.kind === 'software' ? reference(savedIntent.replacement.account.id, 'software') : null;
              payer = reference(savedIntent.payer.id, 'software');
              for (const [actual, saved] of [[guardian.ref, savedIntent.guardian], ...(replacement && savedIntent.replacement.kind === 'software' ? [[replacement.ref, savedIntent.replacement.account] as const] : []), [payer.ref, savedIntent.payer]] as const)
                if (actual.address !== saved.address || actual.xpub !== saved.xpub) throw new KeyringRuntimeError('INVALID_INPUT');
              roleChecks = [guardian.assertCurrent, ...(replacement ? [replacement.assertCurrent] : []), payer.assertCurrent];
            };
            rebindRoles();
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
            const pendingTransaction = () => pendingGuardianRecoveryTransaction(
              savedIntent.operation,
              { kind: guardian.saved.type === 'SmartAccount' ? 'contract' : 'ecdsa', guardian: guardian.ref.address },
              {
                read: async () => {
                  const saved = await signedRecords.readRecent(
                    { keyring: transactionRecordKeyring(ring, check), assertCurrent: check },
                    network.chainId,
                    payer.ref.address,
                    EVM_SIGNED_RECORD_LIMITS.transactions
                  );
                  check();
                  if (saved.total !== saved.entries.length)
                    throw new Error('Recovery transaction observation is incomplete');
                  return saved.entries;
                },
                observe: entry => observeRetainedEvmTransaction(
                  signedRecords,
                  { keyring: transactionRecordKeyring(ring, check), assertCurrent: check },
                  network.chainId,
                  payer.ref.address,
                  entry.hash,
                  request => rpc.observation({ hash: request.hash, from: request.from, to: request.to, nonce: request.nonce }, signal, check),
                  check
                ),
              },
              check
            );
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
              const obsolete = guardianRecoveryIntentResolved(savedIntent.operation, observation, pending);
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
            const signInsideProof = async (owner: ReturnType<typeof reference>, digest: string, validateAuthority: () => Promise<void>) => {
                const guard = () => {
                  current(captured);
                  check();
                  owner.assertCurrent();
                };
                guard();
                if (owner.saved.type !== 'HDAccount' && owner.saved.type !== 'Imported') throw new KeyringRuntimeError('INVALID_INPUT');
                await validateAuthority(); guard();
                const identity = { id: owner.saved.index, type: owner.saved.type, address: owner.ref.address };
                const signature = await signSmartAccountOwnerIntent({
                  intent: createSmartAccountRawSigningIntent('recovery', digest, 'recovery-digest'),
                  selectedSmart: { id: selected.index, type: selected.type, expectedAddress: selected.address },
                  owner: identity, authority: { assertCurrent: guard, signal },
                  sdk: smartOwnerSigningPorts(identity, signal, guard, ring, null, authentication),
                });
                guard();
                await validateAuthority(); guard();
                return signature;
              };
            const sign = (owner: ReturnType<typeof reference>, digest: string, validateAuthority: () => Promise<void>) =>
              run(() => signInsideProof(owner, digest, validateAuthority));
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
                  const smartGuardian = action === 'schedule' ? await readGuardianSigningState(guardian) : null;
                  const validateAuthority = async () => {
                    await validate();
                    if (smartGuardian) {
                      for (const owner of smartGuardian.owners) owner.assertCurrent();
                      const latest = await readGuardianSigningState(guardian);
                      if (!latest || latest.fingerprint !== smartGuardian.fingerprint) throw new Error('Smart guardian policy changed');
                      for (const owner of smartGuardian.owners) owner.assertCurrent();
                    }
                    check();
                  };
                  let transaction;
                  if (action === 'schedule') {
                    if (replacement) await sign(replacement, savedIntent.operation.hash, validateAuthority);
                    else {
                      if (savedIntent.replacement.kind !== 'passkey' || !passkeys || !authentication) throw new KeyringRuntimeError('NOT_READY');
                      const credential = savedIntent.replacement.credential;
                      if (credential.authenticator.id !== 'p256-webauthn') throw new KeyringRuntimeError('INVALID_INPUT');
                      const publicKey = credential.authenticator.config.publicKey;
                      await validateAuthority();
                      await passkeyCeremony(authentication, signal, check, owner => passkeys.sign({ actionHash: savedIntent.operation.hash,
                        credentialId: credential.credentialId, expectedCredentialIdHash: credential.credentialIdHash,
                        expectedPublicKey: publicKey, signal: owner, assertCurrent: check }));
                      await validateAuthority();
                    }
                    let signature: string;
                    if (smartGuardian) {
                      const actionHash = getPaliErc7739PersonalSignHash({ accountAddress: guardian.ref.address, chainId: Number(network.chainId), hash: savedIntent.operation.hash });
                      const approval = await run(() => signNativeSmartAccountActionHash({
                        metadata: smartGuardian.metadata, actionHash, localOwners: smartGuardian.localOwners,
                        accountId: guardian.saved.index, p256WebAuthn: passkeys === null ? null : { signActionHash: request => passkeyCeremony(authentication, signal, check, owner => passkeys.sign({ ...request, assertCurrent: check, signal: owner })) }, slhDsa: null, allowReservedSLHDSASignature: false, assertCurrent: check,
                        assertOwnerCurrent(owner) {
                          const capturedOwner = smartGuardian.owners.find(candidate => candidate.owner.type === owner.type && candidate.owner.id === owner.id && candidate.owner.address === owner.address);
                          if (!capturedOwner) throw new KeyringRuntimeError('CANCELLED');
                          capturedOwner.assertCurrent();
                        },
                        async signOwner(address, digest, owner, assertCurrent) {
                          assertCurrent();
                          const saved = snapshot.accounts.find(candidate => candidate.type === owner.type && candidate.index === owner.id && candidate.address.toLowerCase() === address.toLowerCase());
                          if (!saved) throw new KeyringRuntimeError('CANCELLED');
                          const result = await signInsideProof(reference(saved.id, 'software'), digest, validateAuthority);
                          assertCurrent(); return result;
                        },
                      }));
                      signature = encodeSmartAccountAuthenticatorSignature(approval);
                    } else signature = await sign(guardian, savedIntent.operation.hash, validateAuthority);
                    await validateAuthority();
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
                    payer.saved,
                    selected,
                    signal,
                    check,
                    {
                      smartAccountGuardianRecovery: action === 'schedule',
                      smartAccountGuardianRecoveryFinalize: action === 'finalize',
                      smartAccountRecoveryAccount: account.address,
                    },
                    NATIVE_EVM_FEE_FUNDING,
                    { kind: 'estimate' }, null, validateAuthority, authentication
                  );
                  check();
                  return Object.freeze({
                    ...prepared,
                    async submit(assertCurrent, onBroadcast, submission) {
                      check();
                      checkGuard(assertCurrent);
                      if ((await observe()).action !== action)
                        throw new Error('Recovery status changed');
                      await validateAuthority();
                      check();
                      checkGuard(assertCurrent);
                      return prepared.submit(assertCurrent, onBroadcast, submission);
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
                  if (savedIntent.replacement.kind === 'passkey') {
                    const credential = savedIntent.replacement.credential;
                    if (credential.authenticator.id !== 'p256-webauthn' || !credential.credentialId || !credential.credentialIdHash) throw new KeyringRuntimeError('INVALID_INPUT');
                    const profile: IPasskeyCredentialProfile = { ...credential.authenticator.config, credentialId: credential.credentialId,
                      credentialIdHash: credential.credentialIdHash, passkeyName: credential.authenticator.config.passkeyName || 'Pali recovery',
                      ...(credential.userHandle ? {userHandle:credential.userHandle} : {}) };
                    await passkeyRegistry.savePending(account.address, profile, check); check();
                    await passkeyRegistry.activateObserved(account.address, metadata, check); check();
                  }
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
        type SmartOperationOrigin = Readonly<{kind:'dapp';handoff:NativeSigningHandoff}> |
          Readonly<{kind:'local-new';action:NativeSmartLocalAction}> |
          Readonly<{kind:'local-resume';descriptor:LocalSigningHandoffDescriptor}>;
        const readLocalSmartScope = (wallet: string): LocalSigningResumeScope => {
          const snapshot=catalogueSnapshot,selected=snapshot&&selectedAccount();
          if(!snapshot||!selected||selected.type!=='SmartAccount'||!keyring.hasPublicSession()||verifiedIdentity?.walletBindingId!==wallet)throw new KeyringRuntimeError('CANCELLED');
          const network=getNativeNetwork(snapshot.active.networkId,snapshot.networks),signing=smartSigningContext(selected.id),record=state.accounts.SmartAccount[selected.index];
          if(!record||typeof record.xpub!=='string'||!record.xpub)throw new KeyringRuntimeError('NOT_READY');
          return Object.freeze({wallet,unlockGeneration:trezorSessionGeneration,accountId:selected.id,address:selected.address,type:selected.type,xpub:record.xpub,
            registration:JSON.stringify(network),signing:signing.binding,trezor:signing.trezor});
        };
        const localSmartScope = async (captured: number, check: () => void): Promise<LocalSigningResumeScope> => {
          check();const wallet=await dataBinding(captured,check);check();return readLocalSmartScope(wallet);
        };
        const openSmartAccountOperation = async (intent: NativeSmartAccountIntent, assertOwner: () => void, origin: SmartOperationOrigin, authentication: NativePrivateAuthentication | null, submitBatch?: NativeSmartOperationPorts['submitBatch'], assertGuardianPolicy?: NativeSmartOperationPorts['assertGuardianPolicy']): Promise<NativeSmartAccountOperation> => {
          if (authentication !== null) assertNativePrivateAuthentication(authentication);
            if (!origin || !['dapp','local-new','local-resume'].includes(origin.kind)) throw new KeyringRuntimeError('INVALID_INPUT');
            if (origin.kind==='dapp') requireNativeSigningHandoff(origin.handoff);
            if (active || reserved || !catalogueSnapshot || !keyring.hasPublicSession() ||
                !nativeSigningEnabled(catalogueSnapshot.active.networkId, catalogueSnapshot.networks)) throw new KeyringRuntimeError('NOT_READY');
            let snapshot = catalogueSnapshot!, selected = selectedAccount();
            const ring = keyring, captured = generation;
            const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            let account = state.accounts.SmartAccount[selected.index];
            if (selected.type !== 'SmartAccount' || !account?.smartAccount ||
                account.smartAccount.chainId !== Number(network.chainId)) throw new KeyringRuntimeError('INVALID_INPUT');
            requireSmartAccountAddressIdentity(account, Number(network.chainId));
            const accountAddress = account.address, accountId = account.id;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (keyring !== ring || !ring.hasPublicSession() || catalogueSnapshot !== snapshot || selectedAccount() !== selected ||
                  state.accounts.SmartAccount[selected.index] !== account) throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            const rpc = new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch });
            const pendingRecords = await signedRecords.captureSmartAccountPendingRecords(
              { keyring: transactionRecordKeyring(ring, check), assertCurrent: check }, network.chainId, account.address);
            check();
            const ownerInventory = captureSmartSigningOwners();
            // Suite continuation owns only an actual Trezor signing plan. Ordinary
            // wallet operations keep their existing authorization/cancellation path.
            const localTrezor = origin.kind !== 'dapp' &&
              ownerInventory.localOwners.some(owner => owner.type === 'Trezor') &&
              canSignNativeSmartAccountActionHash(account.smartAccount, ownerInventory.localOwners, { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null }) &&
              getNativeSmartAccountSigningPlan(account.smartAccount, ownerInventory.localOwners, { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null })!
                .authenticators.some(entry => entry.owners.some(owner => owner.type === 'Trezor'));
            const saved=origin.kind==='local-resume'?origin.descriptor:null;
            const deadline=origin.kind==='dapp'?origin.handoff.expiresAt:saved?.expiresAt??Date.now()+SMART_ACCOUNT_EXECUTION_LIFETIME_MS;
            const scope=localTrezor?await localSmartScope(captured,check):null;check();
            if(saved&&(!scope||localSmartHandoffs.localDescriptor(saved.id)!==saved||!sameSigningResumeOwner(saved.scope,scope)||scope.unlockGeneration<=saved.scope.unlockGeneration))throw new KeyringRuntimeError('CANCELLED');
            let operation!:NativeSmartAccountOperation;
            let disposeOriginal:()=>Promise<void>;
            const id=saved?.id??`local-smart-${++trezorSequence}`;
            const localEntry: Parameters<NativeSigningHandoffs['captureLocal']>[0] | null = origin.kind!=='dapp'&&localTrezor?{id,scope:scope!,action:origin.kind==='local-new'?origin.action:origin.descriptor.action,
              expiresAt:deadline,order:0,assertCurrent:check,
              eligible:()=>operation?.getSnapshot().phase==='preparing-fee'&&!operation.getSnapshot().transactionHash&&!operation.getSnapshot().userOperationSubmissionStarted,
              drain:()=>disposeOriginal(),retire:()=>{if(localSmartContext?.handoff===handoff)localSmartContext=undefined;void disposeOriginal().catch(()=>undefined);},
            }:null;
            const handoff: NativeSigningHandoff | null = origin.kind==='dapp'?origin.handoff:localEntry?
              saved?localSmartHandoffs.resumeLocal(localEntry,snapshotNativeSmartLocalAction,saved):localSmartHandoffs.captureLocal(localEntry,snapshotNativeSmartLocalAction):null;
            const signOwnerProof = smartOwnerProofSequence(handoff);
            try {
            operation=createNativeSmartOperation({
              intent, pendingRecords, authorizationExpiresAt: Math.min(deadline, Date.now() + SMART_ACCOUNT_EXECUTION_LIFETIME_MS),
              // Dapp departure belongs to the connection queue; wallet actions use this local owner.
              background: localTrezor?backgroundLocalSmart:()=>undefined,
              signingOwners: ownerInventory.localOwners, assertOwnerCurrent(owner) {
                const record = ownerInventory.ownerRecords.get(`${owner.type}:${owner.id}`);
                check(); if (!record || state.accounts[owner.type][owner.id] !== record || record.address.toLowerCase() !== owner.address.toLowerCase()) throw new KeyringRuntimeError('CANCELLED');
              }, ...(submitBatch ? { submitBatch } : {}), ...(assertGuardianPolicy ? { assertGuardianPolicy } : {}),
              checkAddress: dependencies.checkSmartAccountAddress ?? (address => blacklistService.checkAddress(address)),
              account: account as IKeyringAccountState & { smartAccount: NonNullable<IKeyringAccountState['smartAccount']> },
              wallet: state, network, rpc, assertCurrent: check,
              p256WebAuthn: passkeys === null ? null : (metadata, intent, assertCurrent, signal) => ({
                signActionHash: request => {
                  const guard = () => { check(); checkGuard(assertCurrent); };
                  return signOwnerProof.passkey(metadata, intent, ownerInventory, request, guard,
                    () => passkeyCeremony(authentication, signal, guard, owner => passkeys.sign({ ...request, signal: owner, assertCurrent: guard })));
                },
              }),
              slhDsa: slhCapability === null ? null : (metadata, actionHash, assertCurrent, signal) =>
                slhDsaSigningPort(captured, metadata, accountId, actionHash, () => { check(); checkGuard(assertCurrent); }, null, signal, authentication),
              withOwnerProof(signal, assertCurrent, work) {
                check(); checkGuard(assertCurrent);
                if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
                const smartAccount = account?.smartAccount;
                if (!smartAccount) throw new KeyringRuntimeError('CANCELLED');
                const plan = getNativeSmartAccountSigningPlan(smartAccount, ownerInventory.localOwners,
                  { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null });
                if (plan?.authenticators.some(entry => entry.owners.some(owner => owner.type === 'Ledger')) && !ledger.isConnected())
                  throw new KeyringRuntimeError('NOT_READY');
                return run(async ownerGeneration => {
                  const guard = () => { current(ownerGeneration); check(); checkGuard(assertCurrent);
                    if (signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
                  guard(); const result = await work(); guard(); return result;
                });
              },
              async signOwner(address, digest, owner, assertCurrent, intent, signal, metadata) {
                if (owner.type === 'Ledger' && !ledger.isConnected()) throw new KeyringRuntimeError('NOT_READY');
                  const guard = () => { current(captured); check(); checkGuard(assertCurrent); };
                  guard();
                  const target = state.accounts[owner.type]?.[owner.id];
                  if ((owner.type !== 'HDAccount' && owner.type !== 'Imported' && owner.type !== 'Ledger' && owner.type !== 'Trezor') || !target ||
                      target.address.toLowerCase() !== address.toLowerCase()) throw new KeyringRuntimeError('INVALID_INPUT');
                  if (intent.actionHash !== digest) throw new KeyringRuntimeError('INVALID_INPUT');
                  const signingOwner: NativeSmartAccountSigningOwner = {id:owner.id,type:owner.type as NativeSmartAccountSigningOwner['type'],address};
                  const signature = await signOwnerProof.owner(signingOwner, metadata, intent, ownerInventory, guard, async (accept, position) => {
                    let trezorPort: NonNullable<SmartAccountOwnerSigningSdk['trezor']> | null = null;
                    if (owner.type === 'Trezor') {
                      requireNativeSigningHandoff(handoff);
                      if (!position) throw new KeyringRuntimeError('INVALID_INPUT');
                      trezorPort = smartTrezorSigningPort({id:owner.id,type:'Trezor',address}, metadata, intent, signal, guard, handoff, accept, position);
                    }
                    return signSmartAccountOwnerIntent({
                      intent, selectedSmart: { id: selected.index, type: selected.type, expectedAddress: selected.address },
                      owner: { ...owner, address }, authority: { assertCurrent: guard, signal },
                      sdk: smartOwnerSigningPorts(signingOwner, signal, guard, ring, trezorPort, authentication),
                    });
                  });
                  guard();
                  return signature;
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
                return prepareOwnedEvmTransaction(request, owned, selected, signal, guard, metadata, funding, { kind: 'estimate' }, null, null, authentication);
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
              async rememberCustomModule(signal, assertCurrent) {
                if (intent.kind !== 'modules' || intent.command.draft.kind !== 'install-custom') throw new KeyringRuntimeError('INVALID_INPUT');
                const draft = intent.command.draft, guard = () => { check(); checkGuard(assertCurrent); if (signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
                const preflight = await preflightModuleInstall(draft.address, signal, guard, intent.command.deploymentAdmission); guard();
                if (!preflight.ok) throw new Error('Custom validator preflight changed');
                const record = { address: draft.address, name: draft.name, initData: draft.initData, moduleType: 1, compositeCompatible: preflight.compositeCompatible };
                await run(async () => {
                  guard();
                  const next = await catalogue.mutate(snapshot.revision, { kind: 'set-smart-module-record', id: selected.id, address: draft.address, record }, guard);
                  guard(); publishAccounts(next);
                  snapshot = next; selected = selectedAccount(); account = state.accounts.SmartAccount[selected.index]!;
                });
                guard(); return record;
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
                if (intent.kind === 'modules') {
                  assertNativeSmartModuleCommandApplied(intent.command, account.smartAccount!);
                  if (intent.command.draft.kind === 'uninstall' && account.smartAccount!.customModules?.some((module: SmartAccountCustomModuleRecord) => module.address.toLowerCase() === intent.command.targetAddress.toLowerCase())) {
                    const guard = () => { check(); checkGuard(assertCurrent); if (signal.aborted) throw new KeyringRuntimeError('CANCELLED'); };
                    await run(async () => {
                      guard();
                      const next = await catalogue.mutate(snapshot.revision, { kind: 'set-smart-module-record', id: selected.id, address: intent.command.targetAddress, record: null }, guard);
                      guard(); publishAccounts(next); snapshot = next; selected = selectedAccount(); account = state.accounts.SmartAccount[selected.index]!;
                    });
                  }
                }
                if (intent.kind === 'authenticator') {
                  assertSmartAccountValidatorSwitchApplied(intent.command, account.smartAccount!);
                }
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
            if(localTrezor){
              requireNativeSigningHandoff(handoff);
              disposeOriginal=operation.dispose.bind(operation);
              const owned:LocalSmartContext={handoff,operation,disposeOriginal};
              localSmartContext=owned;
              operation.dispose=async()=>{
                const suspended=handoff.isSuspended();if(localSmartContext===owned)localSmartContext=undefined;
                retireNativeSigningHandoff(handoff);
                await disposeOriginal();
                if(!suspended&&pendingTrezor?.operation==='smart-operation'&&pendingTrezor.resume?.id===handoff.id)await cancelTrezor();
              };
              if(saved)localSmartHandoffs.discard(saved,false);
            }
            check();
            return operation;
            } catch (error) {
              if (handoff) retireNativeSigningHandoff(handoff);
              if (localSmartContext?.handoff === handoff) localSmartContext = undefined;
              try { if (saved) localSmartHandoffs.discard(saved); } finally { await operation?.dispose(); }
              throw error;
            }
        };
        const openGuardianPolicy = async (draft: NativeGuardianPolicyDraft, signal: AbortSignal, assertOwner: () => void, origin: SmartOperationOrigin, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation> => {
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
            return openSmartAccountOperation({ kind: 'guardian-policy', command }, assertOwner, origin, authentication, undefined, assertPolicy);
        };
        const openSmartAccountAuthenticator = async (target: SmartAccountAuthenticatorBuildResult, signal: AbortSignal, assertOwner: () => void, origin: SmartOperationOrigin, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation> => {
            const captured = generation, before = catalogueSnapshot;
            if (!before) throw new KeyringRuntimeError('NOT_READY');
            const address = selectedAccount().address;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot?.active.accountId !== before.active.accountId ||
                  catalogueSnapshot.active.networkId !== before.active.networkId || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            await refreshSmartAccountMetadata(signal, check);
            check();
            const selected = selectedAccount();
            const account = state.accounts.SmartAccount[selected.index];
            if (!account?.smartAccount) throw new KeyringRuntimeError('NOT_READY');
            if (!canSignSmartAccount() && (!account.smartAccount.auth || getSmartAccountAuthHash(account.smartAccount.auth) !== getSmartAccountAuthHash(target.auth)))
              throw new KeyringRuntimeError('NOT_READY');
            const command = buildSmartAccountValidatorSwitch({ accountAddress: account.address,
              chainId: account.smartAccount.chainId, metadata: account.smartAccount, target });
            return openSmartAccountOperation({ kind: 'authenticator', command }, check, origin, authentication);
        };
        const openPasskeyAuthenticator = async (recreate: boolean, expectedCredentialHash: string | null, signal: AbortSignal, assertOwner: () => void, origin: SmartOperationOrigin | null, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation> => {
            if (!passkeys || !authentication || typeof recreate !== 'boolean' || !catalogueSnapshot || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const captured = generation, before = catalogueSnapshot, address = selectedAccount().address;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot?.active.accountId !== before.active.accountId ||
                  catalogueSnapshot.active.networkId !== before.active.networkId || selectedAccount().address !== address) throw new KeyringRuntimeError('CANCELLED');
            };
            await refreshSmartAccountMetadata(signal, check); check();
            const selected = selectedAccount(), account = state.accounts.SmartAccount[selected.index];
            if (!account?.smartAccount || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const records = await passkeyRegistry.read(address, check); check();
            const candidates = [records.pending?.profile, records.active].filter((value): value is IPasskeyCredentialProfile => !!value);
            let profile = expectedCredentialHash ? candidates.find(value => value.credentialIdHash.toLowerCase() === expectedCredentialHash.toLowerCase())
              : !recreate ? candidates[0] : undefined;
            if (expectedCredentialHash && !profile) throw new KeyringRuntimeError('CANCELLED');
            const name = `Pali ${account.label || 'Smart account'}`.slice(0, 80);
            if (profile) {
              try {
                await passkeyCeremony(authentication, signal, check, owner => passkeys.sign({ actionHash: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
                  credentialId: profile!.credentialId, expectedCredentialIdHash: profile!.credentialIdHash, expectedPublicKey: profile!.publicKey,
                  signal: owner, assertCurrent: check }));
              } catch (error) { check(); throw Object.assign(new Error('Passkey could not be verified'), { code: 'PASSKEY_POSSESSION_FAILED', cause: error }); }
            } else {
              const installed = !recreate && account.smartAccount.installedModules?.find((module: SmartAccountValidatorModule): module is Extract<SmartAccountValidatorModule, {id:'p256-webauthn'}> => module.id === 'p256-webauthn');
              if (installed) {
                try {
                  const restored = await passkeyCeremony(authentication, signal, check, owner => passkeys.recover({ expectedCredentialIdHash: installed.config.credentialIdHash,
                    expectedPublicKey: installed.config.publicKey, signal: owner, assertCurrent: check }));
                  profile = { ...restored, passkeyName: installed.config.passkeyName || name };
                } catch (error) { check(); throw Object.assign(new Error('Passkey could not be verified'), { code: 'PASSKEY_POSSESSION_FAILED', cause: error }); }
              } else {
                profile = passkeyRegistrationToProfile(await passkeyCeremony(authentication, signal, check,
                  owner => passkeys.create({ accountName: name, signal: owner, assertCurrent: check })), name);
              }
            }
            if (!profile) throw new KeyringRuntimeError('NOT_READY');
            check(); await passkeyRegistry.savePending(address, profile, check); check();
            const target = buildP256WebAuthnAuthenticator({ chainId: account.smartAccount.chainId, config: profile });
            const ownedOrigin: SmartOperationOrigin = origin ?? { kind: 'local-new', action: {kind:'passkey-authenticator',credentialIdHash:profile.credentialIdHash} };
            return openSmartAccountAuthenticator(target, signal, check, ownedOrigin, authentication);
        };
        const openWalletAuthenticator = async (signal: AbortSignal, assertOwner: () => void, origin: SmartOperationOrigin, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation> => {
            if (!catalogueSnapshot || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const selected = selectedAccount(), account = state.accounts.SmartAccount[selected.index];
            if (!account?.smartAccount) throw new KeyringRuntimeError('NOT_READY');
            const hdOwner = state.accounts.HDAccount[0] ?? Object.values(state.accounts.HDAccount)[0];
            const ownerType = hdOwner ? 'HDAccount' as const : 'Imported' as const;
            const owner = hdOwner ?? Object.values(state.accounts.Imported)[0];
            if (!owner || owner.isSmartAccount || owner.isLedgerWallet || owner.isTrezorWallet)
              throw new KeyringRuntimeError('NOT_READY');
            const ownerId = owner.id, ownerAddress = owner.address;
            const checkOwner = () => {
              checkGuard(assertOwner);
              const currentOwner = state.accounts[ownerType][ownerId];
              if (!currentOwner || currentOwner.address.toLowerCase() !== ownerAddress.toLowerCase() ||
                  currentOwner.isSmartAccount || currentOwner.isLedgerWallet || currentOwner.isTrezorWallet)
                throw new KeyringRuntimeError('CANCELLED');
            };
            return openSmartAccountAuthenticator(buildECDSAAuthenticator({ chainId: account.smartAccount.chainId,
              config: { owners: [ownerAddress], threshold: 1 } }), signal, checkOwner, origin, authentication);
        };
        const preflightModuleInstall = async (address: string, signal: AbortSignal, assertOwner: () => void, deploymentAdmission: NativeSmartModuleDeploymentAdmission): Promise<CustomValidatorPreflightResult> => {
            const captured = generation, snapshot = catalogueSnapshot, selected = selectedAccount();
            const account = state.accounts.SmartAccount[selected.index];
            if (!snapshot || selected.type !== 'SmartAccount' || !account?.smartAccount ||
                (deploymentAdmission === 'deployed-only' && !account.smartAccount.isDeployed))
              throw new KeyringRuntimeError('NOT_READY');
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || snapshot !== catalogueSnapshot || selected !== selectedAccount() ||
                  state.accounts.SmartAccount[selected.index] !== account) throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            const network = getNativeNetwork(snapshot.active.networkId, snapshot.networks);
            requireSmartAccountAddressIdentity(account, Number(network.chainId));
            const rpc = new EvmTransferReadRpc(network, { fetch: dependencies.connectionFetch ?? walletFetch });
            const provider = createNativeSmartAccountProvider(network, rpc, signal, check);
            await provider.verifyConfiguredChainId(); check();
            const result = await preflightCustomValidatorInstall(provider, { address, chainId: Number(network.chainId), metadata: account.smartAccount });
            check(); return result;
        };
        const readSmartAccountModules = async (signal: AbortSignal, assertOwner: () => void): Promise<ISmartAccountMetadata> => {
            await refreshSmartAccountMetadata(signal, assertOwner); checkGuard(assertOwner);
            if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            const selected = selectedAccount(), metadata = selected.type === 'SmartAccount' ? state.accounts.SmartAccount[selected.index]?.smartAccount : null;
            if (!metadata?.isDeployed || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            return JSON.parse(JSON.stringify(metadata));
        };
        const openSmartAccountModuleChange = async (input: NativeSmartModuleDraft, signal: AbortSignal, assertOwner: () => void, origin: SmartOperationOrigin, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation> => {
            const draft = snapshotNativeSmartModuleDraft(input);
            const captured = generation, before = catalogueSnapshot;
            if (!before || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const address = selectedAccount().address;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot?.active.accountId !== before.active.accountId ||
                  catalogueSnapshot.active.networkId !== before.active.networkId || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            await refreshSmartAccountMetadata(signal, check); check();
            const deploymentAdmission: NativeSmartModuleDeploymentAdmission = origin.kind === 'dapp' ? 'constructor-or-deployed' : 'deployed-only';
            if (draft.kind === 'install-custom') {
              const preflight = await preflightModuleInstall(draft.address, signal, check, deploymentAdmission); check();
              if (!preflight.ok) throw new Error('Custom validator preflight failed');

            }
            const selected = selectedAccount(), account = state.accounts.SmartAccount[selected.index];
            if (!account?.smartAccount || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const command = buildNativeSmartModuleCommand({ accountAddress: account.address, metadata: account.smartAccount, draft,
              deploymentAdmission, removalPolicy: origin.kind === 'dapp' ? 'active-composite' : 'all-installed-composites',
              isAlgorithmAvailable: module => module.id === 'ecdsa' || (module.id === 'p256-webauthn' && passkeys !== null) || (module.id === 'slh-dsa' && slhCapability !== null) });
            if (draft.kind === 'composite') {
              const installed = account.smartAccount.installedModules?.filter((module: NonNullable<ISmartAccountMetadata['installedModules']>[number]) => module.id !== 'composite') ?? [];
              const data = encodeCompositeValidatorInitData([...draft.children], draft.threshold);
              const proposed: ISmartAccountMetadata = { ...account.smartAccount, auth: { module: 'composite', validator: command.targetAddress, data },
                installedModules: [...installed, { type: 'validator', id: 'composite', address: command.targetAddress, data,
                  config: { childValidators: [...draft.children], threshold: draft.threshold } }] };
              if (!canSignNativeSmartAccountActionHash(proposed, captureSmartSigningOwners().localOwners, { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null }))
                throw new Error('The selected approval rule cannot be signed on this device');
            }
            return openSmartAccountOperation({ kind: 'modules', command }, check, origin.kind === 'local-new'
              ? { kind: 'local-new', action: { kind: 'modules', draft } } : origin, authentication);
        };
        const openSlhDsaInstallation = async (keyId: string, signal: AbortSignal, assertOwner: () => void, origin: SmartOperationOrigin, authentication: NativePrivateAuthentication | null): Promise<NativeSmartAccountOperation> => {
            if (typeof keyId !== 'string' || parseSLHDSAStateStorageKey(getSLHDSAStateStorageKey(keyId)) !== keyId) throw new KeyringRuntimeError('INVALID_INPUT');
            const captured = generation, before = catalogueSnapshot;
            if (!before || !canManageSlhDsa() || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const address = selectedAccount().address;
            const check = () => {
              current(captured); checkGuard(assertOwner);
              if (signal.aborted || catalogueSnapshot?.active.accountId !== before.active.accountId ||
                  catalogueSnapshot.active.networkId !== before.active.networkId || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            await refreshSmartAccountMetadata(signal, check); check();
            const selected = selectedAccount(), account = state.accounts.SmartAccount[selected.index];
            if (!account?.smartAccount || !canSignSmartAccount()) throw new KeyringRuntimeError('NOT_READY');
            const descriptor = account.smartAccount.descriptor;
            if (!descriptor) throw new KeyringRuntimeError('NOT_READY');
            const runtime = await getSlhDsa(captured); check();
            const installed = account.smartAccount.installedModules?.find((module: NonNullable<ISmartAccountMetadata['installedModules']>[number]): module is Extract<SmartAccountValidatorModule, { id: 'slh-dsa' }> =>
              module.type === 'validator' && module.id === 'slh-dsa' && module.config.keyId === keyId);
            const prepared = installed
              ? await runtime.hydrateInstalled(installed.config, check)
              : await runtime.inspectPrepared(keyId, descriptor.accountIndex, check);
            check();
            if (!prepared) throw new KeyringRuntimeError('NOT_READY');
            const target = buildSLHDSAAuthenticator({ chainId: account.smartAccount.chainId, config: {
              keyId: prepared.keyId, parameterSet: prepared.parameterSet, pkRoot: prepared.pkRoot, pkSeed: prepared.pkSeed, signatureLimit: prepared.signatureLimit,
            } });
            const command = buildSmartAccountValidatorSwitch({ accountAddress: account.address, chainId: account.smartAccount.chainId, metadata: account.smartAccount, target });
            return openSmartAccountOperation({ kind: 'authenticator', command }, check, origin, authentication);
        };
        return {
          async resumeSmartAccountOperation(id,signal,assertOwner,authentication){
            if(signal.aborted)throw new KeyringRuntimeError('CANCELLED');
            const descriptor=localSmartHandoffs.localDescriptor(id);if(!descriptor)throw new KeyringRuntimeError('NOT_READY');
            const captured=generation;
            const check=()=>{current(captured);checkGuard(assertOwner);if(signal.aborted||localSmartHandoffs.localDescriptor(id)!==descriptor)throw new KeyringRuntimeError('CANCELLED');};
            try{
              check();await localSmartHandoffs.drain(id);check();
              const scope=await localSmartScope(captured,check);check();
              if(!sameSigningResumeOwner(descriptor.scope,scope)||scope.unlockGeneration<=descriptor.scope.unlockGeneration)throw new KeyringRuntimeError('CANCELLED');
              const origin:SmartOperationOrigin={kind:'local-resume',descriptor},action=descriptor.action;
              if(action.kind==='guardian-policy')return await openGuardianPolicy(action.draft,signal,assertOwner,origin,authentication);
              if(action.kind==='passkey-authenticator')return await openPasskeyAuthenticator(false,action.credentialIdHash,signal,assertOwner,origin,authentication);
              if(action.kind==='wallet-authenticator')return await openWalletAuthenticator(signal,assertOwner,origin,authentication);
              if(action.kind==='modules')return await openSmartAccountModuleChange(action.draft,signal,assertOwner,origin,authentication);
              if(action.kind==='slh-installation')return await openSlhDsaInstallation(action.keyId,signal,assertOwner,origin,authentication);
              return await openSmartAccountOperation(action.intent,assertOwner,origin,authentication);
            }catch(error){localSmartHandoffs.discard(descriptor);throw error;}
          },
          ledger,
          trezor,
          getGuardianRecoveryIntent,
          openSmartInfrastructure, openResumedSmartInfrastructure,
          openGuardianRecovery,
          canManageGuardianPolicy,
          inspectGuardianRemoval,
          refreshSmartAccountMetadata,
          openGuardianPolicy: (draft, signal, assertOwner, authentication) => openGuardianPolicy(draft, signal, assertOwner, {kind:'local-new',action:{kind:'guardian-policy',draft}}, authentication),
          openSlhDsaAccount, canSignSmartAccount, canManageSlhDsa,
          canUsePasskeys: () => passkeys !== null,
          openPasskeyAuthenticator: (recreate, signal, assertOwner, authentication) => openPasskeyAuthenticator(recreate, null, signal, assertOwner, null, authentication),
          readSmartAccountModules, preflightSmartAccountModule: (address, signal, assertOwner) => preflightModuleInstall(address, signal, assertOwner, 'deployed-only'),
          openSmartAccountModuleChange: (draft, signal, assertOwner, authentication) => openSmartAccountModuleChange(draft, signal, assertOwner, { kind: 'local-new', action: { kind: 'modules', draft } }, authentication),
          openSmartAccountDeployment: (assertOwner, authentication) => openSmartAccountOperation({ kind: 'deploy' }, assertOwner, {kind:'local-new',action:{kind:'operation',intent:{kind:'deploy'}}}, authentication),
          canUseWalletAuthenticator: () => {
            if (!canSignSmartAccount()) return false;
            const selected = selectedAccount();
            return state.accounts.SmartAccount[selected.index]?.smartAccount?.isDeployed === true;
          },
          openWalletAuthenticator: (signal, assertOwner, authentication) => openWalletAuthenticator(signal, assertOwner, {kind:'local-new',action:{kind:'wallet-authenticator'}}, authentication),
          openSlhDsaInstallation: (keyId, signal, assertOwner, authentication) => openSlhDsaInstallation(keyId, signal, assertOwner, {kind:'local-new',action:{kind:'slh-installation',keyId}}, authentication),
          async openSmartAccountSend(recipient, amount, assertOwner, authentication) {
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
            return openSmartAccountOperation(intent, assertOwner, {kind:'local-new',action:{kind:'operation',intent}}, authentication);
          },
          async openConnectionHost(): Promise<NativeConnectionSigningHost> {
            const captured = generation;
            const repository = await getConnectionRepository(captured);
            const walletBindingId = connectionRepositoryBinding;
            if (!walletBindingId) throw new KeyringRuntimeError('CANCELLED');
            const assertOwner = connectionOwner(walletBindingId);
            assertOwner();
            type DappRingBinding = ReturnType<typeof createOwnedKeyringTransfer<IndexedKeyring, NativeTrezorSession>>;
            const hardwareDappSigner = (selected: NativeCatalogueAccount, network: NativeNetworkRegistration,
              approval: ReturnType<typeof createDappSigningApproval>, check: () => void, binding: DappRingBinding, handoff: import('../connections/signingHandoff.ts').NativeSigningHandoff) => {
              if (selected.type !== 'Ledger' && selected.type !== 'Trezor') return null;
              const account: NativeHardwareDappAccount = {id: selected.id, index: selected.index, type: selected.type, address: selected.address};
              const signer = createNativeHardwareDappSigning({account, network, signal: approval.signal, assertCurrent: check, beforeSignature: handoff.beforeSignature,
                async withSession(requested, assertSigningCurrent, operation) {
                  checkGuard(assertSigningCurrent);
                  if (requested.id !== selected.id || requested.index !== selected.index || requested.type !== selected.type ||
                      requested.address !== selected.address) throw new KeyringRuntimeError('CANCELLED');
                  if (requested.type === 'Ledger') {
                    return withLedgerSigningSession(binding.current(), approval.signal, assertSigningCurrent, operation);
                  }
                  if (trezorSession) throw new KeyringRuntimeError('NOT_READY');
                  const captured = generation, admittedEpoch = trezorEpoch;
                  let owned: NativeTrezorSession | undefined, retirement: Promise<void> | undefined;
                  const stillOwned = () => owned !== undefined && (pendingTrezor?.job === owned.job || trezorSession === owned);
                  const guard = () => {current(captured); checkGuard(assertSigningCurrent); if (trezorEpoch !== admittedEpoch) throw new KeyringRuntimeError('CANCELLED');};
                  const retire = () => {
                    if (!owned) return;
                    retirement ??= pendingTrezor?.job === owned.job || trezorSession === owned ? (handoff.isSuspended() ? retireTrezor() : cancelTrezor()) : owned.cancel();
                    void retirement?.catch(() => undefined);
                  };
                  try {
                    const resume: NativeTrezorResumeIntent = Object.freeze({ kind: 'external-signing', id: handoff.id, accountId: selected.id, networkId: network.id });
                    const opened = await openTrezorAttempt(captured, guard, 'external-signing', selected.label, resume, binding.transferred, handoff.beforeSuiteOpen);
                    owned = opened.session;
                    approval.signal.addEventListener('abort', retire, {once: true});
                    guard();
                    if (!opened.ring.trezorSigner) throw new KeyringRuntimeError('NOT_READY');
                    const result = await operation({kind: 'Trezor', signer: opened.ring.trezorSigner, transactions: opened.ring.ethereumTransaction});
                    guard(); await finishTrezor(owned, guard); guard();
                    return result;
                  } catch (error) {
                    if (!handoff.isSuspended()) await failTrezor(captured, admittedEpoch, error);
                    throw error;
                  } finally {
                    approval.signal.removeEventListener('abort', retire);
                    if (stillOwned()) retire();
                    await retirement;
                  }
                },
              });
              return {...signer, keyring: () => binding.current()};
            };
            const captureTransaction = (
              input: Omit<Parameters<NativeConnectionSigningHost['prepareTransaction']>[0], 'handoff'>,
              assertRequestCurrent: () => void
            ) => {
              assertOwner();
              checkGuard(assertRequestCurrent);
              const snapshot = catalogueSnapshot,
                ring = keyring,
                captured = generation,
                approval = input.approval;
              if (!ring.hasPublicSession() || !snapshot || active || reserved)
                throw new KeyringRuntimeError('NOT_READY');
              const selected = snapshot.accounts.find(
                (account) => account.id === snapshot.active.accountId
              );
              if (
                !selected ||
                (selected.type !== 'HDAccount' &&
                  selected.type !== 'Imported' &&
                  selected.type !== 'SmartAccount' && selected.type !== 'Ledger' && selected.type !== 'Trezor') ||
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
              const ownerCurrent = () =>
                !closed &&
                generation === captured &&
                catalogueSnapshot === snapshot &&
                state.activeAccount.id === selected.index &&
                state.activeAccount.type === selected.type &&
                state.accounts[selected.type][selected.index] === account &&
                account?.address === selected.address &&
                state.activeNetwork.kind === sdk.INetworkType.Ethereum &&
                state.activeNetwork.chainId === Number(network.chainId) &&
                state.activeNetwork.url === network.rpcUrl;
              const binding = createOwnedKeyringTransfer({initial: ring, current: () => keyring,
                worker: () => trezorWorker, session: () => trezorSession,
                assertOwner() {assertOwner(); if (!ownerCurrent() || approval.signal.aborted) throw new KeyringRuntimeError('CANCELLED');}});
              const isCurrent = () => ownerCurrent() && binding.matches() && keyring.hasPublicSession();
              approval.bindSigner('native-transaction', isCurrent);
              const check = () => {
                current(captured);
                assertOwner();
                checkGuard(approval.assertCurrent);
                checkGuard(assertRequestCurrent);
                if (!isCurrent()) throw new KeyringRuntimeError('CANCELLED');
              };
              check();
              return { snapshot, selected, account, network, approval, check, binding };
            };
            const captureLocalSmartOwners = () => captureSmartSigningOwners();
            const findLocalEcdsaOwner = (address: string): SmartAccountLocalOwner | null => {
              const owner = captureSmartSigningOwners().localOwners.find(owner => owner.address.toLowerCase() === address.toLowerCase());
              return owner ? {id: owner.id, type: owner.type as SmartAccountLocalOwner['type']} : null;
            };
            const supportsLocalSmartAccount = (accountId: string) => {
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
                !keyring.hasPublicSession() ||
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
                return canSignNativeSmartAccountActionHash(saved.smartAccount, captureLocalSmartOwners().localOwners, { p256WebAuthn: passkeys !== null, slhDsa: slhCapability !== null });
              } catch {
                return false;
              }
            };
            return Object.freeze({
              repository,
              walletBindingId,
              assertOwner,
              verifyPersonalMessage(message, signature) {
                assertOwner();
                const result = keyring.ethereumTransaction.verifyPersonalMessage(message, signature);
                assertOwner();
                return result;
              },
              async recoverStoppedEoaCalls(origin, id, assertStopped) {
                const ring = keyring;
                const check = () => {
                  assertOwner(); checkGuard(assertStopped);
                  if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                };
                check();
                await recoverRetainedEoaCallsAttempt(signedRecords,
                  signedRecords.captureSession({ keyring: transactionRecordKeyring(ring, check), assertCurrent: check }),
                  repository.calls, origin, id, check);
              },
              async recordStoppedEoaCalls(input) {
                assertOwner();
                const ring = keyring;
                const check = () => {
                  assertOwner();
                  if (keyring !== ring || !ring.hasPublicSession())
                    throw new KeyringRuntimeError('CANCELLED');
                };
                check();
                const session = signedRecords.captureSession({
                  keyring: ring,
                  assertCurrent: check,
                });
                await repository.calls.recordStoppedEoaAttempt(
                  input.origin,
                  input.bundleId,
                  input.reservationId,
                  input.submissionId,
                  input.attempt,
                  () =>
                    readRetainedEoaCall(signedRecords, session, input.attempt)
                );
              },
              sessionGeneration() {
                assertOwner();
                return generation;
              },
              calls: repository.calls,
              supportsAtomicCalls: supportsLocalSmartAccount,
              supportsSmartAccountMessages: supportsLocalSmartAccount,
              async allocateSmartAccount(input, signal, assertRequestCurrent, onCommitted, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                assertOwner(); checkGuard(assertRequestCurrent);
                if (typeof onCommitted !== 'function' || !signal || typeof signal.addEventListener !== 'function' || signal.aborted)
                  throw new KeyringRuntimeError('INVALID_INPUT');
                if (!input || typeof input !== 'object') throw new KeyringRuntimeError('INVALID_INPUT');
                const fields = Object.getOwnPropertyDescriptors(input);
                if (Reflect.ownKeys(fields).sort().join(',') !== 'externalOwnersAcknowledged,label,networkId,target' ||
                    Object.values(fields).some(field => !Object.hasOwn(field, 'value'))) throw new KeyringRuntimeError('INVALID_INPUT');
                const request = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])) as NativeSmartCreationRequest;
                if (
                    typeof request.networkId !== 'string' || typeof request.externalOwnersAcknowledged !== 'boolean' ||
                    typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label ||
                    request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label))
                  throw new KeyringRuntimeError('INVALID_INPUT');
                if (!request.target || typeof request.target !== 'object') throw new KeyringRuntimeError('INVALID_INPUT');
                const targetFields = Object.getOwnPropertyDescriptors(request.target);
                if (!targetFields.id || Reflect.ownKeys(targetFields).some(key => key !== 'id' && key !== 'config') ||
                    Object.values(targetFields).some(field => !Object.hasOwn(field, 'value'))) throw new KeyringRuntimeError('INVALID_INPUT');
                const config = targetFields.config?.value;
                const target = resolveSmartAccountPreparationTarget({ id: targetFields.id.value,
                  config: config === undefined ? undefined : decodeStorageValue(encodeStorageValue(config)) }, { slhDsaSupported: slhCapability !== null });
                if (target.id !== 'ecdsa' && (!authentication || (target.id === 'p256-webauthn' ? !passkeys : target.id !== 'slh-dsa' || !slhCapability)))
                  throw new KeyringRuntimeError('NOT_READY');
                const before = catalogueSnapshot, ring = keyring, captured = generation;
                if (!before || !ring.hasPublicSession() || before.active.networkId !== request.networkId ||
                    findUtxoNetwork(request.networkId, before.utxoNetworks) || !dependencies.prepareSmartAccount)
                  throw new KeyringRuntimeError('NOT_READY');
                const network = getNativeNetwork(request.networkId, before.networks), selected = selectedAccount();
                const management = state.accounts.HDAccount[0];
                if (!management?.address || !management.xpub) throw new KeyringRuntimeError('NOT_READY');
                const managementIdentity = JSON.stringify([management.address, management.xpub]);
                if (target.id === 'ecdsa' && target.config) {
                  buildECDSAAuthenticator({ chainId: Number(network.chainId), config: { owners: [...target.config.owners], threshold: target.config.threshold } });
                  const local = (['HDAccount', 'Imported', 'Ledger', 'Trezor'] as const).flatMap(type => Object.values(state.accounts[type]).map(account => account.address.toLowerCase()));
                  if (target.config.owners.some(owner => !local.includes(owner.toLowerCase())) && !request.externalOwnersAcknowledged)
                    throw new KeyringRuntimeError('INVALID_INPUT');
                }
                const check = () => {
                  assertOwner(); current(captured); checkGuard(assertRequestCurrent);
                  if (signal.aborted || keyring !== ring || !ring.hasPublicSession() || catalogueSnapshot !== before || selectedAccount() !== selected)
                    throw new KeyringRuntimeError('CANCELLED');
                };
                let passkey: IPasskeyCredentialProfile | undefined;
                if (target.id === 'p256-webauthn') {
                  const previous = await passkeyRegistry.creation(check); check();
                  if (previous?.profile.passkeyName === request.label) {
                    await passkeyCeremony(authentication, signal, check, owner => passkeys!.sign({
                      actionHash: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), credentialId: previous.profile.credentialId,
                      expectedCredentialIdHash: previous.profile.credentialIdHash, expectedPublicKey: previous.profile.publicKey,
                      signal: owner, assertCurrent: check,
                    }));
                    passkey = previous.profile;
                  } else {
                    passkey = passkeyRegistrationToProfile(await passkeyCeremony(authentication, signal, check,
                      owner => passkeys!.create({ accountName: request.label, signal: owner, assertCurrent: check })), request.label);
                    if (!passkey) throw new KeyringRuntimeError('NOT_READY');
                    check(); await passkeyRegistry.saveCreation(passkey, check); check();
                  }
                }
                const slh: { prepared?: Readonly<{ keyId: string; target: SmartAccountAuthenticatorBuildResult }> } | undefined = target.id === 'slh-dsa' ? {} : undefined;
                let allocation: NativeSmartCreationAllocation | undefined, publishing = true;
                await run(async () => {
                  check();
                  await allocateSmartAccountRecord(request.label, before.revision, signal, check, (next, created) => {
                    const saved = next.accounts.find(account => account.type === 'SmartAccount' && account.index === created.id);
                    if (!saved || !created.smartAccount?.auth) throw new KeyringRuntimeError('OPERATION_FAILED');
                    const identity = (metadata: ISmartAccountMetadata | undefined) => metadata && JSON.stringify({
                      chainId: metadata.chainId, descriptor: metadata.descriptor, deploymentAuth: metadata.deploymentAuth,
                      deploymentSalt: metadata.deploymentSalt, factoryAddress: metadata.factoryAddress,
                    });
                    const expectedIdentity = identity(created.smartAccount);
                    const passkeyAuth = passkey ? Object.freeze(buildP256WebAuthnAuthenticator({ chainId: Number(network.chainId), config: passkey }).auth) : undefined;
                    const receipt: NativeSmartCreationAllocation = Object.freeze({
                      account: Object.freeze({ id: saved.id, index: saved.index, type: 'SmartAccount', address: saved.address, xpub: created.xpub, label: saved.label }),
                      networkId: request.networkId, chainId: Number(network.chainId), target,
                      get targetAuth() { return passkeyAuth ?? slh?.prepared?.target.auth; },
                      assertCurrent() {
                        assertOwner(); current(captured); checkGuard(assertRequestCurrent);
                        const snapshot = catalogueSnapshot, provisional = publishing && snapshot === before;
                        const record = provisional ? created : state.accounts.SmartAccount[saved.index];
                        if (signal.aborted || keyring !== ring || !ring.hasPublicSession() || !snapshot ||
                            (!provisional && snapshot.active.accountId !== saved.id) || snapshot.active.networkId !== request.networkId ||
                            getNativeNetwork(request.networkId, snapshot.networks).registrationHash !== network.registrationHash ||
                            record?.address !== saved.address || record.xpub !== created.xpub || identity(record.smartAccount) !== expectedIdentity ||
                            JSON.stringify([state.accounts.HDAccount[0]?.address, state.accounts.HDAccount[0]?.xpub]) !== managementIdentity)
                          throw new KeyringRuntimeError('CANCELLED');
                        requireSmartAccountAddressIdentity(record, Number(network.chainId));
                      },
                    });
                    smartCreationAllocations.set(receipt, Object.freeze({ signal, target, passkey, slh, ring, generation: captured,
                      bootstrapAuthHash: getSmartAccountAuthHash(created.smartAccount.auth) }));
                    allocation = receipt;
                    checkGuard(() => onCommitted(receipt));
                  }, null, () => undefined, authentication);
                  publishing = false;
                });
                if (!allocation) throw new KeyringRuntimeError('OPERATION_FAILED');
                allocation.assertCurrent();
                if (passkey) await passkeyRegistry.transferCreation(allocation.account.address, passkey, allocation.assertCurrent);
                allocation.assertCurrent(); return allocation;
              },
              async prepareSmartAccountCreationOperation(allocation, handoff, assertRequestCurrent, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                const owned = smartCreationAllocations.get(allocation);
                if (!owned || (owned.target.id === 'ecdsa' ? !owned.target.config : owned.target.id === 'p256-webauthn' ? !owned.passkey : owned.target.id !== 'slh-dsa' || !owned.slh || !authentication))
                  throw new KeyringRuntimeError('INVALID_INPUT');
                requireNativeSigningHandoff(handoff);
                const check = () => {
                  current(owned.generation); allocation.assertCurrent(); checkGuard(assertRequestCurrent);
                  if (keyring !== owned.ring || allocation.target !== owned.target) throw new KeyringRuntimeError('CANCELLED');
                };
                check();
                if (owned.slh && !owned.slh.prepared) {
                  const facade = await openSlhDsaAccount(check, owned.signal, authentication); check();
                  const existing = await facade.readPrepared(); check();
                  if (existing.length > 1) throw new KeyringRuntimeError('NOT_READY');
                  const key = existing[0] ?? await facade.prepareFresh(() => undefined); check();
                  const prepared = Object.freeze({ keyId: key.keyId, target: Object.freeze(buildSLHDSAAuthenticator({ chainId: allocation.chainId, config: {
                    keyId: key.keyId, parameterSet: key.parameterSet, pkRoot: key.pkRoot, pkSeed: key.pkSeed, signatureLimit: key.signatureLimit,
                  } })) });
                  Object.freeze(prepared.target.auth);
                  const concurrent = smartCreationAllocations.get(allocation)?.slh?.prepared;
                  if (concurrent && concurrent.keyId !== prepared.keyId) throw new KeyringRuntimeError('CANCELLED');
                  owned.slh.prepared = prepared;
                }
                const target = owned.target.id === 'p256-webauthn'
                  ? buildP256WebAuthnAuthenticator({ chainId: allocation.chainId, config: owned.passkey! })
                  : owned.target.id === 'ecdsa' && owned.target.config
                    ? buildECDSAAuthenticator({ chainId: allocation.chainId, config: { owners: [...owned.target.config.owners], threshold: owned.target.config.threshold } })
                    : owned.slh?.prepared?.target ?? (() => { throw new KeyringRuntimeError('INVALID_INPUT'); })();
                const assertSource = () => {
                  check();
                  const metadata = state.accounts.SmartAccount[allocation.account.index]?.smartAccount;
                  if (!metadata?.auth || ![owned.bootstrapAuthHash, getSmartAccountAuthHash(target.auth)].includes(getSmartAccountAuthHash(metadata.auth)))
                    throw new KeyringRuntimeError('CANCELLED');
                };
                await refreshSmartAccountMetadata(owned.signal, check); assertSource();
                if (!state.accounts.SmartAccount[allocation.account.index]!.smartAccount!.isDeployed)
                  return openSmartAccountOperation({ kind: 'deploy' }, assertSource, { kind: 'dapp', handoff }, authentication);
                if (owned.slh?.prepared)
                  return openSlhDsaInstallation(owned.slh.prepared.keyId, owned.signal, assertSource, { kind: 'dapp', handoff }, authentication);
                return openSmartAccountAuthenticator(target, owned.signal, assertSource, { kind: 'dapp', handoff }, authentication);
              },
              async prepareModuleChange(input, assertRequestCurrent, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                assertOwner(); input.approval.assertCurrent(); checkGuard(assertRequestCurrent);
                requireNativeSigningHandoff(input.handoff);
                const ring = keyring, captured = generation, initial = catalogueSnapshot;
                const selected = initial?.accounts.find(account => account.id === input.accountId);
                if (!initial || !selected || selected.type !== 'SmartAccount' || initial.active.accountId !== selected.id ||
                    initial.active.networkId !== input.networkId || !ring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
                const registration = getNativeNetwork(input.networkId, initial.networks), address = selected.address;
                const owned = () => {
                  assertOwner(); current(captured);
                  const snapshot = catalogueSnapshot, activeAccount = snapshot?.accounts.find(account => account.id === input.accountId);
                  if (keyring !== ring || !ring.hasPublicSession() || input.approval.signal.aborted || !snapshot ||
                      snapshot.active.accountId !== input.accountId || snapshot.active.networkId !== input.networkId ||
                      activeAccount?.type !== 'SmartAccount' || activeAccount.address !== address ||
                      state.accounts.SmartAccount[activeAccount.index]?.address.toLowerCase() !== address.toLowerCase() ||
                      getNativeNetwork(input.networkId, snapshot.networks).registrationHash !== registration.registrationHash)
                    throw new KeyringRuntimeError('CANCELLED');
                  return true;
                };
                input.approval.bindSigner(`native-smart-module:${input.accountId}`, owned);
                const check = () => { owned(); input.approval.assertCurrent(); checkGuard(assertRequestCurrent); };
                const request = normalizeSmartAccountModuleRequest(input.request.method, [input.request.module]);
                const draft: NativeSmartModuleDraft = request.action === 'install'
                  ? { kind: 'install-custom', address: request.module.address ?? '', name: request.module.name ?? '', initData: request.module.initData ?? '0x' }
                  : { kind: 'uninstall', address: request.module.address ?? '' };
                const operation = await openSmartAccountModuleChange(draft, input.approval.signal, check, { kind: 'dapp', handoff: input.handoff }, authentication);
                try { check(); return { operation, approval: null }; }
                catch (error) { await operation.dispose(); throw error; }
              },
              readSmartAccountModules(accountId, networkId, assertRequestCurrent) {
                assertOwner(); checkGuard(assertRequestCurrent);
                const snapshot = catalogueSnapshot;
                if (!snapshot || !keyring.hasPublicSession() || snapshot.active.networkId !== networkId)
                  throw new KeyringRuntimeError('CANCELLED');
                const selected = snapshot.accounts.find(account => account.id === accountId && account.slip44 === 60);
                if (!selected) throw new KeyringRuntimeError('INVALID_INPUT');
                const account = state.accounts[selected.type]?.[selected.index];
                const network = getNativeNetwork(networkId, snapshot.networks);
                if (!account) throw new KeyringRuntimeError('INVALID_INPUT');
                const result = getSmartAccountModulesProjection(account, Number(network.chainId));
                requireSmartAccountAddressIdentity(account, Number(network.chainId));
                assertOwner(); checkGuard(assertRequestCurrent);
                if (snapshot !== catalogueSnapshot || !keyring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                return result;
              },
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
                        async getBlockHash(blockNumber) {
                          const signal = (contextReadLifetime ??=
                            new AbortController()).signal;
                          await rpc.verifyNetwork(signal, guard);
                          const block = await rpc.retirementRead(
                            'eth_getBlockByNumber',
                            [blockNumber, false],
                            signal,
                            guard
                          );
                          await rpc.verifyNetwork(signal, guard);
                          return block &&
                            typeof block === 'object' &&
                            'hash' in block
                            ? String(block.hash)
                            : null;
                        },
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
              async prepareCalls(input, assertRequestCurrent, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                requireNativeSigningHandoff(input.handoff);
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
                  check, {kind:'dapp',handoff:input.handoff}, authentication,
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
                  const batchAssetTransfers = [];
                  for (const call of calls.calls) {
                    const metadata = (decodeApprovalData(call.data).isApproval || decodeAssetTransfer(call.data, call.to))
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
                    batchAssetTransfers.push(decodeAssetTransfer(call.data, call.to!, metadata));
                  }
                  return Object.freeze({
                    operation,
                    approval: null,
                    batchApprovals: Object.freeze(batchApprovals),
                    batchAssetTransfers: Object.freeze(batchAssetTransfers),
                  });
                } catch (error) {
                  operation.dispose();
                  throw error;
                }
              },
              async prepareTransaction(input, assertRequestCurrent, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                requireNativeSigningHandoff(input.handoff);
                const { selected, network, approval, check, binding } = captureTransaction(
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
                    check, {kind:'dapp',handoff:input.handoff}, authentication
                  );
                  try {
                    const metadata = (decodeApprovalData(request.data ?? '0x').isApproval || decodeAssetTransfer(request.data ?? '0x', request.to))
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
                      assetTransfer: decodeAssetTransfer(request.data ?? '0x', request.to!, metadata),
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
                  { kind: 'estimate' }, hardwareDappSigner(selected, network, approval, check, binding, input.handoff), null, authentication
                );
              },
              encryptionSdk(input, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                const { selected, account, check, binding } = captureTransaction({ ...input, transaction: {} }, input.approval.assertCurrent);
                if (!supportsDappEncryptionAccount({ ...account, type: selected.type })) throw new KeyringRuntimeError('INVALID_INPUT');
                const ring = binding.current(), transaction = ring.ethereumTransaction;
                input.approval.bindSigner('native-encryption-sdk', () => binding.matches() && binding.current().ethereumTransaction === transaction);
                return {
                  getEncryptedPubKey() { return withSoftwareSecret('secret-read', input.approval.signal, check, () => transaction.getEncryptedPubKey(), null, null, authentication ? { authentication, assertCurrent() {
                    assertOwner(); if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                  } } : null); },
                  decryptMessage(params) { return withSoftwareSecret('secret-read', input.approval.signal, check, () => transaction.decryptMessage(params), null, null, authentication ? { authentication, assertCurrent() {
                    assertOwner(); if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                  } } : null); },
                };
              },
              signMessage(input, authentication) {
                if (authentication !== null) assertNativePrivateAuthentication(authentication);
                requireNativeSigningHandoff(input.handoff);
                assertOwner();
                const approval = input.approval;
                const snapshot = catalogueSnapshot;
                if (!keyring.hasPublicSession() || !snapshot)
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
                checkGuard(approval.assertCurrent);
                const ring = keyring,
                  captured = generation;
                const account = state.accounts[selected.type][selected.index];
                const network = getNativeNetwork(
                  snapshot.active.networkId,
                  snapshot.networks
                );
                const ownerCurrent = () =>
                  !closed &&
                  generation === captured &&
                  catalogueSnapshot === snapshot &&
                  state.activeAccount.id === selected.index &&
                  state.activeAccount.type === selected.type &&
                  state.accounts[selected.type][selected.index] === account &&
                  account?.address === selected.address &&
                  state.activeNetwork.kind === sdk.INetworkType.Ethereum &&
                  state.activeNetwork.chainId === Number(network.chainId) &&
                  state.activeNetwork.url === network.rpcUrl;
                const binding = createOwnedKeyringTransfer({initial: ring, current: () => keyring,
                  worker: () => trezorWorker, session: () => trezorSession,
                  assertOwner() {assertOwner(); if (!ownerCurrent() || approval.signal.aborted) throw new KeyringRuntimeError('CANCELLED');}});
                const isCurrent = () => ownerCurrent() && binding.matches() && keyring.hasPublicSession();
                approval.bindSigner('native-message', isCurrent);
                return run(async (ownerGeneration) => {
                  const guard = () => {
                    current(ownerGeneration);
                    assertOwner();
                    checkGuard(approval.assertCurrent);
                    if (!isCurrent())
                      throw new KeyringRuntimeError('CANCELLED');
                  };
                  guard();
                  const hardware = hardwareDappSigner(selected, network, approval, guard, binding, input.handoff);
                  if (hardware) {
                    const signature = await hardware.signMessage(request);
                    guard(); return signature;
                  }
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
                    const inventory = captureLocalSmartOwners(), { localOwners, ownerRecords } = inventory;
                    const signOwnerProof = smartOwnerProofSequence(input.handoff);
                    const boundOwners = new Set<string>();
                    const signature = await signNativeSmartAccountActionHash({
                      metadata, actionHash: prepared.actionHash, localOwners, assertCurrent: guard,
                      accountId: account.id, allowReservedSLHDSASignature: false,
                      p256WebAuthn: passkeys === null ? null : { signActionHash: request => signOwnerProof.passkey(metadata, prepared.ownerSigningIntent, inventory, request, guard, () => passkeyCeremony(authentication, approval.signal, guard, owner => passkeys.sign({ ...request, assertCurrent: guard, signal: owner }))) },
                      slhDsa: slhCapability === null ? null : slhDsaSigningPort(captured, metadata, account.id, prepared.actionHash, guard, { assertCurrent: guard, async checkDocument() { guard(); } }, approval.signal, authentication),
                      assertOwnerCurrent(owner) {
                        const original = ownerRecords.get(`${owner.type}:${owner.id}`), currentOwner = findLocalEcdsaOwner(owner.address);
                        if (!original || !currentOwner || currentOwner.id !== owner.id || currentOwner.type !== owner.type ||
                            state.accounts[owner.type][owner.id] !== original || original.address.toLowerCase() !== owner.address.toLowerCase())
                          throw new KeyringRuntimeError('CANCELLED');
                      },
                      async signOwner(address, digest, owner, ownerGuard) {
                        ownerGuard();
                        const key = `native-smart-message:${owner.type}:${owner.id}`, record = ownerRecords.get(`${owner.type}:${owner.id}`)!;
                        if (!boundOwners.has(key)) {
                          approval.bindSigner(key, () => state.accounts[owner.type][owner.id] === record && record.address.toLowerCase() === address.toLowerCase());
                          boundOwners.add(key);
                        }
                        ownerGuard();
                        if (prepared.ownerSigningIntent.actionHash !== digest) throw new KeyringRuntimeError('INVALID_INPUT');
                        const result = await signOwnerProof.owner({...owner,address}, metadata, prepared.ownerSigningIntent, inventory, ownerGuard, (accept, position) => {
                          let trezorPort: NonNullable<SmartAccountOwnerSigningSdk['trezor']> | null = null;
                          if (owner.type === 'Trezor') {
                            if (!position) throw new KeyringRuntimeError('INVALID_INPUT');
                            trezorPort = smartTrezorSigningPort({...owner,address}, metadata, prepared.ownerSigningIntent, approval.signal, ownerGuard, input.handoff, accept, position);
                          }
                          return signSmartAccountOwnerIntent({
                            intent: prepared.ownerSigningIntent,
                            selectedSmart: { id: selected.index, type: selected.type, expectedAddress: selected.address },
                            owner: { ...owner, address }, authority: { assertCurrent: ownerGuard, signal: approval.signal },
                            sdk: smartOwnerSigningPorts({ ...owner, address }, approval.signal, ownerGuard, ring, trezorPort, authentication),
                          });
                        });
                        ownerGuard(); return result;
                      },
                    });
                    guard();
                    return encodeSmartAccountMessageSignature(prepared, signature);
                  }
                  const transactions = ring.ethereumTransaction;
                  const args =
                    request.method === 'personal_sign'
                      ? [[request.address, request.message]]
                      : [request.address, request.typedData, request.version];
                  if (!matchesDappMessageRequest(request, args))
                    throw new KeyringRuntimeError('INVALID_INPUT');
                  const signature = await withSoftwareSecret('message', approval.signal, guard, () =>
                    request.method === 'personal_sign'
                      ? transactions.signPersonalMessage([
                          request.address,
                          request.message,
                        ], { assertCurrent: guard, signal: approval.signal })
                      : transactions.signTypedData(
                          request.address,
                          request.typedData as Parameters<
                            typeof transactions.signTypedData
                          >[1],
                          request.version as Parameters<
                            typeof transactions.signTypedData
                          >[2],
                          { assertCurrent: guard, signal: approval.signal }
                        ), null, null, authentication ? { authentication, assertCurrent() {
                          current(ownerGeneration); if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                        } } : null);
                  guard();
                  if (
                    typeof signature !== 'string' ||
                    !/^0x[0-9a-f]{130}$/i.test(signature)
                  )
                    throw new KeyringRuntimeError('OPERATION_FAILED');
                  return signature;
                });
              },
              signingContext: smartSigningContext,
              registration() { assertOwner(); if (!catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY'); return getNativeNetwork(catalogueSnapshot.active.networkId, catalogueSnapshot.networks); },
              async cancelSigningHandoff(job) {
                if ((pendingTrezor?.operation === 'external-psbt' || pendingTrezor?.operation === 'external-signing') && pendingTrezor.job === job) await cancelTrezor();
              },
              context() {
                assertOwner();
                if (connectionNetworkId === null || connectionNetwork === null)
                  throw new KeyringRuntimeError('NOT_READY');
                const selectedNetwork = connectionNetwork;
                const snapshot = catalogueSnapshot;
                const unlocked = keyring.hasPublicSession() && snapshot !== null;
                const accounts = unlocked
                  ? snapshot.accounts.flatMap((account) => {
                      if ((account.type === 'Ledger' || account.type === 'Trezor') &&
                          (account.slip44 !== 60 || selectedNetwork.kind !== sdk.INetworkType.Ethereum)) return [];
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
              if (reserved !== reservation || keyring !== ring || !ring.hasPublicSession() ||
                  catalogueSnapshot !== snapshot || selectedAccount() !== selected)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const task = Promise.resolve().then(async () => {
              guard();
              await Promise.allSettled(prior);
              guard();
              const fingerprint = await dataBinding(captured, guard); guard();
              const profileId = await transactionRecordKeyring(ring, guard).getPrivateRecordProfileId(); guard();
              const session = signedRecords.captureSession({ keyring: transactionRecordKeyring(ring, guard), assertCurrent: guard });
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
          ...(storage.notes && storage.recovery ? { openNoteBackup, openNoteCapacity, openNoteMaintenance,
            ...(dependencies.privacyServiceSettings && openPrivacyPool ? { openPrivacyControls } : {}), readNoteInventory,
            ...(dependencies.openPrivacyPool ? { openNoteImport, openPrivateDeposit } : {}) } : {}),
          ...(storage.sentryNodes && dependencies.utxoFetch ? { getSentryKeyNetwork, openSentryNodeManagement } : {}),
          ...(storage.sentryNodes && storage.sentryKeys && dependencies.utxoFetch && typeof dependencies.runSentryCrypto === 'function'
            ? { getSentryKeyNetwork, openSentryApprovals } : {}),
          ...(storage.sentryKeys && typeof dependencies.deriveSentryPublicKey === 'function'
            ? { getSentryKeyNetwork, openSentryKeyManagement } : {}),
          ...(storage.removal && storage.recovery ? { authorizeWalletRemoval } : {}),
          accounts,
          previewPhrase: (phrase, assertCurrent) => run(async (captured) => {
            const check = () => { current(captured); checkGuard(assertCurrent); };
            check();
            const rows = await previewNativePhraseAddresses(keyring, phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' '),
              UTXO_NETWORKS.find(network => supportsUtxoSoftwareCustody(network)), check);
            check();
            return rows;
          }),
          security: {
            isAuthenticating: () => [...secretOperations].some(([owner, captured]) => captured === generation && !owner.signal.aborted && dependencies.isAuthenticationActive(owner.signal)),
            isAuthenticationRefusal: error => !!error && typeof error === 'object' && (secretAuthenticationRefusals.has(error) || operationAuthenticationRefusals.has(error)),
            authenticationStatus: async () => {
              const captured = generation; current(captured);
              const reference = await storage.credential.read(); current(captured);
              const capability = await dependencies.credentialPort?.capabilities(reference) ?? { deviceAuth: 'unsupported' as const, credentialPresent: false };
              current(captured); return Object.freeze({ ...capability, deviceAuth: credentialUnsupported ? 'unsupported' as const : capability.deviceAuth, credentialPresent: !credentialMissing && capability.credentialPresent });
            },
            reauthenticateIdlePolicy: (signal, authentication, assertCurrent) => run(async captured => {
              const ring = keyring, snapshot = catalogueSnapshot, identity = verifiedIdentity;
              const ownerCurrent = () => { current(captured); if (signal.aborted || ring !== keyring || snapshot !== catalogueSnapshot || identity !== verifiedIdentity) throw new KeyringRuntimeError('CANCELLED'); };
              const check = () => { ownerCurrent(); checkGuard(assertCurrent); };
              check(); if (!ring.hasPublicSession() || !snapshot || !identity) throw new KeyringRuntimeError('NOT_READY');
              await withNativePrivateAuthentication(authentication, signal, ownerCurrent, owner => requestCredential('account-change', owner, check));
              check(); if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
            }),
          },
          imports,
          networks,
          tokens: {
            load: async (guard) => {
              // Connection replay may retire a read while its storage call is draining.
              // Wait for that reservation, then validate the new caller before reading.
              while (active) { await active.catch(() => undefined); checkGuard(guard); }
              return tokenOperation(guard, (scope, check) => tokens.load(scope, check));
            },
            loadScoped: async (target, guard) => {
              const captured = Object.freeze({ accountId: target.accountId, address: target.address,
                networkId: target.networkId, registrationHash: target.registrationHash });
              while (active) { await active.catch(() => undefined); checkGuard(guard); }
              return tokenOperation(guard, (scope, check) => tokens.load(scope, check), undefined, captured);
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
          catalogue: {
            getSnapshot: () => closed || requiresReopen() || !keyring.hasPublicSession() ? null : catalogueSnapshot,
            getControlSnapshot: () => closed || requiresReopen() || !keyring.hasPublicSession() ? null : catalogue.getControlSnapshot(),
            getMonitoringSnapshot: () => closed || requiresReopen() || !keyring.hasPublicSession() ? null : catalogue.getMonitoringSnapshot(),
            previewNetworkSelection(id, expectedRevision) {
              current(generation);
              if (closed || requiresReopen() || !keyring.hasPublicSession()) throw new KeyringRuntimeError('NOT_READY');
              return catalogue.previewNetworkSelection(id, expectedRevision);
            },
          },
          keyExport: {
            isAuthenticationRefusal: error => !!error && typeof error === 'object' && secretAuthenticationRefusals.has(error),
            readSelected: (input, signal, assertCurrent, authentication) => {
              if (closed || requiresReopen()) return run(async () => { throw new KeyringRuntimeError('NOT_READY'); });
              if (!catalogueSnapshot) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let scope;
              try {
                scope = snapshotHdKeyExportScope(input, catalogueSnapshot.utxoNetworks);
                if (typeof assertCurrent !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
                assertNativePrivateAuthentication(authentication);
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
                const ring = keyring;
                let readEntered = false;
                const utxo = catalogueSnapshot && findUtxoNetwork(scope.networkId, catalogueSnapshot.utxoNetworks);
                const sdkNetwork = utxo && getUtxoSdkNetwork(utxo);
                const type = parseNativeAccountId(scope.accountId).type;
                const xpub = state.accounts[type][scope.index]?.xpub;
                const extended = type === 'HDAccount' || (xpub !== undefined && xpub !== scope.address);
                const script = utxo && !extended && findWifAddressType(scope.address, utxo);
                const checkOwnership = () => {
                  current(captured);
                  if (signal.aborted) {
                    const error = new KeyringRuntimeError('CANCELLED');
                    if (!readEntered && ring === keyring && !requiresReopen()) secretAuthenticationRefusals.add(error);
                    throw error;
                  }
                  assertNativePrivateAuthentication(authentication);
                  current(captured);
                  const catalogue = catalogueSnapshot;
                  const selected = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId);
                  if (ring !== keyring || !ring.hasPublicSession() || !catalogue || !selected) throw new KeyringRuntimeError('NOT_READY');
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
                const check = () => { checkOwnership(); checkGuard(assertCurrent); checkOwnership(); };
                check();
                if (type !== 'HDAccount' && type !== 'Imported') throw new KeyringRuntimeError('INVALID_INPUT');
                if (utxo && type === 'Imported') {
                  if (!extended && !script) throw new KeyringRuntimeError('CANCELLED');
                  checkedUtxoImport(state.accounts.Imported[scope.index]!, utxo, extended ? 'account' : 'address');
                }
                const stored = await storage.readState(); check();
                if (stored.presence !== 'existing' || stored.backup !== 'confirmed') throw new KeyringRuntimeError('NOT_READY');
                // The SDK selector is fixed here; no account type or alternate index comes from a screen.
                const privateKey = await withSoftwareSecret('secret-read', signal, check, secret => { readEntered = true; return ring.getPrivateKeyByAccountId(scope.index, type === 'HDAccount' ? sdk.KeyringAccountType.HDAccount : sdk.KeyringAccountType.Imported, secret); }, null, null,
                  { authentication, assertCurrent: checkOwnership });
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
            createWallet: () => run(async (captured) => {
              current(captured);
              const phrase = keyring.createNewSeed(12);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              await createStoredWallet(phrase, captured);
            }),
            importWallet: (phrase) => run(async (captured) => {
              if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096) throw new KeyringRuntimeError('INVALID_INPUT');
              const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
              if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) throw new KeyringRuntimeError('INVALID_INPUT');
              current(captured);
              await createStoredWallet(normalized, captured);
            }),
            unlock: () => run(async captured => {
              if (!keyring.hasPublicSession()) await restorePublicView(captured, () => current(captured));
              return { authenticated: true };
            }),
            async readSelectedAddress() {
              if (closed || requiresReopen() || !keyring.hasPublicSession()) throw new Error('NOT_READY');
              const selected = selectedAccount();
              return normalizePublicAddress(selected.address, catalogueSnapshot!.active.networkId, catalogueSnapshot!.utxoNetworks);
            },
            lock,
          },
          async readConnectionUtxoPublic(method, owner, isChangeAddress, signal, assertOwner) {
            const captured = generation, ring = keyring, snapshot = catalogueSnapshot;
            const network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            if (!network || !dependencies.utxoFetch || typeof isChangeAddress !== 'boolean')
              throw new KeyringRuntimeError('NOT_READY');
            const selected = selectedAccount(), account = state.accounts[selected.type][selected.index];
            if (selected.id !== owner.accountId || selected.type === 'SmartAccount' || !account || account.xpub !== owner.xpub)
              throw new KeyringRuntimeError('INVALID_INPUT');
            const sdkNetwork = getUtxoSdkNetwork(network);
            const check = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              const actual = state.activeNetwork;
              if (signal.aborted || ring !== keyring || !ring.hasPublicSession() || catalogueSnapshot !== snapshot ||
                  selectedAccount() !== selected || state.accounts[selected.type][selected.index] !== account ||
                  account.xpub !== owner.xpub || state.activeAccount.id !== selected.index ||
                  state.activeAccount.type !== selected.type || actual.kind !== sdkNetwork.kind ||
                  actual.chainId !== sdkNetwork.chainId || actual.url !== sdkNetwork.url)
                throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            await dataBinding(captured, check);
            if (isCustomUtxoNetworkId(network.id))
              await verifySavedUtxoEndpoint(network, { fetch: dependencies.utxoFetch, timeoutMs: 10_000 }, signal, check);
            check();
            const read = createOwnedUtxoBlockbookRead({ kind: 'wallet', url: sdkNetwork.url,
              address: selected.address, xpub: owner.xpub, reuseAddressDiscovery: true },
              signal, check, dependencies.utxoFetch);
            const result = method === 'getChangeAddress' ? await ring.getChangeAddress(selected.index, read) :
              method === 'getCurrentAddressPubkey' ? await ring.getCurrentAddressPubkey(owner.xpub, isChangeAddress, read) :
              method === 'getBip32Path' ? await ring.getBip32Path(selected.index, isChangeAddress, read) :
              (() => { throw new KeyringRuntimeError('INVALID_INPUT'); })();
            check();
            await dataBinding(captured, check);
            return result;
          },
          async withUtxoActivityRead(expected, signal, assertOwner, assertView, read, refresh) {
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
            if (refresh === 'page') reconcilePublicUtxo(network, { id: selected.index, type: selected.type, xpub: identifier }, assertScope);
            return result;
          },
          ...(dependencies.readUtxoAccount ? { async readUtxoBalance(id: UtxoNetworkId, address: string, external: AbortSignal) {
            const captured = generation, snapshot = catalogueSnapshot;
            const network = snapshot && findUtxoNetwork(id, snapshot.utxoNetworks);
            if (!network) throw new KeyringRuntimeError('NOT_READY');
            const controller = new AbortController();
            const abort = () => controller.abort();
            const assertScope = () => {
              current(captured);
              if (catalogueSnapshot !== snapshot || snapshot.active.networkId !== id || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const guard = () => { assertScope(); if (controller.signal.aborted || external.aborted) throw new KeyringRuntimeError('CANCELLED'); };
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
              reconcilePublicUtxo(network, { id: index, type, xpub }, assertScope);
              return result;
            } finally {
              external.removeEventListener('abort', abort);
              if (pendingBalance === controller) pendingBalance = null;
              controller.abort();
            }
          } } : {}),
          async openConnectionSentryApprovals() {
            const captured = generation; current(captured);
            if (sentryApprovals) {
              try { sentryApprovals.assertCurrent(); return sentryApprovals; } catch { retireSentryKeys(); }
            }
            const lifetime = (contextReadLifetime ??= new AbortController()).signal;
            return openSentryApprovals(lifetime, () => current(captured), null);
          },
          async prepareConnectionPsbt(request, signal, assertOwner, handoff, authentication) {
            if (authentication !== null) assertNativePrivateAuthentication(authentication);
            const captured = generation, snapshot = catalogueSnapshot, admittedTrezorEpoch = trezorEpoch;
            let ring = keyring;
            let trezorAttempt: Awaited<ReturnType<typeof openTrezorAttempt>> | undefined;
            const selected = selectedAccount(), network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            if (!dependencies.utxoFetch || !utxoRecords || !network ||
                (selected.type !== 'HDAccount' && selected.type !== 'Imported' && selected.type !== 'Ledger' && selected.type !== 'Trezor') ||
                (selected.type !== 'Ledger' && selected.type !== 'Trezor' && !supportsUtxoSoftwareCustody(network)))
              throw new KeyringRuntimeError('NOT_READY');
            if (selected.type === 'Trezor') {
              const check = () => {
                current(captured); checkGuard(assertOwner);
                if (signal.aborted || admittedTrezorEpoch !== trezorEpoch || catalogueSnapshot !== snapshot || active || reserved || selectedAccount().id !== selected.id)
                  throw new KeyringRuntimeError('CANCELLED');
              };
              const resume: NativeTrezorResumeIntent = Object.freeze({ kind: 'external-psbt', id: handoff.id, accountId: selected.id, networkId: network.id });
              trezorAttempt = await openTrezorAttempt(captured, check, 'external-psbt', selected.label, resume, () => undefined, handoff.beforeSuiteOpen);
              ring = trezorAttempt.ring;
            }
            const ownedTrezor = trezorAttempt?.session;
            const stillOwned = () => !!ownedTrezor && (trezorSession === ownedTrezor || pendingTrezor?.job === ownedTrezor.job);
            try {
            const sdkNetwork = getUtxoSdkNetwork(network), account = state.accounts[selected.type][selected.index]!;
            const { xpub } = account;
            if (selected.type === 'Imported') checkedUtxoImport(account, network);
            let assertSigningCurrent = () => undefined as void;
            let admittedSigning: Promise<unknown> | null = null;
            const assertContext = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              const actual = state.activeNetwork, live = state.accounts[selected.type][selected.index];
              if (signal.aborted || selected.type === 'Trezor' && admittedTrezorEpoch !== trezorEpoch || ring !== keyring || !ring.hasPublicSession() || catalogueSnapshot !== snapshot ||
                  live !== account || live.xpub !== xpub || live.address !== selected.address ||
                  state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type ||
                  actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId ||
                  actual.slip44 !== sdkNetwork.slip44 || actual.currency !== sdkNetwork.currency ||
                  actual.utxoBackendChain !== sdkNetwork.utxoBackendChain || actual.url !== sdkNetwork.url)
                throw new KeyringRuntimeError('CANCELLED');
              if ((active && active !== admittedSigning) || reserved) throw new KeyringRuntimeError('BUSY');
            };
            const guard = () => { assertContext(); checkGuard(assertSigningCurrent); };
            guard(); await dataBinding(captured, guard); guard();
            const profileId = await transactionRecordKeyring(ring, guard).getPrivateRecordProfileId(); guard();
            const collateral = getSentryKeyNetwork()
              ? createNativeSentryCollateral(await bindSentryNodes(captured, guard)) : null;
            guard();
            const { prepareNativeDappPsbt } = await import('./dappPsbt.ts'); guard();
            const approval = await prepareNativeDappPsbt(request, signal, {
              network, scope: { profileId,
                account: { address: selected.address, id: selected.index, type: selected.type, xpub },
                network: { kind: 'syscoin', currency: sdkNetwork.currency, chainId: sdkNetwork.chainId,
                  genesisHash: network.genesisHash, slip44: sdkNetwork.slip44, url: sdkNetwork.url } },
              session: { keyring: transactionRecordKeyring(ring, guard), assertCurrent: guard }, sdk: {
                decodeRawTransaction: (...args) => ring.syscoinTransaction.decodeRawTransaction(...args),
                sendTransaction: (...args) => ring.syscoinTransaction.sendTransaction(...args),
                signPSBT: (input, read) => selected.type === 'Ledger'
                  ? withOwnedLedgerConnection({ signal, assertCurrent: assertContext,
                      connected: () => ledger.isConnected(), current: () => ledgerTransport, retire: retireLedger,
                    }, check => { assertSigningCurrent = check; return ring.syscoinTransaction.signPSBT(input, read); })
                  : (async () => {
                      const signed = selected.type === 'Trezor'
                        ? await ring.syscoinTransaction.signPSBT(input, read)
                        : await (async () => {
                          const prepared = await ring.syscoinTransaction.preparePSBTForSigning(input, read); guard();
                          return run(async () => {
                          admittedSigning = active;
                          try { return await withSoftwareSecret('transaction', signal, guard, () => ring.syscoinTransaction.signPSBT({ psbt: prepared }, read), null, null, authentication ? { authentication, assertCurrent() {
                            current(captured); if (keyring !== ring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
                          } } : null); }
                          finally { admittedSigning = null; }
                          });
                        })();
                      guard();
                      if (trezorAttempt) {
                        // Revoke resume before the common engine can release or submit signed bytes.
                        handoff.beforeSignature(); guard();
                        await finishTrezor(trezorAttempt.session, guard); guard();
                      }
                      return signed;
                    })(),
              },
              records: utxoRecords, fetch: dependencies.utxoFetch, collateral, sentry: sentryApprovals?.operations ?? null,
            });
            const retire = () => {
              if (!stillOwned()) return;
              const closing = handoff.isSuspended() ? retireTrezor() : cancelTrezor();
              void closing?.catch(() => undefined);
            };
            signal.addEventListener('abort', retire, { once: true });
            const dispose = () => { approval.dispose(); retire(); signal.removeEventListener('abort', retire); };
            try { guard(); approval.assertCurrent(); } catch (cause) { dispose(); throw cause; }
            return Object.freeze({ ...approval, dispose, async approve() {
              const pending = approval.approve(); pendingSubmissions.add(pending);
              try { return await pending; }
              catch (cause) {
                if (stillOwned() && !handoff.isSuspended()) await cancelTrezor();
                throw cause;
              } finally {
                pendingSubmissions.delete(pending);
                if (utxoRecords.requiresReopen) void lock().catch(() => undefined);
              }
            } });
            } catch (cause) {
              if (stillOwned() && !handoff.isSuspended()) await cancelTrezor();
              throw cause;
            }
          },
          ...(dependencies.utxoFetch && utxoRecords ? { async openUtxoSend(assertOwner: () => void) {
            const captured = generation, snapshot = catalogueSnapshot;
            const admittedTrezorEpoch = trezorEpoch;
            let ring = keyring;
            const selected = selectedAccount(), network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            if (!network || selected.type === 'SmartAccount' || !supportsUtxoSoftwareCustody(network)) throw new KeyringRuntimeError('NOT_READY');
            let trezorAttempt: Awaited<ReturnType<typeof openTrezorAttempt>> | undefined;
            if (selected.type === 'Trezor') {
              const check = () => {
                current(captured); checkGuard(assertOwner);
                if (admittedTrezorEpoch !== trezorEpoch || catalogueSnapshot !== snapshot || active || reserved || selectedAccount().id !== selected.id)
                  throw new KeyringRuntimeError('CANCELLED');
              };
              trezorAttempt = await openTrezorAttempt(captured, check, 'utxo-send', selected.label, undefined, () => undefined);
              ring = trezorAttempt.ring;
            }
            const sdkNetwork = getUtxoSdkNetwork(network), account = state.accounts[selected.type][selected.index]!;
            const { xpub } = account;
            let authenticating = false;
            if (selected.type === 'Imported') checkedUtxoImport(account, network);
            const guard = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              if (selected.type === 'Trezor' && admittedTrezorEpoch !== trezorEpoch) throw new KeyringRuntimeError('CANCELLED');
              const actual = state.activeNetwork, live = state.accounts[selected.type][selected.index];
              if (ring !== keyring || !ring.hasPublicSession() || catalogueSnapshot !== snapshot ||
                  live !== account || live.xpub !== xpub || live.address !== selected.address ||
                  state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type ||
                  actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId ||
                  actual.slip44 !== sdkNetwork.slip44 || actual.currency !== sdkNetwork.currency ||
                  actual.utxoBackendChain !== sdkNetwork.utxoBackendChain || actual.url !== sdkNetwork.url)
                throw new KeyringRuntimeError('CANCELLED');
              if ((active || reserved) && !authenticating) throw new KeyringRuntimeError('BUSY');
            };
            guard(); await dataBinding(captured, guard); guard();
            const profileId = await transactionRecordKeyring(ring, guard).getPrivateRecordProfileId(); guard();
            utxoSend?.cancel();
            const { createNativeUtxoSend } = await import('./utxoSend.ts'); guard();
            if (selected.type !== 'HDAccount' && selected.type !== 'Imported' && selected.type !== 'Ledger' && selected.type !== 'Trezor') throw new KeyringRuntimeError('NOT_READY');
            const accountType = selected.type;
            const collateral = getSentryKeyNetwork()
              ? createNativeSentryCollateral(await bindSentryNodes(captured,guard)) : null;
            guard();
            const snapshotUtxoSigningInput = (input: Parameters<IndexedKeyring['syscoinTransaction']['signPSBT']>[0]) => {
              const outer = readOwnData(input, ['psbt']), value = readOwnData(outer.psbt, ['psbt', 'assets']);
              if (typeof value.psbt !== 'string' || typeof value.assets !== 'string') throw new KeyringRuntimeError('INVALID_INPUT');
              return Object.freeze({ psbt: Object.freeze({ psbt: value.psbt, assets: value.assets }) });
            };
            const utxoSigningTarget = (input: Parameters<IndexedKeyring['syscoinTransaction']['signPSBT']>[0] | null): string => {
              if (input === null) return 'utxo:retained-replay';
              const value = snapshotUtxoSigningInput(input).psbt;
              return `utxo:${JSON.stringify([value.psbt, value.assets])}`;
            };
            const authenticateUtxoOperation = async (credential: NativeOperationCredential, input: Parameters<IndexedKeyring['syscoinTransaction']['signPSBT']>[0] | null, check: () => void) => {
              guard();
              authenticating = true;
              let receipt: NativeOperationAuthorization;
              try { receipt = await authorizeOperation(credential, check, utxoSigningTarget(input)); }
              finally { authenticating = false; }
              guard();
              return receipt;
            };
            const createOpened = () => createNativeUtxoSend(network, {
              profileId,
              account: { address: selected.address, id: selected.index, type: accountType, xpub },
              network: { kind: 'syscoin', currency: sdkNetwork.currency, chainId: sdkNetwork.chainId,
                genesisHash: network.genesisHash, slip44: sdkNetwork.slip44, url: sdkNetwork.url },
            }, { keyring: transactionRecordKeyring(ring, guard), assertCurrent: guard }, ring.syscoinTransaction, utxoRecords, dependencies.utxoFetch!, ring.getAddress, collateral, {
              authorize: authenticateUtxoOperation,
              release: releaseOperationAuthorization,
              async sign(receipt, input, read, check) {
                guard(); check();
                const capturedInput = snapshotUtxoSigningInput(input), target = utxoSigningTarget(capturedInput);
                if (accountType === 'Ledger' || accountType === 'Trezor') {
                  consumeOperationAuthorization(receipt, check, target);
                  return ring.syscoinTransaction.signPSBT(capturedInput, read);
                }
                const prepared = await ring.syscoinTransaction.preparePSBTForSigning(capturedInput, read);
                guard(); check();
                return withSoftwareSecret('transaction', new AbortController().signal, check,
                  () => ring.syscoinTransaction.signPSBT({ psbt: prepared }, read), null, { receipt, target });
              },
            });
            let opened = createOpened();
            utxoSend = opened;
            return Object.freeze<NativeUtxoSend>({ ...opened,
              cancel: () => opened.cancel(),
              list: () => opened.list(),
              refreshSaved: () => opened.refreshSaved(),
              check: txid => opened.check(txid),
              async prepareRetry(txid) {
                if (trezorAttempt && trezorSession === trezorAttempt.session) await cancelTrezor(false);
                trezorAttempt = undefined;
                return opened.prepareRetry(txid);
              },
              async prepare(input) {
                if (selected.type === 'Trezor' && (!pendingTrezor || trezorSession !== trezorAttempt?.session)) {
                  guard();
                  const check = () => {
                    current(captured); checkGuard(assertOwner);
                    if (admittedTrezorEpoch !== trezorEpoch || catalogueSnapshot !== snapshot || active || reserved || selectedAccount().id !== selected.id)
                      throw new KeyringRuntimeError('CANCELLED');
                  };
                  trezorAttempt = await openTrezorAttempt(captured, check, 'utxo-send', selected.label, undefined, () => undefined);
                  ring = trezorAttempt.ring;
                  opened = createOpened(); utxoSend = opened;
                }
                const view = await opened.prepare(input);
                if (trezorAttempt) {
                  guard();
                  if (!pendingTrezor || pendingTrezor.job !== trezorAttempt.session.job) throw new KeyringRuntimeError('CANCELLED');
                  const resume: NativeTrezorResumeIntent = Object.freeze({
                    id: pendingTrezor.resume?.id ?? `trezor-${++trezorSequence}`,
                    kind: 'utxo', accountId: selected.id, networkId: network.id,
                    recipient: input.recipient.trim(), amount: input.amount,
                    rbf: view.transactionOptions.rbf,
                    ...(input.max === true ? { max: true } : {}),
                    ...(input.asset ? { asset: Object.freeze({ ...input.asset }) } : {}),
                  });
                  const transport = dependencies.trezorSessions?.getSnapshot();
                  if (pendingTrezor.resume && JSON.stringify(pendingTrezor.resume) !== JSON.stringify(resume) &&
                      !(transport?.phase === 'active' && transport.completedSteps === 0)) {
                    await cancelTrezor(); throw new TrezorReviewChangedError();
                  }
                  pendingTrezor.resume = resume;
                }
                return view;
              },
              async confirm(view, credential) {
              const pending = opened.confirm(view, credential);
              pendingSubmissions.add(pending);
              try {
                const result = await pending;
                if (trezorAttempt) await finishTrezor(trezorAttempt.session, guard);
                return result;
              } catch (error) {
                if (trezorAttempt && !(error instanceof Error && operationAuthenticationRefusals.has(error)))
                  await failTrezor(captured, admittedTrezorEpoch, error);
                throw error;
              }
              finally {
                pendingSubmissions.delete(pending);
                if (utxoRecords.requiresReopen) void lock().catch(() => undefined);
              }
            } });
          } } : {}),
          activity: {
            load: assertCurrent => loadActivity(assertCurrent),
            forScope(input, assertOwner) {
              const target = Object.freeze({ accountId: input.accountId, address: input.address,
                networkId: input.networkId, registrationHash: input.registrationHash });
              const checked = (check: () => void) => () => { checkGuard(assertOwner); checkGuard(check); };
              return Object.freeze<NativeActivityRuntime>({
                load: (check: () => void) => {
                  const result = scopedActivityLoad.catch(() => undefined).then(() => loadActivity(checked(check), target));
                  scopedActivityLoad = result;
                  return result;
                },
                async loadSavedPending(previousScope, beforeHash, assertCurrent) {
                  const { scope, guard, index, type } = await activityContext(checked(assertCurrent), target);
                  if (previousScope.key !== scope.key || previousScope.sourceId !== scope.sourceId) throw new KeyringRuntimeError('CANCELLED');
                  const journal = createNativeSignedRecordView(signedRecords, { keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard }, scope.walletFingerprint,
                    { index, type, address: scope.address }, scope.network);
                  const page = await journal.pendingActivities(beforeHash); guard();
                  if (type !== 'SmartAccount') return { ...page, records: page.records.map(local => inspectionOnly(local, true)) };
                  const saved = await activityHistory.load(scope, guard); guard();
                  return { ...page, records: page.records.filter(local => !saved.archived.some(record => record.hash === local.hash && record.phase !== 'submitted')).map(local => inspectionOnly(local, true)) };
                },
                async observeLocal(local, assertCurrent, signal) {
                  const { scope, guard } = await activityContext(checked(assertCurrent), target);
                  if (signal.aborted || local.chainId !== scope.network.chainId || local.address !== scope.address ||
                      local.walletFingerprint !== scope.walletFingerprint || local.accountId !== scope.accountId)
                    throw new KeyringRuntimeError('CANCELLED');
                  const rpc = new EvmTransferReadRpc(scope.network, { fetch: dependencies.connectionFetch ?? walletFetch });
                  if (local.smartAccount) return observeSmartAccountActivity({ chainId: local.chainId, hash: local.hash,
                    account: local.address, nonce: local.nonce, ...local.smartAccount },
                    (method, params) => rpc.retirementRead(method, params, signal, guard), guard);
                  return rpc.observation({ hash: local.hash, from: local.address,
                    to: local.token?.contractAddress ?? local.collectibleTransfer?.contractAddress ?? local.recipient,
                    nonce: String(local.nonce) }, signal, guard);
                },
                async saveCache(_scope, _candidates, check) { checked(check)(); },
                async saveView(_scope, _view, check) { checked(check)(); },
              });
            },
            async loadSavedPending(previousScope, beforeHash, assertCurrent) {
              const { scope, guard, index, type } = await checkActivityContext(previousScope, assertCurrent);
              const journal = createNativeSignedRecordView(signedRecords, { keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard }, scope.walletFingerprint,
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
                const transfer = await signedRecords.readSmartAccountActivityExact({ keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard }, chainId, address, hash);
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
                const result = await observeRetainedEvmTransaction(signedRecords, { keyring: transactionRecordKeyring(keyring, guard), assertCurrent: guard },
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
            isAuthenticationRefusal: error => !!error && typeof error === 'object' && operationAuthenticationRefusals.has(error),
            authorizeOperation: (credential, transaction, guard) => authorizeOperation(credential, guard, `evm:${unsignedTransferBytes(transaction)}`),
            releaseOperationAuthorization,
            authenticateOperation,
            async replacementOriginal(hash, mode, assertCurrent, signal) {
              if (active || reserved || closed || !canSign()) return null;
              const captured = generation, selected = selectedAccount();
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
              const check = () => { current(captured); checkGuard(assertCurrent); };
              const session = { keyring: transactionRecordKeyring(keyring, check), assertCurrent: check };
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
                action?: PrivateRecordAction;
                session?: IPrivateVaultSession;
                hash: string;
                attempt?: string;
                confirming?: boolean;
              };
              let privateOwner: PrivateReplayOwner | undefined;
              let reviewedId: string | undefined;
              const closePrivatePool = async (owner: PrivateReplayOwner | undefined) => {
                // Shared replay revokes dispatch immediately. An admitted
                // response still owns its original wallet's receipt codec.
                if (owner?.confirming) return;
                try {
                  owner?.lifetime.abort();
                  if (owner?.action) { owner.action.closed = true; owner.action.access?.dispose(); }
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
                if (!owner || owner.attempt !== JSON.stringify(input)) throw new KeyringRuntimeError('CANCELLED');
                const checkPool = () => {
                  check();
                  if (privateOwner !== owner || owner.lifetime.signal.aborted)
                    throw new KeyringRuntimeError('CANCELLED');
                };
                if (!noteBackups) await openNotes(checkPool, () => undefined, null);
                checkPool();
                const openPool = openPrivacyPool;
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
                  const session = owner.session;
                  if (!session || !owner.action?.access) throw new KeyringRuntimeError('NOT_READY');
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
                  recordSession: { keyring: transactionRecordKeyring(keyring, check), assertCurrent: check },
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
                async prepare(hash, mode) {
                  if (mode !== 'inspect' && mode !== 'resend') throw new KeyringRuntimeError('INVALID_INPUT');
                  replay.cancel();
                  reviewedId = undefined;
                  const previous = privateOwner;
                  const owner: PrivateReplayOwner = { lifetime: new AbortController(), hash };
                  privateOwner = owner;
                  await closePrivatePool(previous);
                  if (privateOwner !== owner) throw new KeyringRuntimeError('CANCELLED');
                  try {
                    if (mode === 'inspect') {
                      const observed = await observeRetainedEvmTransaction(signedRecords,
                        { keyring: transactionRecordKeyring(keyring, check), assertCurrent: check },
                        network.chainId, selected.address, hash, transport.observe, check);
                      check();
                      return Object.freeze({ status: observed.terminalPhase ?? 'unknown', hash,
                        transaction: projectSavedEvmTransaction(observed.entry) });
                    }
                    const entry = await signedRecords.readExact({ keyring: transactionRecordKeyring(keyring, check), assertCurrent: check },
                      network.chainId, selected.address, hash);
                    check();
                    if (entry?.metadata && (Object.hasOwn(entry.metadata, 'privateDeposit') || Object.hasOwn(entry.metadata, 'privateWithdrawal'))) {
                      const deposit = readPrivateDepositAttempt(entry), withdrawal = readPrivateWithdrawalAttempt(entry);
                      if (!!deposit === !!withdrawal) throw new KeyringRuntimeError('INVALID_INPUT');
                      owner.attempt = JSON.stringify(deposit ? { kind: 'deposit', attempt: deposit } : { kind: 'withdrawal', attempt: withdrawal });
                      const ring = keyring, identity = verifiedIdentity;
                      const walletGuard = ring.capturePublicSessionGuard();
                      const walletCurrent = () => {
                        current(generation); checkGuard(walletGuard);
                        if (owner.lifetime.signal.aborted || !identity || verifiedIdentity !== identity || keyring !== ring)
                          throw new KeyringRuntimeError('CANCELLED');
                      };
                      const guard = () => { check(); walletCurrent(); if (privateOwner !== owner || owner.hash !== entry.hash) throw new KeyringRuntimeError('CANCELLED'); };
                      const access = await run(async admitted => {
                        const checkAdmitted = () => { current(admitted); guard(); };
                        return withSoftwareSecret('private-reconciliation', owner.lifetime.signal, checkAdmitted,
                          () => ring.createPrivateRecordAccess(privateNoteRecordDomains, { transferable: false }), null, null);
                      });
                      try {
                        guard();
                        owner.action = { policy: 'acknowledgement', generation: captured, ring, verified: true, closed: false,
                          signal: owner.lifetime, tail: Promise.resolve(), access };
                        owner.session = createPrivateVaultSession({ generation: captured,
                          keyring: privateRecordKeyring(ring, walletCurrent, owner.action), assertCurrent: walletCurrent });
                      } catch (error) { access.dispose(); throw error; }
                    }
                    owner.confirming = true;
                    const prepared = await replay.prepare(hash);
                    if (prepared.status === 'review') { owner.confirming = false; reviewedId = prepared.review.id; }
                    else {
                      const settled = replay.waitForReconciliation().finally(async () => {
                        owner.confirming = false;
                        if (privateOwner === owner) privateOwner = undefined;
                        try { await closePrivatePool(owner); }
                        finally { pendingSubmissions.delete(settled); }
                      });
                      pendingSubmissions.add(settled); void settled.catch(() => undefined);
                    }
                    return prepared;
                  } catch (error) {
                    owner.confirming = false;
                    if (privateOwner === owner) privateOwner = undefined;
                    await closePrivatePool(owner);
                    throw error;
                  }
                },
                cancel(id) {
                  const cancelled = replay.cancel(id);
                  if (cancelled || (id === undefined && privateOwner)) {
                    reviewedId = undefined;
                    const owner = privateOwner;
                    privateOwner = undefined;
                    void closePrivatePool(owner).catch(() => undefined);
                    return true;
                  }
                  return false;
                },
                list: replay.list.bind(replay),
                confirm(id) {
                  if (id !== reviewedId) return replay.confirm(id);
                  reviewedId = undefined;
                  const owner = privateOwner;
                  if (owner) owner.confirming = true;
                  const work = replay.confirm(id);
                  const pending = work.finally(async () => {
                    if (owner) owner.confirming = false;
                    try { await closePrivatePool(owner); }
                    finally { pendingSubmissions.delete(pending); }
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
                      catalogueSnapshot !== catalogue || !keyring.hasPublicSession())
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
              if (closed || reserved || !keyring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
              if (!canSign()) throw new KeyringRuntimeError('NOT_READY');
              const captured = generation;
              current(captured); checkGuard(assertCurrent);
              if (!keyring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED');
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
                if (!keyring.hasPublicSession() || !canSign())
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
                    const retained = await signedRecords.readExact({ keyring: transactionRecordKeyring(keyring, check), assertCurrent: check }, tx.chainId.toString(), context.account.address, replacement.original.hash);
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
                  if (context.account.type === 'Ledger' || context.account.type === 'Trezor') {
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
              if (!keyring.hasPublicSession() || !canSign()) throw new KeyringRuntimeError('NOT_READY');
            },
            sign: (transaction, authority, inputIntent, replacement) => {
              const admittedTrezorEpoch = trezorEpoch;
              const assertCurrent = () => {
                if (authority.signal.aborted)
                  throw new KeyringRuntimeError('CANCELLED');
                checkGuard(authority.assertCurrent);
              };
              if (closed || !keyring.hasPublicSession())
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
                if (!keyring.hasPublicSession())
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
                  consumeOperationAuthorization(authority.authorization, assertCurrent, `evm:${unsignedTransferBytes(prepared)}`);
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
                if (selected.type === 'Trezor') {
                  consumeOperationAuthorization(authority.authorization, assertCurrent, `evm:${unsignedTransferBytes(prepared)}`);
                  const check = () => { current(captured); assertCurrent(); if (admittedTrezorEpoch !== trezorEpoch) throw new KeyringRuntimeError('CANCELLED'); };
                  const unsignedTransaction = serializePreparedEvmTransaction(prepared);
                  const resume: NativeTrezorResumeIntent = Object.freeze({
                    id: pendingTrezor?.resume?.id ?? `trezor-${++trezorSequence}`,
                    kind: 'evm', accountId: selected.id, networkId: network.id, unsignedTransaction,
                    ...(intent ? { intent } : {}),
                    ...(replacement ? { replacement: { mode: replacement.mode, originalHash: replacement.original.hash } } : {}),
                  });
                  try {
                    const { session, ring } = await openTrezorAttempt(captured, check, 'send', selected.label, resume, () => undefined);
                    const signed = await sdk.signTrezorEvmTransaction(ring.trezorSigner!, {
                      accountIndex: selected.index, expectedAddress: selected.address, coin: 'eth', slip44: network.slip44,
                      unsignedTransaction,
                    }, { signal: authority.signal, assertCurrent: check });
                    check();
                    await finishTrezor(session, check);
                    return signed;
                  } catch (error) { await failTrezor(captured, admittedTrezorEpoch, error); throw error; }
                }
                if (
                  selected.type !== 'HDAccount' &&
                  selected.type !== 'Imported'
                )
                  throw new KeyringRuntimeError('NOT_READY');
                const softwareType = selected.type;
                const signed = await withSoftwareSecret('transaction', authority.signal, assertCurrent, () => keyring.signPreparedEvmTransaction(
                  {
                    selectedAccount: { id: selected.index, type: selected.type, expectedAddress: selected.address },
                    account: {
                      id: selected.index,
                      type: softwareType,
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
                ), null, { receipt: authority.authorization, target: `evm:${unsignedTransferBytes(prepared)}` });
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
            isAuthenticationRefusal: error => !!error && typeof error === 'object' && secretAuthenticationRefusals.has(error),
            readPhrase: async input => {
              const captured = generation, ring = keyring, identity = verifiedIdentity;
              const check = () => { current(captured); if (!identity || verifiedIdentity !== identity || ring !== keyring || !ring.hasPublicSession()) throw new KeyringRuntimeError('CANCELLED'); };
              check();
              return run(async () => {
                check(); const phrase = await withSoftwareSecret('secret-read', new AbortController().signal, check, secret => ring.getSeed(secret), input, null); check();
                if (typeof phrase !== 'string' || !ring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
                return Object.freeze(phrase.split(' '));
              });
            },
            fingerprint: () => storage.getWalletFingerprint(),
            confirm: (fingerprint) => run(async (captured) => {
              if (!keyring.hasPublicSession()) throw new Error('NOT_READY');
              current(captured);
              await storage.confirmBackup(fingerprint);
              current(captured);
            }),
          },
        };
      } catch {
        storageRetired = true;
        try { await storage.close(); } catch { /* the factory remains unavailable */ }
        throw new Error('UNAVAILABLE');
      }
    },
  };
}
