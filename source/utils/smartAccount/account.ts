import { defaultAbiCoder } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { hexConcat, hexZeroPad } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';

import type {
  ISmartAccountMetadata,
  KeyringAccountType,
  SmartAccountP256WebAuthnConfig,
} from 'types/network';

import {
  ERC7579_MODULE_TYPE_EXECUTOR,
  ERC7579_MODULE_TYPE_VALIDATOR,
  getPaliModuleAddress,
  PaliAuthenticatorModuleId,
  PaliSmartAccountAuthenticatorId,
  paliSmartAccountInterface,
} from './contracts';

export const ERC7579_CALL_TYPE_SINGLE = '0x00';
export const ERC7579_CALL_TYPE_BATCH = '0x01';
export const ERC7579_EXEC_TYPE_DEFAULT = '0x00';
export const ERC7579_MODE_SELECTOR_DEFAULT = '0x00000000';
export const ERC7579_MODE_PAYLOAD_DEFAULT =
  '0x00000000000000000000000000000000000000000000';

export const encodeERC7579Mode = ({
  callType = ERC7579_CALL_TYPE_SINGLE,
  execType = ERC7579_EXEC_TYPE_DEFAULT,
  selector = ERC7579_MODE_SELECTOR_DEFAULT,
  payload = ERC7579_MODE_PAYLOAD_DEFAULT,
}: {
  callType?: string;
  execType?: string;
  payload?: string;
  selector?: string;
} = {}) => hexConcat([callType, execType, '0x00000000', selector, payload]);

export const ERC7579_MODE_SINGLE_DEFAULT = encodeERC7579Mode();
export const ERC7579_MODE_BATCH_DEFAULT = encodeERC7579Mode({
  callType: ERC7579_CALL_TYPE_BATCH,
});

export type SmartAccountExecution = {
  data: string;
  nonce?: string;
  target: string;
  value: string;
};

export type SmartAccountAuthConfig = {
  data: string;
  module: PaliSmartAccountAuthenticatorId;
  validator: string;
};

export type SmartAccountP256WebAuthnAuthenticatorConfig = {
  backupStatus?: SmartAccountP256WebAuthnConfig['backupStatus'];
  credentialId: string;
  credentialIdHash: string;
  passkeyName: string;
  publicKey: SmartAccountP256WebAuthnConfig['publicKey'];
};

export type SmartAccountEcdsaAuthenticatorConfig = {
  owners: string[];
  threshold?: number;
};

export type SmartAccountCompositeAuthenticatorConfig = {
  childValidators: string[];
  threshold?: number;
};

export type SmartAccountAuthenticatorSetup =
  | {
      config: SmartAccountP256WebAuthnAuthenticatorConfig;
      id: 'p256-webauthn';
    }
  | {
      config: SmartAccountEcdsaAuthenticatorConfig;
      id: 'ecdsa';
    }
  | {
      config: SmartAccountCompositeAuthenticatorConfig;
      id: 'composite';
    };

export type PaliAuthConfig = SmartAccountAuthConfig;
export type PaliSmartAccountAuthenticatorSetup = SmartAccountAuthenticatorSetup;

export type PaliSmartAccountDescriptor = {
  accountIndex: number;
  accountVersion: string;
  anchor: string;
  anchorHash: string;
  chainId: number;
  deploymentSalt: string;
  factoryAddress: string;
};

export const encodeEcdsaValidatorInitData = (owners: string[], threshold = 1) =>
  defaultAbiCoder.encode(
    ['address[]', 'uint64'],
    [owners.map((owner) => getAddress(owner)), threshold]
  );

export const encodeCompositeValidatorInitData = (
  childValidators: string[],
  threshold = 1
) =>
  defaultAbiCoder.encode(
    ['address[]', 'uint64'],
    [childValidators.map((validator) => getAddress(validator)), threshold]
  );

