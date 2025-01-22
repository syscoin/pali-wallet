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
  const { host } = new URL(sender.url);

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
