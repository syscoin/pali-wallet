/** @jest-environment jsdom */
import { Menu } from '@headlessui/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import RenderAccountsListByBitcoinBased from './RenderAccountsListByBitcoinBased';

const mockAlert = { error: jest.fn(), info: jest.fn() };
type MockAccount = {
  address: string;
  id: number;
  isImported?: boolean;
  label: string;
  slip44: number;
  smartAccount?: { chainId: number };
};
const createMockAccounts = (): Record<string, Record<number, MockAccount>> => ({
  HDAccount: {
    0: { id: 0, label: 'Alpha', address: 'tsys1qalpha', slip44: 1 },
    1: { id: 1, label: 'Beta', address: 'tsys1qbeta', slip44: 1 },
  },
});
const mockState = {
  vaultGlobal: { isSwitchingAccount: false },
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: { kind: 'syscoin', chainId: 5700, slip44: 1 },
    accounts: createMockAccounts(),
  },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (
        key !== 'receive.smartAccount' &&
        key !== 'smartAccountHub.badge' &&
        key !== 'components.imported'
      )
        return key;
      return key
        .split('.')
        .reduce(
          (value: any, part: string) => value[part],
          jest.requireActual('../../assets/locales/en.json')
        );
    },
  }),
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
jest.mock('components/index', () => ({
  Icon: ({
    name,
    className,
    wrapperClassname,
  }: {
    className?: string;
    name: string;
    wrapperClassname?: string;
  }) => (
    <div className={wrapperClassname}>
      <svg
        aria-hidden="true"
        className={className}
        data-testid={`icon-${name}`}
      />
    </div>
  ),
}));
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
  mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
  mockState.vault.activeNetwork = { kind: 'syscoin', chainId: 5700, slip44: 1 };
  mockState.vault.accounts = createMockAccounts();
});

it('keeps compact 38px account rows with an independent 44px-wide copy target', async () => {
  await openAccounts();

  for (const [label, address] of [
    ['Alpha', 'tsys1qalpha'],
    ['Beta', 'tsys1qbeta'],
  ]) {
    const account = screen.getByRole('menuitem', {
      name: `${label} (${address})`,
    });
    const copy = screen.getByRole('menuitem', {
      name: `buttons.copy: ${label} (${address})`,
    });
    const row = account.closest('li');

    expect(row).not.toBeNull();
    // Vertical row padding would add height outside the compact 38px controls.
    expect(row?.className.split(/\s+/)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(?:p|py|pt|pb)-/)])
    );
    expect(account.classList.contains('min-h-[38px]')).toBe(true);
    expect(copy.classList.contains('min-h-[38px]')).toBe(true);
    expect(copy.classList.contains('min-w-[44px]')).toBe(true);
  }
});

it('centers badge text and the active check inside explicit local boxes', async () => {
  await openAccounts();

  for (const [label, address] of [
    ['Alpha', 'tsys1qalpha'],
    ['Beta', 'tsys1qbeta'],
  ]) {
    const account = screen.getByRole('menuitem', {
      name: `${label} (${address})`,
    });
    const badgeLabel = within(account).getByText('Pali');
    const badge = badgeLabel.parentElement;

    expect(badgeLabel.classList.contains('leading-none')).toBe(true);
    expect(Array.from(badge?.classList || [])).toEqual(
      expect.arrayContaining([
        'inline-flex',
        'h-[20px]',
        'items-center',
        'leading-none',
      ])
    );
  }

  const activeAccount = screen.getByRole('menuitem', {
    name: 'Alpha (tsys1qalpha)',
  });
  const check = within(activeAccount).getByTestId('icon-check');
  const checkBox = check.parentElement;
  expect(Array.from(checkBox?.classList || [])).toEqual(
    expect.arrayContaining([
      'flex',
      'h-[12px]',
      'w-[12px]',
      'items-center',
      'justify-center',
      'leading-none',
    ])
  );
  expect(Array.from(check.classList)).toEqual(
    expect.arrayContaining(['block', 'h-[12px]', 'w-[12px]'])
  );
});

