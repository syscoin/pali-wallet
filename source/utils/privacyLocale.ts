import i18next, { type i18n, type ResourceLanguage } from 'i18next';
import { useEffect, useState } from 'react';

import english from 'assets/locales/en.json?privacyMessages';

const languages = ['es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'];
type LocaleLoader = (language: string) => Promise<ResourceLanguage>;

// Each import is an extension-packaged fragment, never a caller-provided URL.
const loadPrivacyLanguage: LocaleLoader = async (language) => {
  let loaded;
  switch (language) {
    case 'es':
      loaded = await import('assets/locales/es.json?privacyMessages');
      break;
    case 'pt':
      loaded = await import('assets/locales/pt.json?privacyMessages');
      break;
    case 'fr':
      loaded = await import('assets/locales/fr.json?privacyMessages');
      break;
    case 'de':
      loaded = await import('assets/locales/de.json?privacyMessages');
      break;
    case 'zh':
      loaded = await import('assets/locales/zh.json?privacyMessages');
      break;
    case 'ja':
      loaded = await import('assets/locales/ja.json?privacyMessages');
      break;
    case 'ko':
      loaded = await import('assets/locales/ko.json?privacyMessages');
      break;
    case 'ru':
      loaded = await import('assets/locales/ru.json?privacyMessages');
      break;
    default:
      return english;
  }
  return loaded.default || loaded;
};

export function createPrivacyLocaleHydrator(
  instance: i18n,
  fallback: ResourceLanguage,
  load: LocaleLoader
) {
  let englishReady = false;
  const requests = new Map<string, Promise<void>>();
  const installEnglish = () => {
    if (!instance.isInitialized) return false;
    if (!englishReady) {
      instance.addResourceBundle(
        'en',
        'translation',
        { privacy: fallback.privacy },
        true,
        true
      );
      englishReady = true;
    }
    return true;
  };
  const ensure = (selected: string): Promise<void> => {
    const language = selected.toLowerCase().split('-')[0];
    if (!installEnglish() || !languages.includes(language))
      return Promise.resolve();
    const existing = requests.get(language);
    if (existing) return existing;
    const request = load(language)
      .then((resource) => {
        if (
          !resource?.privacy ||
          typeof resource.privacy !== 'object' ||
          Array.isArray(resource.privacy)
        ) {
          throw new Error('Invalid packaged Privacy locale');
        }
        // Cache the language it belongs to; never change the selected language.
        instance.addResourceBundle(
          language,
          'translation',
          { privacy: resource.privacy },
          true,
          true
        );
      })
      .catch((error) => {
        requests.delete(language);
        throw error;
      });
    requests.set(language, request);
    return request;
  };
  return { ensure, installEnglish };
}

const hydration = createPrivacyLocaleHydrator(
  i18next,
  english,
  loadPrivacyLanguage
);
// This module is reachable only through the lazy Privacy entry.
hydration.installEnglish();

export function usePrivacyLocale(): boolean {
  const [ready, setReady] = useState(hydration.installEnglish);
  const [, redraw] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const update = () => {
      if (!hydration.installEnglish()) return;
      setReady(true);
      const current = ++generation;
      void hydration
        .ensure(i18next.resolvedLanguage || i18next.language || 'en')
        .then(() => {
          // useTranslation does not subscribe to resource additions by default.
          if (active && current === generation) redraw((value) => value + 1);
        })
        .catch(() => {
          // English is already installed. A later visit/change can retry.
        });
    };
    i18next.on('initialized', update);
    i18next.on('languageChanged', update);
    update();
    return () => {
      active = false;
      generation += 1;
      i18next.off('initialized', update);
      i18next.off('languageChanged', update);
    };
  }, []);
  return ready;
}
