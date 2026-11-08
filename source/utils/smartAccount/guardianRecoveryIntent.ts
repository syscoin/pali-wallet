import { AbiCoder } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { getBytes, hexlify } from 'ethers/utils';

import {
  encodeERC7579Executions,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  ERC7579_MODE_SINGLE_DEFAULT,
  type PaliRecoveryTarget,
  type SmartAccountExecution,
} from './account.ts';
import { paliSmartAccountInterface } from './contracts.ts';
import {
  captureGuardianRecoveryOperation,
  captureGuardianRecoveryTarget,
} from './guardianRecoveryCommands.ts';
import {
  getSmartAccountGuardianRecoveryHash,
  type SmartAccountGuardianRecoveryOperation,
} from './recovery.ts';

export type GuardianRecoveryIntent = Readonly<{
  operation: SmartAccountGuardianRecoveryOperation;
  target: PaliRecoveryTarget;
}>;

/** Public persisted intent. It grants no signing authority without fresh host checks. */
export function captureGuardianRecoveryIntent(
  input: GuardianRecoveryIntent
): GuardianRecoveryIntent {
  const operationField = Object.getOwnPropertyDescriptor(input, 'operation');
  const targetField = Object.getOwnPropertyDescriptor(input, 'target');
  if (
    !operationField ||
    !('value' in operationField) ||
    !targetField ||
    !('value' in targetField)
  )
    throw new Error('Invalid guardian recovery intent');
  const operation = captureGuardianRecoveryOperation(operationField.value);
  const target = captureGuardianRecoveryTarget(targetField.value);
  if (
    getSmartAccountGuardianRecoveryHash(operation).toLowerCase() !==
    operation.hash.toLowerCase()
  )
    throw new Error('Guardian recovery intent hash does not match');
  let executions: SmartAccountExecution[];
  if (
    operation.mode.toLowerCase() === ERC7579_MODE_SINGLE_DEFAULT.toLowerCase()
  ) {
    const bytes = getBytes(operation.executionCalldata);
    if (bytes.length < 52)
      throw new Error('Invalid guardian recovery execution');
    executions = [
      {
        target: getAddress(hexlify(bytes.slice(0, 20))),
        value: BigInt(hexlify(bytes.slice(20, 52))).toString(),
        data: hexlify(bytes.slice(52)),
      },
    ];
  } else {
    const [calls] = AbiCoder.defaultAbiCoder().decode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      operation.executionCalldata
    );
    if (calls.length < 1 || calls.length > 2)
      throw new Error('Invalid guardian recovery execution count');
    executions = [...calls].map((call) => ({
      target: getAddress(call.target),
      value: call.value.toString(),
      data: call.callData,
    }));
  }
  if (
    executions.some(
      (call) =>
        call.target !== operation.account || BigInt(call.value) !== BigInt(0)
    )
  )
    throw new Error(
      'Guardian recovery execution is outside the target account'
    );
  const first = executions[0]!;
  const install = encodeInstallValidatorModuleCall(
    target.auth.validator,
    target.auth.data
  );
  const rotate = encodeRotateValidatorModuleCall(
    target.auth.validator,
    target.auth.data
  );
  if (
    first.data.toLowerCase() !== install.toLowerCase() &&
    first.data.toLowerCase() !== rotate.toLowerCase()
  )
    throw new Error(
      'Guardian recovery execution does not match its replacement'
    );
  if (executions.length === 2) {
    const removal = executions[1]!;
    const [kind, validator, data] =
      paliSmartAccountInterface.decodeFunctionData(
        'uninstallModule',
        removal.data
      );
    if (
      kind !== BigInt(1) ||
      getAddress(validator) === target.auth.validator ||
      data !== '0x' ||
      removal.data.toLowerCase() !==
        encodeUninstallValidatorModuleCall(validator).toLowerCase()
    )
      throw new Error('Invalid guardian recovery validator retirement');
  }
  const encoded = encodeERC7579Executions(executions);
  if (
    encoded.mode.toLowerCase() !== operation.mode.toLowerCase() ||
    encoded.executionCalldata.toLowerCase() !==
      operation.executionCalldata.toLowerCase()
  )
    throw new Error('Noncanonical guardian recovery execution');
  return Object.freeze({ operation, target });
}
