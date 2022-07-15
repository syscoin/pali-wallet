import { browser, Runtime } from 'webextension-polyfill-ts';

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
  initializeEvents(port);

  const listenerHandler = async (
    message: Message,
    connection: Runtime.Port
  ) => {
    if (browser.runtime.lastError) {
      return Promise.reject(new Error('Runtime Last Error'));
    }

    const origin = new URL(connection.sender?.url).host;
    const title = connection.sender?.tab?.title;

    // Set current page
    masterController.dapp.pageConnectDApp(origin, title);

    switch (message.type) {
      case 'PALI_EVENT_REG':
        return registerEvent(message);
      case 'PALI_EVENT_DEREG':
        return deregisterEvent(message);
      case 'ENABLE_REQUEST':
        return enable(port, message, origin, setPendingWindow, isPendingWindow);
      case 'DISABLE_REQUEST':
        return disable(
          port,
          message,
          origin,
          setPendingWindow,
          isPendingWindow
        );
      case 'METHOD_REQUEST':
        return handleRequest(
          port,
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
      console.error(error);

      port.postMessage({ id: message.id, data: { error: error.message } });
    }
  };

  port.onMessage.addListener(listener);
};
