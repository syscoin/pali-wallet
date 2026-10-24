/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { AccountHeader } from 'components/Header/AccountHeader';

// This is an explicitly synthetic render-state boundary, not a hardware import
// or device-verification test. Only public metadata is supplied. The real
// AccountHeader, Tooltip, dialog and native buttons determine focus/activation.
let mockState: any;
const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockNavigate = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '', key: 'home' }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.vault.account,
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy, () => true],
    alert: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
    navigate: mockNavigate,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/index', () => ({
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
  Icon: () => <svg aria-hidden="true" />,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
}));
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ADDRESS = 'tsys1q6rz28mcfaxtmd6v789l9rrlrusdprr9p4ugvp5';
const XPUB =
  'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const MODE = process.env.PALI_HARDWARE_ENTRY_MODE || 'after';
const originalObserver = globalThis.ResizeObserver;
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
  globalThis.ResizeObserver = originalObserver;
});
beforeEach(() => {
  jest.clearAllMocks();
  expect(['before', 'after']).toContain(MODE);
  if (process.env.CI) expect(MODE).toBe('after');
  window.history.replaceState(null, '', '#/home');
  mockState = {
    vault: {
      account: {
        id: 7,
        label: 'Synthetic hardware metadata',
        address: ADDRESS,
        xpub: XPUB,
        xprv: '',
        balances: { ethereum: 0, syscoin: 0 },
        isImported: false,
        isLedgerWallet: true,
        isTrezorWallet: false,
        slip44: 1,
      },
      activeAccount: { id: 7, type: 'Ledger' },
      activeNetwork: {
        chainId: 5700,
        kind: 'syscoin',
        currency: 'tsys',
        slip44: 1,
        url: 'https://fixture.invalid',
        explorer: 'https://fixture.invalid',
      },
      isBitcoinBased: true,
    },
    vaultGlobal: { networkStatus: 'connected', isSwitchingAccount: false },
  };
});
afterEach(() => {
  cleanup();
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

const tabThroughHeader = async (
  user: ReturnType<typeof userEvent.setup>,
  target: Element
) => {
  const visited: string[] = [];
  let reached = false;
  for (let step = 0; step < 10; step++) {
    await user.tab();
    reached ||= document.activeElement === target;
    visited.push(document.activeElement?.tagName || '');
    if (
      document.activeElement ===
      screen.getByRole('button', { name: 'After header' })
    )
      break;
  }
  return { reached, visited };
};

it.each(['Ledger', 'Trezor'])(
  '%s UTXO metadata exposes keyboard entry into confirmation without contacting a device',
  async (kind) => {
    mockState.vault.activeAccount.type = kind;
    mockState.vault.account.isLedgerWallet = kind === 'Ledger';
    mockState.vault.account.isTrezorWallet = kind === 'Trezor';
    const originalState = JSON.stringify(mockState);
    const user = userEvent.setup();
    render(
      <>
        <AccountHeader />
        <button type="button">After header</button>
      </>
    );
    const address = screen.getByText(ADDRESS, { exact: true });
    const traversal = await tabThroughHeader(user, address);
    expect(traversal.reached).toBe(MODE === 'after');
    if (MODE === 'before') {
      expect(address.tagName).toBe('P');
      expect(address).not.toHaveAttribute('tabindex');
      expect(address).not.toHaveAttribute('role');
      // Healthy pointer control: the existing UI can open this same dialog.
      await user.click(address);
    } else {
      expect(address.tagName).toBe('BUTTON');
      expect(address).toHaveAttribute('type', 'button');
      expect(address).toHaveAccessibleName('home.clickToVerify');
      // Start from a real native Tab sequence; never call element.focus().
      for (
        let step = 0;
        step < 10 && document.activeElement !== address;
        step++
      )
        await user.tab();
      expect(address).toHaveFocus();
      await user.keyboard('{Enter}');
    }
    const dialog = await screen.findByRole('dialog', {
      name: 'home.verifySysAddress',
    });
    expect(
      within(dialog).getByRole('button', { name: 'buttons.verify' })
    ).toBeEnabled();
    expect(mockEmitter).not.toHaveBeenCalled();
    // Cancel only; the device Verify action is intentionally never exercised.
    await user.click(
      within(dialog).getByRole('button', { name: 'buttons.cancel' })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    if (MODE === 'after') await waitFor(() => expect(address).toHaveFocus());
    expect(JSON.stringify(mockState)).toBe(originalState);
    expect(mockCopy).not.toHaveBeenCalled();
  }
);

it.each(['HDAccount', 'LedgerEVM'])(
  '%s keeps a static address and the existing keyboard Copy control',
  async (kind) => {
    mockState.vault.activeAccount.type = kind === 'HDAccount' ? kind : 'Ledger';
    mockState.vault.account.isLedgerWallet = kind === 'LedgerEVM';
    if (kind === 'LedgerEVM') {
      mockState.vault.isBitcoinBased = false;
      mockState.vault.account.address = EVM_ADDRESS;
      Object.assign(mockState.vault.activeNetwork, {
        kind: 'ethereum',
        chainId: 5700,
        currency: 'tsys',
        slip44: 60,
      });
    }
    const user = userEvent.setup();
    render(
      <>
        <AccountHeader />
        <button type="button">After header</button>
      </>
    );
    const address = screen.getByText(mockState.vault.account.address, {
      exact: true,
    });
    expect((await tabThroughHeader(user, address)).reached).toBe(false);
    await user.click(address);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const copy = screen.getByRole('button', { name: 'buttons.copy' });
    for (let step = 0; step < 10 && document.activeElement !== copy; step++)
      await user.tab();
    expect(copy).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mockCopy).toHaveBeenCalledWith(mockState.vault.account.address);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);
