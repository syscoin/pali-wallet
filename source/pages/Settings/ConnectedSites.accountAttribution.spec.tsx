/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';
import { INetworkType, KeyringAccountType } from 'types/network';

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
    t: (key: string, values?: Record<string, string | number>) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      const resource =
        key === 'settings.connectedSiteCount'
          ? `${key}_${
              values?.count === 0
                ? 'zero'
                : values?.count === 1
                ? 'one'
                : 'other'
            }`
          : key;
      const message =
        resource
          .split('.')
          .reduce((entry: any, part) => entry?.[part], messages) || key;
      return message.replace(/{{(\w+)}}/g, (_match: string, name: string) =>
        String(values?.[name] ?? `{{${name}}}`)
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
      activeNetwork: { kind: INetworkType.Ethereum },
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
          chain: INetworkType.Ethereum,
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
const editName = () => `Edit connection: ${connection()?.host || host}`;
const rerenderPage = (view: ReturnType<typeof mount>) =>
  view.rerender(
    <MemoryRouter>
      <ConnectedSites />
    </MemoryRouter>
  );

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

it('uses the account-number fallback when the connected account is missing', async () => {
  delete mockState.vault.accounts[KeyringAccountType.Imported][0];
  mount();

  expect(screen.getByText('Connected to: Account 1')).toBeVisible();
  expect(screen.queryByText('Connected to: Active HD account')).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: editName() }));
  expect(
    within(screen.getByRole('dialog')).getByText('Unavailable')
  ).toBeVisible();
  expect(
    within(screen.getByRole('dialog')).queryByText('active-address')
  ).toBeNull();
});

it.each([INetworkType.Syscoin, INetworkType.Ethereum])(
  'does not attribute a retained foreign grant to the current %s vault',
  async (kind) => {
    mockState.vault.activeNetwork.kind = kind;
    connection().chain =
      kind === INetworkType.Syscoin
        ? INetworkType.Ethereum
        : INetworkType.Syscoin;
    const user = userEvent.setup();
    mount();
    expect(screen.getByText('Connected to: Account 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: editName() }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Account 1')).toBeVisible();
    expect(within(dialog).getByText('Unavailable')).toBeVisible();
    expect(within(dialog).queryByText('Imported signer')).toBeNull();
    expect(within(dialog).queryByText('imported-address')).toBeNull();
    expect(
      within(dialog).getByText(kind === INetworkType.Syscoin ? 'EVM' : 'UTXO')
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Delete connected site' })
    ).toBeEnabled();
  }
);

it.each([undefined, 'unrecognized'])(
  'keeps an unscoped grant removable without guessing its account or family (%s)',
  async (chain) => {
    connection().chain = chain as INetworkType;
    mount();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: editName() }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Unavailable')).toBeVisible();
    expect(within(dialog).queryByText('Imported signer')).toBeNull();
    expect(within(dialog).queryByText('imported-address')).toBeNull();
    expect(within(dialog).queryByText('EVM')).toBeNull();
    expect(within(dialog).queryByText('UTXO')).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Delete connected site' })
    ).toBeEnabled();
  }
);

it('constrains long inactive-account labels and hosts without dropping their accessible text', () => {
  const label = 'A'.repeat(80);
  const longHost = `https://${'long-subdomain'.repeat(12)}.example`;
  mockState.vault.accounts[KeyringAccountType.Imported][0].label = label;
  connection().host = longHost;
  mount();

  const attribution = screen.getByText(`Connected to: ${label}`);
  const site = screen.getByText(longHost);
  const content = attribution.parentElement;
  expect(attribution).toHaveAttribute('title', label);
  expect(site).toHaveAttribute('title', longHost);
  expect(attribution).toHaveClass('truncate');
  expect(site).toHaveClass('truncate');
  expect(content).toHaveClass('min-w-0', 'flex-1');
  expect(content?.parentElement).toHaveClass('flex', 'gap-3');
  expect(screen.getByRole('button', { name: editName() })).toHaveClass(
    'h-10',
    'w-10',
    'shrink-0'
  );
});

