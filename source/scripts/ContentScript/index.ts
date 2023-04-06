import { EventEmitter } from 'events';
import { browser } from 'webextension-polyfill-ts';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
const emitter = new EventEmitter();

// Connect to pali
const backgroundPort = browser.runtime.connect(undefined, {
  name: 'pali-inject',
});

// Add listener for pali events
const checkForPaliRegisterEvent = (type, id) => {
  emitter.once(id, (result) => {
    if (typeof id === 'string') {
      if (String(id).includes('isUnlocked'))
        window.dispatchEvent(new CustomEvent(id, { detail: result }));
    }
    if (result)
      window.dispatchEvent(
        new CustomEvent(id, { detail: JSON.stringify(result) })
      );
    else window.dispatchEvent(new CustomEvent(id, { detail: null }));
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
      checkForPaliRegisterEvent(type, id);

      backgroundPort.postMessage({
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

// Every message from pali emits an event
backgroundPort.onMessage.addListener(({ id, data }) => {
  switch (data?.params?.type) {
    case 'pali_removeProperty':
      injectScriptFile('js/handleWindowProperties.bundle.js', 'removeProperty');
      break;
    case 'pali_addProperty':
      injectScriptFile('js/inpage.bundle.js', 'inpage');
      break;
    default:
      break;
  }
  emitter.emit(id, data);
});

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

const injectScriptFile = (file: string, id: string) => {
  try {
    switch (id) {
      case 'removeProperty':
        const inpage = document.getElementById('inpage');
        if (inpage) inpage.remove();
        break;
      case 'inpage':
        const removeProperty = document.getElementById('removeProperty');
        if (removeProperty) removeProperty.remove();
        break;
      default:
        break;
    }
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.src = browser.runtime.getURL(file);
    scriptTag.setAttribute('id', id);
    container.insertBefore(scriptTag, container.children[0]);
  } catch (error) {
    console.error('Pali Wallet: Provider injection failed.', error);
  }
};
if (shouldInjectProvider()) {
  injectScriptFile('js/inpage.bundle.js', 'inpage');
}
start();
startEventEmitter();
