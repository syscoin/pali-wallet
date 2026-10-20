import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { createRequire } from 'module';

import DAppController from '../DAppController';
import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';
import { getPipelineInstance } from './request-pipeline';
import {
  recordSendCallsBundle,
  reserveSendCallsBundle,
} from './sendCallsBundles';

// Native resolution retains the installed provider and its ethers receipt
// conversion while avoiding unrelated hardware imports from the SDK barrel.
const sdkRequire = createRequire(
  require.resolve('@sidhujag/sysweb3-keyring/package.json')
);
const { CustomJsonRpcProvider } = sdkRequire('./cjs/providers');
let mockStore: any;
let mockController: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

const HOST = 'https://bundle-owner.invalid';
const OTHER_HOST = 'https://other.invalid';
const HASH = `0x${'12'.repeat(32)}`;
const BLOCK = `0x${'34'.repeat(32)}`;
const ADDRESS = `0x${'56'.repeat(20)}`;
const ID = '0xabcd';
const originalFetch = global.fetch;
const originalTabs = chrome.tabs;
const removedListeners = new Set<(...args: any[]) => void>();
const updatedListeners = new Set<(...args: any[]) => void>();
let persisted: Record<string, any>;
let provider: InstanceType<typeof CustomJsonRpcProvider>;
let receipt: any;
let requests: Array<{ method: string; params: unknown[] }>;
const query = (host = HOST, method = 'wallet_getCallsStatus') =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params: [ID] } }, {
    url: `${host}/page`,
    tab: { id: 1 },
  } as chrome.runtime.MessageSender);

beforeEach(async () => {
  jest.clearAllMocks();
  removedListeners.clear();
  updatedListeners.clear();
  Object.assign(chrome, {
    tabs: {
      onRemoved: {
        addListener: (listener: (...args: any[]) => void) =>
          removedListeners.add(listener),
        removeListener: (listener: (...args: any[]) => void) =>
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
  persisted = {};
  requests = [];
  jest
    .spyOn(chrome.storage.local, 'get')
    .mockImplementation((keys, callback) => {
      const out: Record<string, any> = {};
      for (const key of keys as string[])
        if (key in persisted)
          out[key] = JSON.parse(JSON.stringify(persisted[key]));
      callback(out);
    });
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((values, callback) => {
      Object.assign(persisted, JSON.parse(JSON.stringify(values)));
      callback();
    });
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const globalState = vaultGlobalReducer(undefined, { type: 'test/init' });
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
          chainId: 2,
          url: 'https://active-other-chain.invalid',
        },
        activeAccount: { id: 0, type },
        accounts: {
          ...vault.accounts,
          [type]: { 0: { id: 0, address: ADDRESS, xpub: 'public' } },
        },
      },
      vaultGlobal: {
        ...globalState,
        networkStatus: 'idle',
        activeSlip44: 60,
      },
      dapp: { dapps: {} },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  receipt = {
    transactionHash: HASH,
    transactionIndex: '0x0',
    blockHash: BLOCK,
    blockNumber: '0x5',
    from: ADDRESS,
    to: `0x${'78'.repeat(20)}`,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    effectiveGasPrice: '0x1',
    type: '0x2',
  };
  // Only external HTTP is simulated. The installed provider performs actual
  // wire-ID validation and ethers v6 receipt conversion before public output.
  global.fetch = jest.fn(async (url, options) => {
    expect(url).toBe('https://bundle-chain.invalid');
    const payload = JSON.parse(options.body as string);
    const answer = (request: any) => {
      requests.push(request);
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getTransactionReceipt') {
        expect(request.params).toEqual([HASH]);
        result = receipt;
      } else throw new Error(`Unexpected external read ${request.method}`);
      return { jsonrpc: '2.0', id: request.id, result };
    };
    return {
      ok: true,
      status: 200,
      json: async () =>
        Array.isArray(payload) ? payload.map(answer) : answer(payload),
    } as Response;
  }) as typeof fetch;
  provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://bundle-chain.invalid',
    1
  );
  mockController = {
    wallet: {
      isUnlocked: () => true,
      getEvmProviderForChain: (chain: number) => {
        expect(chain).toBe(1);
        return provider;
      },
    },
    dapp: DAppController(() => true),
  };
  await reserveSendCallsBundle(
    HOST,
    ID,
    { chainId: 1, atomic: false, smartAccount: false },
    'reservation'
  );
  await recordSendCallsBundle(HOST, ID, {
    chainId: 1,
    atomic: false,
    smartAccount: false,
    reservationId: 'reservation',
    submissionId: 'submission',
    submissionStarted: true,
    txHashes: [],
  });
  await recordSendCallsBundle(HOST, ID, {
    chainId: 1,
    atomic: false,
    smartAccount: false,
    reservationId: 'reservation',
    submissionId: 'submission',
    submissionCompleted: true,
    txHashes: [HASH],
  });
});

afterEach(() => {
  provider.destroy();
  global.fetch = originalFetch;
  Object.assign(chrome, { tabs: originalTabs });
  jest.restoreAllMocks();
  expect(getPipelineInstance()?.getQueueLength()).toBe(0);
  expect(getPipelineInstance()?.isCurrentlyProcessing()).toBe(false);
  expect(removedListeners.size).toBe(0);
  expect(updatedListeners.size).toBe(0);
});

it('returns the recorded hash after the installed provider receipt conversion on the original chain', async () => {
  const native = await provider.getTransactionReceipt(HASH);
  expect(native.hash).toBe(HASH);
  expect(native.transactionHash).toBeUndefined();
  const response = await query();
  expect(response).toEqual({
    version: '2.0.0',
    id: ID,
    chainId: '0x1',
    atomic: false,
    status: 200,
    receipts: [
      {
        blockHash: BLOCK,
        blockNumber: '0x5',
        gasUsed: '0x5208',
        logs: [],
        status: '0x1',
        transactionHash: HASH,
      },
    ],
  });
  expect(popupPromise).not.toHaveBeenCalled();
});

it('preserves pending receipt status', async () => {
  receipt = null;
  const response = await query();
  expect(response.status).toBe(100);
  expect(response.receipts).toBeUndefined();
});

it('preserves reverted receipt status and hash', async () => {
  receipt.status = '0x0';
  const response = await query();
  expect(response.status).toBe(500);
  expect(response.receipts[0]).toMatchObject({
    status: '0x0',
    transactionHash: HASH,
  });
});

it('does not expose another origin bundle even with its known id', async () => {
  const response = await query(OTHER_HOST);
  expect(response).toMatchObject({ error: { code: 5730 } });
  expect(requests).toHaveLength(0);
});

it('passes the same receipt identity to the read-only show-status popup', async () => {
  jest.mocked(popupPromise).mockResolvedValueOnce(null);
  await expect(query(HOST, 'wallet_showCallsStatus')).resolves.toBeNull();
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(jest.mocked(popupPromise).mock.calls[0][0].data).toMatchObject({
    callsStatus: {
      status: 200,
      receipts: [{ transactionHash: HASH }],
    },
  });
});
