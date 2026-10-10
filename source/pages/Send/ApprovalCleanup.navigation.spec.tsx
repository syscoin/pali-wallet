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
const mockAlarm = jest.fn();
let mockStorage: Record<string, any>;
let mockQuery: any;
let mockState: any;
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();

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
jest.mock('utils/alarmUtils', () => ({
  createTemporaryAlarm: (...args: any[]) => mockAlarm(...args),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/syscoinErrorSanitizer', () => ({
  sanitizeErrorMessage: (error: any) => error.message,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
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
const prepareSign = async () => {
  render(<Sign signOnly />);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockStorage = {};
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
