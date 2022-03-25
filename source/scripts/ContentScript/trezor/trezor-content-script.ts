import { log } from 'utils/logger';

/*
Passing messages from background script to popup
*/

let port: chrome.runtime.Port | null = chrome.runtime.connect({
  name: 'trezor-connect',
});

port.onMessage.addListener((message) => {
  window.postMessage(message, window.location.origin);
});

port.onDisconnect.addListener(() => {
  log('Disconnecting trezor port', 'System');

  port = null;
});

/*
Passing messages from popup to background script
*/

window.addEventListener('message', ({ source, data }) => {
  if (port && source === window && data) {
    port.postMessage({ data });
  }
});
