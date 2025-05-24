/* eslint-disable import/no-extraneous-dependencies */
import i18next from 'i18next';
import HttpApi from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

import { chromeStorage } from 'utils/storageAPI';

export const availableLanguages = [
  'en',
  'es',
  'pt-br',
  'fr',
  'de',
  'zh-cn',
  'ja',
  'ko',
  'ru',
];
export const defaultLocale = 'en';
const LOCALE_VERSION = '1.5.1';

const determineLngFn = async (code: string): Promise<string> => {
  let { language } = i18next;
  const storageLanguage = async () =>
    await chromeStorage.getItem('language').then((lng) => JSON.parse(lng));

  const lng = (await storageLanguage()) ?? defaultLocale;
  if (lng) {
    return lng;
  }
  if (!code || code.length === 0) {
    language = defaultLocale;

    return language;
  }

  // Full locale match
  if (availableLanguages.includes(code.toLowerCase())) {
    language = code.toLowerCase();

    return language;
  }

  // Base locale match
  const codeBase = code.split('-')[0].toLowerCase();
  if (availableLanguages.includes(codeBase)) {
    language = codeBase;

    return language;
  }

  // Fallback
  return language;
};

const initI18next = async () => {
  const fallbackLng = await determineLngFn('');

  i18next
    .use(HttpApi)
    .use(initReactI18next)
    .init({
      backend: {
        loadPath: `../assets/locales/{{lng}}.json`,
        queryStringParams: { v: LOCALE_VERSION },
      },
      react: {
        useSuspense: true,
      },
      load: 'languageOnly',
      lowerCaseLng: true,
      fallbackLng: 'en',
      fallbackNS: 'translation',
      keySeparator: '.',
      interpolation: { escapeValue: true },
      saveMissing: true,
      saveMissingTo: 'all',
      missingKeyHandler: (lng, ns, key) => {
        console.warn(`Missing translation key: ${key} for language: ${lng}`);
      },
    });
};

initI18next();

export { i18next };
