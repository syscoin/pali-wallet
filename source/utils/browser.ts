import store from 'state/store';
import { updateCurrentURL } from 'state/wallet';
import { browser } from 'webextension-polyfill-ts';
import { logError } from 'utils/index';

export const getController = () => {
  const { controller } = browser.extension.getBackgroundPage();
  if (controller) return controller;

  browser.runtime.reload();
  return controller;
};

export const closePopup = async () => {
  await browser.runtime.sendMessage({
    type: 'CLOSE_POPUP',
    target: 'background',
  });
};

export const getTabs = ({ options }: any) => browser.tabs.query(options);

export const sendMessageToTabs = ({ tabId, messageDetails }: any) =>
  browser.tabs.sendMessage(Number(tabId), messageDetails);

export const updateWindow = ({ windowId, options }: any) =>
  browser.windows.update(Number(windowId), options);

export const closeWindow = async ({ title }: any) => {
  const tabs = await getTabs({ options: { active: true } });

  try {
    tabs.map(async (tab: any) => {
      if (tab.title === title) {
        await browser.windows.remove(Number(tab.windowId));
      }
    });
  } catch (error: any) {
    logError('error removing window', 'UI', error);
  }
};

export const createWindow = async ({
  url,
  options = {
    url,
    type: 'popup',
    height: 600,
    width: 372,
    left: 900,
    top: 90,
  },
}: any) => {
  const [tab]: any = await getTabs({
    options: {
      active: true,
      lastFocusedWindow: true,
    },
  });

  if (tab.title === 'Pali Wallet') {
    return;
  }

  store.dispatch(updateCurrentURL(String(tab.url)));

  const [sysWalletPopup]: any = await getTabs({ options: { url } });

  if (sysWalletPopup) {
    await updateWindow({
      windowId: Number(sysWalletPopup.windowId),
      options: {
        drawAttention: true,
        focused: true,
      },
    });

    return;
  }

  await browser.windows.create(options);
};

export const getCurrentOrigin = async () => {
  const windows = await browser.windows.getAll({ populate: true });

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
};
