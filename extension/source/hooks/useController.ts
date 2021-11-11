import { browser } from 'webextension-polyfill-ts';

export const useController = () => {
  return browser.extension.getBackgroundPage().controller;
}
