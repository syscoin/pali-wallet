import { browser, Runtime } from 'webextension-polyfill-ts';

import { popupPromise } from './popup-promise';
import { methodRequest } from './requests';
import { Message } from './types';

/**
 * Handles:
 * - Enable/disable requests
 * - Add/remove listeners for `DAppEvents`
 * - Requests for Sys and Eth providers methods
 */
const _messageHandler = async (host: string, message: Message) => {
  if (browser.runtime.lastError) {
    throw new Error('Runtime last error');
  }

  const { dapp } = window.controller;
  switch (message.type) {
    case 'EVENT_REG':
      return dapp.addListener(host, message.data.eventName);
    case 'EVENT_DEREG':
      return dapp.removeListener(host, message.data.eventName);
    case 'ENABLE':
      if (dapp.isConnected(host)) return;
      return popupPromise({
        host,
        route: 'connect-wallet',
        eventName: 'connect',
        data: { network: message.data.network },
      });
    case 'DISABLE':
      return dapp.disconnect(host);
    case 'METHOD_REQUEST':
      return methodRequest(host, message.data);
    default:
      throw new Error('Unknown message type');
  }
};

/**
 * Receives and reply messages
 */
export const onMessage = async (message: Message, port: Runtime.Port) => {
  const { host } = new URL(port.sender.url);
  console.log(`[DApp] Message from ${host}`, message.type, message.data);
  try {
    const response = await _messageHandler(host, message);
    if (response === undefined) return;

    console.log('[DApp] Response', response);
    port.postMessage({ id: message.id, data: response });
  } catch (error: any) {
    console.error(error);

    port.postMessage({ id: message.id, data: { error: error.message } });
  }
};

export const onDisconnect = (port: Runtime.Port) => {
  const { host } = new URL(port.sender.url);
  window.controller.dapp.removeDApp(host);
  window.controller.dapp.removeListeners(host);
};
