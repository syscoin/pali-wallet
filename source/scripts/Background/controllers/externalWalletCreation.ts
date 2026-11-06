import { ethErrors } from 'helpers/errors';

import { hasExternalWalletPage } from 'utils/extensionContexts';

import { requestCancelledError } from './message-handler/request-lifetime';

// Shared across controller reinitialization, and acquired before any await.
let creatingExternalView = false;

export const createExternalWalletView = async <T>(
  create: () => Promise<T>
): Promise<T> => {
  if (creatingExternalView)
    throw ethErrors.provider.unauthorized('Dapp already has a open window');
  creatingExternalView = true;
  try {
    let hasExternal: boolean;
    try {
      hasExternal = await hasExternalWalletPage(2000);
    } catch {
      throw ethErrors.provider.unauthorized('Could not check wallet windows');
    }
    if (hasExternal)
      throw ethErrors.provider.unauthorized('Dapp already has a open window');
    const result = await create();
    // Advisory only: a renderer or worker may exit before cleaning this up.
    // Live browser contexts/tabs, never this flag, authorize the next view.
    try {
      chrome.storage.local.set(
        {
          'pali-popup-open': true,
          'pali-popup-timestamp': Date.now(),
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // Creation already succeeded; a missing notification must not orphan it.
    }
    return result;
  } finally {
    creatingExternalView = false;
  }
};

/** Wait for live external views to close before the next popup opens. */
export const waitForExternalWalletClosure = async (
  signal?: AbortSignal,
  timeoutMs = 2000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw requestCancelledError();
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw ethErrors.provider.unauthorized('Dapp already has a open window');
    let hasExternal: boolean;
    try {
      hasExternal = await hasExternalWalletPage(remaining, signal);
    } catch {
      if (signal?.aborted) throw requestCancelledError();
      throw ethErrors.provider.unauthorized('Could not check wallet windows');
    }
    if (signal?.aborted) throw requestCancelledError();
    if (!hasExternal) return;
    const delay = Math.min(25, deadline - Date.now());
    if (delay <= 0)
      throw ethErrors.provider.unauthorized('Dapp already has a open window');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(requestCancelledError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delay);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
};
