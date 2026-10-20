/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import { DetailsView } from '../Details';
import vaultReducer, {
  setAccountAssets,
  setAccounts,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockWrite = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
let mockRenderToasts = false;
const mockTranslate = (key: string) => key;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('react-toastify', () => {
  const actual = jest.requireActual('react-toastify');
  return {
    ...actual,
    toast: Object.assign(jest.fn(), {
      info: (...args: any[]) => {
        mockInfo(...args);
        if (mockRenderToasts) return actual.toast.info(...args);
      },
      error: (...args: any[]) => mockError(...args),
      dismiss: (...args: any[]) => {
        mockDismiss(...args);
        if (mockRenderToasts) actual.toast.dismiss(...args);
      },
    }),
  };
});
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Icon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  ExternalLinkSvg: () => null,
  FiExternalLink: () => null,
  FiCopy: () => null,
  RiFileCopyLine: () => null,
}));
jest.mock('utils/index', () => ({
  formatCurrency: (value: string) => value,
  truncate: (value: string) => value,
  camelCaseToText: (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1),
  syscoinKeysOfInterest: ['symbol', 'decimals', 'balance', 'contract'],
  adjustUrl: (value: string) => value,
  getKnownSyscoinAsset: () => null,
  getTokenLogo: () => undefined,
}));
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: () => {
    throw new Error('Clipboard test must not perform network reads');
  },
}));
jest.mock('../TransactionDetails', () => ({ TransactionDetails: () => null }));

const GUID = '998877';
const TYPE = KeyringAccountType.HDAccount;
const CONTRACT = `0x${'11'.repeat(20)}`;
const network = {
  kind: INetworkType.Syscoin,
  chainId: 5700,
  slip44: 1,
  label: 'Syscoin Testnet',
  url: 'https://testnet.synthetic.invalid/',
  explorer: 'https://testnet.synthetic.invalid/',
};
const nextNetwork = {
  ...network,
  chainId: 57,
  label: 'Syscoin Mainnet',
  url: 'https://mainnet.synthetic.invalid/',
  explorer: 'https://mainnet.synthetic.invalid/',
};
const token = (symbol: string, chainId: number, contract: string) => ({
  assetGuid: GUID,
  chainId,
  symbol,
  contract,
  decimals: 8,
  balance: 1,
  totalSent: 0,
  totalReceived: 1,
});
const pending = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};
let clock = 2_000_000_000_000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime((clock += 10_000));
  jest.clearAllMocks();
  mockRenderToasts = false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      price: (state = { fiat: { asset: 'usd' } }) => state,
      vaultGlobal: (state = { activeSlip44: 1 }) => state,
    },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeAccount: { type: TYPE, id: 0 },
        activeNetwork: network,
        accounts: {
          ...initial.accounts,
          [TYPE]: {
            0: { id: 0, address: 'SYS-public-a', xpub: 'public-xpub-a' },
            1: { id: 1, address: 'SYS-public-b', xpub: 'public-xpub-b' },
          },
        },
        accountAssets: {
          ...initial.accountAssets,
          [TYPE]: {
            0: {
              ethereum: [],
              syscoin: [
                token('TEST', 5700, CONTRACT),
                token('MAIN', 57, `0x${'22'.repeat(20)}`),
              ],
            },
            1: {
              ethereum: [],
              syscoin: [token('OTHER', 5700, `0x${'33'.repeat(20)}`)],
            },
          },
        },
      } as any,
    },
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

