// Runs at the page environment

import { EventEmitter } from 'events';
import { browser } from 'webextension-polyfill-ts';

const emitter = new EventEmitter();

// Connect to pali
const backgroundPort = browser.runtime.connect(undefined, {
  name: 'pali-inject',
});

// Every message from pali emits an event
backgroundPort.onMessage.addListener(({ id, data }) => {
  emitter.emit(id, data);
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

export const provider = {
  start,
};
