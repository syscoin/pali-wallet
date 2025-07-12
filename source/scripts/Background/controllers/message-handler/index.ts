import { ethErrors } from 'helpers/errors';

import { getController, getIsReady } from 'scripts/Background';
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
    case 'ping':
      return { ready: getIsReady() };
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
  // Helper function to send error response
  const sendErrorResponse = (errorMessage: string) => {
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        id: message.id,
        data: {
          error: {
            message: errorMessage,
            code: -32603,
          },
        },
      });
    }
  };

  // 🔥 FIX: Always send response, even for validation failures
  // Validate sender URL before attempting to construct URL object
  if (!sender?.url) {
    console.warn('[Background] Message received with no sender URL:', sender);
    sendErrorResponse('Invalid sender URL');
    return;
  }

  let host: string;
  try {
    const url = new URL(sender.url);
    host = url.host;
  } catch (error) {
    console.warn('[Background] Invalid URL from sender:', sender.url, error);
    sendErrorResponse('Invalid sender URL format');
    return;
  }

  if (!sender?.tab?.id) {
    console.warn('[Background] Message received with no tab ID:', sender);
    sendErrorResponse('Invalid sender tab');
    return;
  }

  try {
    const response = await _messageHandler(host, message);
    // 🔥 FIX: Send response even if undefined - content script expects a response
    await chrome.tabs.sendMessage(sender.tab.id, {
      id: message.id,
      data: response !== undefined ? response : null,
    });
  } catch (error: any) {
    // 🔥 FIX: Extract error message from nested structure
    let errorMessage = 'Unknown error';
    if (error?.data?.message) {
      errorMessage = error.data.message;
    } else if (error?.error?.message) {
      errorMessage = error.error.message;
    } else if (error?.message) {
      errorMessage = error.message;
    }

    await chrome.tabs.sendMessage(sender.tab.id, {
      id: message.id,
      data: {
        error: {
          message: errorMessage,
          code: -32603,
        },
      },
    });
  }
};
