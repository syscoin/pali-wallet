import { IMasterController } from 'scripts/Background/controllers';

export const handleMasterControllerResponses = (
  MasterControllerInstance: IMasterController
) => {
  chrome.runtime.onMessage.addListener((message: any, _, sendResponse) => {
    const { type, data } = message;

    try {
      const isEventValid = type === 'CONTROLLER_ACTION';

      if (!isEventValid) {
        return false;
      }

      const { methods, params, importMethod } = data;

      let targetMethod = MasterControllerInstance;

      for (const method of methods) {
        if (targetMethod && method in targetMethod) {
          targetMethod = targetMethod[method];
        } else {
          throw new Error('Method not found');
        }
      }

      if (typeof targetMethod === 'function' || importMethod) {
        new Promise(async (resolve, reject) => {
          try {
            const response = importMethod
              ? targetMethod
              : await (targetMethod as any)(...params);
            resolve(response);
          } catch (error) {
            reject(error);
          }
        })
          .then(sendResponse)
          .catch((error) => {
            console.error('Error executing method:', error);
            sendResponse({ error: error.message, success: false });
            return false;
          });

        return true;
      } else {
        throw new Error('Method is not a function');
      }
    } catch (error) {
      console.error('Error in message handler:', error);
      sendResponse({ error: error.message, success: false });
      return false;
    }
  });
};
