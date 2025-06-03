export const getHost = (url: string): string => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

export const getTabUrl = async () =>
  new Promise<string | undefined>((resolve) => {
    chrome.windows.getAll({ populate: true }, (windows) => {
      if (chrome.runtime.lastError || !windows) {
        resolve(undefined);
        return;
      }

      for (const window of windows) {
        const views = chrome.extension.getViews({ windowId: window.id });

        if (views && views.length > 0) {
          chrome.tabs.query(
            {
              active: true,
              currentWindow: true,
            },
            (tabs) => {
              if (
                chrome.runtime.lastError ||
                !tabs ||
                !tabs[0] ||
                !tabs[0].url
              ) {
                resolve(undefined);
              } else {
                resolve(String(tabs[0].url));
              }
            }
          );
          return;
        }
      }
      resolve(undefined);
    });
  });
