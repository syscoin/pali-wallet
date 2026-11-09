import { combineReducers, configureStore } from '@reduxjs/toolkit';

import DAppController from '../DAppController';
import { waitForExternalWalletClosure } from '../externalWalletCreation';
import dappReducer, { addDApp, removeDApp } from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';

import { onMessage } from './index';
import { getMethodConfig } from './method-registry';
import { popupPromise } from './popup-promise';
import {
  getPipelineInstance,
  MAX_REQUESTS_PER_ORIGIN,
  requestCoordinator,
} from './request-pipeline';
import { MethodRoute } from './types';

let mockStore: any;
let mockController: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
    subscribe: (listener: () => void) => mockStore.subscribe(listener),
  },
  dappPermissionPort: {
    assertWritable: () => undefined,
    exclusive: (operation: () => Promise<unknown>) =>
      jest
        .requireActual('utils/asyncMutex')
        .walletPersistenceMutex.runExclusive(operation),
    read: () => ({
      dapps: mockStore.getState().dapp.dapps,
      pendingOrigins: mockStore.getState().dapp.pendingOrigins ?? [],
    }),
    write: jest.fn().mockResolvedValue(undefined),
    publish: (frame: any) =>
      mockStore.dispatch({
        type: 'dapp/rehydrate',
        payload: {
          dapps: { ...frame.dapps },
          pendingOrigins: [...frame.pendingOrigins],
        },
      }),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));
// Popup rendering is mocked in this suite, so no browser view remains.
jest.mock('../externalWalletCreation', () => ({
  waitForExternalWalletClosure: jest.fn().mockResolvedValue(undefined),
}));

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const READ_HOST = 'https://public-read.invalid';
const CONNECTED_HOST = 'https://connected.invalid';
const OTHER_HOST = 'https://other-connected.invalid';
const removedListeners = new Set<(id: number) => void>();
const updatedListeners = new Set<(...args: any[]) => void>();
let unlocked: boolean;
let sessionGeneration: number;
let transport: jest.Mock;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const request = (method: string, host = READ_HOST, tabId = 1, params?: any[]) =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params } }, {
    url: `${host}/page`,
    origin: host,
    documentId: `site-document-${tabId}`,
    tab: { id: tabId },
  } as chrome.runtime.MessageSender);
const closeTab = (tabId: number) => {
  for (const listener of [...removedListeners]) listener(tabId);
};
const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  removedListeners.clear();
  updatedListeners.clear();
  Object.assign(chrome, {
    tabs: {
      onRemoved: {
        addListener: (listener: (id: number) => void) =>
          removedListeners.add(listener),
        removeListener: (listener: (id: number) => void) =>
          removedListeners.delete(listener),
      },
      onUpdated: {
        addListener: (listener: (...args: any[]) => void) =>
          updatedListeners.add(listener),
        removeListener: (listener: (...args: any[]) => void) =>
          updatedListeners.delete(listener),
      },
    },
  });
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const vaultGlobal = vaultGlobalReducer(undefined, { type: 'test/init' });
  const type = KeyringAccountType.HDAccount;
  mockStore = configureStore({
    reducer: combineReducers({
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: dappReducer,
      spamFilter: spamFilterReducer,
    }),
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeNetwork: {
          ...vault.activeNetwork,
          kind: INetworkType.Ethereum,
          chainId: 1,
          slip44: 60,
          url: 'https://offline-rpc.invalid',
        },
        activeAccount: { id: 0, type },
        accounts: {
          ...vault.accounts,
          [type]: { 0: { id: 0, address: ACCOUNT, xpub: 'public-account' } },
        },
      },
      vaultGlobal: { ...vaultGlobal, networkStatus: 'idle', activeSlip44: 60 },
      dapp: {
        dapps: Object.fromEntries(
          [CONNECTED_HOST, OTHER_HOST].map((host) => [
            host,
            {
              host,
              accountId: 0,
              accountType: type,
              chain: INetworkType.Ethereum,
              chainId: 1,
              date: 1,
            },
          ])
        ),
      },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  unlocked = true;
  sessionGeneration = 1;
  // Only the RPC transport and approval UI are simulated; requests traverse
  // the real onMessage, registry, admission, middleware and provider handlers.
  transport = jest.fn().mockResolvedValue('0x2a');
  mockController = {
    wallet: {
      isUnlocked: () => unlocked,
      getWalletSessionGeneration: () => sessionGeneration,
      ethereumTransaction: { web3Provider: { send: transport } },
    },
    dapp: DAppController(
      () => unlocked,
      () => sessionGeneration
    ),
  };
});

