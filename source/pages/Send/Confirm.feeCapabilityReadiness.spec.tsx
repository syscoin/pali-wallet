/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import MainController from 'scripts/Background/controllers/MainController';
import { BigNumber } from 'utils/ethersV6Compat';

import { SendConfirm } from './Confirm';

const { EthereumTransactions } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum'
);
const mockEmitter = jest.fn();
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockScope = { account: 'fee-account', network: 'fee-network' };
const mockState: any = {
  vault: {
    activeNetwork: {
      kind: 'ethereum',
      chainId: 89000,
      currency: 'TEST',
      url: 'https://fee-capability.invalid',
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
  key: 'fee-capability',
  pathname: '/send/confirm',
  state: {
    submissionStarted: false,
    walletScope: mockScope,
    tx: {
      sender: '0x1111111111111111111111111111111111111111',
      receivingAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
      transactionType: 'NATIVE_ETH',
      defaultGasLimit: 21000,
    },
  },
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

const previousGlobals = {
  ResizeObserver: globalThis.ResizeObserver,
  MessageChannel: globalThis.MessageChannel,
  matchMedia: window.matchMedia,
};
let sdk: any;
let provider: any;
let wallet: any;
let capability: ReturnType<typeof deferred> | undefined;
let london: boolean;
const block = () => ({
  gasLimit: BigNumber.from(30000000),
  ...(london ? { baseFeePerGas: BigNumber.from(1000000000) } : {}),
});
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
const confirm = () => screen.getByRole('button', { name: 'buttons.confirm' });
const renderConfirm = async () => {
  await act(async () => {
    render(<SendConfirm />);
  });
};
const advance = (ms = 600) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
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
  capability = undefined;
  london = false;
  mockState.vault.activeNetwork.chainId += 1;
  mockLocation.key += '-next';
  delete mockLocation.state.tx.cachedGasData;
  window.history.replaceState(null, '', '/');
  provider = {
    getGasPrice: jest.fn().mockResolvedValue(BigNumber.from(1000000000)),
    getBlock: jest.fn(async () => block()),
    estimateGas: jest.fn().mockResolvedValue(BigNumber.from(21000)),
    send: jest.fn(async (method: string) => {
      if (method === 'eth_getBlockByNumber')
        return capability?.promise ?? block();
      if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
      throw new Error(`Unexpected RPC ${method}`);
    }),
  };
  sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    () => {
      throw new Error('Signing is not allowed in this test');
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
  mockEmitter.mockImplementation((path: string[], args: any[] = []) => {
    let target: any = { wallet };
    for (const key of path.slice(0, -1)) target = target[key];
    return target[path[path.length - 1]](...args);
  });
});
afterEach(() => {
  sdk._web3Provider?.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('waits for a slow legacy capability read before interpreting actual SDK legacy fees', async () => {
  capability = deferred();
  const fees = await sdk.getFeeDataWithDynamicMaxPriorityFeePerGas();
  expect(fees.gasPrice.toString()).toBe('1000000000');
  expect(fees.maxFeePerGas.isZero()).toBe(true);
  expect(fees.maxPriorityFeePerGas.isZero()).toBe(true);
  await renderConfirm();
  await advance();
  expect(confirm()).toBeDisabled();
  await act(async () => capability!.resolve(block()));
  await advance();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(confirm()).toBeEnabled();
  expect(mockEmitter).toHaveBeenCalledWith([
    'wallet',
    'ethereumTransaction',
    'getRecommendedGasPrice',
  ]);
});

it('keeps a fast legacy capability and its ordinary SDK quote usable', async () => {
  await renderConfirm();
  await advance();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(confirm()).toBeEnabled();
  expect(provider.estimateGas).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'waits for modern capability before using a quote (prefetched: %s)',
  async (prefetched) => {
    london = true;
    capability = deferred();
    if (prefetched) {
      mockLocation.state.tx.cachedGasData = {
        maxFeePerGas: '0xb2d05e00',
        maxPriorityFeePerGas: '0x3b9aca00',
      };
    }
    await renderConfirm();
    expect(confirm()).toBeDisabled();
    await advance();
    expect(confirm()).toBeDisabled();
    expect(provider.getGasPrice).not.toHaveBeenCalled();
    expect(provider.estimateGas).not.toHaveBeenCalled();
    await act(async () => capability!.resolve(block()));
    await advance();
    expect(screen.queryByText('send.unableToLoad')).toBeNull();
    expect(confirm()).toBeEnabled();
  }
);

it('keeps a fast modern capability and its ordinary SDK quote usable', async () => {
  london = true;
  await renderConfirm();
  await advance();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(confirm()).toBeEnabled();
  expect(provider.getGasPrice).toHaveBeenCalledTimes(1);
  expect(provider.estimateGas).toHaveBeenCalledTimes(1);
});

it('retains the existing legacy fallback when the capability RPC fails', async () => {
  capability = deferred();
  await renderConfirm();
  await act(async () =>
    capability!.reject(new Error('Synthetic block RPC failure'))
  );
  await advance();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(confirm()).toBeEnabled();
  expect(mockEmitter).toHaveBeenCalledWith([
    'wallet',
    'ethereumTransaction',
    'getRecommendedGasPrice',
  ]);
});

it('retains a fee transport error and recovers only after an explicit retry', async () => {
  london = true;
  provider.getGasPrice.mockRejectedValueOnce(
    new Error('Synthetic fee RPC failure')
  );
  await renderConfirm();
  await advance();
  expect(screen.getAllByText('send.unableToLoad').length).toBeGreaterThan(0);
  expect(confirm()).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: 'reload' })[0]);
  await advance();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(confirm()).toBeEnabled();
});
