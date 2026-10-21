/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { Home } from './Home';

let mockState: any;
const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      const message = key
        .split('.')
        .reduce((part: any, name) => part?.[name], messages);
      return typeof message === 'string'
        ? message.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))
        : key;
    },
  }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/index', () => ({
  usePrice: () => ({ getFiatAmount: () => '$0.00' }),
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, isUnlocked: true }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.account,
  selectActiveAccountRef: (state: any) => state.accountRef,
}));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ArrowDownLoadSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/ChainIcon', () => ({
  ChainIcon: () => <span aria-hidden="true" />,
}));
// Retain the actual Home branch, both faucet components, native Button,
// DialogPrimitive and Headless UI. Only unrelated panels/artwork are omitted.
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  FaucetAccessModal: jest.requireActual('components/Modal/FaucetAccessModal')
    .FaucetAccessModal,
  FaucetFirstAccessModal: jest.requireActual(
    'components/Modal/FaucetFirstAccessModal'
  ).FaucetFirstAccessModal,
}));
jest.mock(
  'components/Loader/SkeletonLoader',
  () =>
    function SkeletonLoaderMock() {
      return <span />;
    }
);
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/Modal/WalletProviderDafault', () => ({
  WalletProviderDefaultModal: () => null,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ConnectHardwareWallet: () => null,
}));
jest.mock('./TxsPanel', () => ({ TxsPanel: () => null }));
jest.mock('utils/index', () => ({
  formatMillionNumber: String,
  formatFullPrecisionBalance: String,
  ONE_MILLION: 1000000,
}));

const originalResizeObserver = globalThis.ResizeObserver;
const bannerText = 'Grab $TSYS on our faucet';
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});
beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem('hardwareWalletModalDismissed', 'true');
  window.localStorage.setItem('congratsModalDismissed', 'true');
  mockState = {
    account: {
      address: '0x1111111111111111111111111111111111111111',
      balances: { ethereum: '0' },
    },
    accountRef: { type: 'HDAccount', id: 0 },
    price: { fiat: { asset: 'usd' } },
    vault: {
      activeNetwork: {
        chainId: 57000,
        kind: 'ethereum',
        url: 'https://synthetic.invalid',
        currency: 'TSYS',
      },
      isBitcoinBased: false,
      shouldShowFaucetModal: { 57000: false },
    },
    vaultGlobal: {},
  };
  mockEmitter.mockResolvedValue(undefined);
});

it.each(['Enter', 'click'])(
  'healthy first-access dialog navigates through native %s',
  async (activation) => {
    mockState.vault.shouldShowFaucetModal[57000] = true;
    render(<Home />);
    const user = userEvent.setup();
    const dialog = screen.getByRole('dialog');
    const action = within(dialog).getByRole('button', { name: 'Go to Faucet' });
    if (activation === 'click') await user.click(action);
    else {
      for (let i = 0; i < 4 && document.activeElement !== action; i++)
        await user.tab();
      expect(action).toHaveFocus();
      await user.keyboard('{Enter}');
    }
    expect(mockNavigate).toHaveBeenCalledWith('/faucet');
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setFaucetModalState'],
      [{ chainId: 57000, isOpen: false }]
    );
  }
);

it('healthy first-access Escape leads to the real eligible Home banner', async () => {
  mockState.vault.shouldShowFaucetModal[57000] = true;
  const view = render(<Home />);
  const user = userEvent.setup();
  await user.keyboard('{Escape}');
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setFaucetModalState'],
    [{ chainId: 57000, isOpen: false }]
  );
  // Match the real Redux reducer's replacement of the modal-state object.
  mockState.vault.shouldShowFaucetModal = { 57000: false };
  view.rerender(<Home />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText(bannerText)).toBeVisible();
});

it('healthy eligible Home banner navigates by pointer', async () => {
  render(<Home />);
  const label = screen.getByText(bannerText);
  const banner = screen.getByRole('button', { name: bannerText });
  expect(label.tagName).toBe('SPAN');
  expect(label).toHaveClass('text-sm', 'text-white', 'font-medium');
  expect(label.parentElement?.tagName).toBe('SPAN');
  expect(label.parentElement).toHaveClass(
    'flex',
    'items-center',
    'justify-center',
    'gap-3',
    'w-full'
  );
  expect(banner.querySelector('div, p')).toBeNull();
  expect(banner).toHaveClass('shadow-md', 'hover:shadow-lg');
  expect(banner.className).not.toContain('shadow-[');
  await userEvent.click(label);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('/faucet');
});

it.each(['Enter', 'Space'])(
  'eligible Home banner remains reachable and operable with Tab then %s',
  async (activation) => {
    render(<Home />);
    const user = userEvent.setup();
    const banner = screen
      .getByText(bannerText)
      .closest('[class*="cursor-pointer"]')!;
    for (let i = 0; i < 5 && document.activeElement !== banner; i++) {
      await user.tab();
    }
    expect(banner).toHaveFocus();
    expect(banner).toBe(screen.getByRole('button', { name: bannerText }));
    expect(banner).toHaveAttribute('type', 'button');
    expect(banner).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-white'
    );
    await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ');
    expect(mockNavigate).toHaveBeenCalledWith('/faucet');
  }
);

it.each(['funded', 'utxo', 'switching'])(
  'does not render faucet entry for an ineligible %s Home state',
  (variant) => {
    if (variant === 'funded') mockState.account.balances.ethereum = '1';
    if (variant === 'utxo') mockState.vault.isBitcoinBased = true;
    if (variant === 'switching')
      mockState.vaultGlobal.isSwitchingAccount = true;
    render(<Home />);
    expect(screen.queryByText(bannerText)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  }
);
