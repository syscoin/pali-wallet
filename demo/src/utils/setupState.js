import {
  setController,
  setIsConnected,
  setIsLocked,
  setIsInstalled,
  updateConnectedAccountData,
} from "../state/wallet";

export default async function setupState(store) {
  let isConnected = false;
  let isLocked = true;

  if (window.ConnectionsController) {
    const controller = window.ConnectionsController;
    const connectedAccount = await controller.getConnectedAccount();
    isLocked = await controller.isLocked();

    if(isLocked && connectedAccount) {
      store.dispatch(setController(controller));
      store.dispatch(setIsInstalled(true));
      store.dispatch(setIsConnected(true));
      store.dispatch(setIsLocked(isLocked));
      store.dispatch(
        updateConnectedAccountData({
          balance: connectedAccount.balance,
          connectedAccount: { ...connectedAccount, assets: [] },
          connectedAccountAddress: connectedAccount.address.main,
        })
      );
      
      return { isConnected: true, isLocked };
    }
    
    
    if (connectedAccount) {
      const holdingsData = await controller.getHoldingsData();      
      isConnected = true;
      
      store.dispatch(setController(controller));
      store.dispatch(setIsInstalled(true));
      store.dispatch(setIsConnected(true));
      store.dispatch(setIsLocked(isLocked));
      store.dispatch(
        updateConnectedAccountData({
          balance: connectedAccount.balance,
          connectedAccount: { ...connectedAccount, assets: holdingsData },
          connectedAccountAddress: connectedAccount.address.main,
        })
      );
    } else {
      store.dispatch(setController(controller));
      store.dispatch(setIsLocked(isLocked));
      store.dispatch(setIsConnected(false));
      store.dispatch(setIsInstalled(true));
      store.dispatch(
        updateConnectedAccountData({
          balance: 0,
          connectedAccount: null,
          connectedAccountAddress: "",
        })
      );
    }
  }

  return { isConnected, isLocked };
}