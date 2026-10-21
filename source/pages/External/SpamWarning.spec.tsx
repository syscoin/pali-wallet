/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
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
const mockSpamConfig: { blockDurationMs?: number } = {
  blockDurationMs: 60_000,
};
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
  return i18n;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSpamConfig.blockDurationMs = 60_000;
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

const durationTexts: Record<string, [string, string, string]> = {
  en: ['1 minute', '2 minutes', '30 seconds'],
  es: ['1 minuto', '2 minutos', '30 segundos'],
  pt: ['1 minuto', '2 minutos', '30 segundos'],
  fr: ['1 minute', '2 minutes', '30\u00a0secondes'],
  de: ['1 Minute', '2 Minuten', '30 Sekunden'],
  zh: ['1分钟', '2分钟', '30秒钟'],
  ja: ['1 分', '2 分', '30 秒'],
  ko: ['1분', '2분', '30초'],
  ru: ['1 минута', '2 минуты', '30 секунд'],
};

it.each(
  locales.flatMap(({ language, translations }) =>
    [60_000, 120_000, 30_000].map((duration, index) => ({
      language,
      translations,
      duration,
      text: durationTexts[language][index],
    }))
  )
)(
  'localizes the duration $duration in $language',
  async ({ language, translations, duration, text }) => {
    mockSpamConfig.blockDurationMs = duration;
    await renderWarning(language, translations);
    const expected = translations.spamWarning.blockDuration.replace(
      '{{duration}}',
      text
    );
    expect(
      screen.getByText(expected, { normalizer: (value) => value })
    ).toBeTruthy();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it.each([undefined, 0])(
  'retains the one-minute default for duration %s',
  async (duration) => {
    mockSpamConfig.blockDurationMs = duration;
    await renderWarning('en', enTranslations);
    expect(screen.getByText('Block duration: 1 minute')).toBeTruthy();
  }
);

it('retains singular seconds and the existing whole-minute rounding', async () => {
  mockSpamConfig.blockDurationMs = 1_000;
  const i18n = await renderWarning('en', enTranslations);
  expect(screen.getByText('Block duration: 1 second')).toBeTruthy();
  mockSpamConfig.blockDurationMs = 61_000;
  await act(async () => i18n.changeLanguage('en'));
  expect(screen.getByText('Block duration: 1 minute')).toBeTruthy();
});

it('updates the duration when the mounted warning changes language', async () => {
  const i18n = await renderWarning('en', enTranslations);
  expect(screen.getByText('Block duration: 1 minute')).toBeTruthy();
  i18n.addResourceBundle('es', 'translation', esTranslations);
  await act(async () => i18n.changeLanguage('es'));
  expect(screen.getByText('Duración del bloqueo: 1 minuto')).toBeTruthy();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

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
