import { browser, Runtime } from 'webextension-polyfill-ts';

import { disable } from './disable';
import { enable } from './enable';
import { registerEvent, deregisterEvent } from './events';
import { methodRequest } from './requests';
import { Message } from './types';

/**
 * Setups message communication with DApp
 *
 * A message listener will handle:
 * - Enable/disable requests
 * - Add/remove listeners for `DAppEvents`
 * - Requests for Sys and Eth providers methods
 */
export const setupConnection = (port: Runtime.Port) => {
  const origin = new URL(port.sender?.url).host;
  const title = port.sender?.tab?.title;

  window.controller.dapp.addDApp(origin, title, port);
  // setupEvents(port);

  // used to prevent multiple popups open
  let pendingWindow = false;
  const isPendingWindow = () => pendingWindow;
  const setPendingWindow = (isPending: boolean) => {
    pendingWindow = isPending;
  };

  /**
   * Handles message request execution
   */
  const messageHandler = async (message: Message) => {
    if (browser.runtime.lastError) {
      throw new Error('Runtime last error');
    }

    switch (message.type) {
      case 'EVENT_REG':
        return registerEvent(message);
      case 'EVENT_DEREG':
        return deregisterEvent(message);
      case 'ENABLE':
        return enable(message, origin, setPendingWindow, isPendingWindow);
      case 'DISABLE':
        return disable(origin, isPendingWindow);
      case 'METHOD_REQUEST':
        return methodRequest(
          message,
          origin,
          setPendingWindow,
          isPendingWindow
        );
      default:
        throw new Error('Unknown message type');
    }
  };

  /**
   * Receives and reply messages
   */
  const onMessage = async (message: Message) => {
    console.log(`[DApp] Message from ${origin}`, message.type, message.data);
    try {
      const response = await messageHandler(message);
      if (response === undefined) return;

      console.log('[DApp] Response', response);
      port.postMessage({ id: message.id, data: response });
    } catch (error: any) {
      console.error(error);

      port.postMessage({ id: message.id, data: { error: error.message } });
    }
  };

  const onDisconnect = () => {
    window.controller.dapp.removeDApp(origin);
    window.controller.dapp.removeListeners(origin);
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
};
