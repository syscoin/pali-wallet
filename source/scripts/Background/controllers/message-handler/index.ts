import { browser, Runtime } from 'webextension-polyfill-ts';

import { log, logError } from 'utils/logger';

import { disable } from './disable';
import { enable } from './enable';
import { initializeEvents, registerEvent, deregisterEvent } from './events';
import { handleRequest } from './requests';
import { Message } from './types';

export const messageHandler = (port: Runtime.Port, masterController: any) => {
  let pendingWindow = false;

  const setPendingWindow = (isPending: boolean): void => {
    pendingWindow = isPending;
  };

  const isPendingWindow = (): boolean => pendingWindow;

  // Set up listeners once, then check origin/method based on registration in state
  initializeEvents(masterController, port);

  const listenerHandler = async (
    message: Message,
    connection: Runtime.Port
  ) => {
    if (browser.runtime.lastError) {
      return Promise.reject(new Error('Runtime Last Error'));
    }

    const url = connection.sender?.url as string;
    const title = connection.sender?.tab?.title as string;
    const origin = url && new URL(url as string).origin;

    // Set current page
    masterController.dapp.pageConnectDApp(origin, title);

    switch (message.type) {
      case 'PALI_EVENT_REG':
        return registerEvent(masterController, message);
      case 'PALI_EVENT_DEREG':
        return deregisterEvent(masterController, message);
      case 'ENABLE_REQUEST':
        return enable(
          port,
          masterController,
          message,
          origin,
          setPendingWindow,
          isPendingWindow
        );
      case 'DISABLE_REQUEST':
        return disable(
          port,
          masterController,
          message,
          origin,
          setPendingWindow,
          isPendingWindow
        );
      case 'CAL_REQUEST':
        return handleRequest(
          port,
          masterController,
          message,
          origin,
          setPendingWindow,
          isPendingWindow
        );
      default:
        return Promise.resolve(null);
    }
  };

  const listener = async (message: Message, connection: Runtime.Port) => {
    try {
      console.log('listener');
      console.log('message', message);

      const response = await listenerHandler(message, connection);
      console.log('response', response);

      if (response) {
        const { id, result } = response;

        port.postMessage({ id, data: result });
      }
    } catch (error: any) {
      logError('messagesHandler.ERROR', error);
      log(JSON.stringify(error, null, 2));

      port.postMessage({ id: error.type, data: { error: error.detail } });
    }
  };

  port.onMessage.addListener(listener);
};
