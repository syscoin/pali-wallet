import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
import logger from 'redux-logger';
import { persistStore, persistReducer } from 'redux-persist';
import { localStorage } from 'redux-persist-webextension-storage';

import wallet from './wallet';
import price from './price';
import vault from './vault';
import dapp from './dapp';

const reducers = combineReducers({
  wallet,
  price,
  vault,
  dapp,
});

const persistConfig = {
  key: 'root',
  storage: localStorage,
};

const persistedReducer = persistReducer(persistConfig, reducers);

const middleware = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

if (process.env.NODE_ENV !== 'production') {
  middleware.push(logger);
}

const store: Store = configureStore({
  reducer: persistedReducer,
  middleware,
  devTools: process.env.NODE_ENV !== 'production',
});

persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
