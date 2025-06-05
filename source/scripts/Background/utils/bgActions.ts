import { chromeStorage } from 'utils/storageAPI';
import { PaliLanguages } from 'utils/types';

export const keepSWAlive = () => {
  chrome.runtime.sendMessage({
    type: 'ping',
    target: 'background',
  });
};

export const setLanguageInLocalStorage = async (lang: PaliLanguages) => {
  try {
    const serializedState = JSON.stringify(lang);
    await chromeStorage.setItem('language', serializedState);
  } catch (e) {
    console.error('<!> Error saving language', e);
  }
};
