/* eslint-disable import/no-extraneous-dependencies */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import deTranslations from 'assets/locales/de.json';
import enTranslations from 'assets/locales/en.json';
import esTranslations from 'assets/locales/es.json';
import frTranslations from 'assets/locales/fr.json';
import jaTranslations from 'assets/locales/ja.json';
import koTranslations from 'assets/locales/ko.json';
import ptBrTranslations from 'assets/locales/pt-br.json';
import ruTranslations from 'assets/locales/ru.json';
import zhTranslations from 'assets/locales/zh.json';
import { chromeStorage } from 'utils/storageAPI';

export const availableLanguages = [
  'en',
  'es',
  'pt-br',
  'fr',
  'de',
  'zh',
  'ja',
  'ko',
  'ru',
];
export const defaultLocale = 'en';

const determineLngFn = async (code: string): Promise<string> => {
  // Start with default locale immediately
  let language = defaultLocale;

  // Try to get stored language asynchronously (non-blocking)
  try {
    const storageLanguage = await chromeStorage
      .getItem('language')
      .then((lng) => {
        try {
          return lng ? JSON.parse(lng) : null;
        } catch {
          return null;
        }
      });

    if (storageLanguage) {
      return storageLanguage;
    }
  } catch (error) {
    // If storage read fails, continue with default
    console.warn('[i18n] Failed to read language from storage:', error);
  }

  if (!code || code.length === 0) {
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

  i18next.use(initReactI18next).init({
    react: {
      useSuspense: false,
    },
    resources: {
      // Bundle all language translations directly
      en: {
        translation: enTranslations,
      },
      es: {
        translation: esTranslations,
      },
      'pt-br': {
        translation: ptBrTranslations,
      },
      fr: {
        translation: frTranslations,
      },
      de: {
        translation: deTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
      ja: {
        translation: jaTranslations,
      },
      ko: {
        translation: koTranslations,
      },
      ru: {
        translation: ruTranslations,
      },
    },
    load: 'languageOnly',
    lowerCaseLng: true,
    fallbackLng: fallbackLng,
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
