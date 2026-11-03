/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { webcrypto } from 'crypto';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';

import ImportPhrase from './ImportPhrase';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn() },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
const mockEmitter = jest.fn();
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  LogoHeader: () => null,
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => null,
  QuestionCircleOutlined: () => null,
}));
// Only the unrelated modal presentation is isolated. Its supplied translated
// title/description are retained; the actual Ant Form error list is not mocked.
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, title, description }: any) =>
    show ? (
      <aside aria-label="Word count guidance">
        <h2>{title}</h2>
        <p>{description}</p>
      </aside>
    ) : null,
}));

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
type Locale = keyof typeof resources;
const locales = Object.keys(resources) as Locale[];
// Published BIP39 all-zero entropy test vectors, never a user wallet secret.
const VALID12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VALID24 = `${'abandon '.repeat(23)}art`;
const BAD_CHECKSUM = 'abandon '.repeat(12).trim();
const BAD_LENGTH = 'abandon about';
const originalChrome = global.chrome;
const originalFetch = global.fetch;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalMessageChannel = globalThis.MessageChannel;
const originalResize = globalThis.ResizeObserver;
const originalUint8Array = globalThis.Uint8Array;
const originalSetImmediate = globalThis.setImmediate;
const originalClearImmediate = globalThis.clearImmediate;
let wallet: any;
let keyring: any;
let holdRead: null | { held: boolean; release: () => void };
let seenMethods: string[];
let observedBoundary:
  | { hasDraft: boolean; hasTicket: boolean; path: string }
  | undefined;
let expectedBoundary: { hasDraft: boolean; hasTicket: boolean; path: string };
let draftMatchesPublicVector = false;

const Probe = () => {
  const { secrets } = useOnboardingSecrets();
  const location = useLocation();
  draftMatchesPublicVector = secrets.phrase === VALID12;
  observedBoundary = {
    path: location.pathname,
    hasDraft: Boolean(secrets.phrase),
    hasTicket: Boolean(secrets.recoveryTicket),
  };
  return (
    <output aria-label="Public onboarding boundary">
      {JSON.stringify(observedBoundary)}
    </output>
  );
};

const mount = async (locale: Locale) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
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
  render(
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <OnboardingSecretsProvider>
          <Routes>
            <Route path="/import" element={<ImportPhrase />} />
          </Routes>
          <Probe />
        </OnboardingSecretsProvider>
      </BrowserRouter>
    </I18nextProvider>
  );
  expect(i18n.resolvedLanguage).toBe(locale);
  expect(
    screen.getByRole('heading', { name: resources[locale].titles.importWallet })
  ).toBeVisible();
  expect(
    screen.getByRole('textbox', {
      name: resources[locale].import.pasteYourWalletSeed,
    })
  ).toBeVisible();
  return { user: userEvent.setup(), i18n };
};
const button = (locale: Locale) =>
  screen.getByRole('button', { name: resources[locale].buttons.import });
const input = () => screen.getByRole('textbox');
const enter = async (
  user: ReturnType<typeof userEvent.setup>,
  value: string
) => {
  await user.clear(input());
  if (value) {
    await user.click(input());
    await user.paste(value);
  }
};
const readError = async () => {
  await waitFor(() => {
    const text = document.querySelector(
      '.ant-form-item-explain-error'
    )?.textContent;
    expect(Boolean(text)).toBe(true);
  });
  return document.querySelector('.ant-form-item-explain-error')!.textContent;
};
beforeEach(() => {
  jest.clearAllMocks();
  seenMethods = [];
  observedBoundary = undefined;
  draftMatchesPublicVector = false;
  expectedBoundary = { path: '/import', hasDraft: false, hasTicket: false };
  window.history.replaceState(null, '', '/import');
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as any;
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
  globalThis.setImmediate = jest.requireActual('timers').setImmediate;
  globalThis.clearImmediate = jest.requireActual('timers').clearImmediate;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
  globalThis.ResizeObserver = class {
    observe() {
      /* Native jsdom has no layout observation. */
    }
    unobserve() {
      /* Native jsdom has no layout observation. */
    }
    disconnect() {
      /* Native jsdom has no layout observation. */
    }
  } as any;
  global.fetch = jest.fn(() => {
    throw new Error('This validation matrix must not request HTTP');
  }) as any;
  const denyStorage = () => {
    throw new Error('This validation matrix must not write storage');
  };
  chrome.storage.local.set = jest.fn(denyStorage) as any;
  chrome.storage.local.remove = jest.fn(denyStorage) as any;
  // Load SDK crypto only after aligning jsdom's byte-array realm with Node.
  // No validation implementation or result is substituted.
  const { KeyringManager } = jest.requireActual('@sidhujag/sysweb3-keyring');
  const MainController = jest.requireActual(
    'scripts/Background/controllers/MainController'
  ).default;
  // Validation is stateless; reuse one read-only SDK instance rather than
  // registering an unrelated set of hardware listeners for every locale.
  keyring = keyring || new KeyringManager();
  wallet = Object.create(MainController.prototype);
  wallet.getActiveKeyring = () => keyring;
  seenMethods = [];
  holdRead = null;
  mockEmitter.mockImplementation((method: string[], [phrase]: string[]) => {
    expect(method).toEqual(['wallet', 'isSeedValid']);
    seenMethods.push(method.join('.'));
    // Preserve actual MainController -> installed SDK result, optionally delaying
    // only the acknowledgement to challenge current-input retirement.
    const actual = wallet.isSeedValid(phrase);
    if (holdRead && !holdRead.held) {
      holdRead.held = true;
      return new Promise<boolean>((resolve) => {
        holdRead!.release = () => resolve(actual);
      });
    }
    return Promise.resolve(actual);
  });
});

