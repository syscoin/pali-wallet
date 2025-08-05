// Utility to check if the extension popup is open
export const checkIfPopupIsOpen = async (): Promise<boolean> =>
  new Promise((resolve) => {
    if (
      'getContexts' in chrome.runtime &&
      typeof chrome.runtime.getContexts === 'function'
    ) {
      // Use getContexts API (modern approach)
      const ourExtensionOrigin = `chrome-extension://${chrome.runtime.id}`;
      (chrome.runtime as any).getContexts({}, (contexts: any[]) => {
        const popupOpen = contexts.some(
          (ctx) =>
            ctx.contextType === 'POPUP' &&
            ctx.documentOrigin === ourExtensionOrigin
        );
        resolve(popupOpen);
      });
    } else {
      // Fallback for older versions or when API is not available
      resolve(false);
    }
  });
