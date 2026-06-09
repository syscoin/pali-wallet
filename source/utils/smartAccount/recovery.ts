import { defaultAbiCoder } from '@ethersproject/abi';
import { id as hashText } from '@ethersproject/hash';
import { keccak256 } from '@ethersproject/keccak256';

import {
  encodeERC7579Executions,
  encodeGuardianRecoveryInitData,
  encodeRecoveryTargetExecution,
  encodeUninstallValidatorModuleCall,
  PaliRecoveryTarget,
} from './account';

const PALI_GUARDIAN_RECOVERY_SCHEDULE_TYPEHASH = hashText(
  'PaliGuardianRecoverySchedule(uint256 chainId,address account,address module,bytes32 salt,bytes32 mode,bytes32 executionCalldataHash)'
);

export type SmartAccountGuardianSignature = string;

export type SmartAccountGuardianRecoveryIntent = {
  account: string;
  chainId: number;
  executionCalldata: string;
  mode: string;
  recoveryModule: string;
  salt: string;
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
}: SmartAccountGuardianRecoveryIntent): string =>
  keccak256(
    defaultAbiCoder.encode(
      [
        'bytes32',
        'uint256',
        'address',
        'address',
        'bytes32',
        'bytes32',
        'bytes32',
      ],
      [
        PALI_GUARDIAN_RECOVERY_SCHEDULE_TYPEHASH,
        chainId,
        account,
        recoveryModule,
        salt,
        mode,
        keccak256(executionCalldata),
      ]
    )
  );

export const buildSmartAccountGuardianRecoveryOperation = (params: {
  account: string;
  chainId: number;
  recoveryModule: string;
  replaceExistingValidator?: boolean;
  salt: string;
  target: PaliRecoveryTarget;
}) => {
  const installCall = encodeRecoveryTargetExecution(params.target);
  const executions = params.replaceExistingValidator
    ? [
        {
          data: encodeUninstallValidatorModuleCall(
            params.target.auth.validator
          ),
          target: params.account,
          value: '0',
        },
        {
          data: installCall,
          target: params.account,
          value: '0',
        },
      ]
    : [
        {
          data: installCall,
          target: params.account,
          value: '0',
        },
      ];
  const { executionCalldata, mode } = encodeERC7579Executions(executions);

  return {
    executionCalldata,
    hash: getSmartAccountGuardianRecoveryHash({
      account: params.account,
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
