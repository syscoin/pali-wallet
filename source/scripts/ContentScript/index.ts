import { EventEmitter } from 'events';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';

const emitter = new EventEmitter();

const sendToBackground = (
  message: any,
  handleResponse?: (response: any) => void
) => {
  chrome.runtime.sendMessage(message, handleResponse);
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

sendToBackground(
  { action: 'isInjected', type: 'pw-msg-background' },
  handleEthInjection
);

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
    container.insertBefore(scriptTag, container.children[0]);
  } catch (error) {
    console.error('Pali Wallet: Provider injection failed.', error);
  }
};

// listen for messages from background
chrome.runtime.onMessage.addListener((message) => {
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
});

// Initial setup
if (shouldInjectProvider()) {
  // inject window.pali property in browser
  injectScriptFile('js/pali.bundle.js', 'pali');
}

// keeps the background active
const port = chrome.runtime.connect({ name: 'keepAlive' });
setInterval(() => {
  port.postMessage({ ping: true });
}, 120000); // Reduced frequency from 30s to 2 minutes to minimize overhead and prevent excessive RPC calls

start();
startEventEmitter();
