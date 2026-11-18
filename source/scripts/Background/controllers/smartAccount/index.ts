import { v4 as uuidv4 } from 'uuid';

import { captureSmartAccountCallsIdentity } from '../../../../shared/dappCallsStatus.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../shared/evmFeeGuard';
import {
  readFreshEvmState,
  withEvmReadPhase,
} from '../../../../shared/evmReadPhase';
import {
  readEvmRpcHash,
  readEvmRpcQuantity,
} from '../../../../shared/evmTransactionObservation.ts';
import {
  matchesSmartAccountPayerBudget,
  SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED,
  type SmartAccountFeeQuote,
} from '../../../../shared/smartAccountFeeQuote.ts';
import {
  getSmartAccountUserOpRequiredPrefund,
  SMART_ACCOUNT_ZERO_GAS_FEES,
} from '../../../../utils/smartAccount/account.ts';
import {
  assertSmartAccountPayerFee,
  getSmartAccountPayerBudget,
} from '../../../../utils/smartAccount/cancellationFee';
import {
  captureCompositePolicyChange,
  createCompositePolicyPossession,
  verifyCompositePolicyPossession,
  type CompositePolicyChange,
} from '../../../../utils/smartAccount/compositePossession.ts';
import { getZkSysGasTankAddress } from '../../../../utils/smartAccount/deploymentMetadata';
import { createSmartAccountRawSigningIntent } from '../../../../utils/smartAccount/ownerSigningIntent.ts';
import { buildSmartAccountUserOpSigningIntent } from '../../../../utils/smartAccount/userOperationHash.ts';
import {
  guardianPolicyObservationIdentity,
  inspectGuardianRemovals,
  type GuardianRemovalInspection,
} from '../../../../wallet/guardianRemoval';
import {
  assertSmartAccountCancellation,
  assertSmartAccountCancellationOperation,
  inspectSmartAccountCancellationPayer,
  smartAccountCancellationExecutions,
  smartAccountCancellationPendingRecords,
  type SmartAccountCancellation,
} from '../../../../wallet/smartAccountCancellation.ts';
import {
  IEvmTransactionResponse,
  ISysTransaction,
} from '../transactions/types';
import store, {
  persistSmartAccountMetadata as persistMetadata,
} from 'state/store';
import { setAccountPropertyByIdAndType } from 'state/vault';
import {
  INetworkType,
  ISmartAccountMetadata,
  KeyringAccountType as PaliKeyringAccountType,
  SmartAccountCustomModuleRecord,
} from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { defaultAbiCoder } from 'utils/ethersV6Compat';
import { hexDataSlice } from 'utils/ethersV6Compat';
import { getAddress } from 'utils/ethersV6Compat';
import { BigNumber } from 'utils/ethersV6Compat';
import { AddressZero } from 'utils/ethersV6Compat';
import { Contract } from 'utils/ethersV6Compat';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';
import {
  EVM_TRANSACTION_CONTEXT_CHANGED,
  IEvmTransactionContext,
} from 'utils/evmTransactionContext';
import { blacklistService } from 'utils/security/blacklistService';
import {
  getSLHDSAKeyId,
  normalizeSLHDSAPublicKeyField,
  SLH_DSA_PARAMETER_SET,
} from 'utils/slhDsa';
import {
  aggregateContractCalls,
  AggregateCallResult,
  clearMulticall3AddressCache,
  buildP256WebAuthnAuthenticator,
  buildSLHDSAAuthenticator,
  getGuardianRecoveryDigestContext,
  getPaliErc7739PersonalSignHash,
  SmartAccountGuardianRecoveryDigestContext,
  SmartAccountGuardianRecoveryOperation,
  encodeEcdsaValidatorInitData,
  CustomValidatorPreflightResult,
  getConfiguredAuthenticatorAddress,
  preflightCustomValidatorInstall,
  getPaliSmartAccountFactoryAddress,
  getPaliSmartAccountDescriptor,
  getSmartAccountGasUnitsReserve,
  PaliAuthConfig,
  PaliRecoveryTarget,
  PALI_SMART_ACCOUNT_VERSION,
  PaliSmartAccountAuthenticatorSetup,
  ERC7579_MODULE_TYPE_VALIDATOR,
  ERC7579_MODULE_TYPE_EXECUTOR,
  PALI_ENTRYPOINT_V09_ABI,
  getPaliEntryPointAddress,
  paliGuardianRecoveryModuleInterface,
  paliSmartAccountInterface,
  SmartAccountExecution,
  SmartAccountPackedUserOperation,
  SmartAccountUserOpGasEstimate,
  getAvailablePaliModules,
  SmartAccountAuthenticatorBuildResult,
  toPaliSmartAccount,
} from 'utils/smartAccount';
import { assertSmartAccountSpendability } from 'utils/smartAccount/assetSpendability';
import { deriveDefaultSmartAccount } from 'utils/smartAccount/bootstrap';
import {
  getPaliInfrastructureContracts,
  type PaliInfrastructureContractId,
} from 'utils/smartAccount/deployment';
import { readSmartAccountDeploymentState } from 'utils/smartAccount/deploymentState';
import {
  snapshotSmartAccountExpectedErc20Transfers,
  type SmartAccountExpectedErc20Transfer,
} from 'utils/smartAccount/erc20Transfer';
import {
  hasUsableSmartAccountAuthMetadata,
  readSmartAccountValidatorMetadata,
} from 'utils/smartAccount/executionMetadata';
import { projectGuardianPolicyModule } from 'utils/smartAccount/guardianPolicy';
import {
  captureGuardianRecoveryClaim,
  guardianRecoveryReplacementApplied,
  sameGuardianRecoveryClaim,
  type GuardianRecoveryClaim,
  type GuardianRecoveryReplacement,
} from 'utils/smartAccount/guardianRecoveryClaim';
import {
  buildGuardianRecoveryStart,
  buildGuardianRecoveryScheduleTransaction,
  buildGuardianRecoveryFinalizeTransaction,
  captureGuardianRecoveryTarget,
  captureGuardianRecoveryOperation,
  validateGuardianRecoveryOperation,
} from 'utils/smartAccount/guardianRecoveryCommands';
import {
  captureGuardianRecoveryIntent,
  type GuardianRecoveryIntent,
} from 'utils/smartAccount/guardianRecoveryIntent';
import {
  guardianRecoveryIntentResolved,
  pendingGuardianRecoveryTransaction,
  type GuardianRecoveryTransactionRecords,
} from 'utils/smartAccount/guardianRecoveryLifecycle';
import {
  getGuardianRecoveryOperationId,
  readGuardianRecoveryObservation,
  type GuardianRecoveryObservation,
} from 'utils/smartAccount/guardianStatus';
import { guardianStatusProvider } from 'utils/smartAccount/guardianStatusProvider';
import {
  buildInfrastructureDeploymentCommand,
  settleInfrastructurePending,
  validInfrastructureReceipt,
} from 'utils/smartAccount/infrastructureActions';
import {
  assertSmartAccountInfrastructureReady,
  createSmartAccountInfrastructureReader,
  projectSmartAccountInfrastructureObservation,
  SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES,
  type SmartAccountInfrastructureObservation,
} from 'utils/smartAccount/infrastructureObservation';
import {
  hasGuardianRecoveryNotReadyRevert,
  hasGuardianRecoveryAlreadyScheduledRevert,
  hasGuardianRecoveryExpiredRevert,
  hasNativeGasFailure,
} from 'utils/smartAccount/operationErrors';
import {
  getSmartAccountGasPayerCandidates,
  selectSmartAccountGasPayer,
  readSmartAccountNativeBalances,
  canUseSmartAccountGasTank,
  ensureSmartAccountDeploymentPrefund,
  readSmartAccountDeploymentShortfall,
} from 'utils/smartAccount/payerPolicy';
import {
  createSmartAccountPendingState,
  type SmartAccountPendingState,
} from 'utils/smartAccount/pendingState';
import {
  getExplicitSmartAccountGasPrice,
  prepareSmartAccountOperation,
  type SmartAccountGasPayer,
  requireSmartAccountAuthenticator,
  SMART_ACCOUNT_EXECUTION_LIFETIME_MS,
} from 'utils/smartAccount/prepareOperation';
import { signSmartAccountEcdsaOperation } from 'utils/smartAccount/signOperation';
import {
  submitSmartAccountOperation,
  type SmartAccountSubmissionChecks,
  type SmartAccountSubmitParams,
} from 'utils/smartAccount/submitOperation';
import { assertSmartAccountTargetsAllowed } from 'utils/smartAccount/targetPolicy';

import {
  infrastructurePendingIdentity,
  InfrastructureJournalEntry,
  readInfrastructureJournal,
  writeInfrastructureJournal,
  clearInfrastructureJournal,
} from './infrastructureJournal';
import type {
  SmartAccountControllerAuthority,
  SmartAccountControllerFeeReview,
} from '../../../../shared/smartAccountControllerAuthority';
import type {
  EvmSignedRecords,
  SmartAccountPendingRecords,
} from '../../../../wallet/evmSignedRecords';
import type { ITxid } from '@sidhujag/sysweb3-utils';

export interface ISmartAccountControllerDependencies {
  captureGuardianRecoveryTransactions(
    chainId: number,
    assertCurrent: () => void
  ): Promise<GuardianRecoveryTransactionRecords>;
  captureReadLifetime?: (assertCurrent: () => void) => {
    assertCurrent(): void;
    dispose(): void;
    signal: AbortSignal;
  };
  captureSmartAccountPendingRecords(
    chainId: number,
    address: string,
    assertCurrent: () => void
  ): Promise<SmartAccountPendingRecords>;
  getEthereumTransaction: () => any;
  getLatestUpdateForCurrentAccount: (
    isPolling?: boolean,
    forceUpdate?: boolean,
    isAssetPolling?: boolean,
    skipCache?: boolean
  ) => Promise<boolean>;
  getWalletSessionGeneration?: () => number;
  getWalletStateGeneration: () => number;
  readSettingsEvmFeeNonce(id: string, contractId: string): number;
  retainSmartAccountAuthorization(
    input: Parameters<EvmSignedRecords['retainSmartAccountAuthorization']>[1],
    assertCurrent: () => void
  ): ReturnType<EvmSignedRecords['retainSmartAccountAuthorization']>;
  reviewSettingsEvmFee(
    params: unknown,
    targetAccount: { id: number; type: PaliKeyringAccountType },
    metadata: Record<string, unknown>,
    options: NonNullable<
      Parameters<
        ISmartAccountControllerDependencies['sendAndSaveEthTransaction']
      >[4]
    >
  ): Promise<SettingsEvmFeeReview>;
  saveWalletState: (
    operation: string,
    isUserActivity?: boolean,
    sync?: boolean
  ) => Promise<void>;
  sendAndSaveEthTransaction: (
    params: any,
    isLegacy?: boolean,
    targetAccount?: { id: number; type: PaliKeyringAccountType },
    transactionMetadata?: Record<string, unknown>,
    saveOptions?: {
      assertBeforeSign: () => void;
      assertCurrentContext?: () => void;
      assertPendingState?: () => Promise<void>;
      clearNavigation?: boolean;
      confirmFee?: SmartAccountControllerAuthority['confirmFee'];
      genericReviewId?: string;
      onBroadcast?: (response: IEvmTransactionResponse) => Promise<void>;
      persist?: boolean;
      skipRapidPolling?: boolean;
      transactionAccounts?: Array<{ id: number; type: PaliKeyringAccountType }>;
    }
  ) => Promise<IEvmTransactionResponse>;
  sendAndSaveTransaction: (
    tx: IEvmTransactionResponse | ISysTransaction | ITxid,
    targetAccount?: { id: number; type: PaliKeyringAccountType },
    options?: {
      clearNavigation?: boolean;
      persist?: boolean;
      skipRapidPolling?: boolean;
      transactionAccounts?: Array<{ id: number; type: PaliKeyringAccountType }>;
    }
  ) => Promise<void>;
  signSLHDSARecoveryTargetActionHash: (params: {
    actionHash: string;
    executionContextId?: string;
    keyId: string;
    parameterSet: 'SLH-DSA-SHA2-128-24';
    pkRoot: string;
    pkSeed: string;
  }) => Promise<string>;
  signSmartAccountOperationOwner: (
    executionContextId: string,
    targetAccount: { id: number; type: PaliKeyringAccountType },
    assertCurrent: () => void,
    signal: AbortSignal
  ) => Promise<string>;
  signSmartAccountRecoveryOwner: (
    executionContextId: string,
    targetAccount: { id: number; type: PaliKeyringAccountType },
    assertCurrent: () => void
  ) => Promise<string>;
}

type GuardianRecoveryStatusForAccount = {
  delay: string;
  delaySeconds: number;
  exists: boolean;
  expirationSeconds: number;
  guardianCount: string;
  guardians: string[];
  moduleAddress: string;
  threshold: number;
};

type InfrastructurePending = InfrastructureJournalEntry;
type SettingsEvmFeeReview = ReturnType<
  typeof import('../nativeEvmFeeReviews').issueGenericEvmFeeReview
>;

type InfrastructureDeploymentResult = {
  contractName?: string;
  deployed: PaliInfrastructureContractId[];
  feeReview?: SettingsEvmFeeReview;
  pending?: InfrastructurePending;
  skipped: PaliInfrastructureContractId[];
};

type SmartAccountInfrastructureStatus =
  SmartAccountInfrastructureObservation & {
    pending?: InfrastructurePending;
  };

const GUARDIAN_RECOVERY_NOT_READY_ERROR = 'PALI_GUARDIAN_RECOVERY_NOT_READY';

// RecoveryAlreadyScheduled(bytes32) on the guardian recovery module.
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR =
  'PALI_GUARDIAN_RECOVERY_ALREADY_SCHEDULED';

// RecoveryExpired(bytes32) on the guardian recovery module.
const GUARDIAN_RECOVERY_EXPIRED_ERROR = 'PALI_GUARDIAN_RECOVERY_EXPIRED';

const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
const HYDRATED_METADATA_TTL_MS = 30_000;
const PROVIDER_UNAVAILABLE_ERROR = 'Web3 provider not available';
const INFRASTRUCTURE_TIMEOUT_ERROR =
  'Infrastructure RPC timed out. Refresh status before retrying.';
const INFRASTRUCTURE_CODE_ERROR =
  'Invalid infrastructure code response. Refresh status before deploying.';
const DEPLOYMENT_RECEIPT_ERROR =
  'Invalid deployment receipt. Refresh status before retrying.';
const RECOVERY_MANAGEMENT_ADDRESS_ERROR =
  'A wallet management address is required for smart-account recovery lookup';
const DEPLOYMENT_NONCE_ERROR = 'Invalid deployment nonce response';
const GUARDIAN_POLICY_ERROR =
  'Guardian policy editing is handled by module templates';

const toCompatBigNumber = (value: any): BigNumber => BigNumber.from(value);

