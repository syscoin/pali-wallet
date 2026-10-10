/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
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
      <button onClick={onClick} disabled={disabled}>
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
const mount = (smart = false) => {
  if (smart) {
    Object.assign(mockState.vault.accounts.HDAccount[0], {
      isSmartAccount: true,
      smartAccount: { chainId: 1 },
    });
  }
  render(<SendCalls />);
  expect(
    (screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
};
const expectDisabled = () => {
  expect(
    (screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.reject',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(mockClose);
  jest.spyOn(console, 'error').mockImplementation();
  const address = `0x${'1'.repeat(40)}`;
  mockState = {
    vault: {
      activeNetwork: { chainId: 1, currency: 'ETH' },
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
  mockEmitter.mockReset().mockImplementation(async ([, method]) => {
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
    mount(smart);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.reject' }));
    expectDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'send.sign' }));
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockSmartSubmit).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => cleanup.resolve());
    expect(mockClose).toHaveBeenCalledTimes(1);
    await act(async () => mockApprove());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockSmartSubmit).not.toHaveBeenCalled();
    expectDisabled();
  }
);

it.each([false, true])(
  'the synchronous Reject latch blocks stale Sign before React commits (smart=%s)',
  async (smart) => {
    const cleanup = deferred();
    mockCleanup.mockReturnValue(cleanup.promise);
    mount(smart);
    const approve = mockApprove;
    const reject = mockReject;
    let rejecting!: Promise<void>;
    await act(async () => {
      rejecting = reject();
      await approve();
      void reject();
    });
    expect(mockEmitter).not.toHaveBeenCalled();
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
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.reject' }));
  await act(async () => cleanup.reject(new Error('Storage unavailable')));
  await act(async () => mockApprove());
  expectDisabled();
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('Sign claims ownership before React commits, so a stale Reject cannot close it', async () => {
  const preparation = deferred();
  mockEmitter.mockReturnValue(preparation.promise);
  mount();
  const approve = mockApprove;
  const reject = mockReject;
  let approving!: Promise<void>;
  await act(async () => {
    approving = approve();
    await reject();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockCleanup).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => {
    preparation.reject(new Error('Preparation failed'));
    await approving;
  });
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockCleanup).not.toHaveBeenCalled();
});
