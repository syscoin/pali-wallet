import {
  setController,
  setIsInstalled,
  updateConnectedAccountData,
} from "../state/wallet";

export default async function setupState(store) {
  if (window.ConnectionsController) {
    const controller = window.ConnectionsController;
    const connectedAccount = controller
      ? await controller.getConnectedAccount()
      : undefined;

    store.dispatch(setController(controller));
    store.dispatch(setIsInstalled(Boolean(window.SyscoinWallet)));
    connectedAccount &&
      store.dispatch(
        updateConnectedAccountData({
          balance: connectedAccount.balance,
          connectedAccount,
          connectedAccountAddress: connectedAccount.address.main,
        })
      );
  }

  return Boolean(window.SyscoinWallet);
}
