jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setNetworks } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import EvmAssetsController from './assets/evm';
import { controllerEmitter } from './controllerEmitter';
import MainController from './MainController';

const PLATFORM_URL = 'https://api.coingecko.com/api/v3/asset_platforms';
const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Current synthetic network',
  currency: 'eth',
  url: 'https://source-network.synthetic.invalid',
};
const target: INetwork = {
  ...source,
  chainId: 31337,
  label: 'Metadata deadline synthetic network',
  currency: 'test',
  url: 'http://127.0.0.1:18545/rpc',
};
const metadata = [
  {
    id: 'synthetic-platform',
    ['chain_identifier']: target.chainId,
    ['native_coin_id']: 'synthetic-native-coin',
  },
];
const originalChrome = global.chrome;
const originalFetch = global.fetch;
const clone = <T>(value: T): T => structuredClone(value);
let wallet: MainController;
let records: Record<string, any>;
let releaseMetadata: (() => void) | undefined;
let rejectMetadata: ((error: Error) => void) | undefined;
let mode: 'fast' | 'held' | 'rejected';
let fetches: string[];
let controllerCalls: number;
let refuseNextCommit: boolean;
let registryWrites: number;
const STORAGE_FAILURE = 'Synthetic network registry storage refusal';

const snapshot = async () => ({
  live: store.getState().vaultGlobal.networks.ethereum[target.chainId] || null,
  saved:
    (await loadState()).vaultGlobal.networks.ethereum[target.chainId] || null,
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  fetches = [];
  controllerCalls = 0;
  releaseMetadata = undefined;
  rejectMetadata = undefined;
  refuseNextCommit = false;
  registryWrites = 0;
  mode = 'fast';
  global.chrome = {
    runtime: {
      id: 'synthetic-network-metadata-deadline',
      sendMessage: (request: any, callback: (value: any) => void) => {
        expect(request.type).toBe('CONTROLLER_ACTION');
        expect(request.data.methods).toEqual(['wallet', 'addCustomRpc']);
        controllerCalls++;
        // Native test transport only: deliver the actual controller result.
        // No canned controller response or in-flight state replacement.
        void wallet
          .addCustomRpc(...(request.data.params as [INetwork]))
          .then(callback, (error) => callback({ error: error.message }));
      },
    },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          if (items.state?.vaultGlobal?.networks?.ethereum?.[target.chainId]) {
            registryWrites++;
            if (refuseNextCommit) {
              refuseNextCommit = false;
              throw new Error(STORAGE_FAILURE);
            }
          }
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: string[], callback: () => void) => {
          keys.forEach((key) => delete records[key]);
          callback();
        },
      },
    },
  } as any;
  global.fetch = jest.fn(async (input) => {
    const url = String(input);
    fetches.push(url);
    if (url !== PLATFORM_URL)
      throw new Error('Unexpected native test network request');
    if (mode === 'rejected') throw new Error('Synthetic metadata unavailable');
    if (mode === 'held')
      await new Promise<void>((resolve, reject) => {
        releaseMetadata = resolve;
        rejectMetadata = reject;
      });
    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: source,
      isBitcoinBased: false,
    })
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setNetworks({ ethereum: { 1: source }, syscoin: {} }));
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    isRemovingNetwork: false,
    resetAutoLockTimer: jest.fn(),
    evmAssetsController: EvmAssetsController(),
  });
  await persistCommittedWalletState(true);
});

afterEach(() => {
  releaseMetadata?.();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  vaultCache.clearCache();
});

it('preserves fast optional metadata enrichment before acknowledging the durable add', async () => {
  const timer = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  await expect(
    controllerEmitter(['wallet', 'addCustomRpc'], [target])
  ).resolves.toMatchObject({
    ...target,
    coingeckoId: 'synthetic-native-coin',
    coingeckoPlatformId: 'synthetic-platform',
  });
  const state = await snapshot();
  expect(state.live).toEqual(state.saved);
  expect(state.live).toMatchObject({
    coingeckoPlatformId: 'synthetic-platform',
  });
  expect(fetches).toEqual([PLATFORM_URL]);
  expect(controllerCalls).toBe(1);
  const metadataTimers = timer.mock.calls.flatMap((args, index) =>
    args[1] === 1000 ? [timer.mock.results[index].value] : []
  );
  expect(metadataTimers).toHaveLength(1);
  expect(clear).toHaveBeenCalledWith(metadataTimers[0]);
});