const mount = () =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={[{ pathname: '/home/details', state: { id: GUID } }]}
      >
        <Routes>
          <Route path="/home/details" element={<DetailsView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
const settle = async (
  write: ReturnType<typeof pending>,
  outcome: 'success' | 'refusal'
) => {
  await act(async () => {
    if (outcome === 'success') write.resolve();
    else write.reject(new Error('Synthetic clipboard refusal'));
  });
  // The real success effect queues its toast after React commits copied=true.
  await act(async () => jest.advanceTimersByTimeAsync(0));
};

describe.each(['success', 'refusal'] as const)(
  'pending %s clipboard feedback',
  (outcome) => {
    it.each([
      'account',
      'network',
      'identity',
      'contract',
      'endpoint',
    ] as const)(
      'does not report the old asset after the real details parent reuses its component across a %s change',
      async (change) => {
        const write = pending();
        mockWrite.mockReturnValue(write.promise);
        mount();
        expect(screen.getByText('TEST (Syscoin Testnet)')).toBeInTheDocument();
        const button = screen.getByTitle('send.copyContractAddress');
        fireEvent.click(button);
        expect(mockWrite).toHaveBeenCalledWith(CONTRACT);
        act(() => {
          if (change === 'network')
            mockStore.dispatch(setActiveNetwork(nextNetwork as any));
          else if (change === 'account')
            mockStore.dispatch(setActiveAccount({ id: 1, type: TYPE }));
          else if (change === 'endpoint')
            mockStore.dispatch(
              setActiveNetwork({
                ...network,
                url: 'https://replacement.synthetic.invalid/',
              } as any)
            );
          else if (change === 'identity') {
            const accounts = mockStore.getState().vault.accounts;
            mockStore.dispatch(
              setAccounts({
                ...accounts,
                [TYPE]: {
                  ...accounts[TYPE],
                  0: {
                    ...accounts[TYPE][0],
                    address: 'SYS-public-replacement',
                    xpub: 'public-xpub-replacement',
                  },
                },
              })
            );
          } else
            mockStore.dispatch(
              setAccountAssets({
                accountId: 0,
                accountType: TYPE,
                property: 'syscoin',
                value: [token('TEST', 5700, `0x${'44'.repeat(20)}`)],
              })
            );
        });
        expect(
          screen.getByText(
            change === 'network'
              ? 'MAIN (Syscoin Mainnet)'
              : change === 'account'
              ? 'OTHER (Syscoin Testnet)'
              : 'TEST (Syscoin Testnet)'
          )
        ).toBeInTheDocument();
        // No manual rerender or replacement parent: the real DetailsView and
        // AssetDetails path keeps this exact button/component mounted.
        expect(screen.getByTitle('send.copyContractAddress')).toBe(button);
        await settle(write, outcome);
        expect(mockInfo).not.toHaveBeenCalled();
        expect(mockError).not.toHaveBeenCalled();
      }
    );

    it('retires feedback when the owning details route unmounts', async () => {
      const write = pending();
      mockWrite.mockReturnValue(write.promise);
      const view = mount();
      fireEvent.click(screen.getByTitle('send.copyContractAddress'));
      view.unmount();
      await settle(write, outcome);
      expect(mockInfo).not.toHaveBeenCalled();
      expect(mockError).not.toHaveBeenCalled();
    });

    it('preserves feedback when the copied asset remains current', async () => {
      const write = pending();
      mockWrite.mockReturnValue(write.promise);
      mount();
      fireEvent.click(screen.getByTitle('send.copyContractAddress'));
      await settle(write, outcome);
      if (outcome === 'success') {
        expect(mockInfo).toHaveBeenCalledWith('home.contractCopied', undefined);
        expect(mockError).not.toHaveBeenCalled();
      } else {
        expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
        expect(mockInfo).not.toHaveBeenCalled();
      }
    });

    it('preserves feedback across an ordinary balance and label refresh', async () => {
      const write = pending();
      mockWrite.mockReturnValue(write.promise);
      mount();
      fireEvent.click(screen.getByTitle('send.copyContractAddress'));
      act(() => {
        mockStore.dispatch(
          setAccountAssets({
            accountId: 0,
            accountType: TYPE,
            property: 'syscoin',
            value: [{ ...token('REFRESHED', 5700, CONTRACT), balance: 42 }],
          })
        );
      });
      expect(
        screen.getByText('REFRESHED (Syscoin Testnet)')
      ).toBeInTheDocument();
      await settle(write, outcome);
      if (outcome === 'success')
        expect(mockInfo).toHaveBeenCalledWith('home.contractCopied', undefined);
      else expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
    });
  }
);

it('does not migrate a copied success effect into a different asset context', async () => {
  const write = pending();
  mockWrite.mockReturnValue(write.promise);
  mount();
  fireEvent.click(screen.getByTitle('send.copyContractAddress'));
  await act(async () => write.resolve());
  // Resolve committed copied=true, but deliberately hold the queued info toast.
  act(() => mockStore.dispatch(setActiveAccount({ id: 1, type: TYPE })));
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(mockInfo).not.toHaveBeenCalled();
});

it('keeps the visible copied toast during an ordinary balance and label refresh', async () => {
  mockRenderToasts = true;
  const write = pending();
  mockWrite.mockReturnValue(write.promise);
  mount();
  render(<ToastContainer autoClose={false} />);
  fireEvent.click(screen.getByTitle('send.copyContractAddress'));
  await settle(write, 'success');
  expect(screen.getByRole('alert')).toHaveTextContent('home.contractCopied');
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(mockInfo).toHaveBeenCalledTimes(1);
  act(() => {
    mockStore.dispatch(
      setAccountAssets({
        accountId: 0,
        accountType: TYPE,
        property: 'syscoin',
        value: [{ ...token('REFRESHED', 5700, CONTRACT), balance: 42 }],
      })
    );
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(screen.getByText('REFRESHED (Syscoin Testnet)')).toBeInTheDocument();
  expect({
    dismissCalls: mockDismiss.mock.calls.length,
    visibleToast: screen.queryByRole('alert')?.textContent,
  }).toEqual({
    dismissCalls: 1,
    visibleToast: expect.stringContaining('home.contractCopied'),
  });
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('home.contractCopied');
});
