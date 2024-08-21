import { browser } from 'webextension-polyfill-ts';

export const getController = () => {
  const { controller } = browser.extension.getBackgroundPage();
  if (controller) return controller;
  browser.runtime.reload();

  return controller;
};

export const dispatchBackgroundEvent = (eventName: string, data: any) => {
  const background = browser.extension.getBackgroundPage();
  background.dispatchEvent(new CustomEvent(eventName, { detail: data }));
};

export const reload = () => {
  browser.runtime.reload();
};
