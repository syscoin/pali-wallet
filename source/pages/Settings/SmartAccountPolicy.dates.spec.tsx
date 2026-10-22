/** @jest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';

const locales = { de, en, es, fr, ja, ko, pt, ru, zh };
const keys = [
  'smartAccountGuardianRecoveryReadyAt',
  'smartAccountGuardianExpiresAt',
  'smartAccountGuardianObservedAt',
] as const;

const RecoveryDates = ({ time }: { time: string }) => {
  const { t } = useTranslation();
  return (
    <>
      {keys.map((key) => (
        <p key={key} data-testid={key}>
          {t(`settings.${key}`, { time })}
        </p>
      ))}
    </>
  );
};

const renderDates = async (language: keyof typeof locales, time: string) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: false,
    resources: { [language]: { translation: locales[language] } },
    // Match production: only these trusted React text interpolations opt out.
    interpolation: { escapeValue: true },
    react: { useSuspense: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <RecoveryDates time={time} />
    </I18nextProvider>
  );
};

afterEach(cleanup);

it.each(Object.keys(locales) as (keyof typeof locales)[])(
  'renders recovery dates without literal HTML entities in %s',
  async (language) => {
    const time = '10/22/2026, 2:15:00 PM';
    await renderDates(language, time);
    for (const key of keys) {
      expect(screen.getByTestId(key).textContent).toContain(time);
      expect(screen.getByTestId(key).textContent).not.toMatch(/&#x2f;/i);
    }
  }
);

it('keeps interpolated values as React text, never parsed HTML', async () => {
  const time = '<img src=x onerror=alert(1)> & 10/22/2026';
  const { container } = await renderDates('en', time);
  for (const key of keys) {
    expect(screen.getByTestId(key).textContent).toContain(time);
  }
  expect(container.querySelector('img')).toBeNull();
});
