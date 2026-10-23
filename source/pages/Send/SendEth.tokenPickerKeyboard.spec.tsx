/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// Use the package's real CJS color helpers so Jest can load the real registry
// SVG. No glyph, form, selection or layout result is replaced.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: jest.requireActual('components/Icon/Icon').ArrowDownSvg,
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

const PRECISE = '0x3333333333333333333333333333333333333333';
const SECOND = '0x4444444444444444444444444444444444444444';
const HIDDEN = '0x5555555555555555555555555555555555555555';
beforeEach(() => {
  mockAssets = [
    {
      id: 'precise',
      contractAddress: PRECISE,
      chainId: 1,
      tokenSymbol: 'PRECISE',
      tokenStandard: 'ERC-20',
      isNft: false,
      balance: 10,
      decimals: 18,
    },
    {
      id: 'second',
      contractAddress: SECOND,
      chainId: 1,
      tokenSymbol: 'SECOND',
      tokenStandard: 'ERC-20',
      isNft: false,
      balance: 10,
      decimals: 6,
    },
    {
      id: 'different-chain',
      contractAddress: HIDDEN,
      chainId: 137,
      tokenSymbol: 'HIDDEN',
      tokenStandard: 'ERC-20',
      isNft: false,
      balance: 10,
      decimals: 18,
    },
  ];
  mockEmitter.mockImplementation((path: string[], args: unknown[] = []) => {
    const method = path.at(-1);
    if (method === 'getERC20TokenInfo') {
      if (args[0] === PRECISE)
        return Promise.resolve({ balance: '999999999999999999', decimals: 18 });
      if (args[0] === SECOND)
        return Promise.resolve({ balance: '1234567', decimals: 6 });
      throw new Error('Unexpected token lookup');
    }
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return Promise.resolve({
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
      });
    if (method === 'refreshActiveAccountBalances')
      return Promise.resolve(undefined);
    throw new Error(
      'Unexpected or forbidden controller call: ' + path.join('.')
    );
  });
});
afterEach(() => {
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getERC20TokenInfo',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'refreshActiveAccountBalances',
      ].includes(path.at(-1))
    )
  ).toBe(true);
  expect(
    mockEmitter.mock.calls.some(
      ([path, args]) =>
        path.at(-1) === 'getERC20TokenInfo' && args[0] === HIDDEN
    )
  ).toBe(false);
});
const mount = async () => {
  const user = userEvent.setup();
  await act(async () => render(<SendEth />));
  return user;
};
// Escape restores focus through Headless UI's two-frame lifecycle. Deliver its
// real callbacks deterministically instead of depending on JSDOM's frame clock.
const completeMenuFrames = async (interaction: () => Promise<void>) => {
  const callbacks = new Map<number, FrameRequestCallback>();
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  let id = 0;
  const request = jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      callbacks.set(--id, callback);
      return id;
    });
  const cancel = jest
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((handle) => {
      if (!callbacks.delete(handle)) nativeCancel(handle);
    });
  try {
    await interaction();
    for (let frame = 0; frame < 2; frame += 1) {
      const current = [...callbacks.values()];
      callbacks.clear();
      await act(async () => {
        current.forEach((callback) => callback(performance.now()));
      });
    }
    expect(callbacks.size).toBe(0);
  } finally {
    cancel.mockRestore();
    request.mockRestore();
  }
};
const open = async (
  user: ReturnType<typeof userEvent.setup>,
  label = 'ETH'
) => {
  await user.click(screen.getByRole('button', { name: label }));
  return screen.getByRole('menu');
};
const selectWithPointer = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  current = 'ETH'
) => {
  await open(user, current);
  // Find the actual actionable element rather than accepting a wrapper as the
  // pointer control; separate tests assert each asset has exactly one item.
  const item = screen
    .getAllByRole('menuitem', { name: new RegExp(label + '.*ERC-20') })
    .find((node) => node.tagName === 'BUTTON')!;
  await user.click(item);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  );
};
const expectCollapsedLayout = (symbol: string) => {
  const button = screen.getByRole('button', { name: symbol });
  expect(button).toHaveAccessibleName(symbol);
  expect(button).toHaveClass('w-[100px]', 'gap-2', 'px-3');
  expect(button.querySelector('p')).toHaveClass(
    'min-w-0',
    'flex-1',
    'truncate'
  );
  expect(button.querySelector('p')).toHaveTextContent(symbol);
  const arrow = button.querySelector('svg');
  expect(arrow).toHaveAttribute('viewBox', '0 0 24 25');
  expect(arrow).toHaveAttribute('width', '24');
  expect(arrow).toHaveAttribute('height', '25');
  expect(arrow).toHaveClass('shrink-0');
};

