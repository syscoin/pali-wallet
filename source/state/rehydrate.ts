import { Store } from '@reduxjs/toolkit';

import { loadState } from './paliStorage';
import { getHasEncryptedVault, setAllState } from './vault';

export const rehydrateStore = async (store: Store) => {
  const storageState = await loadState();

  if (storageState) {
    store.dispatch(setAllState(storageState.vault));
  }

  return Promise.resolve();
};
