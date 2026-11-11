/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import {
  CHROME_WALLET_STORE_URL,
  type WalletUpdateSnapshot,
} from '../hooks/useWalletUpdate';

import { WalletUpdateBadge } from './WalletUpdateBadge';
import { WalletUpdatePanel, WalletUpdateSummary } from './WalletUpdatePanel';

const mockCheck = jest.fn();
let mockUpdate: {
  -readonly [Key in keyof WalletUpdateSnapshot]: WalletUpdateSnapshot[Key];
};
jest.mock('hooks/useWalletUpdate', () => ({
  ...jest.requireActual('hooks/useWalletUpdate'),
  useWalletUpdate: () => ({ ...mockUpdate, check: mockCheck }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key
        .split('.')
        .reduce(
          (value: any, part) => value?.[part],
          jest.requireActual('../assets/locales/en.json')
        ) ?? key,
  }),
}));

beforeEach(() => {
  mockCheck.mockReset();
  mockUpdate = {
    status: 'idle',
    release: null,
    lastAttemptAt: null,
    lastCheckedAt: null,
    error: null,
    browserStatus: 'idle',
    installedVersion: '1.0.0',
    pendingVersion: null,
  };
});

it('offers a keyboardable manual check and the fixed store destination', () => {
  render(<WalletUpdatePanel />);
  const check = screen.getByRole('button', { name: 'Check for updates' });
  check.focus();
  expect(check).toHaveFocus();
  fireEvent.click(check);
  expect(mockCheck).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('link', { name: 'Open Chrome Web Store' })
  ).toHaveAttribute('href', CHROME_WALLET_STORE_URL);
  expect(screen.queryByText('No newer published version found.')).toBeNull();
});

it('keeps About compact until its version and status entry is opened', () => {
  const open = jest.fn();
  render(<WalletUpdateSummary onOpen={open} />);
  const summary = screen.getByRole('button');
  expect(summary).toHaveTextContent('1.0.0');
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByText('Check for updates')).toBeNull();
  fireEvent.click(summary);
  expect(open).toHaveBeenCalledTimes(1);
});

it('does not call unavailable metadata up to date even when Chrome returns no update', () => {
  mockUpdate.status = 'error';
  mockUpdate.error = 'unavailable';
  mockUpdate.browserStatus = 'no-update';
  render(<WalletUpdatePanel />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Release information is unavailable'
  );
  expect(screen.queryByText('No newer published version found.')).toBeNull();
});

it('does not claim a current version while Chrome checking is unavailable', () => {
  mockUpdate.status = 'ready';
  mockUpdate.browserStatus = 'unavailable';
  render(<WalletUpdatePanel />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Release information is unavailable'
  );
  expect(screen.queryByText('No newer published version found.')).toBeNull();
});

it('shows bounded publisher severity and notes with installed and latest versions', () => {
  mockUpdate.status = 'ready';
  mockUpdate.release = {
    platform: 'chrome',
    version: '1.1.0',
    severity: 'important',
    title: 'Wallet update',
    summary: 'Improved wallet reliability.',
    publishedAt: '2026-01-01T00:00:00Z',
    releaseNotesUrl:
      'https://github.com/syscoin/pali-wallet/releases/tag/v1.1.0',
    availability: { status: 'published' },
  };
  render(
    <>
      <WalletUpdatePanel />
      <WalletUpdateBadge />
    </>
  );
  expect(screen.getAllByText('Update available')).toHaveLength(3);
  expect(screen.getByText('Important update')).toBeVisible();
  expect(screen.getByText('Improved wallet reliability.')).toBeVisible();
  expect(screen.getByText('1.0.0')).toBeVisible();
  expect(screen.getByText('1.1.0')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  );
  expect(
    screen.queryByRole('button', { name: /reload|restart|install now/i })
  ).toBeNull();
});

it('keeps a downloaded-update badge when a later feed refresh is unavailable', () => {
  mockUpdate.status = 'error';
  mockUpdate.error = 'unavailable';
  mockUpdate.pendingVersion = '1.1.0';
  render(
    <>
      <WalletUpdatePanel />
      <WalletUpdateBadge />
    </>
  );
  expect(screen.getAllByText('Update available')).toHaveLength(3);
  expect(screen.getByText('1.1.0')).toBeVisible();
  expect(
    screen.getByText('Release information is unavailable. Try again later.')
  ).toBeVisible();
});

it('distinguishes a newer Chrome download from the published release metadata', () => {
  mockUpdate.status = 'ready';
  mockUpdate.pendingVersion = '4.2.0';
  mockUpdate.release = {
    platform: 'chrome',
    version: '4.1.0',
    severity: 'routine',
    title: 'Published update',
    summary: 'Published changes.',
    publishedAt: '2026-01-01T00:00:00Z',
    releaseNotesUrl:
      'https://github.com/syscoin/pali-wallet/releases/tag/v4.1.0',
    availability: { status: 'published' },
  };
  render(<WalletUpdatePanel />);
  expect(screen.getByText('Latest published:').parentElement).toHaveTextContent(
    '4.1.0'
  );
  expect(screen.getByText('Ready to install:').parentElement).toHaveTextContent(
    '4.2.0'
  );
});
