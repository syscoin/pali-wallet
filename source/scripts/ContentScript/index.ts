import { EventEmitter } from 'events';
import { browser } from 'webextension-polyfill-ts';

import { DAppMethods } from 'scripts/Background/controllers/message-handler/types';

import { inject as _inject } from './inject';

// Runs at the page environment

const emitter = new EventEmitter();

// Connect to pali
const backgroundPort = browser.runtime.connect(undefined, {
  name: 'pali-inject',
});

// Add listener for pali events
const checkForPaliRegisterEvent = (type, id) => {
  if (type === 'EVENT_REG') {
    emitter.on(id, (result) => {
      window.dispatchEvent(
        new CustomEvent(id, { detail: JSON.stringify(result) })
      );
    });

    return;
  }

  emitter.once(id, (result) => {
    window.dispatchEvent(
      new CustomEvent(id, { detail: JSON.stringify(result) })
    );
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
  const id = 'General';
  const type = 'CHAIN_NET_REQUEST';
  const data = {};
  backgroundPort.postMessage({
    id,
    type,
    data,
  });
};

const inject = (content: string) => {
  const container = document.head || document.documentElement;
  const scriptTag = document.createElement('script');

  scriptTag.setAttribute('async', 'false');
  scriptTag.textContent = `(() => {${content}})()`;

  container.insertBefore(scriptTag, container.children[0]);
};

inject(`window.SUPPORTED_WALLET_METHODS = ${JSON.stringify(DAppMethods)}`);
inject(_inject);

const setDappNetworkProvider = (networkVersion?: any, chainId?: any) => {
  if (networkVersion && chainId) {
    inject(`window.ethereum.chainId = '${chainId}'`);
    inject(`window.ethereum.networkVersion = ${networkVersion}`);

    return;
  }
  throw {
    code: 500,
    message: 'Couldnt fetch chainId and networkVersion',
  };
};

browser.runtime.onMessage.addListener(({ type, data }) => {
  if (type === 'CHAIN_CHANGED')
    setDappNetworkProvider(data.networkVersion, data.chainId);
});

// Every message from pali emits an event
backgroundPort.onMessage.addListener(({ id, data }) => {
  emitter.emit(id, data);
});
start();
