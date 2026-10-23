/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches } from '@sidhujag/sysweb3-network';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';
import ExternalAddRPC from 'pages/Settings/ExternalAddRPC';
import MainController from 'scripts/Background/controllers/MainController';
import { translateRpcValidationError } from 'utils/rpcValidationError';

// Product form components, Ant Form, i18next, MainController.getRpc, installed
// sysweb3-network and fetch-error propagation are real. Only HTTP responses,
// controller transport, surrounding presentation and routing are synthetic.
// The original pre-fix probe is retained separately and unchanged.
const resources = { en, de, es, fr, ja, ko, pt, ru, zh };
type Locale = keyof typeof resources;
type FormKind = 'ordinary' | 'external';
const localeCases = Object.keys(resources) as Locale[];
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = { pathname: '/settings/networks/custom-rpc', state: {} };
const mockState = { vaultGlobal: { networks: { syscoin: {}, ethereum: {} } } };
let mockProposal: any;
const AUTH = 'http://127.0.0.1:18545/auth-required';
const HEALTHY = 'http://127.0.0.1:18545/healthy';
const UNKNOWN = 'http://127.0.0.1:18545/unknown-error';
const AUTH_GUIDANCE =
  'This RPC endpoint requires authentication. Please use an RPC URL that includes your API key or choose a different provider.';
const RAW_PROVIDER_BODY =
  'provider-validation-marker: endpoint unavailable for this request';
const RAW_PROVIDER_ERROR = `HTTP error! Status: 400. Details: ${RAW_PROVIDER_BODY}`;
const originalFetch = globalThis.fetch;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
let reads: { method: string; url: string }[];

jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockProposal,
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { subscribe: () => () => undefined },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'public-fixture',
    network: 'public-fixture',
  }),
  navigateBack: jest.fn(),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: ({ children }: any) => children,
}));

beforeEach(() => {
  jest.clearAllMocks();
  clearRpcCaches();
  clearCustomRpcDrafts();
  reads = [];
  mockProposal = {
    host: 'https://dapp.synthetic.invalid',
    eventName: 'wallet_addEthereumChain',
    chainConfig: {
      chainId: '0x7a69',
      chainName: 'Public fixture',
      rpcUrls: [AUTH],
      nativeCurrency: { name: 'Synthetic', symbol: 'TST', decimals: 18 },
    },
  };
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as any;
  globalThis.fetch = jest.fn(async (input, options) => {
    const url = String(input);
    expect([AUTH, HEALTHY, UNKNOWN]).toContain(url);
    const body = JSON.parse(String(options?.body));
    expect(body.method).toBe('eth_chainId');
    expect(body.params).toEqual([]);
    reads.push({ method: body.method, url });
    const status = url === AUTH ? 401 : url === UNKNOWN ? 400 : 200;
    return {
      ok: status === 200,
      status,
      text: async () => (url === AUTH ? 'unauthorized' : RAW_PROVIDER_BODY),
      json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x7a69' }),
    } as Response;
  });
  const controller = Object.create(MainController.prototype);
  mockEmitter.mockImplementation(async ([area, method], args) => {
    expect(area).toBe('wallet');
    if (method === 'getChainData') return [];
    if (method === 'getRpc') return controller.getRpc(...args);
    throw new Error('Regression does not admit mutations: ' + method);
  });
});

afterEach(() => {
  cleanup();
  clearRpcCaches();
  clearCustomRpcDrafts();
  globalThis.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

async function show(kind: FormKind, locale: Locale, proposedChainId = 31337) {
  mockProposal.chainConfig.chainId = `0x${proposedChainId.toString(16)}`;
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    initImmediate: false,
    lng: locale,
    resources: { [locale]: { translation: resources[locale] } },
    react: { useSuspense: false },
  });
  render(
    <I18nextProvider i18n={i18n}>
      {kind === 'ordinary' ? <CustomRPC /> : <ExternalAddRPC />}
    </I18nextProvider>
  );
  const user = userEvent.setup();
  const text = resources[locale];
  expect(i18n.resolvedLanguage).toBe(locale);
  if (kind === 'ordinary')
    expect(screen.getByText(text.settings.blockExplorerApiUrl)).toBeVisible();
  else
    expect(screen.getByPlaceholderText(text.settings.networkName)).toHaveValue(
      'Public fixture'
    );
  if (kind === 'ordinary') {
    await user.type(
      screen.getByRole('combobox', { name: text.settings.label }),
      'Public fixture'
    );
    await user.type(screen.getByPlaceholderText(text.settings.symbol), 'TST');
    await user.type(
      screen.getByPlaceholderText(text.settings.chainIdCustomEvm),
      String(proposedChainId)
    );
  }
  const url = screen.getByPlaceholderText(text.settings.rpcUrlPlaceholder);
  const save = screen.getByRole('button', {
    name: kind === 'ordinary' ? text.buttons.save : text.buttons.addNetwork,
  });
  const enterUrl = async (value: string) => {
    await user.clear(url);
    await user.type(url, value);
    await user.tab();
  };
  return { user, text, i18n, url, save, enterUrl };
}

