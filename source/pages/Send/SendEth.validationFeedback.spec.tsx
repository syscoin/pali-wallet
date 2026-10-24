/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { SendEth } from './SendEth';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
let mockAssets: any[] = [];
let mockState: any;
const mockLocation = {
  key: 'send',
  pathname: '/send/eth',
  state: undefined as any,
};
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
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
    navigate: jest.fn(),
    alert: { error: jest.fn(), info: jest.fn() },
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
  getAssetBalance: (...args: any[]) =>
    jest.requireActual('utils/transactions').getAssetBalance(...args),
  ellipsis: (...args: any[]) =>
    jest.requireActual('utils/format').ellipsis(...args),
  adjustUrl: (v: string) => v,
  formatFullPrecisionBalance: (...args: any[]) =>
    jest.requireActual('utils/format').formatFullPrecisionBalance(...args),
  createNavigationContext: jest.fn(),
  navigateWithContext: (...args: any[]) => mockNavigate(...args),
  getTokenTypeBadgeColor: () => '',
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account: state.vault.accounts.HDAccount[0],
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
  } as any;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
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
  mockAssets = [];
  mockLocation.state = undefined;
  window.history.replaceState(null, '', '/app.html');
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
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
});

const recipient = '0x2222222222222222222222222222222222222222';
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const receiver = () =>
  screen.getByPlaceholderText('send.receiver') as HTMLInputElement;
const next = () => screen.getByRole('button', { name: 'buttons.next' });
const mountNative = async () => {
  mockEmitter.mockImplementation(async (path: string[]) => {
    const method = path.at(-1);
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return {
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
      };
    if (
      method === 'refreshActiveAccountBalances' ||
      method === 'reverseResolveEns'
    )
      return undefined;
    throw new Error('Unexpected controller action: ' + method);
  });
  render(<SendEth />);
  await act(async () => void (await Promise.resolve()));
};
const submit = async () => {
  fireEvent.click(next());
  await act(async () => void (await Promise.resolve()));
};

it.each([
  ['', 'send.amountRequired'],
  ['0', 'send.invalidAmount'],
  ['-1', 'send.invalidAmount'],
  ['1e-19', 'send.invalidAmount'],
])('reports actionable native amount error for %s', async (value, message) => {
  await mountNative();
  fireEvent.change(receiver(), { target: { value: recipient } });
  fireEvent.change(amount(), { target: { value } });
  await submit();
  await waitFor(() => expect(amount()).toHaveAttribute('aria-invalid', 'true'));
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(await screen.findByText(message)).toBeVisible();
});

it('reports actionable required recipient error with a healthy native amount', async () => {
  await mountNative();
  fireEvent.change(amount(), { target: { value: '1' } });
  await submit();
  await waitFor(() =>
    expect(receiver().closest('.ant-form-item')).toHaveClass(
      'ant-form-item-has-error'
    )
  );
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(await screen.findByText('send.addressRequired')).toBeVisible();
});

