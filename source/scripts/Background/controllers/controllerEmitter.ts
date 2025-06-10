import { IMasterController } from '.';

type Methods<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? [K]
    : T[K] extends object
    ? [K, ...Methods<T[K]>]
    : never;
}[keyof T];

// Check if the runtime is available and not invalidated
const isRuntimeAvailable = (): boolean => {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
};

export function controllerEmitter<
  T extends IMasterController,
  P extends Methods<T>
>(methods: P, params?: any[], importMethod = false) {
  return new Promise((resolve, reject) => {
    // Check if runtime is available before attempting to send message
    if (!isRuntimeAvailable()) {
      return reject(
        new Error('Extension context invalidated. Please reload the extension.')
      );
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: 'CONTROLLER_ACTION',
          data: {
            methods,
            params: params || [],
            importMethod,
          },
        },
        (response) => {
          // Check for runtime errors
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError;
            console.error('Runtime error in controllerEmitter:', error);

            // Provide more specific error messages for common issues
            if (error.message?.includes('Receiving end does not exist')) {
              return reject(
                new Error(
                  'Could not establish connection. Receiving end does not exist.'
                )
              );
            } else if (
              error.message?.includes('Extension context invalidated')
            ) {
              return reject(
                new Error(
                  'Extension context invalidated. Please reload the extension.'
                )
              );
            }

            return reject(error);
          }

          // Check for application-level errors
          if (response && response.error) {
            // If it's a structured error from syscoinjs-lib, pass it through as-is
            if (response.error === true && response.code) {
              return reject(response);
            }
            // Also check if the entire response is the error object
            if (response.code && typeof response.error === 'boolean') {
              return reject(response);
            }
            // For simple error messages, wrap in Error object
            return reject(new Error(response.error));
          }

          // Also check if response itself is a structured error
          if (response && response.code && response.error === true) {
            return reject(response);
          }

          resolve(response);
        }
      );
    } catch (error) {
      console.error('Error sending message in controllerEmitter:', error);
      reject(error);
    }
  });
}
