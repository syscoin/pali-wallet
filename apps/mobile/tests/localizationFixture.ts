import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createInstance } from 'i18next';

export const languageMessages = (language: string) => JSON.parse(readFileSync(
  new NodeURL(`../../../source/assets/locales/${language}.json`, import.meta.url), 'utf8'
));
export const englishI18n = createInstance();
await englishI18n.init({ initImmediate: false, lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: languageMessages('en') } }, interpolation: { escapeValue: false } });
/** VM component hosts keep their React fixture; translations use the real engine. */
export const nativeTranslationFixture = {
  useNativeTranslation: () => ({ t: englishI18n.t.bind(englishI18n), i18n: englishI18n }),
};