const mutationCalls = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => !['getChainData', 'getRpc'].includes(method)
  );

describe.each<FormKind>(['ordinary', 'external'])(
  '%s RPC authentication feedback',
  (kind) => {
    it.each(localeCases)(
      '%s uses localized guidance, refuses saving and recovers with a healthy URL',
      async (locale) => {
        const { user, text, url, save, enterUrl } = await show(kind, locale);
        const expected = (
          text.settings as typeof text.settings & {
            rpcAuthenticationRequired: string;
          }
        ).rpcAuthenticationRequired;
        expect(typeof expected).toBe('string');
        expect(expected.trim()).not.toBe('');
        await enterUrl(AUTH);
        expect(await screen.findByText(expected)).toBeVisible();
        expect(url).toHaveValue(AUTH);
        if (locale !== 'en')
          expect(screen.queryByText(AUTH_GUIDANCE)).toBeNull();
        if (kind === 'ordinary')
          expect(mockAlert.error).toHaveBeenCalledWith(expected, {
            autoClose: 4000,
          });
        await user.click(save);
        await waitFor(() => expect(save).toBeEnabled());
        expect(await screen.findByText(expected)).toBeVisible();
        expect(mutationCalls()).toEqual([]);
        await enterUrl(HEALTHY);
        await waitFor(() => expect(screen.queryByText(expected)).toBeNull());
        const chainId = screen.getByPlaceholderText(
          kind === 'ordinary'
            ? text.settings.chainIdCustomEvm
            : text.settings.chainIdCannotBeEdited
        );
        expect(chainId).toHaveValue('31337');
        expect(save).toBeEnabled();
        expect(reads.some((read) => read.url === AUTH)).toBe(true);
        expect(reads.some((read) => read.url === HEALTHY)).toBe(true);
        expect(mutationCalls()).toEqual([]);
        expect(mockAlert.success).not.toHaveBeenCalled();
      }
    );

    it('preserves an unknown provider diagnostic verbatim', async () => {
      const { enterUrl } = await show(kind, 'es');
      await enterUrl(UNKNOWN);
      expect(await screen.findByText(RAW_PROVIDER_ERROR)).toBeVisible();
      if (kind === 'ordinary')
        expect(mockAlert.error).toHaveBeenCalledWith(RAW_PROVIDER_ERROR, {
          autoClose: 4000,
        });
      expect(mutationCalls()).toEqual([]);
    });

    it('retains the form-owned localized chain mismatch over a raw error', async () => {
      const { text, i18n, enterUrl } = await show(kind, 'fr', 31338);
      await enterUrl(HEALTHY);
      const expected = i18n.t('settings.chainIdMismatch', {
        actual: 31337,
        expected: 31338,
      });
      expect(await screen.findByText(expected)).toBeVisible();
      expect(
        screen.queryByText(
          'Chain ID mismatch: RPC reports 31337, but you entered 31338'
        )
      ).toBeNull();
      expect(screen.queryByText(text.settings.failedValidateRpc)).toBeNull();
      expect(mutationCalls()).toEqual([]);
    });
  }
);

describe('exact app-owned authentication message mapping', () => {
  it.each(localeCases)(
    '%s maps only the known app guidance',
    async (locale) => {
      const i18n = createInstance();
      await i18n.init({
        initImmediate: false,
        lng: locale,
        resources: { [locale]: { translation: resources[locale] } },
      });
      const expected = (
        resources[locale]
          .settings as (typeof resources)[typeof locale]['settings'] & {
          rpcAuthenticationRequired: string;
        }
      ).rpcAuthenticationRequired;
      expect(translateRpcValidationError(AUTH_GUIDANCE, i18n.t)).toBe(expected);
      for (const diagnostic of [
        RAW_PROVIDER_ERROR,
        `Prefix: ${AUTH_GUIDANCE}`,
        `${AUTH_GUIDANCE} Provider-specific detail`,
        'RPC provider: unauthorized',
      ]) {
        expect(translateRpcValidationError(diagnostic, i18n.t)).toBe(
          diagnostic
        );
      }
    }
  );
});
