import i18n from 'i18next';

import english from './locales/en.json';

const i18next = i18n.createInstance();
const locales = {
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  pt: () => import('./locales/pt.json'),
  ru: () => import('./locales/ru.json'),
  zh: () => import('./locales/zh.json'),
};

// This separate page needs only its own messages, not the wallet UI or React.
void i18next
  .init({
    initImmediate: false,
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: english } },
    interpolation: { escapeValue: true },
  })
  .then(async () => {
    const { language } = await chrome.storage.local.get('language');
    if (
      typeof language !== 'string' ||
      !Object.prototype.hasOwnProperty.call(locales, language)
    )
      return;
    const resource = await locales[language as keyof typeof locales]();
    i18next.addResourceBundle(language, 'translation', resource.default);
    await i18next.changeLanguage(language);
  })
  .catch(() => undefined); // English remains available if preference loading fails.

export { i18next };
