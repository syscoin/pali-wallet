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

import { AccountRecoveryRequiredError } from '../utils/assertCompleteHDAccountData';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { removeAccount, restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

// Public fixture only. SDK allocation, derivation and encryption remain real;
// only the already-authenticated session and offline storage are supplied.
const PHRASE = 'test test test test test test test test test test test junk';
let wallet: any;
let records: Record<string, any>;

beforeEach(() => {
  jest.useFakeTimers();
  const denyNetwork = () => {
    throw new Error('Offline account creation must not access a network');
  };
  jest.spyOn(http, 'request').mockImplementation(denyNetwork);
  jest.spyOn(http, 'get').mockImplementation(denyNetwork);
  jest.spyOn(https, 'request').mockImplementation(denyNetwork);
  jest.spyOn(https, 'get').mockImplementation(denyNetwork);
  jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork);
  jest.spyOn(console, 'log').mockImplementation();
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  const initial = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...initial,
      activeNetwork: {
        ...initial.activeNetwork,
        kind: INetworkType.Ethereum,
        slip44: 60,
        chainId: 1,
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: '0x0000000000000000000000000000000000000001',
            xpub: 'public-hd0',
            label: 'HD0',
          },
        },
        Imported: {},
        Trezor: {},
        Ledger: {},
        SmartAccount: {},
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  records = {};
  jest.spyOn(chromeStorage, 'setItems').mockImplementation(async (items) => {
    Object.assign(records, structuredClone(items));
  });
  jest
    .spyOn(chromeStorage, 'getItem')
    .mockImplementation(async (key) => structuredClone(records[key] ?? null));
  const manager: any = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault);
  manager.isUnlocked = () => true;
  manager.getDecryptedMnemonic = () => PHRASE;
  manager.withSecureData = (operation: (password: string) => unknown) =>
    operation('public test session password');
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.getActiveKeyring = () => manager;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.refreshActiveAccountLightweight = jest.fn();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
});

it('sequential HD creations keep both real derived accounts durably', async () => {
  const first = await wallet.createAccount('First');
  const second = await wallet.createAccount('Second');
  expect([first.id, second.id]).toEqual([1, 2]);
  expect(first.address).not.toBe(second.address);
  const saved = await loadSlip44State(60);
  expect(saved.accounts.HDAccount[1].label).toBe('First');
  expect(saved.accounts.HDAccount[2].label).toBe('Second');
});

it('does not acknowledge two HD creations for one allocated slot and permits a safe retry', async () => {
  const results = await Promise.allSettled([
    wallet.createAccount('First'),
    wallet.createAccount('Second'),
  ]);
  const winners = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(winners).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const winner = (winners[0] as PromiseFulfilledResult<any>).value;
  expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
    'retry'
  );
  const saved = await loadSlip44State(60);
  expect(saved.accounts.HDAccount[winner.id]).toEqual({
    ...winner,
    balances: { ethereum: -1, syscoin: -1 },
    slip44: 60,
  });
  const retry = await wallet.createAccount('Retried');
  expect(retry.id).toBe(2);
  expect(retry.address).not.toBe(winner.address);
  expect((await loadSlip44State(60)).accounts.HDAccount[2].label).toBe(
    'Retried'
  );
});

it('fills a deleted HD gap without replacing the next complete account', async () => {
  const deleted = await wallet.createAccount('Deleted');
  const retained = await wallet.createAccount('Retained');
  store.dispatch(
    removeAccount({ id: deleted.id, type: KeyringAccountType.HDAccount })
  );
  const replacement = await wallet.createAccount('Gap replacement');
  expect(replacement.id).toBe(deleted.id);
  expect(replacement.address).toBe(deleted.address);
  expect(replacement.address).not.toBe(retained.address);
  const saved = await loadSlip44State(60);
  expect(saved.accounts.HDAccount[deleted.id].label).toBe('Gap replacement');
  expect(saved.accounts.HDAccount[retained.id].label).toBe('Retained');
});

it.each(['address', 'xpub'] as const)(
  'reports recovery on every attempt for an HD record missing %s without deriving or changing it',
  async (missing) => {
    const current = store.getState().vault;
    const existing = {
      id: 1,
      address: 'saved-address',
      xpub: 'saved-public-key',
      label: 'Recoverable record',
      [missing]: '',
    };
    store.dispatch(
      restoreVaultSnapshot({
        ...current,
        accounts: {
          ...current.accounts,
          HDAccount: { ...current.accounts.HDAccount, 1: existing },
        },
      } as any)
    );
    const snapshot = store.getState().vault;
    const derive = jest.spyOn(wallet.getActiveKeyring(), 'addNewAccount');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(wallet.createAccount('Replacement')).rejects.toBeInstanceOf(
        AccountRecoveryRequiredError
      );
      expect(store.getState().vault).toBe(snapshot);
      expect(records).toEqual({});
    }
    expect(derive).not.toHaveBeenCalled();
  }
);

it('preserves an incomplete record arriving while real SDK derivation is pending', async () => {
  const creating = wallet.createAccount('Pending');
  const current = store.getState().vault;
  const existing = {
    id: 7,
    address: '',
    xpub: 'partial-public-key',
    label: 'Recoverable record',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...current,
      accounts: {
        ...current.accounts,
        HDAccount: { ...current.accounts.HDAccount, 7: existing },
      },
    } as any)
  );
  const snapshot = store.getState().vault;
  await expect(creating).rejects.toBeInstanceOf(AccountRecoveryRequiredError);
  expect(store.getState().vault).toBe(snapshot);
  expect(store.getState().vault.accounts.HDAccount[1]).toBeUndefined();
  expect(records).toEqual({});
});
