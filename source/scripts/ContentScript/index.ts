import { EventEmitter } from 'events';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';

const emitter = new EventEmitter();

// Simple error logging rate limiting
let lastConnectionAttempt = 0;
const CONNECTION_CHECK_INTERVAL = 5000; // 5 seconds

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [100, 500, 1000]; // Progressive delays in ms

/**
 * Send message to background script with retry logic and error handling
 */
const sendToBackground = async (
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

          // Check if this is a connection error
          const isConnectionError =
            errorMessage.includes('message port closed') ||
            errorMessage.includes('Receiving end does not exist') ||
            errorMessage.includes('Extension context invalidated');

          if (isConnectionError && retryCount < MAX_RETRIES) {
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
                message: `Pali: ${
                  isConnectionError
                    ? 'Background script temporarily unavailable'
                    : 'Message processing failed'
                }.`,
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
            message: 'Pali: Message processing failed.',
            code: -32603,
          },
        });
      }
      resolve();
    }
  });

const handleEthInjection = (message: any) => {
  const isInjected = message?.isInjected;

  if (typeof isInjected !== 'undefined') {
    if (isInjected) {
      injectScriptFile('js/inpage.bundle.js', 'inpage');
    } else {
      injectScriptFile('js/handleWindowProperties.bundle.js', 'removeProperty');
    }
    return;
  }
};

// Moved ethereum injection check after pali injection

// Add listener for pali events
const checkForPaliRegisterEvent = (id: any) => {
  emitter.once(id, (result) => {
    if (typeof id === 'string') {
      if (String(id).includes('isUnlocked')) {
        window.dispatchEvent(new CustomEvent(id, { detail: result }));
      }
    }
    if (result) {
      window.dispatchEvent(
        new CustomEvent(id, { detail: JSON.stringify(result) })
      );
    } else {
      window.dispatchEvent(new CustomEvent(id, { detail: null }));
    }
  });
};

/**
 * Listens to local messages and sends them to pali
 */
const start = () => {
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      if (!event.data) return;

      const { id, type, data } = event.data;

      if (!id || !type) return;

      // listen for the response
      checkForPaliRegisterEvent(id);

      sendToBackground(
        {
          id,
          type,
          data,
        },
        (response) => {
          // Handle response or error from background
          if (response && response.error) {
            // Emit error back to the page
            emitter.emit(id, response);
          }
          // Normal responses are handled by backgroundMessageListener
        }
      );
    },
    false
  );
};

const startEventEmitter = () => {
  for (const ev in PaliEvents) {
    emitter.on(PaliEvents[ev], (result) => {
      window.dispatchEvent(
        new CustomEvent('notification', { detail: JSON.stringify(result) })
      );
    });
  }

  for (const ev in PaliSyscoinEvents) {
    emitter.on(PaliSyscoinEvents[ev], (result) => {
      window.dispatchEvent(
        new CustomEvent('sys_notification', { detail: JSON.stringify(result) })
      );
    });
  }
};

const doctypeCheck = () => {
  const { doctype } = window.document;
  if (doctype) {
    return doctype.name === 'html';
  }
  return true;
};

const suffixCheck = () => {
  const prohibitedTypes = [/\.xml$/u, /\.pdf$/u];
  const currentUrl = window.location.pathname;

  for (let i = 0; i < prohibitedTypes.length; i++) {
    if (prohibitedTypes[i].test(currentUrl)) {
      return false;
    }
  }
  return true;
};

const documentElementCheck = () => {
  const documentElement = document.documentElement.nodeName;
  if (documentElement) {
    return documentElement.toLowerCase() === 'html';
  }
  return true;
};

const blockedDomainCheck = () => {
  const blockedDomains = ['dropbox.com', 'app.clickup.com'];
  const currentUrl = window.location.href;
  let currentRegex;

  for (let i = 0; i < blockedDomains.length; i++) {
    const blockedDomain = blockedDomains[i].replace('.', '\\.');
    currentRegex = new RegExp(
      `(?:https?:\\/\\/)(?:(?!${blockedDomain}).)*$`,
      'u'
    );
    if (!currentRegex.test(currentUrl)) {
      return true;
    }
  }
  return false;
};

export const shouldInjectProvider = () =>
  doctypeCheck() &&
  suffixCheck() &&
  documentElementCheck() &&
  !blockedDomainCheck();

export const injectScriptFile = (file: string, id: string) => {
  try {
    const inpage = document.getElementById('inpage');
    const removeProperty = document.getElementById('removeProperty');
    const pali = document.getElementById('pali-provider-script');

    switch (id) {
      case 'removeProperty':
        // remove inpage script for not inject the same thing many times
        if (inpage) inpage.remove();
        if (removeProperty) removeProperty.remove();
        break;
      case 'inpage':
        // Skip injection if inpage script already exists (don't remove and re-inject)
        if (inpage) {
          console.log(
            '[Content Script] Inpage script already injected, skipping'
          );
          return;
        }
        // remove removeEth script for not inject the same thing many times
        if (removeProperty) removeProperty.remove();
        break;
      case 'pali':
        // remove existing pali script
        if (pali) pali.remove();
        // Also remove any old pali script with the old ID
        const oldPali = document.getElementById('pali');
        if (oldPali) oldPali.remove();
        break;
      default:
        if (!id) return;
    }

    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.setAttribute('async', 'false');
    scriptTag.setAttribute('id', id === 'pali' ? 'pali-provider-script' : id);
    scriptTag.src = chrome.runtime.getURL(file);

    container.insertBefore(scriptTag, container.children[0]);
    scriptTag.onload = () => scriptTag.remove();
  } catch (error) {
    console.error('Provider injection failed.', error);
  }
};

// listen for messages from background
const backgroundMessageListener = (message) => {
  const { id, data } = message;

  if (data?.params?.type) {
    switch (data.params.type) {
      case 'pali_removeProperty':
        injectScriptFile(
          'js/handleWindowProperties.bundle.js',
          'removeProperty'
        );
        break;
      case 'pali_addProperty':
        injectScriptFile('js/inpage.bundle.js', 'inpage');
        break;
    }
  }

  if (id) {
    emitter.emit(id, data);
  }
};

chrome.runtime.onMessage.addListener(backgroundMessageListener);

// Cleanup on page unload (content script lifecycle)
window.addEventListener('beforeunload', () => {
  chrome.runtime.onMessage.removeListener(backgroundMessageListener);
});

// Only inject providers in the top frame to avoid duplicates from iframes
if (window !== window.top) {
  console.log(
    '[Content Script] Running in iframe, skipping provider injection'
  );
} else {
  // Guard against multiple content script executions in the same frame
  if ((window as any).__paliContentScriptInitialized) {
    console.log(
      '[Content Script] Already initialized, skipping duplicate execution'
    );
  } else {
    (window as any).__paliContentScriptInitialized = true;

    // Initial setup - inject providers immediately at document_start
    if (shouldInjectProvider()) {
      // Always inject pali provider first
      injectScriptFile('js/pali.bundle.js', 'pali');

      // Check if ethereum should be injected immediately (no delay)
      sendToBackground(
        { action: 'isInjected', type: 'pw-msg-background' },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              'Error checking ethereum injection status:',
              chrome.runtime.lastError
            );
            return;
          }
          handleEthInjection(response);
        }
      );
    }
  }
}

start();
startEventEmitter();
