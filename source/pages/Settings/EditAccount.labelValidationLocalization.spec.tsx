/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance, i18n } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

import EditAccount from './EditAccount';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const accountLabel = 'Everyday';
const account = {
  id: 0,
  label: accountLabel,
  address: '0x1111111111111111111111111111111111111111',
  xpub: 'public-hd-identity',
};
const mockState = {
  vaultGlobal: { activeSlip44: 60 },
  vault: {
    activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
    activeNetwork: {
      kind: INetworkType.Ethereum,
      chainId: 5700,
      url: 'https://rpc.invalid',
    },
    accounts: { HDAccount: { 0: account } },
  },
};
const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
const locales = Object.keys(resources) as Array<keyof typeof resources>;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg /> }));
jest.mock('components/Icon/Icon', () => ({
  LockIconSvg: () => <svg />,
  LoadingSvg: () => <svg />,
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: jest.requireActual('components/Button/Button').Button,
}));

const showEditor = async (locale: keyof typeof resources): Promise<i18n> => {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    initImmediate: false,
    lng: locale,
    fallbackLng: 'en',
    resources: Object.fromEntries(
      Object.entries(resources).map(([language, translation]) => [
        language,
        { translation },
      ])
    ),
    react: { useSuspense: false },
    interpolation: { escapeValue: true },
  });
  render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
        initialEntries={[
          {
            pathname: '/settings/edit-account',
            state: {
              id: 0,
              accountType: KeyringAccountType.HDAccount,
              returnContext: { returnRoute: '/settings/manage-accounts' },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/settings/edit-account" element={<EditAccount />} />
          <Route path="/settings/manage-accounts" element={<h1>Accounts</h1>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
  expect(instance.resolvedLanguage).toBe(locale);
  expect(
    screen.getByPlaceholderText(resources[locale].settings.accountLabel)
  ).toHaveValue(accountLabel);
  expect(
    screen.getByRole('button', { name: resources[locale].buttons.save })
  ).toBeEnabled();
  return instance;
};

const submitLabel = (locale: keyof typeof resources, label: string) => {
  fireEvent.change(
    screen.getByPlaceholderText(resources[locale].settings.accountLabel),
    { target: { value: label } }
  );
  fireEvent.click(
    screen.getByRole('button', { name: resources[locale].buttons.save })
  );
};

const labelError = async (locale: keyof typeof resources) => {
  const input = screen.getByPlaceholderText(
    resources[locale].settings.accountLabel
  );
  await waitFor(() => {
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const description = document.getElementById(
      input.getAttribute('aria-describedby') || ''
    );
    expect(description).toBeVisible();
    expect(description?.textContent?.trim()).not.toBe('');
  });
  return document.getElementById(input.getAttribute('aria-describedby') || '')!;
};

const originalMessageChannel = globalThis.MessageChannel;
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
});

describe('EditAccount label-validation localization through the real Ant Form', () => {
  it.each(
    locales.flatMap((locale) =>
      [
        ['empty', ''],
        ['whitespace', ' \u00a0 '],
        ['unchanged', accountLabel],
      ].map(([kind, value]) => [locale, kind, value] as const)
    )
  )(
    'gives localized guidance for %s %s input without admitting a label mutation',
    async (locale, _case, value) => {
      await showEditor(locale);
      submitLabel(locale, value);
      const error = await labelError(locale);
      expect(error).toBeVisible();
      expect(error.textContent?.trim()).not.toBe('');
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockAlert.success).not.toHaveBeenCalled();
      expect(mockAlert.error).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'Accounts' })).toBeNull();
      expect(error.textContent).toBe(resources[locale].settings.newLabel);
      expect(
        screen.getByPlaceholderText(resources[locale].settings.accountLabel)
      ).toHaveValue(value);
    }
  );

  it.each(locales)(
    'keeps a genuine changed label and its localized success healthy in %s',
    async (locale) => {
      await showEditor(locale);
      submitLabel(locale, '  Updated everyday  ');
      await waitFor(() =>
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'editAccountLabel'],
          [
            '  Updated everyday  ',
            0,
            KeyringAccountType.HDAccount,
            {
              account: { address: account.address, xpub: account.xpub },
              walletScope: getWalletNavigationScope(),
            },
          ]
        )
      );
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByRole('heading', { name: 'Accounts' })
      ).toBeVisible();
      expect(mockAlert.success).toHaveBeenCalledWith(
        resources[locale].settings.accountLabelEditedSuccessfully
      );
      expect(mockAlert.error).not.toHaveBeenCalled();
    }
  );
});
