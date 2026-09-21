import { defaultAbiCoder } from 'utils/ethersV6Compat';
import { id as hashText } from 'utils/ethersV6Compat';
import { keccak256 } from 'utils/ethersV6Compat';
import { BigNumber, getAddress } from 'utils/ethersV6Compat';
import { isGuardianRecoveryPolicyChangedError } from 'utils/smartAccountErrors';

import {
  encodeERC7579Executions,
  encodeGuardianRecoveryInitData,
  encodeRecoveryTargetExecution,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  PaliRecoveryTarget,
} from './account';

const PALI_GUARDIAN_RECOVERY_SCHEDULE_TYPEHASH = hashText(
  'PaliGuardianRecoverySchedule(uint256 chainId,address account,address module,uint256 policyEpoch,bytes32 salt,bytes32 mode,bytes32 executionCalldataHash)'
);
export type SmartAccountGuardianSignature = string;

export type SmartAccountGuardianRecoveryDigestContext = {
  policyEpoch: string;
};

export type SmartAccountGuardianRecoveryIntent =
  SmartAccountGuardianRecoveryDigestContext & {
    account: string;
    chainId: number;
    executionCalldata: string;
    mode: string;
    recoveryModule: string;
    salt: string;
  };

export type SmartAccountGuardianRecoveryOperation =
  SmartAccountGuardianRecoveryIntent & {
    hash: string;
  };

export const clearStaleGuardianRecoveryOperation = <
  T extends { recoveryOperation?: unknown }
>(
  credential: T,
  error: unknown
): T =>
  isGuardianRecoveryPolicyChangedError(error)
    ? { ...credential, recoveryOperation: undefined }
    : credential;

export const getGuardianRecoveryDigestContext = (
  context: SmartAccountGuardianRecoveryDigestContext
): SmartAccountGuardianRecoveryDigestContext => {
  if (
    typeof context.policyEpoch !== 'string' ||
    !/^[1-9][0-9]*$/.test(context.policyEpoch) ||
    BigNumber.from(context.policyEpoch).gt(
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
  ) {
    throw new Error('Guardian recovery requires a current policy epoch');
  }
  return { policyEpoch: context.policyEpoch };
};

export const SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS =
  24 * 60 * 60;
export const SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_EXPIRATION_SECONDS =
  7 * 24 * 60 * 60;
export const SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_THRESHOLD = 1;

export const encodeSmartAccountGuardianRecoveryInitData =
  encodeGuardianRecoveryInitData;

export const getSmartAccountGuardianRecoveryHash = ({
  account,
  chainId,
  executionCalldata,
  mode,
  recoveryModule,
  salt,
  policyEpoch,
}: SmartAccountGuardianRecoveryIntent): string => {
  const context = getGuardianRecoveryDigestContext({ policyEpoch });
  return keccak256(
    defaultAbiCoder.encode(
      [
        'bytes32',
        'uint256',
        'address',
        'address',
        'uint256',
        'bytes32',
        'bytes32',
        'bytes32',
      ],
      [
        PALI_GUARDIAN_RECOVERY_SCHEDULE_TYPEHASH,
        chainId,
        account,
        recoveryModule,
        context.policyEpoch,
        salt,
        mode,
        keccak256(executionCalldata),
      ]
    )
  );
};

export const buildSmartAccountGuardianRecoveryOperation = (
  params: SmartAccountGuardianRecoveryDigestContext & {
    account: string;
    chainId: number;
    recoveryModule: string;
    replaceExistingValidator?: boolean;
    revokeValidator?: string;
    salt: string;
    target: PaliRecoveryTarget;
  }
) => {
  const context = getGuardianRecoveryDigestContext(params);
  const replacesActiveTarget =
    params.revokeValidator?.toLowerCase() ===
    params.target.auth.validator.toLowerCase();
  // When the target validator module is already installed it must be re-keyed
  // through the account's atomic rotateValidator: the account rejects a plain
  // uninstall of its active validator, and an install of an already-installed
  // module reverts.
  const installCall = params.replaceExistingValidator
    ? encodeRotateValidatorModuleCall(
        params.target.auth.validator,
        params.target.auth.data
      )
    : encodeRecoveryTargetExecution(params.target);
  const executions = [
    {
      data: installCall,
      target: params.account,
      value: '0',
    },
    ...(params.revokeValidator && !replacesActiveTarget
      ? [
          {
            data: encodeUninstallValidatorModuleCall(params.revokeValidator),
            target: params.account,
            value: '0',
          },
        ]
      : []),
  ];
  const { executionCalldata, mode } = encodeERC7579Executions(executions);

  return {
    ...context,
    account: getAddress(params.account),
    chainId: params.chainId,
    executionCalldata,
    hash: getSmartAccountGuardianRecoveryHash({
      account: params.account,
      ...context,
      chainId: params.chainId,
      executionCalldata,
      mode,
      recoveryModule: params.recoveryModule,
      salt: params.salt,
    }),
    mode,
    recoveryModule: params.recoveryModule,
    salt: params.salt,
  };
};
