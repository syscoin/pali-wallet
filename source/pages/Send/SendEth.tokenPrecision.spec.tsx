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

it.each([
  { isNft: false, standard: 'ERC-20' },
  { isNft: true, standard: 'ERC-1155' },
])(
  'shows the stored balance for a $standard asset sharing the native symbol',
  async ({ isNft, standard }) => {
    mockAssets = [
      {
        id: 'same-symbol-token',
        contractAddress: '0x3333333333333333333333333333333333333333',
        chainId: 1,
        tokenSymbol: 'ETH',
        tokenStandard: standard,
        isNft,
        balance: 42,
        decimals: isNft ? 0 : 18,
        tokenId: isNft ? '5' : undefined,
      },
    ];
    mockEmitter.mockImplementation((path: string[]) => {
      if (path.at(-1) === 'getERC20TokenInfo')
        return Promise.reject(new Error('Token metadata unavailable'));
      return Promise.resolve(undefined);
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    try {
      render(<SendEth />);
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`ETH.*${standard}`) })
      );
      expect(await screen.findByText('42 ETH')).toBeInTheDocument();
      expect(screen.queryByText('10 ETH')).not.toBeInTheDocument();
      if (!isNft) {
        await waitFor(
          () =>
            expect(consoleError).toHaveBeenCalledWith(
              'Error verifying ERC-20 balance:',
              expect.any(Error)
            ),
          { timeout: 2500 }
        );
        expect(screen.getByText('42 ETH')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'MAX' })).toBeDisabled();
      }
    } finally {
      consoleError.mockRestore();
    }
  }
);

it('shows the native balance when no token is selected', async () => {
  mockEmitter.mockResolvedValue(undefined);
  render(<SendEth />);
  await act(async () => void (await Promise.resolve()));
  expect(screen.getByText('10 ETH')).toBeInTheDocument();
});

const prepareERC1155 = async (
  rawBalance: string | null | undefined,
  balance: number,
  restored = false,
  ownershipReply?: Promise<any>
) => {
  mockAssets = [
    {
      id: 'quantity-token',
      contractAddress: '0x3333333333333333333333333333333333333333',
      chainId: 1,
      tokenSymbol: 'QTY',
      tokenStandard: 'ERC-1155',
      isNft: true,
      tokenId: '7',
      balance,
      rawBalance,
      decimals: 0,
    },
  ];
  if (restored) {
    mockLocation.state = {
      walletScope: jest
        .requireActual('utils/navigationState')
        .getWalletNavigationScope(),
      selectedAsset: mockAssets[0],
      selectedNftTokenId: '7',
      formValues: { amount: '1', nftTokenId: '7' },
    };
  }
  mockEmitter.mockImplementation((path: string[]) =>
    path.at(-1) === 'verifyERC1155Ownership'
      ? ownershipReply ??
        Promise.resolve([{ tokenId: '7', balance, rawBalance, verified: true }])
      : Promise.resolve(undefined)
  );
  const view = render(<SendEth />);
  if (!restored)
    fireEvent.click(screen.getByRole('button', { name: /QTY.*ERC-1155/ }));
  await act(async () => void (await Promise.resolve()));
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: '0x2222222222222222222222222222222222222222' },
  });
  return view;
};
const nftAmount = () =>
  document.querySelector('#with-max-button') as HTMLInputElement;

it.each([false, true])(
  'keeps ERC1155 MAX exact beyond Number precision, restored=%s',
  async (restored) => {
    const rawBalance = '9007199254740993';
    await prepareERC1155(rawBalance, Number.MAX_SAFE_INTEGER, restored);
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
    expect(nftAmount().value).toBe(rawBalance);
    fireEvent.click(next());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0][2].tx.amount).toBe(rawBalance);
  }
);

it.each(['1.5', '9007199254740990.1'])(
  'rejects fractional ERC1155 quantity %s without rounding',
  async (value) => {
    await prepareERC1155('9007199254740993', Number.MAX_SAFE_INTEGER);
    fireEvent.change(nftAmount(), { target: { value } });
    fireEvent.click(next());
    await screen.findByText('send.amountMustBePositiveInteger');
    expect(nftAmount().value).toBe(value);
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it('rejects one ERC1155 unit above the exact raw balance', async () => {
  await prepareERC1155('9007199254740993', Number.MAX_SAFE_INTEGER);
  fireEvent.change(nftAmount(), {
    target: { value: '9007199254740994' },
  });
  fireEvent.click(next());
  await screen.findByText('send.youOnlyOwn');
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each([
  { before: '42', after: '41', beforeDisplay: 42, afterDisplay: 41 },
  {
    before: '9007199254740993',
    after: '9007199254740995',
    beforeDisplay: Number.MAX_SAFE_INTEGER,
    afterDisplay: Number.MAX_SAFE_INTEGER,
  },
])(
  'updates ERC1155 MAX when the raw balance changes from $before to $after',
  async ({ before, after, beforeDisplay, afterDisplay }) => {
    const view = await prepareERC1155(before, beforeDisplay);
    mockAssets = [
      { ...mockAssets[0], balance: afterDisplay, rawBalance: after },
    ];
    view.rerender(<SendEth />);
    await act(async () => void (await Promise.resolve()));
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
    expect(nftAmount().value).toBe(after);
    fireEvent.click(next());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0][2].tx.amount).toBe(after);
  }
);

it('supports safe legacy ERC1155 balances without raw metadata', async () => {
  await prepareERC1155(undefined, 42);
  expect(screen.getByText('42 QTY')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
  expect(nftAmount().value).toBe('42');
  fireEvent.click(next());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][2].tx.amount).toBe('42');
});

it('compacts a uint256 ERC1155 header while keeping MAX and confirmation exact', async () => {
  const rawBalance =
    '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  await prepareERC1155(rawBalance, Number.MAX_SAFE_INTEGER);
  expect(screen.getByText('1.16e77 QTY')).toHaveAttribute('title', rawBalance);
  expect(screen.queryByText(`${rawBalance} QTY`)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
  expect(nftAmount().value).toBe(rawBalance);
  fireEvent.click(next());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][2].tx.amount).toBe(rawBalance);
});

it.each([
  { rawBalance: undefined, balance: Number.MAX_SAFE_INTEGER + 1 },
  { rawBalance: null, balance: Number.MAX_SAFE_INTEGER + 1 },
  { rawBalance: '1.5', balance: 1 },
])(
  'does not use an inexact or malformed ERC1155 balance: %p',
  async (asset) => {
    await prepareERC1155(asset.rawBalance, asset.balance);
    expect(screen.getByRole('button', { name: 'MAX' })).toBeDisabled();
    expect(nftAmount()).toBeDisabled();
  }
);

it('keeps a refreshed ERC1155 balance when an older restored ownership read resolves', async () => {
  let resolve!: (value: any) => void;
  const ownershipReply = new Promise((done) => {
    resolve = done;
  });
  const view = await prepareERC1155('42', 42, true, ownershipReply);
  expect(screen.getByRole('button', { name: 'MAX' })).toBeDisabled();
  mockAssets = [{ ...mockAssets[0], balance: 41, rawBalance: '41' }];
  view.rerender(<SendEth />);
  await act(async () => void (await Promise.resolve()));
  fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
  expect(nftAmount().value).toBe('41');
  await act(async () =>
    resolve([{ tokenId: '7', balance: 42, rawBalance: '42', verified: true }])
  );
  fireEvent.click(screen.getByRole('button', { name: 'MAX' }));
  expect(nftAmount().value).toBe('41');
});
