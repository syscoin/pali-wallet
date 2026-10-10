/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { BigNumber } from 'utils/ethersV6Compat';
import { saveNavigationState } from 'utils/navigationState';

import { SendTransaction } from './SendTransaction';

const KEY = 'pali_navigation_state';
const mockEmitter = jest.fn();
const mockClose = jest.fn();
const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
const mockFee = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn(), info: jest.fn() };
let mockStorage: Record<string, any>;
let mockButtonHandlers: Record<string, () => any>;
let mockQuery: any;
let mockState: any;
let mockLocation: any;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockGet(...args),
    setItem: (...args: any[]) => mockSet(...args),
    removeItem: (...args: any[]) => mockRemove(...args),
  },
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/fetchGasAndDecodeFunction', () => ({
  fetchGasAndDecodeFunction: (...args: any[]) => mockFee(...args),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/logger', () => ({ logError: jest.fn() }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => {
    mockButtonHandlers[String(children)] = onClick;
    return (
      <button onClick={onClick} disabled={disabled || loading}>
        {children}
      </button>
    );
  },
  DeviceWaitingBanner: () => null,
  WarningModal: () => null,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('./components', () => ({
  ApprovalDetails: () => null,
  TransactionDetailsComponent: () => null,
  TransactionDataComponent: () => null,
  TransactionHexComponent: () => null,
}));
jest.mock('./EditApprovedAllowanceValueModal', () => ({
  EditApprovedAllowanceValueModal: () => null,
}));
jest.mock('./EditPriority', () => ({ EditPriorityModal: () => null }));

const prepare = async (external = true) => {
  mockQuery.external = external;
  await saveNavigationState('/send/eth', undefined, {
    formValues: { receiver: mockQuery.tx.to, amount: '1' },
  });
  const view = render(<SendTransaction />);
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeDefined();
  });
  mockEmitter.mockClear();
  mockGet.mockClear();
  return view;
};
const delayCleanup = () => {
  let resolve!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet.mockImplementationOnce(
    () => new Promise((finish) => (resolve = finish))
  );
  return () => resolve(snapshot);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage = {};
  mockButtonHandlers = {};
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: `0x${'11'.repeat(20)}`,
            balances: { ethereum: '1' },
          },
        },
      },
      activeNetwork: {
        chainId: 1,
        currency: 'ETH',
        url: 'https://rpc.example',
      },
    },
    vaultGlobal: { activeSlip44: 60, advancedSettings: { autolock: 30 } },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'sendTransaction',
    external: true,
    tx: {
      from: mockState.vault.accounts.HDAccount[0].address,
      to: `0x${'22'.repeat(20)}`,
      data: '0x',
      value: '0x0',
    },
    decodedTx: { method: 'transfer' },
    txMetadata: {},
  };
  mockLocation = {
    state: {
      tx: mockQuery.tx,
      decodedTx: mockQuery.decodedTx,
      txMetadata: {},
    },
  };
  mockGet.mockImplementation(async (key) => mockStorage[key] || null);
  mockSet.mockImplementation(async (key, value) => (mockStorage[key] = value));
  mockRemove.mockImplementation(async (key) => delete mockStorage[key]);
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '1' };
    if (method === 'sendAndSaveEthTransaction')
      return { hash: 'public-test-hash' };
    throw Error(`Unexpected method: ${method}`);
  });
  mockFee.mockImplementation(async () => ({
    feeDetails: {
      gasLimit: 21000,
      maxFeePerGas: 2,
      maxPriorityFeePerGas: 1,
    },
    formTx: { ...mockQuery.tx, gasLimit: BigNumber.from(21000) },
    nonce: 0,
    isInvalidTxData: false,
    gasLimitError: false,
  }));
  jest.spyOn(window, 'close').mockImplementation(mockClose);
});
afterEach(() => jest.restoreAllMocks());

