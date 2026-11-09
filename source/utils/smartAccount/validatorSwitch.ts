import { AddressZero, getAddress } from '../ethersV6Compat.ts';
import { encodeP256WebAuthnAuthData } from '../passkey/account.ts';

import {
  buildSmartAccountValidatorSwitchPlan,
  encodeCompositeValidatorInitData,
  encodeEcdsaValidatorInitData,
  encodeSLHDSAValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getSmartAccountAuthHash,
  type PaliAuthConfig,
  type SmartAccountExecution,
} from './account.ts';
import type { SmartAccountAuthenticatorBuildResult } from './authenticators.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network.ts';

type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;

export type SmartAccountValidatorSwitch = Readonly<{
  accountAddress: string;
  chainId: number;
  executions: readonly Readonly<SmartAccountExecution>[];
  sourceAuthHash: string;
  sourceModule: string;
  target: Readonly<PaliAuthConfig>;
  targetModule: Immutable<SmartAccountValidatorModule>;
}>;

const changed = () => new Error('Smart account authenticator changed');
const sameData = (left?: string, right?: string) =>
  (left ?? '0x').toLowerCase() === (right ?? '0x').toLowerCase();

// Capture the public builder output; no caller-owned array or config survives.
function capture<T>(value: T): Immutable<T> {
  if (Array.isArray(value))
    return Object.freeze(value.map(capture)) as Immutable<T>;
  if (value && typeof value === 'object')
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, capture(item)])
      )
    ) as Immutable<T>;
  return value as Immutable<T>;
}

function configData(module: Immutable<SmartAccountValidatorModule>): string {
  switch (module.id) {
    case 'ecdsa':
      return encodeEcdsaValidatorInitData(
        [...module.config.owners],
        module.config.threshold
      );
    case 'p256-webauthn':
      return encodeP256WebAuthnAuthData(module.config.publicKey);
    case 'slh-dsa':
      return encodeSLHDSAValidatorInitData(module.config);
    case 'composite':
      return encodeCompositeValidatorInitData(
        [...module.config.childValidators],
        module.config.threshold
      );
    case 'custom':
      return module.config.initData ?? '0x';
    default:
      throw changed();
  }
}

/** Public command only. Signing and persistence remain in the host operation. */
export function buildSmartAccountValidatorSwitch({
  accountAddress,
  chainId,
  metadata,
  target: authenticator,
}: {
  accountAddress: string;
  chainId: number;
  metadata: ISmartAccountMetadata;
  target: SmartAccountAuthenticatorBuildResult;
}): SmartAccountValidatorSwitch {
  const account = getAddress(accountAddress);
  const auth = metadata.auth;
  const sourceModule = auth?.module ?? auth?.scheme;
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    metadata.chainId !== chainId ||
    metadata.isDeployed !== true ||
    account === AddressZero ||
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
  const target = capture({
    ...authenticator.auth,
    validator: getAddress(authenticator.auth.validator),
  });
  const modules = authenticator.metadata.installedModules;
  const candidate = modules?.length === 1 ? modules[0] : undefined;
  if (
    target.validator === AddressZero ||
    candidate?.type !== 'validator' ||
    (candidate.id !== 'custom' &&
      getAddress(getConfiguredAuthenticatorAddress(chainId, candidate.id)) !==
        target.validator) ||
    candidate.id !== target.module ||
    getAddress(candidate.address) !== target.validator ||
    !sameData(candidate.data, target.data) ||
    !sameData(configData(candidate), target.data)
  )
    throw changed();
  const targetModule = capture(candidate);
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
    sourceAuthHash: getSmartAccountAuthHash(auth),
    sourceModule,
    target,
    targetModule,
  });
}

export function assertSmartAccountValidatorSwitchCurrent(
  command: SmartAccountValidatorSwitch,
  metadata: ISmartAccountMetadata
): void {
  const current = buildSmartAccountValidatorSwitch({
    ...command,
    metadata,
    target: {
      auth: { ...command.target },
      metadata: {
        installedModules: [command.targetModule as SmartAccountValidatorModule],
      },
    },
  });
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
export function assertSmartAccountValidatorSwitchApplied(
  command: SmartAccountValidatorSwitch,
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
    (auth.module ?? auth.scheme) !== command.targetModule.id ||
    getSmartAccountAuthHash(auth) !== getSmartAccountAuthHash(command.target) ||
    installed?.type !== 'validator' ||
    installed.id !== command.targetModule.id ||
    installed.data?.toLowerCase() !== command.target.data.toLowerCase() ||
    !sameData(configData(installed), command.target.data)
  )
    throw new Error('Smart account authenticator metadata has not caught up');
}
