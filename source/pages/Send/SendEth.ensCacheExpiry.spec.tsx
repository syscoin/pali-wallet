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

import { ENS_CACHE_TTL_MS } from 'state/vaultGlobal';
import { getWalletNavigationScope } from 'utils/navigationState';

import { SendEth } from './SendEth';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CACHED = '0x2222222222222222222222222222222222222222';
const CURRENT = '0x3333333333333333333333333333333333333333';
const MANUAL = '0x4444444444444444444444444444444444444444';
const NAME = 'receiver.eth';
const mockEmitter = jest.fn();
const mockSave = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn() };
let mockReceiverValidator: (_: unknown, value: string) => Promise<void>;
let mockFinish: (values: any) => Promise<void>;
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
let mockState: any;
let now: number;
const mockLocation = {
  key: 'send',
  pathname: '/send/eth',
  state: undefined as any,
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
    alert: mockAlert,
  }),
}));
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  // Keep the real Form/UI, but expose the exact validated/onFinish boundary
  // to model another field delaying the final completion deterministically.
  const Form = Object.assign(
    (props: any) => {
      mockFinish = props.onFinish;
      return <actual.Form {...props} />;
    },
    actual.Form,
    {
      Item: (props: any) => {
        if (props.name === 'receiver') {
          const rule = props.rules.find(
            (entry: any) => typeof entry === 'function'
          );
          mockReceiverValidator = rule().validator;
        }
        return <actual.Form.Item {...props} />;
      },
    }
  );
  return { ...actual, Form };
});
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
  now = 1_000_000;
  mockLocation.state = undefined;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  window.history.replaceState(null, '', '/app.html');
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            label: 'Synthetic account',
            address: ACCOUNT,
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
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
    vaultGlobal: {
      activeSlip44: 60,
      isBitcoinBased: false,
      ensCache: { [CACHED]: { name: NAME, timestamp: now } },
    },
  };
  mockSave.mockResolvedValue(undefined);
  mockEmitter.mockImplementation(async (path) => {
    if (path[1] === 'resolveEns') return CURRENT;
    if (path[1] === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return { maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000' };
    return undefined;
  });
});
afterEach(() => jest.restoreAllMocks());

describe.each(['typed', 'suggestion', 'held-suggestion'] as const)(
  '%s ENS recipient',
  (entry) => {
    it.each([
      ['fresh cache', false, false, CACHED],
      ['cache expired before first render', true, false, CURRENT],
      ['cache expires while the form is mounted', false, true, CURRENT],
    ] as const)(
      'resolves the submit target from %s',
      async (_label, expiredBeforeRender, expiresAfterRender, expected) => {
        if (expiredBeforeRender) now += ENS_CACHE_TTL_MS + 1;
        render(<SendEth />);
        const next = screen.getByRole('button', { name: 'buttons.next' });
        await waitFor(() => expect(next).toBeEnabled());
        fireEvent.change(screen.getByPlaceholderText('send.amount'), {
          target: { value: '0.01' },
        });
        if (expiresAfterRender && entry !== 'held-suggestion')
          now += ENS_CACHE_TTL_MS + 1;
        const originalCache = mockState.vaultGlobal.ensCache;
        fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
          target: { value: NAME },
        });
        if (expiresAfterRender && entry === 'held-suggestion')
          now += ENS_CACHE_TTL_MS + 1;
        if (entry !== 'typed')
          await act(async () => {
            fireEvent.click(
              screen.getByRole('button', { name: `${NAME} (ENS) ens` })
            );
          });
        fireEvent.click(next);
        await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalled());
        const navigation = mockNavigateWithContext.mock.calls[0];
        expect(navigation[1]).toBe('/send/confirm');
        expect(navigation[2].tx.receivingAddress).toBe(expected);
        expect(screen.getByPlaceholderText('send.receiver')).toHaveValue(NAME);
        expect(mockState.vaultGlobal.ensCache).toBe(originalCache);
        if (expected === CURRENT)
          expect(mockEmitter).toHaveBeenCalledWith(
            ['wallet', 'resolveEns'],
            [NAME]
          );
        else
          expect(
            mockEmitter.mock.calls.some(([path]) => path[1] === 'resolveEns')
          ).toBe(false);
        expect(
          mockEmitter.mock.calls.some(([path]) =>
            /send|sign|submit/i.test(path[1])
          )
        ).toBe(false);
      }
    );
  }
);

