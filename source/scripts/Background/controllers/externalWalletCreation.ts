import { ethErrors } from 'helpers/errors';

import { hasExternalWalletPage } from 'utils/extensionContexts';

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
