import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';
import { getNetworkChain } from 'utils/network';

import { methodRequest, enable, isUnlocked } from './requests';
import { Message } from './types';

/**
 * Handles:
 * - Enable/disable requests
 * - Requests for Sys and Eth providers methods
 */
const _messageHandler = (host: string, message: Message) => {
  if (chrome.runtime.lastError) {
    throw new Error('Runtime last error');
  }

  const { activeNetwork, isBitcoinBased } = store.getState().vault;

  const chain = getNetworkChain(isBitcoinBased);

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
export const onMessage = async (
  message: any,
  sender: chrome.runtime.MessageSender
) => {
  // Validate sender URL before attempting to construct URL object
  if (!sender?.url) {
    console.warn('[Background] Message received with no sender URL:', sender);
    return;
  }

  let host: string;
  try {
    const url = new URL(sender.url);
    host = url.host;
  } catch (error) {
    console.warn('[Background] Invalid URL from sender:', sender.url, error);
    return;
  }

  if (!sender?.tab?.id) return;

  try {
    const response = await _messageHandler(host, message);
    if (response === undefined) return;
    await chrome.tabs.sendMessage(sender.tab.id, {
      id: message.id,
      data: response,
    });
  } catch (error: any) {
    await chrome.tabs.sendMessage(sender.tab.id, {
      id: message.id,
      data: { error },
    });
  }
};
