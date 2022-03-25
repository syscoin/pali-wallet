import { EventEmitter } from 'events';

import { browser } from 'webextension-polyfill-ts';

const emitter = new EventEmitter();
const backgroundPort = browser.runtime.connect(undefined, {
  name: 'pali',
});

const onMessage = ({ id, data }: { data: string; id: string }) => {
  // console.log('Script - onMessage', id, data);
  emitter.emit(id, data);
};

backgroundPort.onMessage.addListener((message: { data: string; id: string }) =>
  onMessage(message)
);

const checkForPaliRegisterEvent = (type, id) => {
  console.log('checking for pali register event');
  if (type === 'PALI_EVENT_REG') {
    console.log('pali register event found');
    emitter.on(id, (result) => {
      // console.log('Script - emitter', id, result);
      window.dispatchEvent(
        new CustomEvent(id, { detail: JSON.stringify(result) })
      );
    });

    return;
  }

  emitter.once(id, (result) => {
    // console.log('Script - emitter.once', id, result);
    window.dispatchEvent(
      new CustomEvent(id, { detail: JSON.stringify(result) })
    );
  });
};

const start = () => {
  console.log('start provider');

  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      if (!event.data) return;

      const { id, type, data } = event.data;

      if (!id || !type) return;

      checkForPaliRegisterEvent(type, id);

      // console.log('Script - ', id, type, data);
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
