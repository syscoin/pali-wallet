import { ethErrors } from 'source/helpers/errors';
import { browser, Runtime } from 'webextension-polyfill-ts';

import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';

import { methodRequest, enable, isUnlocked } from './requests';
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
      return dapp.removeListener(host, message.data.eventName); //TODO: understand why dapps always can event UNregister
    case 'ENABLE':
      return enable(host, chain, activeNetwork.chainId);
    case 'DISABLE':
      return dapp.disconnect(host);
    case 'METHOD_REQUEST':
      return methodRequest(host, message.data);
    case 'IS_UNLOCKED':
      return isUnlocked();
    default:
      throw cleanErrorStack(ethErrors.rpc.methodNotFound(message));
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
      port.postMessage({ id: message.id, data: { error: error } }); //This was altered for better ethereum compability TODO: check on syscoin contentScript side
    }
  }
};

export const onDisconnect = (port: Runtime.Port) => {
  const { host } = new URL(port.sender.url);
  const { dapp } = window.controller;

  dapp.removeListeners(host);
};
