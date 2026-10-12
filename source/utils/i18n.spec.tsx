/** @jest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createInstance } from 'i18next';
import React, { useEffect, useState } from 'react';
import * as reactI18next from 'react-i18next';

import enTranslations from 'assets/locales/en.json';
import esTranslations from 'assets/locales/es.json';
import { chromeStorage } from 'utils/storageAPI';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

// Keep the real translation hook and React instance across isolated imports.
// Mocking useTranslation itself would conceal the missing-instance hook race.
const loadTranslations = () => {
  const instance = createInstance();
  reactI18next.setI18n(undefined as any);
  jest.doMock('i18next', () => ({ __esModule: true, default: instance }));
  jest.doMock('react-i18next', () => reactI18next);
  let changeLanguage!: typeof import('./i18n').changeLanguage;
  jest.isolateModules(() => {
    ({ changeLanguage } = require('./i18n'));
  });
  return { instance, changeLanguage };
};

// Translation hooks precede state/effect hooks in WalletBootstrap. Exercise
// that ordering through real rerenders while language storage is delayed.
const BootstrapTranslationProbe = () => {
  const { t } = reactI18next.useTranslation();
  const [renders, setRenders] = useState(0);
  const [status] = useState('loading');
  const [slow] = useState(false);
  const [recovery] = useState(false);
  useEffect(() => undefined, [renders, status, slow, recovery]);
  return (
    <button
      type="button"
      data-testid="translation-probe"
      data-renders={renders}
      onClick={() => setRenders((value) => value + 1)}
    >
      {t('buttons.next')}
    </button>
  );
};

describe('synchronous translation registration before wallet rendering', () => {
  let resolveLanguage: (language: unknown) => void;
  let rejectLanguage: (error: Error) => void;
  let errorLog: jest.SpyInstance;
  let warningLog: jest.SpyInstance;

  beforeEach(() => {
    jest
      .mocked(chromeStorage.getItem)
      .mockReset()
      .mockReturnValue(
        new Promise((resolve, reject) => {
          resolveLanguage = resolve;
          rejectLanguage = reject;
        })
      );
    jest.mocked(chromeStorage.setItem).mockReset().mockResolvedValue(undefined);
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warningLog = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    reactI18next.setI18n(undefined as any);
    errorLog.mockRestore();
    warningLog.mockRestore();
    jest.dontMock('i18next');
    jest.dontMock('react-i18next');
    jest.dontMock('assets/locales/de.json');
  });

  it('keeps real hooks stable across delayed storage, early rerenders and lazy locale restoration', async () => {
    const { instance } = loadTranslations();
    render(<BootstrapTranslationProbe />);
    const probe = screen.getByTestId('translation-probe');
    fireEvent.click(probe);
    const initialTranslation = probe.textContent;
    const initialInstance = reactI18next.getI18n();

    await act(async () => resolveLanguage('es'));
    await waitFor(() => expect(instance.language).toBe('es'));
    fireEvent.click(probe);

    expect(initialTranslation).toBe(enTranslations.buttons.next);
    expect(initialInstance).toBe(instance);
    expect(reactI18next.getI18n()).toBe(instance);
    expect(probe.textContent).toBe(esTranslations.buttons.next);
    expect(probe.getAttribute('data-renders')).toBe('2');
    expect(instance.hasResourceBundle('es', 'translation')).toBe(true);
    expect(chromeStorage.getItem).toHaveBeenCalledWith('language');
    expect(chromeStorage.setItem).toHaveBeenCalledWith('language', 'es');
    expect(instance.options.interpolation?.escapeValue).toBe(true);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
  });

  it('keeps bundled English and stable hooks when language storage cannot be read', async () => {
    const { instance } = loadTranslations();
    render(<BootstrapTranslationProbe />);
    await act(async () => rejectLanguage(new Error('Storage unavailable')));
    await waitFor(() => expect(warningLog).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('translation-probe'));

    expect(instance.language).toBe('en');
    expect(screen.getByTestId('translation-probe').textContent).toBe(
      enTranslations.buttons.next
    );
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('retains English without rewriting an unsupported stored locale', async () => {
    const { instance } = loadTranslations();
    render(<BootstrapTranslationProbe />);
    await act(async () => resolveLanguage('unsupported-locale'));
    fireEvent.click(screen.getByTestId('translation-probe'));

    expect(instance.language).toBe('en');
    expect(screen.getByTestId('translation-probe').textContent).toBe(
      enTranslations.buttons.next
    );
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('handles rejected locale persistence without breaking rendered translations', async () => {
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValue(new Error('Storage write unavailable'));
    const { instance } = loadTranslations();
    render(<BootstrapTranslationProbe />);
    await act(async () => resolveLanguage('es'));
    await waitFor(() =>
      expect(errorLog).toHaveBeenCalledWith(
        '[i18n] Failed to initialize translations:',
        expect.objectContaining({ message: 'Storage write unavailable' })
      )
    );
    fireEvent.click(screen.getByTestId('translation-probe'));

    expect(instance.language).toBe('es');
    expect(screen.getByTestId('translation-probe').textContent).toBe(
      esTranslations.buttons.next
    );
    expect(reactI18next.getI18n()).toBe(instance);
  });

  it('retains a newer explicit locale choice when the initial storage read completes late', async () => {
    const { instance, changeLanguage } = loadTranslations();
    render(<BootstrapTranslationProbe />);
    await act(async () => changeLanguage('es'));
    expect(instance.language).toBe('es');

    await act(async () => resolveLanguage('de'));
    fireEvent.click(screen.getByTestId('translation-probe'));

    expect(instance.language).toBe('es');
    expect(screen.getByTestId('translation-probe').textContent).toBe(
      esTranslations.buttons.next
    );
    expect(jest.mocked(chromeStorage.setItem).mock.calls).toEqual([
      ['language', 'es'],
    ]);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
  });

  it('discards a delayed stored-locale resource load after a newer explicit choice', async () => {
    let finishGermanResources!: (resources: unknown) => void;
    const resourceLoadStarted = jest.fn();
    // The lazy loader's resource result adopts this pending promise, modelling
    // the German chunk arriving after the user has chosen Spanish.
    const germanResources = new Promise((resolve) => {
      finishGermanResources = resolve;
    });
    jest.doMock('assets/locales/de.json', () => {
      resourceLoadStarted();
      return { __esModule: true, default: germanResources };
    });
    const { instance, changeLanguage } = loadTranslations();
    render(<BootstrapTranslationProbe />);
    await act(async () => resolveLanguage('de'));
    await waitFor(() => expect(resourceLoadStarted).toHaveBeenCalled());
    expect(instance.language).toBe('en');

    await act(async () => changeLanguage('es'));
    await act(async () =>
      finishGermanResources(jest.requireActual('assets/locales/de.json'))
    );
    fireEvent.click(screen.getByTestId('translation-probe'));

    expect(instance.language).toBe('es');
    expect(screen.getByTestId('translation-probe').textContent).toBe(
      esTranslations.buttons.next
    );
    expect(instance.hasResourceBundle('de', 'translation')).toBe(false);
    expect(jest.mocked(chromeStorage.setItem).mock.calls).toEqual([
      ['language', 'es'],
    ]);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
  });

  it('does not persist an older choice superseded while its language-change promise settles', async () => {
    const { instance, changeLanguage } = loadTranslations();
    instance.addResourceBundle(
      'de',
      'translation',
      jest.requireActual('assets/locales/de.json')
    );
    render(<BootstrapTranslationProbe />);
    await act(async () => {
      const germanSelection = changeLanguage('de');
      const spanishSelection = changeLanguage('es');
      await Promise.all([germanSelection, spanishSelection]);
    });

    expect(instance.language).toBe('es');
    expect(screen.getByTestId('translation-probe').textContent).toBe(
      esTranslations.buttons.next
    );
    expect(jest.mocked(chromeStorage.setItem).mock.calls).toEqual([
      ['language', 'es'],
    ]);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
  });
});
