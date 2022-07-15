import { v4 as uuid } from 'uuid';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { getHost } from 'utils/getHost';

import { Message } from './types';

export const enable = async (
  port: Runtime.Port,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { dapp } = window.controller;

  const { chain } = message.data;
  const provider = chain === 'syscoin' ? dapp.sysProvider : dapp.ethProvider;

  const isConnected = dapp.isDAppConnected(getHost(origin));
  const hasConnectedAccount = dapp.hasConnectedAccount();

  if (origin && (!isConnected || !hasConnectedAccount)) {
    if (isPendingWindow()) {
      return Promise.resolve(null);
    }

    const windowId = uuid();
    const popup = await window.controller.createPopup(
      windowId,
      message.data.network,
      'connect-wallet'
    );

    setPendingWindow(true);

    window.addEventListener(
      'connectWallet',
      (ev: any) => {
        if (ev.detail.windowId === windowId) {
          port.postMessage({
            id: message.id,
            data: {
              result: true,
              data: { accounts: provider.getAccounts() },
            },
          });

          setPendingWindow(false);
        }
      },
      { once: true, passive: true }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (popup && id === popup.id) {
        port.postMessage({
          id: message.id,
          data: { result: origin && isConnected },
        });

        setPendingWindow(false);
      }
    });

    return Promise.resolve(null);
  }

  return Promise.resolve({ id: message.id, result: origin && isConnected });
};
