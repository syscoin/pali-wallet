jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));

import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { utils as sys } from 'syscoinjs-lib';

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot, setNetworkChange } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  WATCH_ONLY_VALIDATION_TIMEOUT,
  WATCH_ONLY_VALIDATION_TIMEOUT_MS,
} from 'utils/watchOnlyImport';

import { controllerEmitter } from './controllerEmitter';
import MainController from './MainController';

// Public curve point only. No private material or external network is used.
const ADDRESS = sys.bitcoinjs.payments.p2wpkh({
  pubkey: Buffer.from(
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    'hex'
  ),
  network: sys.syscoinNetworks.testnet,
}).address!;
const LABEL = 'Watch import deadline';
const STORAGE_FAILURE = 'Synthetic watch import storage refusal';
const NETWORK_URL = 'https://watch-import.synthetic.invalid';
const STORAGE_KEY = 'state-vault-1';
const originalChrome = global.chrome;
const originalFetch = global.fetch;
const clone = <T>(value: T): T => structuredClone(value);
let wallet: MainController;
let manager: KeyringManager;
let records: Record<string, any>;
let releaseSdk: (() => void) | undefined;
let rejectSdk: ((error: Error) => void) | undefined;
let sdkMode: 'fast' | 'held';
let sdkReturns: number;
let controllerCalls: number;
let importWrites: number;
let refuseNextCommit: boolean;
let reads: string[];

const projection = (vault: any) => ({
  activeAccount: vault.activeAccount,
  imported: Object.values(vault.accounts.Imported).map((account: any) => ({
    id: account.id,
    label: account.label,
    address: account.address,
    xpub: account.xpub,
    hasPrivateKey: Boolean(account.xprv),
  })),
});
const snapshot = async () => ({
  live: projection(store.getState().vault),
  saved: projection(await loadSlip44State(1)),
});
const importAccount = () =>
  controllerEmitter(
    ['wallet', 'importWatchOnlyFromController'],
    [ADDRESS, LABEL]
  );
