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

import { SendConfirm } from 'pages/Send/Confirm';
import { getController } from 'scripts/Background';
import { controllerEmitter as realControllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import MainController from 'scripts/Background/controllers/MainController';
import { handleMasterControllerResponses } from 'scripts/Background/handlers/handleMasterControllerResponses';
import { blacklistService } from 'utils/security/blacklistService';

// The real wallet, controller message handler and emitter run locally; only
// sender authorization, loaded-list contents and SDK submission are faked.
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { notifyTransaction: jest.fn() },
}));
jest.mock('utils/syscoinPsbtValues', () => ({
  getVerifiedSyscoinPsbtValueSummary: () => {
    throw new Error('unexpected UTXO fixture path');
  },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('scripts/Background/handlers/internalMessageAuthorization', () => ({
  isTrustedExtensionPageSender: () => true,
}));
jest.mock('scripts/Background/handlers/approvalSubmission', () => ({
  beginApprovalSubmission: () => () => undefined,
}));
let mockWallet: any;
let mockListener: any;
const mockSdkSend = jest.fn();
const syntheticRecipient = '0x2222222222222222222222222222222222222222';
const mockTokenReplies: any[] = [];

let mockTransportOutcome: 'success' | 'pre-broadcast' | 'ambiguous' = 'success';
const mockMessages: any[] = [];
let mockEIP1559 = true;
let mockRefreshedBalance = '100';
const mockAlertError = jest.fn();
const mockEmitter = jest.fn();
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};
const mockLocation: any = {
  key: 'fee-readiness-entry',
  pathname: '/send/confirm',
  state: {
    submissionStarted: false,
    walletScope: mockScope,
    tx: {
      sender: '0x1111111111111111111111111111111111111111',
      receivingAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
      transactionType: 'NATIVE_ETH',
      defaultGasLimit: 42000,
    },
    returnContext: { returnRoute: '/send/eth', walletScope: mockScope },
  },
};
const mockState = {
  vault: {
    activeNetwork: {
      kind: 'ethereum',
      chainId: 5700,
      currency: 'TSYS',
      url: 'https://rpc.invalid',
    },
    isBitcoinBased: false,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          address: '0x1111111111111111111111111111111111111111',
          balances: { ethereum: '100' },
        },
      },
    },
    accountTransactions: {},
  },
  vaultGlobal: { activeSlip44: 60 },
  price: { fiat: { asset: 'USD' } },
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: { error: mockAlertError, success: jest.fn(), info: jest.fn() },
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockAuth }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockAuth,
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({
    isEIP1559Compatible: mockEIP1559,
    forceRecheck: jest.fn(),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: ({ name }: any) => <span>{name}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('pages/Send/components', () => ({ PriorityBar: () => null }));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  logError: jest.fn(),
  removeScientificNotation: (value: any) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(value),
  omitTransactionObjectData: (value: any) => value,
  extractErrorMessage: (error: any, fallback: string) =>
    error?.message || fallback,
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(),
  getTransactionReturnContext: () => mockLocation.state.returnContext,
  getWalletNavigationScope: () => mockScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  paliEntryPointInterface: jest.requireActual('utils/smartAccount/contracts')
    .paliEntryPointInterface,
  getPaliEntryPointAddress: jest.requireActual('utils/smartAccount/contracts')
    .getPaliEntryPointAddress,
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: jest.fn(),
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: jest.fn(),
  getErc721Abi: jest.fn(),
  getErc1155Abi: jest.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout.
    }
    unobserve() {
      // JSDOM has no layout.
    }
    disconnect() {
      // JSDOM has no layout.
    }
  } as typeof ResizeObserver;
  (globalThis as any).MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  };
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  mockLocation.key += '-next';
  mockEIP1559 = true;
  mockTransportOutcome = 'success';
  mockMessages.length = 0;
  mockTokenReplies.length = 0;
  (chrome.runtime as any).id = 'synthetic-extension';
  jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: any,
    callback: (value: unknown) => void
  ) => {
    mockMessages.push(message);
    const method = message.data.methods.at(-1);
    if (method === 'getTxGasLimit') return callback(21000);
    if (method === 'getRecommendedGasPrice') return callback('3000000000');
    if (method === 'refreshActiveAccountBalances')
      return callback({ nativeBalance: mockRefreshedBalance });
    if (method === 'sendAndSaveEthTransaction') {
      if (mockTransportOutcome === 'success')
        return callback({ hash: `0x${'11'.repeat(32)}` });
      return callback({
        success: false,
        error: {
          message: 'insufficient funds for gas * price + value',
          transactionNotBroadcast: mockTransportOutcome === 'pre-broadcast',
        },
      });
    }
    if (method === 'sendAndSaveTokenTransaction')
      return mockListener(
        message,
        { id: 'synthetic-extension' },
        (reply: any) => {
          mockTokenReplies.push(reply);
          callback(reply);
        }
      );
    throw new Error(`Unexpected synthetic controller call: ${method}`);
  }) as any);
  mockWallet = Object.create(MainController.prototype);
  mockWallet.walletSessionGeneration = 7;
  mockWallet.getActiveKeyring = jest.fn(() => ({
    isUnlocked: () => true,
    ethereumTransaction: { sendSignedErc20Transaction: mockSdkSend },
  }));
  mockWallet.sendAndSaveTransaction = jest.fn(async () => undefined);
  mockWallet.sendAndSaveTokenTransaction =
    mockWallet.sendAndSaveTokenTransaction.bind(mockWallet);
  (getController as jest.Mock).mockReturnValue({ wallet: mockWallet });
  mockSdkSend
    .mockReset()
    .mockResolvedValue({ hash: `0x${'44'.repeat(32)}`, nonce: 7 });
  // Load only disposable fixture addresses into the real in-memory service;
  // mark it fresh so its normal check cannot initiate a list fetch.
  const list = blacklistService as any;
  list.addressBlacklist = new Map([
    [
      '0x5555555555555555555555555555555555555555',
      'unrelated synthetic list entry',
    ],
  ]);
  list.urlBlacklist = new Map();
  list.lastFetch = Date.now();
  list.isFetching = false;
  jest
    .spyOn(list.axiosInstance, 'get')
    .mockRejectedValue(new Error('unexpected blacklist network'));
  jest.spyOn(blacklistService, 'checkAddress');
  jest
    .spyOn(chrome.runtime.onMessage, 'addListener')
    .mockImplementation((listener: any) => {
      mockListener = listener;
    });
  jest
    .spyOn(chrome.runtime.onMessage, 'removeListener')
    .mockImplementation(() => undefined);
  handleMasterControllerResponses({ wallet: mockWallet } as any);
  expect(mockListener).toBeDefined();
  mockRefreshedBalance = '100';
  mockScope.network = 'synthetic-network';
  mockState.vault.accounts.HDAccount[0].balances.ethereum = '100';
  mockLocation.state.tx.amount = '1';
  mockLocation.state.tx.isMax = false;
  delete mockLocation.state.tx.cachedGasData;
});
afterEach(() => {
  expect((blacklistService as any).axiosInstance.get).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getTxGasLimit',
        'refreshActiveAccountBalances',
        'sendAndSaveEthTransaction',
        'sendAndSaveTokenTransaction',
        'getRecommendedGasPrice',
      ].includes(path.at(-1))
    )
  ).toBe(true);
});

