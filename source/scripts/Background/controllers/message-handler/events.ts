import { Runtime } from 'webextension-polyfill-ts';

import { Message, DAppEvents } from './types';

/**
 * Adds event listeners for `DAppEvents`. If DApps are listening
 * to those events, sends message to propagate the event
 */
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
  const { origin, eventName } = message.data;

  if (!DAppEvents[eventName]) return;

  window.controller.dapp.addListener(origin, eventName);
};

export const deregisterEvent = (message: Message) => {
  const { origin, eventName } = message.data;

  if (!DAppEvents[eventName]) return;

  window.controller.dapp.removeListener(origin, eventName);
};
