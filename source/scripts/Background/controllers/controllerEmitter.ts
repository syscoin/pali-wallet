import type { IMasterController } from '.';

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

export async function controllerEmitter<
  T extends IMasterController,
  P extends Methods<T>
>(methods: P, params?: any[], timeout = 10000) {
  // Add retry logic for service worker lifecycle issues
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 500; // Start with 500ms to reduce spam

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        // Check if runtime is available before attempting to send message
        if (!isRuntimeAvailable()) {
          return reject(
            new Error(
              'Extension context invalidated. Please reload the extension.'
            )
          );
        }

        // Use a timeout to detect unresponsive service workers
        const timeoutId = setTimeout(() => {
          reject(new Error('Network request timed out'));
        }, timeout);

        try {
          chrome.runtime.sendMessage(
            {
              type: 'CONTROLLER_ACTION',
              data: {
                methods,
                params: params || [],
              },
            },
            (response) => {
              clearTimeout(timeoutId);

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
                // For simple error messages, wrap in Error object
                return reject(new Error(response.error));
              }

              resolve(response);
            }
          );
        } catch (error) {
          clearTimeout(timeoutId);
          console.error('Error sending message in controllerEmitter:', error);
          reject(error);
        }
      });
    } catch (error: any) {
      // If this is a connection error and we have retries left, wait and retry
      // Don't retry on network timeouts - we already waited 10 seconds
      if (
        attempt < MAX_RETRIES - 1 &&
        !error.message?.includes('Network request timed out') &&
        (error.message?.includes('Could not establish connection') ||
          error.message?.includes('Receiving end does not exist') ||
          error.message?.includes('Extension context invalidated'))
      ) {
        const delay = RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
        console.log(
          `[controllerEmitter] Retrying after ${delay}ms (attempt ${
            attempt + 1
          }/${MAX_RETRIES}) for method: ${methods.join('.')}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For non-connection errors or if we're out of retries, throw the error
      throw error;
    }
  }

  // If we get here, all retries failed
  throw new Error(
    'Failed to connect to service worker after multiple attempts'
  );
}

// Removed unused default export that was causing retry loops
// All communication should use the named export controllerEmitter with 'CONTROLLER_ACTION' type
