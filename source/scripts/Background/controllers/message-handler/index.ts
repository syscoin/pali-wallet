import { browser, Runtime } from 'webextension-polyfill-ts';

import store from 'state/store';

import { methodRequest, enable } from './requests';
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

  const { activeNetwork, isBitcoinBased } = store.getState().vault;

  const chain = isBitcoinBased ? 'syscoin' : 'ethereum';

  const { dapp } = window.controller;

  switch (message.type) {
    case 'EVENT_REG':
      return dapp.addListener(host, message.data.eventName);
    case 'EVENT_DEREG':
      return dapp.removeListener(host, message.data.eventName);
    case 'ENABLE':
      return enable(host, chain, activeNetwork.chainId);
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
  if (message.type === 'CHAIN_NET_REQUEST') {
    const { activeNetwork } = store.getState().vault;
    const networkVersion = String(activeNetwork.chainId);
    const chainId = '0x' + activeNetwork.chainId.toString(16);
    const tabs = await browser.tabs.query({
      active: true,
      windowType: 'normal',
    });

    for (const tab of tabs) {
      browser.tabs.sendMessage(Number(tab.id), {
        type: 'CHAIN_CHANGED',
        data: { networkVersion, chainId },
      });
    }
  } else {
    try {
      const response = await _messageHandler(host, message);
      if (response === undefined) return;
      port.postMessage({ id: message.id, data: response });
    } catch (error: any) {
      console.error(error);

      port.postMessage({ id: message.id, data: { error: error.message } });
    }
  }
};

export const onDisconnect = (port: Runtime.Port) => {
  const { host } = new URL(port.sender.url);
  const { dapp } = window.controller;

  dapp.removeListeners(host);
};
