/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Interface } from 'ethers/abi';
import React from 'react';

import { EvmAutoNonceAcceptance } from '../../shared/evmAutoNonce';
import {
  EVM_ASSET_REVIEW_MESSAGE,
  EVM_ASSET_REVIEW_REQUIRED,
} from '../../utils/evmTransactionContext';
import { EvmSignedRecordNonceConflict } from '../../wallet/evmSignedRecords';
import { SendConfirm } from 'pages/Send/Confirm';
import { getController } from 'scripts/Background';
import { controllerEmitter as realControllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import MainController from 'scripts/Background/controllers/MainController';
import { watchWalletTokenReview } from 'scripts/Background/handlers/approvalSubmission';
import {
  controllerErrorResponse,
  handleMasterControllerResponses,
} from 'scripts/Background/handlers/handleMasterControllerResponses';
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
  default: {
    getState: () => mockState,
    dispatch: jest.fn(),
    subscribe: () => () => undefined,
  },
}));
let mockWallet: any;
let mockListener: any;
const APP_URL = 'moz-extension://synthetic-extension/app.html';
let mockTokenSender: string;
let mockTokenTab: number | undefined;
let mockOverwritePayload: boolean;
let mockExpireBeforeSubmit: boolean;
let mockRetainedAssetTransfer: boolean;
const retainedHash = `0x${'bb'.repeat(32)}`;
const nftReadAbi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
const selectedNftId = BigInt('9007199254740993');
const tokenBalanceUnits = BigInt('100000000000000000000');
let mockStage: jest.SpyInstance;
let mockCloseReview: () => void;
let mockPostToBackground: (value: unknown) => void;

function connectReview() {
  const rendererMessages: ((value: unknown) => void)[] = [];
  const backgroundMessages: ((value: unknown) => void)[] = [];
  const onDisconnect: (() => void)[] = [];
  let connected = true;
  const disconnect = () => {
    if (!connected) return;
    connected = false;
    onDisconnect.forEach((listener) => listener());
  };
  const common = {
    disconnect,
    onDisconnect: {
      addListener: (listener: () => void) => onDisconnect.push(listener),
    },
  };
  const port = {
    ...common,
    sender: {
      id: 'synthetic-extension',
      url: mockTokenSender,
      ...(mockTokenTab !== undefined && {
        frameId: 0,
        tab: { id: mockTokenTab },
      }),
    },
    onMessage: {
      addListener: (listener: (value: unknown) => void) =>
        backgroundMessages.push(listener),
    },
    postMessage: (reply: unknown) => {
      if (!connected) return;
      mockTokenReplies.push(reply);
      rendererMessages.forEach((listener) => listener(reply));
    },
  } as unknown as chrome.runtime.Port;
  mockCloseReview = disconnect;
  mockPostToBackground = (value: unknown) => {
    if (connected)
      backgroundMessages.forEach((listener) =>
        listener(JSON.parse(JSON.stringify(value)))
      );
  };
  queueMicrotask(() =>
    watchWalletTokenReview(
      port,
      (request, persistentTab, signal) =>
        mockWallet.captureWalletTokenReview(request, persistentTab, signal),
      (payload, authority) =>
        mockWallet.sendAndSaveTokenTransaction(payload, authority),
      controllerErrorResponse
    )
  );
  return {
    ...common,
    onMessage: {
      addListener: (listener: (value: unknown) => void) =>
        rendererMessages.push(listener),
    },
    postMessage: (request: unknown) => {
      queueMicrotask(() => {
        if (request === 'submit') {
          if (mockExpireBeforeSubmit) {
            const now = performance.now();
            jest.spyOn(performance, 'now').mockReturnValue(now + 300_000);
          }
          if (mockOverwritePayload) {
            mockPostToBackground({
              type: 'ERC721',
              receiver: '0x7777777777777777777777777777777777777777',
            });
            return;
          }
        }
        mockPostToBackground(request);
      });
    },
  } as unknown as chrome.runtime.Port;
}

