import { Browser } from 'webextension-polyfill-ts';

export const getHost = (url: string): string => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

export const getTabUrl = async (browser: Browser) => {
  const windows = await browser.windows.getAll({ populate: true });

  for (const window of windows) {
    const views = browser.extension.getViews({ windowId: window.id });

    if (views) {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      return String(tabs[0].url);
    }
  }
};
