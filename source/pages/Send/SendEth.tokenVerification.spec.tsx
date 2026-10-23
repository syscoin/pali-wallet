/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  jest.useFakeTimers();
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
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const token = (suffix = '3') => ({
  id: `verification-token-${suffix}`,
  contractAddress: `0x${suffix.repeat(40)}`,
  chainId: 1,
  tokenSymbol: suffix === '3' ? 'FIRST' : 'SECOND',
  tokenStandard: 'ERC-20',
  isNft: false,
  balance: 10,
  decimals: 18,
});
const verified = { balance: '1234567', decimals: 6 };
const recipient = '0x2222222222222222222222222222222222222222';
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const next = () => screen.getByRole('button', { name: 'buttons.next' });
const retry = () => screen.getByRole('button', { name: 'receive.retry' });
const tokenReads = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getERC20TokenInfo'
  );
const tick = (ms = 1000) => act(async () => jest.advanceTimersByTimeAsync(ms));
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const select = (symbol = 'FIRST') =>
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`${symbol}.*ERC-20`) })
  );
function prepare(read: (...args: any[]) => Promise<any>, restored = false) {
  mockAssets = [token(), token('4')];
  if (restored) {
    mockLocation.state = {
      walletScope: jest
        .requireActual('utils/navigationState')
        .getWalletNavigationScope(),
      selectedAsset: mockAssets[0],
      formValues: { receiver: recipient, amount: '1.234567' },
    };
  }
  mockEmitter.mockImplementation((path: string[], args: any[]) => {
    if (path.at(-1) === 'getERC20TokenInfo') return read(...args);
    if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return Promise.resolve({
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
      });
    return Promise.resolve(undefined);
  });
  const view = render(<SendEth />);
  if (!restored) select();
  return view;
}
async function submitExact() {
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: recipient },
  });
  fireEvent.change(amount(), { target: { value: '1.234567' } });
  await act(async () => fireEvent.click(next()));
  await tick(0);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate.mock.calls[0][2].tx).toMatchObject({
    sender:
      mockState.vault.accounts[mockState.vault.activeAccount.type][
        mockState.vault.activeAccount.id
      ].address,
    receivingAddress: recipient,
    amount: '1.234567',
    token: { contractAddress: token().contractAddress, decimals: 6 },
  });
}

it('keeps a healthy verified ERC20 amount exact through normal Next preparation', async () => {
  prepare(() => Promise.resolve(verified));
  expect(amount()).toBeDisabled();
  await tick();
  expect(amount()).toBeEnabled();
  await submitExact();
});

it('shows a settled failure and explicitly retries once without losing the restored draft', async () => {
  const pending = deferred();
  let reads = 0;
  prepare(
    () =>
      ++reads === 1
        ? Promise.reject(new Error('Synthetic token read failure'))
        : pending.promise,
    true
  );
  await tick();
  expect(screen.getByText('send.tokenVerificationFailed')).toBeVisible();
  expect(amount()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'send.max' })).toBeDisabled();
  expect(amount()).toHaveValue(1.234567);
  expect(screen.getByPlaceholderText('send.receiver')).toHaveValue(recipient);
  await act(async () => fireEvent.click(next()));
  expect(mockNavigate).not.toHaveBeenCalled();
  const action = retry();
  act(() => {
    fireEvent.click(action);
    fireEvent.click(action);
  });
  await tick();
  expect(tokenReads()).toHaveLength(2);
  expect(amount()).toBeDisabled();
  expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => pending.resolve(verified));
  expect(amount()).toBeEnabled();
  expect(amount()).toHaveValue(1.234567);
  expect(
    screen.queryByText('send.tokenVerificationFailed')
  ).not.toBeInTheDocument();
  await submitExact();
});

it('leaves a second failed retry explicit and never retries on its own', async () => {
  prepare(() => Promise.reject(new Error('Synthetic ongoing outage')));
  await tick();
  expect(screen.getByText('send.tokenVerificationFailed')).toBeVisible();
  await tick(5000);
  expect(tokenReads()).toHaveLength(1);
  fireEvent.click(retry());
  await tick();
  expect(screen.getByText('send.tokenVerificationFailed')).toBeVisible();
  expect(amount()).toBeDisabled();
  await tick(5000);
  expect(tokenReads()).toHaveLength(2);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each([
  null,
  { balance: '1.5', decimals: 6 },
  { balance: '1', decimals: 256 },
])(
  'keeps malformed verification %p fail-closed and explicitly retryable',
  async (reply) => {
    let reads = 0;
    prepare(() => Promise.resolve(++reads === 1 ? reply : verified));
    await tick();
    expect(screen.getByText('send.tokenVerificationFailed')).toBeVisible();
    expect(amount()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'send.max' })).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.click(retry());
    await tick();
    expect(amount()).toBeEnabled();
    expect(tokenReads()).toHaveLength(2);
  }
);

it('retires an old retry when another token is selected and preserves current verification', async () => {
  const old = deferred();
  const current = deferred();
  let firstReads = 0;
  prepare((address) =>
    address === token().contractAddress
      ? ++firstReads === 1
        ? Promise.reject(new Error('Synthetic first failure'))
        : old.promise
      : current.promise
  );
  await tick();
  fireEvent.click(retry());
  await tick();
  select('SECOND');
  await tick();
  await act(async () => old.resolve({ balance: '999000000', decimals: 6 }));
  expect(amount()).toBeDisabled();
  await act(async () => current.resolve({ balance: '2000000', decimals: 6 }));
  expect(amount()).toBeEnabled();
  expect(screen.getByText('2 SECOND')).toBeInTheDocument();
  expect(screen.queryByText('999 FIRST')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('retires an old retry on the actual exported account-keyed form remount', async () => {
  const old = deferred();
  const current = deferred();
  let reads = 0;
  const view = prepare(() =>
    ++reads === 1
      ? Promise.reject(new Error('Synthetic first failure'))
      : reads === 2
      ? old.promise
      : current.promise
  );
  await tick();
  fireEvent.click(retry());
  await tick();
  mockState.vault.accounts.HDAccount[1] = {
    ...mockState.vault.accounts.HDAccount[0],
    id: 1,
    address: '0x5555555555555555555555555555555555555555',
    xpub: 'public-b',
  };
  mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
  view.rerender(<SendEth />);
  select();
  await tick();
  await act(async () => old.resolve({ balance: '999000000', decimals: 6 }));
  expect(amount()).toBeDisabled();
  await act(async () => current.resolve(verified));
  expect(tokenReads()[2][1][1]).toBe(
    mockState.vault.accounts.HDAccount[1].address
  );
  await submitExact();
});

it('retires a pending explicit retry when the form unmounts', async () => {
  const pending = deferred();
  let reads = 0;
  const view = prepare(() =>
    ++reads === 1
      ? Promise.reject(new Error('Synthetic failure'))
      : pending.promise
  );
  await tick();
  fireEvent.click(retry());
  await tick();
  view.unmount();
  await act(async () => pending.resolve(verified));
  await tick(5000);
  expect(tokenReads()).toHaveLength(2);
  expect(mockNavigate).not.toHaveBeenCalled();
});
