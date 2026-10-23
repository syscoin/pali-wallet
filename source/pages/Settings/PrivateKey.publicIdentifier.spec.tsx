/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { KeyringAccountType } from 'types/network';

import PrivateKey from './PrivateKey';

const ADDRESS = 'tsys1q6rz28mcfaxtmd6v789l9rrlrusdprr9p4ugvp5';
const XPUB =
  'tpubDC3pD7UZXnsgh3EBjbtBQiB1FnLask7UHBSunZ1DPK4dCFFZoFRkgxHB8gt42FvLzx1DpxfHWxAsYaY6b643RVcGjDxXxns7wKKYnnfEcbB';
const DESCRIPTOR = `wpkh(${XPUB})`;
let mockVault: any;
const mockEmitter = jest.fn();
const mockClipboard = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select({ vault: mockVault }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useAdjustedExplorer: jest.requireActual('hooks/useAdjustedExplorer')
    .useAdjustedExplorer,
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => jest.fn(),
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  ...jest.requireActual('components/Cards/Cards'),
  Icon: () => <svg aria-hidden="true" />,
  ValidatedPasswordInput: jest.requireActual(
    'components/Input/ValidatedPasswordInput'
  ).ValidatedPasswordInput,
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);
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
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});
beforeEach(() => {
  mockClipboard.mockReset().mockResolvedValue(undefined);
  mockEmitter
    .mockReset()
    .mockRejectedValue(new Error('No secret read allowed'));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockClipboard },
  });
  mockVault = {
    activeNetwork: {
      chainId: 5700,
      kind: 'syscoin',
      currency: 'tsys',
      url: 'https://blockbook.synthetic.invalid',
      explorer: 'https://explorer.synthetic.invalid/',
    },
    activeAccount: { type: KeyringAccountType.Imported, id: 0 },
    isBitcoinBased: true,
    accounts: {
      Imported: {
        0: {
          id: 0,
          label: 'Synthetic WIF import',
          address: ADDRESS,
          // Actual signing WIF producer stores its payment address in xpub.
          xpub: ADDRESS,
          // Presence-only fixture, not an encrypted key or a decryptable secret.
          xprv: 'non-decryptable-test-presence-marker',
          isImported: true,
        },
      },
    },
  };
});
afterEach(() => {
  // Public identity inspection/copy must never authenticate or request secrets.
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('labels a signing WIF public identifier as a payment address, not XPUB', () => {
  render(<PrivateKey />);
  expect(screen.getByText('settings.yourPublicAddress')).toBeVisible();
  expect(screen.queryByText('settings.yourXpub')).toBeNull();
  expect(screen.getByTitle(ADDRESS)).toBeVisible();
});

it('does not tell a signing WIF owner that the payment address cannot receive', () => {
  render(<PrivateKey />);
  expect(screen.queryByText('settings.itIsntAReceivingAddress')).toBeNull();
  expect(screen.queryByText(/settings.thisIsYourAccountIndexer/)).toBeNull();
});

it('links a signing WIF public identifier to the address explorer route', () => {
  render(<PrivateKey />);
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `https://blockbook.synthetic.invalid/address/${ADDRESS}`
  );
});

it('retains the signing WIF password form without exposing or requesting a key', () => {
  render(<PrivateKey />);
  expect(
    screen.getByPlaceholderText('settings.enterYourPassword')
  ).toBeVisible();
  expect(screen.getByText('settings.yourPrivateKey')).toBeVisible();
  expect(screen.queryByText('settings.watchOnlyNoPrivateKey')).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.show' })).toBeNull();
  expect(screen.queryByText('non-decryptable-test-presence-marker')).toBeNull();
});

it.each(['{Enter}', ' '])(
  'copies only the signing WIF public address using native keyboard %s',
  async (key) => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockClipboard },
    });
    render(<PrivateKey />);
    const copy = screen.getByRole('button', { name: /^buttons.copy / });
    expect(copy).toHaveAttribute('type', 'button');
    await user.tab();
    expect(document.activeElement).toBe(copy);
    await user.keyboard(key);
    expect(mockClipboard).toHaveBeenCalledTimes(1);
    expect(mockClipboard).toHaveBeenCalledWith(ADDRESS);
  }
);

it('keeps a watch-only payment address public without adding authentication', () => {
  mockVault.accounts.Imported[0].xprv = '';
  render(<PrivateKey />);
  expect(screen.getByText('settings.yourPublicAddress')).toBeVisible();
  expect(screen.getByText('settings.watchOnlyNoPrivateKey')).toBeVisible();
  expect(
    screen.queryByPlaceholderText('settings.enterYourPassword')
  ).toBeNull();
  expect(screen.queryByText('settings.itIsntAReceivingAddress')).toBeNull();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `https://blockbook.synthetic.invalid/address/${ADDRESS}`
  );
});

it('retains XPUB/indexer semantics and authentication for an extended signing import', () => {
  mockVault.accounts.Imported[0].xpub = XPUB;
  render(<PrivateKey />);
  expect(screen.getByText('settings.yourXpub')).toBeVisible();
  expect(screen.getByText(/settings.itIsntAReceivingAddress/)).toBeVisible();
  expect(
    screen.getByPlaceholderText('settings.enterYourPassword')
  ).toBeVisible();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `https://blockbook.synthetic.invalid/xpub/${XPUB}`
  );
});

it('retains descriptor semantics and no-secret availability for a watch import', () => {
  mockVault.accounts.Imported[0].xprv = '';
  mockVault.accounts.Imported[0].xpub = DESCRIPTOR;
  render(<PrivateKey />);
  expect(screen.getByText('settings.yourPublicDescriptor')).toBeVisible();
  expect(screen.getByText('settings.watchOnlyNoPrivateKey')).toBeVisible();
  expect(
    screen.queryByPlaceholderText('settings.enterYourPassword')
  ).toBeNull();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `https://blockbook.synthetic.invalid/xpub/${encodeURIComponent(DESCRIPTOR)}`
  );
});

it('retains a normal HD account indexer label and private authentication', () => {
  mockVault.activeAccount.type = KeyringAccountType.HDAccount;
  mockVault.accounts.HDAccount = {
    0: { ...mockVault.accounts.Imported[0], xpub: XPUB, isImported: false },
  };
  render(<PrivateKey />);
  expect(screen.getByText('settings.yourXpub')).toBeVisible();
  expect(screen.getByText(/settings.itIsntAReceivingAddress/)).toBeVisible();
  expect(
    screen.getByPlaceholderText('settings.enterYourPassword')
  ).toBeVisible();
});
