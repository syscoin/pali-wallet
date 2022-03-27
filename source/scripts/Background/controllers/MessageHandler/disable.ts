import { Runtime } from 'webextension-polyfill-ts';
import { v4 as uuid } from 'uuid';

import { Message } from './types';
import { getHost } from 'utils/getHost';

export const disable = async (
  port: Runtime.Port,
  masterController: any,
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { asset } = message.data;

  const provider =
    asset === 'syscoin'
      ? masterController.paliProvider
      : masterController.ethereumProvider;

  const allowed = masterController.dapp.isDAppConnected(getHost(origin));

  if (origin && !allowed) {
    return Promise.resolve(null);
  }

  if (isPendingWindow()) {
    return Promise.resolve(null);
  }

  const windowId = uuid();

  setPendingWindow(true);

  masterController.dapp.userDisconnectDApp(getHost(origin));

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

  return Promise.resolve({ id: message.id, result: origin && allowed });
};
