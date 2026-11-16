jest.mock('syscoinjs-lib', () => ({
  utils: jest.requireActual('syscoinjs-lib/utils'),
}));

import { configureStore } from '@reduxjs/toolkit';

import vaultReducer, { setActiveNetwork } from 'state/vault';
import vaultGlobalReducer, {
  startSwitchNetwork,
  switchNetworkSuccess,
} from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

import BalancesManager from './balances';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: {
    cleanup: jest.fn(),
    notifyAccountChange: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));

const type = KeyringAccountType.HDAccount;
const address = `0x${'11'.repeat(20)}`;
const firstNetwork = {
  chainId: 5700,
  kind: 'ethereum',
  url: 'https://first-rpc.invalid',
  slip44: 60,
};
const nextNetwork = {
  ...firstNetwork,
  chainId: 5701,
  url: 'https://next-rpc.invalid',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flushExecutor = () => new Promise((resolve) => setImmediate(resolve));
let controller: any;
let readBalance: jest.Mock;
let finishNetwork: () => void;
let currentTime: number;

beforeEach(() => {
  currentTime = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeAccount: { type, id: 0 },
        activeNetwork: firstNetwork,
        accounts: {
          ...vault.accounts,
          [type]: {
            0: { id: 0, address, balances: { ethereum: -1 } },
            1: {
              id: 1,
              address: `0x${'22'.repeat(20)}`,
              balances: { ethereum: -1 },
            },
          },
        },
        accountAssets: {
          [type]: { 0: { ethereum: [], syscoin: [] } },
        },
        accountTransactions: {
          [type]: { 0: { ethereum: { 5700: [], 5701: [] }, syscoin: {} } },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  readBalance = jest.fn();
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    assetUpdateRequestId: 0,
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    activeRapidPolls: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    receiptBalanceRefresh: { cancel: jest.fn() },
    cancellablePromises: new CancellablePromises(),
    balancesManager: { utils: { getBalanceUpdatedForAccount: readBalance } },
    performPostAccountSwitchOperations: jest.fn(),
    resetAutoLockTimer: jest.fn(),
    getActiveKeyring: () => ({
      isUnlocked: () => true,
      ethereumTransaction: { web3Provider: {} },
    }),
    // Isolate network configuration I/O while retaining the public switch's
    // real cancellation order and the real reducers used by its helpers.
    setActiveNetworkLogic: (network: any, resolve: () => void) => {
      mockStore.dispatch(startSwitchNetwork(network));
      finishNetwork = resolve;
    },
    handleNetworkChangeSuccess: async (network: any) => {
      mockStore.dispatch(setActiveNetwork(network));
      mockStore.dispatch(switchNetworkSuccess());
    },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

const refresh = (isPolling = false) =>
  controller.getLatestUpdateForCurrentAccount(isPolling, true, false, true);
const directRead = () =>
  controller.updateUserNativeBalance({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });

it.each(
  [false, true].flatMap((isPolling) =>
    ['success', 'error'].map((outcome) => ({ isPolling, outcome }))
  )
)(
  'preserves current balance $outcome feedback (polling=$isPolling)',
  async ({ isPolling, outcome }) => {
    mockStore.dispatch(startSwitchNetwork(firstNetwork as any));
    if (outcome === 'success') readBalance.mockResolvedValue('2');
    else readBalance.mockRejectedValue(new Error('Current RPC unavailable'));
    await refresh(isPolling);
    const { vault, vaultGlobal } = mockStore.getState();
    expect(vaultGlobal.networkStatus).toBe(
      outcome === 'success' ? 'idle' : isPolling ? 'switching' : 'error'
    );
    expect(vaultGlobal.loadingStates.isLoadingBalances).toBe(false);
    expect(vaultGlobal.isPostNetworkSwitchLoading).toBe(false);
    expect(vault.accounts[type][0].balances.ethereum).toBe(
      outcome === 'success' ? '2' : -1
    );
  }
);

it.each([nextNetwork, firstNetwork])(
  'does not mark the requested $chainId network as failed when it cancels an old foreground balance',
  async (network) => {
    const old = deferred<string>();
    readBalance.mockReturnValue(old.promise);
    const previous = refresh();
    const switching = controller.setActiveNetwork(network);
    try {
      expect(mockStore.getState().vaultGlobal.networkStatus).toBe('switching');
      await previous;
      expect(mockStore.getState().vaultGlobal.networkStatus).toBe('switching');
      expect(mockStore.getState().vaultGlobal.networkTarget).toEqual(
        expect.objectContaining(network)
      );
      expect(mockStore.getState().vaultGlobal.isPostNetworkSwitchLoading).toBe(
        true
      );
    } finally {
      finishNetwork();
      await switching;
      old.resolve('99');
      await flushExecutor();
    }
    readBalance.mockResolvedValue('2');
    await refresh();
    expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
    expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
      '2'
    );
  }
);

it('keeps a new same-chain account active when its switch cancels the old foreground balance', async () => {
  const old = deferred<string>();
  readBalance.mockReturnValue(old.promise);
  const previous = refresh();
  await controller.setAccount(1, type);
  await previous;
  expect(mockStore.getState().vault.activeAccount).toEqual({ type, id: 1 });
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
  old.resolve('99');
  await flushExecutor();
  expect(
    mockStore.getState().vault.accounts[type][1].balances.syscoin
  ).toBeUndefined();
});

it('does not clear a new switch when an older overwritten balance wrapper resolves as stale', async () => {
  const old = deferred<string>();
  const latest = deferred<string>();
  readBalance
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  const previous = refresh();
  const newer = directRead().catch(() => undefined);
  // Ordinary polling/foreground overlap replaces only the stored wrapper.
  const switching = controller.setActiveNetwork(nextNetwork);
  try {
    await newer;
    old.resolve('99');
    await previous;
    expect(mockStore.getState().vaultGlobal.networkStatus).toBe('switching');
    expect(mockStore.getState().vaultGlobal.networkTarget).toEqual(
      expect.objectContaining(nextNetwork)
    );
    expect(mockStore.getState().vaultGlobal.isPostNetworkSwitchLoading).toBe(
      true
    );
  } finally {
    finishNetwork();
    await switching;
    latest.resolve('1');
    await flushExecutor();
  }
});

it.each(['success', 'error'])(
  'does not change the new network quality when cancelled old RPC later returns %s',
  async (outcome) => {
    const old = deferred<string>();
    readBalance.mockReturnValueOnce(old.promise).mockResolvedValue('2');
    const cancelled = directRead().catch(() => undefined);
    const switching = controller.setActiveNetwork(nextNetwork);
    finishNetwork();
    await switching;
    await cancelled;
    await directRead();
    const quality = mockStore.getState().vaultGlobal.networkQuality;
    expect(quality.hasCriticalErrors).toBe(false);
    currentTime += 15000;
    if (outcome === 'success') old.resolve('99');
    else old.reject(new Error('Old RPC disconnected'));
    await flushExecutor();
    expect(mockStore.getState().vaultGlobal.networkQuality).toEqual(quality);
    expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
      '2'
    );
  }
);

it('preserves a stale native error and stops its asset preflight without changing current quality', async () => {
  const old = deferred<string>();
  const replacement = deferred<string>();
  const failure = new Error('Original old RPC failure');
  readBalance
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(replacement.promise)
    .mockResolvedValue('2');
  controller.updateAssetsFromCurrentAccount = jest
    .fn()
    .mockResolvedValue(undefined);
  controller.refreshActiveEvmTokenBalance = jest
    .fn()
    .mockResolvedValue(undefined);
  const preflight = controller.refreshActiveAccountBalances({
    includeAssets: true,
    isPolling: true,
    targetEvmTokenContractAddress: `0x${'33'.repeat(20)}`,
  });
  const rejected = expect(preflight).rejects.toBe(failure);
  // A newer read replaces the stored cancellation target, leaving the older
  // preflight to observe its original RPC failure after the network changes.
  const newer = directRead().catch(() => undefined);
  const switching = controller.setActiveNetwork(nextNetwork);
  finishNetwork();
  await switching;
  await newer;
  await directRead();
  const quality = mockStore.getState().vaultGlobal.networkQuality;
  currentTime += 15000;
  old.reject(failure);
  await rejected;
  expect(controller.updateAssetsFromCurrentAccount).not.toHaveBeenCalled();
  expect(controller.refreshActiveEvmTokenBalance).not.toHaveBeenCalled();
  expect(mockStore.getState().vaultGlobal.networkQuality).toEqual(quality);
  expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
    '2'
  );
  replacement.resolve('99');
  await flushExecutor();
});

it.each(['success', 'error'])(
  'keeps a silent balance refresh out of global loading on %s',
  async (outcome) => {
    const read = deferred<string>();
    readBalance.mockReturnValue(read.promise);
    const request = controller.refreshActiveAccountBalances({
      showLoading: false,
    });
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(false);
    if (outcome === 'success') {
      read.resolve('2');
      await expect(request).resolves.toMatchObject({ nativeBalance: '2' });
      expect(
        mockStore.getState().vault.accounts[type][0].balances.ethereum
      ).toBe('2');
    } else {
      read.reject(new Error('Balance unavailable'));
      await expect(request).rejects.toThrow('Balance unavailable');
    }
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(false);
  }
);

it('still checks the unlocked keyring for a silent foreground balance refresh', async () => {
  controller.getActiveKeyring = jest.fn(() => ({ isUnlocked: () => false }));
  await controller.refreshActiveAccountBalances({ showLoading: false });
  expect(controller.getActiveKeyring).toHaveBeenCalled();
  expect(readBalance).not.toHaveBeenCalled();
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
});

it.each(['success', 'error'])(
  'does not release another foreground load when a silent refresh returns %s',
  async (outcome) => {
    const foreground = deferred<string>();
    const silent = deferred<string>();
    readBalance
      .mockReturnValueOnce(foreground.promise)
      .mockReturnValueOnce(silent.promise);
    const loading = controller.refreshActiveAccountBalances();
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(true);
    const refreshing = controller.refreshActiveAccountBalances({
      showLoading: false,
    });
    if (outcome === 'success') {
      silent.resolve('2');
      await refreshing;
    } else {
      silent.reject(new Error('Balance unavailable'));
      await expect(refreshing).rejects.toThrow('Balance unavailable');
    }
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(true);
    foreground.resolve('1');
    await loading;
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(false);
  }
);

it('does not reacquire loading when an older silent refresh finishes after a foreground read', async () => {
  const silent = deferred<string>();
  const foreground = deferred<string>();
  readBalance
    .mockReturnValueOnce(silent.promise)
    .mockReturnValueOnce(foreground.promise);
  const refreshing = controller.refreshActiveAccountBalances({
    showLoading: false,
  });
  const loading = controller.refreshActiveAccountBalances();
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    true
  );
  foreground.resolve('2');
  await loading;
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
  silent.resolve('1');
  await refreshing;
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
  expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
    '2'
  );
});

