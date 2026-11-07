/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { randomUUID } from 'crypto';
import React from 'react';

import { EvmAutoNonceAcceptance } from '../../shared/evmAutoNonce';
import MainController from 'scripts/Background/controllers/MainController';
import { BigNumber } from 'utils/ethersV6Compat';

import { SendConfirm } from './Confirm';

const { EthereumTransactions } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum'
);
const { RpcResponseIntegrityError } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/providers'
);
const mockEmitter = jest.fn();
const originalRandomUUID = Object.getOwnPropertyDescriptor(
  globalThis.crypto,
  'randomUUID'
);
let reviewFailures: string[] = [];
let mockEnsNameToAddress: Record<string, string> = {};
const mockScope = { account: 'gas-read-account', network: 'gas-read-network' };
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockState: any = {
  vault: {
    activeNetwork: {
      kind: 'ethereum',
      chainId: 89000,
      currency: 'TEST',
      url: 'https://native-gas.invalid',
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
  vaultGlobal: {
    activeSlip44: 60,
    networkStatus: 'connected',
    isSwitchingAccount: false,
  },
  price: { fiat: { asset: 'USD' } },
};
const mockLocation: any = {
  key: 'native-gas-entry',
  pathname: '/send/confirm',
  state: { submissionStarted: false, walletScope: mockScope },
};
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, subscribe: () => () => undefined },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn((signal: AbortSignal) => {
    const value = { ...mockEstimateProvider, signal, destroy: jest.fn() };
    mockFreshProviders.push(value);
    return value;
  }),
  EthereumTransactions: jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum'
  ).EthereumTransactions,
  PsbtUtils: {},
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
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
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => mockEnsNameToAddress,
  selectValidEnsCache: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Icon: ({ name }: any) => <span>{name}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('./components', () => ({ PriorityBar: () => null }));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  logError: jest.fn(),
  removeScientificNotation: (value: any) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(value),
  omitTransactionObjectData: (value: any) => value,
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(),
  getTransactionReturnContext: () => undefined,
  getWalletNavigationScope: () => mockScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: jest.fn(),
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: jest.fn(),
  getErc721Abi: jest.fn(),
  getErc1155Abi: jest.fn(),
}));

type Mode = 'fresh' | 'prefetched' | 'legacy';
const modes: Mode[] = ['fresh', 'prefetched', 'legacy'];
const previousGlobals = {
  ResizeObserver: globalThis.ResizeObserver,
  MessageChannel: globalThis.MessageChannel,
  matchMedia: window.matchMedia,
};
let mockEstimateProvider: any;
let mockFreshProviders: any[] = [];
let mountResult: ReturnType<typeof render>;
let sdk: any;
let provider: any;
let wallet: any;
let modern: boolean;
const gasOutcomes: {
  code?: string;
  name?: string;
  state: string;
  value?: string;
}[] = [];
const confirm = () => screen.getByRole('button', { name: 'buttons.confirm' });
const block = () => ({
  gasLimit: BigNumber.from(30000000),
  ...(modern ? { baseFeePerGas: BigNumber.from(1000000000) } : {}),
});
const advance = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

