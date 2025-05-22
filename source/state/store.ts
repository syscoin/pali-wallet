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

export async function updateState() {
  try {
    const state = store.getState();

    const currentState = await loadState();

    const isStateEqual = isEqual(currentState, state);

    if (isStateEqual) {
      return false;
    }

    await saveState(state);
    return true;
  } catch (error) {
    return false;
  }
}

// RootState is typically defined using the store itself, so it's fine here.
export type RootState = ReturnType<typeof store.getState> & {
  _persist: IPersistState;
};
export type AppDispatch = typeof store.dispatch;
export default store;
