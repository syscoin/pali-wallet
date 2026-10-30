/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { SentryManagementFields } from './SentryManagementFields';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ((
        {
          'sentry.current': 'Current',
          'sentry.proposed': 'Proposed',
          'sentry.notSet': 'Not set',
          'sentry.managementFields.payoutAddress': 'Payout address',
          'sentry.managementFields.pqVotingPublicKey': 'PQ voting public key',
        } as Record<string, string>
      )[key] ||
      options?.defaultValue ||
      key),
  }),
}));

test('renders management fields with readable labels and empty optional values', () => {
  render(
    <SentryManagementFields
      fields={{
        previousPayoutAddress: 'tsys1previous',
        payoutAddress: 'tsys1next',
        previousPQVotingPublicKey: '',
        pqVotingPublicKey: '00abcd',
        futureFieldName: 'unchanged',
      }}
    />
  );

  expect(screen.getByText('Current: Payout address')).toBeInTheDocument();
  expect(screen.getByText('tsys1previous')).toBeInTheDocument();
  expect(screen.getByText('Proposed: Payout address')).toBeInTheDocument();
  expect(screen.getByText('tsys1next')).toBeInTheDocument();
  expect(screen.getByText('Current: PQ voting public key')).toBeInTheDocument();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  expect(screen.getByText('00abcd')).toBeInTheDocument();
  expect(screen.getByText('Future field name')).toBeInTheDocument();
  expect(screen.getByText('unchanged')).toBeInTheDocument();
  expect(screen.queryByText('previousPayoutAddress')).not.toBeInTheDocument();
});
