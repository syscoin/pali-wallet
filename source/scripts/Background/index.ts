import 'emoji-log';
import { handleFiatPrice } from 'scripts/Background/handlers/handleFiatPrice';
import { handleListeners } from 'scripts/Background/handlers/handleListeners';
import { handleMasterControllerInstance } from 'scripts/Background/handlers/handleMasterControllerInstance';
import { handleMasterControllerResponses } from 'scripts/Background/handlers/handleMasterControllerResponses';
import { handlePendingTransactionsPolling } from 'scripts/Background/handlers/handlePendingTransactionsPolling';
import { handleStartPolling } from 'scripts/Background/handlers/handleStartPolling';
import { handleObserveStateChanges } from 'scripts/Background/handlers/handleStateChanges';
// Removed handleRehydrateStore - rehydrate messages are for frontend only

import { IMasterController } from './controllers';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

let MasterControllerInstance = {} as IMasterController;

handleMasterControllerInstance().then((controller) => {
  MasterControllerInstance = controller;
  handleMasterControllerResponses(controller);
  handleListeners(controller);
  handleObserveStateChanges();
  handleStartPolling();
  handlePendingTransactionsPolling();
  handleFiatPrice();
  // Removed handleRehydrateStore - rehydrate messages are handled by frontend components
});

export const getController = () => MasterControllerInstance;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepAlive') {
    port.onMessage.addListener((msg) => {
      if (msg.ping) port.postMessage({ pong: true });
    });
  }
});
