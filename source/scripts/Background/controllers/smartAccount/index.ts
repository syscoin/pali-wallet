import { v4 as uuidv4 } from 'uuid';

import { captureSmartAccountCallsIdentity } from '../../../../shared/dappCallsStatus.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../shared/evmFeeApproval';
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
import { defaultAbiCoder } from 'utils/ethersV6Compat';
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
  buildSmartAccountGuardianRecoveryOperation,
  getGuardianRecoveryDigestContext,
  getSmartAccountGuardianRecoveryHash,
  getPaliErc7739PersonalSignHash,
  SmartAccountGuardianRecoveryDigestContext,
  SmartAccountGuardianRecoveryOperation,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
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
import { deriveDefaultSmartAccount } from 'utils/smartAccount/bootstrap';
import {
  PALI_CREATE2_DEPLOYER_ADDRESS,
  getPaliInfrastructureContracts,
  type PaliInfrastructureContractId,
} from 'utils/smartAccount/deployment';
import { readSmartAccountDeploymentState } from 'utils/smartAccount/deploymentState';
import {
  hasUsableSmartAccountAuthMetadata,
  readSmartAccountValidatorMetadata,
} from 'utils/smartAccount/executionMetadata';
import { readGuardianRecoveryObservation } from 'utils/smartAccount/guardianStatus';
import { guardianStatusProvider } from 'utils/smartAccount/guardianStatusProvider';
import {
  assertSmartAccountInfrastructureReady,
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
  assertSmartAccountGasTankCredit,
  ensureSmartAccountDeploymentPrefund,
} from 'utils/smartAccount/payerPolicy';
import {
  getExplicitSmartAccountGasPrice,
  prepareSmartAccountOperation,
  requireSmartAccountAuthenticator,
  SMART_ACCOUNT_EXECUTION_LIFETIME_MS,
} from 'utils/smartAccount/prepareOperation';
import { signSmartAccountEcdsaOperation } from 'utils/smartAccount/signOperation';
import {
  submitSmartAccountOperation,
  type SmartAccountSubmitParams,
} from 'utils/smartAccount/submitOperation';
import { assertSmartAccountTargetsAllowed } from 'utils/smartAccount/targetPolicy';
import { GuardianRecoveryPolicyChangedError } from 'utils/smartAccountErrors';

import {
  infrastructurePendingIdentity,
  InfrastructureJournalEntry,
  readInfrastructureJournal,
  writeInfrastructureJournal,
  clearInfrastructureJournal,
} from './infrastructureJournal';
import type { ITxid } from '@sidhujag/sysweb3-utils';

