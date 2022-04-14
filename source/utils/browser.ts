import { browser } from 'webextension-polyfill-ts';

export const getController = () => {
  const { controller } = browser.extension.getBackgroundPage();
  if (controller) return controller;

  browser.runtime.reload();
  return controller;
};