it('acknowledges the exact durable add before slow optional metadata arrives and ignores its late enrichment', async () => {
  mode = 'held';
  const timer = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  let outcome: { message?: string; result?: unknown; status: string } = {
    status: 'pending',
  };
  const completion = controllerEmitter(
    ['wallet', 'addCustomRpc'],
    [target]
  ).then(
    (result) => {
      outcome = { status: 'success', result };
    },
    (error) => {
      outcome = { status: 'failure', message: error.message };
    }
  );
  await jest.advanceTimersByTimeAsync(0);
  expect(fetches).toEqual([PLATFORM_URL]);
  expect(releaseMetadata).toBeDefined();
  await jest.advanceTimersByTimeAsync(999);
  expect(outcome).toEqual({ status: 'pending' });
  expect(await snapshot()).toEqual({ live: null, saved: null });
  await jest.advanceTimersByTimeAsync(2);
  await completion;
  const expected = { ...target, default: false };
  expect(outcome).toEqual({ status: 'success', result: expected });
  expect(await snapshot()).toEqual({ live: expected, saved: expected });
  const metadataTimers = timer.mock.calls.flatMap((args, index) =>
    args[1] === 1000 ? [timer.mock.results[index].value] : []
  );
  expect(metadataTimers).toHaveLength(1);
  expect(clear).toHaveBeenCalledWith(metadataTimers[0]);
  releaseMetadata!();
  await jest.advanceTimersByTimeAsync(1);
  expect(await snapshot()).toEqual({ live: expected, saved: expected });
  expect(registryWrites).toBe(1);
  expect(controllerCalls).toBe(1);
  expect(fetches).toEqual([PLATFORM_URL]);
  expect(store.getState().vault.activeNetwork).toEqual(source);
  await expect(
    (wallet as any).evmAssetsController.detectCoinGeckoIds(target.chainId)
  ).resolves.toEqual({
    coingeckoId: 'synthetic-native-coin',
    coingeckoPlatformId: 'synthetic-platform',
  });
  expect(fetches).toEqual([PLATFORM_URL]);
});

it('still durably adds when optional metadata rejects without replacing the saved identity', async () => {
  mode = 'rejected';
  await expect(
    controllerEmitter(['wallet', 'addCustomRpc'], [target])
  ).resolves.toMatchObject(target);
  const state = await snapshot();
  expect(state.live).toEqual(state.saved);
  expect(state.live).toMatchObject(target);
  expect(state.live).not.toHaveProperty('coingeckoPlatformId');
  expect(controllerCalls).toBe(1);
});

it('cleans up the metadata budget when discovery rejects promptly', async () => {
  mode = 'rejected';
  const timer = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  await expect(
    controllerEmitter(['wallet', 'addCustomRpc'], [target])
  ).resolves.toMatchObject(target);
  const metadataTimers = timer.mock.calls.flatMap((args, index) =>
    args[1] === 1000 ? [timer.mock.results[index].value] : []
  );
  expect(metadataTimers).toHaveLength(1);
  expect(clear).toHaveBeenCalledWith(metadataTimers[0]);
});

it('ignores a late metadata rejection after a successful bounded add', async () => {
  mode = 'held';
  const completion = controllerEmitter(['wallet', 'addCustomRpc'], [target]);
  await jest.advanceTimersByTimeAsync(1001);
  await expect(completion).resolves.toEqual({ ...target, default: false });
  const saved = await snapshot();
  rejectMetadata!(new Error('Synthetic late metadata refusal'));
  await jest.advanceTimersByTimeAsync(1);
  expect(await snapshot()).toEqual(saved);
  expect(registryWrites).toBe(1);
  expect(controllerCalls).toBe(1);
});

it('retains a genuine storage refusal and retries without a late metadata write', async () => {
  mode = 'held';
  refuseNextCommit = true;
  const refused = controllerEmitter(['wallet', 'addCustomRpc'], [target]).then(
    () => ({ message: 'unexpected success' }),
    (error) => ({ message: error.message })
  );
  await jest.advanceTimersByTimeAsync(1001);
  expect(await refused).toEqual({ message: STORAGE_FAILURE });
  expect(await snapshot()).toEqual({ live: null, saved: null });
  releaseMetadata!();
  await jest.advanceTimersByTimeAsync(1);
  expect(await snapshot()).toEqual({ live: null, saved: null });
  expect(registryWrites).toBe(1);
  await expect(
    controllerEmitter(['wallet', 'addCustomRpc'], [target])
  ).resolves.toMatchObject({
    ...target,
    coingeckoId: 'synthetic-native-coin',
    coingeckoPlatformId: 'synthetic-platform',
  });
  const saved = await snapshot();
  expect(saved.live).toEqual(saved.saved);
  expect(saved.live).toMatchObject(target);
  expect(registryWrites).toBe(2);
  expect(controllerCalls).toBe(2);
});
