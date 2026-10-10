/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import Sign from '../Transactions/Sign';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  getWalletNavigationScope,
  loadNavigationState,
  saveNavigationState,
} from 'utils/navigationState';

import { CallsStatus } from './CallsStatus';

const KEY = 'pali_navigation_state';
const POLICY = '/settings/account/smart-account-policy';
const mockEmitter = jest.fn();
const mockClose = jest.fn();
let mockSetTimeout: jest.SpyInstance;
let mockStorage: Record<string, any>;
let mockQuery: any;
let mockState: any;
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
let mockButtonHandlers: Record<string, () => any>;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockGet(...args),
    setItem: (...args: any[]) => mockSet(...args),
    removeItem: (...args: any[]) => mockRemove(...args),
  },
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/syscoinErrorSanitizer', () => ({
  sanitizeErrorMessage: (error: any) => error.message,
}));
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
  ErrorModal: ({ show, onClose }: any) =>
    show ? <button onClick={onClose}>Dismiss error</button> : null,
}));
jest.mock('components/Loading', () => ({ LoadingComponent: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: ({ onReviewStateChange }: any) => {
    React.useEffect(() => {
      onReviewStateChange(null);
    }, [onReviewStateChange]);
    return null;
  },
}));

const publicCaller = () => ({
  returnRoute: POLICY,
  state: {
    smartAccountPolicyView: 'recovery',
    policyParentScroll: 87,
    rawTransaction: 'never-copy-this',
  },
  scrollPositions: { 'smart-account-policy': 87 },
  walletScope: getWalletNavigationScope(),
});
const draft = async (caller = true) => {
  await saveNavigationState(
    '/send/eth',
    undefined,
    {
      formValues: { receiver: '0x' + '22'.repeat(20), amount: '3' },
      rawTransaction: 'discard-signed-payload',
      psbt: 'discard-psbt',
    },
    caller ? publicCaller() : undefined
  );
  expect(mockStorage[KEY].state.formValues.amount).toBe('3');
};
const prepareSign = async (signOnly = true) => {
  const view = render(<Sign signOnly={signOnly} />);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  return view;
};

const lastCloseTimer = (delay = 4000): (() => any) => {
  const calls = mockSetTimeout.mock.calls.filter(([, ms]) => ms === delay);
  const callback = calls[calls.length - 1]?.[0];
  if (typeof callback !== 'function') throw new Error('Missing close timer');
  return callback;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockSetTimeout = jest.spyOn(global, 'setTimeout');
  mockStorage = {};
  mockButtonHandlers = {};
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { id: 0, address: '0x' + '11'.repeat(20), xpub: 'public-xpub' },
        },
      },
      activeNetwork: { chainId: 1, slip44: 60, url: 'https://rpc.example' },
    },
    vaultGlobal: { activeSlip44: 60, advancedSettings: { autolock: 30 } },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'signPsbt',
    psbt: 'public-test-psbt',
    approvedContext: {},
  };
  mockGet.mockImplementation(async (key) => mockStorage[key] || null);
  mockSet.mockImplementation(async (key, value) => {
    mockStorage[key] = value;
  });
  mockRemove.mockImplementation(async (key) => {
    delete mockStorage[key];
  });
  jest.spyOn(window, 'close').mockImplementation(mockClose);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('status popup close preserves an ordinary Policy caller and scroll', async () => {
  await saveNavigationState(
    POLICY,
    undefined,
    publicCaller().state,
    undefined,
    publicCaller()
  );
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'showCallsStatus',
    callsStatus: {
      id: 'public-bundle',
      status: 200,
      chainId: '0x1',
      atomic: true,
      version: '2.0.0',
    },
  };
  render(<CallsStatus />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.close' }));
  await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
  const saved = await loadNavigationState();
  expect(saved?.currentPath).toBe(POLICY);
  expect(saved?.scrollPositions).toEqual({ 'smart-account-policy': 87 });
  expect(saved?.state.smartAccountPolicyView).toBe('recovery');
  expect(JSON.stringify(saved)).not.toContain('never-copy-this');
});

