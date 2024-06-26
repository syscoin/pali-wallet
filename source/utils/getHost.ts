export const getHost = (url: string): string => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

export const getTabUrl = async () => {
  const windows = await chrome.windows.getAll({ populate: true });

  for (const window of windows) {
    const views = chrome.extension.getViews({ windowId: window.id });

    if (views) {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      return String(tabs[0].url);
    }
  }
};
