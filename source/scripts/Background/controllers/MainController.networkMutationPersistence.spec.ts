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
import store, { persistCommittedWalletState, saveMainState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setHasEthProperty,
  setNetwork,
  setNetworks,
} from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import MainController from './MainController';

const originalChrome = global.chrome;
const FAILURE = 'Synthetic network registry storage refusal';
const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Current synthetic network',
  currency: 'eth',
  url: 'https://source-network.synthetic.invalid',
};
const clone = <T>(value: T): T => structuredClone(value);
const resultOf = async (operation: Promise<unknown>) =>
  operation.then(
    () => ({ success: true }),
    (error: Error) => ({ success: false, message: error.message })
  );

describe.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  '%s custom-network registry persistence',
  (family) => {
    const target: INetwork = {
      chainId: 31337,
      kind: family,
      slip44: family === INetworkType.Ethereum ? 60 : 111,
      label: 'Added synthetic network',
      currency: 'test',
      url: 'https://new-network.synthetic.invalid',
    };
    let wallet: any;
    let records: Record<string, any>;
    let refuseNextCommit: boolean;
    let writeCount: number;
    const liveTarget = () =>
      store.getState().vaultGlobal.networks[family][target.chainId];
    const savedTarget = async () =>
      (await loadState()).vaultGlobal.networks[family][target.chainId];
    const holdNextWrite = () => {
      const original = chrome.storage.local.set;
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => (entered = resolve));
      let held = false;
      jest
        .spyOn(chrome.storage.local, 'set')
        .mockImplementation((items: Record<string, any>, callback: any) => {
          if (items.state && !held) {
            held = true;
            const snapshot = clone(items);
            release = () => original(snapshot, callback);
            entered();
          } else original(items, callback);
        });
      return { started, release: () => release() };
    };

    beforeEach(async () => {
      jest.useFakeTimers();
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(console, 'warn').mockImplementation();
      records = {};
      refuseNextCommit = false;
      writeCount = 0;
      global.chrome = {
        runtime: { id: 'synthetic-network-registry' },
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
              writeCount += 1;
              if (items.state && refuseNextCommit) {
                refuseNextCommit = false;
                (chrome.runtime as any).lastError = { message: FAILURE };
                callback();
                delete (chrome.runtime as any).lastError;
                return;
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
      wallet.walletStateGeneration = 0;
      wallet.walletSessionGeneration = 0;
      wallet.isRemovingNetwork = false;
      wallet.keyrings = new Map();
      wallet.resetAutoLockTimer = jest.fn();
      wallet.evmAssetsController = {
        detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
      };
      await persistCommittedWalletState(true);
      writeCount = 0;
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      vaultCache.clearCache();
      jest.restoreAllMocks();
      global.chrome = originalChrome;
    });

    it('durably adds and edits the registry without silently activating the edited RPC', async () => {
      await expect(wallet.addCustomRpc(target)).resolves.toMatchObject(target);
      expect(liveTarget()).toEqual(await savedTarget());
      const edited = {
        ...target,
        label: 'Edited synthetic network',
        url: 'https://edited-network.synthetic.invalid',
      };
      await expect(wallet.editCustomRpc(edited)).resolves.toMatchObject(edited);
      expect(liveTarget()).toMatchObject(edited);
      expect(await savedTarget()).toEqual(liveTarget());
      expect(store.getState().vault.activeNetwork).toEqual(source);
      expect(writeCount).toBe(2);
    });

    it('leaves a refused add absent and allows the same custom or external request to retry', async () => {
      refuseNextCommit = true;
      const refused = await resultOf(wallet.addCustomRpc(target));
      const afterRefusal = {
        live: liveTarget() || null,
        saved: (await savedTarget()) || null,
      };
      // Both CustomRPC and ExternalAddRPC call addCustomRpc again after a
      // rejected reply; the latter only remembers additions that succeeded.
      const retry = await resultOf(wallet.addCustomRpc(target));
      expect({ refused, afterRefusal, retry, writeCount }).toEqual({
        refused: { success: false, message: FAILURE },
        afterRefusal: { live: null, saved: null },
        retry: { success: true },
        writeCount: 2,
      });
      expect(await savedTarget()).toEqual(liveTarget());
    });

    it('keeps a refused edit unpublished and permits an ordinary retry', async () => {
      await wallet.addCustomRpc(target);
      const original = clone(liveTarget());
      const edited = {
        ...target,
        label: 'Refused synthetic edit',
        url: 'https://refused-edit.synthetic.invalid',
      };
      writeCount = 0;
      refuseNextCommit = true;
      const refused = await resultOf(wallet.editCustomRpc(edited));
      const afterRefusal = {
        live: liveTarget(),
        saved: await savedTarget(),
      };
      const retry = await resultOf(wallet.editCustomRpc(edited));
      expect({ refused, afterRefusal, retry, writeCount }).toEqual({
        refused: { success: false, message: FAILURE },
        afterRefusal: { live: original, saved: original },
        retry: { success: true },
        writeCount: 2,
      });
      expect(await savedTarget()).toEqual(liveTarget());
    });

    it('does not let an unrelated scheduled save commit a previously refused add', async () => {
      refuseNextCommit = true;
      await expect(wallet.addCustomRpc(target)).rejects.toMatchObject({
        message: FAILURE,
      });
      await wallet.saveCurrentState('normal-background-follow-up');
      await jest.advanceTimersByTimeAsync(100);
      expect({
        live: liveTarget() || null,
        saved: (await savedTarget()) || null,
      }).toEqual({ live: null, saved: null });
      expect(store.getState().vault.activeNetwork).toEqual(source);
    });

    it('keeps a held add unpublished and preserves other queued networks and preferences', async () => {
      const held = holdNextWrite();
      const first = wallet.addCustomRpc(target);
      await held.started;
      expect(liveTarget()).toBeUndefined();
      expect(await savedTarget()).toBeUndefined();
      const other = { ...target, chainId: 31338, slip44: 222 };
      const second = wallet.addCustomRpc(other);
      store.dispatch(setHasEthProperty(false));
      const ordinarySave = saveMainState();
      held.release();
      await Promise.all([first, second, ordinarySave]);
      const state = await loadState();
      expect(state.vaultGlobal.networks[family][31337]).toEqual(liveTarget());
      expect(state.vaultGlobal.networks[family][31338]).toMatchObject(other);
      expect(state.vaultGlobal.hasEthProperty).toBe(false);
      expect(store.getState().vault.activeNetwork).toEqual(source);
    });

    it('rejects a queued duplicate before a second write', async () => {
      const held = holdNextWrite();
      const first = wallet.addCustomRpc(target);
      await held.started;
      const duplicate = wallet.addCustomRpc(target);
      const rejected = expect(duplicate).rejects.toThrow(
        'network already exists'
      );
      held.release();
      await first;
      await rejected;
      expect(writeCount).toBe(1);
      expect(await savedTarget()).toEqual(liveTarget());
    });

    it('refuses a stale queued edit while preserving the earlier accepted edit', async () => {
      await wallet.addCustomRpc(target);
      writeCount = 0;
      const firstEdit = { ...target, label: 'First accepted edit' };
      const secondEdit = { ...target, label: 'Second explicit edit' };
      const held = holdNextWrite();
      const first = wallet.editCustomRpc(firstEdit);
      await held.started;
      const second = wallet.editCustomRpc(secondEdit);
      const rejected = expect(second).rejects.toThrow('Network changed');
      expect(liveTarget().label).toBe(target.label);
      held.release();
      await first;
      await rejected;
      expect(liveTarget()).toMatchObject(firstEdit);
      expect(await savedTarget()).toEqual(liveTarget());
      expect(writeCount).toBe(1);
      await wallet.editCustomRpc(secondEdit);
      expect(await savedTarget()).toMatchObject(secondEdit);
    });

    it('repairs a completed stale edit from the latest same-wallet registry', async () => {
      await wallet.addCustomRpc(target);
      writeCount = 0;
      const held = holdNextWrite();
      const edit = wallet.editCustomRpc({ ...target, label: 'Obsolete edit' });
      const rejected = expect(edit).rejects.toThrow('Network changed');
      await held.started;
      const latest = { ...target, label: 'Replacement registry record' };
      store.dispatch(setNetwork({ network: latest, isEdit: true }));
      store.dispatch(setHasEthProperty(false));
      held.release();
      await rejected;
      const saved = await loadState();
      expect(saved.vaultGlobal.networks[family][target.chainId]).toMatchObject(
        latest
      );
      expect(saved.vaultGlobal.hasEthProperty).toBe(false);
      expect(writeCount).toBe(2);
    });

    it('does not repair a stale add over a replacement wallet', async () => {
      const held = holdNextWrite();
      const adding = wallet.addCustomRpc(target);
      const rejected = expect(adding).rejects.toThrow('Wallet state changed');
      await held.started;
      wallet.walletStateGeneration += 1;
      const replacement = { ...source, label: 'Replacement wallet network' };
      store.dispatch(
        setNetworks({ ethereum: { 1: replacement }, syscoin: {} })
      );
      const replacementSave = saveMainState();
      held.release();
      await rejected;
      await replacementSave;
      expect((await loadState()).vaultGlobal.networks).toEqual(
        store.getState().vaultGlobal.networks
      );
      expect(liveTarget()).toBeUndefined();
      expect(writeCount).toBe(2);
    });

    it('yields to actual concurrent network removal and permits a fresh retry', async () => {
      const removable = {
        ...target,
        kind: INetworkType.Syscoin,
        chainId: 31339,
        slip44: 223,
      };
      await wallet.addCustomRpc(removable);
      writeCount = 0;
      const held = holdNextWrite();
      const adding = wallet.addCustomRpc(target);
      const rejected = expect(adding).rejects.toThrow('Network removal');
      await held.started;
      const removal = wallet.removeKeyringNetwork(
        removable.kind,
        removable.chainId,
        removable.url,
        removable.label
      );
      expect(wallet.isRemovingNetwork).toBe(true);
      held.release();
      await rejected;
      await removal;
      expect(liveTarget()).toBeUndefined();
      expect(await savedTarget()).toBeUndefined();
      expect(
        store.getState().vaultGlobal.networks.syscoin[31339]
      ).toBeUndefined();
      expect(wallet.isRemovingNetwork).toBe(false);
      await expect(wallet.addCustomRpc(target)).resolves.toMatchObject(target);
      expect(await savedTarget()).toEqual(liveTarget());
    });

    it('preserves CoinGecko/default metadata through an accepted edit', async () => {
      const metadata = {
        ...target,
        coingeckoId: 'synthetic-coin',
        coingeckoPlatformId: 'synthetic-platform',
      };
      await wallet.addCustomRpc(metadata);
      await wallet.editCustomRpc({
        ...target,
        label: 'Edited label',
        default: true,
      });
      expect(await savedTarget()).toMatchObject({
        label: 'Edited label',
        coingeckoId: metadata.coingeckoId,
        coingeckoPlatformId: metadata.coingeckoPlatformId,
        default: false,
      });
    });
  }
);
