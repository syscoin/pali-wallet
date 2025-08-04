import { chromeStorage } from 'utils/storageAPI';
import { PaliLanguages } from 'utils/types';

export const setLanguageInLocalStorage = async (lang: PaliLanguages) => {
  try {
    await chromeStorage.setItem('language', lang);
  } catch (e) {
    console.error('<!> Error saving language', e);
  }
};
