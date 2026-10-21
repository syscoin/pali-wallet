/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { GeneralMenu } from './GeneralMenu';

const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn() };
const mockAccounts = {
  HDAccount: {
    0: { id: 0, label: 'Alpha', address: 'tsys1qalpha', slip44: 1 },
    1: { id: 1, label: 'Beta', address: 'tsys1qbeta', slip44: 1 },
  },
};
const mockState = {
  vault: {
    accounts: mockAccounts,
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: {
      kind: 'syscoin',
      chainId: 5700,
      slip44: 1,
      url: 'https://rpc.test',
    },
  },
  vaultGlobal: {
    advancedSettings: { refresh: false },
    isSwitchingAccount: false,
  },
  dapp: { dapps: {} },
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
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('antd', () => ({ Badge: () => null }));
jest.mock('components/index', () => ({
  Icon: () => <svg aria-hidden="true" />,
  Tooltip: ({ children }: any) => children,
  AccountMenu: () => {
    const Component = jest.requireActual('../AccountMenu').AccountMenu;
    return <Component />;
  },
}));
jest.mock('components/Icon/Icon', () => ({
  KeySvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  TrashIconSvg: () => null,
  LanguageIconSvg: () => null,
  DollarSignIconSvg: () => null,
  HelpIconSvg: () => null,
  LockIconSvg: () => null,
  AddUserSvg: () => null,
  ManageUserSvg: () => null,
  HardWalletIconSvg: () => null,
  UserImportedIconSvg: () => null,
  RiUserReceivedLine: () => null,
  LoadingSvg: () => null,
}));

const originalChrome = global.chrome;
beforeEach(() => {
  jest.clearAllMocks();
  mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
  mockEmitter.mockImplementation(async (path, args) => {
    expect(path).toEqual(['wallet', 'setAccount']);
    mockState.vault.activeAccount = { id: args[0], type: args[1] };
  });
  global.chrome = {
    ...originalChrome,
    tabs: { query: jest.fn().mockResolvedValue([]) },
  } as unknown as typeof chrome;
});
afterEach(() => {
  global.chrome = originalChrome;
});

const open = async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/home']}>
      <GeneralMenu />
      <button>After header</button>
    </MemoryRouter>
  );
  const trigger = screen.getByRole('button', {
    name: 'generalMenu.generalOptions',
  });
  await user.click(trigger);
  return { user, trigger };
};
const expectActive = async (name: RegExp) => {
  const item = screen.getByRole('menuitem', { name });
  await waitFor(() =>
    expect(screen.getByRole('menu').getAttribute('aria-activedescendant')).toBe(
      item.id
    )
  );
};
const expectBetaSelected = async () => {
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setAccount'],
    [1, 'HDAccount']
  );
  expect(mockState.vault.activeAccount).toEqual({ id: 1, type: 'HDAccount' });
};

it('selects an account from fresh pointer-opened menu typeahead', async () => {
  const { user, trigger } = await open();
  await user.keyboard('Beta');
  await expectActive(/Beta.*tsys1qbeta/);
  await user.keyboard('{Enter}');
  await expectBetaSelected();
  expect(screen.queryByRole('menu')).toBeNull();
  await user.click(trigger);
  expect(
    screen
      .getByRole('menuitem', { name: /Beta.*tsys1qbeta/ })
      .getAttribute('aria-current')
  ).toBe('true');
});

it.each(['Escape', 'Tab'])(
  'starts fresh account typeahead after %s dismissal and pointer reopening',
  async (dismissal) => {
    const { user, trigger } = await open();
    await user.keyboard('Alpha');
    await expectActive(/Alpha.*tsys1qalpha/);
    await user.keyboard(`{${dismissal}}`);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
    await user.click(trigger);
    await user.keyboard('Beta');
    const beta = screen.getByRole('menuitem', { name: /Beta.*tsys1qbeta/ });
    const activeId = screen
      .getByRole('menu')
      .getAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect({
      activeId,
      calls: mockEmitter.mock.calls,
      selected: mockState.vault.activeAccount,
    }).toEqual({
      activeId: beta.id,
      calls: [
        [
          ['wallet', 'setAccount'],
          [1, 'HDAccount'],
        ],
      ],
      selected: { id: 1, type: 'HDAccount' },
    });
  }
);

it('starts account typeahead after outside dismissal and the native query timeout', async () => {
  const { user, trigger } = await open();
  await user.keyboard('Alpha');
  await expectActive(/Alpha.*tsys1qalpha/);
  await user.click(screen.getByRole('button', { name: 'After header' }));
  expect(screen.queryByRole('menu')).toBeNull();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
  await user.click(trigger);
  await user.keyboard('Beta');
  await expectActive(/Beta.*tsys1qbeta/);
  await user.keyboard('{Enter}');
  await expectBetaSelected();
});

it('starts fresh account typeahead when keyboard reopening focuses the first item', async () => {
  const { user, trigger } = await open();
  await user.keyboard('Alpha{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.keyboard('{Enter}');
  await expectActive(/Alpha.*tsys1qalpha/);
  await user.keyboard('Beta');
  await expectActive(/Beta.*tsys1qbeta/);
  await user.keyboard('{Enter}');
  await expectBetaSelected();
});

it('keeps direct pointer account selection usable after Escape dismissal', async () => {
  const { user, trigger } = await open();
  await user.keyboard('Alpha{Escape}');
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: /Beta.*tsys1qbeta/ }));
  await expectBetaSelected();
  expect(screen.queryByRole('menu')).toBeNull();
});

it.each(['{Enter}', ' ', '{ArrowDown}', '{ArrowUp}'])(
  'retains native first/last focus when reopening with %s',
  async (key) => {
    const { user, trigger } = await open();
    await user.keyboard('Alpha{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.keyboard(key);
    const items = screen.getAllByRole('menuitem');
    const expected = key === '{ArrowUp}' ? items[items.length - 1] : items[0];
    await waitFor(() =>
      expect(
        screen.getByRole('menu').getAttribute('aria-activedescendant')
      ).toBe(expected.id)
    );
    expect(mockEmitter).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  }
);

it('starts fresh account typeahead after a zero-detail opening click', async () => {
  const { user, trigger } = await open();
  await user.keyboard('Alpha{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger, { detail: 0 });
  await user.keyboard('Beta');
  await expectActive(/Beta.*tsys1qbeta/);
  await user.keyboard('{Enter}');
  await expectBetaSelected();
  expect(screen.queryByRole('menu')).toBeNull();
});
