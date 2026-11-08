/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { SendCalls } from './SendCalls';

const mockEmitter = jest.fn();
const mockCleanup = jest.fn();
const mockSmartSubmit = jest.fn();
const mockClose = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
let mockState: any;
let mockQuery: any;
let mockApprove: () => Promise<void>;
let mockReject: () => Promise<void>;
const mockFeeReview = (transaction: any) => ({
  id: `fee-${transaction.nonce}-${transaction.to}`,
  transaction: {
    ...transaction,
    chainId: String(transaction.chainId),
    nonce: String(transaction.nonce),
    value: BigInt(transaction.value ?? '0x0').toString(),
    to: transaction.to ?? null,
    type: 0,
    gasLimit: '21000',
    gasPrice: '2',
  },
  maximumFeeUnits: '42000',
  maximumTotalUnits: (
    BigInt(transaction.value ?? '0x0') + BigInt(42000)
  ).toString(),
  validForMs: 90000,
});

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
  Button: ({ children, onClick, disabled, variant }: any) => {
    if (variant === 'primary') mockApprove = onClick;
    if (variant === 'secondary') mockReject = onClick;
    return (
      <button data-testid={variant} onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: () => mockCleanup(),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: async () => ({
    gasUnits: '860000',
    maximumFeeWei: '4300000',
  }),
  SMART_ACCOUNT_FEE_QUOTE_CHANGED: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
  isSmartAccountFeeQuoteChanged: (error: any) =>
    error?.message === 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED' &&
    error?.transactionNotBroadcast === true,
  signAndSubmitSmartAccountExecutions: (params: any) => mockSmartSubmit(params),
}));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const mount = async (smart = false) => {
  if (smart) {
    Object.assign(mockState.vault.accounts.HDAccount[0], {
      isSmartAccount: true,
      smartAccount: { chainId: 1 },
    });
  }
  render(<SendCalls />);
  await waitFor(() =>
    expect((screen.getByTestId('primary') as HTMLButtonElement).disabled).toBe(
      false
    )
  );
};
const expectDisabled = () => {
  expect((screen.getByTestId('primary') as HTMLButtonElement).disabled).toBe(
    true
  );
  expect((screen.getByTestId('secondary') as HTMLButtonElement).disabled).toBe(
    true
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(mockClose);
  jest.spyOn(console, 'error').mockImplementation();
  const address = `0x${'1'.repeat(40)}`;
  mockState = {
    vault: {
      activeNetwork: { chainId: 1, currency: 'ETH', url: 'rpc-a' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { id: 0, address } } },
    },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'sendCalls',
    bundleId: 'bundle-id',
    reservationId: 'reservation-id',
    chainId: '0x1',
    version: '2.0.0',
    atomicRequired: false,
    approvedContext: {
      account: { address, id: 0, type: 'HDAccount' },
      chainId: 1,
      rpcUrl: 'rpc-a',
      slip44: 60,
    },
    calls: [{ to: `0x${'2'.repeat(40)}` }],
  };
  mockCleanup.mockResolvedValue(undefined);
  mockEmitter.mockReset().mockImplementation(async ([, method], args) => {
    if (method === 'reviewDappEvmFee') return mockFeeReview(args[0]);
    if (method === 'discardNativeEvmFeeReview') return undefined;
    if (method === 'getRecommendedNonceForBatch') return 5;
    if (method === 'sendAndSaveEthTransaction')
      return { hash: `0x${'a'.repeat(64)}` };
    return undefined;
  });
  mockSmartSubmit.mockReset();
});
afterEach(() => jest.restoreAllMocks());

it.each([false, true])(
  'Reject disables both actions while cleanup waits, then blocks Sign (smart=%s)',
  async (smart) => {
    const cleanup = deferred();
    mockCleanup.mockReturnValue(cleanup.promise);
    await mount(smart);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.reject' }));
    expectDisabled();
    fireEvent.click(screen.getByTestId('primary'));
    expect(
      mockEmitter.mock.calls.filter(
        ([path, args]) =>
          path[1] === 'sendAndSaveEthTransaction' ||
          (path[1] === 'recordSendCallsBundle' && args[2].submissionStarted)
      )
    ).toHaveLength(0);
    expect(mockSmartSubmit).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => cleanup.resolve());
    expect(mockClose).toHaveBeenCalledTimes(1);
    await act(async () => mockApprove());
    expect(
      mockEmitter.mock.calls.filter(
        ([path, args]) =>
          path[1] === 'sendAndSaveEthTransaction' ||
          (path[1] === 'recordSendCallsBundle' && args[2].submissionStarted)
      )
    ).toHaveLength(0);
    expect(mockSmartSubmit).not.toHaveBeenCalled();
    expectDisabled();
  }
);

it.each([false, true])(
  'the synchronous Reject latch blocks stale Sign before React commits (smart=%s)',
  async (smart) => {
    const cleanup = deferred();
    mockCleanup.mockReturnValue(cleanup.promise);
    await mount(smart);
    const approve = mockApprove;
    const reject = mockReject;
    let rejecting!: Promise<void>;
    await act(async () => {
      rejecting = reject();
      await approve();
      void reject();
    });
    expect(
      mockEmitter.mock.calls.filter(
        ([path, args]) =>
          path[1] === 'sendAndSaveEthTransaction' ||
          (path[1] === 'recordSendCallsBundle' && args[2].submissionStarted)
      )
    ).toHaveLength(0);
    expect(mockSmartSubmit).not.toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
    expectDisabled();
    await act(async () => {
      cleanup.resolve();
      await rejecting;
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  }
);

it('cleanup failure keeps rejection terminal and closes without starting approval', async () => {
  const cleanup = deferred();
  mockCleanup.mockReturnValue(cleanup.promise);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.reject' }));
  await act(async () => cleanup.reject(new Error('Storage unavailable')));
  await act(async () => mockApprove());
  expectDisabled();
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.filter(
      ([path, args]) =>
        path[1] === 'sendAndSaveEthTransaction' ||
        (path[1] === 'recordSendCallsBundle' && args[2].submissionStarted)
    )
  ).toHaveLength(0);
});

it('Sign claims ownership before React commits, so a stale Reject cannot close it', async () => {
  const preparation = deferred();
  const initial = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'recordSendCallsBundle'
      ? preparation.promise
      : initial(path, args)
  );
  await mount();
  const approve = mockApprove;
  const reject = mockReject;
  let approving!: Promise<void>;
  await act(async () => {
    approving = approve();
    await reject();
  });
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path[1] === 'recordSendCallsBundle'
    )
  ).toHaveLength(1);
  expect(mockCleanup).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => {
    preparation.reject(new Error('Preparation failed'));
    await approving;
  });
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockCleanup).not.toHaveBeenCalled();
});
