/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { KeyringAccountType } from 'types/network';

import ConnectedSites from './ConnectedSites';

let mockState: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const host = 'https://connected.example';

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      return (
        key.split('.').reduce((entry: any, part) => entry?.[part], messages) ||
        key
      );
    },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
  EditIconSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('../../components/Button/Button').Button,
  IconButton: jest.requireActual('../../components/IconButton/IconButton')
    .IconButton,
  Icon: () => <svg aria-hidden="true" />,
  PageActionFooter: jest.requireActual(
    '../../components/PageActionFooter/PageActionFooter'
  ).PageActionFooter,
}));
jest.mock('utils/index', () => ({
  truncate: (value: string) => value,
  ellipsis: (value?: string) => value || '',
}));

const originalResizeObserver = globalThis.ResizeObserver;
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
  mockEmitter.mockReset().mockResolvedValue(undefined);
  mockNavigate.mockReset();
  mockState = {
    vault: {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: {
        [KeyringAccountType.HDAccount]: {
          0: { id: 0, label: 'Active HD account', address: 'active-address' },
          7: {
            id: 7,
            label: 'Another HD account',
            address: 'other-hd-address',
          },
        },
        [KeyringAccountType.Imported]: {
          0: { id: 0, label: 'Imported signer', address: 'imported-address' },
        },
        [KeyringAccountType.Ledger]: {
          0: { id: 0, label: 'Ledger signer', address: 'ledger-address' },
        },
        [KeyringAccountType.Trezor]: {
          0: { id: 0, label: 'Trezor signer', address: 'trezor-address' },
        },
        [KeyringAccountType.SmartAccount]: {
          0: { id: 0, label: 'Smart account signer', address: 'smart-address' },
        },
      },
    },
    dapp: {
      dapps: {
        connected: {
          host,
          accountId: 0,
          accountType: KeyringAccountType.Imported,
        },
      },
    },
  };
});

const mount = () =>
  render(
    <MemoryRouter>
      <ConnectedSites />
    </MemoryRouter>
  );
const connection = () => mockState.dapp.dapps.connected;

it.each([
  [KeyringAccountType.Imported, 'Imported signer'],
  [KeyringAccountType.Ledger, 'Ledger signer'],
  [KeyringAccountType.Trezor, 'Trezor signer'],
  [KeyringAccountType.SmartAccount, 'Smart account signer'],
])(
  'attributes same-ID %s connections to the actual connected account',
  (accountType, label) => {
    connection().accountType = accountType;
    mount();

    expect(screen.getByText(`Connected to: ${label}`)).toBeVisible();
    expect(screen.queryByText('Connected to: Active HD account')).toBeNull();
  }
);

it('omits the extra attribution only when both account type and ID match', () => {
  connection().accountType = KeyringAccountType.HDAccount;
  mount();

  expect(screen.getByText(host)).toBeVisible();
  expect(screen.queryByText(/^Connected to:/)).toBeNull();
});

it('retains attribution for a different ID within the same account type', () => {
  connection().accountType = KeyringAccountType.HDAccount;
  connection().accountId = 7;
  mount();

  expect(screen.getByText('Connected to: Another HD account')).toBeVisible();
});

it('uses the account-number fallback when the connected account is missing', () => {
  delete mockState.vault.accounts[KeyringAccountType.Imported][0];
  mount();

  expect(screen.getByText('Connected to: Account 1')).toBeVisible();
  expect(screen.queryByText('Connected to: Active HD account')).toBeNull();
});

it('keeps the selected account attribution and disconnects the exact host', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Edit connection' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit connection' });
  expect(within(dialog).getByText('Imported signer')).toBeVisible();
  expect(within(dialog).getByText('imported-address')).toBeVisible();
  expect(within(dialog).queryByText('Active HD account')).toBeNull();

  await user.click(
    within(dialog).getByRole('button', { name: 'Delete connected site' })
  );
  await waitFor(() => expect(screen.queryByText(host)).toBeNull());
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(['dapp', 'disconnect'], [host]);
});
