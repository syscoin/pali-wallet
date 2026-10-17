/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import mockEnglish from 'assets/locales/en.json';

import SentryLink from './SentryLink';

const mockEmitter = jest.fn();
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
const mockDispatch = jest.fn();
const mockQuery = {
  sentryApprovalId: 'link-id',
  host: 'https://sysnode.test',
  eventName: 'sentryNodeLinked',
};
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    connectionUnavailable: false,
  }),
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: unknown[]) => mockDispatch(...args),
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
  id: 'link-id',
  origin: 'https://sysnode.test',
  network: 'testnet',
  serviceUrl: 'https://trusted.test',
  node: {
    proTxHash: 'ab'.repeat(32),
    service: '1.2.3.4:18369',
    nevmAddress: '0x' + 'cd'.repeat(20),
    collateralOutpoint: { txid: 'ef'.repeat(32), vout: 2 },
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(async (methods) =>
    methods[1] === 'getSentryLinkApproval'
      ? approval
      : { version: 1, linked: true, proTxHash: approval.node.proTxHash }
  );
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
it('does not report a failed background link as a successful dapp response', async () => {
  mockEmitter.mockImplementation(async (methods) =>
    methods[1] === 'getSentryLinkApproval'
      ? approval
      : { success: false, error: '' }
  );
  render(<SentryLink />);
  await screen.findByText(approval.node.proTxHash);
  fireEvent.click(screen.getByRole('button', { name: 'Link node' }));
  await screen.findByRole('alert');
  expect(mockDispatch).not.toHaveBeenCalled();
});
it('shows exact registered node and collateral before a public-only link approval', async () => {
  render(<SentryLink />);
  expect(
    await screen.findByText(`${approval.node.collateralOutpoint.txid}:2`)
  ).toBeTruthy();
  expect(screen.getByText(/No transaction is signed or sent/)).toBeTruthy();
  expect(screen.queryByLabelText('Wallet password')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Link node' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'approveSentryLink'],
      ['link-id'],
      45000,
      false
    )
  );
  expect(mockDispatch).toHaveBeenCalledWith(
    'sentryNodeLinked.https://sysnode.test',
    expect.objectContaining({ linked: true })
  );
});
it('does not approve or emit a successful link when verification fails', async () => {
  mockEmitter.mockRejectedValue(new Error('Wrong network genesis'));
  render(<SentryLink />);
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Link node' }).hasAttribute('disabled')
  ).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
});
