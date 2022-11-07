import { EventEmitter } from 'events';
import { browser } from 'webextension-polyfill-ts';

import { web3Provider } from '@pollum-io/sysweb3-network';

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
};

start();

const inject = (content: string) => {
  const container = document.head || document.documentElement;
  const scriptTag = document.createElement('script');

  scriptTag.setAttribute('async', 'false');
  scriptTag.textContent = `(() => {${content}})()`;

  container.insertBefore(scriptTag, container.children[0]);
};

inject(`window.SUPPORTED_WALLET_METHODS = ${JSON.stringify(DAppMethods)}`);
inject(_inject);

const setDappNetworkProvider = () => {
  const chainId = web3Provider.send('eth_chainId', []);
  const networkVersion = web3Provider.send('net_version', []);

  Promise.all([chainId, networkVersion]).then(([id, version]) => {
    console.log({ id, version });
    inject(`window.ethereum.chainId = ${String(id)}`);
    inject(`window.ethereum.networkVersion = ${version}`);
  });
};

// Every message from pali emits an event
backgroundPort.onMessage.addListener(({ id, data }) => {
  emitter.emit(id, data);

  console.log({ id, data });
});

emitter.on('chainChanged', () => {
  setDappNetworkProvider();
});

setDappNetworkProvider();
