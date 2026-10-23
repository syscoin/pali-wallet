/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { PqOperationStatus } from 'components/Loading/PqOperationStatus';

import { AppLoadingSkeleton } from './AppLoadingSkeleton';

jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
const locales = Object.keys(resources) as Array<keyof typeof resources>;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each(locales)(
  'keeps the existing loading/recovery timing and uses the current %s copy',
  async (locale) => {
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, translation]) => [
          language,
          { translation },
        ])
      ),
    });
    render(
      <I18nextProvider i18n={instance}>
        <AppLoadingSkeleton />
        <PqOperationStatus
          show
          title="Synthetic local operation"
          expectedSeconds={120}
          warningSeconds={30}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      resources[locale].components.loadingWalletView
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText(
        instance.t('send.pqSigningExpected', { duration: '2m 00s' }),
        { exact: false }
      )
    ).toBeVisible();
    act(() => jest.advanceTimersByTime(1800));
    expect(screen.getByRole('status')).toHaveTextContent(
      resources[locale].components.walletViewLoadingSlow
    );
    expect(
      screen.getByRole('button', {
        name: resources[locale].components.reloadWallet,
      })
    ).toHaveAttribute('type', 'button');
    act(() => jest.advanceTimersByTime(30000));
    expect(
      screen.getByText(resources[locale].send.pqSigningWorking, {
        exact: false,
      })
    ).toBeVisible();
    expect(instance.language).toBe(locale);
  }
);