it('keeps polling silent even when loading presentation is requested', async () => {
  const read = deferred<string>();
  readBalance.mockReturnValue(read.promise);
  const request = controller.refreshActiveAccountBalances({
    isPolling: true,
    showLoading: true,
  });
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
  read.resolve('2');
  await request;
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
});

it('retires the selected UTXO balance subscriber during an account switch', async () => {
  const utxoNetwork = {
    ...firstNetwork,
    kind: 'syscoin',
    chainId: 57,
    slip44: 57,
  };
  mockStore.dispatch(setActiveNetwork(utxoNetwork as any));
  const accounts = mockStore.getState().vault.accounts;
  mockStore.dispatch({
    type: 'vault/setAccounts',
    payload: {
      ...accounts,
      [type]: {
        ...accounts[type],
        0: {
          ...accounts[type][0],
          address: 'syscoin-account-a',
          xpub: 'zpub-account-a',
        },
        1: {
          ...accounts[type][1],
          address: 'syscoin-account-b',
          xpub: 'zpub-account-b',
        },
      },
    },
  });
  let signal!: AbortSignal;
  const held = deferred<string>();
  readBalance.mockImplementation((_account, _utxo, _url, owner) => {
    signal = owner.signal;
    return held.promise;
  });
  const pending = controller.updateUserNativeBalance({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: utxoNetwork,
    isBitcoinBased: true,
    isPolling: true,
  });
  const rejected = expect(pending).rejects.toBeDefined();
  expect(signal.aborted).toBe(false);
  await controller.setAccount(1, type);
  await rejected;
  expect(signal.aborted).toBe(true);
  held.resolve('99');
  await flushExecutor();
  expect(mockStore.getState().vault.accounts[type][1].balances.ethereum).toBe(
    -1
  );
});

