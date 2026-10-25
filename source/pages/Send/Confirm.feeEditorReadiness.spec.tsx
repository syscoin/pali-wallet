/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import { SendConfirm } from './Confirm';

const mockEmitter = jest.fn();
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};
const mockLocation: any = {
  key: 'fee-readiness-entry',
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
      url: 'https://rpc.invalid',
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
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
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
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: ({ name }: any) => <span>{name}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  mockLocation.key += '-next';
});
afterEach(() => {
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getTxGasLimit',
        'getFreshNativeEvmGasLimit',
        'refreshActiveAccountBalances',
      ].includes(path.at(-1))
    )
  ).toBe(true);
});

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (reason: any) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function prepare(quoteCount = 1) {
  const quotes = Array.from({ length: quoteCount }, deferred);
  let nextQuote = 0;
  mockEmitter.mockImplementation((path: string[], params: any[] = []) => {
    const method = path.at(-1);
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return quotes[nextQuote++].promise;
    if (method === 'getTxGasLimit') return Promise.resolve(21000);
    if (method === 'getFreshNativeEvmGasLimit') {
      expect(params).toEqual([
        {
          data: '0x',
          from: mockLocation.state.tx.sender,
          to: mockLocation.state.tx.receivingAddress,
          value: '0x0de0b6b3a7640000',
        },
        mockScope,
      ]);
      return Promise.resolve(21000);
    }
    if (method === 'refreshActiveAccountBalances')
      return Promise.resolve({ nativeBalance: '100' });
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  render(<SendConfirm />);
  return quotes;
}
const edit = () => screen.getByRole('button', { name: 'send.editFee' });
const quoteRequests = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
  );
const waitForQuote = (count = 1) =>
  waitFor(() => expect(quoteRequests()).toHaveLength(count));
const resolveQuote = (
  quote: ReturnType<typeof deferred>,
  priority = '1000000000'
) =>
  act(async () => {
    quote.resolve({
      maxFeePerGas: '3000000000',
      maxPriorityFeePerGas: priority,
    });
  });

it('keeps Edit Fee unavailable during the initial debounce before requesting a quote', () => {
  prepare();
  expect(quoteRequests()).toHaveLength(0);
  expect(edit()).toBeDisabled();
});

it('keeps Edit Fee unavailable while the first quote is pending', async () => {
  prepare();
  await waitForQuote();
  expect(edit()).toBeDisabled();
});

it.each(['rejected quote', 'zero maximum fee'])(
  'keeps %s retryable and opens the editor only after a successful retry',
  async (failure) => {
    const [failed, retry] = prepare(2);
    await waitForQuote();
    await act(async () => {
      if (failure === 'rejected quote')
        failed.reject(new Error('Synthetic fee failure'));
      else failed.resolve({ maxFeePerGas: '0', maxPriorityFeePerGas: '0' });
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'send.editFee' })).toBeNull()
    );
    await act(async () =>
      fireEvent.click(screen.getAllByRole('button', { name: 'reload' })[0])
    );
    expect(edit()).toBeDisabled();
    await waitForQuote(2);
    expect(edit()).toBeDisabled();
    await resolveQuote(retry);
    await waitFor(() => expect(edit()).toBeEnabled());
    expect(
      mockEmitter.mock.calls.filter(
        ([path]) => path.at(-1) === 'getFreshNativeEvmGasLimit'
      )
    ).toHaveLength(1);
    await act(async () => fireEvent.click(edit()));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByPlaceholderText('send.maxFee (GWEI)')).toHaveValue(3);
    expect(dialog.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  }
);

it.each(['1000000000', '0'])(
  'opens with ready quote values including priority %s',
  async (priority) => {
    const [quote] = prepare();
    await waitForQuote();
    await resolveQuote(quote, priority);
    await waitFor(() => expect(edit()).toBeEnabled());
    await act(async () => fireEvent.click(edit()));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByPlaceholderText('send.maxFee (GWEI)')).toHaveValue(3);
    expect(
      dialog.getByPlaceholderText('send.maxPriorityFee (GWEI)')
    ).toHaveValue(Number(priority) / 1e9);
    expect(dialog.getByPlaceholderText('send.gasLimit')).toHaveValue(21000);
    expect(dialog.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
    fireEvent.change(dialog.getByPlaceholderText('send.maxFee (GWEI)'), {
      target: { value: '4' },
    });
    await act(async () =>
      fireEvent.click(dialog.getByRole('button', { name: 'buttons.save' }))
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(edit()).toBeEnabled();
    await act(async () => fireEvent.click(edit()));
    expect(
      within(screen.getByRole('dialog')).getByPlaceholderText(
        'send.maxFee (GWEI)'
      )
    ).toHaveValue(4);
  }
);

it.each(['1000000000000000000000', '0.0000000001'])(
  'keeps unrepresentable custom cap %s in the real editor without changing review',
  async (value) => {
    const [quote] = prepare();
    await waitForQuote();
    await resolveQuote(quote, '0');
    await waitFor(() => expect(edit()).toBeEnabled());
    await act(async () => fireEvent.click(edit()));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByPlaceholderText('send.maxFee (GWEI)'), {
      target: { value },
    });
    await waitFor(() =>
      expect(
        dialog.getByRole('button', { name: 'buttons.save' })
      ).toBeDisabled()
    );
    await act(async () =>
      fireEvent.click(dialog.getByRole('button', { name: 'buttons.cancel' }))
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('0.000063 TSYS')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeEnabled();
  }
);
