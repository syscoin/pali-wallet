import {
  setController,
  setIsConnected,
  setIsLocked,
  setIsInstalled,
  updateConnectedAccountData,
} from "../state/wallet";
import store from '../state/store';

const setState = ({ isConnected, isLocked, accountData }) => {
  store.dispatch(setIsConnected(isConnected));
  store.dispatch(setIsLocked(isLocked));
  store.dispatch(
    updateConnectedAccountData(accountData)
  );
}

export const setupState = () => {
  let isLocked = true;

  if (window.ConnectionsController) {
    const controller = window.ConnectionsController;

    controller.isLocked().then((locked) => {
      isLocked = locked;
    });

    store.dispatch(setIsInstalled(true));

    controller.getConnectedAccount().then((account) => {
      if (account) {
        if (isLocked) {
          setState({
            isConnected: true,
            isLocked,
            accountData: {
              balance: account.balance,
              connectedAccount: { ...account, assets: [] },
              connectedAccountAddress: account.address.main,
            }
          });

          return;
        }

        controller.getHoldingsData().then((holdings) => {
          setState({
            isConnected: true,
            isLocked,
            accountData: {
              balance: account.balance,
              connectedAccount: { ...account, assets: holdings },
              connectedAccountAddress: account.address.main,
            }
          });
        })

        return;
      }

      setState({
        isConnected: false,
        isLocked,
        accountData: {
          balance: 0,
          connectedAccount: null,
          connectedAccountAddress: "",
        }
      });
    })
  }
}