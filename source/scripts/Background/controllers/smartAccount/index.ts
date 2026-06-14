import { defaultAbiCoder } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { AddressZero } from '@ethersproject/constants';
import { Contract } from '@ethersproject/contracts';

import {
  IEvmTransactionResponse,
  ISysTransaction,
} from '../transactions/types';
import store from 'state/store';
import { setAccountPropertyByIdAndType } from 'state/vault';
import {
  INetworkType,
  ISmartAccountMetadata,
  KeyringAccountType as PaliKeyringAccountType,
  SmartAccountCustomModuleRecord,
} from 'types/network';
import { blacklistService } from 'utils/security/blacklistService';
import {
  aggregateContractCalls,
  AggregateCallRequest,
  AggregateCallResult,
  clearMulticall3AddressCache,
  buildP256WebAuthnAuthenticator,
  buildHydratedP256WebAuthnAuthenticator,
  buildSmartAccountGuardianRecoveryOperation,
  buildSmartAccountUserOperation,
  encodeCompositeValidatorInitData,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
  CustomValidatorPreflightResult,
  estimateSmartAccountUserOpGas,
  getConfiguredAuthenticatorAddress,
  preflightCustomValidatorInstall,
  getPaliSmartAccountFactoryAddress,
  getPaliSmartAccountDescriptor,
  getSmartAccountGasUnitsReserve,
  getSmartAccountUserOpRequiredPrefund,
  getSmartAccountValidatorProfile,
  getSmartAccountPaymasterConfig,
  applySmartAccountPaymaster,
  buildSmartAccountPaymasterApprovalSetup,
  getSmartAccountPaymasterPreflight,
  hasSmartAccountPaymaster,
  PaliAuthConfig,
  PaliRecoveryTarget,
  PALI_SMART_ACCOUNT_VERSION,
  PaliSmartAccountAuthenticatorSetup,
  ERC7579_MODULE_TYPE_VALIDATOR,
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH,
  PALI_INFRASTRUCTURE_CONTRACTS,
  PaliInfrastructureContractId,
  PALI_ENTRYPOINT_V09_ABI,
  PALI_ENTRYPOINT_V09_ADDRESS,
  paliCompositeValidatorInterface,
  paliEcdsaValidatorInterface,
  paliGuardianRecoveryModuleInterface,
  paliP256WebAuthnValidatorInterface,
  paliSmartAccountInterface,
  SmartAccountExecution,
  SmartAccountPackedUserOperation,
  getAvailablePaliModules,
  SmartAccountAuthenticatorBuildResult,
  toPaliSmartAccount,
} from 'utils/smartAccount';

import type { ITxid } from '@sidhujag/sysweb3-utils';

