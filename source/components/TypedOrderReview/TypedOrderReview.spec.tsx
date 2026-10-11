/** @jest-environment jsdom */

import { render, screen, within } from '@testing-library/react';
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

import { TypedOrderReview } from './TypedOrderReview';

const locales = [
  { language: 'en', translations: enTranslations },
  { language: 'es', translations: esTranslations },
  { language: 'pt', translations: ptTranslations },
  { language: 'fr', translations: frTranslations },
  { language: 'de', translations: deTranslations },
  { language: 'zh', translations: zhTranslations },
  { language: 'ja', translations: jaTranslations },
  { language: 'ko', translations: koTranslations },
  { language: 'ru', translations: ruTranslations },
];

const translate = async (language: string, translations: any) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: false,
    resources: { [language]: { translation: translations } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return i18n;
};

it.each(locales)(
  'renders advisory terms, gift caveats and verification limits in $language',
  async ({ language, translations }) => {
    const i18n = await translate(language, translations);
    render(
      <I18nextProvider i18n={i18n}>
        <TypedOrderReview
          review={{
            protocol: 'Seaport',
            status: 'recognized',
            warnings: ['send.nftOrderZeroPayment', 'send.nftOrderNoReturn'],
          }}
        />
      </I18nextProvider>
    );

    const title = translations.send.nftOrderReviewTitle.replace(
      '{{protocol}}',
      'Seaport'
    );
    const review = screen.getByRole('region', { name: title });
    expect(within(review).getByRole('heading', { name: title })).toBeTruthy();
    for (const key of [
      'nftOrderWarningTitle',
      'nftOrderZeroPayment',
      'nftOrderNoReturn',
      'nftOrderAuthorization',
      'nftOrderReviewLimit',
    ] as const) {
      expect(within(review).getByText(translations.send[key])).toBeTruthy();
    }
    expect(
      within(review).queryByText(translations.send.nftOrderUnrecognized)
    ).toBeNull();
    expect(review.textContent).not.toMatch(/send\.|\{\{protocol\}\}/);
    expect(within(review).queryByRole('button')).toBeNull();
  }
);

it.each(locales)(
  'does not imply recognized transfer semantics for unsupported schemas in $language',
  async ({ language, translations }) => {
    const i18n = await translate(language, translations);
    render(
      <I18nextProvider i18n={i18n}>
        <TypedOrderReview
          review={{
            protocol: '0x',
            status: 'unrecognized',
            warnings: ['send.nftOrderZeroPayment'],
          }}
        />
      </I18nextProvider>
    );

    expect(
      screen.getByText(translations.send.nftOrderUnrecognized)
    ).toBeTruthy();
    expect(
      screen.getByText(translations.send.nftOrderReviewLimit)
    ).toBeTruthy();
    expect(
      screen.queryByText(translations.send.nftOrderAuthorization)
    ).toBeNull();
    expect(
      screen.queryByText(translations.send.nftOrderWarningTitle)
    ).toBeNull();
    expect(
      screen.queryByText(translations.send.nftOrderZeroPayment)
    ).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  }
);

it('provides no safety verdict when an order has no supported warning', async () => {
  const i18n = await translate('en', enTranslations);
  render(
    <I18nextProvider i18n={i18n}>
      <TypedOrderReview
        review={{ protocol: '0x', status: 'recognized', warnings: [] }}
      />
    </I18nextProvider>
  );

  expect(
    screen.getByText(enTranslations.send.nftOrderAuthorization)
  ).toBeTruthy();
  expect(
    screen.getByText(enTranslations.send.nftOrderReviewLimit)
  ).toBeTruthy();
  expect(
    screen.queryByText(enTranslations.send.nftOrderWarningTitle)
  ).toBeNull();
  expect(document.body.textContent).not.toMatch(/\bsafe\b|malicious|scam/i);
});
