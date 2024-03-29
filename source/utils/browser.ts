// import { browser } from 'webextension-polyfill-ts';

export const getController = () => {
  // const { controller } = browser.extension.getBackgroundPage();
  // if (controller) return controller;
  // browser.runtime.reload();
  const controller = window?.controller;
  return controller;
};

export const dispatchBackgroundEvent = (eventName: string, data: any) => {
  navigator.serviceWorker.controller.postMessage({ eventName, detail: data });
};
