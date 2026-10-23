/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import en from 'assets/locales/en.json';
import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';

// Actual CustomRPC, antd Form/Input/feedback, translations, buttons and modal.
// Only app integration boundaries are synthetic: a stable route/scope, empty
// catalogue, and the controller's public read/reply and save acknowledgement.
const RPC = 'https://unchanged-rpc.synthetic.invalid';
const EDITED_RPC = 'https://edited-rpc.synthetic.invalid';
const SINGLE_LABEL_RPC = 'http://internalnode';
const FAILURE = 'Synthetic provider temporarily unavailable';
const mockLocation = {
  key: 'stable-custom-rpc-route',
  pathname: '/settings/networks/custom-rpc',
  search: '',
  hash: '',
  state: {} as Record<string, unknown>,
};
const mockScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateBack = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockState = { vaultGlobal: { networks: { syscoin: {}, ethereum: {} } } };
let failureBudget: number;
let mockRpcOverride: ((data: any) => Promise<any>) | undefined;
let i18n: ReturnType<typeof createInstance>;
let reads: Array<{ outcome: string; url: string }>;
let saves: Array<Record<string, unknown>>;
let unexpectedFetches: string[];
const originalFetch = globalThis.fetch;
const originalMessageChannel = globalThis.MessageChannel;
const originalResizeObserver = globalThis.ResizeObserver;
const observations: Array<Record<string, unknown>> = [];

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
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { subscribe: () => () => undefined },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
  navigateBack: (...args: any[]) => mockNavigateBack(...args),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
}));
// This is the real CJS implementation of the ESM subpath used by icon CJS.
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);

beforeEach(async () => {
  clearCustomRpcDrafts();
  jest.clearAllMocks();
  failureBudget = 1;
  mockRpcOverride = undefined;
  reads = [];
  saves = [];
  unexpectedFetches = [];
  mockLocation.state = {};
  window.history.replaceState({}, '', '/app.html');
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  globalThis.fetch = jest.fn(async (input) => {
    unexpectedFetches.push(String(input));
    throw new Error('Unexpected network access from native fixture');
  });
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as any;
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as any;
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    initImmediate: false,
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: true },
    react: { useSuspense: false },
  });
  mockEmitter.mockImplementation(async ([family, method], args) => {
    expect(family).toBe('wallet');
    if (method === 'getChainData') return [];
    if (method === 'getRpc') {
      const data = args[0];
      expect([RPC, EDITED_RPC, SINGLE_LABEL_RPC]).toContain(data.url);
      if (mockRpcOverride) {
        const read = { url: data.url, outcome: 'pending' };
        reads.push(read);
        try {
          const network = await mockRpcOverride(data);
          read.outcome = 'success';
          return network;
        } catch (error) {
          read.outcome = 'rejected';
          throw error;
        }
      }
      if (failureBudget > 0) {
        failureBudget -= 1;
        reads.push({ url: data.url, outcome: 'rejected' });
        throw new Error(FAILURE);
      }
      reads.push({ url: data.url, outcome: 'success' });
      return networkFor(data);
    }
    if (method === 'addCustomRpc') {
      saves.push({ ...args[0] });
      return args[0];
    }
    throw new Error(`Unexpected controller call ${method}`);
  });
});

afterEach(() => {
  cleanup();
  expect(unexpectedFetches).toEqual([]);
  expect(
    mockEmitter.mock.calls.every(([[, method]]) =>
      ['getChainData', 'getRpc', 'addCustomRpc'].includes(method)
    )
  ).toBe(true);
  globalThis.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  jest.restoreAllMocks();
  clearCustomRpcDrafts();
});

const urlField = () =>
  screen.getByPlaceholderText(en.settings.rpcUrlPlaceholder);
const chainField = () =>
  screen.getByPlaceholderText(en.settings.chainIdCustomEvm);
