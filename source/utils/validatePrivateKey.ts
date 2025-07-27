import { ethers } from 'ethers';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { INetwork } from 'types/network';

export const validatePrivateKeyValue = async (
  privKey: string,
  isBitcoinBased: boolean,
  activeNetwork?: INetwork
) => {
  if (!isBitcoinBased) {
    try {
      // Normalize the private key by adding '0x' prefix if missing
      const normalizedKey =
        privKey.slice(0, 2) === '0x' ? privKey : `0x${privKey}`;
      new ethers.Wallet(normalizedKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  if (isBitcoinBased) {
    // If activeNetwork is undefined, try to get it from the vault
    let networkToValidate = activeNetwork;

    if (!networkToValidate) {
      try {
        // Get the active network from the vault state
        const vaultState = store.getState().vault;
        networkToValidate = vaultState?.activeNetwork;
      } catch (error) {
        // If we can't get the vault state, validation cannot proceed
        console.warn(
          'validatePrivateKeyValue: Unable to get active network for validation'
        );
        return false;
      }
    }

    // If we still don't have a network, we cannot validate
    if (!networkToValidate) {
      console.warn(
        'validatePrivateKeyValue: No network available for Bitcoin-based validation'
      );
      return false;
    }

    try {
      const result = (await controllerEmitter(
        ['wallet', 'validateZprv'],
        [privKey, networkToValidate]
      )) as { isValid: boolean } | undefined;
      return result?.isValid || false;
    } catch (error) {
      console.error('validatePrivateKeyValue: Error validating zprv:', error);
      return false;
    }
  }

  return false;
};