function prepare() {
  mockEmitter.mockImplementation((...args: any[]) =>
    (realControllerEmitter as any)(...args)
  );
  render(<SendConfirm />);
}
const edit = () => screen.getByRole('button', { name: 'send.editFee' });
const quoteRequests = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
  );
const ready = async (
  max: boolean,
  { balance = '100', legacy = false } = {}
) => {
  mockEIP1559 = !legacy;
  mockRefreshedBalance = balance;
  mockState.vault.accounts.HDAccount[0].balances.ethereum = balance;
  mockLocation.state.tx.amount = max ? balance : '1';
  mockLocation.state.tx.isMax = max;
  mockLocation.state.tx.cachedGasData = {
    maxFeePerGas: '0xb2d05e00',
    maxPriorityFeePerGas: '0x00',
  };
  prepare();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeEnabled()
  );
  if (!legacy) expect(edit()).toBeEnabled();
  expect(quoteRequests()).toHaveLength(0);
};

// Synthetic account, token, list and SDK response; all chrome messages are
// intercepted locally. No signer, provider, external RPC or broadcast runs.
async function readyToken(blacklisted: boolean) {
  if (blacklisted)
    (blacklistService as any).addressBlacklist.set(
      syntheticRecipient,
      'synthetic list entry'
    );
  mockLocation.state.tx.transactionType = 'ERC20';
  mockLocation.state.tx.token = {
    contractAddress: `0x${'33'.repeat(20)}`,
    decimals: 18,
    symbol: 'TEST',
    name: 'Synthetic token',
  };
  await ready(false);
}
it('shows the localized refusal after the real pre-send blacklist rejection crosses handler and emitter', async () => {
  await readyToken(true);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  await waitFor(() =>
    expect(
      mockMessages.filter(
        (m) => m.data.methods.at(-1) === 'sendAndSaveTokenTransaction'
      )
    ).toHaveLength(1)
  );
  await waitFor(() =>
    expect(mockAlertError).toHaveBeenCalledWith(
      'blacklist.tokenRecipientBlocked'
    )
  );
  expect(
    screen.queryByText('send.submissionStatusUnknown')
  ).not.toBeInTheDocument();
  const message = mockMessages.find(
    (m) => m.data.methods.at(-1) === 'sendAndSaveTokenTransaction'
  );
  expect(message.data.params[0]).toBe('ERC20');
  expect(message.data.params[1].receiver).toBe(syntheticRecipient);
  expect(blacklistService.checkAddress).toHaveBeenCalledWith(
    syntheticRecipient
  );
  expect(mockTokenReplies).toHaveLength(1);
  expect(mockTokenReplies[0]).toEqual({
    success: false,
    error: {
      message: expect.stringContaining(
        'Token transfer blocked: synthetic list entry'
      ),
      code: 'PALI_TOKEN_RECIPIENT_BLOCKED',
      recipientBlockReason: 'synthetic list entry',
      recipientBlockSeverity: 'high',
      transactionNotBroadcast: true,
    },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeEnabled()
  );
  expect(mockSdkSend).not.toHaveBeenCalled();
  expect(mockWallet.sendAndSaveTransaction).not.toHaveBeenCalled();
});
it('accepts an unlisted synthetic recipient through the same controller path', async () => {
  await readyToken(false);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  await waitFor(() => expect(mockSdkSend).toHaveBeenCalledTimes(1));
  expect(blacklistService.checkAddress).toHaveBeenCalledWith(
    syntheticRecipient
  );
  expect(mockSdkSend.mock.calls[0][0].receiver).toBe(syntheticRecipient);
  const message = mockMessages.find(
    (m) => m.data.methods.at(-1) === 'sendAndSaveTokenTransaction'
  );
  expect(message.data.params[0]).toBe('ERC20');
  expect(message.data.params[1].receiver).toBe(syntheticRecipient);
  await waitFor(() =>
    expect(mockWallet.sendAndSaveTransaction).toHaveBeenCalledTimes(1)
  );
  expect(
    screen.queryByText('send.submissionStatusUnknown')
  ).not.toBeInTheDocument();
});

it('keeps an ambiguous SDK failure in unknown status', async () => {
  mockSdkSend.mockRejectedValueOnce(new Error('synthetic SDK failure'));
  await readyToken(false);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  await waitFor(() =>
    expect(screen.getByText('send.submissionStatusUnknown')).toBeInTheDocument()
  );
  expect(mockSdkSend).toHaveBeenCalledTimes(1);
  expect(mockWallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'buttons.confirm' })
  ).toBeDisabled();
});
