/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createStore } from 'redux';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { WATCH_ONLY_VALIDATION_TIMEOUT } from 'utils/watchOnlyImport';

import ImportAccount from './ImportAccount';

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
// Exact localized labels; all original draft, masking and no-import controls remain.
const labels = {
  en: ['Watch-only', 'Address / XPUB / Descriptor'],
  es: ['Solo lectura', 'Dirección / XPUB / Descriptor'],
  pt: ['Somente leitura', 'Endereço / XPUB / Descritor'],
  fr: ['Lecture seule', 'Adresse / XPUB / Descripteur'],
  de: ['Nur beobachten', 'Adresse / XPUB / Deskriptor'],
  zh: ['仅观察', '地址 / XPUB / 描述符'],
  ja: ['ウォッチ専用', 'アドレス / XPUB / ディスクリプター'],
  ko: ['보기 전용', '주소 / XPUB / 디스크립터'],
  ru: ['Только просмотр', 'Адрес / XPUB / Дескриптор'],
} as const;
const locales = Object.keys(resources) as Array<keyof typeof resources>;
const PUBLIC_IDENTIFIER = '0x0000000000000000000000000000000000000042';
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn() };
let mockPrivateInputValid = false;

jest.mock('antd/es/form/Form', () => ({
  useForm: jest.requireActual('antd').Form.useForm,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('utils/index', () => ({
  extractErrorMessage: jest.requireActual('utils/index').extractErrorMessage,
}));
jest.mock('utils/validatePrivateKey', () => ({
  // Presentation boundary only: never perform a backend read/private import.
  // Public watch-only controls retain a false private-validation result; the
  // address-type label case admits only its explicit non-secret draft fixture.
  validatePrivateKeyValue: async () => mockPrivateInputValid,
}));
jest.mock('components/index', () => ({
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ImportedWalletSuccessfully: ({ show }: any) =>
    show ? <div role="status">Unexpected import</div> : null,
}));

const RouteObservation = () => {
  const location = useLocation();
  return <output aria-label="Public route">{location.pathname}</output>;
};

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  // Same scheduling shim used by the existing actual AntD form regressions.
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPrivateInputValid = false;
  mockEmitter.mockImplementation(async (methods: string[], args: unknown[]) => {
    if (methods.join('.') !== 'wallet.validateWatchOnlyIdentifier')
      throw new Error('No account import or private operation is allowed');
    return args[0] === PUBLIC_IDENTIFIER;
  });
});

it.each(locales)(
  'uses current %s names for the native watch-only import controls without changing the draft or account',
  async (locale) => {
    const translation = resources[locale];
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, dictionary]) => [
          language,
          { translation: dictionary },
        ])
      ),
    });
    const state = {
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: {
            0: {
              id: 0,
              label: 'Public fixture account',
              address: PUBLIC_IDENTIFIER,
            },
          },
        },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          url: 'https://rpc.synthetic.invalid',
        },
        isBitcoinBased: false,
      },
    };
    const store = createStore(() => state);
    const dispatch = jest.spyOn(store, 'dispatch');
    const snapshot = JSON.stringify(store.getState());
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={instance}>
        <Provider store={store}>
          <MemoryRouter
            future={{
              ['v7_startTransition']: true,
              ['v7_relativeSplatPath']: true,
            }}
            initialEntries={['/settings/account/import']}
          >
            <RouteObservation />
            <ImportAccount />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>
    );

    // Establish genuine current locale and translated adjacent content before
    // any new localization expectation. Native form and checkbox are real.
    expect(instance.resolvedLanguage).toBe(locale);
    expect(
      screen.getByText(translation.settings.importAccountsWont, { exact: true })
    ).toBeVisible();
    const accountLabel = screen.getByRole('textbox', {
      name: `${translation.settings.label} (${translation.settings.optional})`,
    });
    expect(accountLabel).toHaveAttribute('id', 'account-name-input');
    const privateInput = screen.getByLabelText(
      translation.settings.yourPrivateKey
    ) as HTMLInputElement;
    expect(privateInput).toHaveAttribute('type', 'password');
    expect(privateInput).toHaveAttribute('autocomplete', 'off');
    expect(privateInput).toHaveValue('');
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).toHaveAttribute('id', 'import-account-watch-only');
    expect(checkbox).toHaveAccessibleName();
    expect(checkbox.labels).toHaveLength(1);
    expect(checkbox.labels![0]).toHaveAttribute('for', checkbox.id);
    expect(checkbox).not.toBeChecked();
    const submit = screen.getByRole('button', {
      name: translation.buttons.import,
    }) as HTMLButtonElement;
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.form).toBe(privateInput.form);
    expect(submit).toBeDisabled();
    expect(mockEmitter).not.toHaveBeenCalled();

    // Native keyboard toggling must retain actual field identity and follow the
    // existing masking policy; the only entered string is a public address.
    await user.click(checkbox.labels![0]);
    expect(checkbox).toBeChecked();
    await user.tab();
    const publicInput = document.getElementById(
      'import-account-identifier'
    ) as HTMLInputElement;
    expect(publicInput).toHaveFocus();
    expect(publicInput).toHaveAttribute('type', 'text');
    expect(publicInput.getAttribute('aria-label')).toBe(
      publicInput.getAttribute('placeholder')
    );
    expect(publicInput).toHaveAccessibleName();
    await user.type(publicInput, PUBLIC_IDENTIFIER);
    await waitFor(() => expect(submit).toBeEnabled());
    expect(publicInput).toHaveValue(PUBLIC_IDENTIFIER);
    await user.tab({ shift: true });
    expect(checkbox).toHaveFocus();
    await user.keyboard(' ');
    expect(checkbox).not.toBeChecked();
    expect(privateInput).toHaveValue(PUBLIC_IDENTIFIER);
    expect(privateInput).toHaveAttribute('type', 'password');
    expect(privateInput).toHaveAccessibleName(
      translation.settings.yourPrivateKey
    );
    await waitFor(() => expect(submit).toBeDisabled());
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(publicInput).toHaveValue(PUBLIC_IDENTIFIER);
    expect(publicInput).toHaveAttribute('type', 'password');
    // A nonempty draft that passed through private mode remains masked until
    // cleared, by design. Names must localize without changing that behavior.
    expect(publicInput.getAttribute('aria-label')).toBe(
      publicInput.getAttribute('placeholder')
    );
    expect(accountLabel).toHaveValue('');
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'validateWatchOnlyIdentifier'],
      [PUBLIC_IDENTIFIER]
    );
    expect(
      mockEmitter.mock.calls.every(
        ([methods, args]) =>
          methods.join('.') === 'wallet.validateWatchOnlyIdentifier' &&
          typeof args[0] === 'string' &&
          PUBLIC_IDENTIFIER.startsWith(args[0])
      )
    ).toBe(true);
    expect(screen.queryByText('Unexpected import')).toBeNull();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(snapshot);
    expect(screen.getByLabelText('Public route')).toHaveTextContent(
      '/settings/account/import'
    );

    // Collect both exact accessibility matcher outcomes so each locale case
    // proves both labels rather than stopping after the first untranslated one.
    const localizationFailures: string[] = [];
    for (const [node, expectedName] of [
      [checkbox, labels[locale][0]],
      [publicInput, labels[locale][1]],
    ] as const) {
      try {
        expect(node).toHaveAccessibleName(expectedName);
      } catch (error) {
        localizationFailures.push((error as Error).message);
      }
    }
    expect(localizationFailures).toEqual([]);
    // Keep all asynchronous form state changes settled before unmount.
    await act(async () => undefined);
  }
);