it.each(['cancel', 'error-close', 'success'])(
  'sign approval %s discards an unsigned Send draft and retains its validated public caller',
  async (mode) => {
    await draft();
    mockEmitter.mockImplementation(async () => {
      if (mode === 'error-close') throw new Error('signing refused');
      return 'public-test-response';
    });
    await prepareSign();
    if (mode === 'cancel')
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    else {
      fireEvent.click(screen.getByRole('button', { name: 'send.sign' }));
      if (mode === 'error-close')
        fireEvent.click(
          await screen.findByRole('button', { name: 'Dismiss error' })
        );
      else
        await act(async () => {
          await Promise.resolve();
          jest.advanceTimersByTime(2000);
          await Promise.resolve();
        });
    }
    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
    const saved = await loadNavigationState();
    expect(saved?.currentPath).toBe(POLICY);
    expect(saved?.state.formValues).toBeUndefined();
    expect(saved?.scrollPositions).toEqual({ 'smart-account-policy': 87 });
    expect(JSON.stringify(saved)).not.toMatch(
      /discard-signed-payload|discard-psbt|never-copy-this|formValues/
    );
  }
);

it('sign cancel removes a Send draft with no public caller instead of restoring a signing payload', async () => {
  await draft(false);
  await prepareSign();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
  expect(await loadNavigationState()).toBeNull();
  expect(mockStorage[KEY]).toBeUndefined();
});

it('waits for transaction cleanup to finish before closing the approval document', async () => {
  await draft();
  let finishRead!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      })
  );
  await prepareSign();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => {
    finishRead(snapshot);
  });
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockStorage[KEY].currentPath).toBe(POLICY);
});

