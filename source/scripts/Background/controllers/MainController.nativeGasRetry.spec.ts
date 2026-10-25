import { RpcResponseIntegrityError } from '@sidhujag/sysweb3-keyring/cjs/providers';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';

import { BigNumber } from 'utils/ethersV6Compat';
import { getWalletNavigationScope } from 'utils/navigationState';

import MainController from './MainController';

jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  EthereumTransactions: jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum'
  ).EthereumTransactions,
  KeyringManager: jest.fn(() => {
    throw new Error('Keyring construction forbidden');
  }),
  CustomJsonRpcProvider: jest.fn((signal: AbortSignal) => {
    const provider = {
      signal,
      destroy: jest.fn(),
      estimateGas: jest.fn(
        (tx: any) =>
          new Promise((resolve, reject) => {
            const aborted = () =>
              reject(new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) aborted();
            else Promise.resolve(mockEstimate(tx)).then(resolve, reject);
          })
      ),
    };
    mockFreshProviders.push(provider);
    return provider;
  }),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    subscribe: (listener: () => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
    dispatch: jest.fn(() => {
      throw new Error('State mutation forbidden');
    }),
  },
}));
let mockState: any;
let mockEstimate: jest.Mock;
let mockFreshProviders: any[];
const mockListeners = new Set<() => void>();
const ADDRESS = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const tx = { from: ADDRESS, to: TO, value: '0x1', data: '0x' };
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let wallet: any, keyring: any, sdk: EthereumTransactions, originalProvider: any;
let unlocked: boolean;
let readSecrets: jest.Mock;
const run = (input = tx, scope = getWalletNavigationScope()) =>
  wallet.getFreshNativeEvmGasLimit(input, scope);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(global, 'fetch').mockImplementation(async () => {
    throw new Error('Network forbidden');
  });
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeNetwork: {
        kind: 'ethereum',
        chainId: 5700,
        slip44: 60,
        url: 'https://synthetic.invalid',
      },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: ADDRESS, xpub: 'public-only' } } },
    },
    vaultGlobal: {
      activeSlip44: 60,
      networkStatus: 'connected',
      isSwitchingAccount: false,
    },
  };
  mockEstimate = jest.fn().mockResolvedValue(BigNumber.from(21000));
  mockFreshProviders = [];
  unlocked = true;
  readSecrets = jest.fn(() => {
    throw new Error('Signing forbidden');
  });
  originalProvider = {
    signal: new AbortController().signal,
    estimateGas: jest.fn(() => {
      throw new Error('Shared provider must stay untouched');
    }),
  };
  sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    readSecrets,
    readSecrets as any,
    undefined as never,
    undefined as never
  );
  Object.defineProperty(sdk, 'web3Provider', { get: () => originalProvider });
  sdk.setGasOverrides({ minGasLimit: '35000' });
  keyring = { ethereumTransaction: sdk, isUnlocked: () => unlocked };
  wallet = Object.create(MainController.prototype);
  wallet.getActiveKeyring = () => keyring;
  wallet.getWalletSetupStatus = () => undefined;
  wallet.isUnlocked = () => unlocked;
  wallet.walletSessionGeneration = 11;
  wallet.walletStateGeneration = 19;
  wallet.isResettingWallet = false;
});
afterEach(() => {
  expect(mockListeners.size).toBe(0);
  expect(readSecrets).not.toHaveBeenCalled();
  expect(originalProvider.estimateGas).not.toHaveBeenCalled();
  for (const provider of mockFreshProviders)
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('uses the same SDK floor and exact tx through a fresh read-only provider', async () => {
  await expect(run()).resolves.toEqual(BigNumber.from(35000));
  expect(mockFreshProviders).toHaveLength(1);
  expect(mockEstimate).toHaveBeenCalledWith(tx);
  expect(sdk.web3Provider).toBe(originalProvider);
});
it('uses the same SDK20 percent buffer above the configured floor', async () => {
  mockEstimate.mockResolvedValue(BigNumber.from(50000));
  await expect(run()).resolves.toEqual(BigNumber.from(60000));
});
it('retains actual SDK generic-error fallback and rejects integrity failure', async () => {
  mockEstimate.mockRejectedValue(new Error('Ordinary estimate unavailable'));
  await expect(run()).resolves.toEqual(BigNumber.from(35000));
  expect(mockEstimate).toHaveBeenCalledTimes(2);
  mockEstimate
    .mockClear()
    .mockRejectedValue(new RpcResponseIntegrityError('Bad correlation', false));
  await expect(run()).rejects.toHaveProperty(
    'code',
    'SYSWEB3_RPC_RESPONSE_INVALID'
  );
  expect(mockEstimate).toHaveBeenCalledTimes(1);
});
it.each(['0x1', '0x100', '0x10000'])(
  'retains exact refined MAX estimate value %s',
  async (value) => {
    await run({ ...tx, value });
    expect(mockEstimate).toHaveBeenLastCalledWith({ ...tx, value });
  }
);
it.each([
  'account',
  'network',
  'slip44',
  'session',
  'state',
  'keyring',
  'provider',
  'locked',
  'reset',
  'overrides',
])('rejects stale %s before publishing the quote', async (change) => {
  const pending = deferred();
  mockEstimate.mockReturnValue(pending.promise);
  const result = run();
  const rejection = expect(result).rejects.toBeDefined();
  await flush();
  if (change === 'account')
    mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
  if (change === 'network')
    mockState.vault.activeNetwork.url = 'https://other.invalid';
  if (change === 'slip44') mockState.vaultGlobal.activeSlip44 = 1;
  if (change === 'session') wallet.walletSessionGeneration++;
  if (change === 'state') wallet.walletStateGeneration++;
  if (change === 'keyring') keyring = { ...keyring };
  if (change === 'provider')
    originalProvider = {
      ...originalProvider,
      signal: new AbortController().signal,
    };
  if (change === 'locked') unlocked = false;
  if (change === 'reset') wallet.isResettingWallet = true;
  if (change === 'overrides') sdk.setGasOverrides({ minGasLimit: '45000' });
  for (const notify of mockListeners) notify();
  pending.resolve(BigNumber.from(21000));
  await rejection;
});
it('aborts on the existing provider lifecycle and disposes without a quote', async () => {
  const lifetime = new AbortController();
  originalProvider.signal = lifetime.signal;
  mockEstimate.mockReturnValue(new Promise(() => undefined));
  const result = run();
  const rejection = expect(result).rejects.toBeDefined();
  await flush();
  lifetime.abort();
  await rejection;
});
it('keeps the10second boundary and never automatically starts another SDK invocation', async () => {
  mockEstimate.mockReturnValue(new Promise(() => undefined));
  const result = run();
  const rejection = expect(result).rejects.toBeDefined();
  await flush();
  await jest.advanceTimersByTimeAsync(9999);
  expect(mockFreshProviders).toHaveLength(1);
  expect(mockFreshProviders[0].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await rejection;
  expect(mockFreshProviders[0].signal.aborted).toBe(true);
  expect(mockEstimate).toHaveBeenCalledTimes(1);
});
it.each([
  [{ ...tx, from: TO }, undefined],
  [{ ...tx, data: '0x1234' }, undefined],
  [tx, { account: 'old', network: 'old' }],
])(
  'rejects inadmissible retry before constructing a reader',
  async (input, scope) => {
    await expect(run(input as typeof tx, scope as any)).rejects.toBeDefined();
    expect(mockFreshProviders).toHaveLength(0);
  }
);

it('preserves no-override SDK success25200 and generic-error fallback100000', async () => {
  sdk.setGasOverrides({});
  await expect(run()).resolves.toEqual(BigNumber.from(25200));
  mockEstimate.mockRejectedValue(new Error('Ordinary estimate unavailable'));
  await expect(run()).resolves.toEqual(BigNumber.from(100000));
});

it.each(['account', 'network'])(
  'keeps %s A-to-B-to-A invalidation sticky',
  async (change) => {
    const pending = deferred();
    mockEstimate.mockReturnValue(pending.promise);
    const result = run();
    const rejected = expect(result).rejects.toBeDefined();
    await flush();
    const beforeAccount = mockState.vault.activeAccount;
    const beforeNetwork = mockState.vault.activeNetwork;
    if (change === 'account')
      mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
    else
      mockState.vault.activeNetwork = {
        ...beforeNetwork,
        url: 'https://other.invalid',
      };
    for (const notify of mockListeners) notify();
    expect(mockFreshProviders[0].signal.aborted).toBe(true);
    mockState.vault.activeAccount = beforeAccount;
    mockState.vault.activeNetwork = beforeNetwork;
    for (const notify of mockListeners) notify();
    pending.resolve(BigNumber.from(21000));
    await rejected;
  }
);

it('fails closed without the installed SDK gas-policy accessor', async () => {
  Object.defineProperty(sdk, 'getGasOverrides', { value: undefined });
  await expect(run()).rejects.toThrow('SDK gas policy is unavailable');
  expect(mockFreshProviders).toHaveLength(0);
});
it('fails closed when an incompatible accessor returns a pending policy', async () => {
  Object.defineProperty(sdk, 'getGasOverrides', {
    value: () => Promise.resolve({}),
  });
  await expect(run()).rejects.toThrow('SDK gas policy is unavailable');
  expect(mockFreshProviders).toHaveLength(0);
});

it.each(['resolve', 'reject'])(
  'consumes and refuses a %s thenable with its original receiver',
  async (outcome) => {
    let receiver: unknown;
    const policy = {
      then(
        resolve: (value: unknown) => void,
        reject: (reason: unknown) => void
      ) {
        receiver = this;
        if (outcome === 'resolve') resolve({});
        else reject(new Error('Async policy failed'));
      },
    };
    Object.defineProperty(sdk, 'getGasOverrides', {
      value: function (this: EthereumTransactions) {
        expect(this).toBe(sdk);
        return policy;
      },
    });
    await expect(run()).rejects.toThrow('SDK gas policy is unavailable');
    await flush();
    expect(receiver).toBe(policy);
    expect(mockFreshProviders).toHaveLength(0);
  }
);

it('consumes a rejected async policy without an unhandled rejection', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    Object.defineProperty(sdk, 'getGasOverrides', {
      value: async function (this: EthereumTransactions) {
        expect(this).toBe(sdk);
        throw new Error('Async policy failed');
      },
    });
    await expect(run()).rejects.toThrow('SDK gas policy is unavailable');
    await jest.advanceTimersByTimeAsync(0);
    await flush();
    expect(unhandled).not.toHaveBeenCalled();
    expect(mockFreshProviders).toHaveLength(0);
  } finally {
    process.removeListener('unhandledRejection', unhandled);
  }
});