it.each(['before render', 'after render'])(
  'SendTransaction cancellation blocks confirmation %s during cleanup',
  async (phase) => {
    await prepare();
    const finishCleanup = delayCleanup();
    const cancel = mockButtonHandlers['buttons.cancel'];
    const confirm = mockButtonHandlers['buttons.confirm'];
    act(() => {
      void cancel();
      if (phase === 'before render') void confirm();
    });
    if (phase === 'after render')
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    for (const name of ['buttons.cancel', 'buttons.confirm'])
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
      ).toBe(true);
    await act(async () => finishCleanup());
    expect(mockClose).toHaveBeenCalledTimes(1);
    await act(async () => confirm());
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each([true, false])(
  'duplicate SendTransaction cancellation performs one terminal exit (external=%s)',
  async (external) => {
    await prepare(external);
    const finishCleanup = delayCleanup();
    const cancel = mockButtonHandlers['buttons.cancel'];
    act(() => {
      void cancel();
      void cancel();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => finishCleanup());
    expect(mockClose).toHaveBeenCalledTimes(external ? 1 : 0);
    expect(mockNavigate).toHaveBeenCalledTimes(external ? 0 : 1);
    if (!external) expect(mockNavigate).toHaveBeenCalledWith('/home');
  }
);

it('a stale Cancel callback cannot close an active SendTransaction submission', async () => {
  await prepare();
  let finishRefresh!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise((resolve) => (finishRefresh = resolve))
  );
  mockEmitter.mockImplementationOnce(() => new Promise(() => undefined));
  const cancel = mockButtonHandlers['buttons.cancel'];
  const confirm = mockButtonHandlers['buttons.confirm'];
  act(() => {
    void confirm();
    void cancel();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => finishRefresh({ nativeBalance: '1' }));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'sendAndSaveEthTransaction'],
    expect.any(Array),
    10000
  );
  await act(async () => cancel());
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it('SendTransaction cancellation stays terminal after a storage read failure', async () => {
  await prepare();
  mockGet.mockRejectedValueOnce(new Error('Storage unavailable'));
  const cancel = mockButtonHandlers['buttons.cancel'];
  const confirm = mockButtonHandlers['buttons.confirm'];
  await act(async () => cancel());
  await act(async () => confirm());
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('an unchanged SendTransaction approval still submits and closes after cleanup', async () => {
  jest.useFakeTimers();
  try {
    await prepare();
    const cancel = mockButtonHandlers['buttons.cancel'];
    const confirm = mockButtonHandlers['buttons.confirm'];
    await act(async () => confirm());
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'sendAndSaveEthTransaction'],
      expect.any(Array),
      10000
    );
    await act(async () => cancel());
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

describe('SendTransaction error close lifetimes', () => {
  let timeouts: jest.SpyInstance;
  let clearTimeouts: jest.SpyInstance;
  const closeTimer = (delay: number) => {
    let index = timeouts.mock.calls.length - 1;
    while (index >= 0 && timeouts.mock.calls[index][1] !== delay) index--;
    expect(index).toBeGreaterThanOrEqual(0);
    return {
      callback: timeouts.mock.calls[index][0] as () => Promise<void> | void,
      id: timeouts.mock.results[index].value,
    };
  };
  const refuseForInsufficientFunds = async () => {
    mockEmitter.mockResolvedValueOnce({ nativeBalance: '0' });
    await act(async () => mockButtonHandlers['buttons.confirm']());
    return closeTimer(2000);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    timeouts = jest.spyOn(globalThis, 'setTimeout');
    clearTimeouts = jest.spyOn(globalThis, 'clearTimeout');
  });
  afterEach(() => jest.useRealTimers());

  it.each(['insufficient funds', 'submission error'])(
    'invalidates a prior %s close while a retry is in flight',
    async (failure) => {
      await prepare();
      let timer: ReturnType<typeof closeTimer>;
      if (failure === 'insufficient funds') {
        timer = await refuseForInsufficientFunds();
      } else {
        mockEmitter
          .mockResolvedValueOnce({ nativeBalance: '1' })
          .mockRejectedValueOnce(Error('RPC refused'));
        await act(async () => mockButtonHandlers['buttons.confirm']());
        timer = closeTimer(4000);
      }
      mockEmitter
        .mockClear()
        .mockImplementationOnce(() => new Promise(() => undefined));
      act(() => {
        void mockButtonHandlers['buttons.confirm']();
      });
      mockGet.mockClear();
      await act(async () => timer.callback());
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
      expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    }
  );

  it('a first error cannot close the lifetime of a failed retry', async () => {
    await prepare();
    const first = await refuseForInsufficientFunds();
    const second = await refuseForInsufficientFunds();
    mockGet.mockClear();
    await act(async () => first.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(clearTimeouts).toHaveBeenCalledWith(first.id);
    await act(async () => second.callback());
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('an eligible error timer claims dismissal before cleanup can race a retry', async () => {
    await prepare();
    const timer = await refuseForInsufficientFunds();
    const finishCleanup = delayCleanup();
    const confirm = mockButtonHandlers['buttons.confirm'];
    mockEmitter.mockClear();
    let closing: Promise<void> | void;
    act(() => {
      closing = timer.callback();
      void confirm();
    });
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => {
      finishCleanup();
      await closing;
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('manual cancellation invalidates an exposed error timer callback', async () => {
    await prepare();
    const timer = await refuseForInsufficientFunds();
    await act(async () => mockButtonHandlers['buttons.cancel']());
    expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    expect(mockClose).toHaveBeenCalledTimes(1);
    mockGet.mockClear();
    await act(async () => timer.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('unmount invalidates an exposed error timer callback', async () => {
    const view = await prepare();
    const timer = await refuseForInsufficientFunds();
    view.unmount();
    expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    mockGet.mockClear();
    await act(async () => timer.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('unmount during error cleanup prevents its late close', async () => {
    const view = await prepare();
    const timer = await refuseForInsufficientFunds();
    mockGet.mockClear();
    const finishCleanup = delayCleanup();
    let closing: Promise<void> | void;
    act(() => {
      closing = timer.callback();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      finishCleanup();
      await closing;
    });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('an eligible error timeout still closes at its existing deadline', async () => {
    await prepare();
    await refuseForInsufficientFunds();
    await act(async () => {
      jest.advanceTimersByTime(1999);
    });
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it.each(['resolved', 'rejected'])(
    'unmount prevents a late %s submission from scheduling a close',
    async (result) => {
      const view = await prepare();
      let finish!: (value: any) => void;
      let fail!: (error: Error) => void;
      mockEmitter
        .mockResolvedValueOnce({ nativeBalance: '1' })
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finish = resolve;
              fail = reject;
            })
        );
      let submitting!: Promise<any>;
      await act(async () => {
        submitting = mockButtonHandlers['buttons.confirm']();
        await Promise.resolve();
      });
      view.unmount();
      timeouts.mockClear();
      await act(async () => {
        if (result === 'resolved') finish({ hash: 'public-test-hash' });
        else fail(Error('RPC refused'));
        await submitting;
        jest.advanceTimersByTime(4000);
      });
      expect(timeouts).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    }
  );

  it('a fee estimation error close cannot interrupt a new confirmation attempt', async () => {
    const view = await prepare();
    mockFee.mockRejectedValueOnce(Error('fee estimate failed'));
    mockQuery.tx = { ...mockQuery.tx, to: `0x${'33'.repeat(20)}` };
    view.rerender(<SendTransaction />);
    await waitFor(() => {
      expect(mockAlert.error).toHaveBeenCalledWith(
        'send.txWillFail',
        expect.any(Error)
      );
    });
    const timer = closeTimer(3000);
    mockEmitter.mockImplementationOnce(() => new Promise(() => undefined));
    act(() => {
      void mockButtonHandlers['buttons.confirm']();
    });
    expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    mockGet.mockClear();
    await act(async () => timer.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
