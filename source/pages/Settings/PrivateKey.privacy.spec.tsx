/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { KeyringAccountType } from 'types/network';

import PrivateKey from './PrivateKey';

let mockVault: any;
const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockTranslate = (key: string) => key;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select({ vault: mockVault }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useAdjustedExplorer: (url: string) => url,
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy],
    alert: { info: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CopyCard: ({ children, label, onClick }: any) => (
    <button onClick={onClick}>
      {label}
      {children}
    </button>
  ),
  ValidatedPasswordInput: jest.requireActual(
    'components/Input/ValidatedPasswordInput'
  ).ValidatedPasswordInput,
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));

const originalMessageChannel = globalThis.MessageChannel;
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
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  mockCopy.mockReset().mockResolvedValue(undefined);
  mockEmitter
    .mockReset()
    .mockImplementation(async (_method, [, , password]) => {
      if (password !== 'correct') throw new Error('Invalid password');
      return 'synthetic-private-key';
    });
  mockVault = {
    activeNetwork: {
      chainId: 5700,
      url: 'https://rpc.invalid',
      explorer: 'https://explorer.invalid/',
    },
    activeAccount: { type: KeyringAccountType.Imported, id: 0 },
    isBitcoinBased: true,
    accounts: {
      Imported: {
        0: {
          id: 0,
          address: 'public-address',
          xpub: 'public-address',
          xprv: 'encrypted-key',
        },
      },
    },
  };
});

it('resets private-key reveal on password change and requires a fresh reveal after reauthentication', async () => {
  render(<PrivateKey />);
  const password = screen.getByPlaceholderText('settings.enterYourPassword');
  fireEvent.change(password, { target: { value: 'correct' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  fireEvent.click(await screen.findByRole('button', { name: 'buttons.show' }));
  expect(screen.getByText('synthetic-private-key')).toBeVisible();
  fireEvent.change(password, { target: { value: '' } });
  expect(screen.queryByText('synthetic-private-key')).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.hide' })).toBeNull();
  fireEvent.change(password, { target: { value: 'correct' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(
    await screen.findByRole('button', { name: 'buttons.show' })
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'buttons.hide' })).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it.each([
  `0x${'1234567890abcdef'.repeat(4)}`,
  `K${'syntheticprivatekey'.repeat(3)}`,
])('conceals private-key fragments until Show and after Hide', async (key) => {
  mockEmitter.mockResolvedValueOnce(key);
  const view = render(<PrivateKey />);
  const password = screen.getByPlaceholderText('settings.enterYourPassword');
  const tail = key.slice(-16);
  expect(view.container.textContent).not.toContain(tail);
  fireEvent.change(password, { target: { value: 'correct' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  const show = await screen.findByRole('button', { name: 'buttons.show' });
  expect(view.container.textContent).not.toContain(tail);
  expect(view.container.textContent).not.toContain(key);
  fireEvent.click(show);
  expect(screen.getByText(key)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.hide' }));
  expect(view.container.textContent).not.toContain(tail);
  expect(view.container.textContent).not.toContain(key);
});

it('keeps a signing import with an address-shaped public identifier exportable', () => {
  render(<PrivateKey />);
  expect(
    screen.getByPlaceholderText('settings.enterYourPassword')
  ).toBeVisible();
  expect(screen.queryByText('settings.watchOnlyNoPrivateKey')).toBeNull();
});

it.each([
  ['public-address', 'settings.yourPublicAddress', 'address/public-address'],
  ['vpub-synthetic-public', 'settings.yourXpub', 'xpub/vpub-synthetic-public'],
  [
    'wpkh(public-key)#checksum',
    'settings.yourPublicDescriptor',
    'xpub/wpkh(public-key)%23checksum',
  ],
])(
  'presents watch-only %s without password authentication and copies only the public identifier',
  async (identifier, label, route) => {
    mockVault.accounts.Imported[0].xprv = '';
    mockVault.accounts.Imported[0].xpub = identifier;
    render(<PrivateKey />);
    expect(screen.getByText('settings.watchOnlyNoPrivateKey')).toBeVisible();
    expect(
      screen.queryByPlaceholderText('settings.enterYourPassword')
    ).toBeNull();
    expect(screen.queryByText('settings.forgetWarning')).toBeNull();
    expect(screen.queryByText('settings.yourPrivateKey')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith(identifier));
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `https://rpc.invalid/${route}`
    );
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each([
  KeyringAccountType.HDAccount,
  KeyringAccountType.Ledger,
  KeyringAccountType.Trezor,
  KeyringAccountType.SmartAccount,
])('preserves %s authentication or hardware unavailability', (type) => {
  mockVault.accounts[type] = mockVault.accounts.Imported;
  mockVault.activeAccount.type = type;
  render(<PrivateKey />);
  if (type === KeyringAccountType.HDAccount)
    expect(
      screen.getByPlaceholderText('settings.enterYourPassword')
    ).toBeVisible();
  else {
    expect(
      screen.getByText('settings.hardwareWalletPrivateKeyUnavailable')
    ).toBeVisible();
    expect(
      screen.queryByPlaceholderText('settings.enterYourPassword')
    ).toBeNull();
  }
  expect(mockEmitter).not.toHaveBeenCalled();
});
