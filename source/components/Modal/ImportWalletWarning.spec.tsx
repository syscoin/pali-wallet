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
  {
    language: 'en',
    translations: enTranslations,
    consequences: [
      'only the first seed-derived (HD) account',
      'deletes saved private notes and locally encrypted imported private keys',
      'Without separate key backups, you may permanently lose access',
    ],
  },
  {
    language: 'es',
    translations: esTranslations,
    consequences: [
      'solo la primera cuenta derivada de la semilla (HD)',
      'elimina las notas privadas guardadas y las claves privadas importadas cifradas localmente',
      'Sin copias separadas de esas claves, puedes perder para siempre el acceso',
    ],
  },
  {
    language: 'fr',
    translations: frTranslations,
    consequences: [
      'uniquement le premier compte dérivé de la phrase (HD)',
      'supprime les notes privées enregistrées et les clés privées importées chiffrées localement',
      'Sans sauvegarde séparée de ces clés, vous risquez de perdre définitivement l’accès',
    ],
  },
  {
    language: 'pt',
    translations: ptTranslations,
    consequences: [
      'apenas a primeira conta derivada da seed (HD)',
      'exclui notas privadas salvas e chaves privadas importadas criptografadas localmente',
      'Sem backups separados dessas chaves, você pode perder permanentemente o acesso',
    ],
  },
  {
    language: 'de',
    translations: deTranslations,
    consequences: [
      'nur das erste vom Seed abgeleitete Konto (HD)',
      'löscht gespeicherte private Notizen und lokal verschlüsselte importierte private Schlüssel',
      'Ohne separate Schlüsselsicherungen kannst du den Zugriff',
    ],
  },
  {
    language: 'ru',
    translations: ruTranslations,
    consequences: [
      'только первый аккаунт, полученный из сид-фразы (HD)',
      'удаляет сохранённые приватные заметки и локально зашифрованные импортированные приватные ключи',
      'Без отдельных копий этих ключей вы можете навсегда потерять доступ',
    ],
  },
  {
    language: 'ja',
    translations: jaTranslations,
    consequences: [
      'シードから派生した最初のアカウント（HD）のみを復元',
      '保存済みのプライベートノートと、ローカルに暗号化保存されたインポート済み秘密鍵が削除',
      '鍵を別途バックアップしないと、それらのアカウントへのアクセスを永久に失う',
    ],
  },
  {
    language: 'zh',
    translations: zhTranslations,
    consequences: [
      '仅恢复由助记词派生的第一个账户（HD）',
      '删除已保存的私密票据和本地加密的导入私钥',
      '没有私钥的独立备份，您可能永久失去',
    ],
  },
  {
    language: 'ko',
    translations: koTranslations,
    consequences: [
      '시드에서 파생된 첫 번째 계정(HD)만 복원',
      '저장된 비공개 노트와 로컬에 암호화된 가져온 개인 키가 삭제',
      '키를 별도 백업하지 않으면 해당 계정에 대한 접근을 영구적으로 잃을',
    ],
  },
];

const privateNoteDeletion: Record<string, string> = {
  en: 'Recovery deletes saved private notes',
  de: 'löscht gespeicherte private Notizen',
  es: 'elimina las notas privadas guardadas',
  fr: 'supprime les notes privées enregistrées',
  ja: '保存済みのプライベートノートと、ローカルに暗号化保存されたインポート済み秘密鍵が削除されます。',
  ko: '저장된 비공개 노트와 로컬에 암호화된 가져온 개인 키가 삭제됩니다.',
  pt: 'exclui notas privadas salvas',
  ru: 'удаляет сохранённые приватные заметки',
  zh: '删除已保存的私密票据',
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

it.each(locales)(
  'shows the account limit, local deletion and permanent-loss warning before recovery in $language',
  async ({ language, translations, consequences }) => {
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
      `${translations.settings.recoveryLimitations} ${translations.forgetWalletPage.privateNotesBackupWarning}`,
    ]);
    const observed = paragraphs.join(' ');
    expect(observed).toContain(privateNoteDeletion[language]);
    expect(observed).toContain(
      translations.forgetWalletPage.privateNotesBackupWarning
    );
    consequences.forEach((consequence) => {
      expect(observed).toContain(consequence);
    });
    if (language === 'en') {
      expect(observed).toContain(
        'Re-add other accounts derived from the same phrase.'
      );
      expect(observed).toContain(
        'Enter the phrase for this wallet. A different phrase cannot restore its accounts.'
      );
      expect(observed).toContain(
        'Hardware connections, custom settings and smart-account/passkey setup need separate backups or reconnection.'
      );
      expect(observed).toContain('Recovery does not move your funds.');
    }
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);
