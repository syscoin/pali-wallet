/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { KeyringAccountType } from 'types/network';

import ManageAccounts from './ManageAccounts';

// Real list, confirmation dialog, Redux subscriptions and locale resources.
// Only public synthetic account metadata is supplied. No real key, account
// creation, controller mutation, signing or broadcast is involved.
let mockStore: ReturnType<typeof configureStore>;
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const originalObserver = globalThis.ResizeObserver;
const resources = { de, en, es, fr, ja, ko, pt, ru, zh };
type Locale = keyof typeof resources;
const questions: Record<Locale, string> = {
  de: 'Sind Sie sicher, dass Sie das {{accountType}}-Konto "{{accountName}}" entfernen möchten?',
  en: 'Are you sure you want to remove the {{accountType}} account "{{accountName}}"?',
  es: '¿Estás seguro de que deseas eliminar la cuenta {{accountType}} "{{accountName}}"?',
  fr: 'Êtes-vous sûr de vouloir supprimer le compte {{accountType}} "{{accountName}}" ?',
  ja: '{{accountType}}アカウント "{{accountName}}" を削除してもよろしいですか？',
  ko: '{{accountType}} 계정 "{{accountName}}"을(를) 제거하시겠습니까?',
  pt: 'Tem certeza de que deseja remover a conta {{accountType}} "{{accountName}}"?',
  ru: 'Вы уверены, что хотите удалить {{accountType}} аккаунт "{{accountName}}"?',
  zh: '您确定要移除{{accountType}}账户"{{accountName}}"吗？',
};
const targets = [
  {
    kind: KeyringAccountType.HDAccount,
    id: 1,
    label: 'Seed account',
    privateImport: false,
  },
  {
    kind: KeyringAccountType.Imported,
    id: 1,
    label: 'Imported signer',
    privateImport: true,
  },
  {
    kind: KeyringAccountType.Imported,
    id: 2,
    label: 'Watch account',
    privateImport: false,
  },
  {
    kind: KeyringAccountType.Ledger,
    id: 0,
    label: 'Ledger account',
    privateImport: false,
  },
  {
    kind: KeyringAccountType.Trezor,
    id: 0,
    label: 'Trezor account',
    privateImport: false,
  },
  {
    kind: KeyringAccountType.SmartAccount,
    id: 0,
    label: 'Smart account',
    privateImport: false,
  },
];

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ connectionUnavailable: false }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));
jest.mock('components/Icon/Icon', () => ({
  RiUserReceivedLine: () => null,
  LockIconSvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  MdBugReport: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Icon: () => null,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(() => {
    throw new Error(
      'No mutation allowed in confirmation and cancellation checks'
    );
  });
  const address = (digit: string) => `0x${digit.repeat(40)}`;
  const state = {
    vault: {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://synthetic.invalid',
        currency: 'eth',
      },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: address('1'),
            xpub: 'public-anchor',
            label: 'Anchor',
          },
          1: {
            id: 1,
            address: address('2'),
            xpub: 'public-hd-one',
            label: 'Seed account',
          },
        },
        Imported: {
          1: {
            id: 1,
            address: address('3'),
            xpub: address('3'),
            xprv: 'synthetic-encrypted-record',
            label: 'Imported signer',
            isImported: true,
          },
          2: {
            id: 2,
            address: address('4'),
            xpub: address('4'),
            xprv: '',
            label: 'Watch account',
            isImported: true,
          },
        },
        Ledger: {
          0: {
            id: 0,
            address: address('5'),
            label: 'Ledger account',
            isLedgerWallet: true,
          },
        },
        Trezor: {
          0: {
            id: 0,
            address: address('6'),
            label: 'Trezor account',
            isTrezorWallet: true,
          },
        },
        SmartAccount: {
          0: {
            id: 0,
            address: address('7'),
            label: 'Smart account',
            isSmartAccount: true,
            smartAccount: { chainId: 1 },
          },
        },
      },
    },
    vaultGlobal: {
      activeSlip44: 60,
      networkStatus: 'idle',
      isSwitchingAccount: false,
    },
  };
  mockStore = configureStore({ reducer: (value = state) => value });
});
afterEach(cleanup);

const cases = (Object.keys(resources) as Locale[]).flatMap((locale) =>
  targets.map((target) => ({ locale, ...target }))
);

it.each(cases)(
  '$locale: $label gets only its applicable recovery warning and Cancel preserves all records',
  async ({ locale, kind, id, label, privateImport }) => {
    const copy = resources[locale];
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      resources: { [locale]: { translation: copy } },
    });
    expect(i18n.resolvedLanguage).toBe(locale);
    expect(copy.settings.removeAccountConfirmation).toBe(questions[locale]);
    expect(copy.settings.importedAccountRemovalWarning.trim()).not.toBe('');
    if (locale !== 'en')
      expect(copy.settings.importedAccountRemovalWarning).not.toBe(
        en.settings.importedAccountRemovalWarning
      );
    render(
      <Provider store={mockStore}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/settings/manage-accounts']}>
            <ManageAccounts />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
    const before = mockStore.getState() as any;
    expect(before.vault.accounts[kind][id].label).toBe(label);
    const accountIdentity = `${label} (${before.vault.accounts[kind][id].address})`;
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {
        name: `${copy.buttons.remove}: ${accountIdentity}`,
      })
    );
    const dialog = screen.getByRole('dialog', {
      name: copy.settings.removeAccount,
    });
    const accountType =
      kind === KeyringAccountType.Imported
        ? copy.components.imported
        : kind === KeyringAccountType.SmartAccount
        ? copy.receive.smartAccount
        : kind === KeyringAccountType.HDAccount
        ? 'Pali'
        : kind;
    const question = i18n.t('settings.removeAccountConfirmation', {
      accountName: accountIdentity,
      accountType,
    });
    const warning = copy.settings.importedAccountRemovalWarning;
    const expected = privateImport ? `${question} ${warning}` : question;
    expect(within(dialog).getByText(expected, { exact: true })).toBeVisible();
    if (!privateImport) expect(dialog).not.toHaveTextContent(warning);
    await user.click(
      within(dialog).getByRole('button', { name: copy.buttons.cancel })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockStore.getState()).toBe(before);
    expect((mockStore.getState() as any).vault.accounts[kind][id]).toEqual(
      before.vault.accounts[kind][id]
    );
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);
