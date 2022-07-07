import { v4 as uuid } from 'uuid';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { getHost } from 'utils/getHost';

import { Message } from './types';

export const enable = async (
  port: Runtime.Port,
  masterController: any,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { asset } = message.data;

  const provider =
    asset === 'SYS'
      ? masterController.paliProvider
      : masterController.ethereumProvider;

  const isConnected = masterController.dapp.isDAppConnected(getHost(origin));
  const hasConnectedAccount = masterController.dapp.hasConnectedAccount();

  if (origin && (!isConnected || !hasConnectedAccount)) {
    if (isPendingWindow()) {
      return Promise.resolve(null);
    }

    const windowId = uuid();
    const popup = await masterController.createPopup(
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
