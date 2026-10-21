/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { AccountHeader } from 'components/Header/AccountHeader';

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
    alert: { info: jest.fn(), error: jest.fn() },
    navigate: mockNavigate,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/index', () => ({
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  // Decorative glyphs are inert; the real controls, tooltip, identicon and
  // AccountHeader handler determine native focus and activation behavior.
  Icon: () => <svg aria-hidden="true" />,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
  ConfirmationModal: () => null,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      account: {
        id: 0,
        label: 'Synthetic account',
        address: '0x1111111111111111111111111111111111111111',
        xpub: 'public-synthetic-xpub',
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        chainId: 1,
        kind: 'ethereum',
        currency: 'eth',
        slip44: 60,
        url: 'https://rpc.synthetic.invalid',
        explorer: 'https://explorer.synthetic.invalid',
      },
      isBitcoinBased: false,
    },
    vaultGlobal: { networkStatus: 'connected', isSwitchingAccount: false },
  };
});

afterEach(() => {
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockCopy).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

const mount = (utxo: boolean) => {
  if (utxo) {
    mockState.vault.isBitcoinBased = true;
    mockState.vault.activeNetwork.kind = 'syscoin';
    mockState.vault.activeNetwork.chainId = 5700;
    mockState.vault.activeNetwork.slip44 = 1;
    mockState.vault.account.address = 'tsys1qsynthetic';
  }
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  const user = userEvent.setup();
  render(
    <>
      <AccountHeader />
      <button type="button">After header</button>
    </>
  );
  return { open, user };
};

const expectExplorerOpened = (open: jest.SpyInstance, utxo: boolean) => {
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(
    utxo
      ? 'https://explorer.synthetic.invalid/xpub/public-synthetic-xpub'
      : 'https://explorer.synthetic.invalid/address/0x1111111111111111111111111111111111111111',
    '_blank'
  );
};

describe.each([false, true])('explorer action (UTXO=%s)', (utxo) => {
  it('opens the exact chain-family explorer URL from the visible pointer target', async () => {
    const { open, user } = mount(utxo);
    const explorer = screen.getByRole('button', {
      name: 'home.viewAccountOnExplorer',
    });
    expect(explorer.classList.contains('add-identicon')).toBe(true);
    await user.click(explorer);
    expectExplorerOpened(open, utxo);
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the same URL once after native Tab and %s', async (_name, key) => {
    const { open, user } = mount(utxo);
    const explorer = screen.getByRole('button', {
      name: 'home.viewAccountOnExplorer',
    });
    expect(explorer).toHaveAttribute('type', 'button');
    expect(explorer.classList.contains('focus-visible:ring-2')).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(explorer);
    await user.keyboard(key);
    expectExplorerOpened(open, utxo);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'buttons.edit' })
    );
  });
});
