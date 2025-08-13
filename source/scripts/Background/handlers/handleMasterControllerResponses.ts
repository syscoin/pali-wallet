import { IMasterController } from 'scripts/Background/controllers';
import { extractErrorMessage } from 'utils/index';

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

      const { methods, params } = data;

      let targetMethod = MasterControllerInstance;

      for (const method of methods) {
        if (targetMethod && method in targetMethod) {
          targetMethod = targetMethod[method];
        } else {
          throw new Error('Method not found');
        }
      }

      if (typeof targetMethod === 'function') {
        Promise.resolve()
          .then(async () => {
            // Always execute the method; never attempt to send functions over messaging
            const response = await (targetMethod as any)(...params);
            return response;
          })
          .then(sendResponse)
          .catch((error) => {
            console.error('Error executing method:', error);
            // Preserve structured errors from syscoinjs-lib
            if (
              error &&
              typeof error === 'object' &&
              error.code &&
              error.error === true
            ) {
              // Pass through structured errors as-is
              sendResponse(error);
            } else {
              // For regular errors, wrap in error object
              sendResponse({
                error: extractErrorMessage(error, 'Unknown error'),
                success: false,
              });
            }
            return false;
          });

        return true;
      } else {
        throw new Error('Method is not a function');
      }
    } catch (error) {
      console.error('Error in message handler:', error);
      // Preserve structured errors from syscoinjs-lib
      if (
        error &&
        typeof error === 'object' &&
        error.code &&
        error.error === true
      ) {
        // Pass through structured errors as-is
        sendResponse(error);
      } else {
        // For regular errors, wrap in error object
        sendResponse({
          error: extractErrorMessage(error, 'Unknown error'),
          success: false,
        });
      }
      return false;
    }
  });
};