beforeAll(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: randomUUID,
  });
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as any;
});
afterAll(() => {
  if (originalRandomUUID)
    Object.defineProperty(globalThis.crypto, 'randomUUID', originalRandomUUID);
  else delete (globalThis.crypto as Partial<Crypto>).randomUUID;
});
afterAll(() => {
  globalThis.ResizeObserver = previousGlobals.ResizeObserver;
  globalThis.MessageChannel = previousGlobals.MessageChannel;
  window.matchMedia = previousGlobals.matchMedia;
});
beforeEach(() => {
  reviewFailures = [];
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  gasOutcomes.length = 0;
  mockEnsNameToAddress = {};
  mockFreshProviders = [];
  modern = true;
  mockState.vault.activeNetwork.chainId += 1;
  mockLocation.key += '-next';
  // The ordinary SendEth producer supplies exactly this native review shape.
  mockLocation.state = {
    submissionStarted: false,
    walletScope: mockScope,
    tx: {
      sender: mockState.vault.accounts.HDAccount[0].address,
      receivingAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
      transactionType: 'NATIVE_ETH',
      defaultGasLimit: 42000,
    },
  };
  window.history.replaceState(null, '', '/');
  provider = {
    signal: new AbortController().signal,
    getGasPrice: jest.fn().mockResolvedValue(BigNumber.from(1000000000)),
    getBlock: jest.fn(async () => block()),
    estimateGas: jest.fn().mockResolvedValue(BigNumber.from(21000)),
    verifyConfiguredChainId: jest.fn().mockResolvedValue(undefined),
    send: jest.fn(async (method: string) => {
      if (method === 'eth_getBlockByNumber') return block();
      if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
      if (method === 'eth_getTransactionCount') return '0x2';
      throw new Error(`Unexpected RPC ${method}`);
    }),
  };
  mockEstimateProvider = provider;
  sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    () => {
      throw new Error('Signing is forbidden in native gas read tests');
    },
    () => ({
      ...mockState.vault,
      activeAccountType: 'HDAccount',
      activeAccountId: 0,
    }),
    undefined,
    undefined,
    () => () => undefined,
    null
  );
  Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
  wallet = Object.create(MainController.prototype);
  const keyring = { ethereumTransaction: sdk, isUnlocked: () => true };
  wallet.getActiveKeyring = () => keyring;
  wallet.getRetainedEvmRecords = () => ({
    autoNonceAcceptance: new EvmAutoNonceAcceptance(),
    captureAutoNonceSnapshot: async () => ({
      owner: 'synthetic',
      minimumNonce: 0,
      retained: [],
      readMaximumCost: jest.fn(),
    }),
  });
  wallet.getWalletSetupStatus = () => undefined;
  wallet.isUnlocked = () => true;
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  mockEmitter.mockImplementation(
    async (methods: string[], params: any[] = []) => {
      // No mocked getTxGasLimit result: traverse the actual MainController getter
      // and installed SDK implementation; only provider read outcomes vary.
      const allowed = [
        'getCurrentBlock',
        'getRecommendedGasPrice',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getTxGasLimit',
        'getFreshNativeEvmGasLimit',
        'reviewNativeEvmFee',
        'refreshNativeEvmFeeReview',
        'discardNativeEvmFeeReview',
      ];
      const method = methods.at(-1)!;
      if (!allowed.includes(method))
        throw new Error('Forbidden controller operation: ' + method);
      let target: any = { wallet };
      for (const name of methods.slice(0, -1)) target = target[name];
      try {
        const value = await target[method](...params);
        if (
          method === 'getTxGasLimit' ||
          method === 'getFreshNativeEvmGasLimit'
        )
          gasOutcomes.push({ state: 'resolved', value: value.toString() });
        return value;
      } catch (error) {
        if (method === 'reviewNativeEvmFee') reviewFailures.push(String(error));
        if (
          method === 'getTxGasLimit' ||
          method === 'getFreshNativeEvmGasLimit'
        )
          gasOutcomes.push({
            state: 'rejected',
            code: error.code,
            name: error.name,
          });
        throw error;
      }
    }
  );
});
afterEach(() => {
  cleanup();
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getCurrentBlock',
        'getRecommendedGasPrice',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getTxGasLimit',
        'getFreshNativeEvmGasLimit',
        'reviewNativeEvmFee',
        'refreshNativeEvmFeeReview',
        'discardNativeEvmFeeReview',
      ].includes(path.at(-1))
    )
  ).toBe(true);
  sdk._web3Provider?.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mount(mode: Mode) {
  modern = mode !== 'legacy';
  if (mode === 'prefetched')
    mockLocation.state.tx.cachedGasData = {
      maxFeePerGas: '0xb2d05e00',
      maxPriorityFeePerGas: '0x3b9aca00',
    };
  await act(async () => {
    mountResult = render(<SendConfirm />);
  });
  await advance();
}
function expectedFee(gas: number, mode: Mode) {
  return (
    ((gas * (mode === 'legacy' ? 1 : mode === 'prefetched' ? 3 : 3.5)) / 1e9)
      .toFixed(9)
      .replace(/0+$/, '')
      .replace(/\.$/, '') + ' TEST'
  );
}
function assertHealthyQuote(mode: Mode, gas: number) {
  expect(gasOutcomes).toEqual([{ state: 'resolved', value: String(gas) }]);
  expect(confirm()).toBeEnabled();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(screen.getAllByText(expectedFee(gas, mode)).length).toBeGreaterThan(0);
}