export const encodeGuardianRecoveryInitData = ({
  delaySeconds,
  expirationSeconds,
  guardians,
  threshold,
}: {
  delaySeconds: number;
  expirationSeconds: number;
  guardians: string[];
  threshold: number;
}) =>
  defaultAbiCoder.encode(
    ['uint32', 'uint32', 'address[]', 'uint64'],
    [
      delaySeconds,
      expirationSeconds,
      guardians.map((guardian) => getAddress(guardian)),
      threshold,
    ]
  );

export const encodeSingleERC7579Execution = ({
  data,
  target,
  value,
}: {
  data: string;
  target: string;
  value: string;
}) =>
  defaultAbiCoder.encode(
    ['address', 'uint256', 'bytes'],
    [getAddress(target), value, data]
  );

export const encodePackedSingleERC7579Execution = ({
  data,
  target,
  value,
}: {
  data: string;
  target: string;
  value: string;
}) =>
  hexConcat([
    getAddress(target),
    hexZeroPad(defaultAbiCoder.encode(['uint256'], [value]), 32),
    data,
  ]);

export const encodeBatchERC7579Execution = (
  executions: Array<{
    data: string;
    target: string;
    value: string;
  }>
) =>
  defaultAbiCoder.encode(
    ['tuple(address target,uint256 value,bytes callData)[]'],
    [
      executions.map((execution) => [
        getAddress(execution.target),
        execution.value,
        execution.data,
      ]),
    ]
  );

export const encodeERC7579Executions = (
  executions: Array<{
    data?: string;
    target: string;
    value: string;
  }>
) => {
  if (executions.length === 0) {
    throw new Error('Smart account execution requires at least one call');
  }

  const normalized = executions.map((execution) => ({
    data: execution.data || '0x',
    target: execution.target,
    value: execution.value,
  }));

  return normalized.length === 1
    ? {
        executionCalldata: encodePackedSingleERC7579Execution(normalized[0]),
        executions: normalized,
        mode: ERC7579_MODE_SINGLE_DEFAULT,
      }
    : {
        executionCalldata: encodeBatchERC7579Execution(normalized),
        executions: normalized,
        mode: ERC7579_MODE_BATCH_DEFAULT,
      };
};

export const encodeInstallValidatorModuleCall = (
  moduleAddress: string,
  initData: string
) =>
  paliSmartAccountInterface.encodeFunctionData('installModule', [
    ERC7579_MODULE_TYPE_VALIDATOR,
    getAddress(moduleAddress),
    initData,
  ]);

export const encodeUninstallValidatorModuleCall = (
  moduleAddress: string,
  deInitData = '0x'
) =>
  paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
    ERC7579_MODULE_TYPE_VALIDATOR,
    getAddress(moduleAddress),
    deInitData,
  ]);

export const encodeInstallExecutorModuleCall = (
  moduleAddress: string,
  initData: string
) =>
  paliSmartAccountInterface.encodeFunctionData('installModule', [
    ERC7579_MODULE_TYPE_EXECUTOR,
    getAddress(moduleAddress),
    initData,
  ]);

export const getSmartAccountAuthHash = (auth: {
  data: string;
  validator: string;
}) =>
  keccak256(
    defaultAbiCoder.encode(
      ['address', 'bytes32'],
      [getAddress(auth.validator), keccak256(auth.data)]
    )
  );

export type PaliRecoveryTarget = {
  auth: PaliAuthConfig;
};

export const encodeRecoveryTargetExecution = (target: PaliRecoveryTarget) =>
  encodeInstallValidatorModuleCall(target.auth.validator, target.auth.data);

export type SmartAccountPackedUserOperation = {
  accountGasLimits: string;
  callData: string;
  gasFees: string;
  initCode: string;
  nonce: string;
  paymasterAndData: string;
  preVerificationGas: string;
  sender: string;
  signature: string;
};

export const encodeSmartAccountValidatorNonceKey = (
  validator: string,
  subkey = 0
) =>
  BigNumber.from(getAddress(validator))
    .shl(32)
    .or(BigNumber.from(subkey))
    .toString();

