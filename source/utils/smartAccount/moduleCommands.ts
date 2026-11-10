import { getAddress } from '../ethersV6Compat.ts';

import {
  encodeCompositeValidatorInitData,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeUninstallValidatorModuleCall,
  type SmartAccountExecution,
} from './account.ts';
import { listCompositeChildCandidates } from './custom.ts';
import { isPaliSignableValidator } from './validatorSignability.ts';
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
  constructor(
    readonly code:
      | 'INVALID_COMPOSITE'
      | 'COMPOSITE_LOCKOUT'
      | 'COMPOSITE_UNAVAILABLE'
  ) {
    super(code);
    this.name = 'SmartAccountModuleCommandError';
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
