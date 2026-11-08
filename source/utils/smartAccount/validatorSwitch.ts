import { AddressZero, getAddress } from '../ethersV6Compat.ts';

import {
  buildSmartAccountValidatorSwitchPlan,
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getSmartAccountAuthHash,
  type PaliAuthConfig,
  type SmartAccountExecution,
} from './account.ts';
import type { ISmartAccountMetadata } from '../../types/network.ts';

export type PaliWalletValidatorSwitch = Readonly<{
  accountAddress: string;
  chainId: number;
  executions: readonly Readonly<SmartAccountExecution>[];
  ownerAddress: string;
  sourceAuthHash: string;
  sourceModule: string;
  target: Readonly<PaliAuthConfig>;
}>;

const changed = () => new Error('Smart account authenticator changed');

/** Public command only. Signing and persistence remain in the host operation. */
export function buildPaliWalletValidatorSwitch({
  accountAddress,
  chainId,
  metadata,
  ownerAddress,
}: {
  accountAddress: string;
  chainId: number;
  metadata: ISmartAccountMetadata;
  ownerAddress: string;
}): PaliWalletValidatorSwitch {
  const account = getAddress(accountAddress);
  const owner = getAddress(ownerAddress);
  const auth = metadata.auth;
  const sourceModule = auth?.module ?? auth?.scheme;
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    metadata.chainId !== chainId ||
    metadata.isDeployed !== true ||
    account === AddressZero ||
    owner === AddressZero ||
    !auth ||
    !sourceModule
  )
    throw changed();
  const activeValidator = metadata.installedModules?.find(
    (module) =>
      module.type === 'validator' &&
      module.address.toLowerCase() === auth.validator.toLowerCase()
  );
  if (
    activeValidator?.type !== 'validator' ||
    activeValidator.id !== sourceModule ||
    (activeValidator.data ?? '0x').toLowerCase() !== auth.data.toLowerCase()
  )
    throw changed();
  const target: Readonly<PaliAuthConfig> = Object.freeze({
    data: encodeEcdsaValidatorInitData([owner], 1),
    module: 'ecdsa',
    validator: getAddress(getConfiguredAuthenticatorAddress(chainId, 'ecdsa')),
  });
  const plan = buildSmartAccountValidatorSwitchPlan({
    accountAddress: account,
    activeValidator,
    installedValidators: (metadata.installedModules ?? []).filter(
      (module) => module.type === 'validator'
    ),
    target,
  });
  return Object.freeze({
    accountAddress: account,
    chainId,
    executions: Object.freeze(
      plan.executions.map((execution) => Object.freeze({ ...execution }))
    ),
    ownerAddress: owner,
    sourceAuthHash: getSmartAccountAuthHash(auth),
    sourceModule,
    target,
  });
}

export function assertPaliWalletValidatorSwitchCurrent(
  command: PaliWalletValidatorSwitch,
  metadata: ISmartAccountMetadata
): void {
  const current = buildPaliWalletValidatorSwitch({ ...command, metadata });
  if (
    current.sourceModule !== command.sourceModule ||
    current.sourceAuthHash !== command.sourceAuthHash ||
    current.executions.length !== command.executions.length ||
    current.executions.some((execution, index) => {
      const expected = command.executions[index]!;
      return (
        execution.target !== expected.target ||
        execution.data !== expected.data ||
        execution.value !== expected.value
      );
    })
  )
    throw changed();
}

/** Call after canonical hydration, independently of the confirmed transaction. */
export function assertPaliWalletValidatorSwitchApplied(
  command: PaliWalletValidatorSwitch,
  metadata: ISmartAccountMetadata
): void {
  const auth = metadata.auth;
  const installed = metadata.installedModules?.find(
    (module) =>
      module.type === 'validator' &&
      module.address.toLowerCase() === command.target.validator.toLowerCase()
  );
  if (
    metadata.chainId !== command.chainId ||
    metadata.isDeployed !== true ||
    !auth ||
    (auth.module ?? auth.scheme) !== 'ecdsa' ||
    getSmartAccountAuthHash(auth) !== getSmartAccountAuthHash(command.target) ||
    installed?.type !== 'validator' ||
    installed.id !== 'ecdsa' ||
    installed.data?.toLowerCase() !== command.target.data.toLowerCase() ||
    installed.config.threshold !== 1 ||
    installed.config.owners.length !== 1 ||
    getAddress(installed.config.owners[0]!) !== command.ownerAddress
  )
    throw new Error('Smart account authenticator metadata has not caught up');
}
