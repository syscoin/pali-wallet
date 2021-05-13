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
    scriptTag.textContent = content;

    container.insertBefore(scriptTag, container.children[0]);

    scriptTag.onload = () => {
      scriptTag.remove();
    }
  } catch (error) {
    console.error('Syscoin Wallet: Provider injection failed.', error);
  }
}

function injectScriptFile(file: string) {
  try {
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.src = browser.runtime.getURL(file);

    container.insertBefore(scriptTag, container.children[0]);

    scriptTag.onload = () => {
      scriptTag.remove();
    }
  } catch (error) {
    console.error('Syscoin Wallet: Provider injection failed.', error);
  }
}

if (shouldInjectProvider()) {
  injectScript("window.SyscoinWallet = 'Syscoin Wallet is installed! :)'");

  window.dispatchEvent(new CustomEvent('SyscoinStatus', { detail: { SyscoinInstalled: true, ConnectionsController: false } }));

  injectScriptFile('js/inpage.bundle.js');
}

window.addEventListener('message', (event) => {
  const {
    type,
    target
  } = event.data;
  
  if (type == "ISSUE_ASSETGUID" && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'ISSUE_ASSETGUID',
      target: 'background'
    });
  }

  if (event.source != window) {
    return;
  }

  if (type == "CONNECT_WALLET" && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'CONNECT_WALLET',
      target: 'background'
    });

    return;
  }

  if (type == 'WALLET_UPDATED' && target == 'contentScript') {
    window.postMessage({
      type: 'WALLET_UPDATED',
      target: 'background',
    }, '*');

    return;
  }

  if (type == 'SEND_STATE_TO_PAGE' && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'SEND_STATE_TO_PAGE',
      target: 'background'
    });

    return;
  }

  if (type == 'SEND_CONNECTED_ACCOUNT' && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'SEND_CONNECTED_ACCOUNT',
      target: 'background'
    });

    return;
  }

  if (type == 'SEND_TOKEN' && target == 'contentScript') {
    const {
      fromConnectedAccount,
      toAddress,
      amount,
      fee,
      token,
      isToken,
      rbf
    } = event.data;

    browser.runtime.sendMessage({
      type: 'SEND_TOKEN',
      target: 'background',
      fromConnectedAccount,
      toAddress,
      amount,
      fee,
      token,
      isToken,
      rbf
    });

    return;
  }
  if (type == 'CREATE_TOKEN' && target == 'contentScript') {
    const {
      precision,
      symbol,
      maxsupply,
      fee,
      description,
      receiver,
      rbf
    } = event.data;

    browser.runtime.sendMessage({
      type: 'CREATE_TOKEN',
      target: 'background',
      precision,
      symbol,
      maxsupply,
      fee,
      description,
      receiver,
      rbf
    });

    return;
  }
  

  if (type == 'ISSUE_TOKEN' && target == 'contentScript') {
    const {
      assetGuid,
      amount,
      receiver,
      fee,
      rbf
    } = event.data;

    browser.runtime.sendMessage({
      type: 'ISSUE_TOKEN',
      target: 'background',
      assetGuid,
      amount,
      receiver,
      fee,
      rbf
    });

    return;
  }

  if (type == 'ISSUE_NFT' && target == 'contentScript') {
    const {
      assetGuid,
      nfthash,
      receiver,
      fee,
      rbf
    } = event.data;

    browser.runtime.sendMessage({
      type: 'ISSUE_NFT',
      target: 'background',
      assetGuid,
      nfthash,
      receiver,
      fee,
      rbf
    });

    return;
  }
}, false);

browser.runtime.onMessage.addListener((request) => {
  const {
    type,
    target,
    complete,
    connected,
    state,
    connectedAccount
  } = request;

  if (type == 'DISCONNECT' && target == 'contentScript') {
    const id = browser.runtime.id;
    const port = browser.runtime.connect(id, { name: 'SYSCOIN' });

    port.disconnect();

    return;
  }

  if (type == 'SEND_STATE_TO_PAGE' && target == 'contentScript') {
    window.postMessage({
      type: 'SEND_STATE_TO_PAGE',
      target: 'connectionsController',
      state
    }, '*');

    return;
  }

  if (type == 'SEND_CONNECTED_ACCOUNT' && target == 'contentScript') {
    window.postMessage({
      type: 'SEND_CONNECTED_ACCOUNT',
      target: 'connectionsController',
      connectedAccount
    }, '*');

    return;
  }

  if (type == 'SEND_TOKEN' && target == 'contentScript') {
    window.postMessage({
      type: 'SEND_TOKEN',
      target: 'connectionsController',
      complete
    }, '*');

    return;
  }

  if (type == 'CONNECT_WALLET' && target == 'contentScript') {
    window.postMessage({
      type: 'CONNECT_WALLET',
      target: 'connectionsController',
      eventResult: 'complete'
    }, '*');

    return;
  }


  if (type == 'ISSUE_ASSETGUID' && target == 'contentScript') {
    window.postMessage({
      type: 'CONNECT_WALLET',
      target: 'connectionsController',
      connected,
      eventResult: 'complete',
      complete
    }, '*');

    return;
  }

  if (type == 'CREATE_TOKEN' && target == 'contentScript') {
    window.postMessage({
      type: 'CREATE_TOKEN',
      target: 'connectionsController',
      complete
    }, '*');
    return;
  }

  if (type == 'ISSUE_TOKEN' && target == 'contentScript') {
    window.postMessage({
      type: 'ISSUE_TOKEN',
      target: 'connectionsController',
      complete
    }, '*');
    return;
  }

  if (type == 'ISSUE_NFT' && target == 'contentScript') {
    window.postMessage({
      type: 'ISSUE_NFT',
      target: 'connectionsController',
      complete
    }, '*');
    return;
  }
  
  if (type == 'WALLET_UPDATED' && target == 'contentScript') {
    window.postMessage({
      type: 'WALLET_UPDATED',
      target: 'connectionsController',
      connected
    }, '*');
    return;
  }
});