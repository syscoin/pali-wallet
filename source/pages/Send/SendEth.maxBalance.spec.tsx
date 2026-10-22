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
import React from 'react';

import { SendEth } from './SendEth';

const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn() };
const mockSave = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
let mockState: any;
let mockAssets: any[];
const mockLocation = { key: 'send', pathname: '/send/eth', state: undefined };
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const QUOTE = {
  maxFeePerGas: '1000000000',
  maxPriorityFeePerGas: '100000000',
};
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ ...mockStatus, controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.invalid',
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  getAssetBalance: () => '10',
  ellipsis: (value: string) => value,
  adjustUrl: (value: string) => value,
  formatFullPrecisionBalance: (value: any) => String(value),
  createNavigationContext: jest.fn(),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
  getTokenTypeBadgeColor: () => '',
  truncateToDecimals: (value: string) => value,
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account:
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ],
    assets: { ethereum: mockAssets, syscoin: [] },
  }),
  selectValidEnsCache: () => ({}),
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: ({ children }: any) => <>{children}</>,
  Icon: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('@headlessui/react', () => {
  const Pass = ({ children }: any) => (
    <>{typeof children === 'function' ? children({ open: true }) : children}</>
  );
  return {
    Menu: Object.assign(Pass, { Button: Pass, Items: Pass, Item: Pass }),
  };
});

const deferred = () => {
  let resolve!: (value: typeof QUOTE) => void;
  const promise = new Promise<typeof QUOTE>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const feeCalls = () =>
  mockEmitter.mock.calls.filter(
    ([path]) =>
      path[path.length - 1] === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
  );
const setFeeReader = (read: () => Promise<any>) =>
  mockEmitter.mockImplementation((path) =>
    path[path.length - 1] === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
      ? read()
      : Promise.resolve(undefined)
  );
const next = () => screen.getByRole('button', { name: 'buttons.next' });
const flush = () => act(async () => void (await Promise.resolve()));
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
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
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
  window.history.replaceState(null, '', '/app.html');
  mockAssets = [];
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            label: 'Synthetic account',
            address: '0x1111111111111111111111111111111111111111',
            xpub: 'public-a',
            balances: { ethereum: '10', syscoin: '10' },
          },
        },
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://rpc.invalid',
        currency: 'eth',
        label: 'Ethereum',
        explorer: 'https://explorer.invalid',
      },
      isBitcoinBased: false,
      accountTransactions: {},
    },
    vaultGlobal: { activeSlip44: 60, isBitcoinBased: false },
  };
  mockSave.mockResolvedValue(undefined);
  setFeeReader(() => Promise.resolve(QUOTE));
});
afterEach(() => jest.restoreAllMocks());

const account = () => mockState.vault.accounts.HDAccount[0];
const changeBalance = (balance: string) => {
  mockState.vault.accounts.HDAccount[0] = {
    ...account(),
    balances: { ...account().balances, ethereum: balance },
  };
};
const setRecipient = () =>
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: RECIPIENT },
  });
const clickMax = () =>
  fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
const submitPreview = async () => {
  fireEvent.click(next());
  await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalledTimes(1));
  return mockNavigateWithContext.mock.calls[0][2].tx;
};
const expectValidation = async (message: string) => {
  fireEvent.click(next());
  await waitFor(() =>
    expect(screen.getAllByText(message).length).toBeGreaterThan(0)
  );
  expect(mockNavigateWithContext).not.toHaveBeenCalled();
};
const mountMax = async () => {
  const view = render(<SendEth />);
  await flush();
  setRecipient();
  clickMax();
  return view;
};

