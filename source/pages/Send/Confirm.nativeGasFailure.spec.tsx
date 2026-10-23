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
} from '@testing-library/react';
import React from 'react';

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
  price: { fiat: { asset: 'USD' } },
};
const mockLocation: any = {
  key: 'native-gas-entry',
  pathname: '/send/confirm',
  state: { submissionStarted: false, walletScope: mockScope },
};
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
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
  selectEnsNameToAddress: () => ({}),
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
  globalThis.ResizeObserver = previousGlobals.ResizeObserver;
  globalThis.MessageChannel = previousGlobals.MessageChannel;
  window.matchMedia = previousGlobals.matchMedia;
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  gasOutcomes.length = 0;
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
    getGasPrice: jest.fn().mockResolvedValue(BigNumber.from(1000000000)),
    getBlock: jest.fn(async () => block()),
    estimateGas: jest.fn().mockResolvedValue(BigNumber.from(21000)),
    send: jest.fn(async (method: string) => {
      if (method === 'eth_getBlockByNumber') return block();
      if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
      throw new Error(`Unexpected RPC ${method}`);
    }),
  };
  sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    () => {
      throw new Error('Signing is forbidden in native gas read tests');
    },
    () => ({
      ...mockState.vault,
      activeAccountType: 'HDAccount',
      activeAccountId: 0,
    })
  );
  Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
  wallet = Object.create(MainController.prototype);
  wallet.getActiveKeyring = () => ({ ethereumTransaction: sdk });
  mockEmitter.mockImplementation(
    async (methods: string[], params: any[] = []) => {
      // No mocked getTxGasLimit result: traverse the actual MainController getter
      // and installed SDK implementation; only provider read outcomes vary.
      const allowed = [
        'getCurrentBlock',
        'getRecommendedGasPrice',
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getTxGasLimit',
      ];
      const method = methods.at(-1)!;
      if (!allowed.includes(method))
        throw new Error('Forbidden controller operation: ' + method);
      let target: any = { wallet };
      for (const name of methods.slice(0, -1)) target = target[name];
      try {
        const value = await target[method](...params);
        if (method === 'getTxGasLimit')
          gasOutcomes.push({ state: 'resolved', value: value.toString() });
        return value;
      } catch (error) {
        if (method === 'getTxGasLimit')
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
    render(<SendConfirm />);
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
    expect(provider.estimateGas).toHaveBeenCalledTimes(1);
    assertHealthyQuote(mode, 25200);
  });

  it('healthy SDK successful simple-estimate fallback is not replaced by the UI default', async () => {
    provider.estimateGas
      .mockRejectedValueOnce(new Error('Synthetic ordinary estimate rejection'))
      .mockResolvedValueOnce(BigNumber.from(30000));
    await mount(mode);
    expect(provider.estimateGas).toHaveBeenCalledTimes(2);
    assertHealthyQuote(mode, 45000);
  });

  it('retains the SDK legitimate resolved generic-error fallback100000', async () => {
    provider.estimateGas.mockRejectedValue(
      new Error('Synthetic ordinary estimates unavailable')
    );
    await mount(mode);
    expect(provider.estimateGas).toHaveBeenCalledTimes(2);
    assertHealthyQuote(mode, 100000);
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