const saveButton = () => screen.getByRole('button', { name: en.buttons.save });
const networkFor = (data: any) => ({
  chainId: 31337,
  kind: 'ethereum',
  slip44: 60,
  label: data.label,
  currency: data.symbol.toLowerCase(),
  url: data.url,
  explorer: data.explorer,
  default: false,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const snapshot = () => ({
  url: (urlField() as HTMLInputElement).value,
  chainId: (chainField() as HTMLInputElement).value,
  invalid: urlField().getAttribute('aria-invalid'),
  failureVisible: Boolean(screen.queryByText(FAILURE)),
  fieldText: urlField().closest('.ant-form-item')?.textContent,
  reads: [...reads],
  saves: [...saves],
});

async function openAndFailFirstBlur() {
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <CustomRPC />
    </I18nextProvider>
  );
  await user.type(
    screen.getByRole('combobox', { name: en.settings.label }),
    'Public native fixture'
  );
  await user.type(screen.getByPlaceholderText(en.settings.symbol), 'ETH');
  await user.type(urlField(), RPC);
  await user.tab();
  expect(await screen.findByText(FAILURE)).toBeVisible();
  expect(urlField()).toHaveAttribute('aria-invalid', 'true');
  expect(reads).toEqual([{ url: RPC, outcome: 'rejected' }]);
  expect(saves).toEqual([]);
  return user;
}

async function saveHealthyCurrentForm(
  user: ReturnType<typeof userEvent.setup>,
  expectedUrl: string
) {
  await user.click(saveButton());
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]).toMatchObject({ chainId: 31337, url: expectedUrl });
  expect(mockAlert.success).toHaveBeenCalledWith(
    en.settings.rpcSuccessfullyAdded
  );
  expect(mockNavigateBack).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByText(FAILURE)).toBeNull());
  expect(urlField()).not.toHaveAttribute('aria-invalid', 'true');
}

it('healthy: editing the URL clears old feedback and the fully validated form saves', async () => {
  const user = await openAndFailFirstBlur();
  await user.click(urlField());
  await user.clear(urlField());
  await user.type(urlField(), EDITED_RPC);
  await user.tab();
  await waitFor(() => expect(chainField()).toHaveValue('31337'));
  expect(reads).toEqual([
    { url: RPC, outcome: 'rejected' },
    { url: EDITED_RPC, outcome: 'success' },
  ]);
  expect(screen.queryByText(FAILURE)).toBeNull();
  expect(urlField()).not.toHaveAttribute('aria-invalid', 'true');
  observations.push({ phase: 'edited-recovery', ...snapshot() });
  await saveHealthyCurrentForm(user, EDITED_RPC);
});

it('a successful unchanged-URL blur retry clears the previous RPC failure before Save', async () => {
  const user = await openAndFailFirstBlur();
  await user.click(urlField());
  await user.tab();
  // This auto-filled value proves the second successful response passed the
  // actual operation guard and reached CustomRPC's success branch.
  await waitFor(() => expect(chainField()).toHaveValue('31337'));
  expect(reads).toEqual([
    { url: RPC, outcome: 'rejected' },
    { url: RPC, outcome: 'success' },
  ]);
  await waitFor(() => expect(screen.queryByText(FAILURE)).toBeNull());
  expect(urlField()).not.toHaveAttribute('aria-invalid', 'true');
  const recovered = snapshot();
  expect(recovered.url).toBe(RPC);
  expect(recovered.saves).toEqual([]);
  // Preserve and exercise the independent healthy full-validation recovery
  // before checking the captured inline error; no asserted failure is hidden.
  await saveHealthyCurrentForm(user, RPC);
  observations.push({
    phase: 'same-url-blur-recovery',
    recovered,
    afterSave: snapshot(),
  });
  console.info('custom_rpc_error_recovery=' + JSON.stringify(observations));
  expect({
    invalid: recovered.invalid,
    failureVisible: recovered.failureVisible,
  }).toEqual({
    invalid: null,
    failureVisible: false,
  });
});

