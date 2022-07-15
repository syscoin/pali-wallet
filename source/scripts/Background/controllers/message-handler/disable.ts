import { v4 as uuid } from 'uuid';
import { Runtime } from 'webextension-polyfill-ts';

import { getHost } from 'utils/getHost';

import { Message } from './types';

export const disable = async (
  port: Runtime.Port,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { chain } = message.data;
  const { controller } = window;

  const provider =
    chain === 'syscoin'
      ? controller.dapp.sysProvider
      : controller.dapp.ethProvider;

  const isConnected = controller.dapp.isDAppConnected(getHost(origin));

  if (origin && !isConnected) {
    return Promise.resolve(null);
  }

  if (isPendingWindow()) {
    return Promise.resolve(null);
  }

  const windowId = uuid();

  setPendingWindow(true);

  controller.dapp.userDisconnectDApp(getHost(origin));

  window.addEventListener(
    'disconnectWallet',
    (ev: any) => {
      if (ev.detail.windowId === windowId) {
        port.postMessage({
          id: message.id,
          data: {
            result: true,
            data: { connected: provider.isConnected },
          },
        });

        setPendingWindow(false);
      }
    },
    { once: true, passive: true }
  );

  return Promise.resolve({ id: message.id, result: origin && isConnected });
};
