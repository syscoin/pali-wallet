import { browser } from 'webextension-polyfill-ts';

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

function injectScript(content: string) {
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

  if (type == 'CHECK_ADDRESS' && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'CHECK_ADDRESS',
      target: 'background',
      address: event.data.address
    });

    return;
  }

  if (type == 'GET_HOLDINGS_DATA' && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'GET_HOLDINGS_DATA',
      target: 'background',
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
  if (type == 'DATA_FROM_PAGE_TO_CREATE_TOKEN' && target == 'contentScript') {
    const {
      precision,
      symbol,
      maxsupply,
      description,
      receiver,
      initialSupply,
      capabilityflags,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    } = event.data;

    browser.runtime.sendMessage({
      type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
      target: 'background',
      precision,
      symbol,
      maxsupply,
      description,
      receiver,
      initialSupply,
      capabilityflags,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    });
    
    return;
  }

  if (type == 'ISSUE_SPT' && target == 'contentScript') {
    console.log('items content script issue spt', event.data)
    const {
      amount,
      assetGuid
    } = event.data;

    browser.runtime.sendMessage({
      type: 'ISSUE_SPT',
      target: 'background',
      amount,
      assetGuid
    });

    return;
  }

  if (type == 'CREATE_AND_ISSUE_NFT' && target == 'contentScript') {
    const {
      symbol,
      issuer,
      totalShares,
      description,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress,
    } = event.data;

    browser.runtime.sendMessage({
      type: 'CREATE_AND_ISSUE_NFT',
      target: 'background',
      symbol,
      issuer,
      totalShares,
      description,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress,
    });

    return;
  }

  if (type == 'UPDATE_ASSET' && target == 'contentScript') {
    const {
      assetGuid,
      contract,
      capabilityflags,
      description,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    } = event.data;

    console.log('event data', event.data)

    browser.runtime.sendMessage({
      type: 'UPDATE_ASSET',
      target: 'background',
      assetGuid,
      contract,
      capabilityflags,
      description,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    });

    return;
  }

  if (type == 'TRANSFER_OWNERSHIP' && target == 'contentScript') {
    const {
      assetGuid,
      newOwner
    } = event.data;

    browser.runtime.sendMessage({
      type: 'TRANSFER_OWNERSHIP',
      target: 'background',
      assetGuid,
      newOwner,
    });

    return;
  }

  if (type == 'GET_USER_MINTED_TOKENS' && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'GET_USER_MINTED_TOKENS',
      target: 'background',
    });

    return;
  }

  if (type == 'GET_ASSET_DATA' && target == 'contentScript') {
    browser.runtime.sendMessage({
      type: 'GET_ASSET_DATA',
      target: 'background',
      assetGuid: event.data.assetGuid
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
    connectedAccount,
    userTokens,
    connectionConfirmed,
    isValidSYSAddress,
    holdingsData,
    assetData,
  } = request;
    
  if (type == 'WALLET_ERROR' && target == 'contentScript') {
    console.log('error event', request)
    
    window.postMessage({
      type: 'TRANSACTION_ERROR',
      target: 'connectionsController',
      error: request.message
    }, '*');
    
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

  if (type == 'CHECK_ADDRESS' && target == 'contentScript') {
    window.postMessage({
      type: 'CHECK_ADDRESS',
      target: 'connectionsController',
      isValidSYSAddress
    }, '*');

    return;
  }

  if (type == 'GET_HOLDINGS_DATA' && target == 'contentScript') {
    window.postMessage({
      type: 'GET_HOLDINGS_DATA',
      target: 'connectionsController',
      holdingsData
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

  if (type == 'WALLET_UPDATED' && target == 'contentScript') {
    window.postMessage({
      type: 'WALLET_UPDATED',
      target: 'connectionsController',
      connected
    }, '*');

    return Promise.resolve({ response: "wallet updated response from content script" });
  }

  if (type == 'GET_USER_MINTED_TOKENS' && target == 'contentScript') {
    window.postMessage({
      type: 'GET_USER_MINTED_TOKENS',
      target: 'connectionsController',
      userTokens,
    }, '*');
  }

  if (type == 'GET_ASSET_DATA' && target == 'contentScript') {
    window.postMessage({
      type: 'GET_ASSET_DATA',
      target: 'connectionsController',
      assetData,
    }, '*');

    return;
  }

  if (type == 'DATA_FROM_PAGE_TO_CREATE_TOKEN' && target == 'contentScript') {
    window.postMessage({
      type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
      target: 'connectionsController',
      complete
    }, '*');
    return;
  }

  if (type == 'ISSUE_SPT' && target == 'contentScript') {
    window.postMessage({
      type: 'ISSUE_SPT',
      target: 'connectionsController',
      complete
    }, '*');
    return;
  }

  if (type == 'CREATE_AND_ISSUE_NFT' && target == 'contentScript') {
    window.postMessage({
      type: 'CREATE_AND_ISSUE_NFT',
      target: 'connectionsController',
      complete
    }, '*');
    return;
  }

  if (type == 'WALLET_CONNECTION_CONFIRMED' && target == 'contentScript') {
    window.postMessage({
      type: 'WALLET_CONNECTION_CONFIRMED',
      target: 'connectionsController',
      connectionConfirmed
    }, '*');
  }

  return;
});