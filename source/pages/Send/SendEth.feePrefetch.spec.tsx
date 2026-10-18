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
const preview = async () => {
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: RECIPIENT },
  });
  fireEvent.change(screen.getByPlaceholderText('send.amount'), {
    target: { value: '1' },
  });
  fireEvent.click(next());
  await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalledTimes(1));
  return mockNavigateWithContext.mock.calls[0][2].tx;
};

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

it('ends a failed prefetch without retrying or blocking confirmation preparation', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const held = deferred();
  let attempts = 0;
  setFeeReader(() =>
    ++attempts === 1
      ? Promise.reject(new Error('Synthetic fee service unavailable'))
      : held.promise
  );
  render(<SendEth />);
  await flush();
  expect(next()).toBeEnabled();
  expect(feeCalls()).toHaveLength(1);
  expect(await preview()).toMatchObject({ cachedGasData: null, amount: '1' });
  expect(feeCalls()).toHaveLength(1);
});

it('caches a successful prefetch once as serializable fee rates', async () => {
  render(<SendEth />);
  await flush();
  expect(next()).toBeEnabled();
  expect(feeCalls()).toHaveLength(1);
  expect(await preview()).toMatchObject({
    cachedGasData: {
      maxFeePerGas: '0x3b9aca00',
      maxPriorityFeePerGas: '0x05f5e100',
    },
  });
  expect(feeCalls()).toHaveLength(1);
});

it('keeps Next busy only while the current prefetch is pending', async () => {
  const pending = deferred();
  setFeeReader(() => pending.promise);
  const view = render(<SendEth />);
  expect(next()).toBeDisabled();
  view.rerender(<SendEth />);
  expect(feeCalls()).toHaveLength(1);
  expect(next()).toBeDisabled();
  await act(async () => pending.resolve(QUOTE));
  expect(next()).toBeEnabled();
  expect(feeCalls()).toHaveLength(1);
});

it('does not retry an unusable fee reply on its own loading state', async () => {
  setFeeReader(() => Promise.resolve(undefined));
  render(<SendEth />);
  await flush();
  expect(next()).toBeEnabled();
  expect(feeCalls()).toHaveLength(1);
});

it.each(['account', 'network', 'unmount'])(
  'starts a fresh quote after %s change and ignores the departed request',
  async (change) => {
    const old = deferred();
    const current = deferred();
    let attempts = 0;
    setFeeReader(() => (++attempts === 1 ? old.promise : current.promise));
    let view = render(<SendEth />);
    expect(next()).toBeDisabled();
    if (change === 'account') {
      mockState.vault.accounts.HDAccount[1] = {
        ...mockState.vault.accounts.HDAccount[0],
        id: 1,
        address: '0x3333333333333333333333333333333333333333',
        xpub: 'public-b',
      };
      mockState.vault.activeAccount = { id: 1, type: 'HDAccount' };
    } else if (change === 'network') {
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        chainId: 2,
        url: 'https://other-rpc.invalid',
      };
    } else {
      view.unmount();
      view = render(<SendEth />);
    }
    view.rerender(<SendEth />);
    expect(feeCalls()).toHaveLength(2);
    await act(async () => old.resolve({ ...QUOTE, maxFeePerGas: '999999999' }));
    expect(next()).toBeDisabled();
    await act(async () => current.resolve(QUOTE));
    expect(next()).toBeEnabled();
    expect((await preview()).cachedGasData.maxFeePerGas).toBe('0x3b9aca00');
  }
);

it('retries on returning to native and ignores the previous selection request', async () => {
  mockAssets = [
    {
      id: 'token',
      chainId: 1,
      tokenSymbol: 'TOKEN',
      tokenStandard: 'ERC-20',
      contractAddress: '0x4444444444444444444444444444444444444444',
      decimals: 18,
      balance: '10',
    },
  ];
  const old = deferred();
  const current = deferred();
  let attempts = 0;
  setFeeReader(() => (++attempts === 1 ? old.promise : current.promise));
  render(<SendEth />);
  expect(next()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /TOKEN/ }));
  fireEvent.click(screen.getByRole('button', { name: /ETH send.native/ }));
  expect(feeCalls()).toHaveLength(2);
  await act(async () => old.resolve({ ...QUOTE, maxFeePerGas: '999999999' }));
  expect(next()).toBeDisabled();
  await act(async () => current.resolve(QUOTE));
  expect(next()).toBeEnabled();
  expect((await preview()).cachedGasData.maxFeePerGas).toBe('0x3b9aca00');
});
