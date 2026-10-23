/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { clearRpcCaches, getEthRpc } from '@sidhujag/sysweb3-network';
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

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
type Locale = keyof typeof resources;
const locales = Object.keys(resources) as Locale[];
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = { pathname: '/settings/networks/custom-rpc', state: {} };
const mockState = {
  vaultGlobal: { networks: { syscoin: {}, ethereum: {} } },
};
const rpcUrl = 'http://127.0.0.1:18545';
const englishGuidance = en.settings.positiveChainId;
const originalMessageChannel = globalThis.MessageChannel;
const originalFetch = globalThis.fetch;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('hooks/index', () => ({
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
    account: 'public-chain-id-fixture',
    network: 'public-chain-id-fixture',
  }),
  navigateBack: jest.fn(),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, type, onClick }: any) => (
    <button disabled={disabled} type={type} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children,
}));

beforeEach(() => {
  clearCustomRpcDrafts();
  clearRpcCaches();
  jest.clearAllMocks();
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  // Only public HTTP I/O is synthetic. The real installed SDK independently
  // detects 31337, rather than taking the user's typed Chain ID as its result.
  globalThis.fetch = jest.fn(async (url, options) => {
    expect(url).toBe(rpcUrl);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      method: 'eth_chainId',
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x7a69' }),
    } as Response;
  });
  mockEmitter.mockImplementation(async ([area, method], args) => {
    expect(area).toBe('wallet');
    if (method === 'getChainData') return [];
    if (method === 'getRpc')
      return (await getEthRpc(args[0], false)).formattedNetwork;
    if (method === 'addCustomRpc') return undefined;
    throw new Error(`Unexpected synthetic controller method: ${method}`);
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  clearRpcCaches();
  clearCustomRpcDrafts();
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.fetch = originalFetch;
});

const saves = () =>
  mockEmitter.mock.calls.filter(([[, method]]) => method === 'addCustomRpc');

const prepareForm = async (locale: Locale, chainId: string) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
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
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <CustomRPC />
    </I18nextProvider>
  );
  expect(i18n.resolvedLanguage).toBe(locale);
  const translation = resources[locale];
  // Verify the real document has this locale, not a missing/fallback form.
  expect(
    screen.getByText(translation.settings.blockExplorerApiUrl)
  ).toBeVisible();
  const name = screen.getByRole('combobox', {
    name: translation.settings.label,
  });
  await user.type(name, 'Public chain');
  await user.type(
    screen.getByPlaceholderText(translation.settings.rpcUrlPlaceholder),
    rpcUrl
  );
  await user.tab();
  const input = screen.getByPlaceholderText(
    translation.settings.chainIdCustomEvm
  );
  expect(input).toHaveAttribute('type', 'text');
  await waitFor(() => expect(input).toHaveValue('31337'));
  await user.clear(input);
  if (chainId) await user.type(input, chainId);
  await user.type(
    screen.getByPlaceholderText(translation.settings.symbol),
    'ETH'
  );
  return {
    user,
    input,
    save: screen.getByRole('button', { name: translation.buttons.save }),
    translation,
    i18n,
  };
};

it.each(locales)(
  '%s healthy: empty Chain ID uses localized required guidance and does not save',
  async (locale) => {
    const { user, input, save, translation } = await prepareForm(locale, '');
    await user.click(save);
    expect(
      await screen.findByText(translation.settings.chainIdRequired)
    ).toBeVisible();
    expect(input).toHaveValue('');
    expect(saves()).toHaveLength(0);
    expect(mockAlert.success).not.toHaveBeenCalled();
    if (locale !== 'en')
      expect(
        screen.queryByText(en.settings.chainIdRequired)
      ).not.toBeInTheDocument();
  }
);

it.each(locales)(
  '%s invalid Chain ID retains draft and refuses saving with locale-aware guidance',
  async (locale) => {
    const { user, input, save } = await prepareForm(locale, '31337.5');
    await user.click(save);
    const actualError = await screen.findByText(
      resources[locale].settings.positiveChainId
    );
    expect(actualError).toBeVisible();
    expect(input).toHaveValue('31337.5');
    expect(saves()).toHaveLength(0);
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(actualError).toHaveTextContent(
      resources[locale].settings.positiveChainId
    );
    if (locale !== 'en')
      expect(screen.queryByText(englishGuidance)).not.toBeInTheDocument();
  }
);

it.each(['31337', ' 31337 '])(
  'healthy: valid Chain ID %j saves the SDK-detected exact integer',
  async (chainId) => {
    const { user, save, translation } = await prepareForm('fr', chainId);
    await user.click(save);
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0][1]).toEqual([
      expect.objectContaining({ chainId: 31337, url: rpcUrl }),
    ]);
    expect(mockAlert.success).toHaveBeenCalledWith(
      translation.settings.rpcSuccessfullyAdded
    );
    expect(screen.queryByText(englishGuidance)).not.toBeInTheDocument();
  }
);

it('healthy: invalid input can be corrected before normal save', async () => {
  const { user, input, save } = await prepareForm('de', '31337.5');
  await user.click(save);
  expect(await screen.findByText(de.settings.positiveChainId)).toBeVisible();
  expect(saves()).toHaveLength(0);
  await user.clear(input);
  await user.type(input, '31337');
  await user.click(save);
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0][1][0].chainId).toBe(31337);
  expect(
    screen.queryByText(de.settings.positiveChainId)
  ).not.toBeInTheDocument();
});

it('healthy: a valid integer different from the RPC chain stays refused', async () => {
  const { user, input, save, i18n } = await prepareForm('fr', '31338');
  await user.click(save);
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      i18n.t('settings.chainIdMismatch', { actual: 31337, expected: 31338 }),
      expect.objectContaining({ autoClose: 4000 })
    )
  );
  expect(input).toHaveValue('31338');
  expect(saves()).toHaveLength(0);
  expect(mockAlert.success).not.toHaveBeenCalled();
});
