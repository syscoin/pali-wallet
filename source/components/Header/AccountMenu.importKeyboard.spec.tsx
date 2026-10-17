/** @jest-environment jsdom */
import { Menu } from '@headlessui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import AccountMenu from './AccountMenu';

const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockControllerEmitter = jest.fn();
const mockReturnContext = {
  returnRoute: '/home',
  state: { tab: 'assets' },
};
const mockCreateBrowsingNavigationContext = jest.fn<
  typeof mockReturnContext,
  [unknown]
>(() => mockReturnContext);
// React Router's public future-flag names are intentionally snake case.
const routerFutureFlags = {
  // eslint-disable-next-line camelcase
  v7_startTransition: true,
  // eslint-disable-next-line camelcase
  v7_relativeSplatPath: true,
};

jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockControllerEmitter,
    handleWalletLockedError: jest.fn(),
  }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vault: { activeAccount: { id: 0, type: 'HDAccount' } } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'accountMenu.createNewAccount': 'Create new account',
        'accountMenu.manageAccounts': 'Manage accounts',
        'accountMenu.yourKeys': 'Your keys',
        'accountMenu.connectTrezor': 'Connect hardware wallet',
        'accountMenu.importAccount': 'Import account',
      }[key] || key),
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  AddUserSvg: () => null,
  ManageUserSvg: () => null,
  KeySvg: () => null,
  HardWalletIconSvg: () => null,
  UserImportedIconSvg: () => null,
}));
jest.mock('./RenderAccountsListByBitcoinBased', () => () => null);
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: (location: any) =>
    mockCreateBrowsingNavigationContext(location),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
}));

const openAccountMenu = async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/home']} future={routerFutureFlags}>
      <Menu>
        <Menu.Button>Accounts</Menu.Button>
        <Menu.Items>
          <AccountMenu />
        </Menu.Items>
      </Menu>
    </MemoryRouter>
  );
  await user.click(screen.getByRole('button', { name: 'Accounts' }));
  const menu = await screen.findByRole('menu');
  const importAccount = screen.getByRole('menuitem', {
    name: 'Import account',
  });
  return { user, menu, importAccount };
};

const expectImportNavigation = () => {
  expect(mockCreateBrowsingNavigationContext).toHaveBeenCalledTimes(1);
  expect(mockCreateBrowsingNavigationContext).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: '/home' })
  );
  expect(mockNavigateWithContext).toHaveBeenCalledTimes(1);
  expect(mockNavigateWithContext).toHaveBeenCalledWith(
    mockNavigate,
    '/settings/account/import',
    { fromMenu: true },
    mockReturnContext
  );
  expect(mockControllerEmitter).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('opens Import account from its visible pointer target with browsing context', async () => {
  const { user } = await openAccountMenu();
  await user.click(screen.getByText('Import account'));
  expectImportNavigation();
});

it('opens Import account once after End and Enter', async () => {
  const { user, menu, importAccount } = await openAccountMenu();
  await user.keyboard('{End}');
  await waitFor(() =>
    expect(menu.getAttribute('aria-activedescendant')).toBe(importAccount.id)
  );
  await user.keyboard('{Enter}');
  expectImportNavigation();
  expect(screen.queryByRole('menu')).toBeNull();
});

it('opens Import account once after End and Space', async () => {
  const { user, menu, importAccount } = await openAccountMenu();
  await user.keyboard('{End}');
  await waitFor(() =>
    expect(menu.getAttribute('aria-activedescendant')).toBe(importAccount.id)
  );
  await user.keyboard(' ');
  expectImportNavigation();
  expect(screen.queryByRole('menu')).toBeNull();
});
