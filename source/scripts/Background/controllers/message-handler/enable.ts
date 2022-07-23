import { browser } from 'webextension-polyfill-ts';

import { Message } from './types';

/**
 * Opens a popup to select an account to connect
 *
 * @return `true` if an account was selected
 */
export const enable = async (
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { network } = message.data;
  const { dapp, createPopup } = window.controller;

  if (dapp.isConnected(origin)) return true;

  if (isPendingWindow()) return;

  const popup = await createPopup('connect-wallet', { network, origin });

  setPendingWindow(true);

  return new Promise<boolean>((resolve) => {
    window.addEventListener(
      'connect',
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
