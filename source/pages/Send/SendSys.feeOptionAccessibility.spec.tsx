/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { SendSys } from './SendSys';

let mockState: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockAssets = [
  { assetGuid: '123', chainId: 57, symbol: 'SPT', balance: '2.5', decimals: 2 },
];
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/send/sys', state: null }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account: state.vault.accounts.HDAccount[0],
    assets: { syscoin: mockAssets },
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, loading, fullWidth, ...props }: any) => (
    <button {...props} aria-busy={loading} data-full-width={fullWidth}>
      {children}
    </button>
  ),
  Fee: () => null,
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('jdenticon', () => ({ toSvg: () => '<svg></svg>' }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  isNFT: () => false,
  getAssetBalance: () => '',
  ellipsis: (value: string) => value,
  MINIMUM_FEE: 0.00000001,
  adjustUrl: (value: string) => value,
  createNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  removeScientificNotation: (...args: any[]) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(...args),
}));
jest.mock('utils/validations', () => ({
  isValidSYSAddress: () => Promise.resolve(true),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
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
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/app.html');
  mockSave.mockResolvedValue(undefined);
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: 'synthetic-sender',
            xpub: 'synthetic-public-xpub',
            balances: { syscoin: '1.25' },
          },
        },
      },
      isBitcoinBased: true,
      activeNetwork: {
        chainId: 57,
        kind: 'syscoin',
        slip44: 57,
        url: 'https://blockbook.invalid',
        currency: 'SYS',
      },
    },
  };
  mockEmitter.mockImplementation(async (path: string[]) => {
    const method = path[path.length - 1];
    if (method === 'getRecommendedFee') return 0.00000001;
    if (method === 'refreshActiveAccountBalances') return undefined;
    throw new Error('Unexpected controller method ' + method);
  });
});

const mount = async () => {
  const user = userEvent.setup();
  await act(async () => render(<SendSys />));
  return user;
};
const selectSpt = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'SYS', exact: true }));
  await user.click(screen.getByRole('menuitem', { name: 'SPT SPT' }));
  expect(screen.getByText('Z-DAG', { exact: true })).toBeVisible();
};
const savedRbf = () =>
  mockSave.mock.calls[mockSave.mock.calls.length - 1]?.[2].RBF;

// Real Ant Form and Headless UI Menu/Switch: no switch/name/checked mock.
it('healthy native control exposes the real checked state and visible RBF text', async () => {
  await mount();
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(screen.getByRole('switch')).toBeChecked();
  expect(screen.getByText('RBF', { exact: true })).toBeVisible();
});

it('healthy keyboard and pointer changes retain the native RBF draft semantics', async () => {
  const user = await mount();
  const control = screen.getByRole('switch');
  control.focus();
  await user.keyboard(' ');
  expect(control).not.toBeChecked();
  await waitFor(() => expect(savedRbf()).toBe(false));
  await user.click(control);
  expect(control).toBeChecked();
  await waitFor(() => expect(savedRbf()).toBe(true));
});

it('healthy ordinary SPT selection retains the inverse Z-DAG/RBF draft semantics', async () => {
  const user = await mount();
  await selectSpt(user);
  const control = screen.getByRole('switch');
  expect(control).not.toBeChecked();
  control.focus();
  await user.keyboard(' ');
  expect(control).toBeChecked();
  await waitFor(() => expect(savedRbf()).toBe(false));
  await user.click(control);
  expect(control).not.toBeChecked();
  await waitFor(() => expect(savedRbf()).toBe(true));
});

it('names the ordinary native fee-option switch from its visible RBF label', async () => {
  await mount();
  expect(screen.getByRole('switch')).toHaveAccessibleName('RBF');
  expect(
    screen.getByRole('switch', { name: 'RBF', exact: true })
  ).toBeChecked();
});

it('names the ordinary SPT fee-option switch from its visible Z-DAG label', async () => {
  const user = await mount();
  await selectSpt(user);
  expect(screen.getByRole('switch')).toHaveAccessibleName('Z-DAG');
  expect(
    screen.getByRole('switch', { name: 'Z-DAG', exact: true })
  ).not.toBeChecked();
});
