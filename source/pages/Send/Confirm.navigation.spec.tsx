/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { SendConfirm } from './Confirm';

const mockControllerEmitter = jest.fn();
const mockClearNavigationState = jest.fn();
const mockSaveNavigationState = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateBack = jest.fn();
let mockAuth: {
  connectionUnavailable: boolean;
  isLoading: boolean;
  isUnlocked: boolean;
};
let mockPublishedAuth: typeof mockAuth | undefined;
const mockAlert = { error: jest.fn(), success: jest.fn(), info: jest.fn() };
let mockLocation: any;
let mockEntry = 0;
let mockNavigationScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};

const mockState = {
  vault: {
    activeNetwork: { chainId: 57, currency: 'SYS' },
    isBitcoinBased: true,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          address: 'synthetic-sender',
          balances: { syscoin: '100' },
        },
      },
    },
    accountTransactions: {},
  },
  price: { fiat: { asset: 'USD' } },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: mockNavigate,
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockControllerEmitter,
    ...mockAuth,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockPublishedAuth || mockAuth,
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({ isEIP1559Compatible: false, forceRecheck: jest.fn() }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('./EditPriority', () => ({ EditPriorityModal: () => null }));
jest.mock('utils/index', () => ({
  clearNavigationState: () => mockClearNavigationState(),
  saveNavigationState: (...args: any[]) => mockSaveNavigationState(...args),
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  logError: jest.fn(),
  removeScientificNotation: (value: string) => value,
  omitTransactionObjectData: (value: any) => value,
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('utils/navigationState', () => {
  const actual = jest.requireActual('utils/navigationState');
  return {
    clearTransactionNavigationState: (...args: any[]) =>
      mockClearNavigationState(...args),
    getTransactionReturnContext: actual.getTransactionReturnContext,
    getWalletNavigationScope: () => mockNavigationScope,
    navigateBack: (...args: any[]) => mockNavigateBack(...args),
  };
});
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPublishedAuth = undefined;
  window.history.replaceState(null, '', '/');
  mockAuth = {
    connectionUnavailable: false,
    isLoading: false,
    isUnlocked: true,
  };
  mockNavigateBack.mockImplementation((navigate: any, location: any) => {
    const context = location.state?.returnContext;
    navigate(context?.returnRoute || '/home');
  });
  mockState.vault.isBitcoinBased = true;
  mockNavigationScope = {
    account: 'synthetic-account',
    network: 'synthetic-network',
  };
  mockLocation = {
    key: `entry-${++mockEntry}`,
    pathname: '/send/confirm',
    state: {
      submissionStarted: false,
      walletScope: mockNavigationScope,
      tx: {
        sender: 'synthetic-sender',
        receivingAddress: 'synthetic-recipient',
        amount: '1',
        fee: 0.00001,
        psbt: 'synthetic-psbt',
      },
      returnContext: {
        returnRoute: '/send/sys',
        walletScope: mockNavigationScope,
        state: { formValues: { amount: '1' } },
      },
    },
  };
  mockClearNavigationState.mockResolvedValue(undefined);
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    if (method === 'signSendAndSaveTransaction')
      return { txid: 'synthetic-txid' };
    return undefined;
  });
});

it.each([
  { state: undefined, isBitcoinBased: true },
  { state: null, isBitcoinBased: false },
  { state: {}, isBitcoinBased: false },
])(
  'returns an empty direct confirmation home without RPC calls: %j',
  ({ state, isBitcoinBased }) => {
    mockLocation.state = state;
    mockState.vault.isBitcoinBased = isBitcoinBased;

    render(<SendConfirm />);

    expect(mockNavigate).toHaveBeenCalledWith('/home');
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
    expect(mockSaveNavigationState).not.toHaveBeenCalled();
  }
);

it('does not persist a confirmation payload or erase the caller on idle unmount', () => {
  const view = render(<SendConfirm />);
  expect(screen.getByRole('button', { name: 'buttons.confirm' })).toBeTruthy();
  expect(mockSaveNavigationState).not.toHaveBeenCalled();
  expect(mockClearNavigationState).not.toHaveBeenCalled();
  view.unmount();
  expect(mockClearNavigationState).not.toHaveBeenCalled();
});

it('Cancel returns to the immediate unsigned draft without submitting', () => {
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, {
    state: { returnContext: mockLocation.state.returnContext },
  });
  expect(mockNavigate).toHaveBeenCalledWith('/send/sys');
  expect(mockControllerEmitter).not.toHaveBeenCalled();
});

