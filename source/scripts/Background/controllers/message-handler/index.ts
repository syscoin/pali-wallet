import { browser, Runtime } from 'webextension-polyfill-ts';

import { enable } from './enable';
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
  const { dapp } = window.controller;

  const origin = new URL(port.sender?.url).host;
  const title = port.sender?.tab?.title;

  dapp.addDApp(origin, title, port);
  // setupEvents(port);

  /**
   * Handles message request execution
   */
  const messageHandler = async (message: Message) => {
    if (browser.runtime.lastError) {
      throw new Error('Runtime last error');
    }

    switch (message.type) {
      case 'EVENT_REG':
        return dapp.addListener(origin, message.data.eventName);
      case 'EVENT_DEREG':
        return dapp.removeListener(origin, message.data.eventName);
      case 'ENABLE':
        return enable(origin, message.data.network);
      case 'DISABLE':
        return dapp.disconnect(origin);
      case 'METHOD_REQUEST':
        return methodRequest(origin, message.data);
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
