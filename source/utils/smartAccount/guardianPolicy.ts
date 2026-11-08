import { getAddress } from '../ethersV6Compat.ts';

import {
  encodeGuardianRecoveryInitData,
  getConfiguredAuthenticatorAddress,
} from './account.ts';
import {
  ERC7579_MODULE_TYPE_EXECUTOR,
  paliSmartAccountInterface,
} from './contracts.ts';
import type { SmartAccountExecutorModule } from '../../types/network.ts';

export const SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS =
  3 * 24 * 60 * 60;
export const SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_EXPIRATION_SECONDS =
  7 * 24 * 60 * 60;
export const SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_THRESHOLD = 1;

// A short wait is useful on known testnets only. Unknown/custom networks get
// the production choices; an editable network name or URL is not evidence that
// a chain is a testnet. This is Pali's setup policy, not a contract minimum.
export const getGuardianRecoveryDelayOptions = (chainId: number): number[] =>
  [5700, 57057, 57000, 11155111].includes(chainId)
    ? [600, 259200, 604800]
    : [259200, 604800];

export const isGuardianRecoveryDelayAllowed = (
  chainId: number,
  delaySeconds: number
): boolean => getGuardianRecoveryDelayOptions(chainId).includes(delaySeconds);

type GuardianPolicyConfiguration = Readonly<{
  accountAddress: string;
  chainId: number;
  delaySeconds: number;
  guardian: string;
}>;

export type GuardianPolicyCommand =
  | (GuardianPolicyConfiguration & Readonly<{ kind: 'install' }>)
  | (GuardianPolicyConfiguration &
      Readonly<{ kind: 'update'; previousModuleAddress: string }>)
  | Readonly<{
      accountAddress: string;
      kind: 'remove';
      moduleAddress: string;
    }>;

/** Calldata only. The host retains observation, approval and submission ownership. */
export function buildGuardianPolicyExecutions(command: GuardianPolicyCommand) {
  const accountAddress = getAddress(command.accountAddress);
  const execution = (
    method: 'installModule' | 'uninstallModule',
    args: unknown[]
  ) => ({
    data: paliSmartAccountInterface.encodeFunctionData(method, args),
    target: accountAddress,
    value: '0x0',
  });
  const remove = (address: string) =>
    execution('uninstallModule', [ERC7579_MODULE_TYPE_EXECUTOR, address, '0x']);
  if (command.kind === 'remove') return [remove(command.moduleAddress)];
  if (command.kind !== 'install' && command.kind !== 'update')
    throw new Error('Invalid guardian policy command');
  if (!isGuardianRecoveryDelayAllowed(command.chainId, command.delaySeconds))
    throw new Error('Guardian recovery delay is not supported');
  const moduleAddress = getConfiguredAuthenticatorAddress(
    command.chainId,
    'guardian-recovery'
  );
  if (!moduleAddress)
    throw new Error('Guardian recovery module is not configured');
  const install = execution('installModule', [
    ERC7579_MODULE_TYPE_EXECUTOR,
    moduleAddress,
    encodeGuardianRecoveryInitData({
      delaySeconds: command.delaySeconds,
      expirationSeconds: command.delaySeconds * 2,
      guardians: [getAddress(command.guardian)],
      threshold: SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_THRESHOLD,
    }),
  ]);
  return command.kind === 'update'
    ? [remove(command.previousModuleAddress), install]
    : [install];
}

export type GuardianPolicyMetadata = Readonly<{
  delaySeconds: number;
  expirationSeconds: number;
  guardians: readonly string[];
  moduleAddress: string;
  threshold: number;
}>;

/** Preserve every observed guardian and threshold, independently of editor limits. */
export function projectGuardianPolicyModule(
  policy: GuardianPolicyMetadata
): SmartAccountExecutorModule {
  const config = {
    delaySeconds: policy.delaySeconds,
    expirationSeconds: policy.expirationSeconds,
    guardians: [...policy.guardians],
    threshold: policy.threshold,
  };
  return {
    address: getAddress(policy.moduleAddress),
    config,
    data: encodeGuardianRecoveryInitData(config),
    id: 'guardian-recovery',
    type: 'executor',
  };
}