export interface ISmartAccountControllerDependencies {
  createSmartAccountRecord: (params: {
    address: string;
    label?: string;
    metadata: ISmartAccountMetadata;
  }) => Promise<any>;
  getEthereumTransaction: () => any;
  getLatestUpdateForCurrentAccount: (
    isPolling?: boolean,
    forceUpdate?: boolean,
    isAssetPolling?: boolean,
    skipCache?: boolean
  ) => Promise<boolean>;
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
      clearNavigation?: boolean;
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
  signEthWithAccount: (
    params: string[],
    targetAccount: { id: number; type: PaliKeyringAccountType }
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
  pending: null;
  threshold: number;
};

type SmartAccountInfrastructureStatus = {
  chainId: number;
  contracts: Array<{
    address: string;
    deployed: boolean;
    displayName: string;
    id: PaliInfrastructureContractId;
    optional: boolean;
  }>;
  create2Deployer: {
    address: string;
    deployed: boolean;
  };
  missing: PaliInfrastructureContractId[];
  ready: boolean;
};

const GUARDIAN_RECOVERY_NOT_READY_ERROR = 'PALI_GUARDIAN_RECOVERY_NOT_READY';
const GUARDIAN_RECOVERY_NOT_READY_SELECTOR = '0x201b632a';
// RecoveryAlreadyScheduled(bytes32) on the guardian recovery module.
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR =
  'PALI_GUARDIAN_RECOVERY_ALREADY_SCHEDULED';
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_SELECTOR = '0x684d1639';
// RecoveryExpired(bytes32) on the guardian recovery module.
const GUARDIAN_RECOVERY_EXPIRED_ERROR = 'PALI_GUARDIAN_RECOVERY_EXPIRED';
const GUARDIAN_RECOVERY_EXPIRED_SELECTOR = '0x80ba2533';
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
const SMART_ACCOUNT_SIGNATURE_ERROR = 'PALI_SMART_ACCOUNT_SIGNATURE_ERROR';
const ENTRYPOINT_FAILED_OP_SELECTOR = '0x220266b6';
const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';
const HYDRATED_METADATA_TTL_MS = 30_000;

const randomBytes32Hex = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`;
};

const stringifyError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

const getErrorText = (error: unknown, depth = 0): string => {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    try {
      return [error, getErrorText(JSON.parse(error), depth + 1)]
        .filter(Boolean)
        .join(' ');
    } catch {
      return error;
    }
  }
  if (typeof error !== 'object') {
    return String(error);
  }

  const errorRecord = error as Record<string, unknown>;
  const directParts = [
    errorRecord.message,
    errorRecord.reason,
    errorRecord.code,
    errorRecord.data,
    errorRecord.error,
    errorRecord.body,
    errorRecord.response,
    errorRecord.info,
    errorRecord.transaction,
    errorRecord.tx,
  ];
  const ownPropertyParts = Object.getOwnPropertyNames(error)
    .filter((key) => key !== 'stack')
    .map((key) => errorRecord[key]);
  const parts = [
    ...directParts,
    ...ownPropertyParts,
    stringifyError(error),
  ].flatMap((value) => (value ? [getErrorText(value, depth + 1)] : []));

  return parts.filter(Boolean).join(' ');
};

const hasGuardianRecoveryNotReadyRevert = (error: unknown): boolean =>
  getErrorText(error).includes(GUARDIAN_RECOVERY_NOT_READY_SELECTOR);

const hasGuardianRecoveryAlreadyScheduledRevert = (error: unknown): boolean =>
  getErrorText(error).includes(GUARDIAN_RECOVERY_ALREADY_SCHEDULED_SELECTOR);

const hasGuardianRecoveryExpiredRevert = (error: unknown): boolean =>
  getErrorText(error).includes(GUARDIAN_RECOVERY_EXPIRED_SELECTOR);

const getEntryPointFailedOpReason = (error: unknown): string => {
  const message = getErrorText(error);
  const match = message.match(
    new RegExp(`${ENTRYPOINT_FAILED_OP_SELECTOR}[0-9a-fA-F]*`)
  );
  if (!match) {
    return '';
  }

  try {
    const [, reason] = defaultAbiCoder.decode(
      ['uint256', 'string'],
      `0x${match[0].slice(10)}`
    );
    return String(reason);
  } catch {
    return '';
  }
};

const hasNativeGasFailure = (error: unknown): boolean => {
  const message = getErrorText(error);
  const failedOpReason = getEntryPointFailedOpReason(error);
  const normalized = message.toLowerCase();
  const normalizedFailedOpReason = failedOpReason.toLowerCase();

  return (
    message.includes('OutOfNativeResourcesDuringValidation') ||
    normalized.includes(AA21_PREFUND_REASON_HEX) ||
    normalizedFailedOpReason.includes('aa21') ||
    normalizedFailedOpReason.includes("didn't pay prefund") ||
    normalizedFailedOpReason.includes('did not pay prefund') ||
    normalizedFailedOpReason.includes('prefund') ||
    normalized.includes('lackoffund') ||
    normalized.includes('lack of fund') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient balance') ||
    (normalized.includes('maxfee') && normalized.includes('fund')) ||
    normalized.includes('not enough native') ||
    normalized.includes('gas required exceeds allowance')
  );
};

const hasSmartAccountSignatureFailure = (error: unknown): boolean => {
  const message = getErrorText(error);
  const failedOpReason = getEntryPointFailedOpReason(error);

  return failedOpReason.includes('AA24') || message.includes('AA24');
};

class SmartAccountController {
  private infrastructureStatusCache?: {
    chainId: number;
    status: SmartAccountInfrastructureStatus;
  };
  private readonly pendingDeploymentAddresses = new Set<string>();
  private readonly hydratedMetadataCache = new Map<
    string,
    { metadata: ISmartAccountMetadata; timestamp: number }
  >();
  private readonly inflightHydrations = new Map<
    string,
    Promise<ISmartAccountMetadata>
  >();

  constructor(private readonly deps: ISmartAccountControllerDependencies) {}

  private get ethereumTransaction() {
    return this.deps.getEthereumTransaction();
  }

  public async assertSmartAccountSupported(): Promise<boolean> {
    const status = await this.getSmartAccountInfrastructureStatus();
    if (!status.create2Deployer.deployed) {
      throw new Error(
        'This network does not expose the canonical CREATE2 deployer required for deterministic Pali smart account deployment.'
      );
    }
    if (!status.ready) {
      throw new Error(
        'Pali smart account infrastructure is not deployed on this network. Deploy it first from Wallet Advanced settings, then try again.'
      );
    }
    return true;
  }

  public async getSmartAccountInfrastructureStatus(
    forceRefresh = false
  ): Promise<SmartAccountInfrastructureStatus> {
    const { activeNetwork, isBitcoinBased } = store.getState().vault;
    if (isBitcoinBased || activeNetwork.kind !== INetworkType.Ethereum) {
      throw new Error('Smart accounts are only available on EVM networks');
    }
    if (
      !forceRefresh &&
      this.infrastructureStatusCache?.chainId === activeNetwork.chainId
    ) {
      return this.infrastructureStatusCache.status;
    }

    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    // One batched eth_getCode round trip for the CREATE2 deployer plus every
    // infrastructure contract (falls back to parallel single calls when the
    // RPC rejects batches).
    const probeAddresses = [
      PALI_CREATE2_DEPLOYER_ADDRESS,
      ...PALI_INFRASTRUCTURE_CONTRACTS.map((contract) => contract.address),
    ];
    let codes: string[];
    try {
      if (typeof provider.sendBatch !== 'function') {
        throw new Error('Provider does not support JSON-RPC batching');
      }
      codes = await provider.sendBatch(
        'eth_getCode',
        probeAddresses.map((address) => [address, 'latest'])
      );
    } catch {
      codes = await Promise.all(
        probeAddresses.map((address) => provider.getCode(address))
      );
    }
    const create2Code = codes[0];
    const contracts = PALI_INFRASTRUCTURE_CONTRACTS.map((contract, index) => {
      const code = codes[index + 1];
      const isDeployed = Boolean(code) && code !== '0x';
      const initialized = contract.id !== 'factory' || isDeployed;
      return {
        address: contract.address,
        deployed: isDeployed,
        displayName: contract.displayName,
        id: contract.id,
        initialized,
        optional: Boolean(contract.optional),
      };
    });
    const missing = contracts
      .filter((contract) => !contract.deployed)
      .map((contract) => contract.id);
    const missingRequired = contracts
      .filter((contract) => !contract.deployed && !contract.optional)
      .map((contract) => contract.id);
    const factoryInitialized =
      contracts.find((contract) => contract.id === 'factory')?.initialized ??
      false;

    const status = {
      chainId: activeNetwork.chainId,
      contracts,
      create2Deployer: {
        address: PALI_CREATE2_DEPLOYER_ADDRESS,
        deployed:
          create2Code !== '0x' &&
          (create2Code.length - 2) / 2 >=
            PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH,
      },
      missing,
      // Optional contracts (e.g. Multicall3) never gate smart-account
      // readiness; they are deployed opportunistically.
      ready: missingRequired.length === 0 && factoryInitialized,
    };
    this.infrastructureStatusCache = {
      chainId: activeNetwork.chainId,
      status,
    };
    return status;
  }

  public async deploySmartAccountInfrastructure(): Promise<{
    deployed: PaliInfrastructureContractId[];
    skipped: PaliInfrastructureContractId[];
  }> {
    const status = await this.getSmartAccountInfrastructureStatus(true);
    if (!status.create2Deployer.deployed) {
      throw new Error(
        'Cannot deploy Pali smart account infrastructure because this network is missing the canonical CREATE2 deployer.'
      );
    }

    const deployed: PaliInfrastructureContractId[] = [];
    const skipped = status.contracts
      .filter((contract) => contract.deployed)
      .map((contract) => contract.id);

    for (const contract of PALI_INFRASTRUCTURE_CONTRACTS) {
      if (!status.missing.includes(contract.id)) {
        continue;
      }
      const response = await this.deps.sendAndSaveEthTransaction(
        {
          data: contract.deployCalldata,
          to: PALI_CREATE2_DEPLOYER_ADDRESS,
          value: '0x0',
        },
        false,
        undefined,
        {
          smartAccountInfrastructureDeployment: true,
          smartAccountInfrastructureId: contract.id,
        },
        { clearNavigation: false, persist: true }
      );
      await response.wait();
      deployed.push(contract.id);
    }

    if (deployed.includes('multicall3')) {
      clearMulticall3AddressCache(status.chainId);
    }
    await this.getSmartAccountInfrastructureStatus(true);

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
      throw new Error('Web3 provider not available');
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
        this.getNextRecoverableAccountIndex(activeNetwork.chainId)
    );
    const metadata: ISmartAccountMetadata = {
      ...authenticator.metadata,
      auth: authenticator.auth,
      availableModules: getAvailablePaliModules(activeNetwork.chainId),
      chainId: activeNetwork.chainId,
      contractVersion: PALI_SMART_ACCOUNT_VERSION,
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

  public async deriveSmartAccountRecord(accountIndex?: number) {
    await this.assertSmartAccountSupported();
    const { activeNetwork } = store.getState().vault;
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const descriptor = this.deriveSmartAccountDescriptor(
      accountIndex ?? this.getNextRecoverableAccountIndex(activeNetwork.chainId)
    );
    const managementOwner = this.getWalletManagementAddress();
    const authenticator = this.buildAuthenticatorForCreation(
      activeNetwork.chainId,
      {
        config: { owners: [managementOwner], threshold: 1 },
        id: 'ecdsa',
      }
    );
    const smartAccount = await toPaliSmartAccount({
      auth: authenticator.auth,
      chainId: activeNetwork.chainId,
      deploySalt: descriptor.deploymentSalt,
      factoryAddress: getPaliSmartAccountFactoryAddress(activeNetwork.chainId),
      provider,
    });
    const metadata: ISmartAccountMetadata = {
      ...authenticator.metadata,
      auth: authenticator.auth,
      availableModules: getAvailablePaliModules(activeNetwork.chainId),
      chainId: activeNetwork.chainId,
      contractVersion: PALI_SMART_ACCOUNT_VERSION,
      deploymentSalt: descriptor.deploymentSalt,
      descriptor,
      factoryAddress: getPaliSmartAccountFactoryAddress(activeNetwork.chainId),
      isDeployed: false,
    };
    return {
      address: smartAccount.address,
      metadata: this.getDurableSmartAccountMetadata(metadata),
    };
  }

  public async createSmartAccount(params: {
    address: string;
    label?: string;
    metadata: ISmartAccountMetadata;
  }): Promise<any> {
    const metadata = {
      ...params.metadata,
      availableModules: getAvailablePaliModules(params.metadata.chainId),
      isDeployed: params.metadata.isDeployed,
    };

    return this.deps.createSmartAccountRecord({
      address: params.address,
      label: params.label,
      metadata: this.getDurableSmartAccountMetadata(metadata),
    });
  }

  public async registerSmartAccountOnChain(params: { accountId: number }) {
    const active = this.getSmartAccountById(params.accountId);
    const metadata = active.metadata;
    const accountAddress = getAddress(active.account.address);
    if (this.pendingDeploymentAddresses.has(accountAddress)) {
      throw new Error('Smart account registration is already pending.');
    }
    if (!metadata.descriptor) {
      throw new Error(
        'Smart account descriptor is required for deterministic deployment'
      );
    }
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const code = await provider.getCode(accountAddress);
    const factoryAddress =
      metadata.factoryAddress ||
      getPaliSmartAccountFactoryAddress(metadata.chainId);
    if (code === '0x') {
      if (!metadata.auth) {
        throw new Error(
          'Smart account initial authenticator metadata is required for deployment'
        );
      }
      const auth = this.requireAuthenticator(metadata);
      const smartAccount = await toPaliSmartAccount({
        auth,
        chainId: metadata.chainId,
        deploySalt: metadata.descriptor.deploymentSalt,
        factoryAddress,
        provider,
      });
      if (smartAccount.address !== accountAddress) {
        throw new Error(
          'Stored smart account authenticator does not match the deterministic account address.'
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
          params.accountId
        );
        const signature = await this.signActionHashWithLocalEcdsaOwners(
          metadata,
          prepared.actionHash
        );
        response = await this.submitSmartAccountExecution({
          accountId: params.accountId,
          executions: prepared.executions,
          signature,
          skipRapidPolling: true,
          userOperation: prepared.userOperation,
          waitForConfirmation: true,
        });
      } finally {
        this.pendingDeploymentAddresses.delete(accountAddress);
      }
      this.invalidateHydratedMetadata(accountAddress);
      const hydratedMetadata = await this.hydrateSmartAccountMetadata(
        active.account,
        { forceRefresh: true }
      );
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: active.account.id,
          property: 'smartAccount',
          type: PaliKeyringAccountType.SmartAccount,
          value: hydratedMetadata,
        })
      );
      await this.deps.saveWalletState(
        'register-smart-account-on-chain',
        true,
        true
      );

      return {
        address: accountAddress,
        metadata: hydratedMetadata,
        transaction: response,
      };
    }

    const hydratedMetadata = await this.hydrateSmartAccountMetadata(
      active.account
    );
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

  private getDurableSmartAccountMetadata(
    metadata: ISmartAccountMetadata
  ): ISmartAccountMetadata {
    if (!metadata.isDeployed) {
      return metadata;
    }
    const durableMetadata = { ...metadata };
    delete durableMetadata.auth;
    delete durableMetadata.installedModules;
    return durableMetadata;
  }

  private deriveSmartAccountDescriptor(
    accountIndex: number
  ): NonNullable<ISmartAccountMetadata['descriptor']> {
    const { activeNetwork } = store.getState().vault;
    const factoryAddress = getPaliSmartAccountFactoryAddress(
      activeNetwork.chainId
    );
    return getPaliSmartAccountDescriptor({
      accountIndex,
      accountVersion: PALI_SMART_ACCOUNT_VERSION,
      anchor: this.getWalletRecoveryAnchor(activeNetwork.chainId),
      chainId: activeNetwork.chainId,
      factoryAddress,
    });
  }

  public async hydrateSmartAccount(
    accountId: number
  ): Promise<ISmartAccountMetadata> {
    const active = this.getSmartAccountById(accountId);
    // Explicit hydration requests (UI refresh, post-action flows) bypass the
    // short-lived metadata cache.
    const metadata = await this.hydrateSmartAccountMetadata(active.account, {
      forceRefresh: true,
    });
    await this.persistSmartAccountMetadata(
      active.account.id,
      metadata,
      'hydrate-smart-account-metadata'
    );
    return metadata;
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
      throw new Error('Web3 provider not available');
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
    record: SmartAccountCustomModuleRecord;
  }): Promise<ISmartAccountMetadata> {
    const active = this.getSmartAccountById(params.accountId);
    const address = getAddress(params.record.address);
    const existing = active.metadata.customModules || [];
    if (
      existing.some(
        (record) => record.address.toLowerCase() === address.toLowerCase()
      )
    ) {
      return active.metadata;
    }
    const metadata: ISmartAccountMetadata = {
      ...active.metadata,
      customModules: [...existing, { ...params.record, address }],
    };
    await this.persistSmartAccountMetadata(
      active.account.id,
      metadata,
      'add-smart-account-custom-module'
    );
    this.invalidateHydratedMetadata(active.account.address);
    return metadata;
  }

  /** Drops a bring-your-own module record (after on-chain uninstall). */
  public async removeSmartAccountCustomModule(params: {
    accountId: number;
    address: string;
  }): Promise<ISmartAccountMetadata> {
    const active = this.getSmartAccountById(params.accountId);
    const metadata: ISmartAccountMetadata = {
      ...active.metadata,
      customModules: (active.metadata.customModules || []).filter(
        (record) =>
          record.address.toLowerCase() !== params.address.toLowerCase()
      ),
    };
    await this.persistSmartAccountMetadata(
      active.account.id,
      metadata,
      'remove-smart-account-custom-module'
    );
    this.invalidateHydratedMetadata(active.account.address);
    return metadata;
  }

  public async getSmartAccountNativeGasStatus(params: {
    accountId: number;
  }): Promise<{
    balance: string;
    gasUnitsReserve: string;
    hasNativeGas: boolean;
    requiredBalance: string;
  }> {
    const active = this.getSmartAccountById(params.accountId);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const entryPoint = new Contract(
      PALI_ENTRYPOINT_V09_ADDRESS,
      PALI_ENTRYPOINT_V09_ABI,
      provider
    );
    const [nativeBalance, entryPointDeposit, feeData] = await Promise.all([
      provider.getBalance(active.account.address),
      entryPoint.balanceOf(active.account.address) as Promise<BigNumber>,
      provider.getFeeData(),
    ]);
    // The EntryPoint draws prefunds from the account's deposit before its
    // native balance, and refunds unused prefund (e.g. from the deployment
    // op) back to the deposit -- both are spendable for userOp gas.
    const balance = nativeBalance.add(entryPointDeposit);
    const maxFeePerGas = BigNumber.from(
      feeData.maxFeePerGas || feeData.gasPrice || 0
    );
    // Worst-case reserve for this account's validator profile; always >= the
    // limits the userOp builder will sign for a simple execution.
    const gasUnitsReserve = getSmartAccountGasUnitsReserve(active.metadata);
    const requiredBalance = gasUnitsReserve.mul(maxFeePerGas);

    return {
      balance: balance.toString(),
      gasUnitsReserve: gasUnitsReserve.toString(),
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
    options: { skipPaymaster?: boolean; useCachedMetadata?: boolean } = {}
  ) {
    await this.assertSmartAccountExecutionTargetsAllowed(params);

    const { activeNetwork } = store.getState().vault;
    const useCachedMetadata = options.useCachedMetadata !== false;
    let active = useCachedMetadata
      ? Number.isInteger(accountId)
        ? this.getSmartAccountById(accountId as number)
        : this.getActiveSmartAccount()
      : Number.isInteger(accountId)
      ? await this.getHydratedSmartAccountById(accountId as number)
      : await this.getHydratedActiveSmartAccount();
    if (
      useCachedMetadata &&
      active.metadata.isDeployed &&
      !this.hasUsableSmartAccountAuthMetadata(active.metadata)
    ) {
      active = Number.isInteger(accountId)
        ? await this.getHydratedSmartAccountById(accountId as number)
        : await this.getHydratedActiveSmartAccount();
    }
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const useDeployedCachedMetadata =
      useCachedMetadata &&
      active.metadata.isDeployed &&
      this.hasUsableSmartAccountAuthMetadata(active.metadata);
    if (!useDeployedCachedMetadata) {
      await this.assertSmartAccountSupported();
    }
    const accountContract = new Contract(
      active.account.address,
      paliSmartAccountInterface,
      provider
    );
    const auth = this.requireAuthenticator(active.metadata);
    const deploySalt =
      active.metadata.descriptor?.deploymentSalt ||
      active.metadata.deploymentSalt;
    if (!deploySalt) {
      throw new Error('Smart account deployment salt is required');
    }
    const smartAccount = await toPaliSmartAccount({
      address: active.account.address,
      auth,
      chainId: active.metadata.chainId,
      deploySalt,
      factoryAddress:
        active.metadata.factoryAddress ||
        getPaliSmartAccountFactoryAddress(active.metadata.chainId),
      provider,
    });
    const prepared = smartAccount.encodeExecutions(params);
    const validator = auth.validator;
    const nonceKey = smartAccount.getNonceKey();
    const entryPoint = new Contract(
      PALI_ENTRYPOINT_V09_ADDRESS,
      PALI_ENTRYPOINT_V09_ABI,
      provider
    );
    const code = useDeployedCachedMetadata
      ? 'cached-deployed'
      : await provider.getCode(active.account.address);
    if (code !== '0x' && !useDeployedCachedMetadata) {
      await this.assertSmartAccountExecutionModeSupported(
        accountContract,
        prepared.mode
      );
    }
    const nonce = (
      await entryPoint.getNonce(active.account.address, nonceKey)
    ).toString();
    const callData = smartAccount.encodeCalls(params);
    const feeData = await provider.getFeeData();
    const gasFees = encodeSmartAccountGasFees({
      maxFeePerGas: (feeData.maxFeePerGas || feeData.gasPrice || 0).toString(),
      maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || 0).toString(),
    });
    // Estimate tight limits: callGasLimit via eth_estimateGas with a margin
    // under the v0.9 unused-gas penalty threshold; verificationGasLimit from
    // the per-validator table (limits are inside the signed hash).
    const validatorProfile = getSmartAccountValidatorProfile(active.metadata);
    const gasEstimate = await estimateSmartAccountUserOpGas(provider, {
      callData,
      childValidatorCount: validatorProfile.childValidatorCount,
      isDeployed: code !== '0x',
      sender: active.account.address,
      validatorKind: validatorProfile.validatorKind,
    });
    const unsignedUserOperation = buildSmartAccountUserOperation({
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: gasEstimate.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit,
      }),
      callData,
      gasFees,
      initCode:
        code === '0x' ? await smartAccount.getDeploymentInitCode() : '0x',
      nonce,
      preVerificationGas: String(gasEstimate.preVerificationGas),
      sender: active.account.address,
    });
    const paymasterConfig = options.skipPaymaster
      ? undefined
      : getSmartAccountPaymasterConfig(activeNetwork);
    let paymasterPreflight: Awaited<
      ReturnType<typeof getSmartAccountPaymasterPreflight>
    >;
    if (paymasterConfig) {
      try {
        paymasterPreflight = await getSmartAccountPaymasterPreflight(
          provider,
          unsignedUserOperation,
          paymasterConfig,
          code !== '0x'
        );
      } catch (error) {
        if (paymasterConfig.mode === 'required') {
          throw error;
        }
      }
    }
    const canUsePaymaster = Boolean(paymasterPreflight?.canSponsor);
    if (
      paymasterConfig?.mode === 'required' &&
      !canUsePaymaster &&
      !paymasterPreflight?.canApprove
    ) {
      throw new Error(
        'Smart account paymaster is required but the account has insufficient token balance or allowance'
      );
    }
    const userOperation =
      paymasterConfig && canUsePaymaster
        ? applySmartAccountPaymaster(unsignedUserOperation, paymasterConfig, {
            chainId: activeNetwork.chainId,
            entryPoint: PALI_ENTRYPOINT_V09_ADDRESS,
          })
        : unsignedUserOperation;
    const actionHash = await entryPoint.getUserOpHash(userOperation);

    const executions = prepared.executions.map((execution) => ({
      ...execution,
      nonce,
    }));

    return {
      actionHash,
      execution: executions[0],
      executionCalldata: prepared.executionCalldata,
      executions,
      mode: prepared.mode,
      paymasterApprovalSetup:
        paymasterConfig && paymasterPreflight?.canApprove
          ? buildSmartAccountPaymasterApprovalSetup(
              paymasterConfig,
              paymasterPreflight.required
            )
          : undefined,
      smartAccount: active.metadata,
      userOperation,
      validator,
    };
  }

  private async assertSmartAccountExecutionTargetsAllowed(
    executions: Array<{ target: string }>
  ): Promise<void> {
    for (const execution of executions) {
      const target = getAddress(execution.target);
      const blacklistResult = await blacklistService.checkAddress(target);
      if (
        blacklistResult.isBlacklisted &&
        (blacklistResult.severity === 'critical' ||
          blacklistResult.severity === 'high')
      ) {
        throw new Error(
          `Smart account execution blocked: ${
            blacklistResult.reason || 'Target address is blacklisted'
          }. Severity: ${blacklistResult.severity}`
        );
      }
    }
  }

  private hasUsableSmartAccountAuthMetadata(
    metadata: ISmartAccountMetadata
  ): boolean {
    const auth = metadata.auth;
    if (!auth?.validator) {
      return false;
    }

    return Boolean(
      metadata.installedModules?.some(
        (module) =>
          module.type === 'validator' &&
          module.address.toLowerCase() === auth.validator.toLowerCase()
      )
    );
  }

  private async assertSmartAccountExecutionModeSupported(
    accountContract: Contract,
    mode: string
  ): Promise<void> {
    const supported = await accountContract.supportsExecutionMode(mode);
    if (!supported) {
      throw new Error(
        'This smart account does not support the requested execution mode'
      );
    }
  }

  public async submitSmartAccountExecution(params: {
    accountId?: number;
    executionCalldata?: string;
    executions?: SmartAccountExecution[];
    mode?: string;
    signature: string;
    skipRapidPolling?: boolean;
    userOperation?: SmartAccountPackedUserOperation;
    validator?: string;
    waitForConfirmation?: boolean;
  }) {
    const active = Number.isInteger(params.accountId)
      ? this.getSmartAccountById(params.accountId as number)
      : this.getActiveSmartAccount();
    if (!params.userOperation) {
      throw new Error(
        'Signed ERC-4337 UserOperation is required for smart account execution'
      );
    }
    if (
      getAddress(params.userOperation.sender) !==
      getAddress(active.account.address)
    ) {
      throw new Error(
        'Signed UserOperation does not match the active smart account'
      );
    }
    const gasPayer = await this.getWalletGasPayerAccount(
      active.metadata.deploymentGasPayer
    );
    const entryPoint = new Contract(
      PALI_ENTRYPOINT_V09_ADDRESS,
      PALI_ENTRYPOINT_V09_ABI
    );
    const signedUserOperation: SmartAccountPackedUserOperation = {
      ...params.userOperation,
      signature: params.signature,
    };
    const callData = entryPoint.interface.encodeFunctionData('handleOps', [
      [signedUserOperation],
      gasPayer.address,
    ]);
    const recipientAccounts = this.getLocalNativeExecutionRecipients(
      params.executions || []
    );

    try {
      // Self-funded first-UserOp deployment: an op carrying initCode validates
      // before anything executes, so the counterfactual account must already
      // cover the EntryPoint prefund. Paymaster-sponsored ops charge the
      // paymaster deposit instead and do not need this account top-up.
      if (
        signedUserOperation.initCode &&
        signedUserOperation.initCode !== '0x' &&
        !hasSmartAccountPaymaster(signedUserOperation)
      ) {
        await this.ensureSmartAccountDeploymentPrefund(
          active.account.address,
          signedUserOperation,
          gasPayer
        );
      }
      const response = await this.deps.sendAndSaveEthTransaction(
        { data: callData, to: PALI_ENTRYPOINT_V09_ADDRESS, value: '0x0' },
        false,
        { id: gasPayer.id, type: gasPayer.type },
        {
          smartAccountExecution: true,
          smartAccountExecutionFrom: active.account.address,
        },
        {
          clearNavigation: true,
          persist: true,
          skipRapidPolling: params.skipRapidPolling,
          transactionAccounts: [
            {
              id: active.account.id,
              type: PaliKeyringAccountType.SmartAccount,
            },
            ...recipientAccounts,
          ],
        }
      );
      // Executions may install/uninstall modules or rotate the active
      // validator; drop the cached hydrated metadata for this account.
      this.invalidateHydratedMetadata(active.account.address);
      if (params.waitForConfirmation) {
        await response.wait();
      }
      return response;
    } catch (error) {
      if (hasNativeGasFailure(error)) {
        throw new Error(NATIVE_GAS_REQUIRED_ERROR);
      }
      if (hasSmartAccountSignatureFailure(error)) {
        throw new Error(SMART_ACCOUNT_SIGNATURE_ERROR);
      }
      throw error;
    }
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
    gasPayer: { address: string; id: number; type: PaliKeyringAccountType }
  ): Promise<void> {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const entryPoint = new Contract(
      PALI_ENTRYPOINT_V09_ADDRESS,
      PALI_ENTRYPOINT_V09_ABI,
      provider
    );
    const [balance, deposit] = await Promise.all([
      provider.getBalance(accountAddress),
      entryPoint.balanceOf(accountAddress) as Promise<BigNumber>,
    ]);
    const required = getSmartAccountUserOpRequiredPrefund(userOperation);
    const shortfall = required.sub(balance).sub(deposit);
    if (shortfall.lte(0)) {
      return;
    }
    const response = await this.deps.sendAndSaveEthTransaction(
      {
        to: getAddress(accountAddress),
        value: shortfall.toHexString(),
      },
      false,
      { id: gasPayer.id, type: gasPayer.type },
      {
        smartAccountAddress: getAddress(accountAddress),
        smartAccountDeploymentPrefund: true,
      },
      { clearNavigation: false, persist: true, skipRapidPolling: true }
    );
    await response.wait();
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
  }) {
    return this.getGuardianRecoveryStatusForAccount(params.account);
  }

  public async prepareSmartAccountGuardianPolicyUpdate(params: unknown) {
    void params;
    throw new Error('Guardian policy editing is handled by module templates');
  }

  public async prepareSmartAccountGuardianRemoval(params: unknown) {
    void params;
    throw new Error('Guardian policy editing is handled by module templates');
  }

  public async submitSmartAccountGuardianPolicyTransaction(params: {
    execution: SmartAccountExecution;
    signature: string;
  }) {
    return this.submitSmartAccountExecution(params);
  }

  public async submitSmartAccountGuardianStartRecovery(params: {
    account: string;
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
      gasPayer: prepared.gasPayer,
      guardian: prepared.guardian,
      operation: prepared.operation,
    });
  }

  public async prepareSmartAccountGuardianStartRecovery(params: {
    account: string;
    guardian: string;
    target: PaliRecoveryTarget;
  }) {
    const account = getAddress(params.account);
    const guardian = getAddress(params.guardian);
    const operation = await this.buildGuardianStartRecoveryOperation(
      account,
      params.target
    );
    await this.proveRecoveryTargetOwnership(params.target, operation.hash);

    const localEoaGuardian = this.findLocalSigningAccount(guardian);
    if (localEoaGuardian) {
      return {
        account,
        approval: {
          guardian,
          signature: await this.deps.signEthWithAccount(
            [guardian, operation.hash],
            localEoaGuardian
          ),
        },
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
    if (!smartGuardian.metadata.isDeployed) {
      throw new Error(
        'Smart-account guardians must be deployed before they can approve recovery.'
      );
    }

    return {
      account,
      guardian,
      operation,
      smartGuardian: smartGuardian.metadata,
    };
  }

  public async submitPreparedSmartAccountGuardianStartRecovery(params: {
    account: string;
    approval: { guardian: string; signature: string };
    gasPayer?: { address: string; id: number; type: PaliKeyringAccountType };
    guardian: string;
    operation: ReturnType<typeof buildSmartAccountGuardianRecoveryOperation>;
  }) {
    const account = getAddress(params.account);
    const recoveryModule = getAddress(params.operation.recoveryModule);
    const guardian = getAddress(params.guardian);
    const approvalGuardian = getAddress(params.approval.guardian);
    if (approvalGuardian !== guardian) {
      throw new Error('Guardian approval does not match recovery guardian');
    }
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
      const response = await this.deps.sendAndSaveEthTransaction(
        { data: recoveryCallData, to: recoveryModule, value: '0x0' },
        false,
        gasPayer,
        {
          smartAccountGuardianRecovery: true,
          smartAccountRecoveryAccount: account,
        },
        { clearNavigation: false, persist: true }
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

  public async finalizeSmartAccountGuardianRecovery(params: {
    account: string;
    executionCalldata: string;
    mode: string;
    recoveryModule?: string;
    salt: string;
  }) {
    const account = getAddress(params.account);
    const status = params.recoveryModule
      ? null
      : await this.getGuardianRecoveryStatusForAccount(account);
    const recoveryModule = params.recoveryModule || status?.moduleAddress;
    if (!recoveryModule) {
      throw new Error('Guardian recovery module is not configured');
    }
    const callData = paliGuardianRecoveryModuleInterface.encodeFunctionData(
      'executeRecovery',
      [account, params.salt, params.mode, params.executionCalldata]
    );
    const gasPayer = await this.getWalletGasPayerAccount(undefined, {
      data: callData,
      to: recoveryModule,
      value: '0x0',
    });

    try {
      const response = await this.deps.sendAndSaveEthTransaction(
        { data: callData, to: recoveryModule, value: '0x0' },
        false,
        { id: gasPayer.id, type: gasPayer.type },
        {
          smartAccountGuardianRecoveryFinalize: true,
          smartAccountRecoveryAccount: account,
        },
        { clearNavigation: false, persist: true }
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
      throw new Error('Guardian recovery module is not configured');
    }
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
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
      replaceExistingValidator,
      recoveryModule,
      revokeValidator,
      salt: randomBytes32Hex(),
      target,
    });
  }

  private async proveRecoveryTargetOwnership(
    target: PaliRecoveryTarget,
    operationHash: string
  ): Promise<void> {
    switch (target.auth.module) {
      case 'ecdsa':
        await this.proveEcdsaRecoveryTargetOwnership(
          target.auth.data,
          operationHash
        );
        return;
      case 'p256-webauthn':
      case 'composite':
        return;
      default:
        return;
    }
  }

  private async proveEcdsaRecoveryTargetOwnership(
    initData: string,
    operationHash: string
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
        return this.deps.signEthWithAccount(
          [owner, operationHash],
          ownerAccount
        );
      })
    );
  }

  /**
   * Signs a userOp action hash with the account's configured local ECDSA
   * owners (threshold-many), mirroring the UI ecdsa authenticator driver's
   * signature encoding. Used for background-signed ops such as the explicit
   * registration no-op; non-ECDSA validators must sign through the UI.
   */
  private async signActionHashWithLocalEcdsaOwners(
    metadata: ISmartAccountMetadata,
    actionHash: string
  ): Promise<string> {
    const moduleId = metadata.auth?.module || metadata.auth?.scheme;
    if (moduleId !== 'ecdsa' || !metadata.auth?.data) {
      throw new Error(
        'Smart account registration requires an interactive signature for this validator. Submit any transaction from the account to deploy it.'
      );
    }
    const [decodedOwners, decodedThreshold] = defaultAbiCoder.decode(
      ['address[]', 'uint64'],
      metadata.auth.data
    ) as [string[], { toString: () => string }];
    const owners = decodedOwners.map((owner) => getAddress(owner));
    const threshold = Math.max(1, Number(decodedThreshold.toString()) || 1);
    const localOwners = owners.filter((owner) =>
      this.findLocalSigningAccount(owner)
    );
    if (localOwners.length < threshold) {
      throw new Error(
        'Smart account registration requires the configured ECDSA owner keys in this wallet.'
      );
    }
    const signatures = await Promise.all(
      localOwners
        .slice(0, threshold)
        .map((owner) =>
          this.deps.signEthWithAccount(
            [owner, actionHash],
            this.getLocalSigningAccount(owner)
          )
        )
    );
    return threshold === 1
      ? signatures[0]
      : defaultAbiCoder.encode(['bytes[]'], [signatures]);
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

  private async persistSmartAccountMetadata(
    accountId: number,
    metadata: ISmartAccountMetadata,
    operation: string
  ): Promise<void> {
    store.dispatch(
      setAccountPropertyByIdAndType({
        id: accountId,
        property: 'smartAccount',
        type: PaliKeyringAccountType.SmartAccount,
        value: metadata,
      })
    );
    await this.deps.saveWalletState(operation, false, true);
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
    const metadata = account.smartAccount as ISmartAccountMetadata;
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const chainId = metadata.chainId;

    const p256Address = getConfiguredAuthenticatorAddress(
      chainId,
      'p256-webauthn'
    );
    const ecdsaAddress = getConfiguredAuthenticatorAddress(chainId, 'ecdsa');
    const compositeAddress = getConfiguredAuthenticatorAddress(
      chainId,
      'composite'
    );
    const { activeNetwork } = store.getState().vault;
    const guardianModuleAddress = getConfiguredAuthenticatorAddress(
      activeNetwork.chainId,
      'guardian-recovery'
    );
    const includeGuardian = Boolean(
      guardianModuleAddress && guardianModuleAddress !== AddressZero
    );

    const isModuleInstalledCall = (
      moduleAddress: string,
      moduleType: number = ERC7579_MODULE_TYPE_VALIDATOR
    ): AggregateCallRequest => ({
      args: [moduleType, moduleAddress, '0x'],
      fn: 'isModuleInstalled',
      iface: paliSmartAccountInterface,
      target: account.address,
    });

    // Bring-your-own modules: hydration only knows builtin addresses, so the
    // durable custom records tell us which extra addresses to probe.
    // v1 scope is custom validators only (moduleType 1).
    const customRecords = (metadata.customModules || []).filter(
      (record) => record.moduleType === ERC7579_MODULE_TYPE_VALIDATOR
    );

    const calls: AggregateCallRequest[] = [
      isModuleInstalledCall(p256Address),
      {
        args: [account.address],
        fn: 'authData',
        iface: paliP256WebAuthnValidatorInterface,
        target: p256Address,
      },
      isModuleInstalledCall(ecdsaAddress),
      {
        args: [account.address],
        fn: 'owners',
        iface: paliEcdsaValidatorInterface,
        target: ecdsaAddress,
      },
      {
        args: [account.address],
        fn: 'threshold',
        iface: paliEcdsaValidatorInterface,
        target: ecdsaAddress,
      },
      isModuleInstalledCall(compositeAddress),
      {
        args: [account.address],
        fn: 'childValidators',
        iface: paliCompositeValidatorInterface,
        target: compositeAddress,
      },
      {
        args: [account.address],
        fn: 'threshold',
        iface: paliCompositeValidatorInterface,
        target: compositeAddress,
      },
      {
        args: [],
        fn: 'activeValidator',
        iface: paliSmartAccountInterface,
        target: account.address,
      },
      ...(includeGuardian
        ? ([
            {
              args: [account.address],
              fn: 'config',
              iface: paliGuardianRecoveryModuleInterface,
              target: guardianModuleAddress,
            },
            {
              args: [account.address],
              fn: 'guardians',
              iface: paliGuardianRecoveryModuleInterface,
              target: guardianModuleAddress,
            },
          ] as AggregateCallRequest[])
        : []),
      ...customRecords.map((record) =>
        isModuleInstalledCall(record.address, record.moduleType)
      ),
    ];

    const [code, results] = await Promise.all([
      provider.getCode(account.address),
      aggregateContractCalls(provider, chainId, calls),
    ]);
    if (code === '0x') {
      return {
        ...metadata,
        availableModules: getAvailablePaliModules(metadata.chainId),
        isDeployed: false,
        installedModules: metadata.installedModules || [],
      };
    }

    const installedModules: NonNullable<
      ISmartAccountMetadata['installedModules']
    > = [];

    const [p256Installed] = this.requireAggregateResult(
      results[0],
      'p256 isModuleInstalled'
    );
    if (p256Installed) {
      const [authData] = this.requireAggregateResult(
        results[1],
        'p256 authData'
      ) as unknown as [any];
      const credentialIdHash = authData.credentialIdHash || authData[2];
      const publicKey = {
        originHash: authData.originHash || authData[4],
        originLength: Number(authData.originLength || authData[5] || 0),
        rpIdHash: authData.rpIdHash || authData[3],
        x: authData.publicKeyX || authData[0],
        y: authData.publicKeyY || authData[1],
      };
      const built = buildHydratedP256WebAuthnAuthenticator({
        chainId,
        credentialIdHash,
        publicKey,
      });
      installedModules.push(...(built.metadata.installedModules || []));
    }

    const [ecdsaInstalled] = this.requireAggregateResult(
      results[2],
      'ecdsa isModuleInstalled'
    );
    if (ecdsaInstalled) {
      const [rawOwners] = this.requireAggregateResult(
        results[3],
        'ecdsa owners'
      ) as unknown as [string[]];
      const owners = rawOwners.map((owner: string) => getAddress(owner));
      const threshold = Number(
        this.requireAggregateResult(results[4], 'ecdsa threshold')[0]
      );
      installedModules.push({
        address: getAddress(ecdsaAddress),
        config: { owners, threshold },
        data: encodeEcdsaValidatorInitData(owners, threshold),
        id: 'ecdsa',
        type: 'validator',
      });
    }

    const [compositeInstalled] = this.requireAggregateResult(
      results[5],
      'composite isModuleInstalled'
    );
    if (compositeInstalled) {
      const [rawChildren] = this.requireAggregateResult(
        results[6],
        'composite childValidators'
      ) as unknown as [string[]];
      const childValidators = rawChildren.map((child: string) =>
        getAddress(child)
      );
      const threshold = Number(
        this.requireAggregateResult(results[7], 'composite threshold')[0]
      );
      installedModules.push({
        address: getAddress(compositeAddress),
        config: { childValidators, threshold },
        data: encodeCompositeValidatorInitData(childValidators, threshold),
        id: 'composite',
        type: 'validator',
      });
    }

    // Custom (bring-your-own) modules still installed on-chain. Failed
    // probes (e.g. module self-destructed) simply drop the module from the
    // installed list; the durable record remains for later re-probing.
    const customBaseIndex = 9 + (includeGuardian ? 2 : 0);
    customRecords.forEach((record, index) => {
      const probe = results[customBaseIndex + index];
      const installed = probe?.success && Boolean(probe.result[0]);
      if (installed) {
        installedModules.push({
          address: getAddress(record.address),
          config: {
            initData: record.initData,
            moduleType: record.moduleType,
            name: record.name,
          },
          data: record.initData,
          id: 'custom',
          type: 'validator',
        });
      }
    });

    if (includeGuardian) {
      const guardianStatus = this.decodeGuardianRecoveryStatus(
        guardianModuleAddress,
        results[9],
        results[10]
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
    }

    const activeValidatorAddress = getAddress(
      this.requireAggregateResult(results[8], 'activeValidator')[0] as string
    );
    const activeValidator =
      activeValidatorAddress !== AddressZero
        ? installedModules.find(
            (module) =>
              module.type === 'validator' &&
              module.address.toLowerCase() ===
                activeValidatorAddress.toLowerCase()
          )
        : null;
    const hydrated: ISmartAccountMetadata = {
      ...metadata,
      auth:
        activeValidator?.type === 'validator'
          ? {
              data: activeValidator.data || '0x',
              module: activeValidator.id,
              validator: activeValidator.address,
            }
          : undefined,
      availableModules: getAvailablePaliModules(chainId),
      isDeployed: true,
      installedModules,
    };
    return hydrated;
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
      pending: null,
      threshold,
    };
  }

  private getGuardianStatusFromHydratedMetadata(
    metadata: ISmartAccountMetadata
  ): GuardianRecoveryStatusForAccount | null {
    const module = metadata.installedModules?.find(
      (installedModule) => installedModule.id === 'guardian-recovery'
    );
    if (!module) {
      return null;
    }
    const config = (module.config || {}) as {
      delaySeconds?: number;
      expirationSeconds?: number;
      guardians?: string[];
      threshold?: number;
    };
    const guardians = (config.guardians || []).map((guardian) =>
      getAddress(guardian)
    );
    const delaySeconds = Number(config.delaySeconds || 0);
    return {
      delay: String(delaySeconds),
      delaySeconds,
      exists: true,
      expirationSeconds: Number(config.expirationSeconds || 0),
      guardianCount: String(guardians.length),
      guardians,
      moduleAddress: module.address,
      pending: null,
      threshold: Number(config.threshold || 0),
    };
  }

  private async getGuardianRecoveryStatusForAccount(
    account: string
  ): Promise<GuardianRecoveryStatusForAccount | null> {
    const { activeNetwork } = store.getState().vault;
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const moduleAddress = getConfiguredAuthenticatorAddress(
      activeNetwork.chainId,
      'guardian-recovery'
    );
    if (!moduleAddress || moduleAddress === AddressZero) {
      return null;
    }

    // Reuse a fresh (or currently running) hydration of the same account
    // instead of re-fetching guardian state with dedicated RPC calls.
    const hydrationKey = `${activeNetwork.chainId}:${account.toLowerCase()}`;
    const inflight = this.inflightHydrations.get(hydrationKey);
    if (inflight) {
      try {
        const metadata = await inflight;
        if (metadata.isDeployed) {
          return this.getGuardianStatusFromHydratedMetadata(metadata);
        }
      } catch {
        // Fall through to the dedicated fetch below.
      }
    } else {
      const cached = this.hydratedMetadataCache.get(hydrationKey);
      if (
        cached &&
        Date.now() - cached.timestamp < HYDRATED_METADATA_TTL_MS &&
        cached.metadata.isDeployed
      ) {
        return this.getGuardianStatusFromHydratedMetadata(cached.metadata);
      }
    }

    const calls: AggregateCallRequest[] = [
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
    ];
    const results = await aggregateContractCalls(
      provider,
      activeNetwork.chainId,
      calls
    );
    return this.decodeGuardianRecoveryStatus(
      moduleAddress,
      results[0],
      results[1]
    );
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
    const auth = metadata.auth;
    if (!auth) {
      throw new Error(
        'This smart account was recovered by address only. Configure or recover an authenticator before signing.'
      );
    }
    const module = auth.module || auth.scheme;
    if (!module) {
      throw new Error(
        'Smart account authenticator module metadata is required'
      );
    }
    // Custom (bring-your-own) validators have no Pali-native signer; those
    // flows must go through the external-signature drivers instead. The
    // lockout guard prevents activating a custom validator, so reaching this
    // implies out-of-band state (e.g. external rotation).
    if (module === 'custom') {
      throw new Error(
        'The active validator is a custom module Pali cannot sign with. Switch to a Pali-signable validator first.'
      );
    }
    return {
      data: auth.data,
      module,
      validator: auth.validator,
    };
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

  private getWalletRecoveryAnchor(chainId: number): string {
    const managementAddress = this.getWalletManagementAddress();

    if (!managementAddress) {
      throw new Error(
        'A wallet management address is required for smart-account recovery lookup'
      );
    }

    return `pali:eip155:${chainId}:${getAddress(
      managementAddress
    ).toLowerCase()}:smart-account-v1`;
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
      throw new Error(
        'A wallet management address is required for smart-account recovery lookup'
      );
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
    }
  ): Promise<{
    address: string;
    id: number;
    type: PaliKeyringAccountType;
  }> {
    const { accounts, activeAccount } = store.getState().vault;
    const provider = this.ethereumTransaction?.web3Provider;
    const candidates: Array<{ id: number; type: PaliKeyringAccountType }> = [];
    if (
      preferred?.type &&
      preferred.type !== PaliKeyringAccountType.SmartAccount
    ) {
      candidates.push({ id: preferred.id, type: preferred.type });
    }
    if (activeAccount.type !== PaliKeyringAccountType.SmartAccount) {
      candidates.push({ id: activeAccount.id, type: activeAccount.type });
    }
    candidates.push({ id: 0, type: PaliKeyringAccountType.HDAccount });
    candidates.push(
      ...Object.keys(accounts[PaliKeyringAccountType.Imported] || {}).map(
        (id) => ({
          id: Number(id),
          type: PaliKeyringAccountType.Imported,
        })
      )
    );

    const seen = new Set<string>();
    const gasPayers: Array<{
      account: any;
      address: string;
      id: number;
      type: PaliKeyringAccountType;
    }> = [];

    for (const candidate of candidates) {
      const candidateKey = `${candidate.type}:${candidate.id}`;
      if (seen.has(candidateKey)) {
        continue;
      }
      seen.add(candidateKey);
      const account = accounts[candidate.type]?.[candidate.id];
      if (account?.address) {
        if (
          preferred &&
          candidate.id === preferred.id &&
          candidate.type === preferred.type &&
          getAddress(account.address) !== getAddress(preferred.address)
        ) {
          continue;
        }
        gasPayers.push({
          account,
          address: getAddress(account.address),
          id: candidate.id,
          type: candidate.type,
        });
      }
    }

    const toGasPayer = ({
      address,
      id,
      type,
    }: {
      address: string;
      id: number;
      type: PaliKeyringAccountType;
    }) => ({ address, id, type });

    if (provider) {
      if (transaction) {
        // Shared lookups hoisted out of the candidate loop: one fee-data call
        // and one batched balance fetch instead of repeating both per
        // candidate. Gas estimation stays per candidate because it depends on
        // the `from` address.
        const [feeData, balances] = await Promise.all([
          provider.getFeeData(),
          this.getNativeBalances(
            provider,
            gasPayers.map((candidate) => candidate.address)
          ),
        ]);
        const maxFeePerGas = BigNumber.from(
          feeData.maxFeePerGas || feeData.gasPrice || 0
        );
        for (let index = 0; index < gasPayers.length; index += 1) {
          const gasPayer = toGasPayer(gasPayers[index]);
          const balance = balances[index];
          try {
            const gasLimit = await provider.estimateGas({
              data: transaction.data || '0x',
              from: gasPayer.address,
              to: transaction.to,
              value: transaction.value || '0x0',
            });
            const requiredBalance = gasLimit
              .mul(maxFeePerGas)
              .add(BigNumber.from(transaction.value || '0x0'));
            if (balance.gte(requiredBalance)) {
              return gasPayer;
            }
          } catch (error) {
            if (hasGuardianRecoveryNotReadyRevert(error)) {
              throw error;
            }
            if (!hasNativeGasFailure(error)) {
              throw error;
            }
          }
        }
        throw new Error(NATIVE_GAS_REQUIRED_ERROR);
      }

      const cachedFundedGasPayer = gasPayers.find(({ account }) =>
        this.hasCachedNativeBalance(account)
      );
      if (cachedFundedGasPayer) {
        return toGasPayer(cachedFundedGasPayer);
      }

      const balances = await this.getNativeBalances(
        provider,
        gasPayers.map((candidate) => candidate.address)
      );
      for (let index = 0; index < gasPayers.length; index += 1) {
        if (!balances[index].isZero()) {
          return toGasPayer(gasPayers[index]);
        }
      }
    }

    if (gasPayers[0]) {
      return toGasPayer(gasPayers[0]);
    }

    throw new Error(
      'A local EVM account is required to submit ERC-4337 operations'
    );
  }

  private async getNativeBalances(
    provider: any,
    addresses: string[]
  ): Promise<BigNumber[]> {
    if (addresses.length === 0) {
      return [];
    }
    if (addresses.length > 1 && typeof provider.sendBatch === 'function') {
      try {
        const results = await provider.sendBatch(
          'eth_getBalance',
          addresses.map((address) => [address, 'latest'])
        );
        return results.map((result: string) => BigNumber.from(result || 0));
      } catch {
        // Fall back to individual calls below.
      }
    }
    return Promise.all(
      addresses.map((address) => provider.getBalance(address))
    );
  }

  private hasCachedNativeBalance(account: any): boolean {
    const balance = account?.balances?.[INetworkType.Ethereum];
    if (balance === undefined || balance === null) {
      return false;
    }
    return Number(balance) > 0;
  }
}

export default SmartAccountController;
