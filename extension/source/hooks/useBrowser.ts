import { browser } from 'webextension-polyfill-ts';

export const useBrowser = () => {
  return {
    browser,
  }
}