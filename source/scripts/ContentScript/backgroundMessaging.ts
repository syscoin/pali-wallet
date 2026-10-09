/** Retry only when Chrome confirms there was no receiving listener. */
export const isUndeliveredBackgroundRequest = (errorMessage: string): boolean =>
  errorMessage.includes('Receiving end does not exist') &&
  !/message (?:port|channel) closed|Extension context invalidated/i.test(
    errorMessage
  );

export const getBackgroundFailureMessage = (errorMessage: string): string => {
  if (isUndeliveredBackgroundRequest(errorMessage)) {
    return 'Pali: Background script temporarily unavailable. Please try again.';
  }
  if (
    /message (?:port|channel) closed|channel closed|Extension context invalidated/i.test(
      errorMessage
    )
  ) {
    return 'Pali: Connection interrupted. Reload this page and check wallet activity before retrying; the request may already have completed.';
  }
  return 'Pali: Message processing failed.';
};

// Simple error logging rate limiting
let lastConnectionAttempt = 0;
const CONNECTION_CHECK_INTERVAL = 5000; // 5 seconds

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [100, 500, 1000]; // Progressive delays in ms

/**
 * Send message to background script with retry logic and error handling
 */
export const sendToBackground = async (
  message: any,
  handleResponse?: (response: any) => void,
  retryCount = 0
): Promise<void> =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Capture error immediately to avoid race conditions
        const currentError = chrome.runtime.lastError
          ? { ...chrome.runtime.lastError }
          : null;

        if (currentError) {
          const errorMessage = currentError.message || '';

          // Only a missing receiver proves that the request was undelivered.
          // A closed channel may have lost the response after a signature/send.
          const canRetry = isUndeliveredBackgroundRequest(errorMessage);

          if (canRetry && retryCount < MAX_RETRIES) {
            // Service worker might be starting up, retry with delay
            const delay = RETRY_DELAYS[retryCount] || 1000;
            console.debug(
              `[Content Script] Background not ready, retrying in ${delay}ms (attempt ${
                retryCount + 1
              }/${MAX_RETRIES})`
            );

            setTimeout(() => {
              sendToBackground(message, handleResponse, retryCount + 1)
                .then(resolve)
                .catch(() => resolve()); // Prevent unhandled rejection
            }, delay);
            return;
          }

          // Rate-limit error logging to reduce spam
          if (Date.now() - lastConnectionAttempt > CONNECTION_CHECK_INTERVAL) {
            console.error('Content script connection error:', currentError);
            lastConnectionAttempt = Date.now();
          }

          // Call response handler with error
          if (handleResponse) {
            handleResponse({
              error: {
                message: getBackgroundFailureMessage(errorMessage),
                code: -32603,
              },
            });
          }
          resolve();
          return;
        }

        // Success - call response handler
        if (handleResponse) {
          handleResponse(response);
        }
        resolve();
      });
    } catch (error) {
      // Handle any synchronous errors
      console.error('[Content Script] Error sending message:', error);
      if (handleResponse) {
        handleResponse({
          error: {
            message: getBackgroundFailureMessage(
              error instanceof Error ? error.message : String(error)
            ),
            code: -32603,
          },
        });
      }
      resolve();
    }
  });
