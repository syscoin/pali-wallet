import { v4 as uuid } from 'uuid';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { Message } from './types';

export const enable = async (
  port: Runtime.Port,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { dapp } = window.controller;

  const isConnected = dapp.isDAppConnected(origin);
  const hasConnectedAccount = dapp.hasConnectedAccount();

  if (isConnected && hasConnectedAccount) return true;

  if (isPendingWindow()) return;

  const windowId = uuid();
  const popup = await window.controller.createPopup(
    windowId,
    message.data.network,
    'connect-wallet'
  );

  setPendingWindow(true);

  return new Promise<boolean>((resolve) => {
    window.addEventListener(
      'connectWallet',
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