it('healthy invalid-address control remains actionable and blocked', async () => {
  await mountNative();
  fireEvent.change(receiver(), { target: { value: 'not-an-address' } });
  fireEvent.change(amount(), { target: { value: '1' } });
  await submit();
  await screen.findByText('send.invalidEthAddress');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('identifies the native recipient input without changing its composite layout', async () => {
  await mountNative();
  expect(receiver()).toHaveAttribute('id', 'receiver');
  expect(receiver()).toHaveAttribute('aria-required', 'true');
  expect(receiver()).not.toHaveAttribute('aria-invalid', 'true');
  expect(receiver()).not.toHaveAttribute('aria-describedby');
  expect(document.querySelectorAll('#receiver')).toHaveLength(1);
  const wrapper = receiver().closest('.relative');
  expect(wrapper).toBeInstanceOf(HTMLDivElement);
  expect(wrapper).not.toHaveAttribute('id');
  expect(wrapper).not.toHaveAttribute('aria-required');
});

it.each([
  ['', 'send.addressRequired'],
  ['not-an-address', 'send.invalidEthAddress'],
])(
  'associates the native recipient with its current %s error',
  async (value, message) => {
    await mountNative();
    fireEvent.change(receiver(), { target: { value } });
    fireEvent.change(amount(), { target: { value: '0' } });
    await submit();
    await waitFor(() =>
      expect(receiver()).toHaveAttribute('aria-invalid', 'true')
    );
    expect(receiver()).toHaveAttribute('aria-describedby', 'receiver_help');
    expect(await screen.findByText(message)).toBeVisible();
    await waitFor(() =>
      expect(document.getElementById('receiver_help')).toHaveTextContent(
        message
      )
    );
    expect(receiver().closest('.relative')).not.toHaveAttribute('aria-invalid');
    expect(document.querySelectorAll('#receiver')).toHaveLength(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it('clears stale native recipient error semantics on ordinary correction', async () => {
  await mountNative();
  fireEvent.change(receiver(), { target: { value: 'not-an-address' } });
  fireEvent.change(amount(), { target: { value: '0' } });
  await submit();
  await waitFor(() =>
    expect(receiver()).toHaveAttribute('aria-invalid', 'true')
  );
  fireEvent.change(receiver(), { target: { value: recipient } });
  await waitFor(() => {
    expect(receiver()).not.toHaveAttribute('aria-invalid', 'true');
    expect(receiver()).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText('send.invalidEthAddress')
    ).not.toBeInTheDocument();
  });
  expect(receiver()).toHaveValue(recipient);
  expect(receiver()).toHaveAttribute('aria-required', 'true');
  expect(amount()).toHaveAttribute('aria-invalid', 'true');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('healthy excessive-amount control remains actionable and blocked', async () => {
  await mountNative();
  fireEvent.change(receiver(), { target: { value: recipient } });
  fireEvent.change(amount(), { target: { value: '11' } });
  await submit();
  await screen.findByText('send.insufficientFunds');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('healthy affordable native input reaches unsigned confirmation only', async () => {
  await mountNative();
  fireEvent.change(receiver(), { target: { value: recipient } });
  fireEvent.change(amount(), { target: { value: '1' } });
  await submit();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][1]).toBe('/send/confirm');
  expect(mockNavigate.mock.calls[0][2].tx).toMatchObject({
    amount: '1',
    receivingAddress: recipient,
    token: null,
  });
});

it.each(['0', '-1'])(
  'reports actionable verified ERC20 amount error for %s',
  async (value) => {
    mockAssets = [
      {
        id: 'feedback-token',
        contractAddress: '0x3333333333333333333333333333333333333333',
        chainId: 1,
        tokenSymbol: 'FEEDBACK',
        tokenStandard: 'ERC-20',
        isNft: false,
        balance: 1,
        decimals: 6,
      },
    ];
    mockEmitter.mockImplementation(async (path: string[]) => {
      const method = path.at(-1);
      if (method === 'getERC20TokenInfo')
        return { balance: '1000000', decimals: 6 };
      if (
        method === 'refreshActiveAccountBalances' ||
        method === 'reverseResolveEns'
      )
        return undefined;
      if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
        return {
          maxFeePerGas: '1000000000',
          maxPriorityFeePerGas: '100000000',
        };
      throw new Error('Unexpected controller action: ' + method);
    });
    render(<SendEth />);
    fireEvent.click(screen.getByRole('button', { name: /FEEDBACK.*ERC-20/ }));
    await waitFor(() => expect(amount()).toBeEnabled(), { timeout: 2500 });
    fireEvent.change(receiver(), { target: { value: recipient } });
    fireEvent.change(amount(), { target: { value } });
    await submit();
    await waitFor(() =>
      expect(amount()).toHaveAttribute('aria-invalid', 'true')
    );
    expect(await screen.findByText('send.invalidAmount')).toBeVisible();
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

afterEach(() => {
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'refreshActiveAccountBalances',
        'reverseResolveEns',
        'getERC20TokenInfo',
      ].includes(path.at(-1))
    )
  ).toBe(true);
});
