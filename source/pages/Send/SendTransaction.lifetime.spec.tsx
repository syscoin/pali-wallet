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
  render(<SendTransaction />);
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeDefined();
  });
  mockEmitter.mockClear();
  mockGet.mockClear();
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
