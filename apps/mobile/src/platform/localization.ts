import { createInstance, type ResourceLanguage } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import english from '../../../../source/assets/locales/en.json';
import { DEFAULT_PALI_LANGUAGE, PALI_LANGUAGE_OPTIONS, type PaliLanguage } from '../../../../source/shared/languagePolicy.ts';
import { createLanguagePreferences } from '../core/languagePreferences.ts';

export const nativeI18n = createInstance();
const initialized = nativeI18n.use(initReactI18next).init({
  initImmediate: false,
  lng: DEFAULT_PALI_LANGUAGE,
  supportedLngs: PALI_LANGUAGE_OPTIONS.map((language) => language.value),
  fallbackLng: DEFAULT_PALI_LANGUAGE,
  load: 'languageOnly', lowerCaseLng: true,
  resources: { en: { translation: english } },
  react: { useSuspense: false },
  // Native text is not HTML. React renders interpolation as text already.
  interpolation: { escapeValue: false },
});

/** The same packaged dictionaries used by extension; no runtime translation service. */
export async function loadNativeLanguage(language: PaliLanguage): Promise<ResourceLanguage> {
  switch (language) {
    case 'en': return english;
    case 'es': return (await import('../../../../source/assets/locales/es.json')).default;
    case 'pt': return (await import('../../../../source/assets/locales/pt.json')).default;
    case 'fr': return (await import('../../../../source/assets/locales/fr.json')).default;
    case 'de': return (await import('../../../../source/assets/locales/de.json')).default;
    case 'zh': return (await import('../../../../source/assets/locales/zh.json')).default;
    case 'ja': return (await import('../../../../source/assets/locales/ja.json')).default;
    case 'ko': return (await import('../../../../source/assets/locales/ko.json')).default;
    case 'ru': return (await import('../../../../source/assets/locales/ru.json')).default;
  }
}

const key = 'pali.mobile.language';
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'org.pali.mobile.language', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const native = Platform.OS === 'ios' || Platform.OS === 'android';
let memory: string | null = null;
export const nativeLanguagePreferences = createLanguagePreferences({
  storage: {
    async get() {
      if (!native) return memory;
      if (!await SecureStore.isAvailableAsync()) throw new Error();
      return SecureStore.getItemAsync(key, options);
    },
    async set(value) {
      if (!native) { memory = value; return; }
      if (!await SecureStore.isAvailableAsync()) throw new Error();
      await SecureStore.setItemAsync(key, value, options);
    },
  },
  engine: nativeI18n, load: loadNativeLanguage,
});
let restore: Promise<unknown> | undefined;
/** English is ready synchronously; the protected saved preference restores after startup. */
export function initializeNativeLanguage() {
  restore ??= initialized.then(() => nativeLanguagePreferences.load()).catch(() => undefined);
  return restore;
}
export const useNativeTranslation = () => useTranslation('translation', { i18n: nativeI18n, useSuspense: false });
