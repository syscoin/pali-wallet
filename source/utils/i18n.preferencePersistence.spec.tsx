/** @jest-environment jsdom */

import { waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import * as reactI18next from 'react-i18next';

import esTranslations from 'assets/locales/es.json';
import frTranslations from 'assets/locales/fr.json';

const loadDocument = () => {
  const instance = createInstance();
  jest.doMock('i18next', () => ({ __esModule: true, default: instance }));
  jest.doMock('react-i18next', () => reactI18next);
  let changeLanguage!: typeof import('./i18n').changeLanguage;
  jest.isolateModules(() => {
    ({ changeLanguage } = require('./i18n'));
  });
  return { instance, changeLanguage };
};

describe('language preference ownership across extension documents', () => {
  const originalChrome = global.chrome;
  const originalI18n = reactI18next.getI18n();
  let stored: string;
  let holdNextRead: boolean;
  let releaseRead: (() => void) | undefined;

  beforeEach(() => {
    stored = 'es';
    holdNextRead = false;
    releaseRead = undefined;
    global.chrome = {
      ...originalChrome,
      storage: {
        ...originalChrome.storage,
        local: {
          get: jest.fn((_keys, callback) => {
            const snapshot = { language: stored };
            if (holdNextRead) {
              holdNextRead = false;
              releaseRead = () => callback(snapshot);
            } else callback(snapshot);
          }),
          set: jest.fn((items, callback) => {
            stored = items.language;
            callback();
          }),
        },
      },
    } as any;
  });

  afterEach(() => {
    global.chrome = originalChrome;
    reactI18next.setI18n(originalI18n);
    jest.dontMock('i18next');
    jest.dontMock('react-i18next');
  });

  it('restores the stored language and durably saves an explicit new choice', async () => {
    const document = loadDocument();
    await waitFor(() => expect(document.instance.language).toBe('es'));
    expect(document.instance.t('buttons.next')).toBe(
      esTranslations.buttons.next
    );
    expect(stored).toBe('es');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    await document.changeLanguage('fr');
    expect(document.instance.language).toBe('fr');
    expect(document.instance.t('buttons.next')).toBe(
      frTranslations.buttons.next
    );
    expect(stored).toBe('fr');
  });

  it('does not persist an unsupported explicit language', async () => {
    const document = loadDocument();
    await waitFor(() => expect(document.instance.language).toBe('es'));
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    try {
      await document.changeLanguage('unsupported-locale');
      expect(stored).toBe('es');
      expect(document.instance.language).toBe('es');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it('does not let a delayed startup in another document overwrite a newer saved choice', async () => {
    const activeDocument = loadDocument();
    await waitFor(() => expect(activeDocument.instance.language).toBe('es'));
    holdNextRead = true;
    const openingDocument = loadDocument();
    await waitFor(() => expect(releaseRead).toBeDefined());

    await activeDocument.changeLanguage('fr');
    expect(stored).toBe('fr');
    releaseRead!();
    await waitFor(() => expect(openingDocument.instance.language).toBe('es'));

    // Each document owns its runtime translations. A stale startup may still
    // render its old snapshot, but it must not undo another document's Save.
    expect(activeDocument.instance.t('buttons.next')).toBe(
      frTranslations.buttons.next
    );
    expect(openingDocument.instance.t('buttons.next')).toBe(
      esTranslations.buttons.next
    );
    expect(stored).toBe('fr');
  });
});
