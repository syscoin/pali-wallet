import { ethErrors } from 'helpers/errors';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { getController } from 'scripts/Background';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';

import { methodRequest, enable, isUnlocked } from './requests';
import { Message } from './types';

/**
 * Handles:
 * - Enable/disable requests
 * - Requests for Sys and Eth providers methods
 */
const _messageHandler = async (host: string, message: Message) => {
  if (browser.runtime.lastError) {
    throw new Error('Runtime last error');
  }

  const { activeNetwork, isBitcoinBased } = store.getState().vault;

  const chain = isBitcoinBased ? 'syscoin' : 'ethereum';

  const { dapp } = getController();
  switch (message.type) {
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
  try {
    const response = await _messageHandler(host, message);
    if (response === undefined) return;
    port.postMessage({ id: message.id, data: response });
  } catch (error: any) {
    console.error(error);
    port.postMessage({ id: message.id, data: { error: error } }); //This was altered for better ethereum compatibility TODO: check on syscoin contentScript side
  }
};
