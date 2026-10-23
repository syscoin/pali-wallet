/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import { ChangeConnectedAccount } from './ChangeConnectedAccount';

const resources = { en, de, es, fr, ja, ko, pt, ru, zh };
type Locale = keyof typeof resources;
const locales = Object.keys(resources) as Locale[];
const REQUIRED = '0x1111111111111111111111111111111111111111';
const ACTIVE = '0x2222222222222222222222222222222222222222';
const REQUEST = {
  host: 'https://public-copy.example',
  eventName: 'changeActiveConnected',
  accountType: KeyringAccountType.HDAccount,
  connectedAccount: {
    id: 0,
    address: REQUIRED,
    label: 'Required public account',
  },
};
const serializedRequest = JSON.stringify(REQUEST);
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockToast = {
  dismiss: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initialVault = clone(store.getState().vault);
let stateBefore = '';

jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => mockNavigate,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: jest.requireActual('hooks/useQuery').useQueryData,
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    dismiss: (...args: any[]) => mockToast.dismiss(...args),
    info: (...args: any[]) => mockToast.info(...args),
    error: (...args: any[]) => mockToast.error(...args),
    success: (...args: any[]) => mockToast.success(...args),
  }),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));
// Read-only balance presentation is unrelated to Copy. Keep the real account
// selector/identicon, empty-token helper, native buttons, Footer and Icon.
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => <span>Public balance fixture</span>,
}));
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: jest.requireActual('components/Icon/Icon').Icon,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(async (path: string[]) => {
    throw new Error('No controller action allowed: ' + path.join('.'));
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  store.dispatch(
    restoreVaultSnapshot({
      ...clone(initialVault),
      activeAccount: { id: 1, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        currency: 'eth',
        label: 'Public review fixture',
        url: 'https://public-review.invalid',
      },
      isBitcoinBased: false,
      accounts: {
        ...initialVault.accounts,
        HDAccount: {
          0: {
            ...initialVault.accounts.HDAccount[0],
            id: 0,
            address: REQUIRED,
            label: REQUEST.connectedAccount.label,
          },
          1: {
            ...initialVault.accounts.HDAccount[0],
            id: 1,
            address: ACTIVE,
            label: 'Active public account',
          },
        },
      },
      accountAssets: {
        ...initialVault.accountAssets,
        HDAccount: {
          0: { ethereum: [], syscoin: [] },
          1: { ethereum: [], syscoin: [] },
        },
      },
    })
  );
  stateBefore = JSON.stringify(store.getState());
});
afterEach(() => {
  cleanup();
  expect(JSON.stringify(store.getState())).toBe(stateBefore);
  expect(JSON.stringify(REQUEST)).toBe(serializedRequest);
  // Copying either card must not switch/select, persist, grant, acknowledge,
  // sign, navigate or close the actual consent view.
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

async function prepare(locale: Locale) {
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
  const user = userEvent.setup();
  // Forward into a disposable native clipboard, never replace the copy hook
  // or a controller result. Read the exact public bytes back after each action.
  const writeText = jest.spyOn(navigator.clipboard, 'writeText');
  render(
    <Provider store={store}>
      <I18nextProvider i18n={instance}>
        <MemoryRouter
          initialEntries={[
            '/external/change-active-connected-account?data=' +
              encodeURIComponent(serializedRequest),
          ]}
        >
          <ChangeConnectedAccount />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>
  );
  expect(instance.language).toBe(locale);
  expect(
    screen.getByText(resources[locale].connections.requiredAccount)
  ).toBeVisible();
  expect(
    screen.getByText(resources[locale].connections.currentActiveAccount)
  ).toBeVisible();
  expect(screen.getByText(REQUEST.connectedAccount.label)).toBeVisible();
  expect(screen.getByText('Active public account')).toBeVisible();
  expect(
    screen.getByRole('button', { name: resources[locale].buttons.cancel })
  ).toBeEnabled();
  expect(
    screen.getByRole('button', {
      name: resources[locale].connections.switchAccount,
    })
  ).toBeEnabled();
  const icons = screen.getAllByRole('img', { name: 'copy' });
  expect(icons).toHaveLength(2);
  const buttons = icons.map((icon) => icon.closest('button')!);
  for (const button of buttons) {
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button).toBeEnabled();
  }
  return { user, writeText, buttons };
}

describe.each(locales)(
  'connected-account comparison Copy purposes in %s',
  (locale) => {
    it('copies exact required/current addresses by pointer and native Enter without changing selection', async () => {
      const { user, writeText, buttons } = await prepare(locale);
      for (const [index, button] of buttons.entries()) {
        const address = index === 0 ? REQUIRED : ACTIVE;
        await user.click(button);
        expect(await navigator.clipboard.readText()).toBe(address);
        button.focus();
        expect(button).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(await navigator.clipboard.readText()).toBe(address);
      }
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(4));
      expect(writeText.mock.calls).toEqual([
        [REQUIRED],
        [REQUIRED],
        [ACTIVE],
        [ACTIVE],
      ]);
    });

    it.each([0, 1])(
      'names public account card %s Copy in the selected locale',
      async (index) => {
        const { buttons, writeText } = await prepare(locale);
        expect(writeText).not.toHaveBeenCalled();
        // English icon wording is a healthy control; non-English actions must use
        // the real localized resource rather than the registry glyph's English.
        expect(buttons[index]).toHaveAccessibleName(
          locale === 'en' ? /^copy$/i : resources[locale].buttons.copy
        );
      }
    );
  }
);
