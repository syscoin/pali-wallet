/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import en from 'assets/locales/en.json';
import EditAccount from 'pages/Settings/EditAccount';
import ManageAccounts from 'pages/Settings/ManageAccounts';
import vaultReducer, { setAccountLabel } from 'state/vault';
import { KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/format';

// Real components, Ant Form, router, reducer and dialog; controller transport
// is a strict relay. The removalRecoveryGuidance suite owns the locale/kind matrix.
let mockStore: ReturnType<typeof configureStore>;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const originalObserver = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;
const originalMessageChannel = globalThis.MessageChannel;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const A = address('2');
const B = address('3');
const SHARED = 'Daily';

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ connectionUnavailable: false }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));
jest.mock('components/Icon/Icon', () => ({
  RiUserReceivedLine: () => null,
  LockIconSvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  MdBugReport: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Icon: () => null,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
}));

function installStore() {
  const vault = {
    ...vaultReducer(undefined, { type: 'fixture/init' }),
    activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 1,
      url: 'https://synthetic.invalid',
      currency: 'eth',
    },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          label: 'Anchor',
          address: address('1'),
          xpub: 'public-anchor',
        },
        1: { id: 1, label: 'Reserve', address: A, xpub: 'public-a' },
        2: { id: 2, label: 'Savings', address: B, xpub: 'public-b' },
      },
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  };
  const globalState = {
    activeSlip44: 60,
    networkStatus: 'idle',
    isSwitchingAccount: false,
  };
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: (state = globalState) => state,
    },
    preloadedState: {
      vault: vault as unknown as ReturnType<typeof vaultReducer>,
      vaultGlobal: globalState,
    },
  });
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as any;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
  window.matchMedia = originalMatchMedia;
  globalThis.MessageChannel = originalMessageChannel;
});
beforeEach(() => {
  jest.clearAllMocks();
  installStore();
  mockEmitter.mockImplementation(
    async ([, method], [label, accountId, accountType, expected]) => {
      if (method !== 'editAccountLabel')
        throw new Error('Mutation not admitted: ' + method);
      const current: any = mockStore.getState();
      expect(expected.account.address).toBe(
        current.vault.accounts[accountType][accountId].address
      );
      expect(expected.account.xpub).toBe(
        current.vault.accounts[accountType][accountId].xpub
      );
      mockStore.dispatch(setAccountLabel({ label, accountId, accountType }));
    }
  );
});
afterEach(() => {
  cleanup();
  expect(
    mockEmitter.mock.calls.every(
      ([[, method]]) => method === 'editAccountLabel'
    )
  ).toBe(true);
});

const EditScreen = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <EditAccount />
      <output data-testid="editing-id">{location.state?.id}</output>
      <output data-testid="editing-kind">{location.state?.accountType}</output>
      <button onClick={() => navigate(-1)}>Back to list</button>
    </>
  );
};
async function mount() {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    initImmediate: false,
    lng: 'en',
    resources: { en: { translation: en } },
    react: { useSuspense: false },
  });
  render(
    <Provider store={mockStore}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/settings/manage-accounts']}>
          <Routes>
            <Route
              path="/settings/manage-accounts"
              element={<ManageAccounts />}
            />
            <Route path="/settings/edit-account" element={<EditScreen />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>
  );
  return { user: userEvent.setup(), i18n };
}
const rowFor = (value: string) =>
  screen
    .getAllByRole('listitem')
    .find((row) => row.textContent?.includes(ellipsis(value, 4, 4)))!;
const action = (row: HTMLElement, name: string) =>
  within(row).getByRole('button', { name: new RegExp('^' + name + ':') });
const identity = (label: string, value: string) => `${label} (${value})`;
async function activate(
  user: ReturnType<typeof userEvent.setup>,
  element: HTMLElement,
  keyboard: boolean
) {
  if (keyboard) {
    element.focus();
    expect(element).toHaveFocus();
    await user.keyboard('{Enter}');
  } else await user.click(element);
}
async function renameBoth(user: ReturnType<typeof userEvent.setup>) {
  for (const [value, id] of [
    [A, 1],
    [B, 2],
  ] as const) {
    await user.click(action(rowFor(value), en.buttons.edit));
    expect(screen.getByTestId('editing-id')).toHaveTextContent(String(id));
    expect(screen.getByTestId('editing-kind')).toHaveTextContent(
      KeyringAccountType.HDAccount
    );
    const input = screen.getByPlaceholderText(en.settings.accountLabel);
    await user.clear(input);
    await user.type(input, SHARED);
    await user.click(screen.getByRole('button', { name: en.buttons.save }));
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    );
  }
  const state: any = mockStore.getState();
  expect(state.vault.accounts.HDAccount[1].label).toBe(SHARED);
  expect(state.vault.accounts.HDAccount[2].label).toBe(SHARED);
  expect(state.vault.activeAccount).toEqual({
    id: 0,
    type: KeyringAccountType.HDAccount,
  });
}

