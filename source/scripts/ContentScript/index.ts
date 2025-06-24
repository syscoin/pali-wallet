import { EventEmitter } from 'events';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';

// Performance tracking
const perfTimings = {
  contentScriptStart: Date.now(),
  injectionChecks: 0,
  paliInjectionStart: 0,
  paliInjectionEnd: 0,
  inpageInjectionStart: 0,
  inpageInjectionEnd: 0,
  backgroundResponseTime: 0,
};

// Log performance data
const logPerformance = (event: string, details?: any) => {
  const elapsed = Date.now() - perfTimings.contentScriptStart;
  console.log(`[Pali CS ${elapsed}ms] ${event}`, details || '');
};

logPerformance('Content script started', window.location.href);

const emitter = new EventEmitter();

const sendToBackground = (
  message: any,
  handleResponse?: (response: any) => void
) => {
  chrome.runtime.sendMessage(message, handleResponse);
};

const handleEthInjection = (message: any) => {
  const isInjected = message?.isInjected;
  logPerformance('handleEthInjection response', { isInjected });

  if (typeof isInjected !== 'undefined') {
    if (isInjected) {
      perfTimings.inpageInjectionStart = Date.now();
      injectScriptFile('js/inpage.bundle.js', 'inpage');
    } else {
      injectScriptFile('js/handleWindowProperties.bundle.js', 'removeProperty');
    }
    return;
  }
};

// Use requestIdleCallback for truly non-blocking injection
const checkInjectionStatus = () => {
  const checkStart = Date.now();
  logPerformance('Checking injection status with background');
  sendToBackground(
    { action: 'isInjected', type: 'pw-msg-background' },
    (response) => {
      perfTimings.backgroundResponseTime = Date.now() - checkStart;
      logPerformance('Background response received', {
        responseTime: perfTimings.backgroundResponseTime,
      });
      handleEthInjection(response);
    }
  );
};

// Use requestIdleCallback if available, otherwise use setTimeout
if ('requestIdleCallback' in window) {
  (window as any).requestIdleCallback(checkInjectionStatus, { timeout: 100 });
} else {
  setTimeout(checkInjectionStatus, 0);
}

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

      sendToBackground({
        id,
        type,
        data,
      });
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
  const injectionStart = Date.now();
  logPerformance(`Starting injection: ${id}`, { file });

  try {
    const inpage = document.getElementById('inpage');
    const removeProperty = document.getElementById('removeProperty');
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
      default:
        break;
    }
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.src = file.includes('http') ? file : chrome.runtime.getURL(file);
    scriptTag.setAttribute('id', id);

    // Make script load async to prevent render blocking
    scriptTag.async = true;

    // Track when script actually loads
    scriptTag.onload = () => {
      const loadTime = Date.now() - injectionStart;
      logPerformance(`Script loaded: ${id}`, { loadTime });

      if (id === 'pali') {
        perfTimings.paliInjectionEnd = Date.now();
        // Log bundle size estimate
        if (
          'performance' in window &&
          'getEntriesByName' in window.performance
        ) {
          const entries = window.performance.getEntriesByName(scriptTag.src);
          if (entries.length > 0) {
            const entry = entries[0] as any;
            logPerformance(`Script size info: ${id}`, {
              transferSize: entry.transferSize,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize,
            });
          }
        }
      } else if (id === 'inpage') {
        perfTimings.inpageInjectionEnd = Date.now();
      }
    };

    scriptTag.onerror = (error) => {
      logPerformance(`Script failed to load: ${id}`, error);
    };

    container.insertBefore(scriptTag, container.children[0]);
  } catch (error) {
    console.error('Pali Wallet: Provider injection failed.', error);
    logPerformance('Injection error', { id, error: error.message });
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

// Initial setup - make non-blocking
if (shouldInjectProvider()) {
  perfTimings.injectionChecks = Date.now() - perfTimings.contentScriptStart;
  logPerformance('Injection checks completed', {
    shouldInject: true,
    checkTime: perfTimings.injectionChecks,
  });

  // Use requestIdleCallback for truly non-blocking injection
  const injectPali = () => {
    perfTimings.paliInjectionStart = Date.now();
    logPerformance('Starting pali injection');
    // inject window.pali property in browser
    injectScriptFile('js/pali.bundle.js', 'pali');
  };

  // Inject when browser is idle, with a timeout fallback
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(injectPali, { timeout: 200 });
  } else {
    setTimeout(injectPali, 0);
  }
} else {
  logPerformance('Skipping injection', {
    url: window.location.href,
    reason: 'Failed shouldInjectProvider checks',
  });
}

// Log final timing summary after a delay
setTimeout(() => {
  logPerformance('=== Injection Performance Summary ===', {
    totalTime: Date.now() - perfTimings.contentScriptStart,
    paliInjectionTime:
      perfTimings.paliInjectionEnd - perfTimings.paliInjectionStart ||
      'Not completed',
    inpageInjectionTime:
      perfTimings.inpageInjectionEnd - perfTimings.inpageInjectionStart ||
      'Not injected',
    backgroundResponseTime: perfTimings.backgroundResponseTime || 'No response',
  });
}, 5000);

start();
startEventEmitter();
