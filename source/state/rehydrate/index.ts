import { Store } from '@reduxjs/toolkit';

import { rehydrate as dappRehydrate } from '../dapp';
import { rehydrate as priceRehydrate } from '../price';
import { rehydrate as vaultRehydrate, getHasEncryptedVault } from '../vault';
import { loadState } from 'state/localStorage';

const rehydrateStore = async (store: Store) => {
  const storageState = await loadState();

  if (storageState) {
    store.dispatch(vaultRehydrate(storageState.vault));
    store.dispatch(priceRehydrate(storageState.price));
    store.dispatch(dappRehydrate(storageState.dapp));
  }
  await store.dispatch<any>(getHasEncryptedVault());
};

export default rehydrateStore;
