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
const mockLocation = { key: 'send', pathname: '/send/eth', state: undefined };
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
  getAssetBalance: () => '10',
  ellipsis: (v: string) => v,
  adjustUrl: (v: string) => v,
  formatFullPrecisionBalance: (v: any) => String(v),
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
const prepare = async (
  raw: string,
  decimals = 18,
  storedDecimals = decimals
) => {
  mockAssets = [
    {
      id: 'precision-token',
      contractAddress: '0x3333333333333333333333333333333333333333',
      chainId: 1,
      tokenSymbol: 'PRECISE',
      tokenStandard: 'ERC-20',
      isNft: false,
      balance: 10,
      decimals: storedDecimals,
    },
  ];
  mockEmitter.mockImplementation((path: string[]) => {
    const method = path.at(-1);
    if (method === 'getERC20TokenInfo')
      return Promise.resolve({ balance: raw, decimals });
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return Promise.resolve({
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
      });
    return Promise.resolve(undefined);
  });
  render(<SendEth />);
  fireEvent.click(screen.getByRole('button', { name: /PRECISE.*ERC-20/ }));
  await waitFor(
    () =>
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path.at(-1) === 'getERC20TokenInfo'
        )
      ).toBe(true),
    { timeout: 2500 }
  );
  await act(async () => void (await Promise.resolve()));
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: '0x2222222222222222222222222222222222222222' },
  });
};
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const next = () => screen.getByRole('button', { name: 'buttons.next' });

it.each([
  { raw: '1000000000000000000', decimals: 18, expected: '1' },
  { raw: '999999999999999999', decimals: 18, expected: '0.999999999999999999' },
  { raw: '9007199254740993', decimals: 0, expected: '9007199254740993' },
  { raw: '1', decimals: 24, expected: '0.000000000000000000000001' },
  { raw: '123456', decimals: 6, expected: '0.123456' },
])(
  'keeps ERC20 MAX exact at $decimals decimals: $raw',
  async ({ raw, decimals, expected }) => {
    await prepare(raw, decimals);
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
    expect(amount().value).toBe(expected);
    fireEvent.click(next());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0][2].tx).toMatchObject({
      amount: expected,
      token: { decimals },
    });
  }
);

it('uses newly verified decimals for validation and the confirmation payload', async () => {
  await prepare('1', 24, 18);
  fireEvent.change(amount(), {
    target: { value: '0.000000000000000000000001' },
  });
  fireEvent.click(next());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][2].tx).toMatchObject({
    amount: '0.000000000000000000000001',
    token: { decimals: 24 },
  });
});

it('rejects even one atomic unit above the exact verified balance', async () => {
  await prepare('999999999999999999');
  fireEvent.change(amount(), { target: { value: '1' } });
  fireEvent.click(next());
  await screen.findByText('send.insufficientFundsVerified');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('keeps excessive precision visible on blur and blocks submission without rounding', async () => {
  await prepare('1000000', 6);
  fireEvent.change(amount(), { target: { value: '0.1234567' } });
  fireEvent.blur(amount());
  await screen.findByText('send.invalidAmount');
  expect(amount().value).toBe('0.1234567');
  fireEvent.click(next());
  await screen.findByText('send.invalidAmount');
  expect(mockNavigate).not.toHaveBeenCalled();
});
