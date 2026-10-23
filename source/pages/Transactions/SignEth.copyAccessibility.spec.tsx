/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';

import EthSign from './SignEth';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const MESSAGE = 'Review this public clipboard fixture.';
const resources = { en, de, fr };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockToast = Object.assign(jest.fn(), {
  dismiss: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
});
let mockState: any;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/index', () => ({
  useQueryData: jest.requireActual('hooks/useQuery').useQueryData,
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => mockNavigate,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign((...args: any[]) => mockToast(...args), {
    dismiss: (...args: any[]) => mockToast.dismiss(...args),
    error: (...args: any[]) => mockToast.error(...args),
    info: (...args: any[]) => mockToast.info(...args),
    success: (...args: any[]) => mockToast.success(...args),
    warn: (...args: any[]) => mockToast.warn(...args),
  }),
}));
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/errorHandling', () => ({ handleTransactionError: jest.fn() }));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('utils/smartAccount', () => ({}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
// Resolve the package's real CJS colors without substituting the Icon glyph or
// its accessible name. The native Button and IconButton are also unmodified.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: jest.requireActual('components/Icon/Icon').Icon,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  ErrorModal: ({ show, log }: any) =>
    show ? <div role="alert">{log}</div> : null,
  WarningModal: () => null,
  DeviceWaitingBanner: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: ADDRESS,
            balances: { ethereum: '1' },
            label: 'Public clipboard fixture',
          },
        },
      },
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { currency: 'ETH', chainId: 1 },
      isBitcoinBased: false,
    },
  };
  mockEmitter.mockImplementation(async (path: string[]) => {
    throw new Error(`No controller calls allowed: ${path.join('.')}`);
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  // Copying public review text must not authorize, sign, deliver or close it.
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(createTemporaryAlarm).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

describe.each(['en', 'de', 'fr'] as const)(
  'personal_sign preview Copy in %s',
  (locale) => {
    it.each(['plaintext', 'hex'] as const)(
      'names the native %s copy action locally without changing copied text or request identity',
      async (encoding) => {
        const payload =
          encoding === 'hex'
            ? `0x${Buffer.from(MESSAGE).toString('hex')}`
            : MESSAGE;
        const request = {
          host: 'https://public-copy.example',
          eventName: 'personal_sign',
          0: payload,
          1: ADDRESS,
        };
        const serialized = JSON.stringify(request);
        const stateBefore = JSON.stringify(mockState);
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
        // userEvent supplies JSDOM's disposable clipboard. This spy forwards to
        // it: the real useCopyClipboard hook invokes writeText and readText
        // observes the resulting bytes, with no replacement copy callback.
        const user = userEvent.setup();
        const writeText = jest.spyOn(navigator.clipboard, 'writeText');
        const { container } = render(
          <I18nextProvider i18n={instance}>
            <MemoryRouter
              initialEntries={[
                `/external/eth-sign?data=${encodeURIComponent(serialized)}`,
              ]}
            >
              <EthSign />
            </MemoryRouter>
          </I18nextProvider>
        );
        expect(
          await screen.findByRole('heading', {
            name: resources[locale].send.signPersonalMessage,
          })
        ).toBeVisible();
        expect(screen.getByText(resources[locale].send.message)).toBeVisible();
        expect(container.querySelector('p.font-mono')?.textContent).toBe(
          MESSAGE
        );
        expect(screen.queryByRole('alert')).toBeNull();
        const icon = screen.getByRole('img', { name: 'copy' });
        const copyButton = icon.closest('button')!;
        expect(copyButton).toBeInstanceOf(HTMLButtonElement);
        expect(copyButton).toBeEnabled();
        await user.click(copyButton);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(await navigator.clipboard.readText()).toBe(MESSAGE);
        copyButton.focus();
        expect(copyButton).toHaveFocus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
        expect(writeText.mock.calls).toEqual([[MESSAGE], [MESSAGE]]);
        expect(await navigator.clipboard.readText()).toBe(MESSAGE);
        expect(JSON.stringify(request)).toBe(serialized);
        expect(JSON.stringify(mockState)).toBe(stateBefore);
        expect(instance.language).toBe(locale);
        // All pointer/keyboard, clipboard and identity controls precede this
        // locale-only assertion so their healthy behavior survives a failure.
        expect(copyButton).toHaveAccessibleName(
          locale === 'en' ? /^copy$/i : resources[locale].buttons.copy
        );
      }
    );
  }
);
