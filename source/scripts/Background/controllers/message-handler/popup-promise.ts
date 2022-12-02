import { browser } from 'webextension-polyfill-ts';

/**
 * Opens a popup and adds events listener to resolve a promise.
 *
 * @param host The dApp host
 * @param route The popup route
 * @param eventName The event which will resolve the promise.
 * The final event name is `eventName.host`
 * @param data information that will be passed to the route. Optional
 *
 * @return either the event data or `{ success: boolean }`
 */
export const popupPromise = async ({
  data,
  eventName,
  host,
  route,
}: {
  data?: object | any;
  eventName: string;
  host: string;
  route: string;
}) => {
  const { dapp, createPopup, wallet } = window.controller;
  const currentNetwork = wallet.getNetwork();

  if (
    (eventName === 'wallet_switchEthereumChain' &&
      data.chainId === currentNetwork.chainId) ||
    (dapp.hasWindow(host) && eventName === 'connect') ||
    (dapp.isConnected(host) && eventName === 'connect') ||
    dapp.hasWindow(host)
  )
    return;

  data = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
  const popup = await createPopup(route, { ...data, host, eventName });
  dapp.setHasWindow(host, true);
  return new Promise((resolve) => {
    window.addEventListener(
      `${eventName}.${host}`,
      (event: CustomEvent) => {
        if (route === 'tx/send/ethTx') {
          console.log('Verifying response', event);
        }
        if (event.detail !== undefined && event.detail !== null) {
          resolve(event.detail);
        }
        if (route === 'switch-EthChain' || route === 'add-EthChain')
          resolve(null);
      },
      { once: true, passive: true }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (id === popup.id) {
        if (
          route === 'tx/send/ethTx' ||
          route === 'tx/send/approve' ||
          route === 'tx/ethSign' ||
          route === 'tx/encryptKey' ||
          route === 'switch-EthChain' ||
          route === 'add-EthChain' ||
          route === 'add-EthChain' ||
          route === 'change-account'
        ) {
          resolve({ code: 4001, message: 'Pali: User rejected transaction' });
        }
        dapp.setHasWindow(host, false);
        resolve({ success: false });
      }
    });
  });
};