describe.each(modes)('ordinary native gas read in %s mode', (mode) => {
  it('healthy installed SDK estimate21000 uses its actual25200 buffered quote', async () => {
    await mount(mode);
    expect(reviewFailures).toEqual([]);
    expect(provider.estimateGas).toHaveBeenCalledTimes(1);
    assertHealthyQuote(mode, 25200);
  });

  it('does not replace a failed initial estimate with a simplified fallback', async () => {
    provider.estimateGas
      .mockRejectedValueOnce(new Error('Synthetic ordinary estimate rejection'))
      .mockResolvedValueOnce(BigNumber.from(30000));
    await mount(mode);
    expect(provider.estimateGas).toHaveBeenCalledTimes(1);
    expect(confirm()).toBeDisabled();
    expect(gasOutcomes).toEqual([
      { state: 'rejected', code: undefined, name: 'Error' },
    ]);
  });

  it('does not convert generic estimate failures into a 100000-gas quote', async () => {
    provider.estimateGas.mockRejectedValue(
      new Error('Synthetic ordinary estimates unavailable')
    );
    await mount(mode);
    expect(provider.estimateGas).toHaveBeenCalledTimes(1);
    expect(confirm()).toBeDisabled();
    expect(gasOutcomes).toEqual([
      { state: 'rejected', code: undefined, name: 'Error' },
    ]);
  });

  it.each(['integrity', 'abort'])(
    'keeps an actually rejected SDK %s read unavailable instead of quoting42000',
    async (kind) => {
      const error =
        kind === 'integrity'
          ? new RpcResponseIntegrityError(
              'Synthetic estimate response correlation failed',
              false
            )
          : Object.assign(new Error('Synthetic provider read aborted'), {
              name: 'AbortError',
            });
      provider.estimateGas.mockRejectedValue(error);
      await mount(mode);
      expect(provider.estimateGas).toHaveBeenCalledTimes(1);
      expect(gasOutcomes).toEqual([
        { state: 'rejected', code: error.code, name: error.name },
      ]);
      // No signing operation is clicked. Only the current fee quote should fail.
      expect(confirm()).toBeDisabled();
      expect(screen.getAllByText('send.unableToLoad').length).toBeGreaterThan(
        0
      );
      expect(
        screen.getByRole('button', { name: 'receive.retry' })
      ).toBeEnabled();
    }
  );
});

it('does not replace a MAX refinement rejection with a completed default gas quote', async () => {
  mockLocation.state.tx.isMax = true;
  mockLocation.state.tx.amount = '100';
  const error = new RpcResponseIntegrityError(
    'Synthetic refined estimate response mismatch',
    false
  );
  provider.estimateGas
    .mockResolvedValueOnce(BigNumber.from(21000))
    .mockRejectedValueOnce(error);
  await mount('fresh');
  expect(provider.estimateGas).toHaveBeenCalledTimes(2);
  expect(gasOutcomes).toEqual([
    { state: 'resolved', value: '25200' },
    { state: 'rejected', code: error.code, name: error.name },
  ]);
  expect(confirm()).toBeDisabled();
  expect(screen.getAllByText('send.unableToLoad').length).toBeGreaterThan(0);
});

// After-extension coverage: the16 original before-proof assertions above are
// retained. Recovery must be explicit and keep the same unsigned transaction.
it.each(modes)(
  'recovers a rejected SDK gas read only after explicit Retry in %s mode',
  async (mode) => {
    const error = new RpcResponseIntegrityError(
      'Synthetic estimate response correlation failed',
      false
    );
    provider.estimateGas.mockRejectedValueOnce(error);
    const originalTx = JSON.parse(JSON.stringify(mockLocation.state.tx));
    await mount(mode);
    expect(confirm()).toBeDisabled();
    expect(provider.estimateGas).toHaveBeenCalledTimes(1);
    expect(gasOutcomes).toEqual([
      { state: 'rejected', code: error.code, name: error.name },
    ]);
    const retry = screen.getByRole('button', { name: 'receive.retry' });
    expect(retry).toBeEnabled();
    await advance();
    expect(provider.estimateGas).toHaveBeenCalledTimes(1);
    expect(confirm()).toBeDisabled();
    await act(async () => {
      fireEvent.click(retry);
    });
    await advance();
    expect(provider.estimateGas).toHaveBeenCalledTimes(2);
    expect(gasOutcomes).toEqual([
      { state: 'rejected', code: error.code, name: error.name },
      { state: 'resolved', value: '25200' },
    ]);
    expect(confirm()).toBeEnabled();
    expect(screen.queryByText('send.unableToLoad')).toBeNull();
    expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
    const tx = { ...mockLocation.state.tx };
    delete tx.cachedGasData;
    expect(tx).toEqual(originalTx);
    expect(mockState.vault.activeAccount).toEqual({ type: 'HDAccount', id: 0 });
    // The read-only emitter allowlist in afterEach refuses every submission.
  }
);