it('healthy distinct-label actions and duplicate-label targets keep exact account identities', async () => {
  const { user } = await mount();
  expect(action(rowFor(A), en.buttons.edit)).toHaveAccessibleName(/Reserve/);
  expect(action(rowFor(B), en.buttons.edit)).toHaveAccessibleName(/Savings/);
  await renameBoth(user);
  for (const [value, id] of [
    [A, 1],
    [B, 2],
  ] as const) {
    await activate(user, action(rowFor(value), en.buttons.edit), id === 2);
    expect(screen.getByTestId('editing-id')).toHaveTextContent(String(id));
    expect(screen.getByTestId('editing-kind')).toHaveTextContent(
      KeyringAccountType.HDAccount
    );
    expect(screen.getByTitle(value)).toHaveTextContent(ellipsis(value, 12, 14));
    expect(screen.getByPlaceholderText(en.settings.accountLabel)).toHaveValue(
      SHARED
    );
    await user.click(screen.getByRole('button', { name: 'Back to list' }));
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    );
  }
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(
    mockEmitter.mock.calls.map(([, params]) => params.slice(0, 3))
  ).toEqual([
    [SHARED, 1, KeyringAccountType.HDAccount],
    [SHARED, 2, KeyringAccountType.HDAccount],
  ]);
});

it('healthy duplicate-label removal previews Cancel by pointer and Enter without removing accounts', async () => {
  const { user } = await mount();
  await renameBoth(user);
  const before = mockStore.getState();
  for (const [index, value] of [A, B].entries()) {
    await activate(user, action(rowFor(value), en.buttons.remove), index === 1);
    const dialog = screen.getByRole('dialog', {
      name: en.settings.removeAccount,
    });
    await activate(
      user,
      within(dialog).getByRole('button', { name: en.buttons.cancel }),
      index === 1
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockStore.getState()).toBe(before);
  }
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

it('duplicate-label action names are unique full identities and existing row text has an identity title', async () => {
  const { user } = await mount();
  await renameBoth(user);
  for (const value of [A, B]) {
    const row = rowFor(value);
    const full = identity(SHARED, value);
    for (const operation of [en.buttons.edit, en.buttons.remove]) {
      const name = `${operation}: ${full}`;
      expect(screen.getByRole('button', { name })).toBe(action(row, operation));
      expect(action(row, operation)).toHaveAccessibleName(name);
    }
    const visible = within(row).getByText(
      identity(SHARED, ellipsis(value, 4, 4)),
      { exact: true }
    );
    expect(visible).toHaveAttribute('title', full);
  }
});

it('duplicate-label dialogs interpolate the full selected identity into the existing localized question', async () => {
  const { user, i18n } = await mount();
  await renameBoth(user);
  const descriptions: string[] = [];
  for (const value of [A, B]) {
    await user.click(action(rowFor(value), en.buttons.remove));
    const dialog = screen.getByRole('dialog', {
      name: en.settings.removeAccount,
    });
    const expected = i18n.t('settings.removeAccountConfirmation', {
      accountName: identity(SHARED, value),
      accountType: 'Pali',
    });
    expect(within(dialog).getByText(expected, { exact: true })).toBeVisible();
    expect(dialog).not.toHaveTextContent(
      en.settings.importedAccountRemovalWarning
    );
    descriptions.push(dialog.textContent || '');
    await user.click(
      within(dialog).getByRole('button', { name: en.buttons.cancel })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
  expect(descriptions[0]).toContain(A);
  expect(descriptions[0]).not.toContain(B);
  expect(descriptions[1]).toContain(B);
  expect(descriptions[1]).not.toContain(A);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});
