import { isOwnExtensionUrl } from './extensionContexts';

// Utility to check if the extension popup is open
export const checkIfPopupIsOpen = async (): Promise<boolean> =>
  new Promise((resolve) => {
    if (
      'getContexts' in chrome.runtime &&
      typeof chrome.runtime.getContexts === 'function'
    ) {
      // Use getContexts API (modern approach)
      (chrome.runtime as any).getContexts({}, (contexts: any[]) => {
        const popupOpen = contexts.some(
          (ctx) =>
            ctx.contextType === 'POPUP' &&
            isOwnExtensionUrl(ctx.documentUrl || ctx.documentOrigin)
        );
        resolve(popupOpen);
      });
    } else {
      // Fallback for older versions or when API is not available
      resolve(false);
    }
  });
