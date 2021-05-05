import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
import logger from 'redux-logger';
import throttle from 'lodash/throttle';

import wallet from './wallet';
import price from './price';
import { saveState, loadState } from './localStorage';

const middleware = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

if (process.env.NODE_ENV !== 'production') {
  middleware.push(logger);
}

const store: Store = configureStore({
  reducer: combineReducers({
    wallet,
    price,
  }),
  middleware,
  devTools: process.env.NODE_ENV !== 'production',
  preloadedState: loadState(),
});

store.subscribe(
  throttle(() => {
    const state = store.getState();
    saveState({
      wallet: state.wallet,
      price: state.price,
    });
  }, 1000)
);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
