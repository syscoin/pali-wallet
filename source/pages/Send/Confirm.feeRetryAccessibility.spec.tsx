/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createInstance, i18n } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';

import { SendConfirm } from './Confirm';

const mockEmitter = jest.fn();
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockScope = {
  account: 'fee-retry-account',
  network: 'fee-retry-network',
};
const mockLocation: any = {
  key: 'fee-retry-entry',
  pathname: '/send/confirm',
  state: {
    submissionStarted: false,
    walletScope: mockScope,
    tx: {
      sender: '0x1111111111111111111111111111111111111111',
      receivingAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
      transactionType: 'NATIVE_ETH',
      defaultGasLimit: 21000,
    },
    returnContext: { returnRoute: '/send/eth', walletScope: mockScope },
  },
};
const mockState = {
  vault: {
    activeNetwork: {
      kind: 'ethereum',
      chainId: 5700,
      currency: 'TSYS',
      url: 'https://fee-retry.invalid',
    },
    isBitcoinBased: false,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          address: '0x1111111111111111111111111111111111111111',
          balances: { ethereum: '100' },
        },
      },
    },
    accountTransactions: {},
  },
  price: { fiat: { asset: 'USD' } },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockAuth }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockAuth,
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({ isEIP1559Compatible: true, forceRecheck: jest.fn() }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
// Use the package's actual CJS color utilities in Jest; the icon DOM remains
// the real production implementation (the package imports this ESM-only path).
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
// The actionable button, icon's actual SVG accessible name, and tooltip wrapper
// are production components. Do not substitute an invented named retry button.
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: jest.requireActual('components/Icon/Icon').Icon,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('./components', () => ({ PriorityBar: () => null }));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  logError: jest.fn(),
  removeScientificNotation: (value: any) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(value),
  omitTransactionObjectData: (value: any) => value,
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(),
  getTransactionReturnContext: () => mockLocation.state.returnContext,
  getWalletNavigationScope: () => mockScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: jest.fn(),
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: jest.fn(),
  getErc721Abi: jest.fn(),
  getErc1155Abi: jest.fn(),
}));

const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout.
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
  window.history.replaceState(null, '', '/');
  mockLocation.key += '-next';
});
afterEach(() => {
  cleanup();
  // No signing, publication, storage, account switch, or balance mutation.
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      ['getFeeDataWithDynamicMaxPriorityFeePerGas', 'getTxGasLimit', 'getFreshNativeEvmGasLimit'].includes(
        path.at(-1)
      )
    )
  ).toBe(true);
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const feeRequests = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
  );
