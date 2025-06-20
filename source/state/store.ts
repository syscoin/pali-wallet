import {
  combineReducers,
  configureStore,
  Store,
  Middleware, // Import Middleware type
} from '@reduxjs/toolkit';
import isEqual from 'lodash/isEqual';
// Assuming redux-thunk v3+, which exports 'thunk' and ThunkMiddleware type
import { thunk, ThunkMiddleware } from 'redux-thunk';

import dapp from './dapp';
import { IDAppState } from './dapp/types';
import { loadState, saveState } from './paliStorage';
import price from './price';
import { IPriceState } from './price/types';
import { IPersistState } from './types';
import vault, { markDirty } from './vault';
import { IVaultState, IGlobalState } from './vault/types';
import vaultCache from './vaultCache';
import vaultGlobal from './vaultGlobal';

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
// full-state JSON serialisations, which were happening every second via the
// throttled subscriber in `handleStoreSubscribe`.

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

// Add emergency save on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Synchronous emergency save for page unload
    vaultCache.emergencySave().catch((error) => {
      console.error('Failed to emergency save on page unload:', error);
    });
  });
}

export async function updateState() {
  try {
    const state = store.getState();

    // Fast in-memory comparison first. This avoids hitting chrome.storage
    // for the common case where nothing relevant has changed.
    if (lastPersistedState && isEqual(lastPersistedState, state)) {
      return false;
    }

    // Get current active slip44 from vault cache
    const activeSlip44 = vaultCache.getActiveSlip44();

    if (activeSlip44 !== null && state.vault) {
      // Update the slip44-specific vault in cache
      vaultCache.updateSlip44VaultInCache(activeSlip44, state.vault);

      // Save main state with global data
      const mainState = {
        dapp: state.dapp,
        price: state.price,
        vaultGlobal: state.vaultGlobal,
        currentSlip44: activeSlip44,
      };

      // Only save main state if it actually changed
      if (
        !lastPersistedState ||
        !isEqual(lastPersistedState.dapp, state.dapp) ||
        !isEqual(lastPersistedState.price, state.price) ||
        !isEqual(lastPersistedState.vaultGlobal, state.vaultGlobal) ||
        lastPersistedState.currentSlip44 !== activeSlip44
      ) {
        await saveState(mainState);
      }
    } else {
      // Fallback to saving complete state (for initial setup or migration)
      await saveState(state);
    }

    lastPersistedState = state;

    return true;
  } catch (error) {
    console.error('updateState() failed', error);
    return false;
  }
}

// New function to force save dirty vaults (for important changes)
export async function forceSaveDirtyVaults() {
  try {
    await vaultCache.saveDirtyVaults();
    return true;
  } catch (error) {
    console.error('forceSaveDirtyVaults() failed', error);
    return false;
  }
}

// New function to mark active vault as dirty (for manual dirty marking)
export function markActiveVaultDirty() {
  const activeSlip44 = vaultCache.getActiveSlip44();
  if (activeSlip44 !== null) {
    const currentState = store.getState();
    if (currentState.vault) {
      // Import the markDirty action
      store.dispatch(markDirty());
    }
  }
}

// New function to get dirty vault status
export function getDirtyVaultStatus() {
  return {
    dirtySlip44s: vaultCache.getDirtySlip44s(),
    activeSlip44: vaultCache.getActiveSlip44(),
    isActiveDirty:
      vaultCache.getActiveSlip44() !== null
        ? vaultCache.isDirty(vaultCache.getActiveSlip44()!)
        : false,
  };
}

// New function to load state with vault cache
export async function loadStateWithSlip44(slip44?: number) {
  try {
    // Load global state (dapp, price, vaultGlobal)
    const globalState = await loadState();

    if (!globalState) {
      return null;
    }

    // Determine which slip44 to load
    const targetSlip44 = slip44 || globalState?.currentSlip44;

    if (targetSlip44) {
      // Load slip44-specific vault state using cache
      const slip44VaultState = await vaultCache.getSlip44Vault(targetSlip44);

      if (slip44VaultState) {
        // Set as active in cache
        vaultCache.setActiveSlip44(targetSlip44);

        return {
          dapp: globalState.dapp,
          price: globalState.price,
          vaultGlobal: globalState.vaultGlobal,
          vault: slip44VaultState,
        };
      }
    }

    // Fallback: return state as-is if it has vault
    if (globalState.vault) {
      return globalState;
    }

    return globalState;
  } catch (error) {
    console.error('loadStateWithSlip44() failed', error);
    return null;
  }
}

// RootState is typically defined using the store itself, so it's fine here.
export type RootState = ReturnType<typeof store.getState> & {
  _persist: IPersistState;
};
export type AppDispatch = typeof store.dispatch;
export default store;
