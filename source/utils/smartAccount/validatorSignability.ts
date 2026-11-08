import { getAddress } from '../ethersV6Compat.ts';

import { getInstalledValidatorModuleByAddress } from './modules.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network.ts';

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
            childModule.id === 'ecdsa' ||
            childModule.id === 'p256-webauthn' ||
            childModule.id === 'slh-dsa'
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
