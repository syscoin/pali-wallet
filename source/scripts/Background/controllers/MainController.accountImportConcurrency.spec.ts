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
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const keys = [`0x${'01'.padStart(64, '0')}`, `0x${'02'.padStart(64, '0')}`];
let wallet: any;
let disk: Record<string, any>;
let manager: any;

beforeEach(() => {
  jest.useFakeTimers();
  const denyNetwork = () => {
    throw new Error('Offline import probe must not access a network');
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
      accountAssets: {
        HDAccount: {},
        Imported: {},
        Trezor: {},
        Ledger: {},
        SmartAccount: {},
      },
      accountTransactions: {
        HDAccount: {},
        Imported: {},
        Trezor: {},
        Ledger: {},
        SmartAccount: {},
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  disk = {};
  jest.spyOn(chromeStorage, 'setItems').mockImplementation(async (items) => {
    Object.assign(disk, structuredClone(items));
  });
  jest
    .spyOn(chromeStorage, 'setItem')
    .mockImplementation(async (key, value) => {
      disk[key] = structuredClone(value);
    });
  jest
    .spyOn(chromeStorage, 'getItem')
    .mockImplementation(async (key) => structuredClone(disk[key] ?? null));
  // Only authentication/session setup is synthetic. SDK import validation,
  // public-key derivation, account-ID allocation and encryption remain real.
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault);
  manager.isUnlocked = () => true;
  manager.withSecureData = (operation: (password: string) => unknown) =>
    operation('public test session password');
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.getActiveKeyring = () => manager;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.getLatestUpdateForCurrentAccount = jest
    .fn()
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
});

it('healthy sequential imports keep both distinct real SDK accounts durably', async () => {
  const first = await wallet.importAccountFromPrivateKey(keys[0], 'First');
  const second = await wallet.importAccountFromPrivateKey(keys[1], 'Second');
  expect(first.address).not.toBe(second.address);
  expect([first.id, second.id]).toEqual([0, 1]);
  const cold = await loadSlip44State(60);
  expect(
    Object.values(cold.accounts.Imported).map((account: any) => account.address)
  ).toEqual([first.address, second.address]);
});

it('rejects a conflicting import without overwriting the acknowledged account and permits retry', async () => {
  const results = await Promise.allSettled(
    keys.map((key) => wallet.importAccountFromPrivateKey(key))
  );
  const winner = results.find(
    (result) => result.status === 'fulfilled'
  ) as PromiseFulfilledResult<any>;
  const loserIndex = results.findIndex(
    (result) => result.status === 'rejected'
  );
  expect(
    results.filter((result) => result.status === 'fulfilled')
  ).toHaveLength(1);
  expect(loserIndex).toBeGreaterThanOrEqual(0);
  expect(
    (results[loserIndex] as PromiseRejectedResult).reason.message
  ).toContain('Please retry');
  expect(
    Object.values((await loadSlip44State(60)).accounts.Imported).map(
      (account: any) => account.address
    )
  ).toEqual([winner.value.address]);
  const retried = await wallet.importAccountFromPrivateKey(keys[loserIndex]);
  expect(retried.address).not.toBe(winner.value.address);
  expect(
    Object.values((await loadSlip44State(60)).accounts.Imported)
  ).toHaveLength(2);
});

const watched = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';

it.each(['private first', 'watch first'])(
  'preserves the successful private/watch import and permits the collision to retry: %s',
  async (order) => {
    const startPrivate = () =>
      wallet.importAccountFromPrivateKey(keys[0], 'Private');
    const startWatch = () =>
      wallet.importWatchOnlyFromController(watched, 'Watch');
    const starts =
      order === 'private first'
        ? [startPrivate, startWatch]
        : [startWatch, startPrivate];
    const results = await Promise.allSettled(starts.map((start) => start()));
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    const loserIndex = results.findIndex(
      (result) => result.status === 'rejected'
    );
    expect(
      (results[loserIndex] as PromiseRejectedResult).reason.message
    ).toContain('Please retry');
    await starts[loserIndex]();
    const cold = await loadSlip44State(60);
    expect(Object.values(cold.accounts.Imported)).toHaveLength(2);
    expect(
      Object.values(cold.accounts.Imported).find(
        (account: any) => account.address === watched
      )
    ).toMatchObject({ xprv: '', xpub: watched });
    expect(fetch).not.toHaveBeenCalled();
  }
);

it.each(['reset', 'keyring change'])(
  'rejects a stale writer-queued EVM import after %s without blocking new imports',
  async (change) => {
    // EVM watch imports no longer make a Blockbook request. Hold their real
    // durable writer boundary instead; SDK private derivation remains real.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const blocker = walletPersistenceMutex.runExclusive(() => held);
    const queued = jest.spyOn(walletPersistenceMutex, 'runExclusive');
    const pending = wallet.importWatchOnlyFromController(watched, 'Old watch');
    const rejection = expect(pending).rejects.toThrow('Wallet session changed');
    let freshPending: Promise<any> | undefined;
    try {
      expect(queued).toHaveBeenCalledTimes(1);
      expect(chromeStorage.setItems).not.toHaveBeenCalled();
      if (change === 'reset') {
        wallet.walletSessionGeneration += 1;
        wallet.walletStateGeneration += 1;
      } else {
        const replacement = Object.create(manager);
        wallet.getActiveKeyring = () => replacement;
      }
      freshPending = wallet.importAccountFromPrivateKey(keys[0], 'Fresh');
      // Observe both callers entering the real FIFO before releasing it.
      // This only drains ordinary promise turns; it changes no clock or I/O.
      for (let turn = 0; turn < 20 && queued.mock.calls.length < 2; turn++)
        await Promise.resolve();
      expect(queued).toHaveBeenCalledTimes(2);
      expect(chromeStorage.setItems).not.toHaveBeenCalled();
    } finally {
      release();
      await blocker;
      await Promise.allSettled([
        pending,
        ...(freshPending ? [freshPending] : []),
      ]);
    }
    await rejection;
    const fresh = await freshPending!;
    expect(fresh.address).toBeTruthy();
    expect(
      Object.values((await loadSlip44State(60)).accounts.Imported).map(
        (account: any) => account.address
      )
    ).toEqual([fresh.address]);
    expect(store.getState().vault.accounts.Imported[0].address).toBe(
      fresh.address
    );
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('an SDK failure does not block a separate import or clean retry', async () => {
  jest
    .spyOn(manager, 'importAccount')
    .mockRejectedValueOnce(new Error('Synthetic import rejection'));
  const rejected = wallet.importAccountFromPrivateKey(keys[0], 'First');
  const succeeding = wallet.importAccountFromPrivateKey(keys[1], 'Second');
  await expect(rejected).rejects.toThrow('Synthetic import rejection');
  const second = await succeeding;
  const retry = await wallet.importAccountFromPrivateKey(keys[0], 'Retry');
  expect([second.id, retry.id]).toEqual([0, 1]);
  expect(
    Object.values((await loadSlip44State(60)).accounts.Imported).map(
      (account: any) => account.address
    )
  ).toEqual([second.address, retry.address]);
});