describe('native MAX classification after balance changes', () => {
  it('preserves a small decimal receipt balance through affordable native MAX', async () => {
    // Receipt refresh, like the ordinary balance reader, publishes decimal text.
    changeBalance('0.0000001');
    setFeeReader(() =>
      Promise.resolve({ maxFeePerGas: '1', maxPriorityFeePerGas: '1' })
    );
    await mountMax();
    expect(
      (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
    ).toBe('0.0000001');
    expect(await submitPreview()).toMatchObject({
      amount: '0.0000001',
      isMax: true,
      receivingAddress: RECIPIENT,
    });
  });

  it.each([
    ['equal', '10'],
    ['one wei', '10.000000000000000001'],
    ['1000 wei boundary', '10.000000000000001'],
  ])(
    'retains MAX at %s without rewriting the entered amount',
    async (_name, balance) => {
      const view = await mountMax();
      changeBalance(balance);
      view.rerender(<SendEth />);
      expect(await submitPreview()).toMatchObject({
        amount: '10',
        isMax: true,
        receivingAddress: RECIPIENT,
      });
    }
  );

  it.each([
    ['1001 wei', '10.000000000000001001'],
    ['100000 wei', '10.0000000000001'],
    ['incoming amount below gas cost', '10.00001'],
  ])(
    'validates gas after MAX and a %s balance increase',
    async (_name, balance) => {
      const view = await mountMax();
      changeBalance(balance);
      view.rerender(<SendEth />);
      await expectValidation('send.insufficientFundsForGas');
    }
  );

  it('preserves an affordable fixed amount after a substantial increase', async () => {
    const view = await mountMax();
    changeBalance('11');
    view.rerender(<SendEth />);
    expect(await submitPreview()).toMatchObject({ amount: '10', isMax: false });
  });

  it('rejects a stale excessive amount after a decrease', async () => {
    const view = await mountMax();
    changeBalance('9');
    view.rerender(<SendEth />);
    await expectValidation('send.insufficientFunds');
  });

  it('manual non-MAX control rejects the same insufficient gas reserve', async () => {
    changeBalance('10.0000000000001');
    render(<SendEth />);
    await flush();
    setRecipient();
    fireEvent.change(screen.getByPlaceholderText('send.amount'), {
      target: { value: '10' },
    });
    await expectValidation('send.insufficientFundsForGas');
  });

  it('validates the current balance when a delayed fee quote completes after MAX', async () => {
    const quote = deferred();
    setFeeReader(() => quote.promise);
    const view = render(<SendEth />);
    setRecipient();
    clickMax();
    expect(next()).toBeDisabled();
    changeBalance('10.0000000000001');
    view.rerender(<SendEth />);
    await act(async () => quote.resolve(QUOTE));
    expect(feeCalls()).toHaveLength(1);
    await expectValidation('send.insufficientFundsForGas');
  });

  it.each([
    '1.000000000000000001',
    '0.000000000000000001',
    '9007199254740993.123456789012345678',
  ])('preserves the exact native MAX decimal string %s', async (balance) => {
    changeBalance(balance);
    await mountMax();
    expect(await submitPreview()).toMatchObject({
      amount: balance,
      isMax: true,
    });
  });

  it('still blocks MAX when an outgoing transaction becomes pending', async () => {
    const view = await mountMax();
    mockState.vault.accountTransactions = {
      HDAccount: {
        0: {
          ethereum: {
            1: [
              {
                hash: '0x' + 'ab'.repeat(32),
                from: account().address,
                confirmations: 0,
              },
            ],
          },
        },
      },
    };
    view.rerender(<SendEth />);
    fireEvent.click(next());
    await waitFor(() =>
      expect(mockAlert.error).toHaveBeenCalledWith(
        'send.maxUnavailablePendingTx'
      )
    );
    expect(mockNavigateWithContext).not.toHaveBeenCalled();
  });

  it('does not apply native MAX classification to a verified ERC20 amount', async () => {
    jest.useFakeTimers();
    try {
      changeBalance('0.000001');
      mockAssets = [
        {
          id: 'verified-token',
          chainId: 1,
          tokenSymbol: 'TOKEN',
          tokenStandard: 'ERC-20',
          contractAddress: '0x4444444444444444444444444444444444444444',
          decimals: 24,
          balance: '1',
        },
      ];
      let resolveTokenInfo!: (value: {
        balance: string;
        decimals: number;
      }) => void;
      const tokenInfo = new Promise<{ balance: string; decimals: number }>(
        (resolve) => {
          resolveTokenInfo = resolve;
        }
      );
      mockEmitter.mockImplementation((path: string[]) => {
        if (path.at(-1) === 'getERC20TokenInfo') return tokenInfo;
        if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
          return Promise.resolve(QUOTE);
        return Promise.resolve(undefined);
      });
      render(<SendEth />);
      await flush();
      setRecipient();
      fireEvent.click(screen.getByRole('button', { name: /TOKEN.*ERC-20/ }));
      expect(screen.getByRole('button', { name: 'MAX' })).toBeDisabled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(999);
      });
      expect(screen.getByRole('button', { name: 'MAX' })).toBeDisabled();
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path.at(-1) === 'getERC20TokenInfo'
        )
      ).toHaveLength(0);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path.at(-1) === 'getERC20TokenInfo'
        )
      ).toEqual([
        [
          ['wallet', 'getERC20TokenInfo'],
          ['0x4444444444444444444444444444444444444444', account().address],
        ],
      ]);
      expect(screen.getByRole('button', { name: 'MAX' })).toBeDisabled();
      await act(async () => {
        resolveTokenInfo({
          balance: '1000000000000000000000001',
          decimals: 24,
        });
      });
      expect(screen.getByRole('button', { name: 'MAX' })).toBeEnabled();
      clickMax();
      expect(await submitPreview()).toMatchObject({
        amount: '1.000000000000000000000001',
        isMax: false,
        token: expect.objectContaining({ decimals: 24 }),
      });
    } finally {
      cleanup();
      jest.useRealTimers();
    }
  });
});
