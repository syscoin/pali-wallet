import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
import logger from 'redux-logger';
import { persistStore, persistReducer } from 'redux-persist';
import { localStorage } from 'redux-persist-webextension-storage';

import dapp from './dapp';
import { IDAppState } from './dapp/types';
import { saveState } from './paliStorage';
import price from './price';
import { IPriceState } from './price/types';
import { IPersistState } from './types';
import vault from './vault';
import { IVaultState } from './vault/types';

const reducers = combineReducers({
  dapp,
  price,
  vault,
});

const persistConfig = {
  key: 'root',
  storage: localStorage,
};

const persistedReducer = persistReducer(persistConfig, reducers);

const middleware: any = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

const nodeEnv = process.env.NODE_ENV;

if (nodeEnv !== 'production' && nodeEnv !== 'test') {
  middleware.push(logger as never);
}

const store: Store<{
  dapp: IDAppState;
  price: IPriceState;
  vault: IVaultState;
}> = configureStore({
  reducer: persistedReducer,
  middleware,
  devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
});

export const persistor = persistStore(store);

export function updateState() {
  try {
    const state = store.getState();

    saveState(state);
    return true;
  } catch (error) {
    return false;
  }
}

export type RootState = ReturnType<typeof store.getState> & {
  _persist: IPersistState;
};
export type AppDispatch = typeof store.dispatch;
export default store;