const randomBytes32Hex = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`;
};

class SmartAccountController {
  private readonly readInfrastructureCodes =
    createSmartAccountInfrastructureReader();
  private readonly guardianRecoverySubmissions = new Map<string, AsyncMutex>();
  private readonly executionContexts = new Map<
    string,
    {
      accountId: number;
      actionHash: string;
      authorizationAnchor?: { hash: string; number: string };
      cancellation?: SmartAccountCancellation;
      compositePossession?: {
        accepted: boolean;
        challenge: ReturnType<typeof createCompositePolicyPossession>;
        proofs: Map<
          string,
          { signature: string; verification: Promise<boolean> }
        >;
        proposal: CompositePolicyChange;
        sourceMetadata: string;
      };
      entryPointFeeApproved?: boolean;
      entryPointFeeConsumed?: boolean;
      entryPointFeeQuote?: SmartAccountFeeQuote & {
        executionContextId: string;
      };
      executionIntent?: string;
      expiresAt: number;
      feeDisplayBlock?: import('../../../../shared/evmDappPreparation').EvmDappFeeDisplayBlock;
      gasPrice?: string;
      pending?: SmartAccountPendingState;
      prepared?: Awaited<ReturnType<typeof prepareSmartAccountOperation>>;
      purpose: 'user-operation' | 'recovery-digest';
      replaceOuter?: boolean;
      snapshot: ReturnType<SmartAccountController['infrastructureContext']>;
      userOperation?: SmartAccountPackedUserOperation;
    }
  >();
  private readonly infrastructureDeployments = new Map<
    number,
    { contextKey: string; operation: Promise<InfrastructureDeploymentResult> }
  >();
  private readonly pendingInfrastructure = new Map<
    number,
    InfrastructurePending
  >();
  private readonly pendingDeploymentAddresses = new Set<string>();
  private readonly hydratedMetadataCache = new Map<
    string,
    {
      executionContext?: ReturnType<
        SmartAccountController['infrastructureContext']
      >;
      metadata: ISmartAccountMetadata;
      sourceMetadata?: ISmartAccountMetadata;
      timestamp: number;
    }
  >();
  private readonly inflightHydrations = new Map<
    string,
    Promise<ISmartAccountMetadata>
  >();
  private readonly guardianObservations = new Map<
    string,
    {
      context: ReturnType<SmartAccountController['infrastructureContext']>;
      lifetime: { assertCurrent(): void; dispose(): void; signal: AbortSignal };
      promise: ReturnType<typeof readGuardianRecoveryObservation>;
      settled: boolean;
      subscribers: number;
    }
  >();
  private readonly explicitHydrations = new Map<
    string,
    {
      context: ReturnType<SmartAccountController['infrastructureContext']>;
      promise: Promise<ISmartAccountMetadata>;
      walletGeneration: number;
    }
  >();

  constructor(private readonly deps: ISmartAccountControllerDependencies) {}

  private get ethereumTransaction() {
    return this.deps.getEthereumTransaction();
  }

  public async assertSmartAccountSupported(): Promise<boolean> {
    const context = this.infrastructureContext();
    return this.assertInfrastructureSupported(context, () =>
      this.assertInfrastructureContext(context)
    );
  }

  private async assertInfrastructureSupported(
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    assertCurrent: () => void
  ): Promise<boolean> {
    const status = await this.infrastructureStatus(
      context,
      false,
      assertCurrent
    );
    assertCurrent();
    assertSmartAccountInfrastructureReady(status);
    return true;
  }

  private infrastructureContext() {
    const { vault, vaultGlobal } = store.getState();
    const { activeNetwork, activeAccount, accounts, isBitcoinBased } = vault;
    if (isBitcoinBased || activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Smart accounts are only available on EVM networks');
    }
    const transaction = this.ethereumTransaction;
    const provider = transaction?.web3Provider;
    if (!provider) throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    const payer = accounts?.[activeAccount.type]?.[activeAccount.id];
    return {
      chainId: activeNetwork.chainId,
      url: activeNetwork.url,
      network: JSON.stringify(activeNetwork),
      key: `${activeNetwork.chainId}:${activeNetwork.url}`,
      provider,
      transaction,
      slip44: vaultGlobal?.activeSlip44,
      generation: this.deps.getWalletSessionGeneration?.(),
      account: { ...activeAccount },
      address: payer?.address,
    };
  }

  private sameInfrastructureContext(
    current: ReturnType<SmartAccountController['infrastructureContext']>,
    context: ReturnType<SmartAccountController['infrastructureContext']>
  ): boolean {
    return (
      current.key === context.key &&
      current.network === context.network &&
      current.provider === context.provider &&
      current.transaction === context.transaction &&
      current.slip44 === context.slip44 &&
      current.generation === context.generation &&
      current.account.id === context.account.id &&
      current.account.type === context.account.type &&
      current.address === context.address
    );
  }

  private assertInfrastructureContext(
    context: ReturnType<SmartAccountController['infrastructureContext']>
  ) {
    if (!this.sameInfrastructureContext(this.infrastructureContext(), context))
      throw new Error(
        'Wallet context changed. Reopen deployment on the selected network.'
      );
  }

  public assertExpectedExecutionContext(
    expected: IEvmTransactionContext,
    accountId?: number,
    requireSmartAccount = true
  ): void {
    const { vault, vaultGlobal } = store.getState();
    const selected =
      vault.accounts?.[vault.activeAccount.type]?.[vault.activeAccount.id];
    if (
      vault.isBitcoinBased ||
      vault.activeNetwork.chainId !== expected.chainId ||
      vault.activeNetwork.url !== expected.rpcUrl ||
      vaultGlobal.activeSlip44 !== expected.slip44 ||
      expected.sessionGeneration === undefined ||
      this.deps.getWalletSessionGeneration?.() !== expected.sessionGeneration ||
      vault.activeAccount.id !== expected.account.id ||
      vault.activeAccount.type !== expected.account.type ||
      (requireSmartAccount &&
        expected.account.type !== PaliKeyringAccountType.SmartAccount) ||
      selected?.address?.toLowerCase() !==
        expected.account.address.toLowerCase() ||
      (accountId !== undefined && accountId !== expected.account.id)
    ) {
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    }
  }

  public assertSmartAccountExecutionContext(
    executionContextId: string,
    actionHash?: string
  ): void {
    const context = this.executionContexts.get(executionContextId);
    try {
      if (
        !context ||
        context.expiresAt <= Date.now() ||
        (actionHash &&
          actionHash.toLowerCase() !== context.actionHash.toLowerCase())
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      this.assertInfrastructureContext(context.snapshot);
      if (context.cancellation) {
        const active = this.getSmartAccountById(context.accountId);
        if (!context.userOperation || !active.metadata.auth?.validator)
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
        assertSmartAccountCancellationOperation(
          context.cancellation,
          context.userOperation,
          active.metadata.auth.validator
        );
      }
      if (context.compositePossession) {
        const current = this.getSmartAccountById(context.accountId).metadata;
        if (
          JSON.stringify({
            auth: current.auth,
            installedModules: current.installedModules,
          }) !== context.compositePossession.sourceMetadata
        )
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    } catch {
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    }
  }

  public async assertSmartAccountPreparedNonce(
    executionContextId: string
  ): Promise<void> {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    if (context.userOperation) {
      if (!context.pending) throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      await context.pending.withReadPhase(async (phase) => {
        await Promise.all([
          phase.assertNonce(context.userOperation!),
          assertSmartAccountSpendability({
            provider: phase.provider,
            chainId: context.snapshot.chainId,
            userOperation: context.userOperation!,
            expectedErc20Transfers: context.prepared?.expectedErc20Transfers,
            assertCurrent: () =>
              this.assertSmartAccountExecutionContext(executionContextId),
          }),
        ]);
      });
      this.assertSmartAccountExecutionContext(executionContextId);
    }
  }

  public captureOwnerSigningIntent(executionContextId: string) {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    this.assertCompositePossessionAccepted(executionContextId);
    this.assertExecutionFeeApproved(executionContextId);
    const intent =
      context.purpose === 'user-operation' && context.userOperation
        ? buildSmartAccountUserOpSigningIntent(
            context.userOperation,
            context.snapshot.chainId
          )
        : context.purpose === 'recovery-digest' &&
          context.userOperation === undefined
        ? createSmartAccountRawSigningIntent(
            'recovery',
            context.actionHash,
            'recovery-digest'
          )
        : undefined;
    if (!intent) throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    if (intent.actionHash.toLowerCase() !== context.actionHash.toLowerCase())
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    return Object.freeze({ intent, expiresAt: context.expiresAt });
  }

  public assertCompositePossessionAccepted(executionContextId: string): void {
    this.assertSmartAccountExecutionContext(executionContextId);
    const possession =
      this.executionContexts.get(executionContextId)!.compositePossession;
    if (possession && !possession.accepted)
      throw Object.assign(
        new Error('Prove the proposed combined approvals before signing'),
        { transactionNotBroadcast: true }
      );
  }

  public assertExecutionFeeApproved(executionContextId: string): void {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    if (
      context.purpose === 'user-operation' &&
      (!context.entryPointFeeApproved || context.entryPointFeeConsumed)
    )
      throw Object.assign(
        new Error('Approve the Smart account fee quote before signing'),
        { transactionNotBroadcast: true }
      );
  }

  public approveSmartAccountExecutionFeeQuote(
    executionContextId: string,
    quote: Pick<
      SmartAccountFeeQuote,
      'feePayer' | 'maximumFeeWei' | 'executionContextId'
    > &
      Partial<
        Pick<
          SmartAccountFeeQuote,
          'gasUnits' | 'cancellationPayerBudget' | 'payerBudget'
        >
      >
  ): void {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    const expected = context.entryPointFeeQuote;
    if (
      !expected ||
      context.entryPointFeeConsumed ||
      quote?.executionContextId !== executionContextId ||
      !matchesSmartAccountPayerBudget(
        expected.cancellationPayerBudget,
        quote.cancellationPayerBudget
      ) ||
      !matchesSmartAccountPayerBudget(
        expected.payerBudget,
        quote.payerBudget
      ) ||
      quote.feePayer?.id !== expected.feePayer.id ||
      quote.feePayer?.type !== expected.feePayer.type ||
      typeof quote.feePayer?.address !== 'string' ||
      quote.feePayer.address.toLowerCase() !==
        expected.feePayer.address.toLowerCase() ||
      typeof quote.maximumFeeWei !== 'string' ||
      !/^\d{1,80}$/.test(quote.maximumFeeWei) ||
      BigInt(quote.maximumFeeWei) !== BigInt(expected.maximumFeeWei) ||
      (quote.gasUnits !== undefined &&
        (typeof quote.gasUnits !== 'string' ||
          !/^\d{1,80}$/.test(quote.gasUnits) ||
          BigInt(quote.gasUnits) !== BigInt(expected.gasUnits)))
    )
      throw Object.assign(
        new Error('Smart account fee quote changed; review it again'),
        { transactionNotBroadcast: true }
      );
    context.entryPointFeeApproved = true;
  }

  public getSmartAccountCompositePossession(executionContextId: string) {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    const possession = context.compositePossession;
    return possession
      ? Object.freeze({
          ...possession.challenge,
          proposal: possession.proposal,
          accountId: context.accountId,
          executionContextId,
        })
      : null;
  }

  public captureCompositeOwnerSigningIntent(
    executionContextId: string,
    ownerAddress: string
  ) {
    this.assertExecutionFeeApproved(executionContextId);
    const challenge =
      this.getSmartAccountCompositePossession(executionContextId);
    if (
      !challenge ||
      !challenge.smartAccount.installedModules?.some(
        (module) =>
          module.type === 'validator' &&
          module.id === 'ecdsa' &&
          challenge.validator.config.childValidators.some(
            (child) => child.toLowerCase() === module.address.toLowerCase()
          ) &&
          module.config.owners.some(
            (owner) => getAddress(owner) === getAddress(ownerAddress)
          )
      )
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    return Object.freeze({
      intent: challenge.intent,
      expiresAt: this.executionContexts.get(executionContextId)!.expiresAt,
    });
  }

  /** Only the exact proposed installed child may use the separate possession digest. */
  public captureCompositeSlhSigningMetadata(
    executionContextId: string,
    actionHash: string,
    keyId: string
  ): ISmartAccountMetadata | undefined {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    this.assertExecutionFeeApproved(executionContextId);
    if (actionHash.toLowerCase() === context.actionHash.toLowerCase()) {
      this.assertCompositePossessionAccepted(executionContextId);
      return undefined;
    }
    const challenge = context.compositePossession?.challenge;
    if (
      !challenge ||
      challenge.intent.actionHash.toLowerCase() !== actionHash.toLowerCase() ||
      !challenge.smartAccount.installedModules?.some(
        (module) =>
          module.type === 'validator' &&
          module.id === 'slh-dsa' &&
          module.config.keyId === keyId &&
          challenge.validator.config.childValidators.some(
            (child) => child.toLowerCase() === module.address.toLowerCase()
          )
      )
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    return challenge.smartAccount;
  }

  public async verifySmartAccountCompositePossession(
    executionContextId: string,
    signatures: readonly string[],
    assertApprovalCurrent: () => void
  ) {
    const assertCurrent = () => {
      this.assertSmartAccountExecutionContext(executionContextId);
      assertSynchronousEvmFeeGuard(assertApprovalCurrent);
    };
    assertCurrent();
    const context = this.executionContexts.get(executionContextId)!;
    const possession = context.compositePossession;
    if (!possession || !context.pending)
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    if (
      !Array.isArray(signatures) ||
      signatures.length !== possession.proposal.children.length
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const supplied = signatures.map((_, index) => {
      const field = Object.getOwnPropertyDescriptor(signatures, index);
      if (!field || !('value' in field) || typeof field.value !== 'string')
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      return field.value as string;
    });
    const provisional: Array<{
      entry: { signature: string; verification: Promise<boolean> };
      key: string;
      reject(error: unknown): void;
      resolve(value: boolean): void;
      valid: boolean;
    }> = [];
    let verifiedChildren: readonly string[];
    try {
      verifiedChildren = await context.pending.withReadPhase((phase) =>
        verifyCompositePolicyPossession({
          proposal: possession.proposal,
          actionHash: possession.challenge.intent.actionHash,
          signatures: supplied,
          assertCurrent,
          verifyChild: async (child, signature) => {
            assertCurrent();
            const key = child.address.toLowerCase();
            const previous = possession.proofs.get(key);
            if (previous) {
              if (previous.signature !== signature)
                throw new Error(
                  'Combined approval proof changed; start a new attempt'
                );
              return previous.verification;
            }
            let resolve!: (value: boolean) => void,
              reject!: (error: unknown) => void;
            const verification = new Promise<boolean>((accepted, refused) => {
              resolve = accepted;
              reject = refused;
            });
            void verification.catch(() => undefined);
            const entry = { signature, verification };
            const observation = { key, entry, valid: false, resolve, reject };
            provisional.push(observation);
            possession.proofs.set(key, entry);
            const validator = new Contract(
              child.address,
              [
                'function isValidSignatureWithSender(address sender,bytes32 hash,bytes signature) view returns (bytes4)',
              ],
              phase.provider
            );
            observation.valid =
              (await validator.isValidSignatureWithSender(
                context.userOperation!.sender,
                possession.challenge.intent.actionHash,
                signature
              )) === '0x1626ba7e';
            assertCurrent();
            return observation.valid;
          },
        })
      );
      assertCurrent();
      // A contract result is reusable only after its whole phase passes final
      // canonical/chain and document checks. Concurrent callers await this gate.
      for (const observation of provisional)
        observation.resolve(observation.valid);
    } catch (error) {
      for (const observation of provisional) {
        if (possession.proofs.get(observation.key) === observation.entry)
          possession.proofs.delete(observation.key);
        observation.reject(error);
      }
      throw error;
    }
    const threshold = possession.challenge.validator.config.threshold;
    const satisfied = verifiedChildren.length >= threshold;
    if (satisfied) possession.accepted = true;
    return Object.freeze({ verifiedChildren, threshold, satisfied });
  }

  public getPreparedCallsIdentity(executionContextId: string) {
    this.assertSmartAccountExecutionContext(executionContextId);
    const context = this.executionContexts.get(executionContextId)!;
    if (!context.userOperation)
      throw new Error('Prepared smart account operation is required');
    return captureSmartAccountCallsIdentity(
      context.userOperation,
      context.snapshot.chainId
    );
  }

  private recoveryApprovalContext(expected?: IEvmTransactionContext) {
    const snapshot = this.infrastructureContext();
    const assertCurrent = () => {
      try {
        this.assertInfrastructureContext(snapshot);
        if (expected)
          this.assertExpectedExecutionContext(expected, undefined, false);
      } catch {
        throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
          transactionNotBroadcast: true,
        });
      }
    };
    assertCurrent();
    return { snapshot, assertCurrent };
  }

  private rememberRecoverySigningContext(
    snapshot: ReturnType<SmartAccountController['infrastructureContext']>,
    actionHash: string
  ) {
    for (const [id, context] of this.executionContexts)
      if (context.expiresAt <= Date.now()) this.executionContexts.delete(id);
    while (this.executionContexts.size >= 128)
      this.executionContexts.delete(this.executionContexts.keys().next().value);
    const id = uuidv4();
    this.executionContexts.set(id, {
      accountId: snapshot.account.id,
      actionHash,
      purpose: 'recovery-digest',
      expiresAt: Date.now() + SMART_ACCOUNT_EXECUTION_LIFETIME_MS,
      snapshot,
    });
    return id;
  }

  private async infrastructureDeadline<T>(
    operation: Promise<T>,
    timeoutMs = 8000
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(INFRASTRUCTURE_TIMEOUT_ERROR)),
            timeoutMs
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private persistedInfrastructurePending(
    chainId: number
  ): InfrastructurePending[] {
    const pending: InfrastructurePending[] = [];
    const histories = store.getState().vault.accountTransactions || {};
    for (const accounts of Object.values(histories)) {
      for (const history of Object.values(accounts)) {
        // The vault reducer stores newest transactions first.
        for (const transaction of history.ethereum?.[chainId] || []) {
          const tx = transaction as typeof transaction & Record<string, any>;
          if (
            tx.smartAccountInfrastructureDeployment === true &&
            typeof tx.hash === 'string' &&
            !tx.isCanceled &&
            !tx.isReplaced &&
            !tx.blockNumber &&
            !Number(tx.confirmations) &&
            tx.status !== 'confirmed' &&
            tx.status !== 'failed'
          ) {
            pending.push({
              contractId: tx.smartAccountInfrastructureId,
              rpcUrl:
                typeof tx.smartAccountInfrastructureRpcUrl === 'string' &&
                tx.smartAccountInfrastructureRpcUrl
                  ? tx.smartAccountInfrastructureRpcUrl
                  : undefined,
              transactionHash: tx.hash,
            });
          }
        }
      }
    }
    return pending;
  }

  private async readInfrastructureStatus(
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    assertCurrent: () => void,
    forceRefresh = false
  ): Promise<SmartAccountInfrastructureStatus> {
    const deadline = Date.now() + 18000;
    const withinDeadline = <T>(
      operation: () => Promise<T>,
      maximumWait = 8000
    ): Promise<T> => {
      assertCurrent();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(INFRASTRUCTURE_TIMEOUT_ERROR);
      return this.infrastructureDeadline(
        operation(),
        Math.min(maximumWait, remaining)
      ).then((result) => {
        assertCurrent();
        return result;
      });
    };
    assertCurrent();
    // Capture pending identities before probing; later submissions must never
    // be settled using code/receipts read before their reservation existed.
    const observedMemory = this.pendingInfrastructure.get(context.chainId);
    const observedHistory = this.persistedInfrastructurePending(
      context.chainId
    );
    const journal = await withinDeadline(() =>
      readInfrastructureJournal(context, assertCurrent)
    );
    const addresses = SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES;
    const status: SmartAccountInfrastructureStatus =
      await this.readInfrastructureCodes({
        chainId: context.chainId,
        url: context.url,
        provider: {
          send: (method, params) =>
            withinDeadline(() => context.provider.send(method, params)),
          sendFresh: (method, params) =>
            withinDeadline(() =>
              readFreshEvmState(context.provider, method, params)
            ),
          verifyConfiguredChainId: () =>
            withinDeadline(() =>
              context.provider.verifyConfiguredChainId(true)
            ),
        },
        assertCurrent,
        forceRefresh,
        readCodes: async (blockTag) => {
          try {
            const batched = await withinDeadline(
              () =>
                context.provider.sendBatch(
                  'eth_getCode',
                  addresses.map((address) => [address, blockTag])
                ),
              1800
            );
            if (
              projectSmartAccountInfrastructureObservation(
                context.chainId,
                batched
              )
            )
              return batched;
          } catch {
            assertCurrent();
          }
          return withinDeadline(() =>
            Promise.all(
              addresses.map((address) =>
                context.provider.getCode(address, blockTag)
              )
            )
          );
        },
      });
    if (
      journal &&
      !status.contracts.some((contract) => contract.id === journal.contractId)
    )
      throw new Error(
        'Deployment journal contains an unknown contract. Refresh status before retrying.'
      );
    const candidates = [observedMemory, journal, ...observedHistory].filter(
      (entry): entry is InfrastructurePending => Boolean(entry)
    );
    let pending: InfrastructurePending | undefined;
    let journalCleared = false;
    for (const candidate of candidates) {
      // Preserve legacy/other-RPC admission before skipping unknown history IDs.
      // An unknown durable journal has already failed the catalogue check above.
      if (
        candidate.rpcUrl === context.url &&
        !status.contracts.some(
          (contract) => contract.id === candidate.contractId
        )
      )
        continue;
      const settlement = await settleInfrastructurePending({
        context,
        status,
        entry: candidate,
        ports: {
          readReceipt: (hash) =>
            withinDeadline(
              () => context.provider.getTransactionReceipt(hash),
              1800
            ),
          readLatestNonce: (address) =>
            withinDeadline(
              () =>
                context.provider.send('eth_getTransactionCount', [
                  address,
                  'latest',
                ]),
              1800
            ),
        },
      });
      assertCurrent();
      if (settlement === 'pending') {
        pending = candidate;
        break;
      }
      if (
        journal &&
        !journalCleared &&
        infrastructurePendingIdentity(candidate) ===
          infrastructurePendingIdentity(journal)
      ) {
        await withinDeadline(() =>
          clearInfrastructureJournal(context, candidate, assertCurrent)
        );
        journalCleared = true;
      }
      if (
        infrastructurePendingIdentity(
          this.pendingInfrastructure.get(context.chainId)
        ) === infrastructurePendingIdentity(candidate)
      )
        this.pendingInfrastructure.delete(context.chainId);
    }
    const latestPending = this.pendingInfrastructure.get(context.chainId);
    if (
      latestPending &&
      (infrastructurePendingIdentity(latestPending) !==
        infrastructurePendingIdentity(observedMemory) ||
        latestPending.transactionHash !== observedMemory?.transactionHash)
    )
      pending = latestPending;
    if (pending) status.pending = pending;
    assertCurrent();
    return status;
  }

  public async getSmartAccountInfrastructureStatus(
    forceRefresh = false
  ): Promise<SmartAccountInfrastructureStatus> {
    const context = this.infrastructureContext();
    return this.infrastructureStatus(context, forceRefresh, () =>
      this.assertInfrastructureContext(context)
    );
  }

  private async infrastructureStatus(
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    forceRefresh: boolean,
    assertCurrent: () => void
  ): Promise<SmartAccountInfrastructureStatus> {
    assertCurrent();
    return this.readInfrastructureStatus(context, assertCurrent, forceRefresh);
  }

  public deploySmartAccountInfrastructure(
    params: { feeReviewId?: string } = {}
  ): Promise<InfrastructureDeploymentResult> {
    const context = this.infrastructureContext();
    const existing = this.infrastructureDeployments.get(context.chainId);
    if (existing) {
      if (existing.contextKey === context.key) return existing.operation;
      return Promise.reject(
        new Error(
          'Another infrastructure deployment is pending on this network.'
        )
      );
    }
    const operation = this.deployInfrastructureForContext(
      context,
      params.feeReviewId
    ).finally(() => {
      if (
        this.infrastructureDeployments.get(context.chainId)?.operation ===
        operation
      )
        this.infrastructureDeployments.delete(context.chainId);
    });
    this.infrastructureDeployments.set(context.chainId, {
      contextKey: context.key,
      operation,
    });
    return operation;
  }

  private async deployInfrastructureForContext(
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    feeReviewId?: string
  ): Promise<InfrastructureDeploymentResult> {
    const deployed: PaliInfrastructureContractId[] = [];
    const skipped: PaliInfrastructureContractId[] = [];
    const assertCurrent = () => this.assertInfrastructureContext(context);
    const status = await this.readInfrastructureStatus(context, assertCurrent);
    assertCurrent();
    if (status.pending) return { deployed, skipped, pending: status.pending };
    if (!status.create2Deployer.deployed)
      throw new Error(
        'Cannot deploy Pali smart account infrastructure because this network is missing the canonical CREATE2 deployer.'
      );
    if (!context.address)
      throw new Error('Deployment gas payer is unavailable');
    let nextNonce = 0;
    for (const contract of getPaliInfrastructureContracts(context.chainId)) {
      this.assertInfrastructureContext(context);
      const code = await this.infrastructureDeadline(
        context.provider.send('eth_getCode', [contract.address, 'latest'])
      );
      this.assertInfrastructureContext(context);
      if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code))
        throw new Error(INFRASTRUCTURE_CODE_ERROR);
      if (code !== '0x') {
        skipped.push(contract.id);
        continue;
      }
      if (contract.externallyDeployed || !contract.deployCalldata)
        throw new Error(
          `${contract.displayName} must be deployed by the zkSYS launch flow before Pali smart account infrastructure can be deployed.`
        );
      const pendingNonce = await this.infrastructureDeadline(
        context.provider.send('eth_getTransactionCount', [
          context.address,
          'pending',
        ])
      );
      this.assertInfrastructureContext(context);
      if (
        typeof pendingNonce !== 'string' ||
        !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(pendingNonce)
      )
        throw new Error(DEPLOYMENT_NONCE_ERROR);
      const parsedNonce = Number(pendingNonce);
      if (!Number.isSafeInteger(parsedNonce) || parsedNonce < 0)
        throw new Error(DEPLOYMENT_NONCE_ERROR);
      const nonce =
        feeReviewId === undefined
          ? Math.max(nextNonce, parsedNonce)
          : this.deps.readSettingsEvmFeeNonce(feeReviewId, contract.id);
      const command = buildInfrastructureDeploymentCommand({
        contract,
        chainId: context.chainId,
        from: context.address,
        nonce,
      });
      const metadata = {
        smartAccountInfrastructureDeployment: true,
        smartAccountInfrastructureId: contract.id,
        smartAccountInfrastructureRpcUrl: context.url,
      };
      if (feeReviewId === undefined) {
        const feeReview = await this.deps.reviewSettingsEvmFee(
          command,
          context.account,
          metadata,
          {
            clearNavigation: false,
            persist: true,
            assertBeforeSign: assertCurrent,
            assertCurrentContext: assertCurrent,
          }
        );
        assertCurrent();
        return {
          deployed,
          skipped,
          feeReview,
          contractName: contract.displayName,
        };
      }
      const reservation: InfrastructurePending = {
        contractId: contract.id,
        attemptId: randomBytes32Hex(),
        payerAddress: context.address,
        rpcUrl: context.url,
        // Hardware paths currently choose their own nonce. Trust theirs only
        // once an acknowledged response supplies it.
        nonce: [
          PaliKeyringAccountType.HDAccount,
          PaliKeyringAccountType.Imported,
        ].includes(context.account.type)
          ? nonce
          : undefined,
      };
      const reservationWrite = writeInfrastructureJournal(context, reservation);
      try {
        await this.infrastructureDeadline(reservationWrite);
      } catch (error) {
        // No sender has been invoked. Storage may finish after its deadline;
        // release only this unsent attempt once the write actually settles.
        const clearUnsentAttempt = () =>
          clearInfrastructureJournal(context, reservation, null);
        void reservationWrite
          .then(clearUnsentAttempt, clearUnsentAttempt)
          .catch(() => undefined);
        throw error;
      }
      this.pendingInfrastructure.set(context.chainId, reservation);
      let response: IEvmTransactionResponse;
      try {
        this.assertInfrastructureContext(context);
        response = await this.deps.sendAndSaveEthTransaction(
          command,
          false,
          context.account,
          metadata,
          {
            clearNavigation: false,
            persist: true,
            genericReviewId: feeReviewId,
            assertBeforeSign: () => this.assertInfrastructureContext(context),
            assertCurrentContext: () =>
              this.assertInfrastructureContext(context),
            onBroadcast: async (broadcast) => {
              const pending = {
                ...reservation,
                transactionHash: broadcast.hash,
                nonce:
                  Number.isSafeInteger(broadcast.nonce) && broadcast.nonce >= 0
                    ? broadcast.nonce
                    : reservation.nonce,
              };
              this.pendingInfrastructure.set(context.chainId, pending);
              await this.infrastructureDeadline(
                writeInfrastructureJournal(context, pending)
              );
            },
          }
        );
      } catch (error) {
        const hash = (error as any)?.transactionHash;
        if (hash) {
          const acknowledged = this.pendingInfrastructure.get(context.chainId);
          const pending = {
            ...reservation,
            ...(infrastructurePendingIdentity(acknowledged) ===
            reservation.attemptId
              ? acknowledged
              : {}),
            transactionHash: hash,
          };
          const acknowledgedNonce = (error as any)?.transactionNonce;
          if (Number.isSafeInteger(acknowledgedNonce) && acknowledgedNonce >= 0)
            pending.nonce = acknowledgedNonce;
          this.pendingInfrastructure.set(context.chainId, pending);
          // The broadcast callback may have failed its first storage write.
          // Retry this same acknowledged attempt before reporting the error;
          // permanent storage failure keeps the existing reservation closed.
          await this.infrastructureDeadline(
            writeInfrastructureJournal(context, pending)
          ).catch(() => undefined);
        }
        // Definite pre-broadcast rejection is safe to release. Ambiguous
        // transport failures retain the reservation across worker restarts.
        const transactionNotBroadcast = (error as any)?.transactionNotBroadcast;
        if (
          !hash &&
          (transactionNotBroadcast === true ||
            (transactionNotBroadcast === undefined &&
              ((error as any)?.code === 'ACTION_REJECTED' ||
                (error as any)?.code === 4001 ||
                // Keyring hardware signers use this error only when signing
                // fails, before their provider.sendTransaction call.
                ([
                  PaliKeyringAccountType.Trezor,
                  PaliKeyringAccountType.Ledger,
                ].includes(context.account.type) &&
                  /^Transaction Signature Failed\. Error: /.test(
                    (error as Error)?.message || ''
                  )) ||
                /insufficient funds|user rejected|user denied|denied transaction|rejected by user|wallet context changed|transaction blocked|target account .*not found/i.test(
                  (error as Error)?.message || ''
                ))))
        ) {
          const releaseRejectedAttempt = clearInfrastructureJournal(
            context,
            reservation,
            null
          ).then(() => {
            // A successful clear may arrive after its deadline. Settle the
            // same unsent in-memory attempt then, without touching a retry.
            if (
              infrastructurePendingIdentity(
                this.pendingInfrastructure.get(context.chainId)
              ) === reservation.attemptId
            )
              this.pendingInfrastructure.delete(context.chainId);
          });
          await this.infrastructureDeadline(releaseRejectedAttempt);
        }
        throw error;
      }
      const pending = {
        ...reservation,
        transactionHash: response.hash,
        nonce:
          Number.isSafeInteger(response.nonce) && response.nonce >= 0
            ? response.nonce
            : reservation.nonce,
      };
      this.pendingInfrastructure.set(context.chainId, pending);
      // One explicit confirmation authorizes one exact deployment envelope.
      feeReviewId = undefined;
      nextNonce = nonce + 1;
      const deadline = Date.now() + 15000;
      let receipt: any;
      do {
        receipt = await this.infrastructureDeadline(
          context.provider.getTransactionReceipt(response.hash),
          Math.max(1, Math.min(1800, deadline - Date.now()))
        ).catch(() => null);
        if (receipt && !validInfrastructureReceipt(receipt, response.hash))
          throw new Error(DEPLOYMENT_RECEIPT_ERROR);
        if (receipt) break;
        if (Date.now() >= deadline) return { deployed, skipped, pending };
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (true);
      await this.infrastructureDeadline(
        clearInfrastructureJournal(context, pending, null)
      );
      if (
        infrastructurePendingIdentity(
          this.pendingInfrastructure.get(context.chainId)
        ) === infrastructurePendingIdentity(pending)
      )
        this.pendingInfrastructure.delete(context.chainId);
      if (Number(receipt.status) !== 1)
        throw new Error(
          `${contract.displayName} deployment failed. Refresh status before retrying.`
        );
      deployed.push(contract.id);
      if (contract.id === 'multicall3')
        clearMulticall3AddressCache(context.chainId);
    }
    await this.readInfrastructureStatus(context, assertCurrent);
    return { deployed, skipped };
  }

  public async prepareSmartAccount(params: {
    accountIndex?: number;
    authenticator: PaliSmartAccountAuthenticatorSetup;
    label?: string;
  }) {
    await this.assertSmartAccountSupported();
    const { activeNetwork } = store.getState().vault;
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const authenticator = this.buildAuthenticatorForCreation(
      activeNetwork.chainId,
      params.authenticator
    );
    const factoryAddress = getPaliSmartAccountFactoryAddress(
      activeNetwork.chainId
    );
    const descriptor = this.deriveSmartAccountDescriptor(
      params.accountIndex ??
        this.getNextRecoverableAccountIndex(activeNetwork.chainId),
      activeNetwork.chainId,
      this.getWalletManagementAddress()
    );
    const metadata: ISmartAccountMetadata = {
      ...authenticator.metadata,
      auth: authenticator.auth,
      availableModules: getAvailablePaliModules(activeNetwork.chainId),
      chainId: activeNetwork.chainId,
      contractVersion: PALI_SMART_ACCOUNT_VERSION,
      deploymentAuth: {
        data: authenticator.auth.data,
        validator: authenticator.auth.validator,
      },
      deploymentSalt: descriptor.deploymentSalt,
      descriptor,
      factoryAddress,
      isDeployed: false,
    };

    const accountParams = {
      initData: authenticator.auth.data,
      initialValidator: authenticator.auth.validator,
      salt: descriptor.deploymentSalt,
    };
    const smartAccount = await toPaliSmartAccount({
      auth: authenticator.auth,
      chainId: activeNetwork.chainId,
      deploySalt: descriptor.deploymentSalt,
      factoryAddress,
      provider,
    });
    const { factoryData: deploymentCalldata } =
      await smartAccount.getFactoryArgs();

    return {
      accountParams,
      address: smartAccount.address,
      deploymentCalldata,
      factoryAddress: metadata.factoryAddress,
      metadata,
    };
  }

  public captureSmartAccountBootstrap(assertOwner: () => void) {
    assertOwner();
    const context = this.infrastructureContext();
    const managementOwner = this.getWalletManagementAddress();
    const assertCurrent = () => {
      assertOwner();
      if (
        !this.sameInfrastructureContext(
          this.infrastructureContext(),
          context
        ) ||
        this.getWalletManagementAddress() !== managementOwner
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    return {
      assertCurrent,
      deriveAccount: (accountIndex: number) =>
        this.deriveSmartAccountRecord(
          accountIndex,
          context,
          managementOwner,
          assertCurrent
        ),
    };
  }

  private async deriveSmartAccountRecord(
    accountIndex: number,
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    managementOwner: string,
    assertCurrent: () => void
  ) {
    return deriveDefaultSmartAccount({
      accountIndex,
      chainId: context.chainId,
      managementAddress: managementOwner,
      provider: context.provider,
      assertInfrastructureSupported: () =>
        this.assertInfrastructureSupported(context, assertCurrent),
      assertCurrent,
    });
  }

  public async registerSmartAccountOnChain(
    params: {
      accountId: number;
      expectedContext?: IEvmTransactionContext;
    },
    sourceAuthority: SmartAccountControllerAuthority
  ) {
    let mayHaveSubmitted = false;
    try {
      const context = this.infrastructureContext();
      const assertCurrent = () => {
        if (
          !sourceAuthority ||
          !['document', 'worker'].includes(sourceAuthority.kind)
        )
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
        assertSynchronousEvmFeeGuard(sourceAuthority.assertCurrent);
        if (sourceAuthority.signal.aborted)
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
        try {
          this.assertInfrastructureContext(context);
          if (params.expectedContext) {
            this.assertExpectedExecutionContext(
              params.expectedContext,
              params.accountId
            );
          }
        } catch {
          throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
            transactionNotBroadcast: true,
          });
        }
      };
      assertCurrent();
      const active = this.getSmartAccountById(params.accountId);
      const metadata = active.metadata;
      const accountAddress = getAddress(active.account.address);
      if (this.pendingDeploymentAddresses.has(accountAddress)) {
        mayHaveSubmitted = true;
        throw new Error('Smart account registration is already pending.');
      }
      if (!metadata.descriptor) {
        throw new Error(
          'Smart account descriptor is required for deterministic deployment'
        );
      }
      const provider = this.ethereumTransaction?.web3Provider;
      if (!provider) {
        throw new Error(PROVIDER_UNAVAILABLE_ERROR);
      }

      const deploymentState = await readSmartAccountDeploymentState({
        account: active.account,
        chainId: context.chainId,
        provider,
        assertCurrent,
      });
      if (deploymentState === 'undeployed') {
        if (!metadata.auth) {
          throw new Error(
            'Smart account initial authenticator metadata is required for deployment'
          );
        }
        // The factory gates createAccount on EntryPoint.senderCreator(), so
        // explicit registration is a no-op UserOp whose initCode deploys the
        // account through the canonical ERC-4337 path. The op is signed in the
        // background with the account's local ECDSA owners (fresh accounts
        // always carry the ECDSA bootstrap validator); other validator kinds
        // deploy lazily with their first UI-signed execution.
        this.pendingDeploymentAddresses.add(accountAddress);
        let response: IEvmTransactionResponse;
        try {
          const prepared = await this.prepareSmartAccountExecutions(
            [{ data: '0x', target: accountAddress, value: '0x0' }],
            params.accountId,
            { expectedContext: params.expectedContext }
          );
          assertCurrent();
          const signature = await this.signActionHashWithLocalEcdsaOwners(
            metadata,
            prepared.actionHash,
            prepared.executionContextId,
            sourceAuthority
          );
          assertCurrent();
          mayHaveSubmitted = true;
          response = await this.submitSmartAccountExecution(
            {
              accountId: params.accountId,
              expectedContext: params.expectedContext,
              executionContextId: prepared.executionContextId,
              executions: prepared.executions,
              gasPayer: prepared.gasPayer,
              maxFeePerGas: prepared.maxFeePerGas,
              signature,
              skipRapidPolling: true,
              userOperation: prepared.userOperation,
              waitForConfirmation: true,
            },
            sourceAuthority.assertCurrent,
            sourceAuthority.confirmFee
          );
        } finally {
          this.pendingDeploymentAddresses.delete(accountAddress);
        }
        // Publication has completed. A new selection/session must not receive
        // the old account's metadata, but it cannot erase its accepted hash.
        const acknowledged = {
          address: accountAddress,
          metadata,
          transaction: response,
        };
        try {
          assertCurrent();
        } catch {
          return acknowledged;
        }
        this.invalidateHydratedMetadata(accountAddress);
        let hydratedMetadata: ISmartAccountMetadata;
        try {
          hydratedMetadata = await this.hydrateSmartAccountMetadata(
            active.account,
            { forceRefresh: true }
          );
          assertCurrent();
        } catch {
          return acknowledged;
        }
        store.dispatch(
          setAccountPropertyByIdAndType({
            id: active.account.id,
            property: 'smartAccount',
            type: PaliKeyringAccountType.SmartAccount,
            value: hydratedMetadata,
          })
        );
        try {
          await this.deps.saveWalletState(
            'register-smart-account-on-chain',
            true,
            true
          );
        } catch {
          return { ...acknowledged, metadata: hydratedMetadata };
        }

        return {
          address: accountAddress,
          metadata: hydratedMetadata,
          transaction: response,
        };
      }

      const hydratedMetadata = await this.hydrateSmartAccountMetadata(
        active.account
      );
      assertCurrent();
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: active.account.id,
          property: 'smartAccount',
          type: PaliKeyringAccountType.SmartAccount,
          value: hydratedMetadata,
        })
      );
      await this.deps.saveWalletState(
        'refresh-already-registered-smart-account',
        true,
        true
      );

      return {
        address: accountAddress,
        metadata: hydratedMetadata,
        transaction: null,
      };
    } catch (error) {
      // The submission helper can prefund before handleOps. After entering it
      // (or finding another live registration), retain its outcome unchanged.
      if (mayHaveSubmitted) throw error;
      const preflightError = new Error(
        typeof error?.message === 'string'
          ? error.message
          : 'Smart account registration preflight failed'
      );
      if (typeof error?.code === 'number')
        Object.assign(preflightError, { code: error.code });
      throw Object.assign(preflightError, { transactionNotBroadcast: true });
    }
  }

  private buildAuthenticatorForCreation(
    chainId: number,
    authenticator: PaliSmartAccountAuthenticatorSetup
  ): SmartAccountAuthenticatorBuildResult {
    switch (authenticator.id) {
      case 'p256-webauthn': {
        return buildP256WebAuthnAuthenticator({
          chainId,
          config: authenticator.config,
        });
      }
      case 'slh-dsa': {
        return buildSLHDSAAuthenticator({
          chainId,
          config: authenticator.config,
        });
      }
      case 'ecdsa': {
        const owners = authenticator.config.owners.map((owner) =>
          getAddress(owner)
        );
        const threshold = authenticator.config.threshold || 1;
        const validator = getConfiguredAuthenticatorAddress(chainId, 'ecdsa');
        const data = encodeEcdsaValidatorInitData(owners, threshold);

        return {
          auth: {
            data,
            module: 'ecdsa',
            validator,
          },
          metadata: {
            installedModules: [
              {
                address: getAddress(validator),
                config: {
                  owners,
                  threshold,
                },
                data,
                id: 'ecdsa',
                type: 'validator',
              },
            ],
          },
        };
      }
      case 'composite':
        throw new Error(
          'Composite cannot be the initial smart-account authenticator because its child validators must be installed first.'
        );
      default: {
        const exhaustive: never = authenticator;
        return exhaustive;
      }
    }
  }

  private deriveSmartAccountDescriptor(
    accountIndex: number,
    chainId: number,
    managementAddress: string
  ): NonNullable<ISmartAccountMetadata['descriptor']> {
    return getPaliSmartAccountDescriptor({
      accountIndex,
      accountVersion: PALI_SMART_ACCOUNT_VERSION,
      anchor: `pali:eip155:${chainId}:${managementAddress.toLowerCase()}:smart-account-v1`,
      chainId,
      factoryAddress: getPaliSmartAccountFactoryAddress(chainId),
    });
  }

  public async hydrateSmartAccount(
    accountId: number,
    expectedContext?: IEvmTransactionContext
  ): Promise<ISmartAccountMetadata> {
    const context = this.infrastructureContext();
    const walletGeneration = this.deps.getWalletStateGeneration();
    if (expectedContext)
      this.assertExpectedExecutionContext(expectedContext, undefined, false);
    const requested = this.getSmartAccountById(accountId);
    getAddress(requested.account.address);
    if (
      requested.account.id !== accountId ||
      requested.metadata.chainId !== context.chainId
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const authKey = ({ auth }: ISmartAccountMetadata) =>
      auth
        ? JSON.stringify([
            auth.module,
            auth.validator?.toLowerCase(),
            auth.data?.toLowerCase(),
          ])
        : '[null,null,null]';
    const requestedAuth = authKey(requested.metadata);
    const assertRequest = () => {
      this.assertInfrastructureContext(context);
      if (expectedContext)
        this.assertExpectedExecutionContext(expectedContext, undefined, false);
      const current = this.getSmartAccountById(accountId);
      if (
        this.deps.getWalletStateGeneration() !== walletGeneration ||
        !this.sameSmartAccountTarget(current, requested) ||
        current.metadata.chainId !== requested.metadata.chainId ||
        authKey(current.metadata) !== requestedAuth
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      return current;
    };
    const key = this.getHydrationKey(requested.account);
    const previousEntry = this.explicitHydrations.get(key);
    const previous =
      previousEntry &&
      previousEntry.walletGeneration === walletGeneration &&
      this.sameInfrastructureContext(previousEntry.context, context)
        ? previousEntry.promise
        : undefined;
    const hydration = (async () => {
      // Serialize the complete read+commit, not only the RPC fetch. Joining a
      // prior read could reuse pre-change state; overlapping commits otherwise
      // reject a harmless second refresh on metadata identity alone.
      if (previous) await previous.catch(() => undefined);
      const active = assertRequest();
      const metadata = await this.hydrateSmartAccountMetadata(active.account, {
        forceRefresh: true,
      });
      assertRequest();
      await this.persistSmartAccountMetadata(
        accountId,
        metadata,
        expectedContext,
        active
      );
      return metadata;
    })();
    const entry = { context, walletGeneration, promise: hydration };
    this.explicitHydrations.set(key, entry);
    try {
      return await hydration;
    } finally {
      if (this.explicitHydrations.get(key) === entry)
        this.explicitHydrations.delete(key);
    }
  }

  /**
   * Trustless preflight for a bring-your-own validator install: code at the
   * address, ERC-7579 isModuleType(1) self-report, duplicate check.
   */
  public async preflightSmartAccountCustomValidator(params: {
    accountId: number;
    address: string;
  }): Promise<CustomValidatorPreflightResult> {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const metadata = await this.hydrateSmartAccount(params.accountId);
    return preflightCustomValidatorInstall(provider, {
      address: params.address,
      chainId: metadata.chainId,
      metadata,
    });
  }

  /**
   * Persists a bring-your-own module record after a successful on-chain
   * install so hydration probes the address from now on.
   */
  public async addSmartAccountCustomModule(params: {
    accountId: number;
    expectedContext?: IEvmTransactionContext;
    record: SmartAccountCustomModuleRecord;
  }): Promise<ISmartAccountMetadata> {
    const address = getAddress(params.record.address);
    return this.persistSmartAccountMetadata(
      params.accountId,
      (current) => ({
        ...current,
        customModules: (current.customModules || []).some(
          (record) => record.address.toLowerCase() === address.toLowerCase()
        )
          ? current.customModules
          : [...(current.customModules || []), { ...params.record, address }],
      }),
      params.expectedContext
    );
  }

  /** Drops a bring-your-own module record (after on-chain uninstall). */
  public async removeSmartAccountCustomModule(params: {
    accountId: number;
    address: string;
    expectedContext?: IEvmTransactionContext;
  }): Promise<ISmartAccountMetadata> {
    return this.persistSmartAccountMetadata(
      params.accountId,
      (current) => ({
        ...current,
        customModules: (current.customModules || []).filter(
          (record) =>
            record.address.toLowerCase() !== params.address.toLowerCase()
        ),
      }),
      params.expectedContext
    );
  }

  public async getSmartAccountNativeGasStatus(params: {
    accountId: number;
  }): Promise<{
    balance: string;
    gasUnitsReserve: string;
    hasNativeGas: boolean;
    hasZkSysGasTankGas: boolean;
    requiredBalance: string;
  }> {
    const active = this.getSmartAccountById(params.accountId);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }

    const entryPointAddress = getPaliEntryPointAddress(active.metadata.chainId);
    const entryPoint = new Contract(
      entryPointAddress,
      PALI_ENTRYPOINT_V09_ABI,
      provider
    );
    const [nativeBalance, rawEntryPointDeposit, feeData] = await Promise.all([
      provider.getBalance(active.account.address),
      entryPoint.balanceOf(active.account.address),
      provider.getFeeData(),
    ]);
    // The EntryPoint draws prefunds from the account's deposit before its
    // native balance, and refunds unused prefund (e.g. from the deployment
    // op) back to the deposit -- both are spendable for userOp gas.
    const balance = toCompatBigNumber(nativeBalance).add(
      toCompatBigNumber(rawEntryPointDeposit)
    );
    const maxFeePerGas = BigNumber.from(
      feeData.maxFeePerGas || feeData.gasPrice || 0
    );
    // Worst-case reserve for this account's validator profile; always >= the
    // limits the userOp builder will sign for a simple execution.
    const gasUnitsReserve = getSmartAccountGasUnitsReserve(active.metadata);
    const requiredBalance = gasUnitsReserve.mul(maxFeePerGas);
    const primaryGasPayer = this.getWalletGasPayerCandidates(
      active.metadata.deploymentGasPayer
    )[0];
    const statusGasEstimate = {
      callGasLimit: 0,
      preVerificationGas: 0,
      totalGasUnits: gasUnitsReserve.toNumber(),
      verificationGasLimit: 0,
    };
    const hasZkSysGasTankGas = primaryGasPayer
      ? await this.canUseZkSysGasTankForSmartAccountTx(provider, {
          chainId: active.metadata.chainId,
          gasEstimate: statusGasEstimate,
          gasPayerAddress: primaryGasPayer.address,
          maxFeePerGas,
        })
      : false;

    return {
      balance: balance.toString(),
      gasUnitsReserve: gasUnitsReserve.toString(),
      hasZkSysGasTankGas,
      hasNativeGas: maxFeePerGas.isZero()
        ? !balance.isZero()
        : balance.gte(requiredBalance),
      requiredBalance: requiredBalance.toString(),
    };
  }

  public async prepareSmartAccountExecution(params: {
    accountId?: number;
    data?: string;
    target: string;
    value: string;
  }) {
    return this.prepareSmartAccountExecutions([params], params.accountId);
  }

  public async prepareSmartAccountExecutions(
    params: Array<{ data?: string; target: string; value: string }>,
    accountId?: number,
    options: {
      expectedContext?: IEvmTransactionContext;
      expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
      feeOverrides?: {
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
      includePayerBudget?: true;
      useCachedMetadata?: boolean;
    } = {},
    cancellation?: SmartAccountCancellation
  ) {
    if (cancellation) assertSmartAccountCancellation(cancellation);
    const includePayerBudget =
      !cancellation && options.includePayerBudget === true;
    if (options.expectedContext)
      this.assertExpectedExecutionContext(options.expectedContext, accountId);
    const feeOverrides = { ...options.feeOverrides };
    const expectedErc20Transfers = snapshotSmartAccountExpectedErc20Transfers(
      options.expectedErc20Transfers
    );
    getExplicitSmartAccountGasPrice(feeOverrides);
    const snapshot = this.infrastructureContext();
    const assertContext = () => {
      try {
        this.assertInfrastructureContext(snapshot);
      } catch {
        throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
          transactionNotBroadcast: true,
        });
      }
      if (options.expectedContext)
        this.assertExpectedExecutionContext(options.expectedContext, accountId);
    };
    await this.assertSmartAccountExecutionTargetsAllowed(params, assertContext);
    assertContext();

    const useCachedMetadata = options.useCachedMetadata !== false;
    let active = useCachedMetadata
      ? Number.isInteger(accountId)
        ? this.getSmartAccountById(accountId as number)
        : this.getActiveSmartAccount()
      : Number.isInteger(accountId)
      ? await this.getHydratedSmartAccountById(accountId as number)
      : await this.getHydratedActiveSmartAccount();
    assertContext();
    if (active.metadata.chainId !== snapshot.chainId)
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    const rawProvider = this.ethereumTransaction?.web3Provider;
    if (!rawProvider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    // Hydration may return a detached, newer public configuration. Lifetime
    // ownership is bound to the original local record, not that detached view.
    const localSource = this.getSmartAccountById(active.account.id).metadata;
    const localSourceConfiguration = JSON.stringify({
      auth: localSource.auth,
      installedModules: localSource.installedModules,
    });
    const savedPendingRecords =
      await this.deps.captureSmartAccountPendingRecords(
        snapshot.chainId,
        active.account.address,
        assertContext
      );
    if (
      cancellation &&
      (cancellation.account !== getAddress(active.account.address) ||
        cancellation.chainId !== snapshot.chainId)
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const pendingRecords = cancellation
      ? smartAccountCancellationPendingRecords(
          savedPendingRecords,
          cancellation,
          assertContext
        )
      : savedPendingRecords;
    let authorizationAnchor: { hash: string; number: string } | undefined;
    let feeDisplayBlock:
      | import('../../../../shared/evmDappPreparation').EvmDappFeeDisplayBlock
      | undefined;
    let cancellationPayer:
      | Awaited<ReturnType<typeof inspectSmartAccountCancellationPayer>>
      | undefined;
    let payerPrefund = BigInt(0);
    const sourceMetadata = active.metadata;
    let hydratedMetadata: ISmartAccountMetadata | undefined;
    const prepared = await withEvmReadPhase(
      rawProvider,
      assertContext,
      async (scopedProvider) => {
        const pending = createSmartAccountPendingState(
          scopedProvider,
          pendingRecords,
          snapshot.chainId,
          active.account.address,
          assertContext,
          undefined,
          false,
          cancellation ? 'latest' : 'pending'
        );
        const provider = pending.provider;
        const deployed =
          (await readSmartAccountDeploymentState({
            account: { ...active.account, smartAccount: active.metadata },
            chainId: snapshot.chainId,
            provider,
            assertCurrent: assertContext,
          })) === 'deployed';
        if (
          deployed &&
          (!active.metadata.isDeployed ||
            !hasUsableSmartAccountAuthMetadata(active.metadata))
        ) {
          const key = `execution:${this.getHydrationKey(active.account)}`;
          const cached = this.hydratedMetadataCache.get(key);
          const reusable =
            cached &&
            cached.sourceMetadata === sourceMetadata &&
            cached.executionContext &&
            this.sameInfrastructureContext(cached.executionContext, snapshot) &&
            Date.now() - cached.timestamp < HYDRATED_METADATA_TTL_MS;
          active = {
            ...active,
            metadata: reusable
              ? cached.metadata
              : await readSmartAccountValidatorMetadata({
                  account: { ...active.account, smartAccount: active.metadata },
                  chainId: snapshot.chainId,
                  provider,
                  assertCurrent: assertContext,
                }),
          };
          assertContext();
          if (!reusable) hydratedMetadata = active.metadata;
        }
        const useDeployedMetadata =
          deployed &&
          active.metadata.isDeployed &&
          hasUsableSmartAccountAuthMetadata(active.metadata);
        if (!useDeployedMetadata) {
          await this.assertInfrastructureSupported(snapshot, assertContext);
          assertContext();
        }
        cancellationPayer = cancellation
          ? await inspectSmartAccountCancellationPayer(
              cancellation,
              provider,
              assertContext
            )
          : undefined;
        const result = await prepareSmartAccountOperation({
          account: { ...active.account, smartAccount: active.metadata },
          chainId: snapshot.chainId,
          executions: params,
          expectedErc20Transfers,
          feeOverrides: cancellationPayer?.replaceOuter
            ? cancellationPayer.feeOverrides
            : feeOverrides,
          knownDeployed: useDeployedMetadata,
          provider,
          pending,
          assertCurrent: assertContext,
          selectGasPayer: async (gasEstimate, maxFeePerGas) => {
            if (cancellationPayer?.replaceOuter) {
              const payer = cancellationPayer.payer;
              const account =
                store.getState().vault.accounts[
                  payer.type as PaliKeyringAccountType
                ]?.[payer.id];
              if (
                !account ||
                getAddress(account.address) !== getAddress(payer.address) ||
                account.isSmartAccount
              )
                throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
              const gasPayer = await this.getWalletGasPayerAccount(
                provider,
                payer as SmartAccountGasPayer,
                undefined,
                { requirePreferred: true }
              );
              assertContext();
              const useGasTank = await this.canUseZkSysGasTankForSmartAccountTx(
                provider,
                {
                  chainId: snapshot.chainId,
                  gasEstimate,
                  gasPayerAddress: gasPayer.address,
                  maxFeePerGas,
                }
              );
              assertContext();
              return { gasPayer, useGasTank };
            }
            const primaryGasPayer = this.getWalletGasPayerCandidates(
              active.metadata.deploymentGasPayer
            )[0];
            const useGasTank = primaryGasPayer
              ? await this.canUseZkSysGasTankForSmartAccountTx(provider, {
                  chainId: active.metadata.chainId,
                  gasEstimate,
                  gasPayerAddress: primaryGasPayer.address,
                  maxFeePerGas,
                })
              : false;
            assertContext();
            const gasPayer = useGasTank
              ? {
                  address: primaryGasPayer.address,
                  id: primaryGasPayer.id,
                  type: primaryGasPayer.type,
                }
              : await this.getWalletGasPayerAccount(
                  provider,
                  active.metadata.deploymentGasPayer
                );
            assertContext();
            return { gasPayer, useGasTank };
          },
        });
        if (cancellation)
          assertSmartAccountCancellationOperation(
            cancellation,
            result.userOperation,
            result.validator
          );
        if (
          (cancellation || includePayerBudget) &&
          result.userOperation.initCode !== '0x' &&
          !getSmartAccountUserOpRequiredPrefund(result.userOperation).isZero()
        ) {
          const shortfall = await readSmartAccountDeploymentShortfall(
            provider,
            active.account.address,
            getPaliEntryPointAddress(snapshot.chainId),
            result.userOperation,
            assertContext
          );
          if (shortfall.gt(0)) payerPrefund = BigInt(shortfall.toString());
        }
        const anchor = await provider.send('eth_getBlockByNumber', [
          'latest',
          false,
        ]);
        assertContext();
        authorizationAnchor = {
          hash: readEvmRpcHash(anchor?.hash),
          number: readEvmRpcQuantity(anchor?.number).toString(),
        };
        feeDisplayBlock = Object.freeze({
          number: '0x' + BigInt(authorizationAnchor.number).toString(16),
          hash: authorizationAnchor.hash,
          gasLimit: '0x' + readEvmRpcQuantity(anchor?.gasLimit).toString(16),
          baseFeePerGas:
            anchor?.baseFeePerGas === null ||
            anchor?.baseFeePerGas === undefined
              ? null
              : '0x' + readEvmRpcQuantity(anchor.baseFeePerGas).toString(16),
        });
        return result;
      }
    );
    assertContext();
    // Publish only after the read phase has passed its final chain/owner checks.
    if (hydratedMetadata) {
      const key = `execution:${this.getHydrationKey(active.account)}`;
      this.hydratedMetadataCache.delete(key);
      this.hydratedMetadataCache.set(key, {
        executionContext: snapshot,
        metadata: hydratedMetadata,
        sourceMetadata,
        timestamp: Date.now(),
      });
      if (this.hydratedMetadataCache.size > 128)
        this.hydratedMetadataCache.delete(
          this.hydratedMetadataCache.keys().next().value!
        );
    }
    const { actionHash, userOperation } = prepared;
    assertContext();
    for (const [id, context] of this.executionContexts)
      if (context.expiresAt <= Date.now()) this.executionContexts.delete(id);
    while (this.executionContexts.size >= 128)
      this.executionContexts.delete(this.executionContexts.keys().next().value);
    const executionContextId = uuidv4();
    const expiresAt = Date.now() + SMART_ACCOUNT_EXECUTION_LIFETIME_MS;
    const gasUnits = BigNumber.from(
      hexDataSlice(userOperation.accountGasLimits, 0, 16)
    )
      .add(BigNumber.from(hexDataSlice(userOperation.accountGasLimits, 16, 32)))
      .add(BigNumber.from(userOperation.preVerificationGas))
      .toString();
    const payerBudget =
      cancellation || includePayerBudget
        ? getSmartAccountPayerBudget({
            chainId: snapshot.chainId,
            blockGasLimit: BigInt(feeDisplayBlock!.gasLimit),
            operationGas: BigInt(gasUnits),
            feeRate: BigInt(prepared.gasPrice ?? prepared.maxFeePerGas!),
            prefund: payerPrefund,
            gasTank:
              Boolean(getZkSysGasTankAddress(snapshot.chainId)) &&
              userOperation.gasFees === SMART_ACCOUNT_ZERO_GAS_FEES,
          })
        : undefined;
    const entryPointFeeQuote = Object.freeze({
      executionContextId,
      feePayer: Object.freeze({
        ...prepared.gasPayer,
      }) as SmartAccountFeeQuote['feePayer'],
      gasUnits,
      maximumFeeWei:
        getSmartAccountUserOpRequiredPrefund(userOperation).toString(),
      ...(cancellation ? { cancellationPayerBudget: payerBudget } : {}),
      ...(includePayerBudget ? { payerBudget } : {}),
    });
    const proposal = captureCompositePolicyChange({
      accountAddress: active.account.address,
      metadata: prepared.smartAccount,
      executions: prepared.executions,
    });
    const compositePossession = proposal
      ? {
          proposal,
          challenge: createCompositePolicyPossession({
            proposal,
            accountAddress: active.account.address,
            chainId: snapshot.chainId,
            executionContextId,
            preparedActionHash: actionHash,
            expiresAt,
            nonce: randomBytes32Hex(),
          }),
          sourceMetadata: localSourceConfiguration,
          proofs: new Map<
            string,
            { signature: string; verification: Promise<boolean> }
          >(),
          accepted: false,
        }
      : undefined;
    if (compositePossession) {
      const current = this.getSmartAccountById(active.account.id).metadata;
      if (
        JSON.stringify({
          auth: current.auth,
          installedModules: current.installedModules,
        }) !== localSourceConfiguration
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    }
    this.executionContexts.set(executionContextId, {
      accountId: active.account.id,
      actionHash,
      purpose: 'user-operation',
      expiresAt,
      entryPointFeeQuote,
      entryPointFeeApproved: false,
      entryPointFeeConsumed: false,
      ...(compositePossession ? { compositePossession } : {}),
      gasPrice: prepared.gasPrice,
      snapshot,
      authorizationAnchor,
      feeDisplayBlock,
      ...(cancellation
        ? {
            cancellation,
            replaceOuter: Boolean(cancellationPayer?.replaceOuter),
          }
        : {}),
      userOperation: Object.freeze({ ...userOperation }),
      prepared,
      executionIntent: JSON.stringify({
        executions: params.map(({ target, data, value }) => ({
          target: getAddress(target),
          data: data || '0x',
          value: BigInt(value).toString(),
        })),
        feeOverrides,
        expectedErc20Transfers,
      }),
      pending: createSmartAccountPendingState(
        rawProvider,
        pendingRecords,
        snapshot.chainId,
        active.account.address,
        assertContext,
        undefined,
        false,
        cancellation ? 'latest' : 'pending'
      ),
    });
    return {
      ...prepared,
      accountId: active.account.id,
      executionContextId,
      entryPointFeeQuote,
      ...(cancellation
        ? {
            operationCancellation: {
              originalHash: cancellation.referenceHash,
              originalKind: cancellation.originalKind,
              operationHash: cancellation.authorization.operationHash,
              operationNonce: cancellation.authorization.operationNonce,
            },
          }
        : {}),
      ...(compositePossession
        ? { requiresCompositePossession: true as const }
        : {}),
    };
  }

  public async prepareSmartAccountCancellation(
    cancellation: SmartAccountCancellation,
    accountId: number,
    options: { expectedContext: IEvmTransactionContext }
  ) {
    assertSmartAccountCancellation(cancellation);
    const prepared = await this.prepareSmartAccountExecutions(
      smartAccountCancellationExecutions(cancellation),
      accountId,
      { ...options, useCachedMetadata: false },
      cancellation
    );
    return { ...prepared, accountAddress: cancellation.account };
  }

  public reuseSmartAccountExecutions(
    executions: Array<{ data?: string; target: string; value: string }>,
    accountId: number | undefined,
    options: {
      executionContextId: string;
      expectedContext?: IEvmTransactionContext;
      expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
      feeOverrides?: {
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
    }
  ) {
    this.assertSmartAccountExecutionContext(options.executionContextId);
    if (options.expectedContext)
      this.assertExpectedExecutionContext(options.expectedContext, accountId);
    const context = this.executionContexts.get(options.executionContextId)!;
    const intent = JSON.stringify({
      executions: executions.map(({ target, data, value }) => ({
        target: getAddress(target),
        data: data || '0x',
        value: BigInt(value).toString(),
      })),
      feeOverrides: options.feeOverrides || {},
      expectedErc20Transfers: snapshotSmartAccountExpectedErc20Transfers(
        options.expectedErc20Transfers
      ),
    });
    if (
      !context.prepared ||
      context.executionIntent !== intent ||
      (accountId !== undefined && accountId !== context.accountId)
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    return {
      ...context.prepared,
      accountId: context.accountId,
      executionContextId: options.executionContextId,
      entryPointFeeQuote: context.entryPointFeeQuote,
      ...(context.cancellation
        ? {
            operationCancellation: {
              originalHash: context.cancellation.referenceHash,
              originalKind: context.cancellation.originalKind,
              operationHash: context.cancellation.authorization.operationHash,
              operationNonce: context.cancellation.authorization.operationNonce,
            },
          }
        : {}),
      ...(context.compositePossession
        ? { requiresCompositePossession: true as const }
        : {}),
    };
  }

  private async assertSmartAccountExecutionTargetsAllowed(
    executions: Array<{ data?: string; target: string }>,
    assertCurrent: () => void
  ): Promise<void> {
    const provider = this.ethereumTransaction?.web3Provider;
    for (const execution of executions) {
      const targets = await getBlacklistTargetsForEvmCallWithContractType({
        data: execution.data,
        to: getAddress(execution.target),
        web3Provider: provider,
      });

      await assertSmartAccountTargetsAllowed(
        targets,
        (address) => blacklistService.checkAddress(address),
        assertCurrent
      );
    }
  }

  public async submitSmartAccountExecution(
    params: SmartAccountSubmitParams,
    assertApprovalCurrent: () => void,
    confirmFee?: SmartAccountControllerAuthority['confirmFee'],
    allowWalletSendPayerBudget = false
  ) {
    const captured = this.infrastructureContext();
    const assertCurrent = () => {
      this.assertInfrastructureContext(captured);
      this.assertSmartAccountExecutionContext(params.executionContextId);
      this.assertCompositePossessionAccepted(params.executionContextId);
      assertSynchronousEvmFeeGuard(assertApprovalCurrent);
    };
    assertCurrent();
    this.assertExecutionFeeApproved(params.executionContextId);
    const executionContext = this.executionContexts.get(
      params.executionContextId
    )!;
    const { cancellation, pending } = executionContext;
    const feeQuote = executionContext.entryPointFeeQuote;
    const budget = feeQuote?.cancellationPayerBudget ?? feeQuote?.payerBudget;
    if (
      (feeQuote?.payerBudget && !allowWalletSendPayerBudget) ||
      ((cancellation || budget) &&
        (!budget ||
          !params.gasPayer ||
          params.gasPayer.id !== feeQuote!.feePayer.id ||
          params.gasPayer.type !== feeQuote!.feePayer.type ||
          params.gasPayer.address.toLowerCase() !==
            feeQuote!.feePayer.address.toLowerCase() ||
          params.maxFeePerGas !== executionContext.prepared?.maxFeePerGas ||
          params.maxPriorityFeePerGas !==
            executionContext.prepared?.maxPriorityFeePerGas))
    )
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    executionContext.entryPointFeeConsumed = true;
    if (!pending)
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    const confirmCurrentFee: SmartAccountControllerAuthority['confirmFee'] =
      confirmFee
        ? async (review) => {
            assertCurrent();
            const approved = await confirmFee(review);
            assertCurrent();
            return approved;
          }
        : undefined;
    const payerConsent = (purpose: 'fund' | 'submit') =>
      budget
        ? async (review: SmartAccountControllerFeeReview) => {
            assertCurrent();
            assertSmartAccountPayerFee(
              review,
              budget,
              {
                account: executionContext.userOperation!.sender,
                chainId: captured.chainId,
                payer: feeQuote!.feePayer.address,
                purpose,
              },
              cancellation
                ? 'Cancellation fee exceeds the reviewed limits'
                : SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED
            );
            return review.id;
          }
        : confirmCurrentFee;
    return submitSmartAccountOperation(
      params,
      {
        chainId: store.getState().vault.activeNetwork.chainId,
        provider: pending.provider,
        pending,
        retainAuthorization: async (userOperation, payer, guard) => {
          guard();
          const context = this.executionContexts.get(
            params.executionContextId
          )!;
          if (!context.authorizationAnchor)
            throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
          return this.deps.retainSmartAccountAuthorization(
            {
              chainId: captured.chainId,
              userOperation,
              payer: payer.address,
              observedAt: context.authorizationAnchor,
              ...(context.cancellation
                ? {
                    replacesOperationHash:
                      context.cancellation.authorization.operationHash,
                  }
                : {}),
            },
            guard
          );
        },
        assertExpectedExecutionContext: (context, id) =>
          this.assertExpectedExecutionContext(context, id),
        assertSmartAccountExecutionContext: (id) =>
          this.assertSmartAccountExecutionContext(id),
        getExecutionContext: (id) => {
          const context = this.executionContexts.get(id);
          return context?.userOperation
            ? {
                ...context,
                userOperation: context.userOperation,
                expectedErc20Transfers:
                  context.prepared?.expectedErc20Transfers,
              }
            : undefined;
        },
        getSmartAccountById: (id) => this.getSmartAccountById(id),
        getWalletGasPayerAccount: (preferred, transaction, options) =>
          this.getWalletGasPayerAccount(
            pending.provider,
            preferred,
            transaction,
            options
          ),
        getLocalNativeExecutionRecipients: (executions) =>
          this.getLocalNativeExecutionRecipients(executions),
        ensureDeploymentPrefund: (...args) =>
          this.ensureSmartAccountDeploymentPrefund(
            ...args,
            pending.provider,
            payerConsent('fund')
          ),
        sendTransaction: (transaction, legacy, target, metadata, options) =>
          this.deps.sendAndSaveEthTransaction(
            transaction,
            legacy,
            target,
            metadata,
            {
              ...options,
              confirmFee: payerConsent('submit'),
            }
          ),
        invalidateMetadata: (address) =>
          this.invalidateHydratedMetadata(address),
      },
      assertCurrent
    );
  }

  private async canUseZkSysGasTankForSmartAccountTx(
    provider: any,
    params: {
      chainId: number;
      gasEstimate: SmartAccountUserOpGasEstimate;
      gasPayerAddress: string;
      maxFeePerGas: BigNumber;
    }
  ) {
    return canUseSmartAccountGasTank(provider, params);
  }

  /**
   * Ensures the (counterfactual) smart account can pay the EntryPoint
   * prefund for a deployment userOp. Counts both the account's native
   * balance and its existing EntryPoint deposit; any shortfall is topped
   * up with a plain transfer from the gas payer. Unused prefund is
   * credited back to the account's EntryPoint deposit after the op.
   */
  private async ensureSmartAccountDeploymentPrefund(
    accountAddress: string,
    userOperation: SmartAccountPackedUserOperation,
    entryPointAddress: string,
    gasPayer: { address: string; id: number; type: PaliKeyringAccountType },
    chainId: number,
    options: SmartAccountSubmissionChecks & {
      assertBeforeSign: () => void;
      assertCurrentContext: () => void;
      onAcknowledged: () => void;
      onSubmissionAttempt: () => void;
    },
    provider: any,
    confirmFee?: SmartAccountControllerAuthority['confirmFee']
  ): Promise<void> {
    return ensureSmartAccountDeploymentPrefund(
      provider,
      (transaction, legacy, target, metadata, saveOptions) =>
        this.deps.sendAndSaveEthTransaction(
          transaction,
          legacy,
          target,
          metadata,
          {
            ...saveOptions,
            confirmFee,
          }
        ),
      accountAddress,
      userOperation,
      entryPointAddress,
      gasPayer,
      chainId,
      options
    );
  }

  private getLocalNativeExecutionRecipients(
    executions: SmartAccountExecution[]
  ): Array<{ id: number; type: PaliKeyringAccountType }> {
    const { accounts } = store.getState().vault;
    const recipientAddresses = new Set<string>();

    executions.forEach((execution) => {
      try {
        if (BigNumber.from(execution.value || '0').isZero()) {
          return;
        }
        recipientAddresses.add(getAddress(execution.target));
      } catch {
        // Ignore malformed/non-address execution targets for local tx ownership.
      }
    });

    if (!recipientAddresses.size) {
      return [];
    }

    const localRecipients: Array<{ id: number; type: PaliKeyringAccountType }> =
      [];
    Object.values(PaliKeyringAccountType).forEach((type) => {
      Object.entries(accounts[type] || {}).forEach(
        ([id, account]: [string, any]) => {
          try {
            if (recipientAddresses.has(getAddress(account.address))) {
              localRecipients.push({ id: Number(id), type });
            }
          } catch {
            // Ignore accounts without an EVM-compatible address.
          }
        }
      );
    });

    return localRecipients;
  }

  public async prepareSmartAccountGuardianRegistration(params: unknown) {
    void params;
    throw new Error('Guardian setup is handled by recovery module templates');
  }

  public async getSmartAccountGuardianRecoveryStatus(
    params: {
      account: string;
      guardian?: string;
      guardianApproval?: 'ecdsa' | 'contract';
      intent?: GuardianRecoveryIntent;
      knownOperationId?: string;
    },
    signal?: AbortSignal
  ): Promise<
    GuardianRecoveryObservation & { recoveryTransactionHash?: string | null }
  > {
    const context = this.infrastructureContext();
    const account = getAddress(params.account);
    const intent = params.intent
      ? captureGuardianRecoveryIntent(params.intent)
      : undefined;
    if (intent) {
      const check = () => this.assertInfrastructureContext(context);
      if (
        intent.operation.account !== account ||
        intent.operation.chainId !== context.chainId ||
        !params.guardian ||
        !['ecdsa', 'contract'].includes(params.guardianApproval)
      )
        throw new Error(
          'Recovery intent belongs to a different account or network'
        );
      const verification = Object.freeze({
        kind: params.guardianApproval,
        guardian: getAddress(params.guardian),
      });
      const records = await this.deps.captureGuardianRecoveryTransactions(
        context.chainId,
        check
      );
      check();
      const recoveryTransactionHash = await pendingGuardianRecoveryTransaction(
        intent.operation,
        verification,
        records,
        check
      );
      const observation = await this.readFreshGuardianRecoveryStatus(
        context,
        account,
        getGuardianRecoveryOperationId(intent.operation),
        check
      );
      check();
      return { ...observation, recoveryTransactionHash };
    }
    const knownOperationId = params.knownOperationId?.toLowerCase();
    if (knownOperationId && !/^0x[0-9a-f]{64}$/.test(knownOperationId))
      throw new Error('Invalid guardian recovery operation ID');
    const key = `${account.toLowerCase()}:${knownOperationId || ''}`;
    for (const [pendingKey, entry] of this.guardianObservations) {
      if (!this.sameInfrastructureContext(context, entry.context)) {
        entry.lifetime.dispose();
        this.guardianObservations.delete(pendingKey);
      }
    }
    if (signal?.aborted)
      throw signal.reason ?? new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    let entry = this.guardianObservations.get(key);
    if (!entry || entry.lifetime.signal.aborted) {
      const lifetime = this.guardianReadLifetime(() =>
        this.assertInfrastructureContext(context)
      );
      const current = {
        context,
        lifetime,
        subscribers: 0,
        settled: false,
        promise: null as ReturnType<typeof readGuardianRecoveryObservation>,
      };
      current.promise = this.readFreshGuardianRecoveryStatus(
        context,
        account,
        knownOperationId,
        lifetime.assertCurrent,
        lifetime.signal
      ).finally(() => {
        current.settled = true;
        lifetime.dispose();
        if (this.guardianObservations.get(key) === current)
          this.guardianObservations.delete(key);
      });
      this.guardianObservations.set(key, current);
      entry = current;
    }
    const observed = entry;
    observed.subscribers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const complete = (work: () => void) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', cancel);
        observed.lifetime.signal.removeEventListener('abort', retire);
        if (--observed.subscribers === 0) observed.lifetime.dispose();
        work();
      };
      const cancel = () =>
        complete(() =>
          reject(signal?.reason ?? new Error(EVM_TRANSACTION_CONTEXT_CHANGED))
        );
      const retire = () => {
        if (!observed.settled)
          complete(() => reject(new Error(EVM_TRANSACTION_CONTEXT_CHANGED)));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      observed.lifetime.signal.addEventListener('abort', retire, {
        once: true,
      });
      observed.promise.then(
        (value) =>
          complete(() => {
            try {
              this.assertInfrastructureContext(context);
              resolve(structuredClone(value));
            } catch (error) {
              reject(error);
            }
          }),
        (error) => complete(() => reject(error))
      );
      if (signal?.aborted) cancel();
      else if (observed.lifetime.signal.aborted) retire();
    });
  }

  private guardianReadLifetime(assertCurrent: () => void) {
    if (this.deps.captureReadLifetime)
      return this.deps.captureReadLifetime(assertCurrent);
    // The extension supplies session retirement in addition to this read lifetime.
    const controller = new AbortController();
    return {
      signal: controller.signal,
      assertCurrent: () => {
        assertCurrent();
        if (controller.signal.aborted)
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      },
      dispose: () => controller.abort(),
    };
  }

  private readFreshGuardianRecoveryStatus(
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    account: string,
    knownOperationId: string | undefined,
    assertCurrent: () => void,
    signal?: AbortSignal
  ) {
    const lifetime = signal
      ? undefined
      : this.guardianReadLifetime(assertCurrent);
    return readGuardianRecoveryObservation({
      account,
      chainId: context.chainId,
      moduleAddress: getConfiguredAuthenticatorAddress(
        context.chainId,
        'guardian-recovery'
      ),
      knownOperationId,
      provider: guardianStatusProvider(
        context.provider,
        signal ?? lifetime!.signal
      ),
      assertCurrent: lifetime?.assertCurrent ?? assertCurrent,
    }).finally(() => lifetime?.dispose());
  }

  public async getSmartAccountGuardianRemovalStatus(
    accountId: number
  ): Promise<GuardianRemovalInspection> {
    const context = this.infrastructureContext();
    const target = this.getSmartAccountById(accountId);
    if (
      target.account.id !== accountId ||
      target.metadata.chainId !== context.chainId
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const generation = this.deps.getWalletStateGeneration();
    const check = () => {
      this.assertInfrastructureContext(context);
      if (
        generation !== this.deps.getWalletStateGeneration() ||
        !this.sameSmartAccountTarget(
          this.getSmartAccountById(accountId),
          target
        )
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    check();
    const observation = await this.getSmartAccountGuardianRecoveryStatus({
      account: target.account.address,
    });
    check();
    if (!observation.exists)
      return { status: 'removed', transactions: [], totalPending: 0 };
    const records = await this.deps.captureSmartAccountPendingRecords(
      context.chainId,
      target.account.address,
      check
    );
    check();
    const inspected = await inspectGuardianRemovals({
      account: target.account.address,
      chainId: context.chainId,
      moduleAddress: observation.moduleAddress,
      records,
      read: (method, params) => context.provider.send(method, [...params]),
      assertCurrent: check,
    });
    if (inspected.status === 'retry-ready') {
      const latest = await this.readFreshGuardianRecoveryStatus(
        context,
        target.account.address,
        undefined,
        check
      );
      check();
      if (
        guardianPolicyObservationIdentity(latest) !==
        guardianPolicyObservationIdentity(observation)
      )
        throw new Error('GUARDIAN_POLICY_CHANGED');
    }
    return inspected;
  }

  public async prepareSmartAccountGuardianPolicyUpdate(params: unknown) {
    void params;
    throw new Error(GUARDIAN_POLICY_ERROR);
  }

  public async prepareSmartAccountGuardianRemoval(params: unknown) {
    void params;
    throw new Error(GUARDIAN_POLICY_ERROR);
  }

  public async submitSmartAccountGuardianPolicyTransaction(params: unknown) {
    void params;
    throw new Error(GUARDIAN_POLICY_ERROR);
  }

  public async submitSmartAccountGuardianStartRecovery(params: {
    account: string;
    expectedClaimHash: string | null;
    expectedContext?: IEvmTransactionContext;
    guardian: string;
    readyAt: number;
    replacement: GuardianRecoveryReplacement;
    target: PaliRecoveryTarget;
  }) {
    const prepared = await this.prepareSmartAccountGuardianStartRecovery({
      ...params,
      operation: null,
    });
    if (!prepared.approval) {
      throw new Error(
        'Smart-account guardian approval must be collected from the wallet UI before submitting recovery.'
      );
    }

    return this.submitPreparedSmartAccountGuardianStartRecovery({
      account: prepared.account,
      claimHash: prepared.claim.intent.operation.hash,
      approval: prepared.approval,
      executionContextId: prepared.executionContextId,
      expectedContext: params.expectedContext,
      gasPayer: prepared.gasPayer,
      guardian: prepared.guardian,
      operation: prepared.operation,
    });
  }

  private async persistGuardianRecoveryMetadata(
    account: string,
    update: (current: ISmartAccountMetadata) => ISmartAccountMetadata,
    assertOwner: () => void
  ) {
    const origin = this.recoveryApprovalContext(),
      target = this.getActiveSmartAccount(account);
    const generation = this.deps.getWalletStateGeneration();
    const sameWallet = () =>
      generation === this.deps.getWalletStateGeneration();
    const check = () => {
      assertOwner();
      origin.assertCurrent();
      const current = this.getActiveSmartAccount(account);
      if (
        !sameWallet() ||
        !this.sameSmartAccountTarget(current, target) ||
        current.metadata.chainId !== origin.snapshot.chainId
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    check();
    await persistMetadata(
      target.account.id,
      () => {
        check();
        return update(this.getActiveSmartAccount(account).metadata);
      },
      check,
      sameWallet
    );
    check();
    this.invalidateHydratedMetadata(account);
  }

  private async assertNoPendingGuardianRecovery(
    claim: GuardianRecoveryClaim,
    assertCurrent: () => void,
    action: 'schedule' | 'finalize'
  ) {
    assertCurrent();
    const status = await this.getSmartAccountGuardianRecoveryStatus({
      account: claim.intent.operation.account,
      intent: claim.intent,
      guardian: claim.guardian.guardian,
      guardianApproval: claim.guardian.kind,
    });
    assertCurrent();
    if (status.recoveryTransactionHash !== null)
      throw new Error('A guardian recovery transaction is unresolved');
    if (
      action === 'schedule' &&
      (status.pending ||
        ['pending', 'ready', 'executed'].includes(
          status.knownOperation?.status ?? ''
        ))
    )
      throw new Error(GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR);
  }

  private withGuardianRecoverySubmission<T>(
    claim: GuardianRecoveryClaim,
    assertCurrent: () => void,
    send: () => Promise<T>,
    action: 'schedule' | 'finalize'
  ): Promise<T> {
    const key = `${
      claim.intent.operation.chainId
    }:${claim.intent.operation.account.toLowerCase()}`;
    let mutex = this.guardianRecoverySubmissions.get(key);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.guardianRecoverySubmissions.set(key, mutex);
    }
    return mutex.runExclusive(async () => {
      assertCurrent();
      await this.assertNoPendingGuardianRecovery(claim, assertCurrent, action);
      return send();
    });
  }

  private assertGuardianRecoveryClaim(
    account: string,
    expected: GuardianRecoveryClaim
  ) {
    const current =
      this.getActiveSmartAccount(account).metadata.guardianRecoveryClaim;
    if (!current || !sameGuardianRecoveryClaim(current, expected))
      throw new Error('Guardian recovery claim changed');
  }

  private async claimGuardianRecovery(
    account: string,
    input: GuardianRecoveryClaim,
    expectedClaimHash: string | null
  ) {
    const claim = captureGuardianRecoveryClaim(input);
    const origin = this.recoveryApprovalContext();
    const target = this.getActiveSmartAccount(account);
    if (
      claim.intent.operation.account !== getAddress(account) ||
      claim.intent.operation.chainId !== origin.snapshot.chainId ||
      (expectedClaimHash !== null &&
        !/^0x[0-9a-f]{64}$/i.test(expectedClaimHash))
    )
      throw new Error('Invalid guardian recovery claim owner');
    const existing = target.metadata.guardianRecoveryClaim;
    if ((existing?.intent.operation.hash ?? null) !== expectedClaimHash)
      throw new Error('Guardian recovery claim changed');
    let resolved = false;
    if (
      existing &&
      existing.intent.operation.hash !== claim.intent.operation.hash
    ) {
      const status = await this.getSmartAccountGuardianRecoveryStatus({
        account,
        intent: existing.intent,
        guardian: existing.guardian.guardian,
        guardianApproval: existing.guardian.kind,
      });
      origin.assertCurrent();
      resolved = guardianRecoveryIntentResolved(
        existing.intent.operation,
        status,
        status.recoveryTransactionHash
      );
    }
    await this.persistGuardianRecoveryMetadata(
      account,
      (current) => {
        const saved = current.guardianRecoveryClaim;
        if (
          (saved?.intent.operation.hash ?? null) !== expectedClaimHash ||
          (saved &&
            saved.intent.operation.hash === claim.intent.operation.hash &&
            !sameGuardianRecoveryClaim(saved, claim)) ||
          (saved &&
            saved.intent.operation.hash !== claim.intent.operation.hash &&
            !resolved)
        )
          throw new Error('Guardian recovery claim changed');
        return { ...current, guardianRecoveryClaim: claim };
      },
      origin.assertCurrent
    );
    origin.assertCurrent();
    this.assertGuardianRecoveryClaim(account, claim);
    return claim;
  }

  public async reconcileSmartAccountGuardianRecovery(params: {
    account: string;
    expectedClaimHash: string;
    expectedContext: IEvmTransactionContext;
  }) {
    const account = getAddress(params.account),
      expectedClaimHash = params.expectedClaimHash;
    if (!params.expectedContext)
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const expectedContext = Object.freeze({
      ...params.expectedContext,
      account: Object.freeze({ ...params.expectedContext.account }),
    });
    const origin = this.recoveryApprovalContext(expectedContext);
    const target = this.getActiveSmartAccount(account),
      source = target.metadata.guardianRecoveryClaim;
    if (!source || source.intent.operation.hash !== expectedClaimHash)
      throw new Error('Guardian recovery claim changed');
    const claim = captureGuardianRecoveryClaim(source);
    const check = () => {
      origin.assertCurrent();
      this.assertGuardianRecoveryClaim(account, claim);
    };
    const status = await this.getSmartAccountGuardianRecoveryStatus({
      account,
      intent: claim.intent,
      guardian: claim.guardian.guardian,
      guardianApproval: claim.guardian.kind,
    });
    check();
    if (
      status.knownOperation?.operationId !==
        getGuardianRecoveryOperationId(claim.intent.operation) ||
      status.knownOperation.status !== 'executed' ||
      !guardianRecoveryIntentResolved(
        claim.intent.operation,
        status,
        status.recoveryTransactionHash
      )
    )
      throw new Error('Guardian recovery has not executed');
    const metadata = await this.hydrateSmartAccount(
      target.account.id,
      expectedContext
    );
    check();
    if (!guardianRecoveryReplacementApplied(claim, metadata))
      throw new Error('Guardian recovery replacement is not active');
    return metadata;
  }

  public async retireSmartAccountGuardianRecovery(params: {
    account: string;
    expectedClaimHash: string;
    expectedContext: IEvmTransactionContext;
  }) {
    if (!params.expectedContext)
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const expectedContext = Object.freeze({
      ...params.expectedContext,
      account: Object.freeze({ ...params.expectedContext.account }),
    });
    const expectedClaimHash = params.expectedClaimHash;
    const account = getAddress(params.account),
      origin = this.recoveryApprovalContext(expectedContext);
    const target = this.getActiveSmartAccount(account),
      claim = target.metadata.guardianRecoveryClaim
        ? captureGuardianRecoveryClaim(target.metadata.guardianRecoveryClaim)
        : undefined;
    if (!claim || claim.intent.operation.hash !== expectedClaimHash)
      throw new Error('Guardian recovery claim changed');
    const status = await this.getSmartAccountGuardianRecoveryStatus({
      account,
      intent: claim.intent,
      guardian: claim.guardian.guardian,
      guardianApproval: claim.guardian.kind,
    });
    origin.assertCurrent();
    if (
      !guardianRecoveryIntentResolved(
        claim.intent.operation,
        status,
        status.recoveryTransactionHash
      )
    )
      throw new Error('Guardian recovery is unresolved');
    await this.persistGuardianRecoveryMetadata(
      account,
      (current) => {
        if (
          current.guardianRecoveryClaim?.intent.operation.hash !==
          expectedClaimHash
        )
          throw new Error('Guardian recovery claim changed');
        return {
          ...current,
          guardianRecoveryClaim: undefined,
          guardianRecoveryReplacement: claim.replacement,
        };
      },
      origin.assertCurrent
    );
  }

  public async prepareSmartAccountGuardianStartRecovery(params: {
    account: string;
    expectedClaimHash: string | null;
    expectedContext?: IEvmTransactionContext;
    guardian: string;
    operation: SmartAccountGuardianRecoveryOperation | null;
    readyAt: number;
    replacement: GuardianRecoveryReplacement;
    target: PaliRecoveryTarget;
  }) {
    const origin = this.recoveryApprovalContext(params.expectedContext);
    const account = getAddress(params.account),
      guardian = getAddress(params.guardian);
    const target = captureGuardianRecoveryTarget(params.target),
      requestedOperation = params.operation;
    const replacement = JSON.parse(
      JSON.stringify(params.replacement)
    ) as GuardianRecoveryReplacement;
    const expectedClaimHash = params.expectedClaimHash,
      readyAt = params.readyAt;
    const operation =
      requestedOperation === null
        ? await this.buildGuardianStartRecoveryOperation(account, target)
        : captureGuardianRecoveryIntent({
            operation: requestedOperation,
            target,
          }).operation;
    origin.assertCurrent();
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation,
    });
    origin.assertCurrent();
    const localEoaGuardian = this.findLocalSigningAccount(guardian);
    let smartGuardian: Awaited<
      ReturnType<SmartAccountController['getHydratedActiveSmartAccount']>
    >;
    if (!localEoaGuardian) {
      smartGuardian = await this.getHydratedActiveSmartAccount(guardian);
      origin.assertCurrent();
      if (!smartGuardian.metadata.isDeployed)
        throw new Error(
          'Smart-account guardians must be deployed before they can approve recovery.'
        );
    }
    const existingClaim =
      this.getActiveSmartAccount(account).metadata.guardianRecoveryClaim;
    if (existingClaim?.intent.operation.hash === operation.hash)
      await this.assertNoPendingGuardianRecovery(
        captureGuardianRecoveryClaim(existingClaim),
        origin.assertCurrent,
        'schedule'
      );
    const proofContextId = this.rememberRecoverySigningContext(
      origin.snapshot,
      operation.hash
    );
    await this.proveRecoveryTargetOwnership(
      target,
      operation.hash,
      proofContextId
    );
    origin.assertCurrent();
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation,
    });
    origin.assertCurrent();
    const claim = await this.claimGuardianRecovery(
      account,
      {
        intent: { operation, target },
        replacement,
        readyAt,
        guardian: { kind: localEoaGuardian ? 'ecdsa' : 'contract', guardian },
      },
      expectedClaimHash
    );
    origin.assertCurrent();
    const captured = this.recoveryApprovalContext(params.expectedContext);
    const snapshot = captured.snapshot;
    const assertCurrent = () => {
      captured.assertCurrent();
      this.assertGuardianRecoveryClaim(account, claim);
    };
    assertCurrent();
    const targetContextId = this.rememberRecoverySigningContext(
      snapshot,
      operation.hash
    );
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation,
    });
    assertCurrent();

    if (localEoaGuardian) {
      const signature = await this.deps.signSmartAccountRecoveryOwner(
        targetContextId,
        localEoaGuardian,
        assertCurrent
      );
      assertCurrent();
      return {
        account,
        approval: {
          guardian,
          signature,
        },
        executionContextId: targetContextId,
        gasPayer: { ...localEoaGuardian, address: guardian },
        guardian,
        operation,
        claim,
      };
    }

    return {
      account,
      guardian,
      operation,
      claim,
      executionContextId: this.rememberRecoverySigningContext(
        snapshot,
        getPaliErc7739PersonalSignHash({
          accountAddress: guardian,
          chainId: operation.chainId,
          hash: operation.hash,
        })
      ),
      smartGuardian: smartGuardian.metadata,
    };
  }

  public async submitPreparedSmartAccountGuardianStartRecovery(params: {
    account: string;
    approval: { guardian: string; signature: string };
    claimHash: string;
    executionContextId?: string;
    expectedContext?: IEvmTransactionContext;
    feeReviewId?: string;
    gasPayer?: { address: string; id: number; type: PaliKeyringAccountType };
    guardian: string;
    operation: SmartAccountGuardianRecoveryOperation;
  }) {
    const feeReviewId = params.feeReviewId;
    const owner = this.getActiveSmartAccount(getAddress(params.account))
      .metadata.guardianRecoveryClaim;
    if (!owner || owner.intent.operation.hash !== params.claimHash)
      throw new Error('Guardian recovery claim changed');
    const claim = captureGuardianRecoveryClaim(owner);
    const origin = this.recoveryApprovalContext(params.expectedContext);
    const executionContextId = params.executionContextId;
    const preferredGasPayer = params.gasPayer
      ? { ...params.gasPayer }
      : undefined;
    const assertCurrent = () => {
      origin.assertCurrent();
      this.assertGuardianRecoveryClaim(claim.intent.operation.account, claim);
      if (executionContextId)
        this.assertSmartAccountExecutionContext(executionContextId);
    };
    assertCurrent();
    const account = getAddress(params.account);
    const operation = captureGuardianRecoveryOperation(params.operation);
    const approval = Object.freeze({ ...params.approval });
    const guardian = getAddress(params.guardian);
    if (
      operation.hash !== claim.intent.operation.hash ||
      operation.account !== claim.intent.operation.account ||
      guardian !== claim.guardian.guardian
    )
      throw new Error('Guardian recovery claim changed');
    if (getAddress(approval.guardian) !== guardian)
      throw new Error('Guardian approval does not match recovery guardian');
    return this.withGuardianRecoverySubmission(
      claim,
      assertCurrent,
      async () => {
        await this.validateSmartAccountGuardianRecoveryOperation({
          account,
          operation,
        });
        assertCurrent();
        const transaction = buildGuardianRecoveryScheduleTransaction({
          account,
          guardian,
          approval,
          operation,
        });
        try {
          const gasPayer = await this.getWalletGasPayerAccount(
            this.ethereumTransaction?.web3Provider,
            preferredGasPayer,
            transaction
          );
          assertCurrent();
          const metadata = {
            smartAccountGuardianRecovery: true,
            smartAccountRecoveryAccount: account,
          };
          const options = {
            clearNavigation: false,
            persist: true,
            assertBeforeSign: assertCurrent,
            assertCurrentContext: assertCurrent,
          };
          if (feeReviewId === undefined) {
            const feeReview = await this.deps.reviewSettingsEvmFee(
              transaction,
              gasPayer,
              metadata,
              options
            );
            assertCurrent();
            return { operation, feeReview };
          }
          const response = await this.deps.sendAndSaveEthTransaction(
            transaction,
            false,
            gasPayer,
            metadata,
            { ...options, genericReviewId: feeReviewId }
          );

          return {
            operation,
            transaction: response,
          };
        } catch (error) {
          // Revert data does not survive the popup<->background message
          // boundary (errors are flattened to their message), so map the
          // module's custom error to a sentinel the UI can recognize.
          if (hasGuardianRecoveryAlreadyScheduledRevert(error)) {
            throw new Error(GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR);
          }
          throw error;
        }
      },
      'schedule'
    );
  }

  public async finalizeSmartAccountGuardianRecovery(params: {
    claim: GuardianRecoveryClaim;
    expectedClaimHash: string | null;
    expectedContext?: IEvmTransactionContext;
    feeReviewId?: string;
  }) {
    const feeReviewId = params.feeReviewId;
    const origin = this.recoveryApprovalContext(params.expectedContext);
    const input = captureGuardianRecoveryClaim(params.claim),
      account = input.intent.operation.account;
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation: input.intent.operation,
    });
    origin.assertCurrent();
    const claim = await this.claimGuardianRecovery(
      account,
      input,
      params.expectedClaimHash
    );
    origin.assertCurrent();
    const capturedOrigin = this.recoveryApprovalContext(params.expectedContext);
    const assertCurrent = () => {
      capturedOrigin.assertCurrent();
      this.assertGuardianRecoveryClaim(account, claim);
    };
    const captured = claim.intent.operation,
      recoveryModule = captured.recoveryModule;
    assertCurrent();
    try {
      const response = await this.withGuardianRecoverySubmission(
        claim,
        assertCurrent,
        async () => {
          const transaction = buildGuardianRecoveryFinalizeTransaction({
            account,
            operation: { ...captured, recoveryModule },
          });
          const gasPayer = await this.getWalletGasPayerAccount(
            this.ethereumTransaction?.web3Provider,
            undefined,
            transaction
          );
          assertCurrent();
          const metadata = {
            smartAccountGuardianRecoveryFinalize: true,
            smartAccountRecoveryAccount: account,
          };
          const options = {
            clearNavigation: false,
            persist: true,
            assertBeforeSign: assertCurrent,
            assertCurrentContext: assertCurrent,
          };
          if (feeReviewId === undefined) {
            const feeReview = await this.deps.reviewSettingsEvmFee(
              transaction,
              gasPayer,
              metadata,
              options
            );
            assertCurrent();
            return { feeReview, claimHash: claim.intent.operation.hash };
          }
          return this.deps.sendAndSaveEthTransaction(
            transaction,
            false,
            { id: gasPayer.id, type: gasPayer.type },
            metadata,
            { ...options, genericReviewId: feeReviewId }
          );
        },
        'finalize'
      );
      if ('feeReview' in response) return response;
      // Admission is released after the transport settles. The existing signed
      // record retains exclusion while canonical receipt observation continues.
      await response.wait();
      this.invalidateHydratedMetadata(account);
      return response;
    } catch (error) {
      if (hasGuardianRecoveryNotReadyRevert(error))
        throw new Error(GUARDIAN_RECOVERY_NOT_READY_ERROR);
      if (hasGuardianRecoveryExpiredRevert(error))
        throw new Error(GUARDIAN_RECOVERY_EXPIRED_ERROR);
      if (hasNativeGasFailure(error))
        throw new Error(NATIVE_GAS_REQUIRED_ERROR);
      throw error;
    }
  }

  private async buildGuardianStartRecoveryOperation(
    account: string,
    target: PaliRecoveryTarget
  ): Promise<SmartAccountGuardianRecoveryOperation> {
    const origin = this.recoveryApprovalContext();
    const { snapshot } = origin;
    const targetAccount = this.getActiveSmartAccount(account);
    if (targetAccount.metadata.chainId !== snapshot.chainId)
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const assertCurrent = () => {
      origin.assertCurrent();
      if (
        !this.sameSmartAccountTarget(
          this.getActiveSmartAccount(account),
          targetAccount
        )
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    const provider = snapshot.provider;
    const contract = new Contract(account, paliSmartAccountInterface, provider);
    return buildGuardianRecoveryStart(
      { account, chainId: snapshot.chainId, salt: randomBytes32Hex(), target },
      {
        assertCurrent,
        readModuleAddress: async (address) =>
          (await this.getGuardianRecoveryStatusForAccount(address))
            ?.moduleAddress,
        readPolicyEpoch: async (address, module) =>
          (await this.readGuardianRecoveryDigestContext(address, module))
            .policyEpoch,
        isValidatorInstalled: (_address, validator) =>
          contract.isModuleInstalled(
            ERC7579_MODULE_TYPE_VALIDATOR,
            validator,
            '0x'
          ),
        readCurrentValidator: async () => contract.activeValidator(),
      }
    );
  }

  private async readGuardianRecoveryDigestContext(
    account: string,
    recoveryModule: string
  ): Promise<SmartAccountGuardianRecoveryDigestContext> {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const module = new Contract(
      recoveryModule,
      paliGuardianRecoveryModuleInterface,
      provider
    );
    const epoch = await module.policyEpoch(account);
    return getGuardianRecoveryDigestContext({
      policyEpoch: epoch.toString(),
    });
  }

  public async validateSmartAccountGuardianRecoveryOperation(params: {
    account: string;
    operation: Omit<SmartAccountGuardianRecoveryOperation, 'hash'> & {
      hash?: string;
    };
  }): Promise<void> {
    const { snapshot, assertCurrent } = this.recoveryApprovalContext();
    return validateGuardianRecoveryOperation(
      { ...params, chainId: snapshot.chainId },
      {
        assertCurrent,
        readModuleAddress: async (account) =>
          (await this.getGuardianRecoveryStatusForAccount(account))
            ?.moduleAddress,
        readPolicyEpoch: async (account, module) =>
          (await this.readGuardianRecoveryDigestContext(account, module))
            .policyEpoch,
        readScheduleHash: (operation) =>
          new Contract(
            operation.recoveryModule,
            paliGuardianRecoveryModuleInterface,
            snapshot.provider
          ).getRecoveryScheduleHash(
            operation.account,
            operation.salt,
            operation.mode,
            operation.executionCalldata
          ),
      }
    );
  }

  private async proveRecoveryTargetOwnership(
    target: PaliRecoveryTarget,
    operationHash: string,
    executionContextId: string
  ): Promise<void> {
    switch (target.auth.module) {
      case 'ecdsa':
        await this.proveEcdsaRecoveryTargetOwnership(
          target.auth.data,
          operationHash,
          executionContextId
        );
        return;
      case 'p256-webauthn':
      case 'composite':
        return;
      case 'slh-dsa':
        await this.proveSLHDSARecoveryTargetOwnership(
          target.auth.data,
          operationHash,
          executionContextId
        );
        return;
      default:
        return;
    }
  }

  private async proveEcdsaRecoveryTargetOwnership(
    initData: string,
    operationHash: string,
    executionContextId: string
  ): Promise<void> {
    const [decodedOwners, decodedThreshold] = defaultAbiCoder.decode(
      ['address[]', 'uint64'],
      initData
    ) as [string[], { toString: () => string }];
    const owners = decodedOwners.map((owner) => getAddress(owner));
    const threshold = Number(decodedThreshold.toString());
    if (threshold < 1 || owners.length < threshold) {
      throw new Error('Invalid ECDSA replacement authenticator threshold');
    }

    await Promise.all(
      owners.slice(0, threshold).map((owner) => {
        const ownerAccount = this.getLocalSigningAccount(owner);
        this.assertSmartAccountExecutionContext(
          executionContextId,
          operationHash
        );
        return this.deps.signSmartAccountRecoveryOwner(
          executionContextId,
          ownerAccount,
          () =>
            this.assertSmartAccountExecutionContext(
              executionContextId,
              operationHash
            )
        );
      })
    );
  }

  private async proveSLHDSARecoveryTargetOwnership(
    initData: string,
    operationHash: string,
    executionContextId?: string
  ): Promise<void> {
    const [authData] = defaultAbiCoder.decode(
      ['tuple(bytes32 pkSeed,bytes32 pkRoot)'],
      initData
    ) as [{ pkRoot: string; pkSeed: string }];
    const pkSeed = normalizeSLHDSAPublicKeyField(
      authData.pkSeed || (authData as any)[0]
    );
    const pkRoot = normalizeSLHDSAPublicKeyField(
      authData.pkRoot || (authData as any)[1]
    );

    await this.deps.signSLHDSARecoveryTargetActionHash({
      actionHash: operationHash,
      executionContextId,
      keyId: getSLHDSAKeyId({ pkRoot, pkSeed }),
      parameterSet: SLH_DSA_PARAMETER_SET,
      pkRoot,
      pkSeed,
    });
  }

  /**
   * Signs a userOp action hash with the account's configured local ECDSA
   * owners (threshold-many), mirroring the UI ecdsa authenticator driver's
   * signature encoding. Used for background-signed ops such as the explicit
   * registration no-op; non-ECDSA validators must sign through the UI.
   */
  private async signActionHashWithLocalEcdsaOwners(
    metadata: ISmartAccountMetadata,
    actionHash: string,
    executionContextId: string,
    sourceAuthority: SmartAccountControllerAuthority
  ): Promise<string> {
    const captured = this.infrastructureContext();
    const assertCurrent = () => {
      this.assertInfrastructureContext(captured);
      this.assertSmartAccountExecutionContext(executionContextId, actionHash);
      assertSynchronousEvmFeeGuard(sourceAuthority.assertCurrent);
      if (sourceAuthority.signal.aborted)
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    assertCurrent();
    await this.assertSmartAccountPreparedNonce(executionContextId);
    assertCurrent();
    return signSmartAccountEcdsaOperation({
      metadata,
      actionHash,
      assertCurrent,
      findOwner: (address) => this.findLocalSigningAccount(address),
      signOwner: (address, hash, owner) =>
        this.deps.signSmartAccountOperationOwner(
          executionContextId,
          owner,
          () => {
            assertCurrent();
            this.assertSmartAccountExecutionContext(executionContextId, hash);
          },
          sourceAuthority.signal
        ),
    });
  }

  private findLocalSigningAccount(address: string): {
    id: number;
    type: PaliKeyringAccountType;
  } | null {
    const normalizedAddress = getAddress(address);
    const { accounts } = store.getState().vault;
    const accountTypes = [
      PaliKeyringAccountType.HDAccount,
      PaliKeyringAccountType.Imported,
      PaliKeyringAccountType.Ledger,
      PaliKeyringAccountType.Trezor,
    ];
    for (const type of accountTypes) {
      for (const [id, account] of Object.entries(accounts[type] || {})) {
        try {
          if (getAddress((account as any).address) === normalizedAddress) {
            return { id: Number(id), type };
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  private getLocalSigningAccount(address: string): {
    id: number;
    type: PaliKeyringAccountType;
  } {
    const localSigningAccount = this.findLocalSigningAccount(address);
    if (localSigningAccount) {
      return localSigningAccount;
    }

    throw new Error(
      'This wallet address is not available in Pali. Import or select a local Pali wallet address before using it for recovery.'
    );
  }

  private sameSmartAccountTarget(
    current: ReturnType<SmartAccountController['getSmartAccountById']>,
    target: ReturnType<SmartAccountController['getSmartAccountById']>
  ): boolean {
    return (
      current.account.id === target.account.id &&
      current.account.type === target.account.type &&
      current.account.address === target.account.address &&
      current.metadata.descriptor === target.metadata.descriptor
    );
  }

  private async persistSmartAccountMetadata(
    accountId: number,
    update:
      | ISmartAccountMetadata
      | ((current: ISmartAccountMetadata) => ISmartAccountMetadata),
    expectedContext?: IEvmTransactionContext,
    expectedTarget?: ReturnType<SmartAccountController['getSmartAccountById']>
  ): Promise<ISmartAccountMetadata> {
    const customEdit = typeof update === 'function';
    const assertExpected = () => {
      if (!expectedContext) return;
      try {
        this.assertExpectedExecutionContext(
          expectedContext,
          customEdit ? accountId : undefined,
          customEdit
        );
      } catch {
        // The chain operation was acknowledged; only local metadata is stale.
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    };
    assertExpected();
    const context = this.infrastructureContext();
    const target = expectedTarget || this.getSmartAccountById(accountId);
    const walletGeneration = this.deps.getWalletStateGeneration();
    const isSameWallet = () =>
      walletGeneration === this.deps.getWalletStateGeneration();
    const assertCurrent = () => {
      this.assertInfrastructureContext(context);
      assertExpected();
      const current = this.getSmartAccountById(accountId);
      if (
        !isSameWallet() ||
        !this.sameSmartAccountTarget(current, target) ||
        current.metadata.chainId !== context.chainId ||
        (expectedTarget && current.metadata !== target.metadata)
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    assertCurrent();
    let metadata: ISmartAccountMetadata;
    await persistMetadata(
      accountId,
      () => {
        const current = this.getSmartAccountById(accountId).metadata;
        metadata = customEdit
          ? update(current)
          : {
              ...update,
              guardianRecoveryClaim: current.guardianRecoveryClaim,
              guardianRecoveryReplacement: current.guardianRecoveryReplacement,
            };
        return metadata;
      },
      assertCurrent,
      isSameWallet
    );
    if (customEdit) this.invalidateHydratedMetadata(target.account.address);
    return metadata!;
  }

  private async getHydratedActiveSmartAccount(address?: string): Promise<{
    account: any;
    metadata: ISmartAccountMetadata;
  }> {
    const active = this.getActiveSmartAccount(address);
    const metadata = await this.hydrateSmartAccountMetadata(active.account);
    return { account: active.account, metadata };
  }

  private async getHydratedSmartAccountById(accountId: number): Promise<{
    account: any;
    metadata: ISmartAccountMetadata;
  }> {
    const active = this.getSmartAccountById(accountId);
    const metadata = await this.hydrateSmartAccountMetadata(active.account);
    return { account: active.account, metadata };
  }

  private getHydrationKey(account: any): string {
    const metadata = account.smartAccount as ISmartAccountMetadata;
    return `${metadata.chainId}:${String(account.address).toLowerCase()}`;
  }

  private invalidateHydratedMetadata(address?: string): void {
    // Detach in-flight hydrations too: they may have started before the
    // on-chain change being invalidated, so joining them (or letting them
    // populate the cache when they resolve) would resurrect stale metadata.
    if (!address) {
      this.hydratedMetadataCache.clear();
      this.inflightHydrations.clear();
      return;
    }
    const normalized = address.toLowerCase();
    for (const key of Array.from(this.hydratedMetadataCache.keys())) {
      if (key.endsWith(`:${normalized}`)) {
        this.hydratedMetadataCache.delete(key);
      }
    }
    for (const key of Array.from(this.inflightHydrations.keys())) {
      if (key.endsWith(`:${normalized}`)) {
        this.inflightHydrations.delete(key);
      }
    }
  }

  private async hydrateSmartAccountMetadata(
    account: any,
    options: { forceRefresh?: boolean } = {}
  ): Promise<ISmartAccountMetadata> {
    const key = this.getHydrationKey(account);

    // Joining an in-flight hydration deduplicates concurrent UI/controller
    // requests — but never for forced refreshes: those run after on-chain
    // state changes (deployment, module install, recovery) and an in-flight
    // fetch may have started before the change, so it could return stale
    // metadata.
    if (!options.forceRefresh) {
      const inflight = this.inflightHydrations.get(key);
      if (inflight) {
        return inflight;
      }
      const cached = this.hydratedMetadataCache.get(key);
      if (cached && Date.now() - cached.timestamp < HYDRATED_METADATA_TTL_MS) {
        return cached.metadata;
      }
    }

    const hydration: Promise<ISmartAccountMetadata> =
      this.fetchSmartAccountMetadata(account)
        .then((metadata) => {
          // Only the most recent hydration may populate the cache; a
          // superseded fetch resolving late must not overwrite fresher data.
          if (this.inflightHydrations.get(key) === hydration) {
            this.hydratedMetadataCache.set(key, {
              metadata,
              timestamp: Date.now(),
            });
          }
          return metadata;
        })
        .finally(() => {
          if (this.inflightHydrations.get(key) === hydration) {
            this.inflightHydrations.delete(key);
          }
        });
    this.inflightHydrations.set(key, hydration);
    return hydration;
  }

  private requireAggregateResult(
    result: AggregateCallResult | undefined,
    label: string
  ): NonNullable<AggregateCallResult['result']> {
    if (!result?.success) {
      throw new Error(`Failed to read smart account state (${label})`);
    }
    return result.result;
  }

  private async fetchSmartAccountMetadata(
    account: any
  ): Promise<ISmartAccountMetadata> {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    const context = this.infrastructureContext();
    const assertCurrent = () => this.assertInfrastructureContext(context);
    const metadata = await readSmartAccountValidatorMetadata({
      account,
      chainId: context.chainId,
      provider,
      assertCurrent,
    });
    assertCurrent();
    if (!metadata.isDeployed) return metadata;
    const installedModules: NonNullable<
      ISmartAccountMetadata['installedModules']
    > = [...(metadata.installedModules || [])];
    const chainId = metadata.chainId;
    const guardianStatus = await this.getGuardianRecoveryStatusForAccount(
      account.address,
      chainId
    );
    if (guardianStatus) {
      installedModules.push(projectGuardianPolicyModule(guardianStatus));
    }

    assertCurrent();
    return { ...metadata, installedModules };
  }

  private decodeGuardianRecoveryStatus(
    moduleAddress: string,
    configResult: AggregateCallResult | undefined,
    guardiansResult: AggregateCallResult | undefined
  ): GuardianRecoveryStatusForAccount | null {
    const [config] = this.requireAggregateResult(
      configResult,
      'guardian-recovery config'
    ) as unknown as [any];
    const installed = Boolean(config.installed ?? config[3]);
    if (!installed) {
      return null;
    }
    const [rawGuardians] = this.requireAggregateResult(
      guardiansResult,
      'guardian-recovery guardians'
    ) as unknown as [string[]];
    const guardians = rawGuardians.map((guardian: string) =>
      getAddress(guardian)
    );
    const delaySeconds = Number(config.delay ?? config[0] ?? 0);
    const expirationSeconds = Number(config.expiration ?? config[1] ?? 0);
    const threshold = Number(config.threshold ?? config[2] ?? 0);
    return {
      delay: String(delaySeconds),
      delaySeconds,
      exists: true,
      expirationSeconds,
      guardianCount: String(guardians.length),
      guardians,
      moduleAddress,
      threshold,
    };
  }

  private async getGuardianRecoveryStatusForAccount(
    account: string,
    chainId = store.getState().vault.activeNetwork.chainId
  ): Promise<GuardianRecoveryStatusForAccount | null> {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const moduleAddress = getConfiguredAuthenticatorAddress(
      chainId,
      'guardian-recovery'
    );
    if (!moduleAddress || moduleAddress === AddressZero) {
      return null;
    }
    const installedResults = await aggregateContractCalls(provider, chainId, [
      {
        args: [ERC7579_MODULE_TYPE_EXECUTOR, moduleAddress, '0x'],
        fn: 'isModuleInstalled',
        iface: paliSmartAccountInterface,
        target: account,
      },
    ]);
    const [isInstalled] = this.requireAggregateResult(
      installedResults[0],
      'guardian-recovery installation'
    );
    if (!isInstalled) {
      return null;
    }
    const results = await aggregateContractCalls(provider, chainId, [
      {
        args: [account],
        fn: 'config',
        iface: paliGuardianRecoveryModuleInterface,
        target: moduleAddress,
      },
      {
        args: [account],
        fn: 'guardians',
        iface: paliGuardianRecoveryModuleInterface,
        target: moduleAddress,
      },
    ]);
    const status = this.decodeGuardianRecoveryStatus(
      moduleAddress,
      results[0],
      results[1]
    );
    if (!status) {
      throw new Error(
        'Installed guardian recovery module has no active policy'
      );
    }
    return status;
  }

  private getActiveSmartAccount(address?: string): {
    account: any;
    metadata: ISmartAccountMetadata;
  } {
    const { accounts, activeAccount } = store.getState().vault;
    const smartAccounts = accounts[PaliKeyringAccountType.SmartAccount] || {};
    const account = address
      ? Object.values(smartAccounts).find(
          (candidate: any) =>
            candidate.address?.toLowerCase() === address.toLowerCase()
        )
      : smartAccounts[activeAccount.id];
    if (!account?.isSmartAccount || !account.smartAccount) {
      throw new Error('Active account is not a smart account');
    }
    return { account, metadata: account.smartAccount };
  }

  private getSmartAccountById(accountId: number): {
    account: any;
    metadata: ISmartAccountMetadata;
  } {
    const { accounts } = store.getState().vault;
    const account = accounts[PaliKeyringAccountType.SmartAccount]?.[accountId];
    if (!account?.isSmartAccount || !account.smartAccount) {
      throw new Error('Smart account was not found');
    }
    return { account, metadata: account.smartAccount };
  }

  private requireAuthenticator(
    metadata: ISmartAccountMetadata
  ): PaliAuthConfig {
    return requireSmartAccountAuthenticator(metadata);
  }

  private getNextRecoverableAccountIndex(chainId: number): number {
    const { accounts } = store.getState().vault;
    const usedIndexes = new Set(
      Object.values(accounts[PaliKeyringAccountType.SmartAccount] || {})
        .map((account: any) =>
          account?.smartAccount?.chainId === chainId
            ? account.smartAccount?.descriptor?.accountIndex
            : undefined
        )
        .filter((index) => Number.isInteger(index))
    );
    let accountIndex = 0;
    while (usedIndexes.has(accountIndex)) {
      accountIndex += 1;
    }
    return accountIndex;
  }

  private getWalletManagementAddress(): string {
    const { accounts, activeAccount } = store.getState().vault;
    const managementAddress =
      accounts[PaliKeyringAccountType.HDAccount]?.[0]?.address ||
      (activeAccount.type !== PaliKeyringAccountType.SmartAccount
        ? accounts[activeAccount.type]?.[activeAccount.id]?.address
        : undefined) ||
      Object.values(accounts[PaliKeyringAccountType.HDAccount] || {})[0]
        ?.address ||
      Object.values(accounts[PaliKeyringAccountType.Imported] || {})[0]
        ?.address;

    if (!managementAddress) {
      throw new Error(RECOVERY_MANAGEMENT_ADDRESS_ERROR);
    }

    return getAddress(managementAddress);
  }

  private async getWalletGasPayerAccount(
    provider: any,
    preferred?: {
      address: string;
      id: number;
      type: PaliKeyringAccountType;
    },
    transaction?: {
      data?: string;
      to: string;
      value?: string;
    },
    options: { requirePreferred?: boolean } = {}
  ): Promise<{
    address: string;
    id: number;
    type: PaliKeyringAccountType;
  }> {
    return selectSmartAccountGasPayer(
      store.getState().vault,
      provider,
      preferred,
      transaction,
      options
    );
  }

  private getWalletGasPayerCandidates(preferred?: {
    address: string;
    id: number;
    type: PaliKeyringAccountType;
  }): Array<{
    account: any;
    address: string;
    id: number;
    type: PaliKeyringAccountType;
  }> {
    return getSmartAccountGasPayerCandidates(store.getState().vault, preferred);
  }

  private async getNativeBalances(
    provider: any,
    addresses: string[]
  ): Promise<BigNumber[]> {
    return readSmartAccountNativeBalances(provider, addresses);
  }
}

export default SmartAccountController;
