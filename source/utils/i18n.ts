/* eslint-disable import/no-extraneous-dependencies */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Only import the default language statically
import enTranslations from 'assets/locales/en.json';
import { chromeStorage } from 'utils/storageAPI';

export const availableLanguages = [
  'en',
  'es',
  'pt',
  'fr',
  'de',
  'zh',
  'ja',
  'ko',
  'ru',
];
export const defaultLocale = 'en';

// Cache for loaded languages
const loadedLanguages: { [key: string]: any } = {
  en: enTranslations, // English is always loaded
};

// Lazy load language translations
const loadLanguage = async (lng: string): Promise<any> => {
  // Return cached language if already loaded
  if (loadedLanguages[lng]) {
    return loadedLanguages[lng];
  }

  try {
    let translations;
    switch (lng) {
      case 'es':
        translations = await import('assets/locales/es.json');
        break;
      case 'pt':
        translations = await import('assets/locales/pt.json');
        break;
      case 'fr':
        translations = await import('assets/locales/fr.json');
        break;
      case 'de':
        translations = await import('assets/locales/de.json');
        break;
      case 'zh':
        translations = await import('assets/locales/zh.json');
        break;
      case 'ja':
        translations = await import('assets/locales/ja.json');
        break;
      case 'ko':
        translations = await import('assets/locales/ko.json');
        break;
      case 'ru':
        translations = await import('assets/locales/ru.json');
        break;
      default:
        return enTranslations;
    }

    // Cache the loaded language
    loadedLanguages[lng] = translations.default || translations;
    return loadedLanguages[lng];
  } catch (error) {
    console.error(`[i18n] Failed to load language ${lng}:`, error);
    return enTranslations;
  }
};

const determineLngFn = async (code: string): Promise<string> => {
  // Start with default locale immediately
  let language = defaultLocale;

  // Try to get stored language asynchronously (non-blocking)
  try {
    const storageLanguage = await chromeStorage
      .getItem('language')
      .then((lng) => {
        try {
          return lng ? lng : null;
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

  await i18next.use(initReactI18next).init({
    react: {
      useSuspense: false,
    },
    resources: {
      // Only bundle English by default
      en: {
        translation: enTranslations,
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

  // Load the user's language if it's not English
  if (fallbackLng !== 'en') {
    await changeLanguage(fallbackLng);
  }
};

// Function to change language and load translations if needed
export const changeLanguage = async (lng: string): Promise<void> => {
  if (!availableLanguages.includes(lng)) {
    console.warn(`[i18n] Language ${lng} not available`);
    return;
  }

  // Load language if not already loaded
  if (!i18next.hasResourceBundle(lng, 'translation')) {
    const translations = await loadLanguage(lng);
    i18next.addResourceBundle(lng, 'translation', translations, true, true);
  }

  // Change the language
  await i18next.changeLanguage(lng);

  // Save to storage
  await chromeStorage.setItem('language', lng);
};

initI18next();

export { i18next };
