import { browser, Runtime } from 'webextension-polyfill-ts';

import { Message } from './types';
import { initializeEvents, registerEvent, deregisterEvent } from './events';
import { enable } from './enable';
import { handleRequest } from './requests';

export const messagesHandler = (port: Runtime.Port, masterController: any) => {
  let pendingWindow = false;

  console.log('message handler enabled');

  const setPendingWindow = (isPending: boolean): void => {
    pendingWindow = isPending;
  };

  const isPendingWindow = (): boolean => pendingWindow;

  console.log('initializing events');
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
      console.log('called listener enabling listener handler');
      const response = await listenerHandler(message, connection);
      console.log('listener handler enabled', response);

      if (response) {
        console.log('response listener found');
        const { id, result } = response;
        port.postMessage({ id, data: result });
      }
    } catch (e: any) {
      console.log('messagesHandler.ERROR', e.type, e.message, e.detail);
      console.log(JSON.stringify(e, null, 2));

      port.postMessage({ id: e.type, data: { error: e.detail } });
    }
  };

  port.onMessage.addListener(listener);
};
