import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';

import type { ISmartAccountMetadata } from 'types/network';
import type { SmartAccountValidatorModule } from 'types/network';

import { aggregateContractCalls } from './aggregate';
import { ERC7579_MODULE_TYPE_VALIDATOR } from './contracts';
import {
  getInstalledValidatorModuleByAddress,
  listInstalledValidatorModules,
} from './modules';

// ---------------------------------------------------------------------------
// Bring-your-own (custom) validator support: trustless install preflight and
// the client-side lockout guard. Mirrors the contract-side active-validator
// uninstall guard: the wallet must never end up with an active validator it
// cannot produce signatures for without an escape hatch.
// ---------------------------------------------------------------------------

const ERC7579_MODULE_PROBE_INTERFACE = new Interface([
  'function isModuleType(uint256 moduleTypeId) view returns (bool)',
]);

export type CustomValidatorPreflightFailure =
  | 'already-installed'
  | 'no-contract-code'
  | 'not-a-validator-module';

export type CustomValidatorPreflightResult = {
  failures: CustomValidatorPreflightFailure[];
  ok: boolean;
};

type PreflightProvider = {
  call: (transaction: { data: string; to: string }) => Promise<string>;
  getCode: (address: string) => Promise<string>;
  sendBatch?: (method: string, params: Array<any[]>) => Promise<any[]>;
};

/**
 * Trustless install preflight for a custom ERC-7579 validator:
 *   1. the address must host contract code,
 *   2. it must self-report `isModuleType(1)` (validator),
 *   3. it must not already be installed on the account.
 *
 * Read-only; never throws for on-chain "no" answers, only for transport
 * errors the caller should surface as RPC failures.
 */
export const preflightCustomValidatorInstall = async (
  provider: PreflightProvider,
  params: {
    address: string;
    chainId: number;
    metadata: Pick<ISmartAccountMetadata, 'installedModules'>;
  }
): Promise<CustomValidatorPreflightResult> => {
  const address = getAddress(params.address);
  const failures: CustomValidatorPreflightFailure[] = [];

  if (
    getInstalledValidatorModuleByAddress(
      params.metadata as ISmartAccountMetadata,
      address
    )
  ) {
    failures.push('already-installed');
  }

  const code = await provider.getCode(address);
  if (!code || code === '0x') {
    failures.push('no-contract-code');
    // isModuleType would revert against empty code; report and stop.
    return { failures, ok: false };
  }

  const [moduleTypeResult] = await aggregateContractCalls(
    provider,
    params.chainId,
    [
      {
        args: [ERC7579_MODULE_TYPE_VALIDATOR],
        fn: 'isModuleType',
        iface: ERC7579_MODULE_PROBE_INTERFACE,
        target: address,
      },
    ]
  );
  const isValidator =
    moduleTypeResult.success && Boolean(moduleTypeResult.result[0]);
  if (!isValidator) {
    failures.push('not-a-validator-module');
  }

  return { failures, ok: failures.length === 0 };
};

/** True when Pali can natively produce signatures for this validator. */
export const isPaliSignableValidator = (
  module: SmartAccountValidatorModule,
  metadata: Pick<ISmartAccountMetadata, 'installedModules'>
): boolean => {
  switch (module.id) {
    case 'ecdsa':
    case 'p256-webauthn':
    case 'slh-dsa':
      return true;
    case 'composite': {
      // A composite is signable when at least `threshold` children resolve
      // to installed Pali-signable validators.
      const signableChildren = module.config.childValidators.filter((child) => {
        const childModule = getInstalledValidatorModuleByAddress(
          metadata as ISmartAccountMetadata,
          child
        );
        return (
          childModule &&
          childModule.id !== 'custom' &&
          childModule.id !== 'composite'
        );
      });
      return signableChildren.length >= (module.config.threshold || 1);
    }
    case 'custom':
      return false;
    default:
      return false;
  }
};

export class SmartAccountLockoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmartAccountLockoutError';
  }
}

/**
 * Lockout guard: refuses to activate a validator Pali cannot sign with.
 * A custom validator may only participate as a composite child alongside a
 * Pali-signable sibling; it can never become the sole active signer.
 */
export const assertValidatorActivationAllowed = (
  metadata: Pick<ISmartAccountMetadata, 'installedModules'>,
  validatorAddress: string
): void => {
  const module = getInstalledValidatorModuleByAddress(
    metadata as ISmartAccountMetadata,
    validatorAddress
  );
  if (!module) {
    throw new SmartAccountLockoutError(
      'Cannot activate a validator that is not installed on this account.'
    );
  }
  if (isPaliSignableValidator(module, metadata)) {
    return;
  }
  if (module.id === 'custom') {
    throw new SmartAccountLockoutError(
      'A custom validator cannot become the sole active signer. Add it as a composite child alongside a Pali-signable validator instead.'
    );
  }
  throw new SmartAccountLockoutError(
    'Activating this validator would lock Pali out of the account: it has no Pali-signable path.'
  );
};

/** Installed validators that may be picked as composite children. */
export const listCompositeChildCandidates = (
  metadata: Pick<ISmartAccountMetadata, 'installedModules'>
): SmartAccountValidatorModule[] =>
  listInstalledValidatorModules(metadata as ISmartAccountMetadata).filter(
    (module) => module.id !== 'composite'
  );
