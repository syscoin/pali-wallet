import { isTrustedSigningWorkerSender } from '../slhDsa/messageAuthorization';

let worker: Worker | undefined;
let cancelActive: (() => void) | undefined;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !['PALI_SENTRY_CRYPTO', 'PALI_SENTRY_CANCEL_WORKER'].includes(message?.type)
  )
    return false;
  if (!isTrustedSigningWorkerSender(sender)) {
    sendResponse({
      success: false,
      error: 'Unauthorized Sentry signer source',
    });
    return false;
  }
  if (message.type === 'PALI_SENTRY_CANCEL_WORKER') {
    cancelActive?.();
    sendResponse({ success: true });
    return false;
  }
  if (worker) {
    sendResponse({
      success: false,
      error: 'A Sentry signing operation is already running',
    });
    return false;
  }
  const activeWorker = new Worker(new URL('./worker.ts', import.meta.url));
  worker = activeWorker;
  let settled = false;
  const finish = (response: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    activeWorker.terminate();
    if (worker === activeWorker) worker = undefined;
    cancelActive = undefined;
    sendResponse(response);
  };
  cancelActive = () =>
    finish({
      success: false,
      error: 'Sentry signing cancelled because the wallet session changed',
    });
  activeWorker.onmessage = (event) => finish(event.data);
  activeWorker.onerror = () =>
    finish({ success: false, error: 'Sentry signer failed' });
  const timer = setTimeout(
    () => finish({ success: false, error: 'Sentry signing timed out' }),
    150000
  );
  activeWorker.postMessage({ job: message.job });
  return true;
});
