import { Store } from '@reduxjs/toolkit';

import { rehydrate as dappRehydrate } from 'state/dapp';
import { rehydrate as priceRehydrate } from 'state/price';
import { rehydrate as vaultRehydrate } from 'state/vault';

import { loadState } from './paliStorage';
export const rehydrateStore = async (store: Store, state?: any) => {
  try {
    const storageState = state || (await loadState());
    if (storageState) {
      store.dispatch(vaultRehydrate(storageState.vault));
      store.dispatch(dappRehydrate(storageState.dapp));
      store.dispatch(priceRehydrate(storageState.price));
    }

    return Promise.resolve();
  } catch (error) {
    console.log({ error });
    return Promise.reject();
  }
};
