import { browser, Runtime } from 'webextension-polyfill-ts';
import { v4 as uuid } from 'uuid';

import { Message } from './types';

export const enable = async (
  port: Runtime.Port,
  masterController: any,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  console.log(
    'enable successful called',
    port,
    masterController,
    message,
    origin,
    isPendingWindow
  );
  const { asset } = message.data;

  const provider =
    asset === 'syscoin'
      ? masterController.paliProvider
      : masterController.ethereumProvider;

  console.log('current provider', provider);

  const allowed = masterController.dapp.isDAppConnected(origin);

  console.log('origin is allowed', allowed);

  if (origin && !allowed) {
    if (isPendingWindow()) {
      console.log('isPendingWindow returning null');
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
              data: { accounts: ev.detail.accountId },
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
          data: { result: origin && allowed },
        });

        setPendingWindow(false);
      }
    });

    console.log('returning Promise.resolve null');

    return Promise.resolve(null);
  }

  console.log('Sending message id');

  return Promise.resolve({ id: message.id, result: origin && allowed });
};
