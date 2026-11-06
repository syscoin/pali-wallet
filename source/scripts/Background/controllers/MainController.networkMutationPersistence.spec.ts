jest.unmock('syscoinjs-lib');
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
// The registry tests isolate browser rule installation. The real owned RPC
// verifier still checks Blockbook status and genesis before storage writes.
jest.mock('./providers/walletHttpIdentity', () => ({
  withWalletBackend: (_url: string, verify: () => Promise<unknown>) => verify(),
}));
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network';
import { webcrypto } from 'crypto';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { utxoSubmissionUrl } from '../../../wallet/utxoSignedBinding';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import * as walletStore from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setHasEthProperty,
  setNetwork,
  setNetworks,
} from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';

import MainController from './MainController';
import type { UtxoRecordSession } from '../../../wallet/utxoSignedRecords';

const {
  default: store,
  persistCommittedWalletState,
  saveMainState,
} = walletStore;
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
const utxo = (slip44: number, currency: string, url: string): INetwork => ({
  chainId: slip44,
  kind: INetworkType.Syscoin,
  slip44,
  currency,
  label: 'Added synthetic network',
  url,
  utxoBackendChain: 'main',
});
const ltc = utxo(2, 'ltc', 'https://new-network.synthetic.invalid');
const dgb = utxo(20, 'dgb', 'https://queued-network.synthetic.invalid');
const vtc = utxo(28, 'vtc', 'https://removed-network.synthetic.invalid');
const fixtureEndpoints = new Map([
  [ltc.url, ltc],
  ['https://edited-network.synthetic.invalid', ltc],
  ['https://refused-edit.synthetic.invalid', ltc],
  [dgb.url, dgb],
  [vtc.url, vtc],
]);
const clone = <T>(value: T): T => structuredClone(value);
const resultOf = async (operation: Promise<unknown>) =>
  operation.then(
    () => ({ success: true }),
    (error: Error) => ({ success: false, message: error.message })
  );

