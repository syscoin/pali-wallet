import { Runtime } from 'webextension-polyfill-ts';

import { Message, DAppEvents } from './types';

export const setupEvents = (port: Runtime.Port) => {
  Object.values(DAppEvents).forEach((eventType) => {
    window.addEventListener(
      eventType,
      (event: CustomEvent) => {
        const { data, origin } = event.detail;
        const id = `${origin}.${eventType}`;

        if (eventType === 'disconnect') {
          port.postMessage({ id, data });
        }

        if (
          window.controller.dapp.isConnected(origin) &&
          window.controller.dapp.hasListener(origin, eventType)
        ) {
          port.postMessage({ id, data });
        }
      },
      { passive: true }
    );
  });
};

export const registerEvent = (message: Message) => {
  const { origin, method } = message.data;

  if (!DAppEvents[method]) return;

  window.controller.dapp.addListener(origin, method);
};

export const deregisterEvent = (message: Message) => {
  const { origin, method } = message.data;

  if (!DAppEvents[method]) return;

  window.controller.dapp.removeListener(origin, method);
};