it('keeps the selected account attribution and disconnects the exact host', async () => {
  const user = userEvent.setup();
  mockEmitter.mockImplementationOnce(async () => {
    mockState.dapp.dapps = {};
  });
  mount();
  await user.click(screen.getByRole('button', { name: editName() }));
  const dialog = screen.getByRole('dialog', { name: 'Edit connection' });
  expect(within(dialog).getByText('Imported signer')).toBeVisible();
  expect(within(dialog).getByText('imported-address')).toBeVisible();
  expect(within(dialog).queryByText('Active HD account')).toBeNull();

  await user.click(
    within(dialog).getByRole('button', { name: 'Delete connected site' })
  );
  await waitFor(() => expect(screen.queryByText(host)).toBeNull());
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['dapp', 'disconnect'],
    [host, true, { allowAlreadyDisconnected: true, propagateErrors: true }]
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows a newly approved connection after disconnecting the same host without leaving the page', async () => {
  const user = userEvent.setup();
  const previous = connection();
  mockEmitter.mockImplementationOnce(async () => {
    mockState.dapp.dapps = {};
  });
  const view = mount();
  await user.click(screen.getByRole('button', { name: editName() }));
  await user.click(
    screen.getByRole('button', { name: 'Delete connected site' })
  );
  await waitFor(() => expect(screen.queryByText(host)).toBeNull());
  mockState.dapp.dapps = {
    connected: { ...previous, accountType: KeyringAccountType.Ledger, date: 2 },
  };
  rerenderPage(view);
  expect(screen.getByText(host)).toBeVisible();
  expect(screen.getByText('Connected to: Ledger signer')).toBeVisible();
  expect(
    screen.getByText(
      en.settings.connectedSiteCount_one.replace('{{count}}', '1')
    )
  ).toBeVisible();
  expect(screen.getByRole('button', { name: editName() })).toBeEnabled();
});

it('keeps an open connection review attributed to the live connected account', async () => {
  const user = userEvent.setup();
  const view = mount();
  await user.click(screen.getByRole('button', { name: editName() }));
  mockState.dapp.dapps = {
    connected: {
      ...connection(),
      accountType: KeyringAccountType.Ledger,
      date: 2,
    },
  };
  rerenderPage(view);
  const dialog = screen.getByRole('dialog', { name: 'Edit connection' });
  expect(within(dialog).getByText('Ledger signer')).toBeVisible();
  expect(within(dialog).getByText('ledger-address')).toBeVisible();
  expect(within(dialog).queryByText('Imported signer')).toBeNull();
});

it('closes an externally removed connection review and does not reopen it on reconnection', async () => {
  const user = userEvent.setup();
  const previous = connection();
  const view = mount();
  await user.click(screen.getByRole('button', { name: editName() }));
  mockState.dapp.dapps = {};
  rerenderPage(view);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  mockState.dapp.dapps = { connected: previous };
  rerenderPage(view);
  expect(screen.getByText(host)).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('restores access after a rejected disconnect without hiding the still-connected host', async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  mockEmitter.mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
  const errors = jest.spyOn(console, 'error').mockImplementation();
  try {
    mount();
    await user.click(screen.getByRole('button', { name: editName() }));
    await user.click(
      screen.getByRole('button', { name: 'Delete connected site' })
    );
    await act(async () => reject(new Error('Controller unavailable')));
    expect(screen.getByText(host)).toBeVisible();
    expect(screen.getByRole('button', { name: editName() })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Controller unavailable'
    );

    await user.click(screen.getByRole('button', { name: editName() }));
    mockEmitter.mockImplementationOnce(async () => {
      mockState.dapp.dapps = {};
    });
    await user.click(
      screen.getByRole('button', { name: 'Delete connected site' })
    );
    await waitFor(() => expect(screen.queryByText(host)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockEmitter).toHaveBeenCalledTimes(2);
    expect(mockEmitter).toHaveBeenLastCalledWith(
      ['dapp', 'disconnect'],
      [host, true, { allowAlreadyDisconnected: true, propagateErrors: true }]
    );
  } finally {
    errors.mockRestore();
  }
});

it('uses translated fallback feedback when a disconnect error has no message', async () => {
  const user = userEvent.setup();
  mockEmitter.mockRejectedValueOnce({ code: 'DISCONNECT_UNAVAILABLE' });
  const errors = jest.spyOn(console, 'error').mockImplementation();
  try {
    mount();
    await user.click(screen.getByRole('button', { name: editName() }));
    await user.click(
      screen.getByRole('button', { name: 'Delete connected site' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByText(host)).toBeVisible();
    expect(screen.getByRole('button', { name: editName() })).toBeEnabled();
  } finally {
    errors.mockRestore();
  }
});

it('does not carry a late disconnect error into a reopened settings page', async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  mockEmitter.mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
  const errors = jest.spyOn(console, 'error').mockImplementation();
  try {
    const view = mount();
    await user.click(screen.getByRole('button', { name: editName() }));
    await user.click(
      screen.getByRole('button', { name: 'Delete connected site' })
    );
    view.unmount();
    mount();
    await act(async () => reject(new Error('Earlier disconnect failed')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(host)).toBeVisible();
    expect(screen.getByRole('button', { name: editName() })).toBeEnabled();
  } finally {
    errors.mockRestore();
  }
});