describe.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  '%s custom-network registry persistence',
  (family) => {
    const target: INetwork =
      family === INetworkType.Syscoin
        ? ltc
        : {
            chainId: 31337,
            kind: family,
            slip44: 60,
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
    const nextRegistryAdmission = () => {
      const original = walletStore.persistNetworkRegistry;
      return new Promise<void>((admitted) => {
        jest
          .spyOn(walletStore, 'persistNetworkRegistry')
          .mockImplementationOnce((...args) => {
            const write = original(...args);
            admitted();
            return write;
          });
      });
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
      wallet.keyrings = new Map([
        [
          source.slip44,
          {
            isUnlocked: () => true,
            getPrivateRecordProfileId: async () => `0x${'a'.repeat(64)}`,
          },
        ],
      ]);
      jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, init) => {
          const url = new URL(String(input));
          const registration = fixtureEndpoints.get(url.origin);
          const coin = registration && findUtxoCoinByRegistration(registration);
          if (!coin || init?.method !== 'GET' || !init.signal)
            throw new Error(`Unexpected fixture network request: ${url.href}`);
          if (url.pathname === '/api/v2/')
            return Response.json({
              blockbook: {
                network: coin.coinShortcut,
                decimals: coin.decimals,
              },
              backend: { chain: 'main' },
            });
          if (url.pathname === '/api/v2/block-index/0')
            return Response.json({ blockHash: coin.hashGenesisBlock });
          throw new Error(`Unexpected fixture network request: ${url.href}`);
        });
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
      await expect(
        wallet.editCustomRpc(
          edited,
          networkRegistrationFingerprint(liveTarget())
        )
      ).resolves.toMatchObject(edited);
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
      const refused = await resultOf(
        wallet.editCustomRpc(
          edited,
          networkRegistrationFingerprint(liveTarget())
        )
      );
      const afterRefusal = {
        live: liveTarget(),
        saved: await savedTarget(),
      };
      const retry = await resultOf(
        wallet.editCustomRpc(
          edited,
          networkRegistrationFingerprint(liveTarget())
        )
      );
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
      const other =
        family === INetworkType.Syscoin ? dgb : { ...target, chainId: 31338 };
      const admitted = nextRegistryAdmission();
      const second = wallet.addCustomRpc(other);
      await admitted;
      store.dispatch(setHasEthProperty(false));
      const ordinarySave = saveMainState();
      held.release();
      await Promise.all([first, second, ordinarySave]);
      const state = await loadState();
      expect(state.vaultGlobal.networks[family][target.chainId]).toEqual(
        liveTarget()
      );
      expect(state.vaultGlobal.networks[family][other.chainId]).toMatchObject(
        other
      );
      expect(state.vaultGlobal.hasEthProperty).toBe(false);
      expect(store.getState().vault.activeNetwork).toEqual(source);
    });

    it('rejects a queued duplicate before a second write', async () => {
      const held = holdNextWrite();
      const first = wallet.addCustomRpc(target);
      await held.started;
      const admitted = nextRegistryAdmission();
      const duplicate = wallet.addCustomRpc(target);
      const rejected = expect(duplicate).rejects.toThrow(
        'network already exists'
      );
      await admitted;
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
      const expected = networkRegistrationFingerprint(liveTarget());
      const first = wallet.editCustomRpc(firstEdit, expected);
      await held.started;
      const admitted = nextRegistryAdmission();
      const second = wallet.editCustomRpc(secondEdit, expected);
      const rejected = expect(second).rejects.toThrow('Network changed');
      await admitted;
      expect(liveTarget().label).toBe(target.label);
      held.release();
      await first;
      await rejected;
      expect(liveTarget()).toMatchObject(firstEdit);
      expect(await savedTarget()).toEqual(liveTarget());
      expect(writeCount).toBe(1);
      await wallet.editCustomRpc(
        secondEdit,
        networkRegistrationFingerprint(liveTarget())
      );
      expect(await savedTarget()).toMatchObject(secondEdit);
    });

    it('repairs a completed stale edit from the latest same-wallet registry', async () => {
      await wallet.addCustomRpc(target);
      writeCount = 0;
      const held = holdNextWrite();
      const edit = wallet.editCustomRpc(
        { ...target, label: 'Obsolete edit' },
        networkRegistrationFingerprint(liveTarget())
      );
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
      const removable = vtc;
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
        removable.label,
        networkRegistrationFingerprint(
          store.getState().vaultGlobal.networks[removable.kind][
            removable.chainId
          ]
        )!
      );
      expect(wallet.isRemovingNetwork).toBe(true);
      held.release();
      await rejected;
      await removal;
      expect(liveTarget()).toBeUndefined();
      expect(await savedTarget()).toBeUndefined();
      expect(
        store.getState().vaultGlobal.networks.syscoin[removable.chainId]
      ).toBeUndefined();
      expect(wallet.isRemovingNetwork).toBe(false);
      await expect(wallet.addCustomRpc(target)).resolves.toMatchObject(target);
      expect(await savedTarget()).toEqual(liveTarget());
    });

    if (family === INetworkType.Syscoin) {
      it('repairs the durable endpoint if the wallet locks before Chrome acknowledges the edit', async () => {
        await wallet.addCustomRpc(target);
        writeCount = 0;
        const held = holdNextWrite();
        const edit = wallet.editCustomRpc(
          { ...target, url: 'https://edited-network.synthetic.invalid' },
          networkRegistrationFingerprint(liveTarget())
        );
        const rejection = expect(edit).rejects.toThrow(
          'Wallet session changed'
        );
        await held.started;
        wallet.advanceWalletSession();
        expect(liveTarget()).toMatchObject(target);
        held.release();
        await rejection;
        expect(liveTarget()).toMatchObject(target);
        expect(await savedTarget()).toMatchObject(target);
        expect(writeCount).toBe(2);
      });

      it('blocks another wallet write if the endpoint rollback cannot be acknowledged', async () => {
        await wallet.addCustomRpc(target);
        const edited = {
          ...target,
          url: 'https://edited-network.synthetic.invalid',
        };
        const started = Promise.withResolvers<void>();
        const acknowledge = Promise.withResolvers<void>();
        const original = chrome.storage.local.set;
        jest
          .spyOn(chrome.storage.local, 'set')
          .mockImplementation((items, callback) => {
            if (
              items.state?.vaultGlobal.networks.syscoin[target.chainId]?.url ===
              edited.url
            ) {
              return original(items, () => {
                void acknowledge.promise.then(() => callback?.());
                started.resolve();
              });
            }
            return original(items, callback);
          });
        const change = wallet.editCustomRpc(
          edited,
          networkRegistrationFingerprint(liveTarget())
        );
        const rejected = expect(change).rejects.toThrow(
          'Close and reopen Pali'
        );
        await started.promise;
        wallet.advanceWalletSession();
        refuseNextCommit = true;
        acknowledge.resolve();
        await rejected;
        expect(liveTarget()).toMatchObject(target);
        expect(walletPersistenceGate.blocked).toBe(true);
        const attempts = writeCount;
        await expect(saveMainState()).resolves.toBe(false);
        expect(writeCount).toBe(attempts);
      });

      it('waits for a signed admission and preserves the endpoint after lost acknowledgment', async () => {
        const originalCrypto = Object.getOwnPropertyDescriptor(
          globalThis,
          'crypto'
        );
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: webcrypto,
        });
        const secret = new Uint8Array(32).fill(17);
        const guard = () => undefined;
        const keyring: UtxoRecordSession['keyring'] & {
          isUnlocked: () => boolean;
        } = {
          isUnlocked: () => true,
          getPrivateRecordProfileId: () =>
            privateRecordProfileId(secret, guard),
          encryptPrivateRecord: (args) =>
            encryptPrivateRecordBytes(secret, args, guard),
          decryptPrivateRecord: (args) =>
            decryptPrivateRecordBytes(secret, args, guard),
        };
        wallet.keyrings.set(source.slip44, keyring);
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        let admission: Promise<unknown> | undefined;
        try {
          await wallet.addCustomRpc(target);
          const coin = findUtxoCoinByRegistration(target)!;
          const { bitcoinjs: bitcoin } = syscoinUtils;
          const signingKey = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 3));
          const script = bitcoin.payments.p2wpkh({
            pubkey: signingKey.publicKey,
          }).output!;
          const prevout = new bitcoin.Transaction();
          prevout.addInput(Buffer.alloc(32, 4), 0);
          prevout.addOutput(script, BigInt(10_000));
          const signed = new bitcoin.Psbt()
            .addInput({
              hash: prevout.getHash(),
              index: 0,
              witnessUtxo: { value: BigInt(10_000), script },
            })
            .addOutput({ script, value: BigInt(9_000) })
            .signInput(0, signingKey)
            .finalizeAllInputs()
            .extractTransaction();
          const owner = {
            chainId: target.chainId,
            slip44: target.slip44,
            genesisHash: coin.hashGenesisBlock,
            account: { id: 0, type: 'HDAccount', xpub: 'public-fixture-xpub' },
          };
          const signedRecord = {
            owner,
            rawTransaction: signed.toHex(),
            txid: signed.getId(),
            url: utxoSubmissionUrl(target.url),
            outpoints: [`${prevout.getId()}:0`],
            feeSatoshis: '1000',
            operation: 'wallet',
            virtualSize: signed.virtualSize(),
          };
          const journal = wallet.getRetainedUtxoRecords();
          admission = journal.admit(
            { keyring, assertCurrent: guard },
            signedRecord,
            'initial',
            async (prepare: () => Promise<void>, release: () => void) => {
              entered.resolve();
              await held.promise;
              await prepare();
              release();
            }
          );
          await entered.promise;
          const edited = {
            ...target,
            url: 'https://edited-network.synthetic.invalid',
          };
          const change = wallet.editCustomRpc(
            edited,
            networkRegistrationFingerprint(liveTarget())
          );
          const rejection = expect(change).rejects.toMatchObject({
            code: 'UTXO_ENDPOINT_HAS_SAVED_TRANSFER',
          });
          held.resolve();
          await admission;
          await rejection;
          expect(await savedTarget()).toMatchObject(target);
          expect(
            await journal.readExact(
              { keyring, assertCurrent: guard },
              owner,
              signedRecord.txid
            )
          ).toEqual(signedRecord);
          await expect(
            wallet.editCustomRpc(
              { ...target, label: 'Updated label' },
              networkRegistrationFingerprint(liveTarget())
            )
          ).resolves.toMatchObject({ label: 'Updated label', url: target.url });
        } finally {
          held.resolve();
          await admission?.catch(() => undefined);
          if (originalCrypto)
            Object.defineProperty(globalThis, 'crypto', originalCrypto);
          else Reflect.deleteProperty(globalThis, 'crypto');
        }
      });
    }

    it('preserves CoinGecko/default metadata through an accepted edit', async () => {
      const metadata = {
        ...target,
        coingeckoId: 'synthetic-coin',
        coingeckoPlatformId: 'synthetic-platform',
      };
      await wallet.addCustomRpc(metadata);
      await wallet.editCustomRpc(
        { ...target, label: 'Edited label', default: true },
        networkRegistrationFingerprint(liveTarget())
      );
      expect(await savedTarget()).toMatchObject({
        label: 'Edited label',
        coingeckoId: metadata.coingeckoId,
        coingeckoPlatformId: metadata.coingeckoPlatformId,
        default: false,
      });
    });
  }
);
