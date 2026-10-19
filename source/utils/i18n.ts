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
let languageSelectionGeneration = 0;
let languageCommit = Promise.resolve();

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
  const initialSelectionGeneration = languageSelectionGeneration;
  // Register a ready instance before the first await. Rendering useTranslation
  // without one changes its hook order when language storage later responds.
  await i18next.use(initReactI18next).init({
    initImmediate: false,
    lng: defaultLocale,
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
    fallbackLng: defaultLocale,
    fallbackNS: 'translation',
    keySeparator: '.',
    interpolation: { escapeValue: true },
    saveMissing: true,
    saveMissingTo: 'all',
    missingKeyHandler: (lng, ns, key) => {
      console.warn(`Missing translation key: ${key} for language: ${lng}`);
    },
  });

  // Restore supported preferences asynchronously; English remains available
  // while storage and any lazy translation chunk are loading.
  const storedLocale = await determineLngFn('');
  if (
    languageSelectionGeneration === initialSelectionGeneration &&
    storedLocale !== defaultLocale &&
    availableLanguages.includes(storedLocale)
  ) {
    await applyLanguage(storedLocale, false);
  }
};

// Function to change language and load translations if needed
const applyLanguage = async (
  lng: string,
  savePreference: boolean
): Promise<void> => {
  if (!availableLanguages.includes(lng)) {
    console.warn(`[i18n] Language ${lng} not available`);
    return;
  }
  // A late startup read must not replace a preference chosen after first paint.
  const selectionGeneration = ++languageSelectionGeneration;

  // Load language if not already loaded
  if (!i18next.hasResourceBundle(lng, 'translation')) {
    const translations = await loadLanguage(lng);
    if (selectionGeneration !== languageSelectionGeneration) return;
    i18next.addResourceBundle(lng, 'translation', translations, true, true);
  }

  const commit = languageCommit.then(async () => {
    if (selectionGeneration !== languageSelectionGeneration) return;
    // Startup only restores its snapshot. Explicit choices become visible
    // after storage accepts them, so a failed Save leaves the prior language.
    if (savePreference) {
      try {
        await chromeStorage.setItem('language', lng);
      } catch (error) {
        if (selectionGeneration !== languageSelectionGeneration) return;
        throw error;
      }
    }
    // Commits are serialized: an already-written choice remains the fallback
    // if a newer queued Save fails, without a late write undoing its successor.
    await i18next.changeLanguage(lng);
  });
  languageCommit = commit.catch(() => undefined);
  await commit;
};

export const changeLanguage = (lng: string): Promise<void> =>
  applyLanguage(lng, true);

void initI18next().catch((error) => {
  console.error('[i18n] Failed to initialize translations:', error);
});

export { i18next };