afterEach(() => {
  expect(getPipelineInstance()?.getQueueLength()).toBe(0);
  expect(getPipelineInstance()?.isCurrentlyProcessing()).toBe(false);
  expect(removedListeners.size).toBe(0);
  expect(updatedListeners.size).toBe(0);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('returns an idle public read through the actual provider transport', async () => {
  await expect(request('eth_blockNumber')).resolves.toBe('0x2a');
  expect(transport).toHaveBeenCalledWith('eth_blockNumber', []);
  expect(popupPromise).not.toHaveBeenCalled();
});

it.each([false, true])(
  'refuses a stale session after a %s-rejected public transport read',
  async (rejected) => {
    const reply = deferred<string>(),
      started = deferred<void>();
    transport.mockImplementationOnce(() => {
      started.resolve();
      return reply.promise;
    });
    const read = request('eth_blockNumber');
    await started.promise;
    sessionGeneration++;
    if (rejected) reply.reject(new Error('private RPC failure'));
    else reply.resolve('0x2a');
    await expect(read).resolves.toMatchObject({
      error: { code: 4100, message: EVM_TRANSACTION_CONTEXT_CHANGED },
    });
    expect(popupPromise).not.toHaveBeenCalled();
    await expect(request('eth_blockNumber')).resolves.toBe('0x2a');
  }
);

it.each([false, true])(
  'does not let a stalled first public read hold connected account requests, read tab closed=%s',
  async (closed) => {
    const reply = deferred<string>();
    const started = deferred<void>();
    transport.mockImplementationOnce(() => {
      started.resolve();
      return reply.promise;
    });
    const read = request('eth_blockNumber');
    await started.promise;
    if (closed) closeTab(1);
    const accounts = request('eth_requestAccounts', CONNECTED_HOST, 2);
    try {
      await flush();
      expect(getPipelineInstance()?.getQueueLength()).toBe(0);
      await expect(accounts).resolves.toEqual([ACCOUNT]);
      expect(popupPromise).not.toHaveBeenCalled();
    } finally {
      reply.resolve('0x2a');
      await Promise.all([read, accounts]);
    }
  }
);

it('lets public reads finish while an authentication popup remains pending', async () => {
  unlocked = false;
  const login = deferred<null>();
  jest.mocked(popupPromise).mockReturnValueOnce(login.promise);
  const accounts = request('eth_requestAccounts', CONNECTED_HOST, 2);
  try {
    await jest.advanceTimersByTimeAsync(100);
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(jest.mocked(popupPromise).mock.calls[0][0].route).toBe(
      MethodRoute.Login
    );
    await expect(request('eth_blockNumber')).resolves.toBe('0x2a');
    expect(popupPromise).toHaveBeenCalledTimes(1);
  } finally {
    unlocked = true;
    login.resolve(null);
    await expect(accounts).resolves.toEqual([ACCOUNT]);
  }
});

it('keeps authentication requests serialized and cancels the queued document without another popup', async () => {
  unlocked = false;
  const login = deferred<null>();
  jest.mocked(popupPromise).mockReturnValueOnce(login.promise);
  const first = request('eth_requestAccounts', CONNECTED_HOST, 2);
  await jest.advanceTimersByTimeAsync(100);
  const second = request('eth_requestAccounts', OTHER_HOST, 3);
  try {
    await flush();
    expect(getPipelineInstance()?.getQueueLength()).toBe(1);
    expect(popupPromise).toHaveBeenCalledTimes(1);
    closeTab(3);
    await expect(second).resolves.toMatchObject({ error: { code: 4001 } });
    expect(popupPromise).toHaveBeenCalledTimes(1);
  } finally {
    unlocked = true;
    login.resolve(null);
    await Promise.all([first, second]);
  }
});

it('keeps per-origin admission limits on simultaneous public reads', async () => {
  const reply = deferred<string>();
  transport.mockReturnValue(reply.promise);
  const reads = Array.from({ length: MAX_REQUESTS_PER_ORIGIN }, () =>
    request('eth_blockNumber')
  );
  try {
    await flush();
    expect(transport).toHaveBeenCalledTimes(MAX_REQUESTS_PER_ORIGIN);
    await expect(request('eth_blockNumber')).resolves.toMatchObject({
      error: { code: -32005 },
    });
  } finally {
    reply.resolve('0x2a');
    await Promise.all(reads);
  }
  await expect(request('eth_blockNumber')).resolves.toBe('0x2a');
});

it('still serializes two popup approvals from different connected origins', async () => {
  const firstReply = deferred<null>();
  const secondReply = deferred<null>();
  jest
    .mocked(popupPromise)
    .mockReturnValueOnce(firstReply.promise)
    .mockReturnValueOnce(secondReply.promise);
  const first = request('personal_sign', CONNECTED_HOST, 2, [
    '0x74657374',
    ACCOUNT,
  ]);
  await jest.advanceTimersByTimeAsync(100);
  const second = request('personal_sign', OTHER_HOST, 3, [
    '0x74657374',
    ACCOUNT,
  ]);
  try {
    await flush();
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(getPipelineInstance()?.getQueueLength()).toBe(1);
    firstReply.resolve(null);
    await jest.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBeNull();
    expect(popupPromise).toHaveBeenCalledTimes(2);
    expect(getPipelineInstance()?.getQueueLength()).toBe(0);
  } finally {
    firstReply.resolve(null);
    await jest.advanceTimersByTimeAsync(100);
    secondReply.resolve(null);
    await Promise.all([first, second]);
  }
});

it.each(['pipeline queue', 'popup delay'])(
  'retires an original connected request after grant removal and restoration during the %s',
  async (waiting) => {
    const params = ['0x74657374', ACCOUNT];
    const blocking = deferred<null>();
    const windowCheck = deferred<void>();
    let first: Promise<unknown> | undefined;
    if (waiting === 'popup delay') {
      jest
        .mocked(waitForExternalWalletClosure)
        .mockReturnValueOnce(windowCheck.promise);
    }
    if (waiting === 'pipeline queue') {
      jest.mocked(popupPromise).mockReturnValueOnce(blocking.promise);
      first = request('personal_sign', OTHER_HOST, 3, params);
      await jest.advanceTimersByTimeAsync(100);
      expect(popupPromise).toHaveBeenCalledTimes(1);
    }
    jest.mocked(popupPromise).mockResolvedValueOnce('stale approval');
    const result = request('personal_sign', CONNECTED_HOST, 2, params);
    await flush();
    if (first) expect(getPipelineInstance()?.getQueueLength()).toBe(1);
    else expect(requestCoordinator.isActive()).toBe(true);
    const grant = mockStore.getState().dapp.dapps[CONNECTED_HOST];
    mockStore.dispatch(removeDApp(CONNECTED_HOST));
    mockStore.dispatch(addDApp(grant));
    blocking.resolve(null);
    windowCheck.resolve();
    await jest.advanceTimersByTimeAsync(100);
    await first;
    expect(await result).toMatchObject({ error: { code: 4001 } });
    expect(popupPromise).toHaveBeenCalledTimes(first ? 1 : 0);
  }
);

it.each(['while queued', 'after dequeue'])(
  'preserves original grant retirement across popup coordinator restart %s',
  async (when) => {
    const blocking = deferred<null>();
    const first = requestCoordinator.coordinatePopupRequest(
      {
        methodConfig: getMethodConfig('wallet_watchAsset')!,
        originalRequest: {
          host: OTHER_HOST,
          method: 'wallet_watchAsset',
          sender: {},
          type: 'METHOD_REQUEST',
        },
      },
      () => blocking.promise,
      MethodRoute.WatchAsset
    );
    await jest.advanceTimersByTimeAsync(100);
    const result = request('personal_sign', CONNECTED_HOST, 2, [
      '0x74657374',
      ACCOUNT,
    ]);
    await flush();
    expect(getPipelineInstance()?.isCurrentlyProcessing()).toBe(true);
    if (when === 'after dequeue') {
      blocking.resolve(null);
      await first;
    }
    const grant = mockStore.getState().dapp.dapps[CONNECTED_HOST];
    mockStore.dispatch(removeDApp(CONNECTED_HOST));
    mockStore.dispatch(addDApp(grant));
    if (when === 'after dequeue') await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({ error: { code: 4001 } });
    blocking.resolve(null);
    await first;
    expect(popupPromise).not.toHaveBeenCalled();
  }
);
