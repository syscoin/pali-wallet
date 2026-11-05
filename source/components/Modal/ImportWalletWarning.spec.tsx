/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';

import deTranslations from 'assets/locales/de.json';
import enTranslations from 'assets/locales/en.json';
import esTranslations from 'assets/locales/es.json';
import frTranslations from 'assets/locales/fr.json';
import jaTranslations from 'assets/locales/ja.json';
import koTranslations from 'assets/locales/ko.json';
import ptTranslations from 'assets/locales/pt.json';
import ruTranslations from 'assets/locales/ru.json';
import zhTranslations from 'assets/locales/zh.json';
import { Start } from 'pages/Start/Start';

const mockEmitter = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { hasEncryptedVault: true } }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: 'synthetic-only-existing-account' }),
}));
jest.mock('components/Start/GetStarted', () => () => null);
jest.mock('components/Start/Unlock', () => {
  const MockUnlock = (props: any) => (
    <button onClick={() => props.setIsOpenValidation(true)}>
      Open recovery warning
    </button>
  );
  return MockUnlock;
});
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, isUnlocked: false }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  useOnboardingSecrets: () => ({ beginRecovery: jest.fn() }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: ({ children, show }: any) =>
    show ? <section role="dialog">{children}</section> : null,
  SheetPanel: ({ children }: any) => <>{children}</>,
  SheetHeader: ({ title }: any) => <h1>{title}</h1>,
  DialogHeader: ({ title }: any) => <h1>{title}</h1>,
  DialogBody: ({ children }: any) => <>{children}</>,
  DialogFooter: ({ children }: any) => <>{children}</>,
  DialogActions: ({ children }: any) => <>{children}</>,
  DialogActionButton: ({ children, loading, tone, ...props }: any) => (
    <button
      {...props}
      data-tone={tone}
      disabled={Boolean(props.disabled || loading)}
      aria-busy={loading}
    >
      {children}
    </button>
  ),
}));

const locales = [
  { language: 'en', translations: enTranslations },
  { language: 'es', translations: esTranslations },
  { language: 'fr', translations: frTranslations },
  { language: 'de', translations: deTranslations },
  { language: 'pt', translations: ptTranslations },
  { language: 'ru', translations: ruTranslations },
  { language: 'zh', translations: zhTranslations },
  { language: 'ja', translations: jaTranslations },
  { language: 'ko', translations: koTranslations },
];

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

it.each(locales)(
  'shows local preservation and separate-backup guidance before recovery in $language',
  async ({ language, translations }) => {
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
        <BrowserRouter>
          <Start />
        </BrowserRouter>
      </I18nextProvider>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open recovery warning' })
    );
    const dialog = screen.getByRole('dialog');
    const warning = within(dialog);
    expect(
      warning.getByRole('heading', {
        name: translations.settings.recoveryTitle,
      })
    ).toBeTruthy();
    expect(
      warning.getByRole('button', { name: translations.buttons.recoverWallet })
    ).toBeTruthy();
    expect(
      warning.getByRole('button', { name: translations.buttons.cancel })
    ).toBeTruthy();
    const paragraphs = Array.from(dialog.querySelectorAll('p')).map(
      (p) => p.textContent || ''
    );
    expect(paragraphs).toEqual([
      translations.settings.recoveryIntro,
      translations.settings.recoverySeedHelp,
      translations.settings.recoveryLimitations,
    ]);
    const observed = paragraphs.join(' ');
    if (language === 'en') {
      expect(observed).toContain(
        'Your saved accounts and settings stay on this device.'
      );
      expect(observed).toContain(
        'Keep separate backups of imported keys and notes for a new or lost device.'
      );
      expect(observed).toContain('Recovery does not move funds.');
      expect(observed).not.toContain('deletes saved private notes');
    }
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);
