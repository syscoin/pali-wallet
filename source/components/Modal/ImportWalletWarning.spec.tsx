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
}));

const locales = [
  {
    language: 'en',
    translations: enTranslations,
    consequences: [
      'only the first seed-derived (HD) account',
      'deletes the locally stored encrypted records of imported private keys',
      'Without separate backups of those keys, you may permanently lose access',
    ],
  },
  {
    language: 'es',
    translations: esTranslations,
    consequences: [
      'solo la primera cuenta derivada de la semilla (HD)',
      'elimina los registros cifrados de las claves privadas importadas que se guardan localmente',
      'Sin copias de seguridad independientes de esas claves, puedes perder permanentemente el acceso',
    ],
  },
  {
    language: 'fr',
    translations: frTranslations,
    consequences: [
      'uniquement le premier compte dérivé de la phrase (HD)',
      'supprime les enregistrements chiffrés des clés privées importées stockés localement',
      'Sans sauvegardes distinctes de ces clés, vous risquez de perdre définitivement l’accès',
    ],
  },
  {
    language: 'pt',
    translations: ptTranslations,
    consequences: [
      'apenas a primeira conta derivada da seed (HD)',
      'exclui os registros criptografados das chaves privadas importadas armazenados localmente',
      'Sem backups separados dessas chaves, você pode perder permanentemente o acesso',
    ],
  },
  {
    language: 'de',
    translations: deTranslations,
    consequences: [
      'nur das erste vom Seed abgeleitete Konto (HD)',
      'löscht die lokal gespeicherten verschlüsselten Datensätze importierter privater Schlüssel',
      'Ohne separate Sicherungen dieser Schlüssel kannst du dauerhaft den Zugriff',
    ],
  },
  {
    language: 'ru',
    translations: ruTranslations,
    consequences: [
      'только первый аккаунт, полученный из сид-фразы (HD)',
      'удаляет локально сохранённые зашифрованные записи импортированных приватных ключей',
      'Без отдельных резервных копий этих ключей вы можете навсегда потерять доступ',
    ],
  },
  {
    language: 'ja',
    translations: jaTranslations,
    consequences: [
      'シードから派生した最初のアカウント（HD）のみを復元',
      'ローカルに保存されたインポート済み秘密鍵の暗号化された記録が削除',
      'それらの鍵を別途バックアップしていない場合、それらのアカウントに永久にアクセスできなくなる',
    ],
  },
  {
    language: 'zh',
    translations: zhTranslations,
    consequences: [
      '仅恢复由助记词派生的第一个账户（HD）',
      '删除本地存储的已导入私钥的加密记录',
      '如果没有这些私钥的独立备份，您可能会永久失去',
    ],
  },
  {
    language: 'ko',
    translations: koTranslations,
    consequences: [
      '시드에서 파생된 첫 번째 계정(HD)만 복원',
      '로컬에 저장된 가져온 개인 키의 암호화된 기록이 삭제',
      '해당 키를 별도로 백업하지 않았다면 해당 계정에 대한 접근 권한을 영구적으로 잃을',
    ],
  },
];

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
      translations.settings.recoveryLimitations,
    ]);
    const observed = paragraphs.join(' ');
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
        'Hardware connections, custom settings and smart-account/passkey setup need their own backups or reconnection.'
      );
      expect(observed).toContain('Recovery does not move your funds.');
    }
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);
