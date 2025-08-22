import { Wallet } from '@ethersproject/wallet';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { INetwork } from 'types/network';

export const validatePrivateKeyValue = async (
  privKey: string,
  isBitcoinBased: boolean,
  activeNetwork?: INetwork
) => {
  if (!isBitcoinBased) {
    // First check if it looks like a UTXO extended key (zprv/vprv)
    const zprvPrefixes = ['zprv', 'vprv', 'xprv', 'tprv'];
    const prefix = privKey.substring(0, 4);
    if (zprvPrefixes.includes(prefix)) {
      // This looks like a UTXO key, reject it on EVM network
      return false;
    }

    try {
      // Normalize the private key by adding '0x' prefix if missing
      const normalizedKey =
        privKey.slice(0, 2) === '0x' ? privKey : `0x${privKey}`;
      new Wallet(normalizedKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  if (isBitcoinBased) {
    // First check if it looks like an EVM key (0x prefix or 64 hex chars)
    if (privKey.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(privKey)) {
      // This looks like an EVM private key, reject it on UTXO network
      return false;
    }
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
      // Check extended key format first
      const zprvResult = (await controllerEmitter(
        ['wallet', 'validateZprv'],
        [privKey, networkToValidate]
      )) as { isValid: boolean } | undefined;
      if (zprvResult?.isValid) return true;

      // Fallback to WIF validation for single-address keys
      const wifResult = (await controllerEmitter(
        ['wallet', 'validateWif'],
        [privKey, networkToValidate]
      )) as { isValid: boolean } | undefined;
      return wifResult?.isValid || false;
    } catch (error) {
      console.error(
        'validatePrivateKeyValue: Error validating UTXO key:',
        error
      );
      return false;
    }
  }

  return false;
};
