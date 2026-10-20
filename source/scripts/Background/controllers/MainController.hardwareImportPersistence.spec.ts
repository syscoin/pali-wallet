jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  DEVICE_EVENT: 'device-event',
  default: {
    on: jest.fn(),
    dispose: jest.fn(async () => undefined),
    init: jest.fn(async () => undefined),
    ethereumGetAddress: jest.fn(async ({ path }) => {
      const { HDNodeWallet } = jest.requireActual('ethers');
      const wallet = HDNodeWallet.fromPhrase(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        undefined,
        path
      );
      return { success: true, payload: { address: wallet.address } };
    }),
    ethereumGetPublicKey: jest.fn(async ({ path }) => {
      const { HDNodeWallet } = jest.requireActual('ethers');
      const wallet = HDNodeWallet.fromPhrase(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        undefined,
        path
      );
      return {
        success: true,
        payload: { publicKey: wallet.publicKey.slice(2) },
      };
    }),
  },
}));
jest.mock('@ledgerhq/hw-transport-webhid', () => ({
  __esModule: true,
  default: {
    create: jest.fn(async () => ({
      on: jest.fn(),
      close: jest.fn(async () => undefined),
    })),
  },
}));
jest.mock('@ledgerhq/hw-app-eth', () => {
  const getAddress = jest.fn(async (path: string) => {
    const { HDNodeWallet } = jest.requireActual('ethers');
    const wallet = HDNodeWallet.fromPhrase(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      undefined,
      `m/${path}`
    );
    return { address: wallet.address, publicKey: wallet.publicKey.slice(2) };
  });
  return {
    __esModule: true,
    default: jest.fn(() => ({ getAddress })),
    deviceGetAddress: getAddress,
  };
});
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);

import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import http from 'http';
import https from 'https';

