import { getAddress } from 'ethers/address';

import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeApproval.ts';
import { GuardianRecoveryPolicyChangedError } from '../smartAccountErrors.ts';

import type { PaliRecoveryTarget } from './account.ts';
import { paliGuardianRecoveryModuleInterface } from './contracts.ts';
import {
  buildSmartAccountGuardianRecoveryOperation,
  getGuardianRecoveryDigestContext,
  getSmartAccountGuardianRecoveryHash,
  type SmartAccountGuardianRecoveryOperation,
} from './recovery.ts';

type RecoveryOperation = Omit<SmartAccountGuardianRecoveryOperation, 'hash'> & {
  hash?: string;
};
type RecoveryPolicyReads = Readonly<{
  assertCurrent(): void;
  readModuleAddress(account: string): Promise<string | undefined>;
  readPolicyEpoch(account: string, recoveryModule: string): Promise<string>;
}>;

function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid guardian recovery data');
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !('value' in field))
    throw new Error('Invalid guardian recovery data');
  return field.value;
}

export function captureGuardianRecoveryTarget(
  target: PaliRecoveryTarget
): PaliRecoveryTarget {
  const auth = ownValue(target, 'auth');
  const module = ownValue(auth, 'module');
  const validator = ownValue(auth, 'validator');
  const data = ownValue(auth, 'data');
  if (
    !['ecdsa', 'p256-webauthn', 'composite', 'slh-dsa'].includes(
      module as string
    ) ||
    typeof validator !== 'string' ||
    typeof data !== 'string' ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(data)
  )
    throw new Error('Invalid guardian recovery authenticator');
  return Object.freeze({
    auth: Object.freeze({
      module: module as PaliRecoveryTarget['auth']['module'],
      validator: getAddress(validator),
      data,
    }),
  });
}

export function captureGuardianRecoveryOperation(
  operation: SmartAccountGuardianRecoveryOperation
): SmartAccountGuardianRecoveryOperation;
export function captureGuardianRecoveryOperation(
  operation: RecoveryOperation
): RecoveryOperation;
export function captureGuardianRecoveryOperation(
  operation: RecoveryOperation
): RecoveryOperation {
  const account = ownValue(operation, 'account');
  const chainId = ownValue(operation, 'chainId');
  const executionCalldata = ownValue(operation, 'executionCalldata');
  const mode = ownValue(operation, 'mode');
  const policyEpoch = ownValue(operation, 'policyEpoch');
  const recoveryModule = ownValue(operation, 'recoveryModule');
  const salt = ownValue(operation, 'salt');
  const hash = Object.prototype.hasOwnProperty.call(operation, 'hash')
    ? ownValue(operation, 'hash')
    : undefined;
  if (
    typeof account !== 'string' ||
    typeof recoveryModule !== 'string' ||
    typeof chainId !== 'number' ||
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    typeof executionCalldata !== 'string' ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(executionCalldata) ||
    typeof mode !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(mode) ||
    typeof salt !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(salt) ||
    typeof policyEpoch !== 'string' ||
    (hash !== undefined &&
      (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)))
  )
    throw new Error('Invalid guardian recovery operation');
  getGuardianRecoveryDigestContext({ policyEpoch });
  return Object.freeze({
    account: getAddress(account),
    chainId,
    executionCalldata,
    mode,
    policyEpoch,
    recoveryModule: getAddress(recoveryModule),
    salt,
    ...(hash === undefined ? {} : { hash: hash as string }),
  });
}