it.each(['before render', 'after render'])(
  'sign cancellation blocks approval %s while storage cleanup is pending',
  async (phase) => {
    await draft();
    let finishRead!: (value: any) => void;
    const snapshot = mockStorage[KEY];
    mockGet.mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve))
    );
    await prepareSign();
    const cancel = mockButtonHandlers['buttons.cancel'];
    const sign = mockButtonHandlers['send.sign'];
    act(() => {
      void cancel();
      if (phase === 'before render') void sign();
    });
    if (phase === 'after render')
      fireEvent.click(screen.getByRole('button', { name: 'send.sign' }));
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.cancel',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => finishRead(snapshot));
    expect(mockClose).toHaveBeenCalledTimes(1);
    await act(async () => sign());
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('duplicate Sign cancellation shares one cleanup and one close', async () => {
  await draft();
  let finishRead!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet
    .mockClear()
    .mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve))
    );
  await prepareSign();
  const cancel = mockButtonHandlers['buttons.cancel'];
  act(() => {
    void cancel();
    void cancel();
  });
  expect(mockGet).toHaveBeenCalledTimes(1);
  await act(async () => finishRead(snapshot));
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('a stale Cancel callback cannot close a Sign submission already in flight', async () => {
  await draft();
  mockGet.mockClear();
  let finishSigning!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise((resolve) => (finishSigning = resolve))
  );
  await prepareSign();
  const cancel = mockButtonHandlers['buttons.cancel'];
  const sign = mockButtonHandlers['send.sign'];
  act(() => {
    void sign();
    void cancel();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => finishSigning('public-test-response'));
  await act(async () => cancel());
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it('failed Sign cancellation cleanup remains terminal', async () => {
  await draft();
  mockGet.mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
  await prepareSign();
  const cancel = mockButtonHandlers['buttons.cancel'];
  const sign = mockButtonHandlers['send.sign'];
  await act(async () => cancel());
  await act(async () => sign());
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  'an old Sign error timer cannot close a pending retry (signOnly=%s)',
  async (signOnly) => {
    await draft();
    mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
    let finishRetry!: (value: string) => void;
    mockEmitter.mockImplementationOnce(
      () => new Promise((resolve) => (finishRetry = resolve))
    );
    await prepareSign(signOnly);
    const sign = mockButtonHandlers[signOnly ? 'send.sign' : 'buttons.confirm'];
    await act(async () => sign());
    const oldTimer = lastCloseTimer();
    mockGet.mockClear();
    act(() => void sign());
    await act(async () => oldTimer());
    expect(mockEmitter).toHaveBeenCalledTimes(2);
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    await act(async () => finishRetry('retry-response'));
  }
);

it('only the latest failed Sign attempt owns its error exit', async () => {
  await draft();
  mockEmitter.mockRejectedValue(new Error('Device signing cancelled'));
  await prepareSign();
  const sign = mockButtonHandlers['send.sign'];
  await act(async () => sign());
  const firstTimer = lastCloseTimer();
  await act(async () => sign());
  const secondTimer = lastCloseTimer();
  mockGet.mockClear();
  await act(async () => firstTimer());
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockGet).not.toHaveBeenCalled();
  await act(async () => secondTimer());
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect((await loadNavigationState())?.currentPath).toBe(POLICY);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('an old Sign error cannot replace successful retry completion', async () => {
  await draft();
  mockEmitter
    .mockRejectedValueOnce(new Error('Device signing cancelled'))
    .mockResolvedValueOnce('retry-response');
  await prepareSign();
  const sign = mockButtonHandlers['send.sign'];
  await act(async () => sign());
  const oldTimer = lastCloseTimer();
  await act(async () => sign());
  mockGet.mockClear();
  await act(async () => oldTimer());
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockGet).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  const completion = lastCloseTimer(2000);
  await act(async () => completion());
  await act(async () => completion());
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'signPsbt.https://dapp.example',
    'retry-response'
  );
});

it('the current Sign error exit claims dismissal before delayed cleanup', async () => {
  await draft();
  mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
  await prepareSign();
  const sign = mockButtonHandlers['send.sign'];
  await act(async () => sign());
  const timer = lastCloseTimer();
  let finishRead!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet.mockImplementationOnce(
    () => new Promise((resolve) => (finishRead = resolve))
  );
  act(() => {
    void timer();
    void sign();
    void timer();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockClose).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => finishRead(snapshot));
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('a Sign error timer is inert after manual cancellation', async () => {
  await draft();
  mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
  await prepareSign();
  await act(async () => mockButtonHandlers['send.sign']());
  const timer = lastCloseTimer();
  await act(async () => mockButtonHandlers['buttons.cancel']());
  mockGet.mockClear();
  await act(async () => timer());
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('unmount invalidates a pending Sign error exit and retained Sign handler', async () => {
  await draft();
  mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
  const view = await prepareSign();
  const sign = mockButtonHandlers['send.sign'];
  await act(async () => sign());
  const timer = lastCloseTimer();
  view.unmount();
  mockGet.mockClear();
  await act(async () => {
    await timer();
    await sign();
    jest.advanceTimersByTime(4000);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it('unmount during Sign error cleanup cannot close a later page', async () => {
  await draft();
  mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
  const view = await prepareSign();
  await act(async () => mockButtonHandlers['send.sign']());
  let finishRead!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet.mockImplementationOnce(
    () => new Promise((resolve) => (finishRead = resolve))
  );
  act(() => void lastCloseTimer()());
  view.unmount();
  await act(async () => finishRead(snapshot));
  expect(mockClose).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('the current Sign error still exits after four seconds without a retry', async () => {
  await draft();
  mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
  await prepareSign();
  await act(async () => mockButtonHandlers['send.sign']());
  await act(async () => jest.advanceTimersByTime(3999));
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('failed timed Sign cleanup stays terminal and closes once', async () => {
  await draft();
  mockEmitter.mockRejectedValueOnce(new Error('Device signing cancelled'));
  await prepareSign();
  const sign = mockButtonHandlers['send.sign'];
  await act(async () => sign());
  const timer = lastCloseTimer();
  mockGet.mockRejectedValueOnce(new Error('Storage unavailable'));
  await act(async () => timer());
  await act(async () => {
    await timer();
    await sign();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it.each(['resolved', 'rejected'])(
  'unmounted Sign ignores a late %s signer result',
  async (result) => {
    await draft();
    let finish!: (value: string) => void;
    let fail!: (error: Error) => void;
    mockEmitter.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        })
    );
    const view = await prepareSign();
    let signing!: Promise<any>;
    act(() => {
      signing = mockButtonHandlers['send.sign']();
    });
    view.unmount();
    mockSetTimeout.mockClear();
    await act(async () => {
      if (result === 'resolved') finish('test-response');
      else fail(new Error('Device signing cancelled'));
      await signing;
      jest.advanceTimersByTime(4000);
    });
    expect(mockSetTimeout).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it('unmount during successful Sign cleanup cannot dispatch or close a later page', async () => {
  await draft();
  mockEmitter.mockResolvedValueOnce('test-response');
  const view = await prepareSign();
  await act(async () => mockButtonHandlers['send.sign']());
  let finishRead!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet.mockImplementationOnce(
    () => new Promise((resolve) => (finishRead = resolve))
  );
  act(() => void lastCloseTimer(2000)());
  view.unmount();
  await act(async () => finishRead(snapshot));
  expect(mockClose).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});
