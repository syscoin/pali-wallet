import { Interface } from '@ethersproject/abi';
import { Contract } from '@ethersproject/contracts';

import {
  PALI_CANONICAL_ENTRYPOINT_ADDRESS,
  PALI_CANONICAL_FACTORY_ADDRESS,
  PALI_MODULE_CANONICAL_ADDRESSES,
} from './deployment';
import type { Provider } from '@ethersproject/providers';

export const PALI_SMART_ACCOUNT_VERSION = 'PALI_SMART_ACCOUNT_ERC7579_V1';

export const ERC7579_MODULE_TYPE_VALIDATOR = 1;
export const ERC7579_MODULE_TYPE_EXECUTOR = 2;

export type PaliAuthenticatorModuleId =
  | 'composite'
  | 'ecdsa'
  | 'guardian-recovery'
  | 'p256-webauthn';

export type PaliSmartAccountAuthenticatorId = Exclude<
  PaliAuthenticatorModuleId,
  'guardian-recovery'
>;

export type PaliModuleRegistryEntry = {
  addresses: Partial<Record<number, string>>;
  capability?: 'p256-precompile';
  displayName: string;
  id: PaliAuthenticatorModuleId;
  moduleType: number;
};

export const PALI_ERC7579_FACTORY_ADDRESSES: Partial<Record<number, string>> =
  {};

export const PALI_ECDSA_VALIDATOR_ADDRESSES: Partial<Record<number, string>> =
  {};

export const PALI_P256_WEBAUTHN_VALIDATOR_ADDRESSES: Partial<
  Record<number, string>
> = {};

export const PALI_COMPOSITE_VALIDATOR_ADDRESSES: Partial<
  Record<number, string>
> = {};

export const PALI_GUARDIAN_RECOVERY_MODULE_ADDRESSES: Partial<
  Record<number, string>
> = {};

export const PALI_MODULE_REGISTRY: PaliModuleRegistryEntry[] = [
  {
    addresses: PALI_P256_WEBAUTHN_VALIDATOR_ADDRESSES,
    capability: 'p256-precompile',
    displayName: 'Passkey',
    id: 'p256-webauthn',
    moduleType: ERC7579_MODULE_TYPE_VALIDATOR,
  },
  {
    addresses: PALI_ECDSA_VALIDATOR_ADDRESSES,
    displayName: 'ECDSA',
    id: 'ecdsa',
    moduleType: ERC7579_MODULE_TYPE_VALIDATOR,
  },
  {
    addresses: PALI_COMPOSITE_VALIDATOR_ADDRESSES,
    displayName: 'Composite policy',
    id: 'composite',
    moduleType: ERC7579_MODULE_TYPE_VALIDATOR,
  },
  {
    addresses: PALI_GUARDIAN_RECOVERY_MODULE_ADDRESSES,
    displayName: 'Guardian recovery',
    id: 'guardian-recovery',
    moduleType: ERC7579_MODULE_TYPE_EXECUTOR,
  },
];

export const PALI_ERC7579_FACTORY_ABI = [
  'function createAccount(bytes32 salt,bytes initCode) payable returns (address account)',
  'function createAccountWithModules(bytes32 salt,(address module,bytes data)[] validators,(address module,bytes data)[] executors,(address module,bytes data) fallbackHandler,(address module,bytes data)[] hooks) payable returns (address account)',
  'function getAddress(bytes32 salt,bytes initCode) view returns (address)',
  'function getInitData(bytes initCode) view returns (bytes)',
  'function getInitData((address module,bytes data)[] validators,(address module,bytes data)[] executors,(address module,bytes data) fallbackHandler,(address module,bytes data)[] hooks) view returns (bytes)',
  'function getInitData(address validator,bytes initData) view returns (bytes)',
  'function implementation() view returns (address)',
] as const;

export const PALI_SMART_ACCOUNT_ABI = [
  'function accountId() view returns (string)',
  'function entryPoint() view returns (address)',
  'function execute(bytes32 mode,bytes executionCalldata) payable',
  'function executeFromExecutor(bytes32 mode,bytes executionCalldata) payable returns (bytes[] returnData)',
  'function getNonce(uint192 key) view returns (uint256)',
  'function installModule(uint256 moduleTypeId,address module,bytes initData)',
  'function uninstallModule(uint256 moduleTypeId,address module,bytes deInitData)',
  'function isModuleInstalled(uint256 moduleTypeId,address module,bytes additionalContext) view returns (bool)',
  'function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)',
  'function supportsExecutionMode(bytes32 mode) view returns (bool)',
  'function supportsModule(uint256 moduleTypeId) view returns (bool)',
  'function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp,bytes32 userOpHash,uint256 missingAccountFunds) returns (uint256)',
] as const;

export const PALI_ENTRYPOINT_V09_ADDRESS = PALI_CANONICAL_ENTRYPOINT_ADDRESS;

export const PALI_ENTRYPOINT_V09_ABI = [
  'function getNonce(address sender,uint192 key) view returns (uint256 nonce)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address payable beneficiary)',
] as const;