it('keeps initial, retry and changed-recipient estimates on the same strict read path', async () => {
  mockLocation.state.tx.receivingAddress = 'recipient.eth';
  mockEnsNameToAddress = {
    'recipient.eth': '0x2222222222222222222222222222222222222222',
  };
  provider.estimateGas.mockRejectedValueOnce(
    new RpcResponseIntegrityError('Synthetic stale estimate', false)
  );
  await mount('prefetched');
  expect(confirm()).toBeDisabled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }));
  });
  await advance();
  expect(confirm()).toBeEnabled();
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path.at(-1) === 'getFreshNativeEvmGasLimit'
    )
  ).toHaveLength(2);
  expect(mockFreshProviders).toHaveLength(3);
  expect(
    mockFreshProviders.every((item) => item.destroy.mock.calls.length === 1)
  ).toBe(true);
  // The confirmation deliberately retains its original route payload. A new
  // verified ENS cache result is a real recomputation trigger and changes the
  // fee cache key without replacing that protected transaction entry.
  mockEnsNameToAddress = {
    'recipient.eth': '0x3333333333333333333333333333333333333333',
  };
  await act(async () => {
    mountResult.rerender(<SendConfirm />);
  });
  await advance();
  expect(confirm()).toBeEnabled();
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path.at(-1) === 'getFreshNativeEvmGasLimit'
    )
  ).toHaveLength(3);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path.at(-1) === 'getTxGasLimit')
  ).toHaveLength(0);
  expect(mockLocation.state.tx.receivingAddress).toBe('recipient.eth');
  expect(provider.estimateGas).toHaveBeenLastCalledWith(
    expect.objectContaining({
      to: '0x3333333333333333333333333333333333333333',
    })
  );
});

it('keeps every exact MAX refinement on the same explicit fresh-read attempt', async () => {
  mockLocation.state.tx.isMax = true;
  mockLocation.state.tx.amount = '100';
  provider.estimateGas.mockRejectedValueOnce(
    new RpcResponseIntegrityError('Synthetic stale estimate', false)
  );
  await mount('prefetched');
  const initialReads = mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getFreshNativeEvmGasLimit'
  ).length;
  provider.estimateGas
    .mockResolvedValueOnce(BigNumber.from(21000))
    .mockResolvedValueOnce(BigNumber.from(30000))
    .mockResolvedValueOnce(BigNumber.from(30000));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }));
  });
  await advance();
  expect(confirm()).toBeEnabled();
  const retries = mockEmitter.mock.calls
    .filter(([path]) => path.at(-1) === 'getFreshNativeEvmGasLimit')
    .slice(initialReads);
  const total = BigNumber.from(10).pow(18).mul(100),
    rate = BigNumber.from(3000000000);
  expect(retries.map(([, args]) => args[0].value)).toEqual(
    [500000, 25200, 36000].map((gas) => total.sub(rate.mul(gas)).toHexString())
  );
  for (const [, args] of retries) expect(args[1]).toEqual(mockScope);
  expect(mockFreshProviders).toHaveLength(initialReads + 4);
  for (const reader of mockFreshProviders)
    expect(reader.destroy).toHaveBeenCalledTimes(1);
});

it('expires the displayed native fee review and requires explicit Retry before confirming', async () => {
  await mount('fresh');
  expect(confirm()).toBeEnabled();
  const estimates = provider.estimateGas.mock.calls.length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(90000);
  });
  expect(confirm()).toBeDisabled();
  expect(provider.estimateGas).toHaveBeenCalledTimes(estimates);
  const reviews = mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'reviewNativeEvmFee'
  );
  expect(reviews).toHaveLength(1);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }));
  });
  await advance();
  expect(confirm()).toBeEnabled();
  expect(provider.estimateGas).toHaveBeenCalledTimes(estimates + 1);
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path.at(-1) === 'reviewNativeEvmFee'
    )
  ).toHaveLength(2);
});

