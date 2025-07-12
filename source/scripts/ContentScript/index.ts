import { EventEmitter } from 'events';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';

const emitter = new EventEmitter();

// Connection management
let isBackgroundConnected = true;
let lastConnectionAttempt = 0;
const reconnectTimeout: NodeJS.Timeout | null = null;
const CONNECTION_RETRY_DELAY = 1000; // 1 second
const CONNECTION_CHECK_INTERVAL = 5000; // 5 seconds

// Message retry system
interface PendingMessage {
  handleResponse?: (response: any) => void;
  message: any;
  retryCount: number;
  timestamp: number;
}

const pendingMessages = new Map<string, PendingMessage>();
const MAX_RETRIES = 3;
const RETRY_DELAY = 500; // 500ms

/**
 * Wake up the service worker by sending a ping message
 */
const wakeUpServiceWorker = (): Promise<boolean> =>
  new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 10000); // 10 second timeout

    chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
      clearTimeout(timeout);
      // Capture error immediately to avoid race conditions
      const currentError = chrome.runtime.lastError
        ? { ...chrome.runtime.lastError }
        : null;

      if (currentError) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });

/**
 * Check if background script is responsive
 */
const checkBackgroundConnection = async (): Promise<boolean> => {
  try {
    const isAwake = await wakeUpServiceWorker();
    if (isAwake !== isBackgroundConnected) {
      isBackgroundConnected = isAwake;
      console.log(
        `[ContentScript] Background connection: ${
          isAwake ? 'restored' : 'lost'
        }`
      );
    }
    return isAwake;
  } catch (error) {
    isBackgroundConnected = false;
    return false;
  }
};

/**
 * Retry a failed message with improved error detection
 */
const retryMessage = (messageId: string, delay: number = RETRY_DELAY) => {
  setTimeout(async () => {
    const pending = pendingMessages.get(messageId);
    if (!pending) return;

    // Only retry if we've confirmed the service worker was actually asleep
    const isConnected = await checkBackgroundConnection();

    if (!isConnected && pending.retryCount >= MAX_RETRIES) {
      // Give up after max retries
      pendingMessages.delete(messageId);
      if (pending.handleResponse) {
        pending.handleResponse({
          error: {
            message:
              'Pali: Background script unavailable. Extension may need to be reloaded.',
            code: -32603,
          },
        });
      }
      return;
    }

    if (isConnected) {
      // Service worker is awake, retry the message
      sendToBackgroundInternal(
        messageId,
        pending.message,
        pending.handleResponse
      );
    } else {
      // Service worker still not responsive, retry with exponential backoff
      pending.retryCount++;
      const nextDelay = Math.min(delay * 2, 5000); // Max 5 seconds
      retryMessage(messageId, nextDelay);
    }
  }, delay);
};

/**
 * Internal message sending with improved error handling
 */
const sendToBackgroundInternal = (
  messageId: string,
  message: any,
  handleResponse?: (response: any) => void
) => {
  chrome.runtime.sendMessage(message, (response) => {
    // Capture error immediately to avoid race conditions with other Chrome API calls
    const currentError = chrome.runtime.lastError
      ? { ...chrome.runtime.lastError }
      : null;

    if (currentError) {
      const errorMessage = currentError.message || '';

      // Check if this is likely a service worker sleep issue vs processing error
      const isConnectionError =
        errorMessage.includes('message port closed') ||
        errorMessage.includes('Receiving end does not exist');

      if (isConnectionError) {
        isBackgroundConnected = false;
        const pending = pendingMessages.get(messageId);

        if (pending && pending.retryCount < MAX_RETRIES) {
          pending.retryCount++;
          retryMessage(messageId);
          return;
        }

        // Max retries reached
        console.error(
          `[ContentScript] Message failed after ${MAX_RETRIES} retries:`,
          currentError
        );
      } else {
        // Not a connection error - likely processing timeout or other issue
        console.error(
          `[ContentScript] Message processing error (not retrying):`,
          currentError
        );
      }

      // Remove from pending messages
      pendingMessages.delete(messageId);

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
      return;
    }

    // Success - remove from pending and call response handler
    pendingMessages.delete(messageId);
    isBackgroundConnected = true;

    if (handleResponse) {
      handleResponse(response);
    }
  });
};

const sendToBackground = (
  message: any,
  handleResponse?: (response: any) => void
) => {
  const messageId = `msg_${Date.now()}_${Math.random()}`;

  // Store pending message for retry
  pendingMessages.set(messageId, {
    message,
    handleResponse,
    retryCount: 0,
    timestamp: Date.now(),
  });

  // Send the message
  sendToBackgroundInternal(messageId, message, handleResponse);
};

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
        // remove removeEth script for not inject the same thing many times
        if (inpage) inpage.remove();
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

  // Clear any pending messages and timeouts
  pendingMessages.clear();
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
});

// Periodic cleanup of old pending messages and connection health check
setInterval(() => {
  const now = Date.now();
  const MESSAGE_TIMEOUT = 30000; // 30 seconds

  // Clean up old pending messages
  for (const [messageId, pending] of pendingMessages.entries()) {
    if (now - pending.timestamp > MESSAGE_TIMEOUT) {
      pendingMessages.delete(messageId);
      if (pending.handleResponse) {
        pending.handleResponse({
          error: {
            message: 'Pali: Message timeout - background script may be busy.',
            code: -32603,
          },
        });
      }
    }
  }

  // Periodic connection health check (only if we think we're disconnected)
  if (!isBackgroundConnected) {
    checkBackgroundConnection().catch(() => {
      // Ignore errors in health check
    });
  }
}, 10000); // Every 10 seconds

// Initial setup - inject providers immediately at document_start
if (shouldInjectProvider()) {
  // Always inject pali provider first
  injectScriptFile('js/pali.bundle.js', 'pali');

  // Then check if ethereum should be injected after a small delay
  // This ensures pali is loaded before ethereum to avoid conflicts
  setTimeout(() => {
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
  }, 10); // Small delay to ensure pali loads first
}

start();
startEventEmitter();
