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

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  createAccount,
  restoreVaultSnapshot,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController from './MainController';

const PHRASE = 'test test test test test test test test test test test junk';
const FAILURE = 'Synthetic HD creation storage refusal';
const originalChrome = global.chrome;
let wallet: any;
let manager: any;
let records: Record<string, any>;
let refuseNextCommit: boolean;
let commits: number;
const projection = (vault: any) => ({
  active: vault.activeAccount,
  accounts: Object.values(vault.accounts.HDAccount).map((account: any) => ({
    id: account.id,
    label: account.label,
    address: account.address,
  })),
});

beforeEach(async () => {
  jest.useFakeTimers();
  const deny = () => {
    throw new Error('HD creation must remain offline');
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
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: '0x0000000000000000000000000000000000000001',
    xpub: 'public-anchor',
    label: 'Anchor',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: {
        kind: INetworkType.Ethereum,
        slip44: 60,
        chainId: 1,
        url: 'https://hd-create.synthetic.invalid',
        currency: 'eth',
        label: 'Synthetic EVM',
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  records = {};
  refuseNextCommit = false;
  commits = 0;
  global.chrome = {
    runtime: { id: 'synthetic-hd-create' },
    storage: {
      local: {
        get: (keys: string[], callback: (result: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, structuredClone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          if (items['state-vault-60']) commits += 1;
          if (items['state-vault-60'] && refuseNextCommit) {
            refuseNextCommit = false;
            (chrome.runtime as any).lastError = { message: FAILURE };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, structuredClone(items));
          callback();
        },
      },
    },
  } as any;
  await persistCommittedWalletState(true);
  commits = 0;
  // Real SDK derivation, allocation and encryption; public synthetic session.
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault);
  manager.isUnlocked = () => true;
  manager.getDecryptedMnemonic = () => PHRASE;
  manager.withSecureData = (operation: (password: string) => unknown) =>
    operation('public synthetic session password');
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.getActiveKeyring = () => manager;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.refreshActiveAccountLightweight = jest.fn();
});

afterEach(async () => {
  await manager.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

const holdCommit = () => {
  let release!: () => void;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const set = chrome.storage.local.set;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback: any) => {
      if (items['state-vault-60'] && !held) {
        held = true;
        release = () => (set as any)(items, callback);
        start();
      } else (set as any)(items, callback);
    });
  return { started, release: () => release() };
};

it('persists ordinary sequential HD creations with distinct derived identities', async () => {
  const first = await wallet.createAccount('First');
  const second = await wallet.createAccount('Second');
  expect([first.id, second.id]).toEqual([1, 2]);
  expect(first.address).not.toBe(second.address);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});

it('keeps a refused HD creation unpublished and lets the same user action retry exactly once', async () => {
  const before = projection(store.getState().vault);
  refuseNextCommit = true;
  await expect(wallet.createAccount('Requested account')).rejects.toMatchObject(
    { message: FAILURE }
  );
  const afterRefusal = {
    live: projection(store.getState().vault),
    cached: projection(await vaultCache.getSlip44Vault(60)),
    cold: projection(await loadSlip44State(60)),
  };
  const retried = await wallet.createAccount('Requested account');
  const afterRetry = projection(await loadSlip44State(60));
  expect({
    afterRefusal,
    retriedId: retried.id,
    finalIds: afterRetry.accounts.map((account) => account.id),
  }).toEqual({
    afterRefusal: { live: before, cached: before, cold: before },
    retriedId: 1,
    finalIds: [0, 1],
  });
  expect(afterRetry).toEqual(projection(store.getState().vault));
});

it('reuses the requested HD slot after cold hydration without changing SDK bookkeeping', async () => {
  refuseNextCommit = true;
  await expect(wallet.createAccount('Requested account')).rejects.toMatchObject(
    { message: FAILURE }
  );
  const cold = await loadSlip44State(60);
  expect(projection(cold).accounts.map((account) => account.id)).toEqual([0]);
  vaultCache.clearCache();
  store.dispatch(restoreVaultSnapshot(cold));
  const retry = await wallet.createAccount('Requested account');
  expect(retry.id).toBe(1);
  expect(
    projection(await loadSlip44State(60)).accounts.map((account) => account.id)
  ).toEqual([0, 1]);
});

it('does not publish an HD account or its active selection before the real held commit', async () => {
  const before = projection(store.getState().vault);
  const write = holdCommit();
  const creating = wallet.createAccount('Requested account');
  await write.started;
  expect(projection(store.getState().vault)).toEqual(before);
  expect(projection(await vaultCache.getSlip44Vault(60))).toEqual(before);
  write.release();
  const result = await creating;
  expect(result.id).toBe(1);
  expect(store.getState().vault.activeAccount).toEqual({
    id: 1,
    type: KeyringAccountType.HDAccount,
  });
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});

it.each(['account', 'network', 'lock', 'keyring'] as const)(
  'repairs an unpublished HD creation after a held-save %s change',
  async (change) => {
    const write = holdCommit();
    const creating = wallet.createAccount('Requested account');
    const rejected = expect(creating).rejects.toThrow('Wallet session changed');
    await write.started;
    if (change === 'keyring') {
      const currentManager = wallet.getActiveKeyring();
      wallet.getActiveKeyring = () => Object.create(currentManager);
    } else {
      wallet.walletSessionGeneration += 1;
      if (change === 'account') {
        store.dispatch(
          createAccount({
            accountType: KeyringAccountType.HDAccount,
            account: {
              id: 2,
              address: 'other-public',
              xpub: 'other-public',
              label: 'Other',
            } as any,
          })
        );
        store.dispatch(
          setActiveAccount({ id: 2, type: KeyringAccountType.HDAccount })
        );
      } else if (change === 'network') {
        store.dispatch(
          setNetworkChange({
            activeNetwork: {
              ...store.getState().vault.activeNetwork,
              url: 'https://other-hd.synthetic.invalid',
            },
          })
        );
      } else {
        vaultCache.clearCache();
      }
    }
    const current = projection(store.getState().vault);
    write.release();
    await rejected;
    expect(projection(store.getState().vault)).toEqual(current);
    expect(projection(await loadSlip44State(60))).toEqual(current);
    expect(store.getState().vault.accounts.HDAccount[1]).toBeUndefined();
    expect(commits).toBe(2);
  }
);

it('refuses a partial HD record arriving after derivation but before commit completion', async () => {
  const write = holdCommit();
  const creating = wallet.createAccount('Requested account');
  const rejected = expect(creating).rejects.toThrow('recovery');
  await write.started;
  const current = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...current,
      accounts: {
        ...current.accounts,
        HDAccount: {
          ...current.accounts.HDAccount,
          7: { id: 7, address: '', xpub: 'partial-public', label: 'Partial' },
        },
      },
    } as any)
  );
  write.release();
  await rejected;
  expect(store.getState().vault.accounts.HDAccount[1]).toBeUndefined();
  expect((await loadSlip44State(60)).accounts.HDAccount[7].xpub).toBe(
    'partial-public'
  );
});

it('leaves old-wallet repair to the new reset owner', async () => {
  const write = holdCommit();
  const creating = wallet.createAccount('Requested account');
  const rejected = expect(creating).rejects.toThrow('Wallet session changed');
  await write.started;
  wallet.walletSessionGeneration += 1;
  wallet.walletStateGeneration += 1;
  vaultCache.clearCache();
  write.release();
  await rejected;
  expect(store.getState().vault.accounts.HDAccount[1]).toBeUndefined();
  expect(commits).toBe(1);
});
