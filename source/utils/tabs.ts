import { browser } from 'webextension-polyfill-ts';

export const getCurrentTabUrl = async () => {
  let currentURL = '';

  const windows = await browser.windows.getAll({ populate: true });

  for (const window of windows) {
    const views = browser.extension.getViews({ windowId: window.id });

    if (views) {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      currentURL = String(tabs[0].url);

      return;
    }
  }

  return currentURL;
};
