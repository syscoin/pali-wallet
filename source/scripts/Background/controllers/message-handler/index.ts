import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';

import { getMethodConfig } from './method-registry';
import { methodRequest, enable, isUnlocked } from './requests';
import { Message, IEnhancedRequestContext, MethodHandlerType } from './types';

/**
 * Maps special message types to their method names for registry lookup
 */
const MESSAGE_TYPE_TO_METHOD: Record<string, string> = {
  ENABLE: 'ENABLE',
  DISABLE: 'DISABLE',
  IS_UNLOCKED: 'IS_UNLOCKED',
};

/**
 * Handles special message types that don't go through the method registry
 */
const handleSpecialMessage = (host: string, message: Message) => {
  const { dapp } = getController();

  switch (message.type) {
    case 'METHOD_REQUEST':
      return methodRequest(host, message.data);
    case 'ENABLE':
      const { isBitcoinBased } = store.getState().vault;
      return enable(host, isBitcoinBased);
    case 'DISABLE':
      return dapp.disconnect(host);
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
  // Skip internal messages - they're handled by other listeners
  // These messages come from the popup/extension itself and don't have tab IDs
  // CONTROLLER_ACTION is handled by handleMasterControllerResponses
  // Other internal messages are handled by handleListeners
  if (
    message?.type === 'CONTROLLER_ACTION' ||
    message?.type === 'CONTROLLER_STATE_CHANGE' ||
    message?.type === 'logout' ||
    message?.type === 'lock_wallet' ||
    message?.type === 'changeNetwork' ||
    message?.type === 'startPolling' ||
    message?.type === 'pw-msg-background'
  ) {
    return false; // Let other listeners handle these
  }

  // Get method config from registry
  let methodConfig = null;

  if (message.type === 'METHOD_REQUEST' && message.data?.method) {
    methodConfig = getMethodConfig(message.data.method);
  } else if (MESSAGE_TYPE_TO_METHOD[message.type]) {
    methodConfig = getMethodConfig(MESSAGE_TYPE_TO_METHOD[message.type]);
  }

  // If no method config found, treat as unknown method
  if (!methodConfig && message.type !== 'METHOD_REQUEST') {
    console.warn('[Background] Unknown message type:', message.type);
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        id: message.id,
        data: {
          error: {
            message: 'Unknown message type',
            code: -32601,
          },
        },
      });
    }
    return;
  }

  // Build enhanced context from the message
  const context: IEnhancedRequestContext = {
    originalRequest: {
      type: message.type,
      method: message.data?.method || message.type,
      params: message.data?.params,
      host: '',
      sender,
      messageId: message.id,
      network: message.data?.network,
    },
    methodConfig: methodConfig || {
      name: message.type,
      handlerType: MethodHandlerType.Internal,
      requiresTabId: true,
      requiresAuth: false,
      requiresConnection: false,
      allowHardwareWallet: true,
      networkRequirement: 'none' as any,
      hasPopup: false,
    },
    prefix: undefined,
    methodName: undefined,
  };

  // Check if this method requires a tab ID using registry
  const requiresTabId = methodConfig?.requiresTabId ?? true;

  // Helper function to send error response
  const sendErrorResponse = (errorMessage: string, code = -32603) => {
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        id: message.id,
        data: {
          error: {
            message: errorMessage,
            code: code,
          },
        },
      });
    }
  };

  // Get host - for messages from popup, use empty string
  let host = '';

  if (requiresTabId) {
    // For dApp messages, we need proper validation
    if (!sender?.url) {
      console.warn('[Background] Message received with no sender URL:', sender);
      sendErrorResponse('Invalid sender URL');
      return;
    }

    try {
      const url = new URL(sender.url);
      host = url.host;
    } catch (error) {
      console.warn('[Background] Invalid URL from sender:', sender.url, error);
      sendErrorResponse('Invalid sender URL format');
      return;
    }

    if (!sender?.tab?.id) {
      console.warn(
        '[Background] Message received with no tab ID:',
        sender,
        ' message:',
        message
      );
      sendErrorResponse('Invalid sender tab');
      return;
    }
  } else if (sender?.url) {
    // For tab-id-optional messages, try to get host if URL is available
    try {
      const url = new URL(sender.url);
      host = url.host;
    } catch (error) {
      // Ignore - use empty host
    }
  }

  // Update context with host
  context.originalRequest.host = host;

  try {
    const response = await handleSpecialMessage(host, message);

    // Send response based on whether we have a tab ID
    if (sender?.tab?.id) {
      // Send via tabs API for content scripts
      try {
        await chrome.tabs.sendMessage(sender.tab.id, {
          id: message.id,
          data: response !== undefined ? response : null,
        });
      } catch (tabError) {
        console.error(
          '[Background] Failed to send response to tab:',
          sender.tab.id,
          'error:',
          tabError
        );
        // Tab might have been closed or become invalid
        // This could happen if popup window lifecycle affects tab context
      }
    } else {
      // Direct response for popup/extension messages
      return response;
    }
  } catch (error) {
    // Send error response
    const errorResponse = {
      error: {
        message: error.message || 'Internal error',
        code: error.code || -32603,
      },
    };

    if (sender?.tab?.id) {
      try {
        await chrome.tabs.sendMessage(sender.tab.id, {
          id: message.id,
          data: errorResponse,
        });
      } catch (tabError) {
        console.error(
          '[Background] Failed to send error response to tab:',
          tabError
        );
      }
    } else {
      return errorResponse;
    }
  }
};