it('stops the retired account HTTP retry through the real balance manager and SJS cache', async () => {
  const originalFetch = global.fetch;
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const utxoNetwork = {
    ...firstNetwork,
    kind: 'syscoin',
    chainId: 57,
    slip44: 57,
  };
  mockStore.dispatch(setActiveNetwork(utxoNetwork as any));
  const accounts = mockStore.getState().vault.accounts;
  mockStore.dispatch({
    type: 'vault/setAccounts',
    payload: {
      ...accounts,
      [type]: {
        0: {
          ...accounts[type][0],
          address: 'syscoin-account-a',
          xpub: 'zpub-account-a',
        },
        1: {
          ...accounts[type][1],
          address: 'syscoin-account-b',
          xpub: 'zpub-account-b',
        },
      },
    },
  });
  let release!: (response: Response) => void;
  let physical!: AbortSignal;
  global.fetch = jest.fn(async (_url, init) => {
    physical = init?.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  controller.balancesManager = BalancesManager();
  try {
    const pending = controller.updateUserNativeBalance({
      activeAccount: mockStore.getState().vault.activeAccount,
      activeNetwork: utxoNetwork,
      isBitcoinBased: true,
      isPolling: true,
    });
    const rejection = expect(pending).rejects.toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await controller.setAccount(1, type);
    await rejection;
    expect(physical.aborted).toBe(true);
    release(new Response('{}', { status: 429 }));
    await jest.advanceTimersByTimeAsync(2000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally {
    clearFetchBackendAccountCache();
    global.fetch = originalFetch;
    jest.useRealTimers();
  }
});

it('retires every overlapping selected balance owner before account departure', async () => {
  const barrier = deferred<void>();
  const addressReads: string[] = [];
  const signals: AbortSignal[] = [];
  readBalance.mockImplementation(async (account, _utxo, _url, owner) => {
    signals.push(owner.signal);
    await barrier.promise;
    owner.assertCurrent();
    addressReads.push(account.address);
    return '5';
  });
  const first = directRead().catch(() => undefined);
  const second = directRead().catch(() => undefined);
  expect(signals).toHaveLength(2);
  await controller.setAccount(1, type);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  barrier.resolve();
  await Promise.all([first, second]);
  expect(addressReads).toEqual([]);
  expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
    -1
  );
});

it('checks the captured native read version before dispatching an address read', async () => {
  const barrier = deferred<void>();
  const addressReads: string[] = [];
  readBalance.mockImplementation(async (account, _utxo, _url, owner) => {
    await barrier.promise;
    owner.assertCurrent();
    addressReads.push(account.address);
    return '5';
  });
  const pending = directRead().catch(() => undefined);
  controller.nativeBalanceRevision++;
  barrier.resolve();
  await pending;
  expect(addressReads).toEqual([]);
});

it.each(['foreground', 'direct'])(
  'preserves a newer successful %s read when an older foreground fails its freshness guard',
  async (newer) => {
    const old = deferred<void>();
    readBalance
      .mockImplementationOnce(async (_account, _utxo, _url, owner) => {
        await old.promise;
        owner.assertCurrent();
        return '99';
      })
      .mockResolvedValueOnce('2');
    const previous = refresh();
    await (newer === 'foreground' ? refresh() : directRead());
    const healthy = mockStore.getState().vaultGlobal;
    expect(healthy.networkStatus).toBe('idle');
    old.resolve();
    await previous;
    expect(mockStore.getState().vaultGlobal).toMatchObject({
      networkStatus: healthy.networkStatus,
      networkQuality: healthy.networkQuality,
    });
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(false);
    expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
      '2'
    );
  }
);

it('preserves a newer successful account-card read when an older foreground fails its freshness guard', async () => {
  const old = deferred<void>();
  readBalance
    .mockImplementationOnce(async (_account, _utxo, _url, owner) => {
      await old.promise;
      owner.assertCurrent();
      return '99';
    })
    .mockResolvedValueOnce('2');
  const previous = refresh();
  await expect(
    controller.getBalanceForAccount(
      { ...mockStore.getState().vault.accounts[type][0], id: 0 },
      type,
      firstNetwork
    )
  ).resolves.toBe('2');
  const healthy = mockStore.getState().vaultGlobal;
  old.resolve();
  await previous;
  expect(mockStore.getState().vaultGlobal).toMatchObject({
    networkStatus: healthy.networkStatus,
    networkQuality: healthy.networkQuality,
  });
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
  expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
    '2'
  );
});

it('preserves a newer foreground failure when an older transport returns a successful result', async () => {
  const old = deferred<string>();
  readBalance
    .mockReturnValueOnce(old.promise)
    .mockRejectedValueOnce(new Error('Current RPC unavailable'));
  const previous = refresh();
  await refresh();
  const failed = mockStore.getState().vaultGlobal;
  expect(failed.networkStatus).toBe('error');
  old.resolve('99');
  await previous;
  expect(mockStore.getState().vaultGlobal).toEqual(failed);
  expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
    -1
  );
});

