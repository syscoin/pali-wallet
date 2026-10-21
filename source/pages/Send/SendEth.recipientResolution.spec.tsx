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
const mockLocation = { key: 'send', pathname: '/send/eth', state: undefined };
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const RESOLVED = '0x3333333333333333333333333333333333333333';
const LATER_RESOLVED = '0x4444444444444444444444444444444444444444';
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
    account: state.vault.accounts.HDAccount[0],
    assets: { ethereum: [], syscoin: [] },
  }),
  selectValidEnsCache: () => ({}),
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, variant, fullWidth, loading, icon, ...props }: any) => (
    <button
      {...props}
      disabled={props.disabled || loading}
      data-variant={variant}
      data-full-width={fullWidth}
    >
      {children}
      {icon}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  Icon: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('@headlessui/react', () => {
  const Pass = ({ children }: any) => (
    <>{typeof children === 'function' ? children({ open: false }) : children}</>
  );
  return {
    Menu: Object.assign(Pass, { Button: Pass, Items: Pass, Item: Pass }),
  };
});

const deferred = () => {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const setResolver = (pending: ReturnType<typeof deferred>) =>
  mockEmitter.mockImplementation((path) => {
    const method = path[path.length - 1];
    if (method === 'resolveEns') return pending.promise;
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return Promise.resolve({
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
      });
    return Promise.resolve(undefined);
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
  mockEmitter.mockImplementation(async () => undefined);
  mockSave.mockResolvedValue(undefined);
});
const receiver = () =>
  screen.getByPlaceholderText('send.receiver') as HTMLInputElement;
const begin = async () => {
  render(<SendEth />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.next' })).toBeEnabled()
  );
  fireEvent.change(receiver(), { target: { value: 'earlier.eth' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(([[, method]]) => method === 'resolveEns')
    ).toBe(true)
  );
};

const submitCurrentRecipient = async (expected: string) => {
  fireEvent.change(screen.getByPlaceholderText('send.amount'), {
    target: { value: '0.01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalled());
  expect(mockNavigateWithContext.mock.calls[0][2].tx.receivingAddress).toBe(
    expected
  );
};

it('does not replace a newer hex recipient with an older ENS response', async () => {
  const pending = deferred();
  setResolver(pending);
  await begin();
  fireEvent.change(receiver(), { target: { value: RECIPIENT } });
  expect(receiver()).toHaveValue(RECIPIENT);
  await act(async () => pending.resolve(RESOLVED));
  expect(receiver()).toHaveValue(RECIPIENT);
  await submitCurrentRecipient(RECIPIENT);
});

it('still resolves the current ENS recipient', async () => {
  const pending = deferred();
  setResolver(pending);
  await begin();
  await act(async () => pending.resolve(RESOLVED));
  expect(receiver()).toHaveValue('earlier.eth');
  await submitCurrentRecipient(RESOLVED);
});

it('does not refill a cleared recipient from an older ENS response', async () => {
  const pending = deferred();
  setResolver(pending);
  await begin();
  fireEvent.change(receiver(), { target: { value: '' } });
  await act(async () => pending.resolve(RESOLVED));
  expect(receiver()).toHaveValue('');
});

it.each(['earlier-first', 'later-first'])(
  'keeps the latest ENS lookup when responses resolve %s',
  async (order) => {
    const earlier = deferred();
    const later = deferred();
    setResolver(earlier);
    const normal = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((path, args) =>
      path[1] === 'resolveEns' && args[0] === 'later.eth'
        ? later.promise
        : normal(path, args)
    );
    await begin();
    fireEvent.change(receiver(), { target: { value: 'later.eth' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'resolveEns'],
        ['later.eth']
      )
    );
    if (order === 'earlier-first') {
      await act(async () => earlier.resolve(RESOLVED));
      expect(receiver()).toHaveValue('later.eth');
      await act(async () => later.resolve(LATER_RESOLVED));
    } else {
      await act(async () => later.resolve(LATER_RESOLVED));
      expect(receiver()).toHaveValue('later.eth');
      await act(async () => earlier.resolve(RESOLVED));
    }
    expect(receiver()).toHaveValue('later.eth');
    await submitCurrentRecipient(LATER_RESOLVED);
  }
);

it.each(['older-first', 'newer-first'])(
  'keeps the newest same-name request after an intervening edit (%s)',
  async (order) => {
    const earlier = deferred();
    const later = deferred();
    setResolver(earlier);
    const normal = mockEmitter.getMockImplementation()!;
    let reads = 0;
    mockEmitter.mockImplementation((path, args) =>
      path[1] === 'resolveEns'
        ? ++reads === 1
          ? earlier.promise
          : later.promise
        : normal(path, args)
    );
    await begin();
    fireEvent.change(receiver(), { target: { value: RECIPIENT } });
    fireEvent.change(receiver(), { target: { value: 'earlier.eth' } });
    fireEvent.change(screen.getByPlaceholderText('send.amount'), {
      target: { value: '0.01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
    await waitFor(() => expect(reads).toBe(2));
    if (order === 'older-first') {
      await act(async () => earlier.resolve(RESOLVED));
      expect(mockNavigateWithContext).not.toHaveBeenCalled();
      await act(async () => later.resolve(LATER_RESOLVED));
    } else {
      await act(async () => later.resolve(LATER_RESOLVED));
      await act(async () => earlier.resolve(RESOLVED));
    }
    await waitFor(() =>
      expect(mockNavigateWithContext).toHaveBeenCalledTimes(1)
    );
    expect(mockNavigateWithContext.mock.calls[0][2].tx.receivingAddress).toBe(
      LATER_RESOLVED
    );
    expect(receiver()).toHaveValue('earlier.eth');
  }
);

it('retains the current name and validation error when it cannot be resolved', async () => {
  const pending = deferred();
  setResolver(pending);
  await begin();
  await act(async () => pending.resolve(null));
  expect(receiver()).toHaveValue('earlier.eth');
  expect(await screen.findByText('send.unableToResolveEns')).toBeVisible();
});

describe('reverse ENS suggestion query ownership', () => {
  const originalAddress = '0x1111111111111111111111111111111111111111';
  const currentLabel = 'Current local recipient';

  const openChooser = async (
    reverse: (input: string) => Promise<string | null>
  ) => {
    mockState.vault.accounts.HDAccount[1] = {
      ...mockState.vault.accounts.HDAccount[0],
      id: 1,
      label: currentLabel,
      address: RECIPIENT,
      xpub: 'public-b',
    };
    mockEmitter.mockImplementation(async (path, args) => {
      if (path[1] === 'reverseResolveEns') return reverse(args[0]);
      if (path[1] === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
        return {
          maxFeePerGas: '1000000000',
          maxPriorityFeePerGas: '100000000',
        };
      return undefined;
    });
    const view = render(<SendEth />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buttons.next' })).toBeEnabled()
    );
    return view;
  };
  const reverseResponse = () => {
    let resolve!: (value: string | null) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string | null>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  };
  const displayedSuggestions = () => ({
    original: Boolean(
      screen.queryByRole('button', { name: 'Synthetic account account' })
    ),
    current: Boolean(
      screen.queryByRole('button', { name: `${currentLabel} account` })
    ),
  });

  it('keeps a healthy unchanged lookup matched to its input', async () => {
    const old = deferred();
    await openChooser(() => old.promise);
    fireEvent.change(receiver(), { target: { value: originalAddress } });
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'reverseResolveEns'],
        [originalAddress]
      )
    );
    await act(async () => old.resolve(null));
    expect(receiver()).toHaveValue(originalAddress);
    expect(displayedSuggestions()).toEqual({ original: true, current: false });
    await submitCurrentRecipient(originalAddress);
  });

  it('cancels a retired lookup timer before a newer query is entered', async () => {
    await openChooser(async () => null);
    await act(async () => {
      fireEvent.change(receiver(), { target: { value: originalAddress } });
      fireEvent.change(receiver(), { target: { value: RECIPIENT } });
    });
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'reverseResolveEns'],
        [RECIPIENT]
      )
    );
    expect(mockEmitter).not.toHaveBeenCalledWith(
      ['wallet', 'reverseResolveEns'],
      [originalAddress]
    );
    expect(displayedSuggestions()).toEqual({ original: false, current: true });
    await submitCurrentRecipient(RECIPIENT);
  });

  it.each(['null', 'success', 'error'] as const)(
    'ignores an old %s reverse response after the recipient changes and accepts the current response',
    async (result) => {
      const old = reverseResponse();
      const current = reverseResponse();
      await openChooser((input) =>
        input === originalAddress ? old.promise : current.promise
      );
      fireEvent.change(receiver(), { target: { value: originalAddress } });
      await waitFor(() =>
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'reverseResolveEns'],
          [originalAddress]
        )
      );
      fireEvent.change(receiver(), { target: { value: RECIPIENT } });
      expect(displayedSuggestions()).toEqual({
        original: false,
        current: true,
      });
      await act(async () => {
        if (result === 'error')
          old.reject(new Error('Synthetic reverse failure'));
        else old.resolve(result === 'success' ? 'previous.eth' : null);
      });
      expect(receiver()).toHaveValue(RECIPIENT);
      const afterOldReply = displayedSuggestions();
      await waitFor(() =>
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'reverseResolveEns'],
          [RECIPIENT]
        )
      );
      await act(async () => current.resolve('current.eth'));
      expect(displayedSuggestions()).toEqual({
        original: false,
        current: true,
      });
      // Even the broken chooser must not be mistaken for a signing mismatch:
      // submitting without selecting a stale suggestion retains the typed hex.
      await submitCurrentRecipient(RECIPIENT);
      expect(afterOldReply).toEqual({ original: false, current: true });
    }
  );

  it('ignores a retired response after leaving and reopening the send form', async () => {
    const old = reverseResponse();
    const view = await openChooser((input) =>
      input === originalAddress ? old.promise : Promise.resolve('current.eth')
    );
    fireEvent.change(receiver(), { target: { value: originalAddress } });
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'reverseResolveEns'],
        [originalAddress]
      )
    );
    view.unmount();
    window.history.replaceState(null, '', '/app.html#/home');
    window.history.replaceState(null, '', '/app.html#/send/eth');
    await openChooser(async () => 'current.eth');
    fireEvent.change(receiver(), { target: { value: RECIPIENT } });
    await act(async () => old.resolve('previous.eth'));
    expect(receiver()).toHaveValue(RECIPIENT);
    expect(displayedSuggestions()).toEqual({ original: false, current: true });
    await submitCurrentRecipient(RECIPIENT);
  });
});