const mockSdkSend = jest.fn();
const syntheticRecipient = '0x2222222222222222222222222222222222222222';
const mockTokenReplies: any[] = [];
const mockTokenRpcFailures: string[] = [];

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
      Ledger: {
        0: {
          id: 0,
          address: '0x1111111111111111111111111111111111111111',
          balances: { ethereum: '100' },
          isLedgerWallet: true,
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
  mockTokenRpcFailures.length = 0;
  mockTokenSender = APP_URL;
  mockTokenTab = undefined;
  mockState.vault.activeAccount.type = 'HDAccount';
  mockAuth.connectionUnavailable = false;
  mockAuth.isUnlocked = true;
  mockOverwritePayload = false;
  mockExpireBeforeSubmit = false;
  mockRetainedAssetTransfer = false;
  chrome.runtime.connect = jest.fn(
    connectReview
  ) as typeof chrome.runtime.connect;
  (chrome.runtime as any).id = 'synthetic-extension';
  chrome.runtime.getURL = jest.fn(
    (path: string) => `moz-extension://synthetic-extension/${path}`
  );
  jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: any,
    callback: (value: unknown) => void
  ) => {
    mockMessages.push(message);
    const method = message.data.methods.at(-1);
    if (method === 'getFreshNativeEvmGasLimit') return callback(21000);
    if (method === 'getRecommendedGasPrice') return callback('3000000000');
    if (method === 'refreshActiveAccountBalances')
      return callback({ nativeBalance: mockRefreshedBalance });
    if (method === 'reviewNativeEvmFee')
      return callback({
        id: 'fixture-review',
        maximumFee: message.data.params[2],
        validForMs: 90000,
      });
    if (method === 'discardNativeEvmFeeReview') return callback(undefined);
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
    throw new Error(`Unexpected synthetic controller call: ${method}`);
  }) as any);
  mockWallet = Object.create(MainController.prototype);
  mockWallet.walletSessionGeneration = 7;
  const keyring = {
    isUnlocked: () => true,
    ethereumTransaction: {
      sendSignedErc20Transaction: mockSdkSend,
      sendSignedErc721Transaction: mockSdkSend,
      sendSignedErc1155Transaction: mockSdkSend,
      getGasOverrides: () => ({}),
      web3Provider: { signal: new AbortController().signal },
    },
  };
  mockWallet.getActiveKeyring = jest.fn(() => keyring);
  mockWallet.getRetainedEvmRecords = () => ({
    autoNonceAcceptance: new EvmAutoNonceAcceptance(),
    captureAutoNonceSnapshot: async () => ({
      owner: 'synthetic',
      retained: mockRetainedAssetTransfer
        ? [
            {
              chainId: String(mockState.vault.activeNetwork.chainId),
              from: mockState.vault.accounts.HDAccount[0].address,
              hash: retainedHash,
              nonce: 6,
              phase: 'submitted',
            },
          ]
        : [],
      readMaximumCost: async () => BigInt(1),
      readAssetDebit: async () =>
        mockRetainedAssetTransfer ? tokenBalanceUnits : BigInt(0),
    }),
  });
  mockWallet.withReceiptReadProvider = jest.fn(async (signal, _, read) =>
    read({
      signal,
      verifyConfiguredChainId: async () => undefined,
      send: async (method: string, params: unknown[]) => {
        try {
          const account = mockState.vault.accounts.HDAccount[0].address;
          const contract = `0x${'33'.repeat(20)}`;
          const blockTag = '0x10';
          if (method === 'eth_getBlockByNumber') {
            expect(params).toEqual([
              expect.stringMatching(/^(latest|0x10)$/),
              false,
            ]);
            return { number: blockTag, hash: `0x${'ab'.repeat(32)}` };
          }
          if (method === 'eth_getCode') {
            expect(params).toEqual([contract, blockTag]);
            return '0x6000';
          }
          if (method === 'eth_call') {
            expect(params[1]).toBe(blockTag);
            const tx = params[0] as {
              data: string;
              from?: string;
              gas?: string;
              nonce?: string;
              to: string;
            };
            expect(tx.to).toBe(contract);
            if (tx.from) {
              expect(tx).toMatchObject({
                from: account,
                gas: '0xa410',
                nonce: '0x7',
                type: '0x2',
                maxFeePerGas: '0xb2d05e00',
                maxPriorityFeePerGas: '0x0',
              });
              if (tx.data.startsWith('0xa9059cbb'))
                return `0x${'0'.repeat(63)}1`;
              expect(
                tx.data.startsWith('0x23b872dd') ||
                  tx.data.startsWith('0xf242432a')
              ).toBe(true);
              return '0x';
            }
            if (tx.data.startsWith('0x6352211e')) {
              const requestedId = nftReadAbi.decodeFunctionData(
                'ownerOf',
                tx.data
              )[0];
              if (requestedId !== selectedNftId)
                throw Object.assign(new Error('execution reverted'), {
                  code: 3,
                  data: '0x',
                });
              return `0x${account.slice(2).toLowerCase().padStart(64, '0')}`;
            }
            if (tx.data.startsWith('0x00fdd58e')) {
              const requestedId = nftReadAbi.decodeFunctionData(
                'balanceOf',
                tx.data
              )[1];
              return `0x${(requestedId === selectedNftId
                ? tokenBalanceUnits
                : BigInt(0)
              )
                .toString(16)
                .padStart(64, '0')}`;
            }
            if (tx.data.startsWith('0x4e1273f4')) {
              const [, ids] = nftReadAbi.decodeFunctionData(
                'balanceOfBatch',
                tx.data
              );
              expect([...ids]).toEqual([selectedNftId]);
              return nftReadAbi.encodeFunctionResult('balanceOfBatch', [
                [tokenBalanceUnits],
              ]);
            }
            expect(
              tx.data.startsWith('0x70a08231') ||
                tx.data.startsWith('0x00fdd58e')
            ).toBe(true);
            // 10^20 fixture units, encoded as an ABI uint256 word.
            return `0x${'56bc75e2d63100000'.padStart(64, '0')}`;
          }
          if (method === 'eth_getTransactionCount')
            return mockRetainedAssetTransfer && params[1] !== 'pending'
              ? '0x6'
              : '0x7';
          if (method === 'eth_getTransactionByHash')
            return {
              hash: retainedHash,
              from: mockState.vault.accounts.HDAccount[0].address,
              nonce: mockRetainedAssetTransfer ? '0x6' : '0x7',
              blockHash: null,
              blockNumber: null,
              transactionIndex: null,
            };
          throw new Error(`Unexpected token read ${method}`);
        } catch (error) {
          // The worker intentionally sanitizes provider errors. Preserve fixture
          // assertion failures here so they remain visible to the test.
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 3 &&
            'data' in error &&
            error.data === '0x'
          )
            throw error;
          mockTokenRpcFailures.push(
            `${method}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          throw error;
        }
      },
    })
  );
  mockStage = jest.spyOn(mockWallet, 'captureWalletTokenReview');
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
  expect(mockTokenRpcFailures).toEqual([]);
  expect((blacklistService as any).axiosInstance.get).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getFreshNativeEvmGasLimit',
        'reviewNativeEvmFee',
        'discardNativeEvmFeeReview',
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
  return render(<SendConfirm />);
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
  const view = prepare();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeEnabled()
  );
  if (!legacy) expect(edit()).toBeEnabled();
  expect(quoteRequests()).toHaveLength(0);
  return view;
};

// Synthetic account, token, list and SDK response; all chrome messages are
// intercepted locally. No signer, provider, external RPC or broadcast runs.
async function readyToken(
  blacklisted: boolean,
  type: 'ERC20' | 'ERC721' | 'ERC1155' = 'ERC20'
) {
  if (blacklisted)
    (blacklistService as any).addressBlacklist.set(
      syntheticRecipient,
      'synthetic list entry'
    );
  mockLocation.state.tx.transactionType = type;
  mockLocation.state.tx.tokenAmountUnits = '1000000000000000000';
  mockLocation.state.tx.token = {
    contractAddress: `0x${'33'.repeat(20)}`,
    decimals: type === 'ERC20' ? 18 : 0,
    ...(type !== 'ERC20' && { tokenId: '9007199254740993', isNft: true }),
    symbol: 'TEST',
    name: 'Synthetic token',
  };
  return ready(false);
}
const confirmToken = () =>
  screen.getByRole('button', { name: 'buttons.confirm' });

it('preserves the localized pre-send blacklist refusal through the real token port', async () => {
  await readyToken(true);
  fireEvent.click(confirmToken());
  await waitFor(() =>
    expect(mockTokenReplies[0]).toEqual({ type: 'reviewed' })
  );
  await waitFor(() =>
    expect(mockAlertError).toHaveBeenCalledWith(
      'blacklist.tokenRecipientBlocked'
    )
  );
  expect(
    screen.queryByText('send.submissionStatusUnknown')
  ).not.toBeInTheDocument();
  expect(mockTokenReplies).toEqual([
    { type: 'reviewed' },
    {
      type: 'failure',
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
    },
  ]);
  await waitFor(() => expect(confirmToken()).toBeEnabled());
  expect(mockSdkSend).not.toHaveBeenCalled();
});

it.each([
  ['ERC20', { tokenAmountUnits: '1000000000000000000' }],
  ['ERC721', { tokenId: '9007199254740993' }],
  ['ERC1155', { tokenId: '9007199254740993', tokenAmount: '1' }],
] as const)(
  'submits only the staged %s payload on a Firefox app port with no document id',
  async (type, exact) => {
    await readyToken(false, type);
    fireEvent.click(confirmToken());
    await waitFor(() => expect(mockSdkSend).toHaveBeenCalledTimes(1));
    const expected = expect.objectContaining({
      ...exact,
      receiver: syntheticRecipient,
      tokenAddress: `0x${'33'.repeat(20)}`,
      networkUrl: 'https://rpc.invalid',
      gasLimit: '42000',
      isLegacy: false,
      maxFeePerGas: '3000000000',
      maxPriorityFeePerGas: '0',
    });
    expect(mockStage).toHaveBeenCalledWith(
      expect.objectContaining({ type, transaction: expected }),
      false,
      expect.any(AbortSignal)
    );
    expect(mockSdkSend).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({
        assertCurrent: expect.any(Function),
        nonce: 7,
        signal: expect.any(AbortSignal),
      })
    );
    expect(
      mockMessages.some(
        (entry) => entry.data.methods.at(-1) === 'sendAndSaveTokenTransaction'
      )
    ).toBe(false);
    await waitFor(() =>
      expect(mockTokenReplies.at(-1)).toMatchObject({ type: 'submitted' })
    );
  }
);

it('shows saved-transaction Activity guidance through the real token port after a held refusal', async () => {
  mockSdkSend.mockRejectedValueOnce(
    new EvmSignedRecordNonceConflict({ hash: retainedHash, operation: 'erc20' })
  );
  await readyToken(false);
  fireEvent.click(confirmToken());
  await waitFor(() =>
    expect(mockAlertError).toHaveBeenCalledWith('send.savedNonceConflict')
  );
  expect(mockTokenReplies).toMatchObject([
    { type: 'reviewed' },
    {
      type: 'failure',
      error: {
        code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT',
        transactionNotBroadcast: true,
      },
    },
  ]);
  expect(JSON.stringify(mockTokenReplies)).not.toContain(retainedHash);
  expect(mockSdkSend).toHaveBeenCalledTimes(1);
});

it('keeps amount-review guidance for a pre-sign asset refusal without a saved record', async () => {
  jest.spyOn(mockWallet, 'inspectOrdinaryEvmNonce').mockRejectedValueOnce(
    Object.assign(new Error(EVM_ASSET_REVIEW_MESSAGE), {
      code: EVM_ASSET_REVIEW_REQUIRED,
      transactionNotBroadcast: true,
    })
  );
  await readyToken(false);
  fireEvent.click(confirmToken());
  await waitFor(() =>
    expect(mockAlertError).toHaveBeenCalledWith('send.maxBalanceReviewRequired')
  );
  expect(mockAlertError).not.toHaveBeenCalledWith('send.savedNonceConflict');
  expect(mockTokenReplies.at(-1)).toMatchObject({
    type: 'failure',
    error: {
      code: EVM_ASSET_REVIEW_REQUIRED,
      transactionNotBroadcast: true,
    },
  });
  expect(mockSdkSend).not.toHaveBeenCalled();
});

it('shows localized amount-review guidance before signing a known asset overcommit', async () => {
  mockRetainedAssetTransfer = true;
  await readyToken(false);
  fireEvent.click(confirmToken());
  await waitFor(() =>
    expect(mockAlertError).toHaveBeenCalledWith('send.maxBalanceReviewRequired')
  );
  expect(mockSdkSend).not.toHaveBeenCalled();
});

it.each(['wrong page', 'altered submit', 'expired review'])(
  'rejects %s without signer entry',
  async (testCase) => {
    if (testCase === 'wrong page')
      mockTokenSender = 'moz-extension://synthetic-extension/ledger.html';
    else if (testCase === 'altered submit') mockOverwritePayload = true;
    else mockExpireBeforeSubmit = true;
    await readyToken(false);
    await act(async () => fireEvent.click(confirmToken()));
    expect(mockSdkSend).not.toHaveBeenCalled();
    if (testCase === 'expired review')
      expect(mockTokenReplies.at(-1)).toMatchObject({
        type: 'failure',
        error: { transactionNotBroadcast: true },
      });
    if (testCase === 'wrong page') expect(mockStage).not.toHaveBeenCalled();
  }
);

it('revokes the sole token attempt on disconnect or duplicate submit while signing', async () => {
  let release!: () => void;
  const signerPending = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockSdkSend.mockImplementationOnce(async (_request, authority) => {
    await signerPending;
    authority.assertCurrent();
    return { hash: `0x${'44'.repeat(32)}`, nonce: 7 };
  });
  try {
    await readyToken(false);
    fireEvent.click(confirmToken());
    await waitFor(() => expect(mockSdkSend).toHaveBeenCalledTimes(1));
    const authority = mockSdkSend.mock.calls[0][1];
    expect(authority.signal.aborted).toBe(false);
    mockPostToBackground('submit');
    expect(authority.signal.aborted).toBe(true);
    expect(() => authority.assertCurrent()).toThrow(
      'token review is no longer current'
    );
    expect(mockSdkSend).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByText('send.submissionStatusUnknown')
      ).toBeInTheDocument()
    );
  } finally {
    mockCloseReview();
    await act(async () => release());
  }
});

it('refuses a toolbar hardware review before invoking the broker', async () => {
  mockState.vault.activeAccount.type = 'Ledger';
  await readyToken(false);
  await act(async () => fireEvent.click(confirmToken()));
  expect(mockTokenReplies.at(-1)).toMatchObject({
    type: 'failure',
    error: { transactionNotBroadcast: true },
  });
  expect(mockSdkSend).not.toHaveBeenCalled();
});

it('keeps a browser-owned wallet tab review active through device focus and renderer refresh', async () => {
  mockState.vault.activeAccount.type = 'Ledger';
  mockTokenTab = 42;
  const view = await readyToken(false, 'ERC721');
  const focusDeviceWindow = jest.fn(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    mockAuth.connectionUnavailable = true;
    view.rerender(<SendConfirm />);
  });
  mockSdkSend.mockImplementationOnce(async (_request, authority) => {
    focusDeviceWindow();
    expect(authority.signal.aborted).toBe(false);
    authority.assertCurrent();
    return { hash: `0x${'44'.repeat(32)}`, nonce: 7 };
  });
  fireEvent.click(confirmToken());
  await waitFor(() =>
    expect(mockTokenReplies.at(-1)).toMatchObject({ type: 'submitted' })
  );
  expect(focusDeviceWindow).toHaveBeenCalledTimes(1);
  expect(mockSdkSend).toHaveBeenCalledTimes(1);
});

it.each(['tab close', 'wallet lock'])(
  'revokes pending hardware signing on %s',
  async (reason) => {
    mockState.vault.activeAccount.type = 'Ledger';
    mockTokenTab = 42;
    let release!: () => void;
    const signerPending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockSdkSend.mockImplementationOnce(async (_request, authority) => {
      await signerPending;
      authority.assertCurrent();
      return { hash: `0x${'44'.repeat(32)}`, nonce: 7 };
    });
    const view = await readyToken(false, 'ERC1155');
    try {
      fireEvent.click(confirmToken());
      await waitFor(() => expect(mockSdkSend).toHaveBeenCalledTimes(1));
      const authority = mockSdkSend.mock.calls[0][1];
      expect(authority.signal.aborted).toBe(false);
      if (reason === 'tab close') view.unmount();
      else {
        mockAuth.isUnlocked = false;
        view.rerender(<SendConfirm />);
      }
      expect(authority.signal.aborted).toBe(true);
      expect(() => authority.assertCurrent()).toThrow();
    } finally {
      await act(async () => release());
    }
    expect(mockWallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  }
);

it.each(['ERC20', 'ERC721', 'ERC1155'])(
  'rejects the old %s reflective wrapper without a review port',
  async (type) => {
    const reply = jest.fn();
    mockListener(
      {
        type: 'CONTROLLER_ACTION',
        data: {
          methods: ['wallet', 'sendAndSaveTokenTransaction'],
          params: [type, {}],
        },
      },
      { id: 'synthetic-extension', url: APP_URL },
      reply
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ transactionNotBroadcast: true }),
      })
    );
    expect(mockSdkSend).not.toHaveBeenCalled();
  }
);

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
