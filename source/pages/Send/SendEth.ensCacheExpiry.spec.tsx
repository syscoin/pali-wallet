/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ENS_CACHE_TTL_MS } from 'state/vaultGlobal';

import { SendEth } from './SendEth';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CACHED = '0x2222222222222222222222222222222222222222';
const CURRENT = '0x3333333333333333333333333333333333333333';
const NAME = 'receiver.eth';
const mockEmitter = jest.fn();
const mockSave = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
let mockState: any;
let now: number;
const mockLocation = { key: 'send', pathname: '/send/eth', state: undefined };
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
          fireEvent.click(
            screen.getByRole('button', { name: `${NAME} (ENS) ens` })
          );
        else fireEvent.click(next);
        // Resolving the name changes the Form field. Wait for that normal
        // validation transition before submitting its displayed address.
        await waitFor(() =>
          expect(
            (screen.getByPlaceholderText('send.receiver') as HTMLInputElement)
              .value
          ).toMatch(/^0x[0-9a-f]{40}$/i)
        );
        fireEvent.click(next);
        await waitFor(() => expect(mockNavigateWithContext).toHaveBeenCalled());
        const navigation = mockNavigateWithContext.mock.calls[0];
        expect(navigation[1]).toBe('/send/confirm');
        expect(navigation[2].tx.receivingAddress).toBe(expected);
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
