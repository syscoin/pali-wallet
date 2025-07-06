import { Store } from '@reduxjs/toolkit';

import { rehydrate as dappRehydrate } from 'state/dapp';
import { rehydrate as priceRehydrate } from 'state/price';
import { rehydrate as vaultRehydrate } from 'state/vault';
import { rehydrate as vaultGlobalRehydrate } from 'state/vaultGlobal';

import { loadState } from './paliStorage';
import { loadAndActivateSlip44Vault } from './store';

export const rehydrateStore = async (
  store: Store,
  state?: any,
  slip44?: number
) => {
  try {
    let storageState = state;

    if (!storageState) {
      // Load main state (dapp, price, vaultGlobal)
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

      // Handle vault state based on context
      if (state && state.vault) {
        // Frontend context: Complete state provided by background script
        // Just rehydrate the vault directly - no need to load from storage
        console.log('[Rehydrate] Using vault state from background script');
        store.dispatch(vaultRehydrate(state.vault));
      } else {
        // Background context: Need to load slip44-specific vault from storage
        const targetSlip44 = slip44 ?? storageState.vaultGlobal?.activeSlip44;

        if (targetSlip44 !== null && targetSlip44 !== undefined) {
          console.log(
            `[Rehydrate] Loading slip44 vault using centralized function: ${targetSlip44}`
          );

          const hasExistingVaultState = await loadAndActivateSlip44Vault(
            targetSlip44
          );

          if (hasExistingVaultState) {
            console.log(
              `[Rehydrate] Successfully loaded slip44 vault: ${targetSlip44}`
            );
          } else {
            console.log(
              `[Rehydrate] No vault found for slip44: ${targetSlip44}, will create new`
            );
          }
        } else {
          console.log(
            '[Rehydrate] No slip44 context available - vault will be created when wallet is initialized'
          );
        }
      }
    }

    return Promise.resolve();
  } catch (error) {
    console.log({ error });
    return Promise.reject();
  }
};