it.each(['connectionUnavailable', 'isLoading'] as const)(
  'an idle %s trust check hides confirmation temporarily and recovers without discarding its draft',
  (trustField) => {
    const view = render(<SendConfirm />);
    mockAuth[trustField] = true;
    view.rerender(<SendConfirm />);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    mockAuth[trustField] = false;
    view.rerender(<SendConfirm />);
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
  }
);

it('a departed confirmation cannot override Back before React commits the draft route', () => {
  const view = render(<SendConfirm />);
  window.history.replaceState(
    { key: 'new-draft-entry' },
    '',
    '/app.html#/send/sys'
  );
  view.rerender(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
});

it('a late successful submission cannot replace a native caller departure with Home', async () => {
  let finishSend!: (value: any) => void;
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    return new Promise((resolve) => {
      finishSend = resolve;
    });
  });
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(finishSend).toBeDefined());
  mockNavigate.mockClear();
  window.history.replaceState(
    { key: 'new-caller-entry' },
    '',
    '/app.html#/settings/about'
  );
  view.rerender(<SendConfirm />);
  await act(async () => finishSend({ txid: 'synthetic-txid' }));
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockAlert.success).not.toHaveBeenCalled();
});

it.each(['connectionUnavailable', 'isLoading'] as const)(
  '%s during preparation permanently prevents broadcast after trust recovers',
  async (trustField) => {
    let finishPreparation!: (value: any) => void;
    mockControllerEmitter.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        })
    );
    const view = render(<SendConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(finishPreparation).toBeDefined());
    mockAuth[trustField] = true;
    view.rerender(<SendConfirm />);
    mockAuth[trustField] = false;
    view.rerender(<SendConfirm />);
    await act(async () => finishPreparation({ nativeBalance: '100' }));
    expect(mockControllerEmitter).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('/send/confirm', {
      replace: true,
      state: mockLocation.state,
    });
  }
);

it.each(['isLoading', 'connectionUnavailable'] as const)(
  'published %s before React commits blocks a prepared broadcast permanently',
  async (trustField) => {
    let finishPreparation!: (value: any) => void;
    mockControllerEmitter.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        })
    );
    const view = render(<SendConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(finishPreparation).toBeDefined());
    mockPublishedAuth = { ...mockAuth, [trustField]: true };
    await act(async () => finishPreparation({ nativeBalance: '100' }));
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'signSendAndSaveTransaction'
      )
    ).toHaveLength(0);
    mockPublishedAuth = { ...mockAuth };
    view.rerender(<SendConfirm />);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('/send/confirm', {
      replace: true,
      state: mockLocation.state,
    });
  }
);

it('an ambiguous attempt returns only to its public caller after trust recovers', async () => {
  mockLocation.state.returnContext.returnContext = {
    returnRoute: '/home?tab=activity',
    walletScope: mockNavigationScope,
    state: { tab: 'activity', tx: { psbt: 'private-history-payload' } },
  };
  let finishSend!: (value: any) => void;
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    return new Promise((resolve) => {
      finishSend = resolve;
    });
  });
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(finishSend).toBeDefined());
  mockAuth.connectionUnavailable = true;
  view.rerender(<SendConfirm />);
  mockAuth.connectionUnavailable = false;
  view.rerender(<SendConfirm />);
  expect(screen.getByRole('status').textContent).toBe(
    'send.submissionStatusUnknown'
  );
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(mockNavigate).toHaveBeenCalledWith('/home?tab=activity');
  const context = mockNavigateBack.mock.calls[0][1].state.returnContext;
  expect(JSON.stringify(context)).not.toContain('/send/sys');
  expect(JSON.stringify(context)).not.toContain('private-history-payload');
  await act(async () => finishSend({ txid: 'synthetic-txid' }));
  expect(mockAlert.success).not.toHaveBeenCalled();
});

it.each(['/send/confirm', '/external/tx/send/confirm'])(
  'discards persisted navigation before the first submission RPC on %s',
  async (pathname) => {
    mockLocation.pathname = pathname;
    let finishDiscard!: () => void;
    mockClearNavigationState.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDiscard = resolve;
        })
    );
    render(<SendConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    expect(mockClearNavigationState).toHaveBeenCalledTimes(1);
    expect(mockClearNavigationState).toHaveBeenCalledWith({
      requireDiscard: true,
      assertCurrent: expect.any(Function),
    });
    expect(mockControllerEmitter).not.toHaveBeenCalled();

    await act(async () => finishDiscard());
    await waitFor(() =>
      expect(mockControllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'signSendAndSaveTransaction'],
        [{ psbt: 'synthetic-psbt', isTrezor: undefined, isLedger: undefined }],
        30000
      )
    );
    expect(mockSaveNavigationState).not.toHaveBeenCalled();
  }
);

