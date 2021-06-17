import {
  setController,
  setIsConnected,
  setIsInstalled,
  updateConnectedAccountData,
} from "../state/wallet";

export default async function setupState(store) {
  let isConnected = false;

  if (window.ConnectionsController) {
    const controller = window.ConnectionsController;
    const holdingsData = await controller.getHoldingsData();

    const connectedAccount = await controller.getConnectedAccount();

    store.dispatch(setController(controller));
    store.dispatch(setIsInstalled(true));

    if (connectedAccount) {
      isConnected = true;

      store.dispatch(setIsConnected(true));
      store.dispatch(
        updateConnectedAccountData({
          balance: connectedAccount.balance,
          connectedAccount: { ...connectedAccount, assets: holdingsData },
          connectedAccountAddress: connectedAccount.address.main,
        })
      );
    } else {
      store.dispatch(setIsConnected(false));
      store.dispatch(
        updateConnectedAccountData({
          balance: 0,
          connectedAccount: null,
          connectedAccountAddress: "",
        })
      );
    }
  }

  return isConnected;
}
