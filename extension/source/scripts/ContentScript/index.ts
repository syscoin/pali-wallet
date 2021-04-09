import { browser } from 'webextension-polyfill-ts';

declare global {
  interface Window {
    SyscoinWallet: any;
  }
}

const doctypeCheck = () => {
  const { doctype } = window.document;

  if (doctype) {
    return doctype.name === 'html';
  }

  return true;
}

const suffixCheck = () => {
  const prohibitedTypes = [/\.xml$/u, /\.pdf$/u];
  const currentUrl = window.location.pathname;

  for (let i = 0; i < prohibitedTypes.length; i++) {
    if (prohibitedTypes[i].test(currentUrl)) {
      return false;
    }
  }

  return true;
}

const documentElementCheck = () => {
  const documentElement = document.documentElement.nodeName;

  if (documentElement) {
    return documentElement.toLowerCase() === 'html';
  }

  return true;
}

const blockedDomainCheck = () => {
  const blockedDomains = [
    'dropbox.com',
    'github.com',
  ];

  const currentUrl = window.location.href;
  let currentRegex;

  for (let i = 0; i < blockedDomains.length; i++) {
    const blockedDomain = blockedDomains[i].replace('.', '\\.');

    currentRegex = new RegExp(
      `(?:https?:\\/\\/)(?:(?!${blockedDomain}).)*$`,
      'u',
    );

    if (!currentRegex.test(currentUrl)) {
      return true;
    }
  }

  return false;
}

export const shouldInjectProvider = () => {
  return (
    doctypeCheck() &&
    suffixCheck() &&
    documentElementCheck() &&
    !blockedDomainCheck()
  );
}
function injectScript(content: any) {
  try {
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.setAttribute('async', 'false');
    scriptTag.textContent = content;
    container.insertBefore(scriptTag, container.children[0]);
    container.removeChild(scriptTag);
  } catch (error) {
    console.error('Syscoin Wallet: Provider injection failed.', error);
  }
}

if (shouldInjectProvider()) {
  // @ts-ignore
  injectScript(
    "window.SyscoinWallet = 'Syscoin Wallet is installed! :)'"
  );
}

window.addEventListener("message", (event) => {
  if (event.source != window) {
    return;
  }

  if (event.data.type == "FROM_PAGE") {
    browser.runtime.sendMessage({ type: 'OPEN_WALLET_POPUP' });
  }
}, false);

browser.runtime.onMessage.addListener(request => {
  if (typeof request == 'object' && request.type == 'DISCONNECT') {
    const id = browser.runtime.id;
    const port = browser.runtime.connect(id, { name: 'SYSCOIN' });

    port.disconnect();
  }

  if (typeof request == 'object' && request.type == 'SEND_DATA') {
    window.postMessage({ type: 'RESPONSE_FROM_EXTENSION', controller: request.controller }, '*');
  }
});