export interface ISmartAccountControllerDependencies {
  getEthereumTransaction: () => any;
  getLatestUpdateForCurrentAccount: (
    isPolling?: boolean,
    forceUpdate?: boolean,
    isAssetPolling?: boolean,
    skipCache?: boolean
  ) => Promise<boolean>;
  getWalletSessionGeneration?: () => number;
  getWalletStateGeneration: () => number;
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
      clearNavigation?: boolean;
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
  signSmartAccountActionDigestInternal: (
    params: string[],
    targetAccount: { id: number; type: PaliKeyringAccountType },
    executionContextId?: string,
    assertApprovalCurrent?: () => void
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

type InfrastructureDeploymentResult = {
  deployed: PaliInfrastructureContractId[];
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
const GUARDIAN_MODULE_ERROR = 'Guardian recovery module is not configured';
const toCompatBigNumber = (value: any): BigNumber => BigNumber.from(value);

const randomBytes32Hex = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`;
};

class SmartAccountController {
  private readonly executionContexts = new Map<
    string,
    {
      accountId: number;
      actionHash: string;
      expiresAt: number;
      gasPrice?: string;
      snapshot: ReturnType<SmartAccountController['infrastructureContext']>;
      userOperation?: SmartAccountPackedUserOperation;
    }
  >();
  private readonly infrastructureStatusCache = new Map<
    string,
    {
      context: ReturnType<SmartAccountController['infrastructureContext']>;
      status: SmartAccountInfrastructureStatus;
      timestamp: number;
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
    { metadata: ISmartAccountMetadata; timestamp: number }
  >();
  private readonly inflightHydrations = new Map<
    string,
    Promise<ISmartAccountMetadata>
  >();
  private readonly guardianObservations = new Map<
    string,
    {
      context: ReturnType<SmartAccountController['infrastructureContext']>;
      promise: ReturnType<typeof readGuardianRecoveryObservation>;
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
    } catch {
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    }
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

  private validInfrastructureReceipt(receipt: any, hash: string): boolean {
    return Boolean(
      receipt &&
        [0, 1, '0x0', '0x1'].includes(receipt.status) &&
        (receipt.hash || receipt.transactionHash)?.toLowerCase() ===
          hash.toLowerCase()
    );
  }

  private async readInfrastructureStatus(
    context: ReturnType<SmartAccountController['infrastructureContext']>,
    assertCurrent: () => void
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
    let status: SmartAccountInfrastructureStatus | undefined;
    try {
      const batched = await withinDeadline(
        () =>
          context.provider.sendBatch(
            'eth_getCode',
            addresses.map((address) => [address, 'latest'])
          ),
        1800
      );
      status = projectSmartAccountInfrastructureObservation(
        context.chainId,
        batched
      );
    } catch {
      // A failed batch can still be checked through individual reads.
      assertCurrent();
    }
    if (!status) {
      const individual = await withinDeadline(() =>
        Promise.all(
          addresses.map((address) => context.provider.getCode(address))
        )
      );
      status = projectSmartAccountInfrastructureObservation(
        context.chainId,
        individual
      );
      if (!status) throw new Error(INFRASTRUCTURE_CODE_ERROR);
    }
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
      if (candidate.rpcUrl === undefined) {
        // Legacy chain-only records have no trustworthy fork identity. Surface
        // them as pending without probing or settling them on an arbitrary RPC.
        pending = candidate;
        break;
      }
      if (candidate.rpcUrl !== context.url) {
        // An endpoint alias may serve the same chain. Keep admission closed, but
        // never use this endpoint's state to settle another RPC's submission.
        pending = candidate;
        break;
      }
      if (
        !status.contracts.some(
          (contract) => contract.id === candidate.contractId
        )
      )
        continue;
      let settled = !status.missing.includes(candidate.contractId);
      if (!settled && candidate.transactionHash) {
        const receipt = await withinDeadline(
          () =>
            context.provider.getTransactionReceipt(candidate.transactionHash),
          1800
        );
        if (
          receipt &&
          !this.validInfrastructureReceipt(receipt, candidate.transactionHash)
        )
          throw new Error(DEPLOYMENT_RECEIPT_ERROR);
        settled = Boolean(receipt);
      }
      if (!settled && candidate.payerAddress && candidate.nonce !== undefined) {
        const latestNonce = await withinDeadline(
          () =>
            context.provider.send('eth_getTransactionCount', [
              candidate.payerAddress,
              'latest',
            ]),
          1800
        );
        if (
          typeof latestNonce !== 'string' ||
          !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(latestNonce) ||
          !Number.isSafeInteger(Number(latestNonce))
        )
          throw new Error(DEPLOYMENT_NONCE_ERROR);
        settled = Number(latestNonce) > candidate.nonce;
      }
      if (!settled) {
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
    this.infrastructureStatusCache.set(context.key, {
      context,
      timestamp: Date.now(),
      status,
    });
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
    const cached = this.infrastructureStatusCache.get(context.key);
    if (
      !forceRefresh &&
      cached &&
      this.sameInfrastructureContext(cached.context, context) &&
      Date.now() - cached.timestamp < 5000 &&
      !cached.status.pending &&
      !this.pendingInfrastructure.has(context.chainId)
    )
      return cached.status;
    return this.readInfrastructureStatus(context, assertCurrent);
  }

  public deploySmartAccountInfrastructure(): Promise<InfrastructureDeploymentResult> {
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
    const operation = this.deployInfrastructureForContext(context).finally(
      () => {
        if (
          this.infrastructureDeployments.get(context.chainId)?.operation ===
          operation
        )
          this.infrastructureDeployments.delete(context.chainId);
        this.infrastructureStatusCache.delete(context.key);
      }
    );
    this.infrastructureDeployments.set(context.chainId, {
      contextKey: context.key,
      operation,
    });
    return operation;
  }

  private async deployInfrastructureForContext(
    context: ReturnType<SmartAccountController['infrastructureContext']>
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
    try {
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
        const nonce = Math.max(nextNonce, parsedNonce);
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
        const reservationWrite = writeInfrastructureJournal(
          context,
          reservation
        );
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
        this.infrastructureStatusCache.delete(context.key);
        let response: IEvmTransactionResponse;
        try {
          this.assertInfrastructureContext(context);
          response = await this.deps.sendAndSaveEthTransaction(
            {
              chainId: context.chainId,
              from: context.address,
              nonce,
              data: contract.deployCalldata,
              to: PALI_CREATE2_DEPLOYER_ADDRESS,
              value: '0x0',
            },
            false,
            context.account,
            {
              smartAccountInfrastructureDeployment: true,
              smartAccountInfrastructureId: contract.id,
              smartAccountInfrastructureRpcUrl: context.url,
            },
            {
              clearNavigation: false,
              persist: true,
              assertBeforeSign: () => this.assertInfrastructureContext(context),
              assertCurrentContext: () =>
                this.assertInfrastructureContext(context),
              onBroadcast: async (broadcast) => {
                const pending = {
                  ...reservation,
                  transactionHash: broadcast.hash,
                  nonce:
                    Number.isSafeInteger(broadcast.nonce) &&
                    broadcast.nonce >= 0
                      ? broadcast.nonce
                      : reservation.nonce,
                };
                this.pendingInfrastructure.set(context.chainId, pending);
                this.infrastructureStatusCache.delete(context.key);
                await this.infrastructureDeadline(
                  writeInfrastructureJournal(context, pending)
                );
              },
            }
          );
        } catch (error) {
          const hash = (error as any)?.transactionHash;
          if (hash) {
            const acknowledged = this.pendingInfrastructure.get(
              context.chainId
            );
            const pending = {
              ...reservation,
              ...(infrastructurePendingIdentity(acknowledged) ===
              reservation.attemptId
                ? acknowledged
                : {}),
              transactionHash: hash,
            };
            const acknowledgedNonce = (error as any)?.transactionNonce;
            if (
              Number.isSafeInteger(acknowledgedNonce) &&
              acknowledgedNonce >= 0
            )
              pending.nonce = acknowledgedNonce;
            this.pendingInfrastructure.set(context.chainId, pending);
            this.infrastructureStatusCache.delete(context.key);
            // The broadcast callback may have failed its first storage write.
            // Retry this same acknowledged attempt before reporting the error;
            // permanent storage failure keeps the existing reservation closed.
            await this.infrastructureDeadline(
              writeInfrastructureJournal(context, pending)
            ).catch(() => undefined);
          }
          // Definite pre-broadcast rejection is safe to release. Ambiguous
          // transport failures retain the reservation across worker restarts.
          const transactionNotBroadcast = (error as any)
            ?.transactionNotBroadcast;
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
        nextNonce = nonce + 1;
        const deadline = Date.now() + 15000;
        let receipt: any;
        do {
          receipt = await this.infrastructureDeadline(
            context.provider.getTransactionReceipt(response.hash),
            Math.max(1, Math.min(1800, deadline - Date.now()))
          ).catch(() => null);
          if (
            receipt &&
            !this.validInfrastructureReceipt(receipt, response.hash)
          )
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
    } finally {
      this.infrastructureStatusCache.delete(context.key);
    }
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
    assertApprovalCurrent?: () => void
  ) {
    let mayHaveSubmitted = false;
    try {
      const context = this.infrastructureContext();
      const assertCurrent = () => {
        if (assertApprovalCurrent !== undefined)
          assertSynchronousEvmFeeGuard(assertApprovalCurrent);
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
            assertApprovalCurrent
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
            assertApprovalCurrent
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
      ? await this.canUseZkSysGasTankForSmartAccountTx({
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
      feeOverrides?: {
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
      useCachedMetadata?: boolean;
    } = {}
  ) {
    if (options.expectedContext)
      this.assertExpectedExecutionContext(options.expectedContext, accountId);
    const feeOverrides = { ...options.feeOverrides };
    const legacyGasPrice = getExplicitSmartAccountGasPrice(feeOverrides);
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
    if (
      useCachedMetadata &&
      active.metadata.isDeployed &&
      !hasUsableSmartAccountAuthMetadata(active.metadata)
    ) {
      active = Number.isInteger(accountId)
        ? await this.getHydratedSmartAccountById(accountId as number)
        : await this.getHydratedActiveSmartAccount();
      assertContext();
    }
    if (active.metadata.chainId !== snapshot.chainId)
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const useDeployedCachedMetadata =
      useCachedMetadata &&
      active.metadata.isDeployed &&
      hasUsableSmartAccountAuthMetadata(active.metadata);
    if (!useDeployedCachedMetadata) {
      await this.assertInfrastructureSupported(snapshot, assertContext);
      assertContext();
    }
    const prepared = await prepareSmartAccountOperation({
      account: { ...active.account, smartAccount: active.metadata },
      chainId: snapshot.chainId,
      executions: params,
      feeOverrides,
      knownDeployed: useDeployedCachedMetadata,
      provider,
      assertCurrent: assertContext,
      selectGasPayer: async (gasEstimate, maxFeePerGas) => {
        const primaryGasPayer = this.getWalletGasPayerCandidates(
          active.metadata.deploymentGasPayer
        )[0];
        const useGasTank = primaryGasPayer
          ? await this.canUseZkSysGasTankForSmartAccountTx({
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
              active.metadata.deploymentGasPayer
            );
        assertContext();
        return { gasPayer, useGasTank };
      },
    });
    const { actionHash, userOperation } = prepared;
    assertContext();
    for (const [id, context] of this.executionContexts)
      if (context.expiresAt <= Date.now()) this.executionContexts.delete(id);
    while (this.executionContexts.size >= 128)
      this.executionContexts.delete(this.executionContexts.keys().next().value);
    const executionContextId = uuidv4();
    this.executionContexts.set(executionContextId, {
      accountId: active.account.id,
      actionHash,
      expiresAt: Date.now() + SMART_ACCOUNT_EXECUTION_LIFETIME_MS,
      gasPrice: legacyGasPrice,
      snapshot,
      userOperation: Object.freeze({ ...userOperation }),
    });
    return { ...prepared, accountId: active.account.id, executionContextId };
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
    assertApprovalCurrent?: () => void
  ) {
    const captured = this.infrastructureContext();
    const assertCurrent = () => {
      this.assertInfrastructureContext(captured);
      this.assertSmartAccountExecutionContext(params.executionContextId);
      if (assertApprovalCurrent !== undefined)
        assertSynchronousEvmFeeGuard(assertApprovalCurrent);
    };
    assertCurrent();
    return submitSmartAccountOperation(
      params,
      {
        chainId: store.getState().vault.activeNetwork.chainId,
        provider: this.ethereumTransaction?.web3Provider,
        assertExpectedExecutionContext: (context, id) =>
          this.assertExpectedExecutionContext(context, id),
        assertSmartAccountExecutionContext: (id) =>
          this.assertSmartAccountExecutionContext(id),
        getExecutionContext: (id) => {
          const context = this.executionContexts.get(id);
          return context?.userOperation
            ? { ...context, userOperation: context.userOperation }
            : undefined;
        },
        getSmartAccountById: (id) => this.getSmartAccountById(id),
        getWalletGasPayerAccount: (preferred, transaction, options) =>
          this.getWalletGasPayerAccount(preferred, transaction, options),
        getLocalNativeExecutionRecipients: (executions) =>
          this.getLocalNativeExecutionRecipients(executions),
        assertGasTankCoversTransaction: (request) =>
          this.assertZkSysGasTankCoversTransaction(request),
        ensureDeploymentPrefund: (...args) =>
          this.ensureSmartAccountDeploymentPrefund(...args),
        sendTransaction: (...args) =>
          this.deps.sendAndSaveEthTransaction(...args),
        invalidateMetadata: (address) =>
          this.invalidateHydratedMetadata(address),
      },
      assertCurrent
    );
  }

  private async canUseZkSysGasTankForSmartAccountTx(params: {
    chainId: number;
    gasEstimate: SmartAccountUserOpGasEstimate;
    gasPayerAddress: string;
    maxFeePerGas: BigNumber;
  }) {
    return canUseSmartAccountGasTank(
      this.ethereumTransaction?.web3Provider,
      params
    );
  }

  private async assertZkSysGasTankCoversTransaction(params: {
    chainId: number;
    gasPayerAddress: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    transaction: { data?: string; to: string; value?: string };
  }) {
    return assertSmartAccountGasTankCredit(
      this.ethereumTransaction?.web3Provider,
      params
    );
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
    options: {
      assertBeforeSign: () => void;
      assertCurrentContext: () => void;
      onAcknowledged: () => void;
      onSubmissionAttempt: () => void;
    }
  ): Promise<void> {
    return ensureSmartAccountDeploymentPrefund(
      this.ethereumTransaction?.web3Provider,
      (...args) => this.deps.sendAndSaveEthTransaction(...args),
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

  public async getSmartAccountGuardianRecoveryStatus(params: {
    account: string;
    knownOperationId?: string;
  }) {
    const context = this.infrastructureContext();
    const account = getAddress(params.account);
    const knownOperationId = params.knownOperationId?.toLowerCase();
    if (knownOperationId && !/^0x[0-9a-f]{64}$/.test(knownOperationId))
      throw new Error('Invalid guardian recovery operation ID');
    const key = `${account.toLowerCase()}:${knownOperationId || ''}`;
    for (const [pendingKey, entry] of this.guardianObservations) {
      if (!this.sameInfrastructureContext(context, entry.context))
        this.guardianObservations.delete(pendingKey);
    }
    const current = this.guardianObservations.get(key);
    if (current) return current.promise;
    const moduleAddress = getConfiguredAuthenticatorAddress(
      context.chainId,
      'guardian-recovery'
    );
    const entry = {
      context,
      promise: null as ReturnType<typeof readGuardianRecoveryObservation>,
    };
    entry.promise = readGuardianRecoveryObservation({
      account,
      chainId: context.chainId,
      moduleAddress,
      knownOperationId,
      provider: guardianStatusProvider(context.provider),
      assertCurrent: () => this.assertInfrastructureContext(context),
    }).finally(() => {
      if (this.guardianObservations.get(key) === entry)
        this.guardianObservations.delete(key);
    });
    this.guardianObservations.set(key, entry);
    return entry.promise;
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
    expectedContext?: IEvmTransactionContext;
    guardian: string;
    target: PaliRecoveryTarget;
  }) {
    const prepared = await this.prepareSmartAccountGuardianStartRecovery(
      params
    );
    if (!prepared.approval) {
      throw new Error(
        'Smart-account guardian approval must be collected from the wallet UI before submitting recovery.'
      );
    }

    return this.submitPreparedSmartAccountGuardianStartRecovery({
      account: prepared.account,
      approval: prepared.approval,
      executionContextId: prepared.executionContextId,
      expectedContext: params.expectedContext,
      gasPayer: prepared.gasPayer,
      guardian: prepared.guardian,
      operation: prepared.operation,
    });
  }

  public async prepareSmartAccountGuardianStartRecovery(params: {
    account: string;
    expectedContext?: IEvmTransactionContext;
    guardian: string;
    target: PaliRecoveryTarget;
  }) {
    const { snapshot, assertCurrent } = this.recoveryApprovalContext(
      params.expectedContext
    );
    const account = getAddress(params.account);
    const guardian = getAddress(params.guardian);
    const operation = await this.buildGuardianStartRecoveryOperation(
      account,
      params.target
    );
    assertCurrent();
    const targetContextId = this.rememberRecoverySigningContext(
      snapshot,
      operation.hash
    );
    await this.proveRecoveryTargetOwnership(
      params.target,
      operation.hash,
      targetContextId
    );
    assertCurrent();
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation,
    });
    assertCurrent();

    const localEoaGuardian = this.findLocalSigningAccount(guardian);
    if (localEoaGuardian) {
      const signature = await this.deps.signSmartAccountActionDigestInternal(
        [guardian, operation.hash],
        localEoaGuardian,
        targetContextId
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
      };
    }

    let smartGuardian: Awaited<
      ReturnType<SmartAccountController['getHydratedActiveSmartAccount']>
    >;
    try {
      smartGuardian = await this.getHydratedActiveSmartAccount(guardian);
    } catch {
      throw new Error(
        'This guardian is not available as a local Pali wallet account. Use a local EOA guardian, a local smart-account guardian, or an external recovery flow that can provide the guardian approval signature.'
      );
    }
    assertCurrent();
    if (!smartGuardian.metadata.isDeployed) {
      throw new Error(
        'Smart-account guardians must be deployed before they can approve recovery.'
      );
    }

    return {
      account,
      guardian,
      operation,
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
    executionContextId?: string;
    expectedContext?: IEvmTransactionContext;
    gasPayer?: { address: string; id: number; type: PaliKeyringAccountType };
    guardian: string;
    operation: SmartAccountGuardianRecoveryOperation;
  }) {
    const origin = this.recoveryApprovalContext(params.expectedContext);
    const assertCurrent = () => {
      origin.assertCurrent();
      if (params.executionContextId)
        this.assertSmartAccountExecutionContext(params.executionContextId);
    };
    assertCurrent();
    const account = getAddress(params.account);
    const recoveryModule = getAddress(params.operation.recoveryModule);
    const guardian = getAddress(params.guardian);
    const approvalGuardian = getAddress(params.approval.guardian);
    if (approvalGuardian !== guardian) {
      throw new Error('Guardian approval does not match recovery guardian');
    }
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation: params.operation,
    });
    assertCurrent();
    const approvals = [
      {
        guardian,
        signature: params.approval.signature,
      },
    ];
    const recoveryCallData =
      paliGuardianRecoveryModuleInterface.encodeFunctionData(
        'scheduleRecovery',
        [
          account,
          params.operation.salt,
          params.operation.mode,
          params.operation.executionCalldata,
          approvals,
        ]
      );
    try {
      const gasPayer = await this.getWalletGasPayerAccount(params.gasPayer, {
        data: recoveryCallData,
        to: recoveryModule,
        value: '0x0',
      });
      assertCurrent();
      const response = await this.deps.sendAndSaveEthTransaction(
        { data: recoveryCallData, to: recoveryModule, value: '0x0' },
        false,
        gasPayer,
        {
          smartAccountGuardianRecovery: true,
          smartAccountRecoveryAccount: account,
        },
        {
          clearNavigation: false,
          persist: true,
          assertBeforeSign: assertCurrent,
          assertCurrentContext: assertCurrent,
        }
      );

      return {
        operation: params.operation,
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
  }

  public async finalizeSmartAccountGuardianRecovery(
    params: SmartAccountGuardianRecoveryDigestContext & {
      account: string;
      chainId: number;
      executionCalldata: string;
      expectedContext?: IEvmTransactionContext;
      mode: string;
      recoveryModule?: string;
      salt: string;
    }
  ) {
    const { assertCurrent } = this.recoveryApprovalContext(
      params.expectedContext
    );
    const account = getAddress(params.account);
    const status = params.recoveryModule
      ? null
      : await this.getGuardianRecoveryStatusForAccount(account);
    const recoveryModule = params.recoveryModule || status?.moduleAddress;
    assertCurrent();
    if (!recoveryModule) {
      throw new Error(GUARDIAN_MODULE_ERROR);
    }
    await this.validateSmartAccountGuardianRecoveryOperation({
      account,
      operation: { ...params, recoveryModule },
    });
    assertCurrent();
    const callData = paliGuardianRecoveryModuleInterface.encodeFunctionData(
      'executeRecovery',
      [account, params.salt, params.mode, params.executionCalldata]
    );
    const gasPayer = await this.getWalletGasPayerAccount(undefined, {
      data: callData,
      to: recoveryModule,
      value: '0x0',
    });
    assertCurrent();

    try {
      const response = await this.deps.sendAndSaveEthTransaction(
        { data: callData, to: recoveryModule, value: '0x0' },
        false,
        { id: gasPayer.id, type: gasPayer.type },
        {
          smartAccountGuardianRecoveryFinalize: true,
          smartAccountRecoveryAccount: account,
        },
        {
          clearNavigation: false,
          persist: true,
          assertBeforeSign: assertCurrent,
          assertCurrentContext: assertCurrent,
        }
      );
      await response.wait();
      // Recovery rotates validators on the target account.
      this.invalidateHydratedMetadata(account);
      return response;
    } catch (error) {
      if (hasGuardianRecoveryNotReadyRevert(error)) {
        throw new Error(GUARDIAN_RECOVERY_NOT_READY_ERROR);
      }
      if (hasGuardianRecoveryExpiredRevert(error)) {
        throw new Error(GUARDIAN_RECOVERY_EXPIRED_ERROR);
      }
      if (hasNativeGasFailure(error)) {
        throw new Error(NATIVE_GAS_REQUIRED_ERROR);
      }
      throw error;
    }
  }

  private async buildGuardianStartRecoveryOperation(
    account: string,
    target: PaliRecoveryTarget
  ): Promise<ReturnType<typeof buildSmartAccountGuardianRecoveryOperation>> {
    const { activeNetwork } = store.getState().vault;
    const status = await this.getGuardianRecoveryStatusForAccount(account);
    const recoveryModule = status?.moduleAddress;
    if (!recoveryModule) {
      throw new Error(GUARDIAN_MODULE_ERROR);
    }
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const accountContract = new Contract(
      account,
      paliSmartAccountInterface,
      provider
    );
    const targetValidator = getAddress(target.auth.validator);
    const replaceExistingValidator = await accountContract.isModuleInstalled(
      ERC7579_MODULE_TYPE_VALIDATOR,
      targetValidator,
      '0x'
    );
    const currentSmartAccount = this.getActiveSmartAccount(account);
    const currentValidator = currentSmartAccount.metadata.auth?.validator
      ? getAddress(currentSmartAccount.metadata.auth.validator)
      : undefined;
    const revokeValidator =
      currentValidator &&
      (await accountContract.isModuleInstalled(
        ERC7579_MODULE_TYPE_VALIDATOR,
        currentValidator,
        '0x'
      ))
        ? currentValidator
        : undefined;

    return buildSmartAccountGuardianRecoveryOperation({
      account,
      chainId: activeNetwork.chainId,
      ...(await this.readGuardianRecoveryDigestContext(
        account,
        recoveryModule
      )),
      replaceExistingValidator,
      recoveryModule,
      revokeValidator,
      salt: randomBytes32Hex(),
      target,
    });
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
    const account = getAddress(params.account);
    const operation = params.operation;
    const recoveryModule = getAddress(operation.recoveryModule);
    const { activeNetwork } = store.getState().vault;
    const context = getGuardianRecoveryDigestContext(operation);
    if (
      !operation.account ||
      getAddress(operation.account) !== account ||
      operation.chainId !== activeNetwork.chainId
    ) {
      throw new Error(
        'Guardian recovery intent does not match the account or network'
      );
    }
    const status = await this.getGuardianRecoveryStatusForAccount(account);
    if (!status || getAddress(status.moduleAddress) !== recoveryModule) {
      throw new Error(
        'Guardian recovery module is not installed for this account'
      );
    }
    const current = await this.readGuardianRecoveryDigestContext(
      account,
      recoveryModule
    );
    if (current.policyEpoch !== context.policyEpoch) {
      throw new GuardianRecoveryPolicyChangedError();
    }
    const hash = getSmartAccountGuardianRecoveryHash({
      ...operation,
      ...context,
      account,
      chainId: activeNetwork.chainId,
    });
    if (
      operation.hash !== undefined &&
      operation.hash.toLowerCase() !== hash.toLowerCase()
    ) {
      throw new Error(
        'Guardian recovery approval hash does not match its intent'
      );
    }
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error(PROVIDER_UNAVAILABLE_ERROR);
    }
    const module = new Contract(
      recoveryModule,
      paliGuardianRecoveryModuleInterface,
      provider
    );
    const onChainHash = await module.getRecoveryScheduleHash(
      account,
      operation.salt,
      operation.mode,
      operation.executionCalldata
    );
    if (onChainHash.toLowerCase() !== hash.toLowerCase()) {
      throw new Error(
        'Guardian recovery digest does not match the installed policy'
      );
    }
  }

  private async proveRecoveryTargetOwnership(
    target: PaliRecoveryTarget,
    operationHash: string,
    executionContextId?: string
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
    executionContextId?: string
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
        return this.deps.signSmartAccountActionDigestInternal(
          [owner, operationHash],
          ownerAccount,
          executionContextId
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
    assertApprovalCurrent?: () => void
  ): Promise<string> {
    const captured = this.infrastructureContext();
    const assertCurrent = () => {
      this.assertInfrastructureContext(captured);
      this.assertSmartAccountExecutionContext(executionContextId, actionHash);
      if (assertApprovalCurrent !== undefined)
        assertSynchronousEvmFeeGuard(assertApprovalCurrent);
    };
    assertCurrent();
    return signSmartAccountEcdsaOperation({
      metadata,
      actionHash,
      assertCurrent,
      findOwner: (address) => this.findLocalSigningAccount(address),
      signOwner: (address, hash, owner) =>
        this.deps.signSmartAccountActionDigestInternal(
          [address, hash],
          owner,
          executionContextId,
          assertCurrent
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
        metadata = customEdit ? update(current) : update;
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
      installedModules.push({
        address: getAddress(guardianStatus.moduleAddress),
        config: {
          delaySeconds: guardianStatus.delaySeconds,
          expirationSeconds: guardianStatus.expirationSeconds,
          guardians: guardianStatus.guardians,
          threshold: guardianStatus.threshold,
        },
        data: encodeGuardianRecoveryInitData({
          delaySeconds: guardianStatus.delaySeconds,
          expirationSeconds: guardianStatus.expirationSeconds,
          guardians: guardianStatus.guardians,
          threshold: guardianStatus.threshold,
        }),
        id: 'guardian-recovery',
        type: 'executor',
      });
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
      this.ethereumTransaction?.web3Provider,
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
