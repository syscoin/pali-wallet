import { getAddress } from '../ethersV6Compat.ts';

import { getInstalledValidatorModuleByAddress } from './modules.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network.ts';

/** Algorithm support for configuration and the dispatcher's existing preflight. */
export const isPaliValidatorAlgorithmSupported = (
  module: SmartAccountValidatorModule
): boolean => ['ecdsa', 'p256-webauthn', 'slh-dsa'].includes(module.id);

/** Shared module structure and threshold traversal with explicit host availability. */
export const isPaliSignableValidator = (
  module: SmartAccountValidatorModule,
  metadata: Pick<ISmartAccountMetadata, 'installedModules'>,
  isAvailable: (validator: SmartAccountValidatorModule) => boolean
): boolean => {
  if (typeof isAvailable !== 'function')
    throw new TypeError('Explicit authenticator availability is required');
  switch (module.id) {
    case 'ecdsa':
    case 'p256-webauthn':
    case 'slh-dsa':
      return isAvailable(module) === true;
    case 'composite': {
      // Match the contract's distinct, installed, non-nested children. An
      // optional external child cannot make an otherwise unavailable local
      // threshold look signable before activation.
      const { childValidators, threshold } = module.config;
      if (
        !Array.isArray(childValidators) ||
        !Number.isSafeInteger(threshold) ||
        threshold < 1 ||
        threshold > childValidators.length
      ) {
        return false;
      }
      try {
        const children = childValidators.map((child) => getAddress(child));
        if (
          new Set(children).size !== children.length ||
          children.includes('0x0000000000000000000000000000000000000000')
        )
          return false;
        let signableChildren = 0;
        for (const child of children) {
          const childModule = getInstalledValidatorModuleByAddress(
            metadata as ISmartAccountMetadata,
            child
          );
          if (
            !childModule ||
            !['ecdsa', 'p256-webauthn', 'slh-dsa', 'custom'].includes(
              childModule.id
            ) ||
            childModule.id === 'composite' ||
            (childModule.id === 'custom' &&
              childModule.config.compositeCompatible !== true)
          ) {
            return false;
          }
          if (
            isPaliValidatorAlgorithmSupported(childModule) &&
            isAvailable(childModule) === true
          ) {
            signableChildren++;
          }
        }
        return signableChildren >= threshold;
      } catch {
        return false;
      }
    }
    case 'custom':
      return false;
    default:
      return false;
  }
};
