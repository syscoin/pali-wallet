import { Runtime } from 'webextension-polyfill-ts';

import { Message, SupportedEventTypes } from './types';

export const initializeEvents = (masterController: any, port: Runtime.Port) => {
  Object.values(SupportedEventTypes).map((method) => {
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
        const allowed = masterController.dapp.isDAppConnected(origin);

        // The event origin is checked to prevent sites that have not been
        // granted permissions to the user's account information from
        // receiving updates.
        if (allowed && masterController.dapp.isSiteListening(origin, method)) {
          port.postMessage({ id, data });
        }
      },
      { passive: true }
    );
  });
};

export const registerEvent = (masterController: any, message: Message) => {
  const { origin, method } = message.data;

  if (
    !Object.values(SupportedEventTypes).includes(method as SupportedEventTypes)
  ) {
    return;
  }

  // Register the origin of the site that is listening for an event
  masterController.dapp.registerListeningSite(origin, method);
};

export const deregisterEvent = (masterController: any, message: Message) => {
  const listenerOrigin = message.data.origin;
  const { method } = message.data;

  if (
    !Object.values(SupportedEventTypes).includes(method as SupportedEventTypes)
  ) {
    return;
  }

  masterController.dapp.deregisterListeningSite(listenerOrigin, method);
};