it.each([false, true])(
  'refreshes an expired custom approval with the same envelope (MAX: %s)',
  async (isMax) => {
    if (isMax) {
      mockLocation.state.tx.isMax = true;
      mockLocation.state.tx.amount = '100';
    }
    await mount('fresh');
    expect(confirm()).toBeEnabled();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'send.editFee' }))
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByPlaceholderText('send.maxFee (GWEI)'), {
      target: { value: '4' },
    });
    fireEvent.change(dialog.getByPlaceholderText('send.gasLimit'), {
      target: { value: '27000' },
    });
    await act(async () =>
      fireEvent.click(dialog.getByRole('button', { name: 'buttons.save' }))
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(confirm()).toBeEnabled();
    const [, approved] = mockEmitter.mock.calls
      .filter(([path]) => path.at(-1) === 'reviewNativeEvmFee')
      .at(-1)!;
    expect(approved[0]).toMatchObject({
      gasLimit: '27000',
      maxFeePerGas: '4000000000',
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(90000);
    });
    expect(confirm()).toBeDisabled();
    const retry = () =>
      act(async () =>
        fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }))
      );
    let settleEstimate!: (gas: string) => void;
    const heldEstimate = new Promise<string>((resolve) => {
      settleEstimate = resolve;
    });
    let estimate: string | Promise<string> = heldEstimate;
    provider.verifyConfiguredChainId = jest.fn().mockResolvedValue(undefined);
    provider.send.mockImplementation(async (method: string) => {
      if (method === 'eth_getBlockByNumber') return block();
      if (method === 'eth_getBalance') return '0x56bc75e2d63100000';
      if (method === 'eth_getTransactionCount') return '0x2';
      if (method === 'eth_estimateGas') return estimate;
      throw new Error(`Unexpected RPC ${method}`);
    });
    await retry();
    expect(confirm()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'send.editFee' })).toBeDisabled();
    expect(
      provider.send.mock.calls.filter(([m]) => m === 'eth_estimateGas')
    ).toHaveLength(1);
    await act(async () => settleEstimate('0x6979')); // 27001
    expect(confirm()).toBeDisabled();
    estimate = '0x6979';
    if (isMax) {
      // After an insufficient custom limit, the editor remains available.
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: 'send.editFee' }))
      );
      const editor = within(screen.getByRole('dialog'));
      expect(editor.getByPlaceholderText('send.maxFee (GWEI)')).toHaveValue(4);
      expect(editor.getByPlaceholderText('send.gasLimit')).toHaveValue(27000);
      fireEvent.change(editor.getByPlaceholderText('send.gasLimit'), {
        target: { value: '28000' },
      });
      // A valid custom fee field can still exceed the MAX spendable balance.
      fireEvent.change(editor.getByPlaceholderText('send.maxFee (GWEI)'), {
        target: { value: '4000000' },
      });
      await act(async () =>
        fireEvent.click(editor.getByRole('button', { name: 'buttons.save' }))
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(confirm()).toBeDisabled();
      const edit = screen.getByRole('button', { name: 'send.editFee' });
      expect(edit).toBeEnabled();
      await act(async () => fireEvent.click(edit));
      const reopened = within(screen.getByRole('dialog'));
      fireEvent.change(reopened.getByPlaceholderText('send.maxFee (GWEI)'), {
        target: { value: '4' },
      });
      await act(async () =>
        fireEvent.click(reopened.getByRole('button', { name: 'buttons.save' }))
      );
    } else {
      estimate = '0x6978'; // 27000
      await retry();
    }
    expect(confirm()).toBeEnabled();
    const refreshes = mockEmitter.mock.calls
      .filter(([path]) => path.at(-1) === 'refreshNativeEvmFeeReview')
      .map(([, args]) => args);
    expect(refreshes[0]).toEqual(approved);
    expect(refreshes[1]).toEqual(
      isMax
        ? [
            {
              ...approved[0],
              gasLimit: '28000',
              value: (
                BigInt(approved[0].value) - BigInt('4000000000000')
              ).toString(),
            },
            false,
            '112000000000000',
            mockScope,
          ]
        : approved
    );
    expect(
      provider.send.mock.calls.filter(([m]) => m === 'eth_estimateGas')
    ).toHaveLength(2);
  }
);