export const PALI_ECDSA_VALIDATOR_ABI = [
  'function isInitialized(address account) view returns (bool)',
  'function isModuleType(uint256 moduleTypeId) view returns (bool)',
  'function isValidSignatureWithSender(address sender,bytes32 hash,bytes signature) view returns (bytes4)',
  'function onInstall(bytes data)',
  'function onUninstall(bytes data)',
  'function owners(address account) view returns (address[])',
  'function threshold(address account) view returns (uint64)',
  'function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp,bytes32 userOpHash) view returns (uint256)',
] as const;

export const PALI_P256_WEBAUTHN_VALIDATOR_ABI = [
  'function isInitialized(address account) view returns (bool)',
  'function isModuleType(uint256 moduleTypeId) view returns (bool)',
  'function isValidSignatureWithSender(address sender,bytes32 hash,bytes signature) view returns (bytes4)',
  'function onInstall(bytes data)',
  'function onUninstall(bytes data)',
  'function authData(address account) view returns ((bytes32 publicKeyX,bytes32 publicKeyY,bytes32 credentialIdHash,bytes32 rpIdHash,bytes32 originHash,uint256 originLength))',
  'function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp,bytes32 userOpHash) view returns (uint256)',
] as const;

export const PALI_COMPOSITE_VALIDATOR_ABI = [
  'function childValidators(address account) view returns (address[])',
  'function isInitialized(address account) view returns (bool)',
  'function isModuleType(uint256 moduleTypeId) view returns (bool)',
  'function isValidSignatureWithSender(address sender,bytes32 hash,bytes signature) view returns (bytes4)',
  'function onInstall(bytes data)',
  'function onUninstall(bytes data)',
  'function threshold(address account) view returns (uint64)',
  'function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp,bytes32 userOpHash) view returns (uint256)',
] as const;

export const PALI_GUARDIAN_RECOVERY_MODULE_ABI = [
  'event RecoveryScheduled(address indexed account,bytes32 indexed operationId,uint48 executableAt)',
  'event RecoveryCanceled(address indexed account,bytes32 indexed operationId)',
  'event RecoveryExecuted(address indexed account,bytes32 indexed operationId)',
  'function cancelRecovery(address account,bytes32 salt,bytes32 mode,bytes executionCalldata)',
  'function config(address account) view returns ((uint32 delay,uint32 expiration,uint64 threshold,bool installed))',
  'function executeRecovery(address account,bytes32 salt,bytes32 mode,bytes executionCalldata) returns (bytes[] returnData)',
  'function getOperationId(address account,bytes32 salt,bytes32 mode,bytes executionCalldata) pure returns (bytes32)',
  'function getRecoveryScheduleHash(address account,bytes32 salt,bytes32 mode,bytes executionCalldata) view returns (bytes32)',
  'function guardians(address account) view returns (address[])',
  'function isGuardian(address account,address guardian) view returns (bool)',
  'function isInitialized(address account) view returns (bool)',
  'function isModuleType(uint256 moduleTypeId) view returns (bool)',
  'function onInstall(bytes data)',
  'function onUninstall(bytes data)',
  'function scheduleRecovery(address account,bytes32 salt,bytes32 mode,bytes executionCalldata,bytes[] signatures) returns (bytes32 operationId)',
] as const;

export const getPaliModuleRegistryEntry = (id: PaliAuthenticatorModuleId) => {
  const entry = PALI_MODULE_REGISTRY.find((module) => module.id === id);
  if (!entry) {
    throw new Error(`Unknown Pali ERC-7579 module: ${id}`);
  }
  return entry;
};

export const getPaliModuleAddress = (
  chainId: number,
  id: PaliAuthenticatorModuleId
): string => {
  const entry = getPaliModuleRegistryEntry(id);
  return entry.addresses[chainId] || PALI_MODULE_CANONICAL_ADDRESSES[id];
};

export const getPaliSmartAccountFactoryAddress = (chainId: number): string =>
  PALI_ERC7579_FACTORY_ADDRESSES[chainId] || PALI_CANONICAL_FACTORY_ADDRESS;

export const getPaliP256WebAuthnValidatorAddress = (chainId: number): string =>
  getPaliModuleAddress(chainId, 'p256-webauthn');

export const getPaliSmartAccountFactory = (
  chainId: number,
  provider: Provider
): Contract =>
  new Contract(
    getPaliSmartAccountFactoryAddress(chainId),
    PALI_ERC7579_FACTORY_ABI,
    provider
  );

export const paliSmartAccountFactoryInterface = new Interface(
  PALI_ERC7579_FACTORY_ABI
);
export const paliEntryPointInterface = new Interface(PALI_ENTRYPOINT_V09_ABI);
export const paliSmartAccountInterface = new Interface(PALI_SMART_ACCOUNT_ABI);
export const paliGuardianRecoveryModuleInterface = new Interface(
  PALI_GUARDIAN_RECOVERY_MODULE_ABI
);
export const paliEcdsaValidatorInterface = new Interface(
  PALI_ECDSA_VALIDATOR_ABI
);
export const paliP256WebAuthnValidatorInterface = new Interface(
  PALI_P256_WEBAUTHN_VALIDATOR_ABI
);
export const paliCompositeValidatorInterface = new Interface(
  PALI_COMPOSITE_VALIDATOR_ABI
);
