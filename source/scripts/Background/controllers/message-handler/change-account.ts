import { browser } from 'webextension-polyfill-ts';

/**
 * Opens a popup to select another account to connect
 *
 * @return `true` if the selected account was changed
 */
export const changeAccount = async (network: string, origin: string) => {
  const { dapp, createPopup } = window.controller;

  const isConnected = dapp.isConnected(origin);

  if (dapp.hasWindow(origin) || !isConnected) return;

  const popup = await createPopup('change-account', { network, origin });

  dapp.setHasWindow(origin, true);

  return new Promise<boolean>((resolve) => {
    window.addEventListener(
      'accountChange',
      (event: CustomEvent) => {
        if (event.detail.origin === origin) {
          resolve(true);
        }
      },
      { once: true, passive: true }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (id === popup.id) {
        dapp.setHasWindow(origin, false);
        resolve(false);
      }
    });
  });
};
