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

import { SendCalls } from './SendCalls';

const mockQuote = jest.fn();
const mockSubmit = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
let mockState: any;
let mockQuery: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: (params: any) => mockQuote(params),
  signAndSubmitSmartAccountExecutions: (params: any) => mockSubmit(params),
  SMART_ACCOUNT_FEE_QUOTE_CHANGED: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
  isSmartAccountFeeQuoteChanged: (error: any) =>
    error?.message === 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED' &&
    error?.transactionNotBroadcast === true,
}));

const address = '0x' + '11'.repeat(20);
const sign = () =>
  screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement;
const quote = (maximumFeeWei = '4300000000000000') => ({
  gasUnits: '860000',
  maximumFeeWei,
});
const ready = () => waitFor(() => expect(sign().disabled).toBe(false));
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, url: 'rpc-a', currency: 'TSYS' },
      accounts: {
        SmartAccount: {
          19: {
            id: 19,
            address,
            isSmartAccount: true,
            smartAccount: { chainId: 57057 },
          },
        },
      },
    },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'sendCalls',
    bundleId: 'bundle',
    reservationId: 'reservation',
    chainId: '0xdee1',
    version: '2.0.0',
    atomicRequired: false,
    approvedContext: {
      account: { address, type: 'SmartAccount', id: 19 },
      chainId: 57057,
      rpcUrl: 'rpc-a',
      slip44: 57,
    },
    calls: [
      { to: '0x' + '22'.repeat(20), data: '0x1234', value: '0x1' },
      { to: '0x' + '33'.repeat(20), value: '0x0' },
    ],
  };
  mockQuote.mockResolvedValue(quote());
  mockSubmit.mockRejectedValue(new Error('Authenticator unavailable'));
  mockEmitter.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it('shows full EntryPoint maximum and binds exact batch at signing', async () => {
  render(<SendCalls />);
  await ready();
  expect(screen.getByText('0.0043 TSYS')).toBeTruthy();
  expect(screen.getByText('send.smartAccountFeeDetails')).toBeTruthy();
  fireEvent.click(sign());
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  expect(mockSubmit.mock.calls[0][0]).toMatchObject({
    executions: [
      { target: mockQuery.calls[0].to, data: '0x1234', value: '0x1' },
      { target: mockQuery.calls[1].to, data: '0x', value: '0x0' },
    ],
    maximumUserOpFeeWei: '4300000000000000',
    expectedContext: mockQuery.approvedContext,
  });
});

it('blocks approval until preparation succeeds and accepts genuine tank zero', async () => {
  let resolve!: (value: any) => void;
  mockQuote.mockReturnValue(
    new Promise((res) => {
      resolve = res;
    })
  );
  render(<SendCalls />);
  expect(sign().disabled).toBe(true);
  fireEvent.click(sign());
  expect(mockSubmit).not.toHaveBeenCalled();
  await act(async () => resolve(quote('0')));
  await ready();
  expect(screen.getByText('0.0 TSYS')).toBeTruthy();
});

it('keeps every call in a refreshed quote and ignores an obsolete in-flight response', async () => {
  let resolve!: (value: any) => void;
  mockQuote
    .mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      })
    )
    .mockResolvedValue(quote('123'));
  const view = render(<SendCalls />);
  await waitFor(() => expect(mockQuote).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(
    true
  );
  expect(mockQuote).toHaveBeenCalledTimes(1);
  mockState.vault.accounts.SmartAccount[19].smartAccount.installedModules = [];
  view.rerender(<SendCalls />);
  await ready();
  expect(mockQuote.mock.calls[1][0].executions).toHaveLength(2);
  await act(async () => resolve(quote('999999999999999999')));
  fireEvent.click(sign());
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  expect(mockSubmit.mock.calls[0][0].maximumUserOpFeeWei).toBe('123');
  expect(mockSubmit.mock.calls[0][0].executions).toHaveLength(2);
});

