import {
  combineReducers,
  configureStore,
  Store,
  Middleware, // Import Middleware type
} from '@reduxjs/toolkit';
import isEqual from 'lodash/isEqual';
import logger from 'redux-logger';
// Assuming redux-thunk v3+, which exports 'thunk' and ThunkMiddleware type
import { thunk, ThunkMiddleware } from 'redux-thunk';

import dapp from './dapp';
import { IDAppState } from './dapp/types';
import { loadState, saveState } from './paliStorage';
import price from './price';
import { IPriceState } from './price/types';
import { IPersistState } from './types';
import vault from './vault';
import { IVaultState } from './vault/types';

// Define RootState earlier if possible, or use a more generic type for ThunkMiddleware initially
// For now, let's assume RootState will be defined later and use 'any' for the thunk state type.

const reducers = combineReducers({
  dapp,
  price,
  vault,
});

const nodeEnv = process.env.NODE_ENV;

// Explicitly type the array we are building for custom middleware
const customMiddlewareToAdd: Middleware[] = [];

// Add your custom thunk first
customMiddlewareToAdd.push(thunk as ThunkMiddleware<any, any>); // Using any for RootState for now

// In development, add logger
if (nodeEnv !== 'production' && nodeEnv !== 'test') {
  customMiddlewareToAdd.push(logger); // redux-logger is typically compatible, cast with 'as Middleware' if needed
}

const store: Store<{
  dapp: IDAppState;
  price: IPriceState;
  vault: IVaultState;
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

export async function updateState() {
  try {
    const state = store.getState();

    // Fast in-memory comparison first. This avoids hitting chrome.storage
    // for the common case where nothing relevant has changed.
    if (lastPersistedState && isEqual(lastPersistedState, state)) {
      return false;
    }

    // Persist and update the cache.
    await saveState(state);
    lastPersistedState = state;

    return true;
  } catch (error) {
    console.error('updateState() failed', error);
    return false;
  }
}

// RootState is typically defined using the store itself, so it's fine here.
export type RootState = ReturnType<typeof store.getState> & {
  _persist: IPersistState;
};
export type AppDispatch = typeof store.dispatch;
export default store;
