import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
} from '@reduxjs/toolkit';
import { throttle } from 'lodash';
import logger from 'redux-logger';
import thunk from 'redux-thunk';

import MigrationController from 'scripts/Background/controllers/MigrationController';
import { compareObjects } from 'utils/objects';

import dapp from './dapp';
import { loadState, saveState } from './localStorage';
import price from './price';
import rehydrateStore from './rehydrate';
import vault from './vault';

const middleware: any = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

middleware.push(thunk);

const nodeEnv = process.env.NODE_ENV;

if (nodeEnv !== 'production' && nodeEnv !== 'test') {
  middleware.push(logger as never);
}

const store = configureStore({
  reducer: combineReducers({
    vault,
    price,
    dapp,
  }),
  middleware,
  devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
});

// const store: Store<{
//   dapp: IDAppState;
//   price: IPriceState;
//   vault: IVaultState;
// }> = configureStore({
//   reducer: persistedReducer,
//   middleware,
//   devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
// });

export async function updateState() {
  const state = store.getState();

  const updatedState = {
    vault: state.vault,
    price: state.price,
    dapp: state.dapp,
  };

  const currentState = await loadState();

  if (currentState) {
    const updatedNoPrice = { ...updatedState };
    const currentNoPrice = { ...currentState };
    delete updatedNoPrice.price;
    delete currentNoPrice.price;
    const equalStates = compareObjects(updatedNoPrice, currentNoPrice);
    if (equalStates) return false;
  }

  await saveState(updatedState);
  return true;
}

MigrationController().then(async () => {
  await rehydrateStore(store);
  store.subscribe(
    throttle(async () => {
      // every second we update store state
      await updateState();
    }, 1000)
  );
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
