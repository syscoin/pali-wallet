// import { browser } from 'webextension-polyfill-ts';

export const getController = () => {
  // const { controller } = browser.extension.getBackgroundPage();
  // if (controller) return controller;
  // browser.runtime.reload();
  const controller = window?.controller;
  return controller;
};

export const dispatchBackgroundEvent = (eventName: string, data: any) => {
  // const background = browser.extension.getBackgroundPage();
  const background = window;
  background.dispatchEvent(new CustomEvent(eventName, { detail: data }));
};