import { getController } from 'scripts/Background';
import MainController from 'scripts/Background/controllers/MainController';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, {
  loadAndActivateSlip44Vault,
  persistCommittedWalletState,
} from 'state/store';
import {
  createAccount,
  restoreVaultSnapshot,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';

import { ReceiptBalanceRefresh } from './balances/ReceiptBalanceRefresh';

const TrezorConnect = jest.requireMock('@trezor/connect-webextension').default;
const ledgerDevice = jest.requireMock('@ledgerhq/hw-app-eth');
const PHRASE = 'test test test test test test test test test test test junk';
const FAILURE = 'Synthetic hardware vault write refusal';
const originalChrome = global.chrome;
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let wallet: any;
let manager: any;
let records: Record<string, any>;
let failNextVaultWrite: boolean;
let writes: number;

const projectHardware = (vault: any, kind: 'Trezor' | 'Ledger') => ({
  active: vault.activeAccount,
  hardware: Object.values(vault.accounts[kind]).map((account: any) => ({
    id: account.id,
    address: account.address,
    label: account.label,
    xpub: account.xpub,
  })),
});

describe.each(['Trezor', 'Ledger'] as const)(
  '%s account import persistence',
  (kind) => {
    const project = (vault: any) => projectHardware(vault, kind);
    const importAccount = (label = 'Hardware fixture') =>
      kind === 'Trezor'
        ? wallet.importTrezorAccountFromController(label)
        : wallet.importLedgerAccountFromController(label);
    const deviceRead = () =>
      kind === 'Trezor'
        ? jest.mocked(TrezorConnect.ethereumGetAddress)
        : ((ledgerDevice as any).deviceGetAddress as jest.Mock);
    const devicePaths = () =>
      deviceRead().mock.calls.map((args: any[]) =>
        kind === 'Trezor' ? args[0].path : `m/${args[0]}`
      );
    const holdNextCommit = () => {
      const nativeSet = chrome.storage.local.set;
      let enter!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => (enter = resolve));
      let held = false;
      jest
        .spyOn(chrome.storage.local, 'set')
        .mockImplementation((items, callback: any) => {
          if ('state-vault-60' in items && !held) {
            held = true;
            enter();
            return new Promise<void>((resolve, reject) => {
              release = () =>
                Promise.resolve((nativeSet as any)(items, callback)).then(
                  resolve,
                  reject
                );
            });
          }
          return (nativeSet as any)(items, callback);
        });
      return { started, release: () => release() };
    };

    beforeEach(async () => {
      jest.useFakeTimers();
      jest.clearAllMocks();
      Object.defineProperty(global, 'crypto', {
        value: webcrypto,
        configurable: true,
      });
      const locks = new Map<string, AsyncMutex>();
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
          locks: {
            request: (
              name: string,
              _options: unknown,
              action: () => unknown
            ) => {
              if (!locks.has(name)) locks.set(name, new AsyncMutex());
              return locks.get(name)!.runExclusive(action);
            },
          },
        },
      });
      const deny = () => {
        throw new Error('Hardware persistence proof must stay offline');
      };
      jest.spyOn(http, 'request').mockImplementation(deny);
      jest.spyOn(http, 'get').mockImplementation(deny);
      jest.spyOn(https, 'request').mockImplementation(deny);
      jest.spyOn(https, 'get').mockImplementation(deny);
      jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(console, 'error').mockImplementation();
      walletPersistenceGate.blocked = false;
      vaultCache.clearCache();
      const groups = () =>
        Object.fromEntries(
          Object.values(KeyringAccountType).map((type) => [type, {}])
        );
      store.dispatch(
        restoreVaultSnapshot({
          ...store.getState().vault,
          activeNetwork: {
            chainId: 1,
            slip44: 60,
            kind: INetworkType.Ethereum,
            url: 'https://hardware-import.synthetic.invalid',
            label: 'Synthetic EVM',
            currency: 'eth',
          },
          activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
          isBitcoinBased: false,
          accounts: groups(),
          accountAssets: groups(),
          accountTransactions: groups(),
        } as any)
      );
      store.dispatch(setActiveSlip44(60));
      records = {};
      failNextVaultWrite = false;
      writes = 0;
      global.chrome = {
        runtime: { id: 'hardware-import-synthetic' },
        storage: {
          local: {
            get: (
              keys: string | string[] | null,
              callback?: (value: any) => void
            ) => {
              const value = Object.fromEntries(
                (keys === null
                  ? Object.keys(records)
                  : Array.isArray(keys)
                  ? keys
                  : [keys]
                )
                  .filter((key) => key in records)
                  .map((key) => [key, structuredClone(records[key])])
              );
              callback?.(value);
              return Promise.resolve(value);
            },
            set: (items: Record<string, any>, callback?: () => void) => {
              if ('state-vault-60' in items) writes++;
              if ('state-vault-60' in items && failNextVaultWrite) {
                failNextVaultWrite = false;
                if (!callback) return Promise.reject(new Error(FAILURE));
                (chrome.runtime as any).lastError = { message: FAILURE };
                callback();
                delete (chrome.runtime as any).lastError;
                return Promise.resolve();
              }
              Object.assign(records, structuredClone(items));
              callback?.();
              return Promise.resolve();
            },
            remove: (keys: string | string[], callback?: () => void) => {
              for (const key of Array.isArray(keys) ? keys : [keys])
                delete records[key];
              callback?.();
              return Promise.resolve();
            },
          },
        },
      } as any;
      manager = new KeyringManager();
      manager.setStorage(chrome.storage.local);
      manager.setVaultStateGetter(() => store.getState().vault);
      const initialAccount = await manager.initializeWalletSecurely(
        PHRASE,
        'public synthetic password'
      );
      store.dispatch(
        createAccount({
          account: initialAccount,
          accountType: KeyringAccountType.HDAccount,
        })
      );
      await persistCommittedWalletState(true);
      writes = 0;
      wallet = Object.create(MainController.prototype);
      Object.assign(wallet, {
        walletSessionGeneration: 0,
        walletStateGeneration: 0,
        networkRequestGeneration: 0,
        fiatQuoteGeneration: 0,
        activeRapidPolls: new Map(),
        targetedBalanceVersions: new Map(),
        targetedBalanceEvictions: 0,
        nativeBalanceRevision: 0,
        balanceLoadingRequestId: 0,
        receiptBalanceRefresh: new ReceiptBalanceRefresh(),
        keyrings: new Map([[60, manager]]),
        persistentProviders: new Map(),
        persistentProviderAbortControllers: new Map(),
        cancellablePromises: {},
        getActiveKeyring: () => manager,
        resetAutoLockTimer: jest.fn(),
        // Import acknowledgement is tested before this optional network refresh.
        getLatestUpdateForCurrentAccount: jest.fn(async () => {
          throw new Error('Synthetic optional refresh is offline');
        }),
      });
      (getController as jest.Mock).mockReturnValue({
        dapp: { handleStateChange: jest.fn(async () => undefined) },
      });
      (chrome as any).alarms = { clear: jest.fn(async () => true) };
    });

    afterEach(async () => {
      await manager?.destroy();
      jest.clearAllTimers();
      jest.useRealTimers();
      vaultCache.clearCache();
      jest.restoreAllMocks();
      global.chrome = originalChrome;
      if (originalNavigator)
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else delete (globalThis as any).navigator;
      if (originalCrypto)
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
    });

    const settleHardwareImport = async (operation: Promise<any>) => {
      await jest.advanceTimersByTimeAsync(2200);
      return operation;
    };

    it('persists a healthy hardware import and restores it from native storage', async () => {
      expect(manager.isUnlocked()).toBe(true);
      const account = await settleHardwareImport(importAccount());
      expect(account.id).toBe(0);
      expect(writes).toBe(1);
      expect(project(await loadSlip44State(60))).toEqual(
        project(store.getState().vault)
      );
      vaultCache.clearCache();
      await loadAndActivateSlip44Vault(60);
      expect(store.getState().vault.accounts[kind][0].address).toBe(
        account.address
      );
    });

    it('keeps failed native hardware import out of live and durable account state', async () => {
      const before = project(store.getState().vault);
      failNextVaultWrite = true;
      const operation = importAccount();
      const rejected = expect(operation).rejects.toEqual({ message: FAILURE });
      await jest.advanceTimersByTimeAsync(2200);
      await rejected;
      expect(writes).toBe(1);
      expect({
        live: project(store.getState().vault),
        disk: project(await loadSlip44State(60)),
      }).toEqual({ live: before, disk: before });
    });

    it('retries the same failed hardware account without advancing the SDK index', async () => {
      failNextVaultWrite = true;
      const operation = importAccount();
      const rejected = expect(operation).rejects.toEqual({ message: FAILURE });
      await jest.advanceTimersByTimeAsync(2200);
      await rejected;
      const retry = await settleHardwareImport(importAccount());
      const paths = devicePaths();
      expect({
        id: retry.id,
        paths,
        count: project(await loadSlip44State(60)).hardware.length,
      }).toEqual({ id: 0, paths: [paths[0], paths[0]], count: 1 });
    });

    it('leaves state untouched when the external device rejects the public read', async () => {
      const before = project(store.getState().vault);
      if (kind === 'Trezor')
        deviceRead().mockResolvedValueOnce({
          success: false,
          payload: { error: 'cancelled by user' },
        } as any);
      else deviceRead().mockRejectedValueOnce(new Error('cancelled by user'));
      const operation = importAccount();
      const rejected = expect(operation).rejects.toThrow('cancelled');
      await jest.advanceTimersByTimeAsync(2200);
      await rejected;
      expect(writes).toBe(0);
      expect(project(store.getState().vault)).toEqual(before);
      expect(project(await loadSlip44State(60))).toEqual(before);
    });

    it('keeps a held account unpublished until the native write succeeds', async () => {
      const before = project(store.getState().vault);
      const held = holdNextCommit();
      const operation = importAccount();
      await jest.advanceTimersByTimeAsync(2200);
      await held.started;
      expect(project(store.getState().vault)).toEqual(before);
      expect(project(await loadSlip44State(60))).toEqual(before);
      held.release();
      const account = await operation;
      expect(account.id).toBe(0);
      expect(project(await loadSlip44State(60))).toEqual(
        project(store.getState().vault)
      );
    });

    it('refuses an occupied concurrent slot, then permits a fresh next-account request', async () => {
      const held = holdNextCommit();
      const first = importAccount('First');
      await jest.advanceTimersByTimeAsync(2200);
      await held.started;
      const second = importAccount('Concurrent');
      const rejected = expect(second).rejects.toThrow('conflicted');
      await jest.advanceTimersByTimeAsync(2200);
      expect(devicePaths()).toEqual(["m/44'/60'/0'/0/0", "m/44'/60'/0'/0/0"]);
      held.release();
      expect((await first).id).toBe(0);
      await rejected;
      expect(project(await loadSlip44State(60)).hardware).toHaveLength(1);
      const retry = await settleHardwareImport(importAccount('Next'));
      expect(retry.id).toBe(1);
      expect(devicePaths()[2]).toBe("m/44'/60'/0'/0/1");
      expect(project(await loadSlip44State(60))).toEqual(
        project(store.getState().vault)
      );
    });

    it('refuses an import whose held native write crosses a real wallet lock', async () => {
      const before = project(store.getState().vault);
      const held = holdNextCommit();
      const operation = importAccount();
      const rejected = expect(operation).rejects.toThrow(
        'Wallet session changed'
      );
      await jest.advanceTimersByTimeAsync(2200);
      await held.started;
      wallet.lock();
      expect(manager.isUnlocked()).toBe(false);
      held.release();
      await rejected;
      // Drain the existing emergency-save path queued by the real lock.
      await persistCommittedWalletState(true);
      expect(project(store.getState().vault)).toEqual(before);
      expect(project(await loadSlip44State(60))).toEqual(before);
    });

    it('does not revive an imported account after the wallet reset cleanup', async () => {
      const held = holdNextCommit();
      const operation = importAccount();
      const outcome = operation.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(2200);
      await held.started;
      // This is the actual reset core used by Forget and wallet replacement.
      const resetting = wallet.resetWalletState({ resetNetworks: true });
      expect(wallet.walletStateGeneration).toBe(1);
      held.release();
      const [error] = await Promise.all([outcome, resetting]);
      expect(error).toEqual(
        new Error('Wallet setup is in progress. Try again after it completes.')
      );
      expect(await loadSlip44State(60)).toBeNull();
      expect(project(store.getState().vault).hardware).toEqual([]);
      expect(records['sysweb3-vault']).toBeUndefined();
      expect(records['sysweb3-vault-keys']).toBeUndefined();
    });

    it.each(['network', 'keyring'] as const)(
      'refuses a delayed device result after its %s context changes',
      async (changed) => {
        let release!: () => void;
        const read = deviceRead();
        const original = read.getMockImplementation()!;
        read.mockImplementationOnce(
          (...args: any[]) =>
            new Promise((resolve) => {
              release = async () => resolve(await original(...args));
            })
        );
        const before = project(store.getState().vault);
        const operation = importAccount();
        const rejected = expect(operation).rejects.toThrow(
          'Wallet session changed'
        );
        await jest.advanceTimersByTimeAsync(2200);
        expect(release).toBeDefined();
        if (changed === 'network') {
          // Apply the epoch and real reducer transition a network switch owns.
          wallet.walletSessionGeneration += 1;
          store.dispatch(
            setNetworkChange({
              activeNetwork: {
                ...store.getState().vault.activeNetwork,
                chainId: 137,
                url: 'https://other-hardware-network.synthetic.invalid',
              },
            })
          );
        } else wallet.getActiveKeyring = () => ({});
        release();
        await jest.advanceTimersByTimeAsync(2200);
        await rejected;
        expect(writes).toBe(0);
        expect(project(store.getState().vault)).toEqual(before);
        expect(project(await loadSlip44State(60))).toEqual(before);
      }
    );
  }
);
