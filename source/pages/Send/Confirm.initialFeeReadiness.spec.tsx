/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import { SendConfirm } from './Confirm';

const mockEmitter = jest.fn();
let mockFiatAvailable = true;
let mockFiatRate: number | null = null;
const mockGetFiatAmount = jest.fn((amount: number) =>
  mockFiatRate === null ? null : String(amount * mockFiatRate) + ' USD'
);
let mockConfirmCallbacks: (() => Promise<void> | void)[] = [];
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
  usePrice: () => ({
    getFiatAmount: mockGetFiatAmount,
    isFiatAvailable: mockFiatAvailable,
  }),
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
  Button: (props: any) => {
    if (props.children === 'buttons.confirm')
      mockConfirmCallbacks.push(props.onClick);
    const ActualButton = jest.requireActual('components/Button/Button').Button;
    return <ActualButton {...props} />;
  },
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
  mockFiatAvailable = true;
  mockFiatRate = null;
  window.history.replaceState(null, '', '/');
  mockLocation.key += '-next';
  mockConfirmCallbacks = [];
  delete mockLocation.state.tx.token;
  mockLocation.state.tx.transactionType = 'NATIVE_ETH';
  mockLocation.state.tx.defaultGasLimit = 21000;
});

afterEach(() => {
  jest.useRealTimers();
  for (const [path] of mockEmitter.mock.calls)
    expect([
      'getFeeDataWithDynamicMaxPriorityFeePerGas',
      'getTxGasLimit',
      'refreshActiveAccountBalances',
      'sendAndSaveEthTransaction',
      'sendAndSaveTokenTransaction',
    ]).toContain(path.at(-1));
});

function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const feeRequests = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
  );
const sendRequests = () =>
  mockEmitter.mock.calls.filter(([path]) =>
    ['sendAndSaveEthTransaction', 'sendAndSaveTokenTransaction'].includes(
      path.at(-1)
    )
  );
const confirm = () => screen.getByRole('button', { name: 'buttons.confirm' });
function mount(kind: 'native' | 'token') {
  jest.useFakeTimers();
  const quote = deferred();
  if (kind === 'token') {
    mockLocation.state.tx.transactionType = 'ERC20';
    mockLocation.state.tx.defaultGasLimit = 65000;
    mockLocation.state.tx.token = {
      contractAddress: '0x3333333333333333333333333333333333333333',
      decimals: 18,
      symbol: 'QA',
    };
  }
  mockEmitter.mockImplementation((path: string[]) => {
    const method = path.at(-1);
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return quote.promise;
    if (method === 'getTxGasLimit') return Promise.resolve(21000);
    if (method === 'refreshActiveAccountBalances')
      return Promise.resolve({ nativeBalance: '100' });
    if (
      ['sendAndSaveEthTransaction', 'sendAndSaveTokenTransaction'].includes(
        method!
      )
    )
      return Promise.reject(
        Object.assign(new Error('Synthetic send boundary'), {
          transactionNotBroadcast: true,
        })
      );
    throw new Error('Unexpected controller call: ' + path.join('.'));
  });
  const view = render(<SendConfirm />);
  return { ...quote, view };
}
const resolveQuote = (quote: ReturnType<typeof deferred>) =>
  act(async () => {
    quote.resolve({
      maxFeePerGas: '3000000000',
      maxPriorityFeePerGas: '0',
    });
  });

it.each(['native', 'token'] as const)(
  'keeps %s Confirm disabled from the first render through the pending quote',
  async (kind) => {
    const quote = mount(kind);
    expect(feeRequests()).toHaveLength(0);
    expect(confirm()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'buttons.cancel' })
    ).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm());
      jest.advanceTimersByTime(499);
    });
    expect(feeRequests()).toHaveLength(0);
    expect(confirm()).toBeDisabled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(feeRequests()).toHaveLength(1);
    expect(confirm()).toBeDisabled();
    expect(sendRequests()).toHaveLength(0);
    await resolveQuote(quote);
    expect(confirm()).toBeEnabled();
    expect(feeRequests()).toHaveLength(1);
  }
);

it.each(['native', 'token'] as const)(
  'rejects a retained %s handler before and after its initial quote completes',
  async (kind) => {
    const quote = mount(kind);
    const initialHandler = mockConfirmCallbacks[0];
    await act(async () => {
      await initialHandler();
    });
    expect(mockEmitter).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    const pendingHandler = mockConfirmCallbacks.at(-1)!;
    await act(async () => {
      await pendingHandler();
    });
    expect(sendRequests()).toHaveLength(0);
    await resolveQuote(quote);
    await act(async () => {
      await initialHandler();
      await pendingHandler();
    });
    expect(sendRequests()).toHaveLength(0);
    expect(feeRequests()).toHaveLength(1);
  }
);

it.each(['native', 'token'] as const)(
  'allows a current %s handler to dispatch the completed zero-tip quote',
  async (kind) => {
    const quote = mount(kind);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await resolveQuote(quote);
    expect(confirm()).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(sendRequests()).toHaveLength(1);
    const args = sendRequests()[0][1];
    const payload = kind === 'native' ? args[0] : args[1];
    expect(payload.maxFeePerGas.toString()).toBe('3000000000');
    expect(payload.maxPriorityFeePerGas.toString()).toBe('0');
    expect(feeRequests()).toHaveLength(1);
  }
);

it.each(['native', 'token'] as const)(
  'rejects a retained %s handler after the reviewed fee is edited',
  async (kind) => {
    const quote = mount(kind);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await resolveQuote(quote);
    const previousHandler = mockConfirmCallbacks.at(-1)!;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send.editFee' }));
    });
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByPlaceholderText('send.maxFee (GWEI)'), {
      target: { value: '4' },
    });
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'buttons.save' }));
    });
    expect(confirm()).toBeEnabled();
    await act(async () => {
      await previousHandler();
    });
    expect(sendRequests()).toHaveLength(0);
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(sendRequests()).toHaveLength(1);
    const args = sendRequests()[0][1];
    const payload = kind === 'native' ? args[0] : args[1];
    expect(payload.maxFeePerGas.toString()).toBe('4000000000');
    expect(payload.maxPriorityFeePerGas.toString()).toBe('0');
    expect(feeRequests()).toHaveLength(1);
  }
);

it('changes only approximate fiat when quote availability changes on a ready native review', async () => {
  mockFiatAvailable = false;
  mockFiatRate = 0;
  const quote = mount('native');
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await resolveQuote(quote);
  expect(confirm()).toBeEnabled();
  const nativeLines = () =>
    Array.from(document.querySelectorAll('span,p'))
      .filter(
        (element) =>
          element.children.length === 0 && element.textContent?.includes('TSYS')
      )
      .map((element) => element.textContent);
  const nativeBefore = nativeLines();
  expect(nativeBefore.length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain(' USD');
  expect(mockGetFiatAmount).not.toHaveBeenCalled();
  mockFiatAvailable = true;
  quote.view.rerender(<SendConfirm />);
  expect(document.body.textContent).toContain('0 USD');
  expect(nativeLines()).toEqual(nativeBefore);
  mockFiatRate = 2;
  quote.view.rerender(<SendConfirm />);
  expect(document.body.textContent).toContain('2.000126 USD');
  expect(nativeLines()).toEqual(nativeBefore);
  mockFiatAvailable = false;
  quote.view.rerender(<SendConfirm />);
  expect(document.body.textContent).not.toContain(' USD');
  expect(nativeLines()).toEqual(nativeBefore);
  expect(confirm()).toBeEnabled();
  expect(sendRequests()).toHaveLength(0);
  expect(feeRequests()).toHaveLength(1);
});
