import { Runtime } from 'webextension-polyfill-ts';

import { Message, SupportedEventTypes } from './types';

export const initializeEvents = (port: Runtime.Port) => {
  Object.values(SupportedEventTypes).forEach((eventType) => {
    window.addEventListener(
      eventType,
      (event: any) => {
        const { data, origin } = event.detail;
        const id = `${origin}.${eventType}`;

        if (eventType === 'close') {
          port.postMessage({ id, data });
        }

        if (
          window.controller.dapp.isDAppConnected(origin) &&
          window.controller.dapp.isSiteListening(origin, eventType)
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

  if (!SupportedEventTypes[method]) return;

  window.controller.dapp.registerListeningSite(origin, method);
};

export const deregisterEvent = (message: Message) => {
  const { origin, method } = message.data;

  if (!SupportedEventTypes[method]) return;

  window.controller.dapp.deregisterListeningSite(origin, method);
};
