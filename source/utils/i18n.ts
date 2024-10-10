/* eslint-disable import/no-extraneous-dependencies */
import i18next from 'i18next';
import HttpApi from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

export const availableLanguages = ['en', 'es', 'pt-br'];
export const defaultLocale = 'en';
const LOCALE_VERSION = '1.5.1';

const determineLngFn = (code: string): string => {
  let { language } = i18next;

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

const langDetector: any = {
  type: 'languageDetector',
  async: true,

  detect: async function () {
    const storageLanguage = await chrome.storage.local.get('language');

    if (storageLanguage) {
      return storageLanguage.language;
    }

    return 'en';
  },
};

i18next
  .use(HttpApi)
  .use(initReactI18next)
  .use(langDetector)
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
    fallbackLng: determineLngFn,
    keySeparator: '.',
    interpolation: { escapeValue: true },
  });

export { i18next };
