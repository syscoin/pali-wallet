import { logError } from 'utils/index';
import { browser } from 'webextension-polyfill-ts';

import {
  getMessagesToListenTo,
  listenAndSendMessageFromPageToBackground,
} from './helpers';

declare global {
  interface Window {
    SyscoinWallet: any;
    connectionConfirmed: boolean;
  }
}

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
  const blockedDomains = ['dropbox.com', 'github.com'];

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

const injectScript = (content: string) => {
  try {
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.textContent = content;

    container.insertBefore(scriptTag, container.children[0]);
  } catch (error) {
    logError('Provider injection failed', 'Connection');
  }
};

const injectScriptFile = (file: string) => {
  try {
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.src = browser.runtime.getURL(file);

    container.insertBefore(scriptTag, container.children[0]);
  } catch (error) {
    logError('Provider injection failed', 'Connection');
  }
};

if (shouldInjectProvider()) {
  injectScript("window.SyscoinWallet = 'Pali Wallet is installed! :)'");

  window.dispatchEvent(
    new CustomEvent('SyscoinStatus', {
      detail: {
        SyscoinInstalled: true,
        ConnectionsController: false,
      },
    })
  );

  injectScriptFile('js/inpage.bundle.js');

  browser.runtime.sendMessage({
    type: 'RELOAD_DATA',
    target: 'background',
  });
}

window.addEventListener(
  'message',
  (event) => {
    const { type, target } = event.data;

    if (event.source !== window) {
      return;
    }

    const browserMessages = listenAndSendMessageFromPageToBackground(event);

    browserMessages.map(
      ({ messageType, messageTarget, messageNewTarget, messageData }) => {
        if (type === messageType && target === messageTarget) {
          return browser.runtime.sendMessage({
            type: messageType,
            target: messageNewTarget,
            messageData,
          });
        }
      }
    );
  },
  false
);

browser.runtime.onMessage.addListener((request) => {
  const { type, target } = request;

  const messages = getMessagesToListenTo(request);

  messages.map(
    ({
      messageType,
      messageTarget,
      messageNewTarget,
      responseItem,
      messageResponse,
    }) => {
      if (type === messageType && target === messageTarget) {
        return window.postMessage(
          {
            type: messageType,
            target: messageNewTarget,
            [responseItem]: messageResponse,
          },
          '*'
        );
      }
    }
  );
});
