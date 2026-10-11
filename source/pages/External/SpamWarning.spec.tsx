/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import deTranslations from 'assets/locales/de.json';
import enTranslations from 'assets/locales/en.json';
import esTranslations from 'assets/locales/es.json';
import frTranslations from 'assets/locales/fr.json';
import jaTranslations from 'assets/locales/ja.json';
import koTranslations from 'assets/locales/ko.json';
import ptTranslations from 'assets/locales/pt.json';
import ruTranslations from 'assets/locales/ru.json';
import zhTranslations from 'assets/locales/zh.json';
import { dispatchBackgroundEvent } from 'utils/browser';

import { SpamWarning } from './SpamWarning';

const mockPopupData = {
  eventName: 'spamWarningResponse',
  host: 'https://test-dapp.example',
  requestCount: 3,
};
const mockSpamConfig = { blockDurationMs: 60_000 };
const mockNavigate = jest.fn();

jest.mock('hooks/index', () => ({
  useQueryData: () => mockPopupData,
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ spamFilter: { config: mockSpamConfig } }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));

const locales = [
  { language: 'en', translations: enTranslations, continueLabel: 'Continue' },
  { language: 'es', translations: esTranslations, continueLabel: 'Continuar' },
  { language: 'pt', translations: ptTranslations, continueLabel: 'Continuar' },
  { language: 'fr', translations: frTranslations, continueLabel: 'Continuer' },
  { language: 'de', translations: deTranslations, continueLabel: 'Weiter' },
  { language: 'zh', translations: zhTranslations, continueLabel: '继续' },
  { language: 'ja', translations: jaTranslations, continueLabel: '続行' },
  { language: 'ko', translations: koTranslations, continueLabel: '계속' },
  { language: 'ru', translations: ruTranslations, continueLabel: 'Продолжить' },
];

const renderWarning = async (
  language: string,
  translations: typeof enTranslations
) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: false,
    resources: { [language]: { translation: translations } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <SpamWarning />
    </I18nextProvider>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(locales)(
  'labels continuation explicitly and sends allow before closing in $language',
  async ({ language, translations, continueLabel }) => {
    await renderWarning(language, translations);
    expect(translations.buttons.continue).toBe(continueLabel);
    expect(
      screen.queryByRole('button', { name: translations.buttons.cancel })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: continueLabel }));

    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      `${mockPopupData.eventName}.${mockPopupData.host}`,
      { action: 'allow' }
    );
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(dispatchBackgroundEvent).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(window.close).mock.invocationCallOrder[0]);
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it.each(locales)(
  'sends the temporary block choice before closing in $language',
  async ({ language, translations }) => {
    await renderWarning(language, translations);
    fireEvent.click(
      screen.getByRole('button', {
        name: translations.spamWarning.blockTemporarily,
      })
    );

    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      `${mockPopupData.eventName}.${mockPopupData.host}`,
      { action: 'block' }
    );
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(dispatchBackgroundEvent).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(window.close).mock.invocationCallOrder[0]);
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);
