import { EventEmitter } from 'events';
import { browser } from 'webextension-polyfill-ts';

const emitter = new EventEmitter();
const backgroundPort = browser.runtime.connect(undefined, {
  name: 'pali',
});

const onMessage = ({ id, data }: { data: string; id: string }) => {
  emitter.emit(id, data);
};

backgroundPort.onMessage.addListener((message: { data: string; id: string }) =>
  onMessage(message)
);

const checkForPaliRegisterEvent = (type, id) => {
  if (type === 'PALI_EVENT_REG') {
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

const start = () => {
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      if (!event.data) return;

      const { id, type, data } = event.data;

      if (!id || !type) return;

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