it('preserves a newer account-card failure when an older transport returns a successful result', async () => {
  const old = deferred<string>();
  const failure = new Error('Current RPC unavailable');
  readBalance.mockReturnValueOnce(old.promise).mockRejectedValueOnce(failure);
  const previous = refresh();
  await expect(
    controller.getBalanceForAccount(
      { ...mockStore.getState().vault.accounts[type][0], id: 0 },
      type,
      firstNetwork
    )
  ).rejects.toBe(failure);
  const beforeOld = mockStore.getState().vaultGlobal;
  old.resolve('99');
  await previous;
  expect(mockStore.getState().vaultGlobal).toMatchObject({
    networkStatus: beforeOld.networkStatus,
    networkQuality: beforeOld.networkQuality,
  });
  expect(mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances).toBe(
    false
  );
  expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
    -1
  );
});

it('returns the current balance without asset work after a superseded successful preflight', async () => {
  const old = deferred<string>();
  readBalance.mockReturnValueOnce(old.promise).mockResolvedValueOnce('2');
  controller.updateAssetsFromCurrentAccount = jest.fn();
  controller.refreshActiveEvmTokenBalance = jest.fn();
  const previous = controller.refreshActiveAccountBalances({
    includeAssets: true,
    targetEvmTokenContractAddress: `0x${'33'.repeat(20)}`,
  });
  await directRead();
  old.resolve('99');
  await expect(previous).resolves.toEqual({
    assetsUpdated: false,
    nativeBalance: '2',
  });
  expect(controller.updateAssetsFromCurrentAccount).not.toHaveBeenCalled();
  expect(controller.refreshActiveEvmTokenBalance).not.toHaveBeenCalled();
});