it.each(locales)(
  'localizes the %s Legacy address-type label without changing its radio choice or draft',
  async (locale) => {
    mockPrivateInputValid = true;
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, dictionary]) => [
          language,
          { translation: dictionary },
        ])
      ),
    });
    const state = {
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: {
            0: {
              id: 0,
              label: 'Public fixture account',
              address: 'public-address',
            },
          },
        },
        activeNetwork: {
          kind: 'syscoin',
          chainId: 5700,
          url: 'http://127.0.0.1:18545',
        },
        isBitcoinBased: true,
      },
    };
    const store = createStore(() => state);
    const dispatch = jest.spyOn(store, 'dispatch');
    const snapshot = JSON.stringify(store.getState());
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={instance}>
        <Provider store={store}>
          <MemoryRouter initialEntries={['/settings/account/import']}>
            <ImportAccount />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>
    );
    expect(instance.resolvedLanguage).toBe(locale);
    const input = screen.getByLabelText(
      resources[locale].settings.yourPrivateKey
    );
    const draft = 'synthetic-address-type-draft';
    await user.type(input, draft);
    const legacy = await screen.findByRole('radio', {
      name: resources[locale].settings.legacyAddressType,
    });
    const segwit = screen.getByRole('radio', { name: 'SegWit (P2WPKH)' });
    const taproot = screen.getByRole('radio', { name: 'Taproot (P2TR)' });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(legacy).toHaveAttribute('type', 'radio');
    expect(legacy).toHaveAttribute('name', 'utxoAddressType');
    expect(segwit).toBeChecked();
    expect(legacy).not.toBeChecked();
    await user.click(legacy);
    expect(legacy).toBeChecked();
    expect(segwit).not.toBeChecked();
    await user.click(taproot);
    expect(taproot).toBeChecked();
    expect(legacy).not.toBeChecked();
    await user.click(segwit);
    expect(segwit).toBeChecked();
    expect(input).toHaveValue(draft);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: resources[locale].buttons.import })
    ).toBeEnabled();
    if (locale !== 'en')
      expect(
        screen.queryByRole('radio', { name: en.settings.legacyAddressType })
      ).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(snapshot);
    await act(async () => undefined);
  }
);

