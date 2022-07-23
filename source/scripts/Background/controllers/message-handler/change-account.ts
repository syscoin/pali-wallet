import { browser } from 'webextension-polyfill-ts';

/**
 * Opens a popup to select another account to connect
 *
 * @return `true` if the selected account was changed
 */
export const changeAccount = async (
  network: string,
  origin: string,
  isPendingWindow: () => boolean,
  setPendingWindow: (isPending: boolean) => void
) => {
  const { dapp, createPopup } = window.controller;

  const isConnected = dapp.isConnected(origin);

  if (isPendingWindow() || !isConnected) return;

  const popup = await createPopup('change-account', { network, origin });

  setPendingWindow(true);

  return new Promise<boolean>((resolve) => {
    window.addEventListener(
      'accountChange',
      (event: CustomEvent) => {
        if (event.detail.origin === origin) {
          setPendingWindow(false);
          resolve(true);
        }
      },
      { once: true, passive: true }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (id === popup.id) {
        setPendingWindow(false);
        resolve(false);
      }
    });
  });
};
