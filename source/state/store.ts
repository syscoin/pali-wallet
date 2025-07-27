import {
  combineReducers,
  configureStore,
  Store,
  Middleware, // Import Middleware type
} from '@reduxjs/toolkit';
import isEqual from 'lodash/isEqual';
// Assuming redux-thunk v3+, which exports 'thunk' and ThunkMiddleware type
import { thunk, ThunkMiddleware } from 'redux-thunk';

import { INetwork } from 'types/network';

import dapp from './dapp';
import { IDAppState } from './dapp/types';
import { loadState, saveState } from './paliStorage';
import price from './price';
import { IPriceState } from './price/types';
import { IPersistState } from './types';
import vault, {
  rehydrate as vaultRehydrate,
  initializeCleanVaultForSlip44,
} from './vault';
import { IVaultState, IGlobalState } from './vault/types';
import vaultCache from './vaultCache';
import vaultGlobal, { setActiveSlip44 } from './vaultGlobal';

// Define RootState earlier if possible, or use a more generic type for ThunkMiddleware initially
// For now, let's assume RootState will be defined later and use 'any' for the thunk state type.

const reducers = combineReducers({
  dapp,
  price,
  vault,
  vaultGlobal,
});

const nodeEnv = process.env.NODE_ENV;

// Explicitly type the array we are building for custom middleware
const customMiddlewareToAdd: Middleware[] = [];

// Add your custom thunk first
customMiddlewareToAdd.push(thunk as ThunkMiddleware<any, any>); // Using any for RootState for now

// In development, add logger - DISABLED to reduce console noise
// if (nodeEnv !== 'production' && nodeEnv !== 'test') {
//   customMiddlewareToAdd.push(logger); // redux-logger is typically compatible, cast with 'as Middleware' if needed
// }

const store: Store<{
  dapp: IDAppState;
  price: IPriceState;
  vault: IVaultState;
  vaultGlobal: IGlobalState;
  // _persist: IPersistState; // If _persist is part of the direct store state, include it here
}> = configureStore({
  reducer: reducers,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      thunk: false, // We are adding our own thunk instance
      serializableCheck: false,
    }).concat(customMiddlewareToAdd), // Concat our custom middleware array
  devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
});

// Cache the last persisted state locally to avoid the expensive
// read-&-parse cycle from chrome.storage on every store update. This
// drastically reduces the amount of asynchronous I/O **and** the number of
// full-state JSON serialisations.

let lastPersistedState: any | null = null;

// Initialize cache once on startup.
(async () => {
  try {
    lastPersistedState = await loadState();
  } catch (e) {
    // Non-fatal – cache will be initialised on first successful persist.
    console.warn('Unable to preload persisted state cache', e);
  }
})();

// Manual state persistence for important operations
export async function saveMainState() {
  try {
    const state = store.getState();

    // Fast in-memory comparison first. This avoids hitting chrome.storage
    // for the common case where nothing relevant has changed.
    if (
      lastPersistedState &&
      isEqual(lastPersistedState.dapp, state.dapp) &&
      isEqual(lastPersistedState.price, state.price) &&
      isEqual(lastPersistedState.vaultGlobal, state.vaultGlobal)
    ) {
      return false;
    }
    // Create main state with only global data (dapp, price, vaultGlobal)
    const mainState = {
      dapp: state.dapp,
      price: state.price,
      vaultGlobal: state.vaultGlobal,
    };

    await saveState(mainState);
    lastPersistedState = state;
    return true;
  } catch (error) {
    console.error('saveMainState() failed', error);
    return false;
  }
}

// New centralized function to load and activate a slip44 vault
export async function loadAndActivateSlip44Vault(
  slip44: number,
  targetNetwork?: INetwork,
  deferActiveSlip44Update = false
): Promise<boolean> {
  try {
    console.log(`[Store] Loading slip44 vault: ${slip44}`);

    // Only set activeSlip44 immediately if not deferred
    // When deferred, the caller will set it after session transfer
    if (!deferActiveSlip44Update) {
      console.log(`[Store] Setting activeSlip44 to ${slip44}`);
      store.dispatch(setActiveSlip44(slip44));
    } else {
      console.log(
        `[Store] Deferring activeSlip44 update for slip44: ${slip44}`
      );
    }

    const slip44VaultState = await vaultCache.getSlip44Vault(slip44);

    if (slip44VaultState) {
      console.log(`[Store] Loading existing vault state for slip44: ${slip44}`);

      // Load vault state into Redux
      store.dispatch(vaultRehydrate(slip44VaultState));

      console.log(`[Store] Successfully loaded slip44 vault: ${slip44}`);
      return true;
    } else {
      console.log(
        `[Store] No vault data found for slip44: ${slip44} - initializing clean vault state`
      );

      // No vault exists - initialize clean state for this slip44
      // This prevents copying accounts from previous slip44 when saving later
      const networkToUse =
        targetNetwork || store.getState().vault.activeNetwork;
      store.dispatch(initializeCleanVaultForSlip44(networkToUse));

      console.log(
        `[Store] Initialized clean vault state for slip44: ${slip44}`
      );
      return false;
    }
  } catch (error) {
    console.error(`[Store] Failed to load slip44 vault ${slip44}:`, error);
    return false;
  }
}

// RootState is typically defined using the store itself, so it's fine here.
export type RootState = ReturnType<typeof store.getState> & {
  _persist: IPersistState;
};
export type AppDispatch = typeof store.dispatch;
export default store;
