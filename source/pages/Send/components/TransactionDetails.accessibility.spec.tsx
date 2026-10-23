/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React, { useState } from 'react';
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
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import { TransactionDetailsComponent } from './TransactionDetails';

const resources = { en, de, es, fr, ja, ko, pt, ru, zh };
type Locale = keyof typeof resources;
const locales = Object.keys(resources) as Locale[];
const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const TX = { from: FROM, to: TO, value: '1', nonce: 0 };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSetNonce = jest.fn();
const mockOpenFee = jest.fn();
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
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    dismiss: (...args: any[]) => mockToast.dismiss(...args),
    info: (...args: any[]) => mockToast.info(...args),
    error: (...args: any[]) => mockToast.error(...args),
    success: (...args: any[]) => mockToast.success(...args),
  }),
}));
// Use the package's real CJS colors, keeping real Icon glyphs and SVG-image
// alt text, native IconButton, Tooltip and actual AntD number Input unchanged.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);

const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout; no geometry claim is made here.
    }
    unobserve() {
      // JSDOM has no layout.
    }
    disconnect() {
      // JSDOM has no layout.
    }
  } as typeof ResizeObserver;
  (globalThis as any).MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  };
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(async (path: string[], params: unknown[]) => {
    if (
      JSON.stringify(path) ===
        JSON.stringify(['wallet', 'checkAddressBlacklist']) &&
      JSON.stringify(params) === JSON.stringify([TO])
    )
      return { isBlacklisted: false };
    throw new Error('Unexpected controller action: ' + path.join('.'));
  });
  store.dispatch(
    restoreVaultSnapshot({
      ...clone(initialVault),
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        currency: 'eth',
        label: 'Public review fixture',
        url: 'https://public-review.invalid',
      },
      accounts: {
        ...initialVault.accounts,
        HDAccount: {
          0: { ...initialVault.accounts.HDAccount[0], id: 0, address: FROM },
        },
      },
    })
  );
  stateBefore = JSON.stringify(store.getState());
});
afterEach(() => {
  cleanup();
  expect(JSON.stringify(store.getState())).toBe(stateBefore);
  expect(TX).toEqual({ from: FROM, to: TO, value: '1', nonce: 0 });
  // Public blacklist reads only: no signing, broadcast, persistence,
  // account/network changes or navigation are reachable from these actions.
  for (const [path, params] of mockEmitter.mock.calls) {
    expect(path).toEqual(['wallet', 'checkAddressBlacklist']);
    expect(params).toEqual([TO]);
  }
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

function Review({ editingDisabled }: { editingDisabled: boolean }) {
  const [nonce, setNonce] = useState<number>();
  return (
    <TransactionDetailsComponent
      tx={TX as any}
      decodedTx={{ method: 'Transfer' } as any}
      fee={{
        baseFee: 1,
        gasLimit: 21000,
        maxFeePerGas: 2,
        maxPriorityFeePerGas: 1,
      }}
      customFee={{
        isCustom: false,
        gasLimit: 0,
        gasPrice: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      }}
      customNonce={nonce}
      editingDisabled={editingDisabled}
      setCustomFee={jest.fn()}
      setCustomNonce={(value) => {
        const next =
          typeof value === 'function' ? value(nonce ?? TX.nonce) : value;
        mockSetNonce(next);
        setNonce(next);
      }}
      setFee={jest.fn()}
      setHaveError={jest.fn()}
      setIsOpen={mockOpenFee}
    />
  );
}

async function prepare(locale: Locale, editingDisabled = false) {
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
  // Forward into userEvent's disposable clipboard. The real copy hook writes
  // and readText observes exact public bytes; no copy callback is substituted.
  const writeText = jest.spyOn(navigator.clipboard, 'writeText');
  render(
    <Provider store={store}>
      <I18nextProvider i18n={instance}>
        <Review editingDisabled={editingDisabled} />
      </I18nextProvider>
    </Provider>
  );
  expect(instance.language).toBe(locale);
  expect(screen.getByText(resources[locale].send.from)).toBeVisible();
  expect(screen.getByText(resources[locale].send.to)).toBeVisible();
  expect(screen.getByText(resources[locale].send.customNonce)).toBeVisible();
  expect(
    screen.getByRole('button', { name: resources[locale].send.editFee })
  ).toBeInTheDocument();
  const icons = screen.getAllByRole('img', { name: 'Copy' });
  expect(icons).toHaveLength(2);
  const buttons = icons.map((icon) => icon.closest('button')!);
  for (const button of buttons) {
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button).toBeEnabled();
  }
  return { user, writeText, buttons };
}

describe.each(locales)(
  'ordinary transaction Details purposes in %s',
  (locale) => {
    it('preserves exact From and To bytes with both pointer and native Enter Copy', async () => {
      const { user, writeText, buttons } = await prepare(locale);
      for (const [index, button] of buttons.entries()) {
        const address = index === 0 ? FROM : TO;
        await user.click(button);
        expect(await navigator.clipboard.readText()).toBe(address);
        button.focus();
        expect(button).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(await navigator.clipboard.readText()).toBe(address);
      }
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(4));
      expect(writeText.mock.calls).toEqual([[FROM], [FROM], [TO], [TO]]);
      expect(mockSetNonce).not.toHaveBeenCalled();
      expect(mockOpenFee).not.toHaveBeenCalled();
    });

    it.each([0, 1])(
      'names Copy field %s with the selected locale',
      async (index) => {
        const { buttons, writeText } = await prepare(locale);
        expect(writeText).not.toHaveBeenCalled();
        expect(buttons[index]).toHaveAccessibleName(
          locale === 'en' ? /^copy$/i : resources[locale].buttons.copy
        );
      }
    );

    it('names the actual nonce Input by its localized purpose, not just its placeholder value', async () => {
      await prepare(locale);
      const nonce = screen.getByRole('spinbutton');
      expect(nonce).toHaveValue(0);
      expect(nonce).toHaveAttribute('placeholder', '0');
      // This is the expected semantic contract, not a claim about Chromium's
      // current placeholder fallback. Root separately verifies actual browser AX.
      expect(nonce).toHaveAccessibleName(resources[locale].send.customNonce);
    });

    it('preserves nonce zero and deliberate edits while keeping raw addresses unchanged', async () => {
      const { user, writeText } = await prepare(locale);
      const nonce = screen.getByRole('spinbutton');
      expect(nonce).toHaveValue(0);
      await user.clear(nonce);
      await user.type(nonce, '7');
      expect(nonce).toHaveValue(7);
      expect(mockSetNonce).toHaveBeenLastCalledWith(7);
      await user.clear(nonce);
      await user.type(nonce, '0');
      expect(nonce).toHaveValue(0);
      expect(mockSetNonce).toHaveBeenLastCalledWith(0);
      expect(writeText).not.toHaveBeenCalled();
      expect(mockOpenFee).not.toHaveBeenCalled();
    });

    it('keeps fee and nonce editing disabled without disabling public Copy', async () => {
      const { user, writeText, buttons } = await prepare(locale, true);
      const nonce = screen.getByRole('spinbutton');
      const fee = screen.getByRole('button', {
        name: resources[locale].send.editFee,
      });
      expect(nonce).toBeDisabled();
      expect(fee).toBeDisabled();
      await user.type(nonce, '7');
      await user.click(fee);
      expect(nonce).toHaveValue(0);
      expect(mockSetNonce).not.toHaveBeenCalled();
      expect(mockOpenFee).not.toHaveBeenCalled();
      await user.click(buttons[0]);
      expect(await navigator.clipboard.readText()).toBe(FROM);
      expect(writeText.mock.calls).toEqual([[FROM]]);
    });
  }
);