afterEach(() => {
  expect(seenMethods.every((method) => method === 'wallet.isSeedValid')).toBe(
    true
  );
  expect(global.fetch).not.toHaveBeenCalled();
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
  expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  // RTL's registered auto-cleanup can precede this hook. Assert the real last
  // public provider projection, rather than query an already-unmounted DOM.
  expect(observedBoundary).toEqual(expectedBoundary);
  cleanup();
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResize;
  globalThis.Uint8Array = originalUint8Array;
  globalThis.setImmediate = originalSetImmediate;
  globalThis.clearImmediate = originalClearImmediate;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

describe('recovery phrase validation localization', () => {
  it.each(locales)(
    'shows the %s checksum error after genuine translated input labels',
    async (locale) => {
      const { user } = await mount(locale);
      await enter(user, BAD_CHECKSUM);
      const message = await readError();
      expect(mockEmitter).toHaveBeenCalled();
      expect(button(locale)).toBeDisabled();
      // The same existing guidance key is shown in every supported UI locale.
      expect(message).toBe(resources[locale].seedConfirm.seedError);
    }
  );

  it.each(locales)(
    'shows the %s length guidance with the exact entered count',
    async (locale) => {
      const { user, i18n } = await mount(locale);
      await enter(user, BAD_LENGTH);
      const message = await readError();
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(button(locale)).toBeDisabled();
      await user.tab();
      expect(
        screen.getByRole('heading', {
          name: resources[locale].import.importModalWordMissing,
        })
      ).toBeVisible();
      const expected = i18n.t('import.importModalSeed', { seedLength: 2 });
      expect(
        within(screen.getByLabelText('Word count guidance')).getByText(expected)
      ).toBeVisible();
      expect(message).toBe(expected);
    }
  );

  it.each([VALID12, VALID24])(
    'healthy published checksum enables validation, clearing disables it (case %#)',
    async (phrase) => {
      const { user } = await mount('en');
      await enter(user, phrase);
      await waitFor(() => expect(button('en')).toBeEnabled());
      expect(document.querySelector('.ant-form-item-explain-error')).toBeNull();
      await enter(user, '');
      await waitFor(() => expect(button('en')).toBeDisabled());
    }
  );

  it('healthy normalization stays valid without submitting or storing a phrase', async () => {
    const { user } = await mount('de');
    await enter(user, `  ${VALID12.toUpperCase().replace(/ /g, '  ')}  `);
    await waitFor(() => expect(button('de')).toBeEnabled());
    // AntD normalizes its form value, not the nested uncontrolled textarea.
    // Check the actual argument admitted to MainController/SDK, no phrase echo.
    expect(mockEmitter.mock.calls.some(([, args]) => args[0] === VALID12)).toBe(
      true
    );
  });

  it('accepts pasted recovery words separated by line breaks and other whitespace', async () => {
    const { user } = await mount('en');
    for (const separator of ['\n', '\r\n', '\t', '\u00a0']) {
      mockEmitter.mockClear();
      await enter(user, VALID12.replace(/ /g, separator));
      await waitFor(() => expect(button('en')).toBeEnabled());
      expect(
        mockEmitter.mock.calls.some(([, args]) => args[0] === VALID12)
      ).toBe(true);
    }
  });

  it('hands the normalized pasted phrase to the import flow after submission', async () => {
    const { user } = await mount('en');
    await enter(user, VALID12.replace(/ /g, '\n'));
    await waitFor(() => expect(button('en')).toBeEnabled());
    await user.click(button('en'));
    expectedBoundary = {
      path: '/create-password-import',
      hasDraft: true,
      hasTicket: false,
    };
    await waitFor(() => expect(observedBoundary).toEqual(expectedBoundary));
    expect(mockEmitter.mock.calls.at(-1)?.[1][0]).toBe(VALID12);
    expect(draftMatchesPublicVector).toBe(true);
  });

  it.each(['clear', 'invalid replacement'])(
    'healthy stale valid acknowledgement cannot re-enable after %s',
    async (change) => {
      const { user } = await mount('fr');
      holdRead = { held: false, release: () => undefined };
      await enter(user, VALID12);
      await waitFor(() => expect(holdRead!.held).toBe(true));
      await enter(user, change === 'clear' ? '' : BAD_CHECKSUM);
      if (change !== 'clear') await readError();
      await act(async () => holdRead!.release());
      await waitFor(() => expect(button('fr')).toBeDisabled());
    }
  );
});
