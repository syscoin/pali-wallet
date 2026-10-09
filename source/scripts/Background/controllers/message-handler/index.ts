import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';
import { getDappOrigin } from 'utils/dappOrigin';

import { getMethodConfig } from './method-registry';
import { createRequestLifetime } from './request-lifetime';
import { methodRequest, enable, isUnlocked } from './requests';

const MESSAGE_TYPE_TO_METHOD: Record<string, string> = {
  ENABLE: 'ENABLE',
  DISABLE: 'DISABLE',
  IS_UNLOCKED: 'IS_UNLOCKED',
};

/** Reply through the originating runtime channel, bound by Chrome to its document. */
export const onMessage = async (
  message: any,
  sender: chrome.runtime.MessageSender
) => {
  const methodConfig =
    message?.type === 'METHOD_REQUEST'
      ? getMethodConfig(message.data?.method)
      : getMethodConfig(MESSAGE_TYPE_TO_METHOD[message?.type]);

  if (!methodConfig) {
    return { error: { message: 'Unknown method', code: -32601 } };
  }

  const host = getDappOrigin(sender?.url || '') || '';
  if (methodConfig.requiresTabId && (!host || sender?.tab?.id === undefined)) {
    return { error: { message: 'Invalid requesting page', code: 4100 } };
  }

  const lifetime = createRequestLifetime(sender);
  try {
    const requestContext = { sender, signal: lifetime.signal };
    switch (message.type) {
      case 'METHOD_REQUEST':
        return await methodRequest(host, message.data, requestContext);
      case 'ENABLE':
        return await enable(
          host,
          store.getState().vault.isBitcoinBased,
          requestContext
        );
      case 'DISABLE':
        return await getController().dapp.disconnect(host);
      case 'IS_UNLOCKED':
        return isUnlocked();
      default:
        throw cleanErrorStack(ethErrors.rpc.methodNotFound());
    }
  } catch (error) {
    return {
      error: {
        message: error.message || 'Internal error',
        code: error.code || -32603,
      },
    };
  } finally {
    lifetime.dispose();
  }
};
