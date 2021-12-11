import store from 'state/store';
import { updateCurrentURL } from 'state/wallet';
import { browser } from 'webextension-polyfill-ts';

export const useBrowser = () => {
  return {
    browser,
  }
}

export const useTabsAPI = () => {
  const getTabs = async ({ options }: any) => {
    return await browser.tabs.query(options);
  };

  const sendMessageToTabs = async ({ tabId, messageDetails }: any) => {
    return await browser.tabs.sendMessage(Number(tabId), messageDetails);
  }

  return {
    getTabs,
    sendMessageToTabs,
  }
}

export const useWindowsAPI = () => {
  const { getTabs } = useTabsAPI();

  const updateWindow = async ({ windowId, options }: any) => {
    return await browser.windows.update(Number(windowId), options);
  }

  const closeWindow = async ({ title }: any) => {
    const tabs = await getTabs({ options: { active: true } });

    try {
      tabs.map(async (tab: any) => {
        if (tab.title === title) {
          await browser.windows.remove(Number(tab.windowId));
        }
      });
    } catch (error: any) {
      console.log('error removing window', error);
    }
  }

  const createWindow = async ({
    url,
    options = {
      url,
      type: "popup",
      height: 600,
      width: 372,
      left: 900,
      top: 90,
    }
  }: any) => {
    const [tab]: any = await getTabs({
      options: {
        active: true,
        lastFocusedWindow: true
      }
    });

    if (tab.title === 'Pali Wallet') {
      return;
    }

    store.dispatch(updateCurrentURL(String(tab.url)));
  
    const [sysWalletPopup]: any = await getTabs({
      options: {
        url,
      }
    });
  
    if (sysWalletPopup) {
      await updateWindow({
        windowId: Number(sysWalletPopup.windowId),
        options: {
          drawAttention: true,
          focused: true
        }
      });
  
      return;
    }
  
    await browser.windows.create(options);
  }

  const getCurrentOrigin = async () => {
    const windows = await browser.windows.getAll({ populate: true })
    
    for (const window of windows) {
      const views = browser.extension.getViews({ windowId: window.id });

      if (views) {
        const tabs = await getTabs({
          active: true,
          currentWindow: true,
        });

        return String(tabs[0].url);
      }

      return null;
    }
  }

  return {
    updateWindow,
    closeWindow,
    createWindow,
    getCurrentOrigin
  }
}