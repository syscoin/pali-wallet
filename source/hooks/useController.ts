import { browser } from 'webextension-polyfill-ts';

export const useController = () => {
  const { controller } = browser.extension.getBackgroundPage();

  if (controller) {
    return controller;
  }

  browser.runtime.reload();

  return controller;
};