it.each(['DUP', 'ABCDEFGH1', 'VERYLONGTOKEN123456789'])(
  'reserves the actual collapsed icon while preserving full ERC20 name and selection for %s',
  async (symbol) => {
    mockAssets[0].tokenSymbol = symbol;
    const user = await mount();
    expectCollapsedLayout('ETH');
    await open(user);
    await user.click(screen.getAllByRole('menuitem')[1]);
    await waitFor(() => expectCollapsedLayout(symbol));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'send.max' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: 'send.max' }));
    expect(
      (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
    ).toBe('0.999999999999999999');
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getERC20TokenInfo'],
      [PRECISE, mockState.vault.accounts.HDAccount[0].address]
    );
  }
);

it('exposes one actionable item per current-chain asset and filters other chains', async () => {
  const user = await mount();
  await open(user);
  expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  for (const label of ['PRECISE', 'SECOND']) {
    const items = screen.getAllByRole('menuitem', {
      name: new RegExp(label + '.*ERC-20'),
    });
    expect(items).toHaveLength(1);
    expect(items[0].tagName).toBe('BUTTON');
  }
  expect(screen.queryByRole('menuitem', { name: /HIDDEN/ })).toBeNull();
});
it('retains pointer selection and does not select another asset on Escape', async () => {
  const user = await mount();
  await selectWithPointer(user, 'PRECISE');
  await open(user, 'PRECISE');
  await completeMenuFrames(() =>
    user.keyboard('{Home}{ArrowDown}{ArrowDown}{Escape}')
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'PRECISE' })).toHaveFocus()
  );
  expect(screen.getByRole('button', { name: 'PRECISE' })).toBeInTheDocument();
});
it.each(['{Enter}', ' '])(
  'selects the first visible token with Home, ArrowDown and %s',
  async (key) => {
    const user = await mount();
    const menu = await open(user);
    await user.keyboard('{Home}{ArrowDown}');
    const selected = document.getElementById(
      menu.getAttribute('aria-activedescendant')!
    );
    expect(selected?.tagName).toBe('BUTTON');
    expect(selected).toHaveTextContent('PRECISE');
    await user.keyboard(key);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'PRECISE' })
      ).toBeInTheDocument()
    );
  }
);
it('removes the closed selector from accessibility and skips it while tabbing to MAX', async () => {
  const user = await mount();
  expect(screen.queryByRole('menu')).toBeNull();
  await open(user);
  await completeMenuFrames(() => user.keyboard('{Escape}'));
  const trigger = screen.getByRole('button', { name: 'ETH' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('menu')).toBeNull();
  await user.tab();
  expect(screen.getByRole('button', { name: 'send.max' })).toHaveFocus();
});
it('preserves native MAX and exact verified ERC20 MAX across asset selection', async () => {
  const user = await mount();
  const amount = () =>
    screen.getByPlaceholderText('send.amount') as HTMLInputElement;
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('10');
  await selectWithPointer(user, 'PRECISE');
  await waitFor(
    () =>
      expect(screen.getByRole('button', { name: 'send.max' })).toBeEnabled(),
    { timeout: 2500 }
  );
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('0.999999999999999999');
  await selectWithPointer(user, 'SECOND', 'PRECISE');
  await waitFor(
    () =>
      expect(screen.getByRole('button', { name: 'send.max' })).toBeEnabled(),
    { timeout: 2500 }
  );
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('1.234567');
});
