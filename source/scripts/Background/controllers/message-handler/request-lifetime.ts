import { ethErrors } from 'helpers/errors';

export const requestCancelledError = () =>
  ethErrors.provider.userRejectedRequest(
    'Request cancelled because the requesting page changed or closed'
  );

export const assertRequestActive = (signal?: AbortSignal) => {
  if (signal?.aborted) throw requestCancelledError();
};

export const isRequestDocumentLive = async (
  sender?: chrome.runtime.MessageSender
): Promise<boolean> => {
  if (sender?.tab?.id === undefined || !sender.documentId) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      chrome.tabs
        .sendMessage(
          sender.tab.id,
          { type: 'PALI_PROVIDER_DOCUMENT_CHECK' },
          { documentId: sender.documentId, frameId: sender.frameId }
        )
        .then((response) => response?.documentActive === true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), 1000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/** Queued requests must not outlive the document that requested approval. */
export const createRequestLifetime = (sender: chrome.runtime.MessageSender) => {
  const controller = new AbortController();
  const tabId = sender.tab?.id;
  const onRemoved = (removedId: number) => {
    if (removedId === tabId) controller.abort();
  };
  const onUpdated = (updatedId: number, change: chrome.tabs.TabChangeInfo) => {
    if (updatedId === tabId && change.status === 'loading') controller.abort();
  };
  if (tabId !== undefined) {
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (tabId === undefined) return;
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    },
  };
};
