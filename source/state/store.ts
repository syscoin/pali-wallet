import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
import logger from 'redux-logger';
import { persistStore, persistReducer } from 'redux-persist';
import { localStorage } from 'redux-persist-webextension-storage';

import price from './price';
import { IPriceState } from './price/types';
import vault from './vault';
import { IVaultState } from './vault/types';

const reducers = combineReducers({
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
  price: IPriceState;
  vault: IVaultState;
}> = configureStore({
  reducer: persistedReducer,
  middleware,
  devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
});

persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const currentPriceState = store.getState().price;

export default store;
