import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
import isEqual from 'lodash/isEqual';
import logger from 'redux-logger';
import { thunk } from 'redux-thunk';

import dapp from './dapp';
import { IDAppState } from './dapp/types';
import { loadState, saveState } from './paliStorage';
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

const middleware: any = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

middleware.push(thunk);

const nodeEnv = process.env.NODE_ENV;

if (nodeEnv !== 'production' && nodeEnv !== 'test') {
  middleware.push(logger as never);
}

const store: Store<{
  dapp: IDAppState;
  price: IPriceState;
  vault: IVaultState;
}> = configureStore({
  reducer: reducers,
  middleware,
  devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
});

export async function updateState() {
  try {
    const state = store.getState();

    const currentState = await loadState();

    const isStateEqual = isEqual(currentState, state);
    console.log({ isStateEqual });
    if (isStateEqual) {
      return false;
    }
    await saveState(state);
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
