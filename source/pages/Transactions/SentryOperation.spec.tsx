/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import mockEnglish from 'assets/locales/en.json';

import SentryOperation from './SentryOperation';

const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockQuery = {
  sentryApprovalId: 'scoped-approval',
  host: 'https://sysnode.test',
  eventName: 'sentryOperationSigned',
};
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.startsWith('sentry.')
        ? key
            .split('.')
            .reduce((value: any, part: string) => value?.[part], mockEnglish) ||
          key
        : key,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    connectionUnavailable: false,
  }),
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: any[]) => mockDispatch(...args),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: ({ children, error }: any) => (
    <div>
      {error && <p role="alert">{error}</p>}
      {children}
    </div>
  ),
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));
const approval = {
  request: { operation: 'updateService', chain: { era: 'legacy-v3' } },
  id: 'scoped-approval',
  origin: 'https://sysnode.test',
  network: 'testnet',
  serviceUrl: 'https://trusted.test',
  keys: [{ id: 'local-key', label: 'Local operator' }],
  review: {
    operation: 'updateService',
    proTxHash: 'ab'.repeat(32),
    scheme: 'bls-basic',
    feeSatoshis: '1000',
    outputs: [],
    changes: {
      nevmAddress: { previous: '', next: '0x' + '12'.repeat(20) },
      service: { previous: '1.2.3.4:8369', next: '1.2.3.4:8369' },
      operatorPayoutScript: { previous: '00', next: '00' },
    },
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.sentryApprovalId = 'scoped-approval';
  mockEmitter.mockImplementation(async (methods) =>
    methods[1] === 'getSentryApproval'
      ? approval
      : { transactionHex: 'deadbeef' }
  );
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
it('does not forward an error-only or malformed authorization result to the dapp', async () => {
  mockEmitter.mockImplementation(async (methods) =>
    methods[1] === 'getSentryApproval'
      ? approval
      : { success: false, error: '' }
  );
  render(<SentryOperation />);
  await screen.findByText('0x' + '12'.repeat(20));
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Authorize update' }));
  await screen.findByRole('alert');
  expect(mockDispatch).not.toHaveBeenCalled();
});
it('reviews the background-verified NEVM diff and sends only opaque approval id, key id and password to signing', async () => {
  render(<SentryOperation />);
  expect(await screen.findByText('0x' + '12'.repeat(20))).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Authorize update' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'signSentryApproval'],
      [
        {
          id: 'scoped-approval',
          keyId: 'local-key',
          password: 'synthetic-password',
        },
      ],
      180000,
      false
    )
  );
  expect(mockDispatch).toHaveBeenCalledWith(
    'sentryOperationSigned.https://sysnode.test',
    { transactionHex: 'deadbeef' }
  );
});
it('refuses signing when no local key matches the registered operator', async () => {
  mockEmitter.mockResolvedValue({ ...approval, keys: [] });
  render(<SentryOperation />);
  await screen.findByText(/registered operator key is not in this wallet/);
  expect(
    screen
      .getByRole('button', { name: 'Authorize update' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(screen.queryByLabelText('Wallet password')).toBeNull();
});
it('shows clearing NEVM as an explicit registration removal', async () => {
  mockEmitter.mockResolvedValue({
    ...approval,
    review: {
      ...approval.review,
      changes: {
        ...approval.review.changes,
        nevmAddress: { previous: '0x' + '12'.repeat(20), next: '' },
      },
    },
  });
  render(<SentryOperation />);
  expect(await screen.findByText('Remove registration')).toBeTruthy();
});

it('ignores a late response from a retired approval route', async () => {
  let resolveOld!: (value: typeof approval) => void;
  mockEmitter.mockImplementation((_method, args) =>
    args[0] === 'scoped-approval'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({ ...approval, origin: 'https://new-node.test' })
  );
  const view = render(<SentryOperation />);
  mockQuery.sentryApprovalId = 'new-approval';
  view.rerender(<SentryOperation />);
  await screen.findByText('https://new-node.test');
  await act(async () => resolveOld(approval));
  expect(screen.getByText('https://new-node.test')).toBeTruthy();
  expect(screen.queryByText('https://sysnode.test')).toBeNull();
});
