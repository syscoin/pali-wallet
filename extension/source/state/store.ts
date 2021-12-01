import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
// import logger from 'redux-logger';

import wallet from './wallet';
import price from './price';
import { persistStore, persistReducer } from "redux-persist";
import { localStorage } from 'redux-persist-webextension-storage';

const reducers = combineReducers({
  wallet,
  price
})

const persistConfig = {
  key: 'root',
  storage: localStorage
}

const persistedReducer = persistReducer(persistConfig, reducers)

const middleware = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

// if (process.env.NODE_ENV !== 'production') {
//   middleware.push(logger);
// }

const store: Store = configureStore({
  reducer: persistedReducer,
  middleware,
  // devTools: process.env.NODE_ENV !== 'production',
});

persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
