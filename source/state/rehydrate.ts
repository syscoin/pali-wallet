import { Store } from '@reduxjs/toolkit';

import { rehydrate as dappRehydrate } from 'state/dapp';
import { rehydrate as priceRehydrate } from 'state/price';
import { rehydrate as vaultRehydrate } from 'state/vault';
import { rehydrate as vaultGlobalRehydrate } from 'state/vaultGlobal';

import { loadState } from './paliStorage';
import vaultCache from './vaultCache';

export const rehydrateStore = async (
  store: Store,
  state?: any,
  slip44?: number
) => {
  try {
    let storageState = state;

    if (!storageState) {
      // Load main state (dapp, price, vaultGlobal, currentSlip44)
      storageState = await loadState();
    }

    if (storageState) {
      // Rehydrate global states first
      if (storageState.dapp) {
        store.dispatch(dappRehydrate(storageState.dapp));
      }
      if (storageState.price) {
        store.dispatch(priceRehydrate(storageState.price));
      }
      if (storageState.vaultGlobal) {
        store.dispatch(vaultGlobalRehydrate(storageState.vaultGlobal));
      }

      // Load slip44-specific vault
      const targetSlip44 = slip44 || storageState.currentSlip44;

      if (targetSlip44) {
        console.log(`[Rehydrate] Loading slip44 vault: ${targetSlip44}`);

        const slip44VaultState = await vaultCache.getSlip44Vault(targetSlip44);

        if (slip44VaultState) {
          // Set as active in cache
          vaultCache.setActiveSlip44(targetSlip44);

          // Rehydrate vault with slip44-specific state
          store.dispatch(vaultRehydrate(slip44VaultState));

          console.log(
            `[Rehydrate] Successfully loaded slip44 vault: ${targetSlip44}`
          );
        } else {
          console.log(
            `[Rehydrate] No vault found for slip44: ${targetSlip44}, will create new`
          );
        }
      } else if (storageState.vault) {
        // Fallback for legacy state structure
        store.dispatch(vaultRehydrate(storageState.vault));
      }
    }

    return Promise.resolve();
  } catch (error) {
    console.log({ error });
    return Promise.reject();
  }
};
