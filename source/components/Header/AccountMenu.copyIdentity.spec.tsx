/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { Menu } from '@headlessui/react';
import { configureStore } from '@reduxjs/toolkit';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import RenderAccountsListByBitcoinBased from 'components/Header/RenderAccountsListByBitcoinBased';
import vaultReducer from 'state/vault';
import { KeyringAccountType } from 'types/network';

// Keep the actual
// Headless UI menu, production click handlers, reducer and locale resources.
const resources = { de, en, es, fr, ja, ko, pt, ru, zh };
type Locale = keyof typeof resources;
const A = '0x2222222222222222222222222222222222222222';
const B = '0x3333333333333333333333333333333333333333';
const SHARED = 'Daily';
const mockAlert = { error: jest.fn(), info: jest.fn() };
const mockSetActiveAccount = jest.fn();
const originalObserver = globalThis.ResizeObserver;

jest.mock('hooks/useUtils', () => ({ useUtils: () => ({ alert: mockAlert }) }));
jest.mock('components/Icon/Icon', () => ({
  RiUserReceivedLine: () => null,
  PaliWhiteSmallIconSvg: () => null,
  LoadingSvg: () => null,
  LockIconSvg: () => null,
}));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
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
  mockSetActiveAccount.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function mount(locale: Locale = 'en', duplicate = true) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    initImmediate: false,
    lng: locale,
    resources: { [locale]: { translation: resources[locale] } },
    react: { useSuspense: false },
  });
  const vault = {
    ...vaultReducer(undefined, { type: 'fixture/init' }),
    activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 1,
      currency: 'eth',
      url: 'https://synthetic.invalid',
    },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          label: duplicate ? SHARED : 'Reserve',
          address: A,
          xpub: 'public-a',
        },
        1: {
          id: 1,
          label: duplicate ? SHARED : 'Savings',
          address: B,
          xpub: 'public-b',
        },
      },
      Imported: {},
      Trezor: {},
      Ledger: {},
      SmartAccount: {},
    },
  };
  const globalState = { activeSlip44: 60, isSwitchingAccount: false };
  const store = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: (state = globalState) => state,
    },
    preloadedState: {
      vault: vault as unknown as ReturnType<typeof vaultReducer>,
      vaultGlobal: globalState,
    },
  });
  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <Menu>
          <Menu.Button>Accounts</Menu.Button>
          <Menu.Items>
            <RenderAccountsListByBitcoinBased
              setActiveAccount={mockSetActiveAccount}
            />
          </Menu.Items>
        </Menu>
      </I18nextProvider>
    </Provider>
  );
  const open = async () => {
    await user.click(screen.getByRole('button', { name: 'Accounts' }));
    await screen.findByRole('menu');
  };
  await open();
  return { user, open, store, i18n, copy: resources[locale] };
}
const rowFor = (value: string) =>
  screen
    .getByRole('menuitem', { name: new RegExp(`^${SHARED} \\(${value}\\)$`) })
    .closest('li')!;
const copyIn = (row: HTMLElement, operation: string) =>
  within(row).getByRole('menuitem', { name: new RegExp(`^${operation}:`) });

it('healthy distinct labels and full-address account selection stay separate from Copy', async () => {
  const { copy } = await mount('en', false);
  const observed = [];
  for (const [label, value] of [
    ['Reserve', A],
    ['Savings', B],
  ]) {
    const select = screen.getByRole('menuitem', {
      name: `${label} (${value})`,
    });
    const button = copyIn(select.closest('li')!, copy.buttons.copy);
    expect(select).toHaveAccessibleName(`${label} (${value})`);
    expect(button).toHaveAccessibleName(new RegExp(label));
    expect(button).not.toBe(select);
    observed.push(button.getAttribute('aria-label'));
  }
  expect(new Set(observed).size).toBe(2);
  expect(mockSetActiveAccount).not.toHaveBeenCalled();
});

it.each(Object.keys(resources) as Locale[])(
  '%s duplicate-label Copy actions have distinct full public identity in the saved language',
  async (locale) => {
    const { copy, i18n } = await mount(locale);
    expect(i18n.resolvedLanguage).toBe(locale);
    for (const value of [A, B]) {
      const name = `${copy.buttons.copy}: ${SHARED} (${value})`;
      const button = screen.getByRole('menuitem', { name });
      expect(button).toBe(copyIn(rowFor(value), copy.buttons.copy));
      expect(button).toHaveAccessibleName(name);
      expect(
        screen.getByRole('menuitem', {
          name: `${SHARED} (${value})`,
        })
      ).not.toBe(button);
    }
    expect(mockSetActiveAccount).not.toHaveBeenCalled();
  }
);

it('pointer and native Enter Copy retain exact public bytes for each duplicate-label account and never select it', async () => {
  const { user, open, store, copy } = await mount();
  const before = store.getState();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue();
  try {
    for (const [index, value] of [A, B].entries()) {
      await user.click(copyIn(rowFor(value), copy.buttons.copy));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(index * 2 + 1));
      expect(write).toHaveBeenLastCalledWith(value);
      await user.keyboard('{Escape}');
      await open();
      // Real Headless UI active-descendant keyboard path, not onClick called
      // manually: two accounts give selection/Copy pairs in source order.
      screen.getByRole('menu').focus();
      await user.keyboard(
        index === 0 ? '{Home}{ArrowDown}{Enter}' : '{End}{Enter}'
      );
      await waitFor(() => expect(write).toHaveBeenCalledTimes(index * 2 + 2));
      expect(write).toHaveBeenLastCalledWith(value);
      expect(screen.queryByRole('menu')).toBeNull();
      if (index === 0) await open();
    }
    expect(write.mock.calls).toEqual([[A], [A], [B], [B]]);
    expect(mockSetActiveAccount).not.toHaveBeenCalled();
    expect(mockAlert.info).toHaveBeenCalledTimes(4);
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before);
  } finally {
    write.mockRestore();
  }
});

it('duplicate-label selection still dispatches exact ids independently of Copy', async () => {
  const { user, open } = await mount();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue();
  try {
    await user.click(
      screen.getByRole('menuitem', { name: `${SHARED} (${B})` })
    );
    await waitFor(() =>
      expect(mockSetActiveAccount).toHaveBeenCalledWith(
        1,
        KeyringAccountType.HDAccount
      )
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await open();
    screen.getByRole('menu').focus();
    await user.keyboard('{Home}{Enter}');
    await waitFor(() => expect(mockSetActiveAccount).toHaveBeenCalledTimes(2));
    expect(mockSetActiveAccount.mock.calls).toEqual([
      [1, KeyringAccountType.HDAccount],
      [0, KeyringAccountType.HDAccount],
    ]);
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});

it('Copy rejection retains its error and cannot masquerade as selection or success', async () => {
  const { user, copy, store } = await mount();
  const before = store.getState();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new Error('Synthetic clipboard rejection'));
  try {
    await user.click(copyIn(rowFor(B), copy.buttons.copy));
    await waitFor(() =>
      expect(mockAlert.error).toHaveBeenCalledWith(copy.transactions.copyFailed)
    );
    expect(write).toHaveBeenCalledWith(B);
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockSetActiveAccount).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before);
  } finally {
    write.mockRestore();
  }
});