export const encodeSmartAccountGasLimits = ({
  callGasLimit,
  verificationGasLimit,
}: {
  callGasLimit: string | number;
  verificationGasLimit: string | number;
}) =>
  hexConcat([
    hexZeroPad(BigNumber.from(verificationGasLimit).toHexString(), 16),
    hexZeroPad(BigNumber.from(callGasLimit).toHexString(), 16),
  ]);

export const encodeSmartAccountGasFees = ({
  maxFeePerGas,
  maxPriorityFeePerGas,
}: {
  maxFeePerGas: string | number;
  maxPriorityFeePerGas: string | number;
}) =>
  hexConcat([
    hexZeroPad(BigNumber.from(maxPriorityFeePerGas).toHexString(), 16),
    hexZeroPad(BigNumber.from(maxFeePerGas).toHexString(), 16),
  ]);

export const buildSmartAccountUserOperation = ({
  accountGasLimits = encodeSmartAccountGasLimits({
    callGasLimit: 1_000_000,
    verificationGasLimit: 1_000_000,
  }),
  callData,
  gasFees = encodeSmartAccountGasFees({
    maxFeePerGas: 0,
    maxPriorityFeePerGas: 0,
  }),
  initCode = '0x',
  nonce,
  paymasterAndData = '0x',
  preVerificationGas = '50000',
  sender,
  signature = '0x',
}: {
  accountGasLimits?: string;
  callData: string;
  gasFees?: string;
  initCode?: string;
  nonce: string;
  paymasterAndData?: string;
  preVerificationGas?: string;
  sender: string;
  signature?: string;
}): SmartAccountPackedUserOperation => ({
  accountGasLimits,
  callData,
  gasFees,
  initCode,
  nonce,
  paymasterAndData,
  preVerificationGas,
  sender,
  signature,
});

export const withSmartAccountPaymasterData = (
  userOperation: SmartAccountPackedUserOperation,
  paymasterAndData: string
): SmartAccountPackedUserOperation => ({
  ...userOperation,
  paymasterAndData,
});

export const selectSmartAccountDeploymentGasPayer = (
  accounts: Record<string, Record<number, any>>,
  metadata: ISmartAccountMetadata,
  getDefaultGasPayer: () => {
    account: any;
    accountType: KeyringAccountType;
  }
) => {
  const gasPayer = metadata.deploymentGasPayer;
  if (!gasPayer) {
    return getDefaultGasPayer();
  }

  const account = accounts[gasPayer.type]?.[gasPayer.id] as any;
  if (
    account?.address &&
    account.address.toLowerCase() === gasPayer.address.toLowerCase()
  ) {
    return { account, accountType: gasPayer.type };
  }
  throw new Error('Smart account deployment gas payer is no longer available');
};

export const getPaliSmartAccountDeploymentSalt = ({
  accountIndex,
  anchor,
  chainId,
  factoryAddress,
}: {
  accountIndex: number;
  anchor: string;
  chainId: number;
  factoryAddress: string;
}) =>
  keccak256(
    defaultAbiCoder.encode(
      ['string', 'uint256', 'address', 'bytes32', 'uint256'],
      [
        'PaliSmartAccount.ERC7579.anchor-salt.v1',
        chainId,
        getAddress(factoryAddress),
        keccak256(defaultAbiCoder.encode(['string'], [anchor])),
        accountIndex,
      ]
    )
  );

export const getPaliSmartAccountDescriptor = ({
  accountIndex,
  accountVersion,
  anchor,
  chainId,
  factoryAddress,
}: {
  accountIndex: number;
  accountVersion: string;
  anchor: string;
  chainId: number;
  factoryAddress: string;
}): PaliSmartAccountDescriptor => ({
  accountIndex,
  accountVersion,
  anchor,
  anchorHash: keccak256(defaultAbiCoder.encode(['string'], [anchor])),
  chainId,
  deploymentSalt: getPaliSmartAccountDeploymentSalt({
    accountIndex,
    anchor,
    chainId,
    factoryAddress,
  }),
  factoryAddress: getAddress(factoryAddress),
});

export const getConfiguredAuthenticatorAddress = (
  chainId: number,
  id: PaliAuthenticatorModuleId
) => getPaliModuleAddress(chainId, id);
