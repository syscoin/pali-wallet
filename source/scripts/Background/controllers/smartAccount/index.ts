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
} from 'types/network';
import { blacklistService } from 'utils/security/blacklistService';
import {
  buildP256WebAuthnAuthenticator,
  buildHydratedP256WebAuthnAuthenticator,
  buildSmartAccountGuardianRecoveryOperation,
  buildSmartAccountUserOperation,
  encodeCompositeValidatorInitData,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
  getConfiguredAuthenticatorAddress,
  getPaliSmartAccountFactoryAddress,
  getPaliSmartAccountDescriptor,
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

type SmartAccountInfrastructureStatus = {
  chainId: number;
  contracts: Array<{
    address: string;
    deployed: boolean;
    displayName: string;
    id: PaliInfrastructureContractId;
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
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
const SMART_ACCOUNT_SIGNATURE_ERROR = 'PALI_SMART_ACCOUNT_SIGNATURE_ERROR';
const ENTRYPOINT_FAILED_OP_SELECTOR = '0x220266b6';
const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';
const SMART_ACCOUNT_USER_OP_GAS_RESERVE = BigNumber.from(2_050_000);

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

    const [create2Code, contracts] = await Promise.all([
      provider.getCode(PALI_CREATE2_DEPLOYER_ADDRESS),
      Promise.all(
        PALI_INFRASTRUCTURE_CONTRACTS.map(async (contract) => {
          const code = await provider.getCode(contract.address);
          const isDeployed = code !== '0x';
          const initialized = contract.id !== 'factory' || isDeployed;
          return {
            address: contract.address,
            deployed: isDeployed,
            displayName: contract.displayName,
            id: contract.id,
            initialized,
          };
        })
      ),
    ]);
    const missing = contracts
      .filter((contract) => !contract.deployed)
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
      ready: missing.length === 0 && factoryInitialized,
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
      const { factoryData: deploymentCalldata } =
        await smartAccount.getFactoryArgs();
      const gasPayer = await this.getWalletGasPayerAccount();
      this.pendingDeploymentAddresses.add(accountAddress);
      let response: IEvmTransactionResponse;
      try {
        response = await this.deps.sendAndSaveEthTransaction(
          {
            data: deploymentCalldata,
            to: factoryAddress,
            value: '0x0',
          },
          false,
          { id: gasPayer.id, type: gasPayer.type },
          {
            smartAccountDeployment: true,
            smartAccountAddress: accountAddress,
            smartAccountAuthenticator:
              metadata.auth.module || metadata.auth.scheme,
          },
          { clearNavigation: false, persist: true }
        );
        await response.wait();
      } finally {
        this.pendingDeploymentAddresses.delete(accountAddress);
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
    const metadata = await this.hydrateSmartAccountMetadata(active.account);
    await this.persistSmartAccountMetadata(
      active.account.id,
      metadata,
      'hydrate-smart-account-metadata'
    );
    return metadata;
  }

  public async switchSmartAccountValidator(params: {
    accountId: number;
    validator: string;
  }): Promise<ISmartAccountMetadata> {
    const { account, metadata: cachedMetadata } = this.getSmartAccountById(
      params.accountId
    );
    const validatorAddress = getAddress(params.validator);
    let metadata = cachedMetadata;
    let validator = metadata.installedModules?.find(
      (module) =>
        module.type === 'validator' &&
        module.address.toLowerCase() === validatorAddress.toLowerCase()
    );
    if (validator) {
      const provider = this.ethereumTransaction?.web3Provider;
      if (!provider) {
        throw new Error('Web3 provider not available');
      }

      if (metadata.isDeployed) {
        const accountContract = new Contract(
          account.address,
          paliSmartAccountInterface,
          provider
        );
        const isInstalled = await accountContract.isModuleInstalled(
          ERC7579_MODULE_TYPE_VALIDATOR,
          validatorAddress,
          '0x'
        );
        if (!isInstalled) {
          metadata = await this.hydrateSmartAccount(account.id);
          validator = metadata.installedModules?.find(
            (module) =>
              module.type === 'validator' &&
              module.address.toLowerCase() === validatorAddress.toLowerCase()
          );
        }
      } else if ((await provider.getCode(account.address)) !== '0x') {
        metadata = await this.hydrateSmartAccount(account.id);
        validator = metadata.installedModules?.find(
          (module) =>
            module.type === 'validator' &&
            module.address.toLowerCase() === validatorAddress.toLowerCase()
        );
      }
    }
    if (!validator) {
      const hydrated = await this.getHydratedSmartAccountById(params.accountId);
      metadata = hydrated.metadata;
      validator = metadata.installedModules?.find(
        (module) =>
          module.type === 'validator' &&
          module.address.toLowerCase() === validatorAddress.toLowerCase()
      );
    }
    if (!validator || validator.type !== 'validator') {
      throw new Error(
        'Selected validator is not installed on this smart account'
      );
    }

    const updatedMetadata: ISmartAccountMetadata = {
      ...metadata,
      auth: {
        data: validator.data || '0x',
        module: validator.id,
        validator: validator.address,
      },
    };
    store.dispatch(
      setAccountPropertyByIdAndType({
        id: account.id,
        property: 'smartAccount',
        type: PaliKeyringAccountType.SmartAccount,
        value: updatedMetadata,
      })
    );
    await this.deps.saveWalletState(
      'switch-smart-account-validator',
      true,
      true
    );

    return updatedMetadata;
  }

  public async getSmartAccountNativeGasStatus(params: {
    accountId: number;
  }): Promise<{
    balance: string;
    hasNativeGas: boolean;
    requiredBalance: string;
  }> {
    const active = this.getSmartAccountById(params.accountId);
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }

    const [balance, feeData] = await Promise.all([
      provider.getBalance(active.account.address),
      provider.getFeeData(),
    ]);
    const maxFeePerGas = BigNumber.from(
      feeData.maxFeePerGas || feeData.gasPrice || 0
    );
    const requiredBalance = SMART_ACCOUNT_USER_OP_GAS_RESERVE.mul(maxFeePerGas);

    return {
      balance: balance.toString(),
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
    options: { useCachedMetadata?: boolean } = {}
  ) {
    await this.assertSmartAccountExecutionTargetsAllowed(params);

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
    const userOperation = buildSmartAccountUserOperation({
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: 1_000_000,
        verificationGasLimit: 1_000_000,
      }),
      callData,
      gasFees,
      initCode:
        code === '0x' ? await smartAccount.getDeploymentInitCode() : '0x',
      nonce,
      preVerificationGas: '50000',
      sender: active.account.address,
    });
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
    const account = getAddress(params.account);
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
    const targetValidator = getAddress(params.target.auth.validator);
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
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account,
      chainId: activeNetwork.chainId,
      replaceExistingValidator,
      recoveryModule,
      revokeValidator,
      salt: randomBytes32Hex(),
      target: params.target,
    });
    await this.proveRecoveryTargetOwnership(params.target, operation.hash);
    const guardianAccount = this.getLocalSigningAccount(params.guardian);
    const guardianSignature = await this.deps.signEthWithAccount(
      [params.guardian, operation.hash],
      guardianAccount
    );
    const recoveryCallData =
      paliGuardianRecoveryModuleInterface.encodeFunctionData(
        'scheduleRecovery',
        [
          account,
          operation.salt,
          operation.mode,
          operation.executionCalldata,
          [guardianSignature],
        ]
      );
    const response = await this.deps.sendAndSaveEthTransaction(
      { data: recoveryCallData, to: recoveryModule, value: '0x0' },
      false,
      guardianAccount,
      {
        smartAccountGuardianRecovery: true,
        smartAccountRecoveryAccount: account,
      },
      { clearNavigation: false, persist: true }
    );

    return {
      operation,
      transaction: response,
    };
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
      return response;
    } catch (error) {
      if (hasGuardianRecoveryNotReadyRevert(error)) {
        throw new Error(GUARDIAN_RECOVERY_NOT_READY_ERROR);
      }
      if (hasNativeGasFailure(error)) {
        throw new Error(NATIVE_GAS_REQUIRED_ERROR);
      }
      throw error;
    }
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

  private getLocalSigningAccount(address: string): {
    id: number;
    type: PaliKeyringAccountType;
  } {
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

  private async hydrateSmartAccountMetadata(
    account: any
  ): Promise<ISmartAccountMetadata> {
    const metadata = account.smartAccount as ISmartAccountMetadata;
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      throw new Error('Web3 provider not available');
    }
    const code = await provider.getCode(account.address);
    if (code === '0x') {
      return {
        ...metadata,
        availableModules: getAvailablePaliModules(metadata.chainId),
        isDeployed: false,
        installedModules: metadata.installedModules || [],
      };
    }

    const accountContract = new Contract(
      account.address,
      paliSmartAccountInterface,
      provider
    );
    const chainId = metadata.chainId;
    const installedModules: NonNullable<
      ISmartAccountMetadata['installedModules']
    > = [];

    const p256Address = getConfiguredAuthenticatorAddress(
      chainId,
      'p256-webauthn'
    );
    if (
      await accountContract.isModuleInstalled(
        ERC7579_MODULE_TYPE_VALIDATOR,
        p256Address,
        '0x'
      )
    ) {
      const validator = new Contract(
        p256Address,
        paliP256WebAuthnValidatorInterface,
        provider
      );
      const authData = await validator.authData(account.address);
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

    const ecdsaAddress = getConfiguredAuthenticatorAddress(chainId, 'ecdsa');
    if (
      await accountContract.isModuleInstalled(
        ERC7579_MODULE_TYPE_VALIDATOR,
        ecdsaAddress,
        '0x'
      )
    ) {
      const validator = new Contract(
        ecdsaAddress,
        paliEcdsaValidatorInterface,
        provider
      );
      const owners = (await validator.owners(account.address)).map(
        (owner: string) => getAddress(owner)
      );
      const threshold = Number(await validator.threshold(account.address));
      installedModules.push({
        address: getAddress(ecdsaAddress),
        config: { owners, threshold },
        data: encodeEcdsaValidatorInitData(owners, threshold),
        id: 'ecdsa',
        type: 'validator',
      });
    }

    const compositeAddress = getConfiguredAuthenticatorAddress(
      chainId,
      'composite'
    );
    if (
      await accountContract.isModuleInstalled(
        ERC7579_MODULE_TYPE_VALIDATOR,
        compositeAddress,
        '0x'
      )
    ) {
      const validator = new Contract(
        compositeAddress,
        paliCompositeValidatorInterface,
        provider
      );
      const childValidators = (
        await validator.childValidators(account.address)
      ).map((child: string) => getAddress(child));
      const threshold = Number(await validator.threshold(account.address));
      installedModules.push({
        address: getAddress(compositeAddress),
        config: { childValidators, threshold },
        data: encodeCompositeValidatorInitData(childValidators, threshold),
        id: 'composite',
        type: 'validator',
      });
    }

    const guardianStatus = await this.getGuardianRecoveryStatusForAccount(
      account.address
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

    const activeValidator =
      installedModules.find(
        (module) =>
          module.type === 'validator' &&
          module.address.toLowerCase() ===
            metadata.auth?.validator?.toLowerCase()
      ) ||
      installedModules.find((module) => module.type === 'validator') ||
      null;
    const hydrated: ISmartAccountMetadata = {
      ...metadata,
      ...(activeValidator?.type === 'validator'
        ? {
            auth: {
              data: activeValidator.data || '0x',
              module: activeValidator.id,
              validator: activeValidator.address,
            },
          }
        : {}),
      availableModules: getAvailablePaliModules(chainId),
      isDeployed: true,
      installedModules,
    };
    return hydrated;
  }

  private async getGuardianRecoveryStatusForAccount(account: string): Promise<{
    delay: string;
    delaySeconds: number;
    exists: boolean;
    expirationSeconds: number;
    guardianCount: string;
    guardians: string[];
    moduleAddress: string;
    pending: null;
    threshold: number;
  } | null> {
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
    const module = new Contract(
      moduleAddress,
      paliGuardianRecoveryModuleInterface,
      provider
    );
    const config = await module.config(account);
    const installed = Boolean(config.installed ?? config[3]);
    if (!installed) {
      return null;
    }
    const guardians = (await module.guardians(account)).map(
      (guardian: string) => getAddress(guardian)
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
        for (const gasPayerCandidate of gasPayers) {
          const gasPayer = toGasPayer(gasPayerCandidate);
          try {
            const [balance, feeData, gasLimit] = await Promise.all([
              provider.getBalance(gasPayer.address),
              provider.getFeeData(),
              provider.estimateGas({
                data: transaction.data || '0x',
                from: gasPayer.address,
                to: transaction.to,
                value: transaction.value || '0x0',
              }),
            ]);
            const maxFeePerGas = BigNumber.from(
              feeData.maxFeePerGas || feeData.gasPrice || 0
            );
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

      for (const gasPayerCandidate of gasPayers) {
        const gasPayer = toGasPayer(gasPayerCandidate);
        const balance = await provider.getBalance(gasPayer.address);
        if (!balance.isZero()) {
          return gasPayer;
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

  private hasCachedNativeBalance(account: any): boolean {
    const balance = account?.balances?.[INetworkType.Ethereum];
    if (balance === undefined || balance === null) {
      return false;
    }
    return Number(balance) > 0;
  }
}

export default SmartAccountController;