it.each(locales)(
  'localizes a watch-only validation timeout in %s and retries the retained public draft',
  async (locale) => {
    const translation = resources[locale];
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, dictionary]) => [
          language,
          { translation: dictionary },
        ])
      ),
    });
    const state = {
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: {
            0: {
              id: 0,
              label: 'Public fixture account',
              address: PUBLIC_IDENTIFIER,
            },
          },
        },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          url: 'https://rpc.synthetic.invalid',
        },
        isBitcoinBased: false,
      },
    };
    const store = createStore(() => state);
    const dispatch = jest.spyOn(store, 'dispatch');
    const snapshot = JSON.stringify(store.getState());
    const publicLabel = 'Watch-only retry fixture';
    let rejectImport!: (reason: Error) => void;
    const firstImport = new Promise<never>((_resolve, reject) => {
      rejectImport = reject;
    });
    let resolveRetry!: (account: { address: string; id: number }) => void;
    const retryImport = new Promise<{ address: string; id: number }>(
      (resolve) => {
        resolveRetry = resolve;
      }
    );
    let importAttempts = 0;
    mockEmitter.mockImplementation((methods: string[], args: unknown[]) => {
      const method = methods.join('.');
      if (method === 'wallet.validateWatchOnlyIdentifier')
        return Promise.resolve(args[0] === PUBLIC_IDENTIFIER);
      if (method === 'wallet.importWatchOnlyFromController') {
        importAttempts += 1;
        return importAttempts === 1 ? firstImport : retryImport;
      }
      throw new Error('No private import or unrelated operation is allowed');
    });
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={instance}>
        <Provider store={store}>
          <MemoryRouter
            future={{
              ['v7_startTransition']: true,
              ['v7_relativeSplatPath']: true,
            }}
            initialEntries={['/settings/account/import']}
          >
            <RouteObservation />
            <ImportAccount />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>
    );
    expect(instance.resolvedLanguage).toBe(locale);
    expect(
      screen.getByText(translation.settings.importAccountsWont, { exact: true })
    ).toBeVisible();
    const label = screen.getByRole('textbox', {
      name: `${translation.settings.label} (${translation.settings.optional})`,
    });
    await user.type(label, publicLabel);
    const checkbox = screen.getByRole('checkbox', {
      name: translation.settings.watchOnly,
    });
    await user.click(checkbox);
    const identifier = screen.getByRole('textbox', {
      name: translation.settings.publicIdentifierInput,
    });
    await user.type(identifier, PUBLIC_IDENTIFIER);
    const submit = screen.getByRole('button', {
      name: translation.buttons.import,
    }) as HTMLButtonElement;
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.form).toBe((identifier as HTMLInputElement).form);
    await waitFor(() => expect(submit).toBeEnabled());

    // Use the real native submit control and AntD validation. Only the public
    // controller transport response is controlled; the deadline itself is
    // covered by the controller and genuine HTTP regressions.
    await user.click(submit);
    await waitFor(() => expect(importAttempts).toBe(1));
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(identifier).toBeDisabled();
    expect(checkbox).toBeDisabled();
    expect(screen.queryByText('Unexpected import')).toBeNull();
    expect(mockAlert.error).not.toHaveBeenCalled();
    await act(async () => {
      rejectImport(new Error(WATCH_ONLY_VALIDATION_TIMEOUT));
    });

    const failure = await screen.findByRole('alert');
    expect(failure).toBeVisible();
    expect(failure.textContent).toBe(
      translation.settings.watchOnlyValidationTimedOut
    );
    expect(failure).not.toHaveTextContent(WATCH_ONLY_VALIDATION_TIMEOUT);
    if (locale !== 'en')
      expect(failure).not.toHaveTextContent(
        en.settings.watchOnlyValidationTimedOut
      );
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(identifier).toHaveValue(PUBLIC_IDENTIFIER);
    expect(label).toHaveValue(publicLabel);
    expect(checkbox).toBeChecked();
    expect(identifier).toBeEnabled();
    expect(checkbox).toBeEnabled();
    expect(submit).toBeEnabled();
    expect(submit).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Unexpected import')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(snapshot);
    expect(screen.getByLabelText('Public route')).toHaveTextContent(
      '/settings/account/import'
    );

    // A genuine keyboard retry must pass the same public identifier and label
    // through the form without editing or routing through private-key import.
    submit.focus();
    expect(submit).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(importAttempts).toBe(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit).toBeDisabled();
    await act(async () => resolveRetry({ id: 1, address: PUBLIC_IDENTIFIER }));
    expect(await screen.findByText('Unexpected import')).toHaveAttribute(
      'role',
      'status'
    );
    expect(importAttempts).toBe(2);
    const imports = mockEmitter.mock.calls.filter(
      ([methods]) =>
        methods.join('.') === 'wallet.importWatchOnlyFromController'
    );
    expect(imports).toEqual([
      [
        ['wallet', 'importWatchOnlyFromController'],
        [PUBLIC_IDENTIFIER, publicLabel],
      ],
      [
        ['wallet', 'importWatchOnlyFromController'],
        [PUBLIC_IDENTIFIER, publicLabel],
      ],
    ]);
    expect(
      mockEmitter.mock.calls.every(([methods, args]) =>
        methods.join('.') === 'wallet.validateWatchOnlyIdentifier'
          ? typeof args[0] === 'string' && PUBLIC_IDENTIFIER.startsWith(args[0])
          : methods.join('.') === 'wallet.importWatchOnlyFromController'
      )
    ).toBe(true);
    expect(
      mockEmitter.mock.calls.some(
        ([methods]) =>
          methods.join('.') === 'wallet.importAccountFromPrivateKey'
      )
    ).toBe(false);
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(snapshot);
    await act(async () => undefined);
  }
);
