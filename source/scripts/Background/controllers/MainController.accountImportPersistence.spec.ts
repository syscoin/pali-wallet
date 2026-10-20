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
import http from 'http';
import https from 'https';
import { utils as sys } from 'syscoinjs-lib';

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  createAccount,
  restoreVaultSnapshot,
  setAccountLabel,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController from './MainController';

// Public, disposable test material. No real wallet or network is accessed.
const PHRASE = 'test test test test test test test test test test test junk';
const PRIVATE_KEY = `0x${'01'.padStart(64, '0')}`;
const FAILURE = 'Synthetic account import storage refusal';
const originalChrome = global.chrome;
const clone = <T>(value: T): T => structuredClone(value);
const publicProjection = (vault: any) => ({
  activeAccount: vault.activeAccount,
  imported: Object.values(vault.accounts.Imported || {}).map(
    (account: any) => ({
      id: account.id,
      label: account.label,
      address: account.address,
      encryptedPrivateKeyPresent: Boolean(account.xprv),
    })
  ),
});

describe.each(['private', 'watch'] as const)(
  '%s account import durability',
  (kind) => {
    let wallet: any;
    let manager: any;
    let records: Record<string, any>;
    let refuseNextCommit: boolean;
    let slip44: number;
    let watchAddress: string;
    let commitAttempts: number;

    const importAccount = () =>
      kind === 'private'
        ? wallet.importAccountFromPrivateKey(PRIVATE_KEY, 'Durable private')
        : wallet.importWatchOnlyFromController(watchAddress, 'Durable watch');

    const holdNextCommit = () => {
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const set = chrome.storage.local.set;
      let held = false;
      jest
        .spyOn(chrome.storage.local, 'set')
        .mockImplementation((items, callback: any) => {
          if (items[`state-vault-${slip44}`] && !held) {
            held = true;
            release = () => (set as any)(items, callback);
            entered();
          } else (set as any)(items, callback);
        });
      return { started, release: () => release() };
    };

    beforeEach(async () => {
      jest.useFakeTimers();
      const denyNetwork = () => {
        throw new Error('Offline import test denied a network request');
      };
      jest.spyOn(http, 'request').mockImplementation(denyNetwork);
      jest.spyOn(http, 'get').mockImplementation(denyNetwork);
      jest.spyOn(https, 'request').mockImplementation(denyNetwork);
      jest.spyOn(https, 'get').mockImplementation(denyNetwork);
      jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork);
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(console, 'error').mockImplementation();
      walletPersistenceGate.blocked = false;
      vaultCache.clearCache();
      slip44 = kind === 'private' ? 60 : 1;
      const network = {
        kind: kind === 'private' ? INetworkType.Ethereum : INetworkType.Syscoin,
        slip44,
        chainId: kind === 'private' ? 1 : 5700,
        url: 'https://account-import.synthetic.invalid',
        currency: kind === 'private' ? 'eth' : 'tsys',
        label: 'Synthetic import network',
      };
      const hd = new sys.HDSigner(PHRASE, '', true);
      const key = hd.deriveKeypair("m/84'/1'/1'/0/0");
      watchAddress = sys.bitcoinjs.payments.p2wpkh({
        pubkey: key.publicKey,
        network: sys.syscoinNetworks.testnet,
      }).address!;
      if (kind === 'watch') {
        jest.mocked(fetch).mockImplementation(async (input) => {
          expect(input).toBe(
            `${network.url}/api/v2/address/${watchAddress}?details=basic`
          );
          return {
            ok: true,
            json: async () => ({ address: watchAddress }),
          } as Response;
        });
      }

      const groups = () =>
        Object.fromEntries(
          Object.values(KeyringAccountType).map((type) => [type, {}])
        );
      const accounts = groups();
      accounts.HDAccount[0] = {
        id: 0,
        address: '0x0000000000000000000000000000000000000001',
        xpub: 'synthetic-public-anchor',
        label: 'Anchor',
      };
      store.dispatch(
        restoreVaultSnapshot({
          ...store.getState().vault,
          activeNetwork: network,
          activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
          isBitcoinBased: kind === 'watch',
          accounts,
          accountAssets: groups(),
          accountTransactions: groups(),
        } as any)
      );
      store.dispatch(setActiveSlip44(slip44));
      records = {};
      refuseNextCommit = false;
      commitAttempts = 0;
      global.chrome = {
        runtime: { id: 'synthetic-account-import' },
        storage: {
          local: {
            get: (keys: string[], callback: (value: any) => void) =>
              callback(
                Object.fromEntries(
                  keys
                    .filter((name) => name in records)
                    .map((name) => [name, clone(records[name])])
                )
              ),
            set: (items: Record<string, any>, callback: () => void) => {
              if (items[`state-vault-${slip44}`]) {
                commitAttempts += 1;
                if (refuseNextCommit) {
                  refuseNextCommit = false;
                  (chrome.runtime as any).lastError = { message: FAILURE };
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
      await persistCommittedWalletState(true);
      commitAttempts = 0;
      // Actual SDK derives/encrypts/allocates and reads the actual Redux vault.
      // Only the already-unlocked public synthetic session is supplied.
      manager = new KeyringManager();
      manager.setVaultStateGetter(() => store.getState().vault);
      manager.isUnlocked = () => true;
      manager.withSecureData = (operation: (password: string) => unknown) =>
        operation('public synthetic session password');
      wallet = Object.create(MainController.prototype);
      wallet.walletSessionGeneration = 0;
      wallet.walletStateGeneration = 0;
      wallet.getActiveKeyring = () => manager;
      wallet.resetAutoLockTimer = jest.fn();
      wallet.getLatestUpdateForCurrentAccount = jest
        .fn()
        .mockResolvedValue(undefined);
    });

    afterEach(async () => {
      await manager.destroy();
      jest.clearAllTimers();
      jest.useRealTimers();
      vaultCache.clearCache();
      jest.restoreAllMocks();
      global.chrome = originalChrome;
    });

    it('acknowledges only the actual persisted import and keeps ordinary duplicate protection', async () => {
      const imported = await importAccount();
      const live = publicProjection(store.getState().vault);
      expect(publicProjection(await loadSlip44State(slip44))).toEqual(live);
      expect(live.imported).toEqual([
        {
          id: imported.id,
          label: kind === 'private' ? 'Durable private' : 'Durable watch',
          address: imported.address,
          encryptedPrivateKeyPresent: kind === 'private',
        },
      ]);
      await expect(importAccount()).rejects.toThrow(/already exists/i);
      expect(commitAttempts).toBe(1);
    });

    it('leaves a refused import unpublished and allows the same ordinary import to retry', async () => {
      const before = publicProjection(store.getState().vault);
      refuseNextCommit = true;
      await expect(importAccount()).rejects.toMatchObject({ message: FAILURE });
      const afterRefusal = {
        live: publicProjection(store.getState().vault),
        cached: publicProjection(await vaultCache.getSlip44Vault(slip44)),
        cold: publicProjection(await loadSlip44State(slip44)),
      };
      const retry = await importAccount().then(
        (account: any) => ({ success: true, id: account.id }),
        (error: Error) => ({ success: false, error: error.message })
      );
      // The retry must enter the real writer rather than hitting SDK duplicate
      // rejection for a row left behind by the failed first attempt.
      expect({ retry, afterRefusal, commitAttempts }).toEqual({
        retry: { success: true, id: 0 },
        afterRefusal: { live: before, cached: before, cold: before },
        commitAttempts: 2,
      });
      expect(publicProjection(await loadSlip44State(slip44))).toEqual(
        publicProjection(store.getState().vault)
      );
    });

    it('has no hidden SDK import registry after cold rehydration of a refused write', async () => {
      refuseNextCommit = true;
      await expect(importAccount()).rejects.toMatchObject({ message: FAILURE });
      const cold = await loadSlip44State(slip44);
      expect(publicProjection(cold).imported).toEqual([]);
      // A fresh worker would read this persisted vault. Keep the same SDK here
      // to prove its bookkeeping is not independently reserving the failed ID.
      vaultCache.clearCache();
      store.dispatch(restoreVaultSnapshot(cold));
      const imported = await importAccount();
      expect(imported.id).toBe(0);
      expect(
        publicProjection(await loadSlip44State(slip44)).imported
      ).toHaveLength(1);
      expect(commitAttempts).toBe(2);
    });

    it('keeps the live account and selected account unchanged until its held commit succeeds', async () => {
      const before = publicProjection(store.getState().vault);
      const held = holdNextCommit();
      const importing = importAccount();
      await held.started;
      expect(publicProjection(store.getState().vault)).toEqual(before);
      expect(publicProjection(await vaultCache.getSlip44Vault(slip44))).toEqual(
        before
      );
      expect(publicProjection(await loadSlip44State(slip44))).toEqual(before);
      held.release();
      const imported = await importing;
      expect(store.getState().vault.activeAccount).toEqual({
        id: imported.id,
        type: KeyringAccountType.Imported,
      });
      expect(publicProjection(await loadSlip44State(slip44))).toEqual(
        publicProjection(store.getState().vault)
      );
    });

    it.each(['account', 'network', 'keyring', 'lock'] as const)(
      'repairs its unpublished stored import when the %s context changes while saving',
      async (change) => {
        const held = holdNextCommit();
        const importing = importAccount();
        const rejected = expect(importing).rejects.toThrow(
          'Wallet session changed'
        );
        await held.started;
        // These are the real reducers used by context changes. Their controller
        // paths advance the session revision before any asynchronous work.
        if (change === 'keyring') {
          wallet.getActiveKeyring = () => Object.create(manager);
        } else {
          wallet.walletSessionGeneration += 1;
          if (change === 'account') {
            store.dispatch(
              createAccount({
                accountType: KeyringAccountType.HDAccount,
                account: {
                  id: 1,
                  address: 'public-other',
                  xpub: 'public-other',
                  label: 'Other',
                } as any,
              })
            );
            store.dispatch(
              setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
            );
          } else if (change === 'network') {
            store.dispatch(
              setNetworkChange({
                activeNetwork: {
                  ...store.getState().vault.activeNetwork,
                  url: 'https://new-import-network.synthetic.invalid',
                },
              })
            );
          } else {
            vaultCache.clearCache();
          }
        }
        const current = publicProjection(store.getState().vault);
        held.release();
        await rejected;
        expect(publicProjection(store.getState().vault)).toEqual(current);
        expect(publicProjection(await loadSlip44State(slip44))).toEqual(
          current
        );
        expect(current.imported).toEqual([]);
        expect(commitAttempts).toBe(2);
      }
    );

    it('does not repair an old wallet snapshot after a reset takes ownership', async () => {
      const held = holdNextCommit();
      const importing = importAccount();
      const rejected = expect(importing).rejects.toThrow(
        'Wallet session changed'
      );
      await held.started;
      wallet.walletSessionGeneration += 1;
      wallet.walletStateGeneration += 1;
      store.dispatch(
        setAccountLabel({
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          label: 'Replacement wallet',
        })
      );
      vaultCache.clearCache();
      held.release();
      await rejected;
      expect(store.getState().vault.accounts.HDAccount[0].label).toBe(
        'Replacement wallet'
      );
      expect(publicProjection(store.getState().vault).imported).toEqual([]);
      // The reset's queued persistence owns cleanup. The old import must not
      // issue a repair write which can recreate its old wallet after that reset.
      expect(commitAttempts).toBe(1);
    });

    it('repairs the latest cached source without overwriting a newly active vault', async () => {
      const held = holdNextCommit();
      const importing = importAccount();
      const rejected = expect(importing).rejects.toThrow(
        'Wallet session changed'
      );
      await held.started;
      const source = clone(store.getState().vault);
      source.accounts.HDAccount[0].label = 'Latest source label';
      vaultCache.prepareSlip44Vault(slip44, source);
      const other = clone(source);
      other.activeNetwork = {
        ...other.activeNetwork,
        kind: INetworkType.Syscoin,
        slip44: 57,
        chainId: 57,
      };
      other.accounts.HDAccount[0].label = 'Other active vault';
      wallet.walletSessionGeneration += 1;
      store.dispatch(setActiveSlip44(57));
      store.dispatch(restoreVaultSnapshot(other));
      held.release();
      await rejected;
      expect(store.getState().vault.accounts.HDAccount[0].label).toBe(
        'Other active vault'
      );
      expect(store.getState().vaultGlobal.activeSlip44).toBe(57);
      const restored = await loadSlip44State(slip44);
      expect(restored.accounts.HDAccount[0].label).toBe('Latest source label');
      expect(publicProjection(restored).imported).toEqual([]);
      expect(records.state.vaultGlobal.activeSlip44).toBe(57);
      expect(commitAttempts).toBe(2);
    });

    it('preserves a replacement occupying the same imported slot during the held write', async () => {
      const held = holdNextCommit();
      const importing = importAccount();
      const rejected = expect(importing).rejects.toThrow('conflicted');
      await held.started;
      store.dispatch(
        createAccount({
          accountType: KeyringAccountType.Imported,
          account: {
            id: 0,
            address: 'replacement-public',
            xpub: 'replacement-public',
            label: 'Replacement',
          } as any,
        })
      );
      const replacement = publicProjection(store.getState().vault);
      held.release();
      await rejected;
      expect(publicProjection(store.getState().vault)).toEqual(replacement);
      expect(publicProjection(await loadSlip44State(slip44))).toEqual(
        replacement
      );
      expect(commitAttempts).toBe(2);
    });
  }
);
