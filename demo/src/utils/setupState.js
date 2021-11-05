import {
  setController,
  setIsConnected,
  setIsLocked,
  setIsInstalled,
  updateConnectedAccountData,
} from "../state/wallet";

export default async function setupState(store) {
  let isConnected = false;
  let isLocked = false;

  const callback = async (event) => {
    console.log('event', event)
    if (event.detail.SyscoinInstalled) {
      console.log('syscoin installed')
      console.log('window', window.SyscoinWallet)
      setIsInstalled(true);

      if (event.detail.ConnectionsController) {
        setController(window.ConnectionsController);
        setIsLocked(!isLocked);

        return { isConnected, isLocked };
      }

      return { isConnected, isLocked };
    }

    window.removeEventListener('SyscoinStatus', callback);
  }

  console.log('checking syscoin status');

  window.addEventListener('SyscoinStatus', callback);

  console.log('is installed', store.getState().isInstalled)
  return { isConnected, isLocked };
}