import { IMasterController } from 'scripts/Background/controllers';

export const handleMasterControllerResponses = (
  MasterControllerInstance: IMasterController
) => {
  chrome.runtime.onMessage.addListener((message: any, _, sendResponse) => {
    const { type, data } = message;

    const isEventValid = type === 'CONTROLLER_ACTION';

    if (isEventValid) {
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
        new Promise(async (resolve) => {
          const response = importMethod
            ? targetMethod
            : await (targetMethod as any)(...params);

          resolve(response);
        }).then(sendResponse);
      } else {
        throw new Error('Method is not a function');
      }
    }

    return isEventValid;
  });
};