describe.each(['next', 'suggestion'] as const)(
  'previous ENS validation by %s',
  (entry) => {
    it.each([
      ['fresh derived address', false, false, CACHED],
      ['expired derived address', true, false, CURRENT],
      ['manual hex edit after expiry', true, true, MANUAL],
    ] as const)(
      'submits the correct target for %s',
      async (_label, expires, manualEdit, expected) => {
        render(<SendEth />);
        const next = screen.getByRole('button', { name: 'buttons.next' });
        const receiver = screen.getByPlaceholderText('send.receiver');
        const amount = screen.getByPlaceholderText('send.amount');
        await waitFor(() => expect(next).toBeEnabled());
        fireEvent.change(receiver, { target: { value: NAME } });
        await act(async () => {
          if (entry === 'next') fireEvent.click(next);
          else
            fireEvent.click(
              screen.getByRole('button', { name: `${NAME} (ENS) ens` })
            );
        });
        expect(receiver).toHaveValue(NAME);
        fireEvent.blur(receiver, { relatedTarget: amount });
        expect(mockNavigateWithContext).not.toHaveBeenCalled();
        if (expires) now += ENS_CACHE_TTL_MS + 1;
        if (manualEdit)
          fireEvent.change(receiver, { target: { value: MANUAL } });
        fireEvent.change(amount, { target: { value: '0.01' } });
        fireEvent.click(next);
        await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalled());
        const navigation = mockNavigateWithContext.mock.calls[0];
        expect(navigation[2].tx.receivingAddress).toBe(expected);
        if (expected === CURRENT)
          expect(mockEmitter).toHaveBeenCalledWith(
            ['wallet', 'resolveEns'],
            [NAME]
          );
        else
          expect(
            mockEmitter.mock.calls.some(([path]) => path[1] === 'resolveEns')
          ).toBe(false);
      }
    );
  }
);

it('preserves the ENS name in a saved draft and resolves it again after reopening past expiry', async () => {
  const view = render(<SendEth />);
  const receiver = screen.getByPlaceholderText('send.receiver');
  fireEvent.change(receiver, { target: { value: NAME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `${NAME} (ENS) ens` }));
  });
  fireEvent.blur(receiver);
  await waitFor(() =>
    expect(
      mockSave.mock.calls.some(
        ([, , state]) => state.formValues.receiver === NAME
      )
    ).toBe(true)
  );
  const saved = [...mockSave.mock.calls]
    .reverse()
    .find(([, , state]) => state.formValues.receiver === NAME)![2];
  view.unmount();
  now += ENS_CACHE_TTL_MS + 1;
  mockLocation.state = { ...saved, walletScope: getWalletNavigationScope() };
  render(<SendEth />);
  expect(screen.getByPlaceholderText('send.receiver')).toHaveValue(NAME);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.next' })).toBeEnabled()
  );
  fireEvent.change(screen.getByPlaceholderText('send.amount'), {
    target: { value: '0.01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'resolveEns'], [NAME])
  );
  await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalled());
  expect(mockNavigateWithContext.mock.calls[0][2].tx.receivingAddress).toBe(
    CURRENT
  );
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'resolveEns'], [NAME]);
});

describe('validated ENS destination at the onFinish boundary', () => {
  const prepare = async () => {
    const view = render(<SendEth />);
    const receiver = screen.getByPlaceholderText('send.receiver');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buttons.next' })).toBeEnabled()
    );
    await act(async () => {
      fireEvent.change(receiver, { target: { value: NAME } });
      fireEvent.change(screen.getByPlaceholderText('send.amount'), {
        target: { value: '0.01' },
      });
    });
    await act(async () => {
      await mockReceiverValidator(undefined, NAME);
    });
    expect(receiver).toHaveValue(NAME);
    expect(mockNavigateWithContext).not.toHaveBeenCalled();
    return view;
  };

  it.each([false, true])(
    'keeps the validated destination when cache publication changes=%s',
    async (changeCache) => {
      const view = await prepare();
      if (changeCache) {
        mockState = {
          ...mockState,
          vaultGlobal: {
            ...mockState.vaultGlobal,
            ensCache: { [MANUAL]: { name: NAME, timestamp: now } },
          },
        };
        view.rerender(<SendEth />);
      }
      await act(async () => {
        await mockFinish({ receiver: NAME, amount: '0.01' });
      });
      expect(mockNavigateWithContext).toHaveBeenCalledTimes(1);
      expect(mockNavigateWithContext.mock.calls[0][2].tx.receivingAddress).toBe(
        CACHED
      );
    }
  );

  it('fails closed if its validated resolution expires before onFinish', async () => {
    await prepare();
    now += ENS_CACHE_TTL_MS + 1;
    await act(async () => {
      await mockFinish({ receiver: NAME, amount: '0.01' });
    });
    expect(mockNavigateWithContext).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith('send.unableToResolveEns');
  });

  it('does not override an explicit manual hex edit with an earlier ENS resolution', async () => {
    await prepare();
    fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
      target: { value: MANUAL },
    });
    await act(async () => {
      await mockFinish({ receiver: MANUAL, amount: '0.01' });
    });
    expect(mockNavigateWithContext.mock.calls[0][2].tx.receivingAddress).toBe(
      MANUAL
    );
  });
});
