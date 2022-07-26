import { browser } from 'webextension-polyfill-ts';

/**
 * Opens a popup to select an account to connect
 *
 * @return `true` if an account was selected
 */
export const enable = async (origin: string, network: string) => {
  const { dapp, createPopup } = window.controller;

  if (dapp.isConnected(origin)) return true;

  if (dapp.hasWindow(origin)) return;

  const popup = await createPopup('connect-wallet', { network, origin });

  dapp.setHasWindow(origin, true);

  return new Promise<boolean>((resolve) => {
    window.addEventListener(
      'connect',
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
