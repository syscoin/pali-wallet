import { Runtime } from 'webextension-polyfill-ts';

import { Message, SupportedEventTypes } from './types';

export const initializeEvents = (port: Runtime.Port) => {
  Object.values(SupportedEventTypes).forEach((method) => {
    window.addEventListener(
      method,
      (event: any) => {
        const { data, origin, chain } = event.detail;
        const id = `${chain}.${origin}.${method}`; // mirrored in inject.ts

        // Always send close because site will already be disconnected and not listening
        if (method === 'close') {
          port.postMessage({ id, data });
        }

        // Event listeners can be attached before connection but DApp must be connected to receive events
        const isConnected = window.controller.dapp.isDAppConnected(origin);

        // The event origin is checked to prevent sites that have not been
        // granted permissions to the user's account information from
        // receiving updates.
        if (
          isConnected &&
          window.controller.dapp.isSiteListening(origin, method)
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

  if (
    !Object.values(SupportedEventTypes).includes(method as SupportedEventTypes)
  ) {
    return;
  }

  // Register the origin of the site that is listening for an event
  window.controller.dapp.registerListeningSite(origin, method);
};

export const deregisterEvent = (message: Message) => {
  const listenerOrigin = message.data.origin;
  const { method } = message.data;

  if (
    !Object.values(SupportedEventTypes).includes(method as SupportedEventTypes)
  ) {
    return;
  }

  window.controller.dapp.deregisterListeningSite(listenerOrigin, method);
};
