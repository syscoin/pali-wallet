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

import { dispatchBackgroundEvent } from 'utils/browser';

import { ChangeConnectedAccount } from './ChangeConnectedAccount';

const addressA = `0x${'1'.repeat(40)}`;
const addressB = `0x${'2'.repeat(40)}`;
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeAccount: { id: 1, type: 'HDAccount' },
        accounts: {
          HDAccount: {
            1: { id: 1, address: addressB, label: 'Active account' },
          },
        },
        isBitcoinBased: false,
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({
    host: 'https://fixture.invalid',
    eventName: 'changeActiveConnected',
    accountType: 'HDAccount',
    connectedAccount: {
      id: 0,
      address: addressA,
      label: 'Connected account',
    },
  }),
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountRef: (state: any) => state.vault.activeAccount,
  selectActiveAccount: (state: any) => state.vault.accounts.HDAccount[1],
  selectAccountAssets: () => ({}),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => <span>Fixture balance</span>,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => <span /> }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Icon: () => <span />,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const switchButton = () =>
  screen.getByRole('button', { name: 'connections.switchAccount' });
const cancelButton = () =>
  screen.getByRole('button', { name: 'buttons.cancel' });
let close: jest.SpyInstance;
let log: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
  close = jest.spyOn(window, 'close').mockImplementation(() => undefined);
  log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  close.mockRestore();
  log.mockRestore();
});

it('awaits the account acknowledgement before returning success and closing', async () => {
  const response = deferred();
  mockEmitter.mockReturnValueOnce(response.promise);
  render(<ChangeConnectedAccount />);
  fireEvent.click(switchButton());
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setAccount'],
    [0, 'HDAccount', true, addressA]
  );
  expect(close).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(switchButton()).toBeDisabled();
  expect(cancelButton()).toBeDisabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(switchButton());
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve());
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'changeActiveConnected.https://fixture.invalid',
    null
  );
  expect(close).toHaveBeenCalledTimes(1);
  expect(
    (dispatchBackgroundEvent as jest.Mock).mock.invocationCallOrder[0]
  ).toBeLessThan(close.mock.invocationCallOrder[0]);
});

it('cancels without selecting an account or acknowledging success', () => {
  render(<ChangeConnectedAccount />);
  fireEvent.click(cancelButton());
  expect(close).toHaveBeenCalledTimes(1);
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it.each([
  [
    'message',
    new Error('Wallet service unavailable'),
    'Wallet service unavailable',
  ],
  ['fallback', undefined, 'send.failed'],
])(
  'shows the current %s failure and clears it when retrying successfully',
  async (_kind, failure, expectedMessage) => {
    const first = deferred();
    const retry = deferred();
    mockEmitter
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render(<ChangeConnectedAccount />);
    fireEvent.click(switchButton());
    await act(async () => first.reject(failure));
    expect(close).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      expectedMessage as string
    );
    expect(cancelButton()).toBeEnabled();
    expect(switchButton()).toBeEnabled();
    fireEvent.click(switchButton());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockEmitter).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve());
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  }
);

it('keeps Cancel usable after failure without acknowledging the failed switch', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Account unavailable'));
  render(<ChangeConnectedAccount />);
  fireEvent.click(switchButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Account unavailable'
  );
  fireEvent.click(cancelButton());
  expect(close).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('shows stale account context without acknowledging success and allows cancellation', async () => {
  const message =
    'Account context changed. Please cancel and retry the request.';
  mockEmitter.mockRejectedValueOnce(new Error(message));
  render(<ChangeConnectedAccount />);
  fireEvent.click(switchButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setAccount'],
    [0, 'HDAccount', true, addressA]
  );
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(switchButton()).toBeEnabled();
  expect(cancelButton()).toBeEnabled();
  fireEvent.click(cancelButton());
  expect(close).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('keeps wrapped feedback in the measured action footer and renders only its message', async () => {
  const message = `Cannot switch using https://fixture.invalid/${'x'.repeat(
    120
  )}`;
  const error = new Error(message);
  error.stack = 'INTERNAL_STACK_SENTINEL';
  mockEmitter.mockRejectedValueOnce(error);
  render(<ChangeConnectedAccount />);
  fireEvent.click(switchButton());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(message);
  expect(screen.queryByText('INTERNAL_STACK_SENTINEL')).not.toBeInTheDocument();
  const footer = alert.closest('[data-page-action-footer]');
  expect(footer).not.toBeNull();
  expect(footer).toHaveClass('break-words');
  expect(footer).toContainElement(switchButton());
  expect(footer).toContainElement(cancelButton());
});
