/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { DeviceWaitingBanner } from './index';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it.each([
  [{ isLedgerWallet: true }, 'transactions.confirmOnDevice'],
  [{ isTrezorWallet: true }, 'transactions.confirmOnDevice'],
  [
    {
      isSmartAccount: true,
      smartAccount: { auth: { scheme: 'p256-webauthn' } },
    },
    'transactions.useYourPasskey',
  ],
])(
  'announces the requested out-of-app confirmation for %j',
  (account, title) => {
    const { rerender } = render(
      <DeviceWaitingBanner account={account} show={false} />
    );
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<DeviceWaitingBanner account={account} show />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(title);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    rerender(<DeviceWaitingBanner account={account} show={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  }
);

it('does not add device instructions for a regular key account', () => {
  render(<DeviceWaitingBanner account={{ isSmartAccount: false }} show />);
  expect(screen.queryByRole('status')).toBeNull();
});