it('storage discard failure stays on the active confirmation with a recoverable error and zero RPC', async () => {
  mockClearNavigationState.mockRejectedValueOnce(
    new Error('Synthetic storage failure')
  );
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith('send.cantCompleteTxs')
  );
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalledWith('/home');
  expect(
    screen
      .getByRole('button', { name: 'buttons.confirm' })
      .hasAttribute('disabled')
  ).toBe(false);
  mockAuth.isLoading = true;
  view.rerender(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  mockAuth.isLoading = false;
  view.rerender(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(mockControllerEmitter).toHaveBeenCalled());
});

it('does not save a confirmation again when submission outcome is unknown', async () => {
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    throw new Error('Synthetic response lost after submission');
  });
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(mockClearNavigationState).toHaveBeenCalledTimes(1);
  expect(mockSaveNavigationState).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole('button', { name: 'buttons.confirm' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByRole('status').textContent).toBe(
    'send.submissionStatusUnknown'
  );
  expect(mockNavigate).toHaveBeenCalledWith('/send/confirm', {
    replace: true,
    state: {
      submissionStarted: true,
      walletScope: mockNavigationScope,
      returnContext: undefined,
    },
  });
});

it('removes transaction payload from history before RPC and rejects a duplicate pending attempt', async () => {
  let finishDiscard!: () => void;
  mockClearNavigationState.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishDiscard = resolve;
      })
  );
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(mockNavigate).toHaveBeenCalledWith('/send/confirm', {
    replace: true,
    state: {
      submissionStarted: true,
      walletScope: mockNavigationScope,
      returnContext: undefined,
    },
  });
  expect(
    screen
      .getByRole('button', { name: 'buttons.cancel' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  await act(async () => finishDiscard());
  await waitFor(() =>
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'signSendAndSaveTransaction'
      )
    ).toHaveLength(1)
  );
});

it('a marker recreated by native Forward or a new document cannot confirm again', () => {
  mockLocation.state = { submissionStarted: true };
  render(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('even an older consumed history entry cannot recreate an ambiguous confirmation', async () => {
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    throw new Error('Synthetic response lost after submission');
  });
  const first = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  first.unmount();
  mockControllerEmitter.mockClear();
  render(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('allows retry only after an explicitly safe pre-broadcast rejection', async () => {
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    throw Object.assign(new Error('Synthetic validation failure'), {
      transactionNotBroadcast: true,
    });
  });
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(
    screen
      .getByRole('button', { name: 'buttons.confirm' })
      .hasAttribute('disabled')
  ).toBe(false);
  expect(screen.queryByRole('status')).toBeNull();
  expect(mockNavigate).toHaveBeenCalledWith('/send/confirm', {
    replace: true,
    state: mockLocation.state,
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'signSendAndSaveTransaction'
      )
    ).toHaveLength(2)
  );
});

it('an early failure settling after departure cannot navigate back to confirmation', async () => {
  let rejectSend!: (error: Error) => void;
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    return new Promise((_, reject) => {
      rejectSend = reject;
    });
  });
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(rejectSend).toBeDefined());
  view.unmount();
  mockNavigate.mockClear();
  await act(async () =>
    rejectSend(
      Object.assign(new Error('Synthetic pre-broadcast failure'), {
        transactionNotBroadcast: true,
      })
    )
  );
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['account', 'network'])(
  'an idle confirmation exits when its %s scope changes',
  (field) => {
    const view = render(<SendConfirm />);
    mockNavigationScope = { ...mockNavigationScope, [field]: 'changed-scope' };
    view.rerender(<SendConfirm />);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  }
);

it('does not revive an unstamped legacy internal transaction entry', () => {
  delete mockLocation.state.walletScope;
  render(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('keeps authoritative external confirmation context compatible with an unstamped payload', () => {
  mockLocation.pathname = '/external/tx/send/confirm';
  delete mockLocation.state.walletScope;
  render(<SendConfirm />);
  expect(screen.getByRole('button', { name: 'buttons.confirm' })).toBeTruthy();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
});
