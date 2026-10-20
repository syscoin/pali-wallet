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

import http from 'http';
import https from 'https';

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountAssets,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setIsSwitchingAccount,
  setNetworkStatus,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

import EthAccountController from './account/evm';
import SysAccountController from './account/syscoin';
import MainController from './MainController';

const originalChrome = global.chrome;
const FAILURE = 'Synthetic asset mutation storage refusal';
const TYPE = KeyringAccountType.HDAccount;
const CONTRACT = `0x${'33'.repeat(20)}`;
const clone = <T>(value: T): T => structuredClone(value);

describe.each(['ethereum', 'syscoin'] as const)(
  '%s asset mutation durability',
  (family) => {
    let wallet: any;
    let records: Record<string, any>;
    let refuseNextCommit: boolean;
    let commits: number;
    let slip44: number;
    const asset = () =>
      family === 'ethereum'
        ? {
            contractAddress: CONTRACT,
            tokenSymbol: 'TOKEN',
            name: 'Public synthetic token',
            decimals: 6,
            balance: 10,
            chainId: 5700,
            tokenStandard: 'ERC-20',
            isNft: false,
          }
        : {
            assetGuid: '123457',
            symbol: 'TOKEN',
            name: 'Public synthetic token',
            decimals: 8,
            balance: 10,
            chainId: 5700,
            type: 'SPTAllocated',
          };
    const projection = (vault: any) => ({
      active: vault.activeAccount,
      assets: vault.accountAssets[TYPE],
    });
    const mutate = (
      action: 'add' | 'remove',
      scope = getWalletNavigationScope()
    ) =>
      action === 'add'
        ? wallet.saveTokenInfo(asset(), scope)
        : wallet.deleteTokenInfo(
            family === 'ethereum' ? CONTRACT : '123457',
            5700,
            undefined,
            scope
          );
    const holdNextCommit = () => {
      const set = chrome.storage.local.set;
      let release!: () => void;
      let enter!: () => void;
      let held = false;
      const started = new Promise<void>((resolve) => {
        enter = resolve;
      });
      jest
        .spyOn(chrome.storage.local, 'set')
        .mockImplementation((items, callback: any) => {
          if (items[`state-vault-${slip44}`] && !held) {
            held = true;
            release = () => (set as any)(items, callback);
            enter();
          } else (set as any)(items, callback);
        });
      return { started, release: () => release() };
    };
    const otherAsset = () => ({
      ...asset(),
      ...(family === 'ethereum'
        ? { contractAddress: `0x${'44'.repeat(20)}` }
        : { assetGuid: '123458' }),
    });

    beforeEach(async () => {
      jest.useFakeTimers();
      const deny = () => {
        throw new Error('Asset mutation test must remain offline');
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
      slip44 = family === 'ethereum' ? 60 : 1;
      const groups = () =>
        Object.fromEntries(
          Object.values(KeyringAccountType).map((type) => [type, {}])
        );
      const accounts = groups();
      accounts[TYPE] = {
        0: {
          id: 0,
          address: `0x${'11'.repeat(20)}`,
          xpub: 'public-synthetic-a',
          label: 'Public account A',
        },
        1: {
          id: 1,
          address: `0x${'22'.repeat(20)}`,
          xpub: 'public-synthetic-b',
          label: 'Public account B',
        },
      };
      const accountAssets = groups();
      accountAssets[TYPE] = {
        0: { ethereum: [], syscoin: [] },
        1: { ethereum: [], syscoin: [] },
      };
      store.dispatch(
        restoreVaultSnapshot({
          ...store.getState().vault,
          activeNetwork: {
            kind:
              family === 'ethereum'
                ? INetworkType.Ethereum
                : INetworkType.Syscoin,
            slip44,
            chainId: 5700,
            url: 'https://asset-mutation.synthetic.invalid',
            currency: family === 'ethereum' ? 'sys' : 'tsys',
            label: 'Synthetic asset network',
          },
          activeAccount: { id: 0, type: TYPE },
          isBitcoinBased: family === 'syscoin',
          accounts,
          accountAssets,
          accountTransactions: groups(),
        } as any)
      );
      store.dispatch(setActiveSlip44(slip44));
      store.dispatch(setIsSwitchingAccount(false));
      store.dispatch(setNetworkStatus('idle'));
      records = {};
      refuseNextCommit = false;
      commits = 0;
      global.chrome = {
        runtime: { id: 'synthetic-asset-mutation' },
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
                commits += 1;
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
      commits = 0;
      wallet = Object.create(MainController.prototype);
      wallet.walletSessionGeneration = 0;
      wallet.walletStateGeneration = 0;
      wallet.isUnlocked = jest.fn(() => true);
      const keyring = {};
      wallet.getActiveKeyring = () => keyring;
      wallet.resetAutoLockTimer = jest.fn();
      // Actual account controllers, Redux reducers, cache and storage adapter.
      // These token paths do not read a keyring or perform network requests.
      wallet.account = {
        eth: EthAccountController(),
        sys: SysAccountController(() => {
          throw new Error('Asset mutation must not access a signing keyring');
        }),
      };
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      vaultCache.clearCache();
      jest.restoreAllMocks();
      global.chrome = originalChrome;
    });

    it('persists ordinary add and remove without changing another account', async () => {
      await mutate('add');
      expect(
        store.getState().vault.accountAssets[TYPE][0][family]
      ).toHaveLength(1);
      expect(projection(await loadSlip44State(slip44))).toEqual(
        projection(store.getState().vault)
      );
      expect(store.getState().vault.accountAssets[TYPE][1][family]).toEqual([]);
      await expect(mutate('add')).rejects.toThrow(/already exists/i);
      await mutate('remove');
      expect(store.getState().vault.accountAssets[TYPE][0][family]).toEqual([]);
      expect(projection(await loadSlip44State(slip44))).toEqual(
        projection(store.getState().vault)
      );
      expect(commits).toBe(2);
    });

    it.each(['add', 'remove'] as const)(
      'keeps a refused %s unpublished and lets the same action retry',
      async (action) => {
        if (action === 'remove') await mutate('add');
        commits = 0;
        const before = projection(store.getState().vault);
        refuseNextCommit = true;
        await expect(mutate(action)).rejects.toMatchObject({
          message: FAILURE,
        });
        const afterRefusal = {
          live: projection(store.getState().vault),
          cached: projection(await vaultCache.getSlip44Vault(slip44)),
          cold: projection(await loadSlip44State(slip44)),
        };
        const retry = await mutate(action).then(
          () => ({ success: true }),
          (error: Error) => ({ success: false, error: error.message })
        );
        expect({ afterRefusal, retry, commits }).toEqual({
          afterRefusal: { live: before, cached: before, cold: before },
          retry: { success: true },
          commits: 2,
        });
        expect(projection(await loadSlip44State(slip44))).toEqual(
          projection(store.getState().vault)
        );
      }
    );

    it.each(['add', 'remove'] as const)(
      'cold restoration after a refused %s permits a durable retry',
      async (action) => {
        if (action === 'remove') await mutate('add');
        commits = 0;
        const before = projection(store.getState().vault);
        refuseNextCommit = true;
        await expect(mutate(action)).rejects.toMatchObject({
          message: FAILURE,
        });
        const cold = await loadSlip44State(slip44);
        expect(projection(cold)).toEqual(before);
        vaultCache.clearCache();
        store.dispatch(restoreVaultSnapshot(cold));
        await mutate(action);
        expect(commits).toBe(2);
        expect(projection(await loadSlip44State(slip44))).toEqual(
          projection(store.getState().vault)
        );
      }
    );

    it.each(['add', 'remove'] as const)(
      'keeps a held %s unpublished and preserves newer unrelated metadata',
      async (action) => {
        await wallet.saveTokenInfo(otherAsset(), getWalletNavigationScope());
        if (action === 'remove') await mutate('add');
        commits = 0;
        const before = projection(store.getState().vault);
        const held = holdNextCommit();
        const pending = mutate(action);
        await held.started;
        expect(projection(store.getState().vault)).toEqual(before);
        expect(projection(await vaultCache.getSlip44Vault(slip44))).toEqual(
          before
        );
        expect(projection(await loadSlip44State(slip44))).toEqual(before);
        const current = store.getState().vault.accountAssets[TYPE][0][family];
        store.dispatch(
          setAccountAssets({
            accountId: 0,
            accountType: TYPE,
            property: family,
            value: current.map((token) => ({
              ...token,
              balance: 77,
              name: 'Newer metadata',
            })),
          })
        );
        // The normal poll save queues behind the membership edit. It must see
        // the preserved latest metadata and committed membership together.
        const pollingSave = persistCommittedWalletState(true);
        held.release();
        await Promise.all([pending, pollingSave]);
        const latest = store.getState().vault.accountAssets[TYPE][0][family];
        expect(latest).toHaveLength(action === 'add' ? 2 : 1);
        expect(latest[0]).toMatchObject({
          balance: 77,
          name: 'Newer metadata',
        });
        expect(projection(await loadSlip44State(slip44))).toEqual(
          projection(store.getState().vault)
        );
        expect(commits).toBe(2);
      }
    );

    it('serializes a removal and another token addition without losing either membership edit', async () => {
      await mutate('add');
      commits = 0;
      const held = holdNextCommit();
      const removing = mutate('remove');
      await held.started;
      const adding = wallet.saveTokenInfo(
        otherAsset(),
        getWalletNavigationScope()
      );
      held.release();
      await Promise.all([removing, adding]);
      const list = store.getState().vault.accountAssets[TYPE][0][family];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject(otherAsset());
      expect(projection(await loadSlip44State(slip44))).toEqual(
        projection(store.getState().vault)
      );
      expect(commits).toBe(2);
    });

    it('rejects a queued same-token duplicate before another write', async () => {
      const held = holdNextCommit();
      const first = mutate('add');
      await held.started;
      const duplicate = mutate('add');
      const rejected = expect(duplicate).rejects.toThrow(/already exists/i);
      held.release();
      await first;
      await rejected;
      expect(commits).toBe(1);
      expect(
        store.getState().vault.accountAssets[TYPE][0][family]
      ).toHaveLength(1);
    });

    it.each(['add', 'remove'] as const)(
      'repairs a held %s without publishing after its account context changes',
      async (action) => {
        if (action === 'remove') await mutate('add');
        commits = 0;
        const held = holdNextCommit();
        const pending = mutate(action);
        const rejected = expect(pending).rejects.toThrow(
          'Asset context changed'
        );
        await held.started;
        store.dispatch(setActiveAccount({ id: 1, type: TYPE }));
        const latest = projection(store.getState().vault);
        held.release();
        await rejected;
        expect(projection(store.getState().vault)).toEqual(latest);
        expect(projection(await loadSlip44State(slip44))).toEqual(latest);
        expect(commits).toBe(2);
      }
    );

    it.each(['network', 'identity', 'keyring', 'session', 'lock'] as const)(
      'repairs a held token addition when the %s context changes',
      async (change) => {
        const held = holdNextCommit();
        const pending = mutate('add');
        const rejected = expect(pending).rejects.toThrow(
          'Asset context changed'
        );
        await held.started;
        if (change === 'network')
          store.dispatch(
            setNetworkChange({
              activeNetwork: {
                ...store.getState().vault.activeNetwork,
                url: 'https://new-asset-context.synthetic.invalid',
              },
            })
          );
        if (change === 'identity')
          store.dispatch(
            setAccountPropertyByIdAndType({
              id: 0,
              type: TYPE,
              property: 'address',
              value: `0x${'55'.repeat(20)}`,
            })
          );
        if (change === 'keyring') wallet.getActiveKeyring = () => ({});
        if (change === 'session') wallet.walletSessionGeneration += 1;
        if (change === 'lock') {
          wallet.isUnlocked.mockReturnValue(false);
          vaultCache.clearCache();
        }
        const latest = projection(store.getState().vault);
        held.release();
        await rejected;
        expect(projection(store.getState().vault)).toEqual(latest);
        expect(projection(await loadSlip44State(slip44))).toEqual(latest);
        expect(commits).toBe(2);
        if (change === 'lock')
          expect(vaultCache.isVaultCached(slip44)).toBe(false);
      }
    );

    it('does not repair an old token write over a replacement wallet', async () => {
      const held = holdNextCommit();
      const pending = mutate('add');
      const rejected = expect(pending).rejects.toThrow('Asset context changed');
      await held.started;
      wallet.walletStateGeneration += 1;
      vaultCache.clearCache();
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: 0,
          type: TYPE,
          property: 'address',
          value: `0x${'66'.repeat(20)}`,
        })
      );
      const replacement = projection(store.getState().vault);
      const replacementSave = persistCommittedWalletState(true);
      held.release();
      await rejected;
      await replacementSave;
      expect(projection(await loadSlip44State(slip44))).toEqual(replacement);
      expect(projection(await vaultCache.getSlip44Vault(slip44))).toEqual(
        replacement
      );
      expect(commits).toBe(2);
    });

    it('refuses an old queued addition before it writes or publishes', async () => {
      const held = holdNextCommit();
      const first = mutate('add');
      const firstRejected = expect(first).rejects.toThrow(
        'Asset context changed'
      );
      await held.started;
      const queued = wallet.saveTokenInfo(
        otherAsset(),
        getWalletNavigationScope()
      );
      const queuedRejected = expect(queued).rejects.toThrow(
        'Asset context changed'
      );
      store.dispatch(setActiveAccount({ id: 1, type: TYPE }));
      held.release();
      await Promise.all([firstRejected, queuedRejected]);
      expect(store.getState().vault.accountAssets[TYPE][0][family]).toEqual([]);
      expect(store.getState().vault.accountAssets[TYPE][1][family]).toEqual([]);
      // First staged write and its repair only; no queued stale write.
      expect(commits).toBe(2);
    });

    it('repairs the latest source cache after a slip44 switch without writing the target into it', async () => {
      const source = clone(store.getState().vault);
      const held = holdNextCommit();
      const pending = mutate('add');
      const rejected = expect(pending).rejects.toThrow('Asset context changed');
      await held.started;
      // The normal switch path can cache a newer source snapshot before it
      // activates another slip44. The repair must not use its older capture.
      source.accountAssets[TYPE][1][family] = [otherAsset()] as any;
      vaultCache.prepareSlip44Vault(slip44, source);
      const target = {
        ...clone(source),
        activeNetwork: { ...source.activeNetwork, slip44: 99, chainId: 99 },
      };
      store.dispatch(restoreVaultSnapshot(target));
      store.dispatch(setActiveSlip44(99));
      const targetSave = persistCommittedWalletState(true);
      held.release();
      await rejected;
      await targetSave;
      expect(await loadSlip44State(slip44)).toEqual(source);
      expect(await loadSlip44State(99)).toEqual(
        await vaultCache.getSlip44Vault(99)
      );
      expect(store.getState().vault.activeNetwork.slip44).toBe(99);
      expect(store.getState().vault.accountAssets[TYPE][0][family]).toEqual([]);
      expect(commits).toBe(2);
    });

    it.each(['account', 'network', 'lock'] as const)(
      'refuses an old %s context before any asset change or write',
      async (change) => {
        const scope = getWalletNavigationScope();
        if (change === 'account')
          store.dispatch(setActiveAccount({ id: 1, type: TYPE }));
        if (change === 'network')
          store.dispatch(
            setNetworkChange({
              activeNetwork: {
                ...store.getState().vault.activeNetwork,
                chainId: 1,
              },
            })
          );
        if (change === 'lock') wallet.isUnlocked.mockReturnValue(false);
        const before = projection(store.getState().vault);
        await expect(mutate('add', scope)).rejects.toThrow(
          'Asset context changed'
        );
        await expect(mutate('remove', scope)).rejects.toThrow(
          'Asset context changed'
        );
        expect(projection(store.getState().vault)).toEqual(before);
        expect(commits).toBe(0);
      }
    );
  }
);