async function prepare(language: string, count = 1, token = false) {
  mockLocation.state.tx = {
    sender: '0x1111111111111111111111111111111111111111',
    receivingAddress: '0x2222222222222222222222222222222222222222',
    amount: '1',
    transactionType: token ? 'ERC20' : 'NATIVE_ETH',
    defaultGasLimit: token ? 100000 : 21000,
    ...(token
      ? {
          token: {
            symbol: 'QA',
            name: 'Synthetic QA token',
            contractAddress: '0x3333333333333333333333333333333333333333',
            decimals: 18,
            isNft: false,
          },
        }
      : {}),
  };
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
    },
    interpolation: { escapeValue: false },
  });
  const quotes = Array.from({ length: count }, deferred);
  let next = 0;
  mockEmitter.mockImplementation((path: string[], params: any[] = []) => {
    const method = path.at(-1);
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return quotes[next++].promise;
    if (method === 'getTxGasLimit') return Promise.resolve(21000);
    if (method === 'getFreshNativeEvmGasLimit') {
      expect(params[1]).toEqual(mockScope);
      expect(params[0]).toEqual(expect.objectContaining({ data: '0x', from: mockLocation.state.tx.sender, to: mockLocation.state.tx.receivingAddress }));
      return Promise.resolve(21000);
    }
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  render(
    <I18nextProvider i18n={instance}>
      <SendConfirm />
    </I18nextProvider>
  );
  await waitFor(() => expect(feeRequests()).toHaveLength(1));
  return { instance, quotes };
}
const confirm = (instance: i18n) =>
  screen.getByRole('button', { name: String(instance.t('buttons.confirm')) });
async function failQuote(quote: ReturnType<typeof deferred>, instance: i18n) {
  await act(async () =>
    quote.reject(new Error('Synthetic fee read unavailable'))
  );
  await waitFor(() =>
    expect(
      screen.getAllByText(String(instance.t('send.unableToLoad'))).length
    ).toBeGreaterThan(0)
  );
  expect(confirm(instance)).toBeDisabled();
  // Discover the real descendant icon, not a made-up translated component.
  const retry = screen
    .getAllByRole('img', { name: 'reload' })[0]
    .closest('button');
  expect(retry).not.toBeNull();
  expect(retry).toBeEnabled();
  return retry!;
}
async function succeedQuote(
  quote: ReturnType<typeof deferred>,
  instance: i18n
) {
  await act(async () =>
    quote.resolve({ maxFeePerGas: '3000000000', maxPriorityFeePerGas: '0' })
  );
  await waitFor(() => expect(confirm(instance)).toBeEnabled());
  expect(screen.queryByRole('img', { name: 'reload' })).toBeNull();
}

describe.each(['en', 'de', 'fr'])(
  'ordinary fee Retry accessible action in %s',
  (language) => {
    it('names the actual failed-read action with the current localized Retry text', async () => {
      const { instance, quotes } = await prepare(language);
      const retry = await failQuote(quotes[0], instance);
      expect(retry).toHaveAccessibleName(String(instance.t('receive.retry')));
      expect(feeRequests()).toHaveLength(1);
    });

    it('healthy successful fee read enables Confirm without exposing Retry', async () => {
      const { instance, quotes } = await prepare(language);
      expect(confirm(instance)).toBeDisabled();
      await succeedQuote(quotes[0], instance);
      expect(feeRequests()).toHaveLength(1);
    });

    it('healthy explicit native button retry recovers the same unsigned entry without submitting', async () => {
      const { instance, quotes } = await prepare(language, 2);
      const retry = await failQuote(quotes[0], instance);
      retry.focus();
      expect(retry).toHaveFocus();
      fireEvent.click(retry);
      await waitFor(() => expect(feeRequests()).toHaveLength(2));
      expect(confirm(instance)).toBeDisabled();
      await succeedQuote(quotes[1], instance);
      expect(feeRequests()).toHaveLength(2);
      expect(mockEmitter.mock.calls.filter(([path]) => path.at(-1) === 'getFreshNativeEvmGasLimit')).toHaveLength(1);
      expect(mockLocation.state.tx.receivingAddress).toBe(
        '0x2222222222222222222222222222222222222222'
      );
      expect(mockState.vault.activeAccount).toEqual({
        type: 'HDAccount',
        id: 0,
      });
      expect(mockState.vault.activeNetwork.chainId).toBe(5700);
    });
  }
);

describe.each(['en', 'de', 'fr'])(
  'ordinary ERC20 fee Retry accessible actions in %s',
  (language) => {
    it('names both the fee row and total panel failed-read Retry actions', async () => {
      const { instance, quotes } = await prepare(language, 1, true);
      await failQuote(quotes[0], instance);
      const retryIcons = screen.getAllByRole('img', { name: 'reload' });
      expect(retryIcons).toHaveLength(2);
      for (const icon of retryIcons) {
        expect(icon.closest('button')).toHaveAccessibleName(
          String(instance.t('receive.retry'))
        );
      }
      expect(feeRequests()).toHaveLength(1);
    });

    it('healthy token quote enables Confirm with its exact amount and contract unchanged', async () => {
      const { instance, quotes } = await prepare(language, 1, true);
      expect(confirm(instance)).toBeDisabled();
      await succeedQuote(quotes[0], instance);
      expect(feeRequests()).toHaveLength(1);
      expect(mockLocation.state.tx.amount).toBe('1');
      expect(mockLocation.state.tx.token.contractAddress).toBe(
        '0x3333333333333333333333333333333333333333'
      );
    });

    it('healthy total-panel Retry recovers both token fee displays without submitting', async () => {
      const { instance, quotes } = await prepare(language, 2, true);
      await failQuote(quotes[0], instance);
      const icons = screen.getAllByRole('img', { name: 'reload' });
      expect(icons).toHaveLength(2);
      const totalRetry = icons[1].closest('button')!;
      totalRetry.focus();
      expect(totalRetry).toHaveFocus();
      fireEvent.click(totalRetry);
      await waitFor(() => expect(feeRequests()).toHaveLength(2));
      expect(confirm(instance)).toBeDisabled();
      await succeedQuote(quotes[1], instance);
      expect(feeRequests()).toHaveLength(2);
      expect(mockLocation.state.tx.amount).toBe('1');
      expect(mockLocation.state.tx.token.contractAddress).toBe(
        '0x3333333333333333333333333333333333333333'
      );
      expect(mockState.vault.activeAccount).toEqual({
        type: 'HDAccount',
        id: 0,
      });
      expect(mockState.vault.activeNetwork.chainId).toBe(5700);
    });
  }
);