export async function buildGuardianRecoveryStart(
  input: Readonly<{
    account: string;
    chainId: number;
    salt: string;
    target: PaliRecoveryTarget;
  }>,
  ports: RecoveryPolicyReads &
    Readonly<{
      isValidatorInstalled(
        account: string,
        validator: string
      ): Promise<boolean>;
      readCurrentValidator(account: string): Promise<string>;
    }>
): Promise<SmartAccountGuardianRecoveryOperation> {
  const account = getAddress(input.account),
    chainId = input.chainId,
    salt = input.salt;
  const target = captureGuardianRecoveryTarget(input.target);
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  check();
  const recoveryModule = await ports.readModuleAddress(account);
  check();
  if (!recoveryModule)
    throw new Error('Guardian recovery module is not configured');
  const targetValidator = getAddress(target.auth.validator);
  const replaceExistingValidator = await ports.isValidatorInstalled(
    account,
    targetValidator
  );
  check();
  const currentValidator = getAddress(
    await ports.readCurrentValidator(account)
  );
  check();
  if (
    /^0x0{40}$/i.test(currentValidator) ||
    !(await ports.isValidatorInstalled(account, currentValidator))
  )
    throw new Error('Guardian recovery requires an installed active validator');
  check();
  const revokeValidator = currentValidator;
  const policyEpoch = await ports.readPolicyEpoch(account, recoveryModule);
  check();
  return Object.freeze(
    buildSmartAccountGuardianRecoveryOperation({
      account,
      chainId,
      policyEpoch,
      replaceExistingValidator,
      recoveryModule,
      revokeValidator,
      salt,
      target,
    })
  );
}

export async function validateGuardianRecoveryOperation(
  input: Readonly<{
    account: string;
    chainId: number;
    operation: RecoveryOperation;
  }>,
  ports: RecoveryPolicyReads &
    Readonly<{
      readScheduleHash(operation: RecoveryOperation): Promise<string>;
    }>
): Promise<void> {
  const account = getAddress(input.account),
    chainId = input.chainId;
  const operation = captureGuardianRecoveryOperation(input.operation);
  const recoveryModule = getAddress(operation.recoveryModule);
  const context = getGuardianRecoveryDigestContext(operation);
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  check();
  if (
    !operation.account ||
    getAddress(operation.account) !== account ||
    operation.chainId !== chainId
  )
    throw new Error(
      'Guardian recovery intent does not match the account or network'
    );
  const installed = await ports.readModuleAddress(account);
  check();
  if (!installed || getAddress(installed) !== recoveryModule)
    throw new Error(
      'Guardian recovery module is not installed for this account'
    );
  const policyEpoch = await ports.readPolicyEpoch(account, recoveryModule);
  check();
  if (policyEpoch !== context.policyEpoch)
    throw new GuardianRecoveryPolicyChangedError();
  const hash = getSmartAccountGuardianRecoveryHash({
    ...operation,
    ...context,
    account,
    chainId,
  });
  if (
    operation.hash !== undefined &&
    operation.hash.toLowerCase() !== hash.toLowerCase()
  )
    throw new Error(
      'Guardian recovery approval hash does not match its intent'
    );
  const onChainHash = await ports.readScheduleHash(operation);
  check();
  if (onChainHash.toLowerCase() !== hash.toLowerCase())
    throw new Error(
      'Guardian recovery digest does not match the installed policy'
    );
}

export function buildGuardianRecoveryScheduleTransaction(
  input: Readonly<{
    account: string;
    approval: Readonly<{ guardian: string; signature: string }>;
    guardian: string;
    operation: RecoveryOperation;
  }>
) {
  const account = getAddress(input.account),
    guardian = getAddress(input.guardian);
  if (getAddress(input.approval.guardian) !== guardian)
    throw new Error('Guardian approval does not match recovery guardian');
  return Object.freeze({
    data: paliGuardianRecoveryModuleInterface.encodeFunctionData(
      'scheduleRecovery',
      [
        account,
        input.operation.salt,
        input.operation.mode,
        input.operation.executionCalldata,
        [{ guardian, signature: input.approval.signature }],
      ]
    ),
    to: getAddress(input.operation.recoveryModule),
    value: '0x0',
  });
}

export function buildGuardianRecoveryFinalizeTransaction(
  input: Readonly<{
    account: string;
    operation: RecoveryOperation;
  }>
) {
  return Object.freeze({
    data: paliGuardianRecoveryModuleInterface.encodeFunctionData(
      'executeRecovery',
      [
        getAddress(input.account),
        input.operation.salt,
        input.operation.mode,
        input.operation.executionCalldata,
      ]
    ),
    to: getAddress(input.operation.recoveryModule),
    value: '0x0',
  });
}
