import { browser, Runtime } from 'webextension-polyfill-ts';

import { enable } from './enable';
import { methodRequest } from './requests';
import { Message } from './types';

/**
 * Handles:
 * - Enable/disable requests
 * - Add/remove listeners for `DAppEvents`
 * - Requests for Sys and Eth providers methods
 */
const _messageHandler = async (origin: string, message: Message) => {
  if (browser.runtime.lastError) {
    throw new Error('Runtime last error');
  }

  const { dapp } = window.controller;
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
export const onMessage = async (message: Message, port: Runtime.Port) => {
  const origin = new URL(port.sender.url).host;
  console.log(`[DApp] Message from ${origin}`, message.type, message.data);
  try {
    const response = await _messageHandler(origin, message);
    if (response === undefined) return;

    console.log('[DApp] Response', response);
    port.postMessage({ id: message.id, data: response });
  } catch (error: any) {
    console.error(error);

    port.postMessage({ id: message.id, data: { error: error.message } });
  }
};

export const onDisconnect = () => {
  window.controller.dapp.removeDApp(origin);
  window.controller.dapp.removeListeners(origin);
};
