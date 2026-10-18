/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { KeyringAccountType } from 'types/network';

import EditAccount from './EditAccount';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const initialState = () => ({
  vault: {
    activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
    activeNetwork: {
      kind: 'Ethereum',
      chainId: 5700,
      url: 'https://rpc.invalid',
    },
    accounts: {
      SmartAccount: {
        1: {
          id: 1,
          label: 'Family savings',
          address: '0x1111111111111111111111111111111111111111',
          isSmartAccount: true,
        },
      },
    },
  },
});
let mockState: any;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
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
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg /> }));
jest.mock('components/Icon/Icon', () => ({
  LockIconSvg: () => <svg />,
  LoadingSvg: () => <svg />,
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: jest.requireActual('components/Button/Button').Button,
}));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const Policy = () => {
  const navigate = useNavigate();
  return (
    <>
      <h1>Account policy</h1>
      <button
        onClick={() =>
          navigate('/settings/edit-account', {
            state: {
              id: 1,
              accountType: KeyringAccountType.SmartAccount,
              returnContext: { returnRoute: '/settings/manage-accounts' },
            },
          })
        }
      >
        Reopen account editor
      </button>
    </>
  );
};
const Tree = () => (
  <MemoryRouter
    future={{ ['v7_startTransition']: true, ['v7_relativeSplatPath']: true }}
    initialEntries={[
      {
        pathname: '/settings/edit-account',
        state: {
          id: 1,
          accountType: KeyringAccountType.SmartAccount,
          returnContext: { returnRoute: '/settings/manage-accounts' },
        },
      },
    ]}
  >
    <Routes>
      <Route path="/settings/edit-account" element={<EditAccount />} />
      <Route
        path="/settings/account/smart-account-policy"
        element={<Policy />}
      />
      <Route path="/settings/manage-accounts" element={<h1>Accounts</h1>} />
    </Routes>
  </MemoryRouter>
);
const save = async (label = 'Updated savings') => {
  fireEvent.change(screen.getByPlaceholderText('settings.accountLabel'), {
    target: { value: label },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalled());
};
const originalMessageChannel = globalThis.MessageChannel;
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockState = initialState();
  mockEmitter.mockResolvedValue(undefined);
});

it('preserves the exact account label mutation and returns to Accounts after a current Save', async () => {
  render(<Tree />);
  await save();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'editAccountLabel'],
    ['Updated savings', 1, KeyringAccountType.SmartAccount]
  );
  expect(
    await screen.findByRole('heading', { name: 'Accounts' })
  ).toBeVisible();
  expect(mockAlert.success).toHaveBeenCalledWith(
    'settings.accountLabelEditedSuccessfully'
  );
});

it.each(['success', 'error'])(
  'does not leave account policy or show obsolete feedback when an earlier Save settles with %s',
  async (outcome) => {
    const response = deferred();
    mockEmitter.mockReturnValueOnce(response.promise);
    render(<Tree />);
    await save();
    fireEvent.click(
      screen.getByRole('button', { name: /settings.smartAccountAccountPolicy/ })
    );
    expect(
      screen.getByRole('heading', { name: 'Account policy' })
    ).toBeVisible();
    await act(async () => {
      if (outcome === 'success') response.resolve();
      else response.reject(new Error('Earlier edit failed'));
    });
    expect(
      screen.getByRole('heading', { name: 'Account policy' })
    ).toBeVisible();
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('keeps a failed current label draft editable and allows a successful retry', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Label save unavailable'));
  render(<Tree />);
  await save();
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith('Label save unavailable')
  );
  expect(screen.getByPlaceholderText('settings.accountLabel')).toHaveValue(
    'Updated savings'
  );
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(
    await screen.findByRole('heading', { name: 'Accounts' })
  ).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('admits only one Save when real form submissions overlap', async () => {
  const response = deferred();
  mockEmitter.mockReturnValue(response.promise);
  render(<Tree />);
  fireEvent.change(screen.getByPlaceholderText('settings.accountLabel'), {
    target: { value: 'Updated savings' },
  });
  const form = document.querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  await act(async () => response.resolve());
  expect(
    await screen.findByRole('heading', { name: 'Accounts' })
  ).toBeVisible();
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
});

it.each(['success', 'error'])(
  'does not navigate or clear a newer Save when an old scope completes with %s',
  async (outcome) => {
    const old = deferred();
    const current = deferred();
    mockEmitter
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const view = render(<Tree />);
    await save('First label');
    mockState.vault.activeNetwork = {
      ...mockState.vault.activeNetwork,
      chainId: 42161,
      url: 'https://other-rpc.invalid',
    };
    view.rerender(<Tree />);
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
    await save('New scope label');
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    await act(async () => {
      if (outcome === 'success') old.resolve();
      else old.reject(new Error('Old scope failure'));
    });
    expect(screen.getByPlaceholderText('settings.accountLabel')).toHaveValue(
      'New scope label'
    );
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    await act(async () => current.resolve());
    expect(
      await screen.findByRole('heading', { name: 'Accounts' })
    ).toBeVisible();
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
  }
);

it.each(['active account', 'selected identity', 'network round trip'])(
  'ignores an earlier Save after an observed %s change',
  async (change) => {
    const response = deferred();
    mockEmitter.mockReturnValueOnce(response.promise);
    const view = render(<Tree />);
    await save();
    if (change === 'active account') mockState.vault.activeAccount.id = 2;
    if (change === 'selected identity')
      mockState.vault.accounts.SmartAccount[1].address =
        '0x2222222222222222222222222222222222222222';
    if (change === 'network round trip')
      mockState.vault.activeNetwork.chainId = 42161;
    view.rerender(<Tree />);
    if (change === 'network round trip') {
      mockState.vault.activeNetwork.chainId = 5700;
      view.rerender(<Tree />);
    }
    await act(async () => response.resolve());
    expect(screen.getByPlaceholderText('settings.accountLabel')).toBeVisible();
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);
