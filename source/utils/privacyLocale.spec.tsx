/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { createInstance, type ResourceLanguage } from 'i18next';
import React from 'react';

import { projectLocale } from '../config/loaders/localeProjection';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';

import { createPrivacyLocaleHydrator } from './privacyLocale';

const deferred = () => {
  let resolve!: (resource: ResourceLanguage) => void;
  const promise = new Promise<ResourceLanguage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const create = async (language = 'en') => {
  const instance = createInstance();
  await instance.init({
    lng: language,
    fallbackLng: 'en',
    initImmediate: false,
    resources: {
      en: { translation: projectLocale(en, 'base') },
      es: { translation: projectLocale(es, 'base') },
      fr: { translation: projectLocale(fr, 'base') },
    },
  });
  return instance;
};

it('installs English synchronously before content, retaining the base title and interpolation', async () => {
  const instance = await create('fr');
  const loader = jest.fn().mockResolvedValue(projectLocale(fr, 'privacy'));
  const hydration = createPrivacyLocaleHydrator(
    instance,
    projectLocale(en, 'privacy'),
    loader
  );
  expect(hydration.installEnglish()).toBe(true);
  expect(instance.t('privacy.prepare')).toBe(en.privacy.prepare);
  expect(instance.t('privacy.title')).toBe(fr.privacy.title);
  expect(instance.t('privacy.noteAsOfBlock', { block: 42 })).toBe(
    'As of block 42'
  );
  await hydration.ensure('fr');
  expect(instance.t('privacy.prepare')).toBe(fr.privacy.prepare);
  expect(instance.t('privacy.title')).toBe(fr.privacy.title);
  expect(instance.language).toBe('fr');
});

it('deduplicates pending loads, caches success, and never selects a late locale', async () => {
  const instance = await create('es');
  const spanish = deferred();
  const french = deferred();
  const loader = jest.fn((language) =>
    language === 'es' ? spanish.promise : french.promise
  );
  const hydration = createPrivacyLocaleHydrator(
    instance,
    projectLocale(en, 'privacy'),
    loader
  );
  const first = hydration.ensure('es');
  expect(hydration.ensure('es')).toBe(first);
  await instance.changeLanguage('fr');
  const second = hydration.ensure('fr');
  french.resolve(projectLocale(fr, 'privacy'));
  await second;
  spanish.resolve(projectLocale(es, 'privacy'));
  await first;
  expect(instance.language).toBe('fr');
  expect(instance.t('privacy.prepare')).toBe(fr.privacy.prepare);
  await hydration.ensure('es');
  expect(loader).toHaveBeenCalledTimes(2);
  expect(instance.getResource('es', 'translation', 'privacy.prepare')).toBe(
    es.privacy.prepare
  );
});

it('retains English fallback after a chunk failure and permits a later retry', async () => {
  const instance = await create('fr');
  const loader = jest
    .fn()
    .mockRejectedValueOnce(new Error('Chunk unavailable'))
    .mockResolvedValueOnce(projectLocale(fr, 'privacy'));
  const hydration = createPrivacyLocaleHydrator(
    instance,
    projectLocale(en, 'privacy'),
    loader
  );
  await expect(hydration.ensure('fr')).rejects.toThrow('Chunk unavailable');
  expect(instance.t('privacy.prepare')).toBe(en.privacy.prepare);
  expect(instance.t('buttons.cancel')).toBe(fr.buttons.cancel);
  await hydration.ensure('fr');
  expect(instance.t('privacy.prepare')).toBe(fr.privacy.prepare);
});

it('waits for initialization and never loads an unsupported locale', async () => {
  const instance = createInstance();
  const loader = jest.fn();
  const hydration = createPrivacyLocaleHydrator(
    instance,
    projectLocale(en, 'privacy'),
    loader
  );
  expect(hydration.installEnglish()).toBe(false);
  await instance.init({
    lng: 'en',
    fallbackLng: 'en',
    initImmediate: false,
    resources: { en: { translation: projectLocale(en, 'base') } },
  });
  expect(hydration.installEnglish()).toBe(true);
  await hydration.ensure('en');
  await hydration.ensure('unknown');
  expect(loader).not.toHaveBeenCalled();
  expect(instance.t('privacy.prepare')).toBe(en.privacy.prepare);
});

it('updates mounted content when language fragments arrive and removes its listeners on unmount', async () => {
  const instance = await create();
  const off = jest.spyOn(instance, 'off');
  jest.doMock('i18next', () => ({ __esModule: true, default: instance }));
  jest.doMock('react', () => React);
  let usePrivacyLocale!: typeof import('./privacyLocale').usePrivacyLocale;
  try {
    jest.isolateModules(() => {
      ({ usePrivacyLocale } = require('./privacyLocale'));
    });
    const Probe = () => {
      const ready = usePrivacyLocale();
      return <div>{ready ? instance.t('privacy.prepare') : 'loading'}</div>;
    };
    const view = render(<Probe />);
    expect(screen.getByText(en.privacy.prepare)).toBeVisible();
    await act(async () => {
      await instance.changeLanguage('es');
    });
    expect(await screen.findByText(es.privacy.prepare)).toBeVisible();
    await act(async () => {
      await instance.changeLanguage('fr');
    });
    expect(await screen.findByText(fr.privacy.prepare)).toBeVisible();
    view.unmount();
    expect(off).toHaveBeenCalledWith('languageChanged', expect.any(Function));
    expect(off).toHaveBeenCalledWith('initialized', expect.any(Function));
  } finally {
    jest.dontMock('i18next');
    jest.dontMock('react');
  }
});
