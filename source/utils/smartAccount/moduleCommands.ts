import { getAddress } from '../ethersV6Compat.ts';

import {
  encodeCompositeValidatorInitData,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  type SmartAccountExecution,
} from './account.ts';
import type { SmartAccountAuthenticatorBuildResult } from './authenticators.ts';
import { listCompositeChildCandidates } from './custom.ts';
import { isPaliSignableValidator } from './validatorSignability.ts';
import {
  assertSmartAccountValidatorSwitchApplied,
  buildSmartAccountValidatorSwitch,
  type SmartAccountValidatorSwitch,
} from './validatorSwitch.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network.ts';

const execution = (
  accountAddress: string,
  data: string
): SmartAccountExecution => ({
  data,
  target: accountAddress,
  value: '0x0',
});

export type ValidatorModuleRemovalPolicy =
  | 'all-installed-composites'
  | 'active-composite';

/** Preserve the host's existing composite-reference policy; malformed state fails closed. */
export function canRemoveValidatorModule(
  metadata: Pick<ISmartAccountMetadata, 'auth' | 'installedModules'>,
  address: string,
  policy: ValidatorModuleRemovalPolicy
): boolean {
  if (policy !== 'all-installed-composites' && policy !== 'active-composite')
    return false;
  try {
    const target = getAddress(address);
    if (!metadata.auth?.validator) return false;
    const active = getAddress(metadata.auth.validator);
    if (
      target === '0x0000000000000000000000000000000000000000' ||
      active === '0x0000000000000000000000000000000000000000' ||
      target === active ||
      !Array.isArray(metadata.installedModules)
    )
      return false;
    const validators = metadata.installedModules.filter(
      (module): module is SmartAccountValidatorModule =>
        module.type === 'validator'
    );
    const addresses = validators.map((module) => getAddress(module.address));
    if (!addresses.includes(target)) return false;
    return validators.every((module, index) => {
      if (module.id !== 'composite') return true;
      if (!Array.isArray(module.config.childValidators)) return false;
      const children = module.config.childValidators.map(getAddress);
      return (
        (policy === 'active-composite' && addresses[index] !== active) ||
        !children.includes(target)
      );
    });
  } catch {
    return false;
  }
}

/** Public calldata only. Preflight, consent, current-owner guards and submission stay in the host. */
export function buildCustomValidatorInstallExecutions({
  accountAddress,
  activeValidatorAddress,
  activeValidatorData,
  customInitData,
  customValidatorAddress,
}: {
  accountAddress: string;
  activeValidatorAddress: string;
  activeValidatorData: string;
  customInitData: string;
  customValidatorAddress: string;
}): SmartAccountExecution[] {
  // Installing a custom module must retain the existing active signing method.
  return [
    execution(
      accountAddress,
      encodeInstallValidatorModuleCall(customValidatorAddress, customInitData)
    ),
    execution(
      accountAddress,
      encodeRotateValidatorModuleCall(
        activeValidatorAddress,
        activeValidatorData
      )
    ),
  ];
}

export type SmartAccountAuthenticatorPurpose = 'replace' | 'add-to-combined';
export type SmartAccountBuiltinInstall = Omit<
  SmartAccountValidatorSwitch,
  'purpose'
> &
  Readonly<{ purpose: 'add-to-combined' }>;

function assertActiveConfiguration(metadata: ISmartAccountMetadata): void {
  const auth = metadata.auth;
  const active = metadata.installedModules?.find(
    (module): module is SmartAccountValidatorModule =>
      module.type === 'validator' &&
      module.address.toLowerCase() === auth?.validator.toLowerCase()
  );
  if (!auth || !active || active.id === 'custom')
    throw new Error('Smart account authenticator changed');
  assertSmartAccountValidatorSwitchApplied(
    {
      chainId: metadata.chainId,
      target: { ...auth, module: active.id },
      targetModule: active,
    },
    metadata
  );
}

/** Install a known method without changing the account's active approval method. */
export function buildSmartAccountBuiltinInstall(
  input: Parameters<typeof buildSmartAccountValidatorSwitch>[0]
): SmartAccountBuiltinInstall {
  const command = buildSmartAccountValidatorSwitch(input);
  assertActiveConfiguration(input.metadata);
  if (
    !['ecdsa', 'p256-webauthn', 'slh-dsa'].includes(command.targetModule.id) ||
    input.metadata.installedModules?.some(
      (module) =>
        module.type === 'validator' &&
        getAddress(module.address) === command.target.validator
    )
  )
    throw new Error(
      'Smart account approval method is already installed or unavailable'
    );
  return Object.freeze({
    ...command,
    purpose: 'add-to-combined',
    executions: Object.freeze(
      buildCustomValidatorInstallExecutions({
        accountAddress: command.accountAddress,
        activeValidatorAddress: input.metadata.auth!.validator,
        activeValidatorData: input.metadata.auth!.data,
        customValidatorAddress: command.target.validator,
        customInitData: command.target.data,
      }).map((item) => Object.freeze(item))
    ),
  });
}

