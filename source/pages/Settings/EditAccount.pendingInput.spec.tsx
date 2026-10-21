/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import EditAccount from './EditAccount';
import ManageAccounts from './ManageAccounts';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ connectionUnavailable: false }),
}));
jest.mock('components/Icon/Icon', () => ({
  LockIconSvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  RiUserReceivedLine: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Icon: () => null,
  ConfirmationModal: () => null,
}));

const originalMessageChannel = globalThis.MessageChannel;
const originalResize = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
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
  } as any;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResize;
  window.matchMedia = originalMatchMedia;
});
const publishLabel = ([label, id, type]: any[]) => {
  mockState.vault.accounts[type][id].label = label;
};
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vaultGlobal: {
      activeSlip44: 60,
      networkStatus: 'connected',
      isSwitchingAccount: false,
    },
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        currency: 'eth',
        url: 'https://synthetic.invalid',
      },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            label: 'Reserve',
            address: '0x1111111111111111111111111111111111111111',
            xpub: 'public-key-zero',
          },
          1: {
            id: 1,
            label: 'Second account',
            address: '0x2222222222222222222222222222222222222222',
            xpub: 'public-key-one',
          },
        },
        Imported: {},
        SmartAccount: {},
        Trezor: {},
        Ledger: {},
      },
    },
  };
  mockEmitter.mockImplementation(async (_path: string[], args: any[]) =>
    publishLabel(args)
  );
});
afterEach(() => {
  expect(
    mockEmitter.mock.calls.every(
      ([path]) => path.join('.') === 'wallet.editAccountLabel'
    )
  ).toBe(true);
});
const Shell = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        Back to accounts
      </button>
      <Routes>
        <Route path="/settings/manage-accounts" element={<ManageAccounts />} />
        <Route path="/settings/edit-account" element={<EditAccount />} />
        <Route path="/home" element={<h1>Home</h1>} />
      </Routes>
    </>
  );
};
const mountAndEdit = async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/settings/manage-accounts']}>
      <Shell />
    </MemoryRouter>
  );
  await user.click(
    screen.getByRole('button', { name: 'buttons.edit: Second account' })
  );
  const input = screen.getByPlaceholderText('settings.accountLabel');
  expect(input).toHaveValue('Second account');
  expect(mockEmitter).not.toHaveBeenCalled();
  return { user, input };
};
const typeLabel = async (
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  text: string
) => {
  await user.clear(input);
  await user.type(input, text);
};
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const holdSave = () => {
  const pending = deferred();
  mockEmitter.mockImplementationOnce(async (_path: string[], args: any[]) => {
    await pending.promise;
    publishLabel(args);
  });
  return pending;
};

it('locks only the current label input while its captured Save is pending', async () => {
  const { user, input } = await mountAndEdit();
  const pending = holdSave();
  await typeLabel(user, input, 'Saved A');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  expect(input).toBeDisabled();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  await user.type(input, ' unwanted second draft');
  expect(input).toHaveValue('Saved A');
  expect(mockEmitter.mock.calls[0][1][0]).toBe('Saved A');
  await act(async () => pending.resolve());
  expect(
    await screen.findByRole('button', { name: 'buttons.edit: Saved A' })
  ).toBeVisible();
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
});

it('lets an unchanged delayed Save return normally to Manage Accounts', async () => {
  const { user, input } = await mountAndEdit();
  const pending = holdSave();
  await typeLabel(user, input, 'Stable label');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await act(async () => pending.resolve());
  expect(
    await screen.findByRole('button', { name: 'buttons.edit: Stable label' })
  ).toBeVisible();
  expect(mockAlert.success).toHaveBeenCalledWith(
    'settings.accountLabelEditedSuccessfully'
  );
});

it('submits native Enter with the exact edited account and label', async () => {
  const { user, input } = await mountAndEdit();
  await typeLabel(user, input, 'Keyboard target');
  await user.keyboard('{Enter}');
  expect(
    await screen.findByRole('button', { name: 'buttons.edit: Keyboard target' })
  ).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'editAccountLabel'],
    [
      'Keyboard target',
      1,
      'HDAccount',
      expect.objectContaining({
        account: {
          address: '0x2222222222222222222222222222222222222222',
          xpub: 'public-key-one',
        },
      }),
    ]
  );
});

it('re-enables the label after a failed Save and allows editing and retry', async () => {
  const { user, input } = await mountAndEdit();
  const pending = holdSave();
  await typeLabel(user, input, 'Saved A');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  expect(input).toBeDisabled();
  await act(async () => pending.reject(new Error('Synthetic storage failure')));
  expect(input).toBeEnabled();
  expect(input).toHaveValue('Saved A');
  expect(mockAlert.error).toHaveBeenCalledWith('Synthetic storage failure');
  await typeLabel(user, input, 'Retried B');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(
    await screen.findByRole('button', { name: 'buttons.edit: Retried B' })
  ).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(mockEmitter.mock.calls[1][1][0]).toBe('Retried B');
});

it('does not lock a different account entry while an earlier entry Save completes', async () => {
  const { user, input } = await mountAndEdit();
  const pending = holdSave();
  await typeLabel(user, input, 'Saved A');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: 'Back to accounts' }));
  await user.click(
    screen.getByRole('button', { name: 'buttons.edit: Reserve' })
  );
  const current = screen.getByPlaceholderText('settings.accountLabel');
  expect(current).toBeEnabled();
  await typeLabel(user, current, 'Reserve B');
  await act(async () => pending.resolve());
  expect(current).toHaveValue('Reserve B');
  expect(current).toBeEnabled();
  expect(mockAlert.success).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(
    await screen.findByRole('button', { name: 'buttons.edit: Reserve B' })
  ).toBeVisible();
  expect(mockEmitter.mock.calls[1][1].slice(0, 3)).toEqual([
    'Reserve B',
    0,
    'HDAccount',
  ]);
});
