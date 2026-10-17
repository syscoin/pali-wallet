/** @jest-environment jsdom */
import { Menu } from '@headlessui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import RenderAccountsListByBitcoinBased from './RenderAccountsListByBitcoinBased';

const mockAlert = { error: jest.fn(), info: jest.fn() };
const mockState = {
  vaultGlobal: { isSwitchingAccount: false },
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: { kind: 'syscoin', chainId: 5700, slip44: 1 },
    accounts: {
      HDAccount: {
        0: { id: 0, label: 'Alpha', address: 'tsys1qalpha', slip44: 1 },
        1: { id: 1, label: 'Beta', address: 'tsys1qbeta', slip44: 1 },
      },
    },
  },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault', () => ({
  selectActiveAccountRef: (state: any) => state.vault.activeAccount,
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('components/Icon/Icon', () => ({
  RiUserReceivedLine: () => null,
  PaliWhiteSmallIconSvg: () => null,
  LoadingSvg: () => null,
  LockIconSvg: () => null,
}));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const openAccounts = async (
  setActiveAccount = jest.fn().mockResolvedValue(undefined)
) => {
  const user = userEvent.setup();
  const view = render(
    <Menu>
      <Menu.Button>Accounts</Menu.Button>
      <Menu.Items>
        <RenderAccountsListByBitcoinBased setActiveAccount={setActiveAccount} />
      </Menu.Items>
    </Menu>
  );
  await user.click(screen.getByRole('button', { name: 'Accounts' }));
  await screen.findByRole('menu');
  return { ...view, user, setActiveAccount };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockState.vaultGlobal.isSwitchingAccount = false;
});

it('keeps reopened account controls disabled during a background switch', async () => {
  mockState.vaultGlobal.isSwitchingAccount = true;
  const { setActiveAccount } = await openAccounts();
  const account = screen.getByRole('menuitem', { name: /Beta.*tsys1qbeta/ });
  expect((account as HTMLButtonElement).disabled).toBe(true);
  account.click();
  expect(setActiveAccount).not.toHaveBeenCalled();
});

it('registers each account and copy action as independent keyboard menu items', async () => {
  const { user, setActiveAccount } = await openAccounts();
  expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  const beta = screen.getByRole('menuitem', { name: /Beta.*tsys1qbeta/ });
  expect(beta.closest('li')?.id).toBe('account-HDAccount-1');
  await user.keyboard('Beta');
  await waitFor(() =>
    expect(screen.getByRole('menu').getAttribute('aria-activedescendant')).toBe(
      beta.id
    )
  );
  await user.keyboard('{Enter}');
  expect(setActiveAccount).toHaveBeenCalledTimes(1);
  expect(setActiveAccount).toHaveBeenCalledWith(1, 'HDAccount');
});

it('keeps copy separate from selection and reports clipboard rejection', async () => {
  const { user, setActiveAccount } = await openAccounts();
  const copy = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new Error('denied'));
  try {
    await user.click(
      screen.getByRole('menuitem', { name: 'buttons.copy: Beta' })
    );
    await waitFor(() =>
      expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed')
    );
    expect(copy).toHaveBeenCalledWith('tsys1qbeta');
    expect(setActiveAccount).not.toHaveBeenCalled();
    expect(mockAlert.info).not.toHaveBeenCalled();
  } finally {
    copy.mockRestore();
  }
});

it('announces a keyboard copy even when normal menu dismissal unmounts its row', async () => {
  const { user, setActiveAccount } = await openAccounts();
  const copy = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    await user.keyboard('{Home}{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(mockAlert.info).toHaveBeenCalledWith('home.addressCopied')
    );
    expect(copy).toHaveBeenCalledWith('tsys1qalpha');
    expect(setActiveAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  } finally {
    copy.mockRestore();
  }
});

it('coalesces repeated selection while its first account switch is pending', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const setActiveAccount = jest.fn().mockReturnValue(pending);
  const { user } = await openAccounts(setActiveAccount);
  const alpha = screen.getByRole('menuitem', { name: /Alpha.*tsys1qalpha/ });
  const beta = screen.getByRole('menuitem', { name: /Beta.*tsys1qbeta/ });
  await act(async () => {
    alpha.click();
    beta.click();
  });
  expect(setActiveAccount).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await user.keyboard('{Escape}');
});
