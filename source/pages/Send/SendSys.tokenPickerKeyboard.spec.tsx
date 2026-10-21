/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { SendSys } from './SendSys';

let mockAssets: any[];
let mockState: any;
let mockLocation: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };

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
  Button: ({ children, loading, type, className }: any) => (
    <button type={type} className={className} aria-busy={loading}>
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
  createNavigationContext: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .createNavigationContext(...args),
  navigateWithContext: (...args: any[]) =>
    jest.requireActual('utils/navigationState').navigateWithContext(...args),
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
  mockAssets = [
    {
      assetGuid: '123',
      chainId: 57,
      symbol: 'SPTONE',
      balance: '2.5',
      decimals: 2,
    },
    {
      assetGuid: '456',
      chainId: 57,
      symbol: 'SPTTWO',
      balance: '0.00000001',
      decimals: 8,
    },
    {
      assetGuid: '789',
      chainId: 1,
      symbol: 'FOREIGN',
      balance: '8',
      decimals: 2,
    },
  ];
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
  mockLocation = { pathname: '/send/sys', state: null };
  mockEmitter.mockImplementation(async (path: string[]) => {
    const method = path[path.length - 1];
    if (method === 'getRecommendedFee') return 0.00000001;
    if (method === 'refreshActiveAccountBalances') return undefined;
    if (method === 'getEstimateSysTransactionFee')
      return { psbt: 'synthetic-unsigned-psbt', fee: 0.00000001 };
    throw new Error('Unexpected method ' + method);
  });
});

const mount = async () => {
  const user = userEvent.setup();
  await act(async () => render(<SendSys />));
  return user;
};
const trigger = (symbol = 'SYS') =>
  screen.getByRole('button', { name: symbol, exact: true });
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const open = async (
  user: ReturnType<typeof userEvent.setup>,
  symbol = 'SYS'
) => {
  await user.click(trigger(symbol));
  return screen.getByRole('menu');
};
const optionButton = (name: string) => {
  const item = screen.getByRole('menuitem', { name, exact: true });
  return item.tagName === 'BUTTON' ? item : item.querySelector('button')!;
};
const selectPointer = async (
  user: ReturnType<typeof userEvent.setup>,
  symbol: string,
  current = 'SYS'
) => {
  await open(user, current);
  await user.click(optionButton(symbol + ' SPT'));
};
afterEach(() => {
  expect(
    mockNavigate.mock.calls.every(
      ([route, options]) => route === '/send/sys' && options?.replace === true
    )
  ).toBe(true);
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      ['getRecommendedFee', 'refreshActiveAccountBalances'].includes(
        path.at(-1)
      )
    )
  ).toBe(true);
});

it('registers one native button per current-chain asset and excludes other chains', async () => {
  const user = await mount();
  await open(user);
  const items = screen.getAllByRole('menuitem');
  expect(items).toHaveLength(3);
  for (const item of items) {
    expect(item.tagName).toBe('BUTTON');
    expect(item).toHaveAttribute('type', 'button');
  }
  expect(screen.queryByRole('menuitem', { name: /FOREIGN/ })).toBeNull();
});

it('retains pointer selection and exact SPT and native MAX', async () => {
  const user = await mount();
  await open(user);
  // The actual pointer action remains on the button even before wrapper repair.
  await user.click(optionButton('SPTONE SPT'));
  expect(trigger('SPTONE')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'MAX', exact: true }));
  expect(amount().value).toBe('2.5');
  await open(user, 'SPTONE');
  await user.click(optionButton('SYS send.native'));
  expect(trigger()).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'MAX', exact: true }));
  expect(amount().value).toBe('1.25');
});

it.each(['{Enter}', ' '])('selects a highlighted SPT using %s', async (key) => {
  const user = await mount();
  trigger().focus();
  await user.keyboard('{ArrowDown}');
  const menu = screen.getByRole('menu');
  await user.keyboard('{Home}{ArrowDown}');
  const active = document.getElementById(
    menu.getAttribute('aria-activedescendant')!
  );
  expect(active).toHaveTextContent('SPTONE');
  await user.keyboard(key);
  await waitFor(() => expect(trigger('SPTONE')).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'MAX', exact: true }));
  expect(amount().value).toBe('2.5');
});

it('moves once per asset with ArrowDown and ArrowUp before selecting the exact small balance', async () => {
  const user = await mount();
  const menu = await open(user);
  await user.keyboard('{Home}{ArrowDown}{ArrowDown}');
  const selected = () =>
    document.getElementById(menu.getAttribute('aria-activedescendant')!);
  expect(selected()).toHaveTextContent('SPTTWO');
  await user.keyboard('{ArrowUp}');
  expect(selected()).toHaveTextContent('SPTONE');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(trigger('SPTTWO')).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'MAX', exact: true }));
  expect(amount().value).toBe('0.00000001');
});

it('excludes the closed selector from accessibility and Tab order', async () => {
  const user = await mount();
  expect(screen.queryByRole('menu')).toBeNull();
  await open(user);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger()).toHaveFocus());
  expect(screen.queryByRole('menu')).toBeNull();
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'MAX', exact: true })
  ).toHaveFocus();
});

it('preserves the selected asset and typed amount when Escape dismisses another highlighted option', async () => {
  const user = await mount();
  await selectPointer(user, 'SPTONE');
  await user.type(amount(), '1.23');
  await open(user, 'SPTONE');
  await user.keyboard('{Home}{Escape}');
  await waitFor(() => expect(trigger('SPTONE')).toHaveFocus());
  expect(trigger('SPTONE')).toBeInTheDocument();
  expect(amount().value).toBe('1.23');
});
