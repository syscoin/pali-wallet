/** The signing worker accepts commands only from this extension's background worker. */
export const isTrustedSigningWorkerSender = (
  sender: chrome.runtime.MessageSender,
  runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'> = chrome.runtime
) =>
  sender?.id === runtime.id &&
  !sender.tab &&
  sender.url === runtime.getURL('js/background.bundle.js');