it('requires explicit fee refresh and a new approval after a fresh quote grows', async () => {
  mockSubmit.mockRejectedValue(
    Object.assign(new Error('PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED'), {
      transactionNotBroadcast: true,
    })
  );
  render(<SendCalls />);
  await ready();
  fireEvent.click(sign());
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'send.refreshFeeQuote' })
    ).toBeTruthy()
  );
  expect(sign().disabled).toBe(true);
  expect(mockQuote).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.some(
      ([methods]) => methods[1] === 'recordSendCallsBundle'
    )
  ).toBe(false);
  mockQuote.mockResolvedValue(quote('5000000000000000'));
  fireEvent.click(screen.getByRole('button', { name: 'send.refreshFeeQuote' }));
  await ready();
  expect(screen.getByText('0.005 TSYS')).toBeTruthy();
  expect(mockSubmit).toHaveBeenCalledTimes(1);
});

it('surfaces a preparation failure without signing and permits explicit retry', async () => {
  mockQuote.mockRejectedValue(new Error('No validated fee data'));
  render(<SendCalls />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'send.refreshFeeQuote' })
    ).toBeTruthy()
  );
  expect(sign().disabled).toBe(true);
  expect(screen.getByText('send.feeUnavailable')).toBeVisible();
  expect(screen.queryByText('send.calculating')).not.toBeInTheDocument();
  expect(mockSubmit).not.toHaveBeenCalled();
  mockQuote.mockResolvedValue(quote());
  fireEvent.click(screen.getByRole('button', { name: 'send.refreshFeeQuote' }));
  await ready();
  expect(screen.queryByText('send.feeUnavailable')).not.toBeInTheDocument();
});

it('does not introduce AA preparation into the existing EOA route', async () => {
  mockState.vault.accounts.SmartAccount[19].isSmartAccount = false;
  render(<SendCalls />);
  await ready();
  expect(mockQuote).not.toHaveBeenCalled();
  expect(screen.queryByText('send.smartAccountMaxFee')).toBeNull();
});

it('resolves ENS once for approval and signs the exact reviewed address', async () => {
  mockQuery.calls = [{ to: 'owned.eth', value: '0x1' }];
  mockEmitter.mockResolvedValue('0x' + '44'.repeat(20));
  render(<SendCalls />);
  await ready();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'resolveEns'],
    ['owned.eth']
  );
  fireEvent.click(sign());
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  expect(mockSubmit.mock.calls[0][0].executions).toEqual([
    { target: '0x' + '44'.repeat(20), value: '0x1', data: '0x' },
  ]);
  expect(
    mockEmitter.mock.calls.filter(([methods]) => methods[1] === 'resolveEns')
  ).toHaveLength(1);
});

it.each(['chain', 'RPC'])(
  'invalidates the approved maximum after %s changes without another signing call',
  async (field) => {
    const view = render(<SendCalls />);
    await ready();
    if (field === 'chain') mockState.vault.activeNetwork.chainId = 1;
    else mockState.vault.activeNetwork.url = 'rpc-other';
    view.rerender(<SendCalls />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'send.refreshFeeQuote' })
      ).toBeTruthy()
    );
    expect(sign().disabled).toBe(true);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockQuote).toHaveBeenCalledTimes(1);
  }
);

it('invalidates the quote immediately when the selected wallet account changes', async () => {
  const view = render(<SendCalls />);
  await ready();
  mockQuote.mockReturnValue(new Promise(() => undefined));
  mockState.vault.activeAccount = { type: 'SmartAccount', id: 31 };
  view.rerender(<SendCalls />);
  expect(sign().disabled).toBe(true);
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockQuote).toHaveBeenCalledTimes(2);
});

it.each([undefined, false, true])(
  'does not turn a post-publication same-message error into a fee refresh (%s)',
  async (transactionNotBroadcast) => {
    mockSubmit.mockImplementation(async (params) => {
      await params.onBeforeSubmit();
      throw Object.assign(new Error('PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED'), {
        transactionNotBroadcast,
      });
    });
    render(<SendCalls />);
    await ready();
    fireEvent.click(sign());
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(
      'send.submissionStatusUnknown'
    );
    expect(sign().disabled).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'send.refreshFeeQuote' })
    ).toBeNull();
    fireEvent.click(sign());
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  }
);