it('compacts the Smart badge without shrinking text or losing its full accessible type', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  mockState.vault.activeAccount = { id: 0, type: 'SmartAccount' };
  mockState.vault.activeNetwork = { kind: 'ethereum', chainId: 1, slip44: 60 };
  mockState.vault.accounts = {
    SmartAccount: {
      0: {
        id: 0,
        label: 'My longer smart account name',
        address,
        slip44: 60,
        smartAccount: { chainId: 1 },
      },
    },
  };
  await openAccounts();

  const account = screen.getByRole('menuitem', {
    name: `My longer smart account name (${address}), Smart Account`,
  });
  expect(account.getAttribute('aria-label')).toContain(address);
  const badge = within(account).getByTitle('Smart Account');
  expect(
    within(badge).getByText('Smart').classList.contains('leading-none')
  ).toBe(true);
  expect(within(account).queryByText('Smart Account')).toBeNull();
  expect(Array.from(badge.classList)).toEqual(
    expect.arrayContaining([
      'inline-flex',
      'h-[20px]',
      'items-center',
      'px-1',
      'text-xs',
      'leading-none',
      'bg-purple-500',
    ])
  );
  expect(badge.classList.contains('px-2')).toBe(false);

  const check = within(badge).getByTestId('icon-check');
  expect(Array.from(check.parentElement?.classList || [])).toEqual(
    expect.arrayContaining([
      'flex',
      'h-[12px]',
      'w-[12px]',
      'items-center',
      'justify-center',
      'leading-none',
    ])
  );
  expect(Array.from(check.classList)).toEqual(
    expect.arrayContaining(['block', 'h-[12px]', 'w-[12px]'])
  );
  const copy = screen.getByRole('menuitem', {
    name: `buttons.copy: My longer smart account name (${address})`,
  });
  expect(account.classList.contains('min-h-[38px]')).toBe(true);
  expect(copy.classList.contains('min-h-[38px]')).toBe(true);
  expect(copy.classList.contains('min-w-[44px]')).toBe(true);
});

it.each([
  ['HDAccount', 'Pali'],
  ['Trezor', 'Trezor'],
  ['Ledger', 'Ledger'],
  ['Imported', 'Imported'],
])('preserves the %s badge label and size', async (type, label) => {
  mockState.vault.activeAccount = { id: 0, type };
  mockState.vault.accounts = {
    [type]: {
      0: {
        id: 0,
        label: 'Unchanged account',
        address: 'tsys1qunchanged',
        slip44: 1,
        isImported: type === 'Imported',
      },
    },
  };
  await openAccounts();

  const account = screen.getByRole('menuitem', {
    name: 'Unchanged account (tsys1qunchanged)',
  });
  const badge = within(account).getByText(label).parentElement;
  expect(Array.from(badge?.classList || [])).toEqual(
    expect.arrayContaining(['h-[20px]', 'px-2', 'text-xs', 'items-center'])
  );
  expect(badge?.classList.contains('px-1')).toBe(false);
});

it('keeps reopened account controls disabled during a background switch', async () => {
  mockState.vaultGlobal.isSwitchingAccount = true;
  const { setActiveAccount } = await openAccounts();
  const account = screen.getByRole('menuitem', { name: 'Beta (tsys1qbeta)' });
  expect((account as HTMLButtonElement).disabled).toBe(true);
  account.click();
  expect(setActiveAccount).not.toHaveBeenCalled();
});

it('registers each account and copy action as independent keyboard menu items', async () => {
  const { user, setActiveAccount } = await openAccounts();
  expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  const beta = screen.getByRole('menuitem', { name: 'Beta (tsys1qbeta)' });
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
      screen.getByRole('menuitem', { name: 'buttons.copy: Beta (tsys1qbeta)' })
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
  const alpha = screen.getByRole('menuitem', { name: 'Alpha (tsys1qalpha)' });
  const beta = screen.getByRole('menuitem', { name: 'Beta (tsys1qbeta)' });
  await act(async () => {
    alpha.click();
    beta.click();
  });
  expect(setActiveAccount).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await user.keyboard('{Escape}');
});