function builtinTarget(
  command: SmartAccountBuiltinInstall
): SmartAccountAuthenticatorBuildResult {
  if (command.purpose !== 'add-to-combined')
    throw new Error('Invalid smart account approval purpose');
  return {
    auth: { ...command.target },
    metadata: {
      installedModules: [command.targetModule as SmartAccountValidatorModule],
    },
  };
}

export function assertSmartAccountBuiltinInstallCurrent(
  command: SmartAccountBuiltinInstall,
  metadata: ISmartAccountMetadata
): void {
  const current = buildSmartAccountBuiltinInstall({
    ...command,
    metadata,
    target: builtinTarget(command),
  });
  if (
    current.sourceAuthHash !== command.sourceAuthHash ||
    current.sourceModule !== command.sourceModule ||
    current.executions.length !== command.executions.length ||
    current.executions.some(
      (item, index) =>
        item.target !== command.executions[index]?.target ||
        item.data !== command.executions[index]?.data ||
        item.value !== command.executions[index]?.value
    )
  )
    throw new Error('Smart account authenticator changed');
}

/** Canonical target configuration and the original active method must both survive. */
export function assertSmartAccountBuiltinInstallApplied(
  command: SmartAccountBuiltinInstall,
  metadata: ISmartAccountMetadata
): void {
  const current = buildSmartAccountValidatorSwitch({
    ...command,
    metadata,
    target: builtinTarget(command),
  });
  if (
    current.sourceAuthHash !== command.sourceAuthHash ||
    current.sourceModule !== command.sourceModule
  )
    throw new Error('Smart account active approval method changed');
  assertActiveConfiguration(metadata);
  assertSmartAccountValidatorSwitchApplied(command, {
    ...metadata,
    auth: { ...command.target },
  });
}

export function buildValidatorUninstallExecutions({
  accountAddress,
  validatorAddress,
}: {
  accountAddress: string;
  validatorAddress: string;
}): SmartAccountExecution[] {
  return [
    execution(
      accountAddress,
      encodeUninstallValidatorModuleCall(validatorAddress)
    ),
  ];
}

export class SmartAccountModuleCommandError extends Error {
  readonly code:
    | 'INVALID_COMPOSITE'
    | 'COMPOSITE_LOCKOUT'
    | 'COMPOSITE_UNAVAILABLE';

  constructor(
    code: 'INVALID_COMPOSITE' | 'COMPOSITE_LOCKOUT' | 'COMPOSITE_UNAVAILABLE'
  ) {
    super(code);
    this.name = 'SmartAccountModuleCommandError';
    this.code = code;
  }
}

/** The extension's installed-child, threshold and lockout policy, shared with every host. */
export function buildCompositeValidatorExecutions({
  accountAddress,
  metadata,
  children,
  threshold,
  compositeValidatorAddress,
  isAlgorithmAvailable,
}: {
  accountAddress: string;
  children: readonly string[];
  /** The host resolves the supported builtin catalogue entry; null means unavailable. */
  compositeValidatorAddress: string | null;
  isAlgorithmAvailable(module: SmartAccountValidatorModule): boolean;
  metadata: Pick<ISmartAccountMetadata, 'auth' | 'installedModules'>;
  threshold: number;
}): SmartAccountExecution[] {
  let normalized: string[];
  try {
    normalized = children.map(getAddress);
  } catch {
    throw new SmartAccountModuleCommandError('INVALID_COMPOSITE');
  }
  const candidates = listCompositeChildCandidates(metadata);
  if (
    !normalized.length ||
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > normalized.length ||
    new Set(normalized).size !== normalized.length ||
    normalized.some(
      (child) =>
        child === '0x0000000000000000000000000000000000000000' ||
        !candidates.some(
          (candidate) => candidate.address.toLowerCase() === child.toLowerCase()
        )
    )
  )
    throw new SmartAccountModuleCommandError('INVALID_COMPOSITE');
  const validators = (metadata.installedModules ?? []).filter(
    (module): module is SmartAccountValidatorModule =>
      module.type === 'validator'
  );
  const signable = normalized.filter((child) => {
    const module = validators.find(
      (candidate) => candidate.address.toLowerCase() === child.toLowerCase()
    );
    return (
      module &&
      module.id !== 'composite' &&
      isPaliSignableValidator(module, metadata, isAlgorithmAvailable)
    );
  });
  if (signable.length < threshold)
    throw new SmartAccountModuleCommandError('COMPOSITE_LOCKOUT');
  if (!compositeValidatorAddress)
    throw new SmartAccountModuleCommandError('COMPOSITE_UNAVAILABLE');
  const initData = encodeCompositeValidatorInitData(normalized, threshold);
  const installed = validators.find((module) => module.id === 'composite');
  if (!installed)
    return [
      execution(
        accountAddress,
        encodeInstallValidatorModuleCall(compositeValidatorAddress, initData)
      ),
    ];
  const active =
    installed.address.toLowerCase() === metadata.auth?.validator?.toLowerCase();
  return active
    ? [
        execution(
          accountAddress,
          encodeRotateValidatorModuleCall(installed.address, initData)
        ),
      ]
    : [
        execution(
          accountAddress,
          encodeUninstallValidatorModuleCall(installed.address)
        ),
        execution(
          accountAddress,
          encodeInstallValidatorModuleCall(installed.address, initData)
        ),
      ];
}
