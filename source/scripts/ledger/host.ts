import { createLedgerDmkHost } from '@sidhujag/sysweb3-keyring/esm/ledger-host';
import { i18next } from './i18n';
import {
  invokeLedgerHost,
  LEDGER_HOST_PORT,
  snapshotLedgerMessage,
} from './protocol';
import './host.css';

import type { LedgerBlindSigningIntent } from '@sidhujag/sysweb3-keyring/esm/ledger-host';

const node = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const connect = node<HTMLButtonElement>('connect');
const cancel = node<HTMLButtonElement>('cancel');
const approve = node<HTMLButtonElement>('approve');
const status = node('status');
const review = node('review');
const details = node('details');
const t = (key: string) => i18next.t(`ledgerHost.${key}`);
const setStatus = (key: string) => {
  status.dataset.i18n = key;
  status.textContent = t(key);
};

const localize = () => {
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]'))
    element.textContent = t(element.dataset.i18n!);
};
localize();
i18next.on('languageChanged', localize);

let consent:
  | { cleanup: () => void; resolve: (accepted: boolean) => void }
  | undefined;
let active = false;
let alive = true;
const host = createLedgerDmkHost({
  confirmBlindSigning: (
    intent: LedgerBlindSigningIntent,
    signal: AbortSignal
  ) => {
    if (!alive || signal.aborted || consent) return false;
    return new Promise<boolean>((resolve) => {
      const finish = (accepted: boolean) => {
        if (consent?.resolve !== resolve) return;
        consent.cleanup();
        consent = undefined;
        review.hidden = true;
        details.textContent = '';
        resolve(accepted);
      };
      const abort = () => finish(false);
      consent = {
        resolve,
        cleanup: () => signal.removeEventListener('abort', abort),
      };
      signal.addEventListener('abort', abort, { once: true });
      details.textContent = JSON.stringify(intent, null, 2);
      review.hidden = false;
      approve.onclick = () => finish(true);
      cancel.onclick = () => finish(false);
      cancel.focus();
    });
  },
});

const nonce = window.location.hash.slice(1);
if (!/^[0-9a-f]{48}$/.test(nonce)) {
  setStatus('unavailable');
} else {
  const port = chrome.runtime.connect({ name: `${LEDGER_HOST_PORT}${nonce}` });
  let lastActivity = Date.now();
  const detectDisconnect = () => {
    if (!alive || active || !connect.hidden || host.getStatus().connected)
      return;
    connect.hidden = false;
    connect.disabled = false;
    setStatus('disconnected');
    port.postMessage({ type: 'device-disconnected' });
  };
  const statusTimer = setInterval(detectDisconnect, 1000);
  // MV3 needs actual messages during device/user waits, not merely an open port.
  // Close an idle device window instead of keeping the worker alive indefinitely.
  const heartbeatTimer = setInterval(() => {
    if (!active && Date.now() - lastActivity >= 300000) shutdown();
    else port.postMessage({ type: 'heartbeat' });
  }, 20000);
  const shutdown = () => {
    if (!alive) return;
    alive = false;
    clearInterval(statusTimer);
    clearInterval(heartbeatTimer);
    connect.disabled = true;
    consent?.cleanup();
    consent?.resolve(false);
    consent = undefined;
    review.hidden = true;
    details.textContent = '';
    void host.disconnect();
    setStatus('disconnected');
    port.disconnect();
  };
  port.onDisconnect.addListener(shutdown);
  window.addEventListener('pagehide', shutdown, { once: true });
  connect.onclick = async () => {
    if (connect.disabled || active || !alive) return;
    lastActivity = Date.now();
    connect.disabled = true;
    setStatus('connecting');
    try {
      // Must start directly from this visible page's user gesture.
      await host.connect({ useGrantedDevices: false });
      if (!alive) return;
      setStatus('ready');
      connect.hidden = true;
      port.postMessage({ type: 'ready' });
    } catch {
      if (!alive) return;
      setStatus('connectFailed');
      connect.disabled = false;
    }
  };
  port.onMessage.addListener(async (input) => {
    if (!alive) return;
    let message: any;
    try {
      message = snapshotLedgerMessage(input);
    } catch {
      shutdown();
      return;
    }
    if (message.type === 'attached') {
      connect.disabled = false;
      return;
    }
    if (message.type !== 'request' || !Number.isSafeInteger(message.id)) return;
    if (active) {
      port.postMessage({
        id: message.id,
        ok: false,
        code: 'HARDWARE_SIGNER_BUSY',
        message: t('busy'),
      });
      return;
    }
    active = true;
    lastActivity = Date.now();
    setStatus('reviewDevice');
    try {
      const value = await invokeLedgerHost(
        host,
        message.method,
        message.request
      );
      if (alive) {
        port.postMessage({ id: message.id, ok: true, value });
        setStatus('complete');
      }
    } catch (error) {
      if (alive) {
        const code =
          typeof error?.code === 'string' ? error.code : 'LEDGER_DEVICE_ERROR';
        port.postMessage({
          id: message.id,
          ok: false,
          code,
          message: t('operationFailed'),
        });
        setStatus('operationFailed');
      }
    } finally {
      active = false;
      lastActivity = Date.now();
      detectDisconnect();
    }
  });
}
