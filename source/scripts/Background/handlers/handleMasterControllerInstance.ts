import MasterController from 'scripts/Background/controllers';
import { rehydrate as dappRehydrate } from 'state/dapp';
import { loadState } from 'state/paliStorage';
import { rehydrate as priceRehydrate } from 'state/price';
import store from 'state/store';
import { rehydrate as vaultRehydrate } from 'state/vault';

export const handleMasterControllerInstance = async () => {
  const storageState = await loadState();
  if (storageState) {
    store.dispatch(vaultRehydrate(storageState.vault));
    store.dispatch(dappRehydrate(storageState.dapp));
    store.dispatch(priceRehydrate(storageState.price));
  }

  return MasterController(store);
};