it('retains a current RPC failure after another failed unchanged-URL retry', async () => {
  const user = await openAndFailFirstBlur();
  failureBudget = 1;
  await user.click(urlField());
  await user.tab();
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(reads.every((read) => read.outcome === 'rejected')).toBe(true);
  expect(screen.getByText(FAILURE)).toBeVisible();
  expect(urlField()).toHaveAttribute('aria-invalid', 'true');
  expect(saves).toEqual([]);
});

it('retains the localized chain mismatch instead of clearing it as successful validation', async () => {
  const user = await openAndFailFirstBlur();
  await user.type(chainField(), '31338');
  await user.click(urlField());
  await user.tab();
  const mismatch = en.settings.chainIdMismatch
    .replace('{{actual}}', '31337')
    .replace('{{expected}}', '31338');
  expect(await screen.findByText(mismatch)).toBeVisible();
  expect(chainField()).toHaveValue('31338');
  expect(urlField()).toHaveAttribute('aria-invalid', 'true');
  expect(saves).toEqual([]);
});

it('does not clear a replacement URL failure when an obsolete read succeeds', async () => {
  const user = await openAndFailFirstBlur();
  const pending = deferred<any>();
  let oldData: any;
  mockRpcOverride = async (data) => {
    oldData = data;
    return pending.promise;
  };
  await user.click(urlField());
  await user.tab();
  await waitFor(() => expect(reads[1]?.outcome).toBe('pending'));
  mockRpcOverride = undefined;
  failureBudget = 1;
  await user.click(urlField());
  await user.clear(urlField());
  await user.type(urlField(), EDITED_RPC);
  await user.tab();
  expect(await screen.findByText(FAILURE)).toBeVisible();
  await act(async () => pending.resolve(networkFor(oldData)));
  expect(urlField()).toHaveValue(EDITED_RPC);
  expect(urlField()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText(FAILURE)).toBeVisible();
  expect(chainField()).toHaveValue('');
  expect(saves).toEqual([]);
});

it('does not erase the local URL format rule when an internal endpoint answers', async () => {
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <CustomRPC />
    </I18nextProvider>
  );
  await user.type(
    screen.getByRole('combobox', { name: en.settings.label }),
    'Internal node'
  );
  await user.type(screen.getByPlaceholderText(en.settings.symbol), 'ETH');
  await user.type(urlField(), SINGLE_LABEL_RPC);
  await user.tab();
  expect(await screen.findByText(FAILURE)).toBeVisible();
  // A normal edit re-runs the local format rule without changing the final
  // endpoint. The following successful retry may remove its own old RPC
  // feedback, but must preserve this newer independent format error.
  await user.click(urlField());
  await user.keyboard('{End}{Backspace}e');
  expect(urlField()).toHaveValue(SINGLE_LABEL_RPC);
  await user.tab();
  await waitFor(() => expect(chainField()).toHaveValue('31337'));
  expect(screen.getByText(en.settings.validUrlRequired)).toBeVisible();
  expect(urlField()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText(FAILURE)).toBeNull();
  expect(reads).toEqual([
    { url: SINGLE_LABEL_RPC, outcome: 'rejected' },
    { url: SINGLE_LABEL_RPC, outcome: 'success' },
  ]);
  expect(saves).toEqual([]);
});

it('does not let an earlier same-URL success erase a newer failed retry', async () => {
  const user = await openAndFailFirstBlur();
  const pending = deferred<any>();
  let oldData: any;
  mockRpcOverride = async (data) => {
    oldData = data;
    return pending.promise;
  };
  await user.click(urlField());
  await user.tab();
  await waitFor(() => expect(reads[1]?.outcome).toBe('pending'));
  const newerFailure = 'Newer synthetic provider rejection';
  mockRpcOverride = async () => {
    throw new Error(newerFailure);
  };
  await user.click(urlField());
  await user.tab();
  expect(await screen.findByText(newerFailure)).toBeVisible();
  await act(async () => pending.resolve(networkFor(oldData)));
  expect(screen.getByText(newerFailure)).toBeVisible();
  expect(urlField()).toHaveAttribute('aria-invalid', 'true');
  expect(saves).toEqual([]);
});