const validationTimers = (timer: jest.SpyInstance) =>
  timer.mock.calls.flatMap((args, index) =>
    args[1] === WATCH_ONLY_VALIDATION_TIMEOUT_MS
      ? [timer.mock.results[index].value]
      : []
  );

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  reads = [];
  sdkMode = 'fast';
  sdkReturns = 0;
  controllerCalls = 0;
  importWrites = 0;
  refuseNextCommit = false;
  releaseSdk = undefined;
  rejectSdk = undefined;
  global.chrome = {
    runtime: {
      id: 'synthetic-watch-import-deadline',
      sendMessage: (request: any, callback: (value: any) => void) => {
        expect(request.type).toBe('CONTROLLER_ACTION');
        expect(request.data.methods).toEqual([
          'wallet',
          'importWatchOnlyFromController',
        ]);
        controllerCalls++;
        // Transport adapter delivers the actual controller result unchanged.
        void wallet
          .importWatchOnlyFromController(
            ...(request.data.params as [string, string])
          )
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
          if (items[STORAGE_KEY]?.accounts?.Imported?.[0]) {
            importWrites++;
            if (refuseNextCommit) {
              refuseNextCommit = false;
              (chrome.runtime as any).lastError = {
                message: STORAGE_FAILURE,
              };
              callback();
              delete (chrome.runtime as any).lastError;
              return;
            }
          }
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  global.fetch = jest.fn(async (input) => {
    const url = String(input);
    reads.push(url);
    expect(url).toBe(`${NETWORK_URL}/api/v2/address/${ADDRESS}?details=basic`);
    return new Response(JSON.stringify({ address: ADDRESS }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: 'public-anchor-address',
    xpub: 'public-anchor-xpub',
    label: 'Anchor',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: {
        kind: INetworkType.Syscoin,
        slip44: 1,
        chainId: 5700,
        currency: 'tsys',
        label: 'Synthetic watch import network',
        url: NETWORK_URL,
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: true,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(1));
  await persistCommittedWalletState(true);
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault);
  manager.isUnlocked = () => true;
  const actualImport = manager.importWatchOnly.bind(manager);
  jest.spyOn(manager, 'importWatchOnly').mockImplementation(async (...args) => {
    const account = await actualImport(...args);
    sdkReturns++;
    // Hold only the verified pure SDK-return boundary. Real public parsing,
    // SDK metadata construction, controller and durable writer stay intact.
    if (sdkMode === 'held')
      await new Promise<void>((resolve, reject) => {
        releaseSdk = resolve;
        rejectSdk = reject;
      });
    return account;
  });
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    getActiveKeyring: () => manager,
    resetAutoLockTimer: jest.fn(),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
  });
});

afterEach(async () => {
  releaseSdk?.();
  await jest.advanceTimersByTimeAsync(0);
  await manager.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  vaultCache.clearCache();
});

it('accepts a fast validated watch account only after its exact durable selection', async () => {
  const timer = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  await expect(importAccount()).resolves.toMatchObject({
    id: 0,
    address: ADDRESS,
    label: LABEL,
    xprv: '',
  });
  const state = await snapshot();
  expect(state.live).toEqual(state.saved);
  expect(state.live).toEqual({
    activeAccount: { id: 0, type: KeyringAccountType.Imported },
    imported: [
      {
        id: 0,
        address: ADDRESS,
        xpub: ADDRESS,
        label: LABEL,
        hasPrivateKey: false,
      },
    ],
  });
  expect(importWrites).toBe(1);
  const budgets = validationTimers(timer);
  expect(budgets).toHaveLength(1);
  expect(clear).toHaveBeenCalledWith(budgets[0]);
  await expect(importAccount()).rejects.toThrow('Account already exists');
  expect(await snapshot()).toEqual(state);
  expect(controllerCalls).toBe(2);
  expect(sdkReturns).toBe(1);
  expect(reads).toHaveLength(1);
});

it('keeps a real storage refusal unpublished and permits the same validated import to retry', async () => {
  const before = await snapshot();
  refuseNextCommit = true;
  await expect(importAccount()).rejects.toThrow(STORAGE_FAILURE);
  expect(await snapshot()).toEqual(before);
  expect(importWrites).toBe(1);
  await expect(importAccount()).resolves.toMatchObject({ address: ADDRESS });
  const after = await snapshot();
  expect(after.live).toEqual(after.saved);
  expect(after.live.imported).toHaveLength(1);
  expect(importWrites).toBe(2);
  expect(controllerCalls).toBe(2);
  expect(sdkReturns).toBe(2);
});

it('rejects validation before the caller deadline and ignores a late SDK return before a healthy retry', async () => {
  sdkMode = 'held';
  const timer = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  const before = await snapshot();
  let outcome: { message?: string; status: string } = { status: 'pending' };
  const caller = importAccount().then(
    () => {
      outcome = { status: 'success' };
    },
    (error) => {
      outcome = { status: 'failure', message: error.message };
    }
  );
  await jest.advanceTimersByTimeAsync(0);
  expect(sdkReturns).toBe(1);
  expect(releaseSdk).toBeDefined();
  expect(await snapshot()).toEqual(before);
  await jest.advanceTimersByTimeAsync(WATCH_ONLY_VALIDATION_TIMEOUT_MS - 1);
  expect(outcome).toEqual({ status: 'pending' });
  expect(await snapshot()).toEqual(before);
  await jest.advanceTimersByTimeAsync(1);
  await caller;
  expect(outcome).toEqual({
    status: 'failure',
    message: WATCH_ONLY_VALIDATION_TIMEOUT,
  });
  const budgets = validationTimers(timer);
  expect(budgets).toHaveLength(1);
  expect(clear).toHaveBeenCalledWith(budgets[0]);
  expect(await snapshot()).toEqual(before);
  releaseSdk!();
  await jest.advanceTimersByTimeAsync(1);
  // Regression: a UI failure must not later create/select an account silently.
  expect({ state: await snapshot(), importWrites }).toEqual({
    state: before,
    importWrites: 0,
  });
  expect(controllerCalls).toBe(1);
  expect(wallet.getLatestUpdateForCurrentAccount).not.toHaveBeenCalled();
  sdkMode = 'fast';
  await expect(importAccount()).resolves.toMatchObject({
    id: 0,
    address: ADDRESS,
    label: LABEL,
  });
  const accepted = await snapshot();
  expect(accepted.live).toEqual(accepted.saved);
  expect(accepted.live.imported).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(10001);
  expect(await snapshot()).toEqual(accepted);
  expect(importWrites).toBe(1);
  expect(controllerCalls).toBe(2);
});

it('handles a late SDK rejection without writing an account and permits a healthy retry', async () => {
  sdkMode = 'held';
  const before = await snapshot();
  const caller = importAccount().catch((error) => error);
  await jest.advanceTimersByTimeAsync(WATCH_ONLY_VALIDATION_TIMEOUT_MS);
  await expect(caller).resolves.toHaveProperty(
    'message',
    WATCH_ONLY_VALIDATION_TIMEOUT
  );
  expect(sdkReturns).toBe(1);
  rejectSdk!(new Error('Synthetic late validation rejection'));
  await jest.advanceTimersByTimeAsync(1);
  expect(await snapshot()).toEqual(before);
  expect(importWrites).toBe(0);
  sdkMode = 'fast';
  await expect(importAccount()).resolves.toMatchObject({ address: ADDRESS });
  const after = await snapshot();
  expect(after.live).toEqual(after.saved);
  expect(after.live.imported).toHaveLength(1);
  expect(importWrites).toBe(1);
  expect(controllerCalls).toBe(2);
});

it.each(['reset', 'network'] as const)(
  'retains the current-session guard when %s occurs during validation',
  async (change) => {
    sdkMode = 'held';
    const before = await snapshot();
    const timer = jest.spyOn(global, 'setTimeout');
    const clear = jest.spyOn(global, 'clearTimeout');
    const caller = importAccount().catch((error) => error);
    await jest.advanceTimersByTimeAsync(0);
    expect(sdkReturns).toBe(1);
    // Real reset/network controllers advance these generations before awaiting.
    (wallet as any).walletSessionGeneration += 1;
    if (change === 'reset') (wallet as any).walletStateGeneration += 1;
    else
      store.dispatch(
        setNetworkChange({
          activeNetwork: {
            ...store.getState().vault.activeNetwork,
            url: 'https://replacement-watch-network.synthetic.invalid',
          },
        })
      );
    releaseSdk!();
    await jest.advanceTimersByTimeAsync(0);
    await expect(caller).resolves.toHaveProperty(
      'message',
      'Wallet session changed. Unlock the wallet and try again.'
    );
    expect(await snapshot()).toEqual(before);
    expect(importWrites).toBe(0);
    expect(wallet.getLatestUpdateForCurrentAccount).not.toHaveBeenCalled();
    const budgets = validationTimers(timer);
    expect(budgets).toHaveLength(1);
    expect(clear).toHaveBeenCalledWith(budgets[0]);
  }
);
