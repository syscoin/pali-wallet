import { ethErrors } from 'helpers/errors';
import { browser } from 'webextension-polyfill-ts';

import cleanErrorStack from 'utils/cleanErrorStack';

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
  data?: object;
  eventName: string;
  host: string;
  route: string;
}) => {
  const { dapp, createPopup } = window.controller;
  if (
    eventName !== 'connect' &&
    eventName !== 'wallet_switchEthereumChain' &&
    eventName !== 'wallet_addEthereumChain' &&
    eventName !== 'change_UTXOEVM' &&
    eventName !== 'switchNetwork' &&
    !dapp.isConnected(host)
  )
    return;
  if (dapp.hasWindow(host))
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Dapp already has a open window')
    );
  dapp.setHasWindow(host, true);
  data = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
  let popup = null;
  try {
    popup = await createPopup(route, { ...data, host, eventName });
  } catch (error) {
    dapp.setHasWindow(host, false);
    throw error;
  }
  return new Promise((resolve) => {
    window.addEventListener(
      `${eventName}.${host}`,
      (event: CustomEvent) => {
        if (event.detail !== undefined && event.detail !== null) {
          if (
            route === 'tx/send/ethTx' ||
            route === 'tx/send/approve' ||
            route === 'tx/send/nTokenTx'
          ) {
            resolve(event.detail.hash);
          }
          resolve(event.detail);
        }
        if (
          route === 'switch-EthChain' ||
          route === 'add-EthChain' ||
          route === 'switch-UtxoEvm'
        ) {
          resolve(null);
          dapp.setHasWindow(host, false);
          return null;
        }
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
          route === 'change-account' ||
          route === 'switch-UtxoEvm' ||
          route === 'watch-asset' ||
          route === 'switch-network'
        ) {
          resolve(cleanErrorStack(ethErrors.provider.userRejectedRequest()));
        }
        dapp.setHasWindow(host, false);
        resolve({ success: false });
      }
    });
  });
};
