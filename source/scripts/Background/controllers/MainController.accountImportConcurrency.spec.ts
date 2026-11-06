jest.unmock('syscoinjs-lib');
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
import { webcrypto } from 'crypto';
import http from 'http';
import https from 'https';

import { getController } from '..';
import { attachImportedRecoveryCryptoFixture } from '../../../../tests/fixtures/importedRecoveryCrypto';
import {
  importedRecoveryStorageKey,
  readImportedRecoverySecret,
} from '../../../wallet/importedAccountRecovery';
import { handleMasterControllerResponses } from '../handlers/handleMasterControllerResponses';
import { bindPersonalSignApproval } from '../handlers/personalSignApproval';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, {
  persistAccountLabel,
  persistCommittedWalletState,
} from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountPropertyByIdAndType,
  setActiveAccount,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
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
  jest
    .spyOn(chromeStorage, 'getItems')
    .mockImplementation(async (names) =>
      Object.fromEntries(
        names
          .filter((key) => Object.hasOwn(disk, key))
          .map((key) => [key, structuredClone(disk[key])])
      )
    );
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
  attachImportedRecoveryCryptoFixture(manager);
  manager.setVaultStateGetter(() => store.getState().vault);
  manager.isUnlocked = () => true;
  manager.withSecureData = (operation: (password: string) => unknown) =>
    operation('public test session password');
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.authenticationMutex = new AsyncMutex();
  wallet.checkRateLimit = jest.fn().mockResolvedValue(0);
  wallet.resetRateLimit = jest.fn().mockResolvedValue(undefined);
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
  walletPersistenceGate.blocked = false;
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

it('the real controller commits a real SDK recovery envelope after Chrome serializes an absent option as null', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const sdk = jest.requireActual('@sidhujag/sysweb3-keyring/cjs/software.js');
  const values = new Map<string, unknown>();
  const software = new sdk.SoftwareKeyring(
    sdk.createSoftwareKeyringHost({
      async get(key: string) {
        return values.get(key);
      },
      async set(key: string, value: unknown) {
        values.set(key, value);
      },
      async deleteItem(key: string) {
        values.delete(key);
      },
      async createManyIfAbsent(items: Record<string, unknown>) {
        if (Object.keys(items).some((key) => values.has(key))) return false;
        Object.entries(items).forEach(([key, value]) => values.set(key, value));
        return true;
      },
    })
  );
  software.setVaultStateGetter(() => store.getState().vault);
  try {
    await software.initializeSession(
      'test test test test test test test test test test test junk',
      'Public recovery fixture 1!'
    );
    wallet.getActiveKeyring = () => software;
    const account = await importThroughChromeMessage(
      keys[0],
      'Real protected import'
    );
    expect(account).not.toHaveProperty('error');
    const profile = await software.getPrivateRecordProfileId();
    const recoveryKey = `state-imported-account-recovery-v1:${profile}:imported:60:${account.id}`;
    const copy = disk[recoveryKey];
    expect(importedRecoveryStorageKey(copy)).toBe(recoveryKey);
    expect(copy.identity.address).toBe(account.address);
    expect(disk['state-vault-60'].accounts.Imported[account.id].xprv).toBe(
      account.xprv
    );
    expect(JSON.stringify(copy)).not.toContain(keys[0]);
    const opened = await readImportedRecoverySecret(
      software,
      copy,
      copy.identity,
      () => undefined
    );
    expect(opened.secret).toBe(keys[0]);
    expect(account).not.toHaveProperty('recovery');
  } finally {
    await software.destroy();
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
  }
});

it.each([
  false,
  0,
  'invalid',
  [],
  { unexpected: true },
  { utxoAddressType: 'invalid' },
])(
  'rejects malformed non-null import options %p before SDK import or persistence',
  async (options) => {
    const before = structuredClone(disk);
    const importAccount = jest.spyOn(manager, 'importAccount');
    const response = await importThroughChromeMessage(
      keys[0],
      'Invalid option',
      options
    );
    expect(response).toMatchObject({
      success: false,
      error: expect.any(String),
    });
    expect(importAccount).not.toHaveBeenCalled();
    expect(disk).toEqual(before);
    expect(store.getState().vault.accounts.Imported).toEqual({});
  }
);

function importThroughChromeMessage(
  secret: string,
  label: string,
  options?: unknown
): Promise<any> {
  const wire = JSON.parse(
    JSON.stringify({
      type: 'CONTROLLER_ACTION',
      data: {
        methods: ['wallet', 'importAccountFromPrivateKey'],
        params: [secret, label, options],
      },
    })
  );
  if (options === undefined) expect(wire.data.params[2]).toBeNull();
  Object.assign(chrome.runtime, {
    getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
    id: 'pali-extension',
  });
  // Match the normal controller constructor's binding before dispatch.
  wallet.importAccountFromPrivateKey =
    wallet.importAccountFromPrivateKey.bind(wallet);
  handleMasterControllerResponses({ wallet } as any);
  const calls = jest.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  const listener = calls[calls.length - 1][0];
  return new Promise((resolve) => {
    expect(
      listener(
        wire,
        {
          id: 'pali-extension',
          url: 'chrome-extension://pali-extension/app.html',
        },
        resolve
      )
    ).toBe(true);
  });
}

it('repairs a committed-but-rejected controller import before another vault edit or retry', async () => {
  jest.mocked(chromeStorage.setItems).mockImplementationOnce(async (items) => {
    Object.assign(disk, structuredClone(items));
    throw Error('Lost controller import acknowledgement');
  });
  await expect(
    wallet.importAccountFromPrivateKey(keys[0], 'Unacknowledged')
  ).rejects.toThrow('Lost controller import acknowledgement');
  expect(store.getState().vault.accounts.Imported[0]).toBeUndefined();
  await persistAccountLabel(
    0,
    KeyringAccountType.HDAccount,
    'Safe subsequent edit',
    () => undefined
  );
  expect(disk['state-vault-60'].accounts.Imported[0]).toBeUndefined();
  expect(
    Object.entries(disk).filter(
      ([key, value]) =>
        key.startsWith('state-imported-account-recovery-v1:') && value !== null
    )
  ).toEqual([]);
  const retried = await wallet.importAccountFromPrivateKey(
    keys[0],
    'Acknowledged retry'
  );
  expect(retried.id).toBe(0);
  expect(disk['state-vault-60'].accounts.Imported[0].address).toBe(
    retried.address
  );
  expect(
    Object.entries(disk).filter(
      ([key, value]) =>
        key.startsWith('state-imported-account-recovery-v1:') && value !== null
    )
  ).toHaveLength(1);
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

const failImportRepair = async () => {
  jest.mocked(chromeStorage.setItems).mockImplementationOnce(async (items) => {
    Object.assign(disk, structuredClone(items));
    throw Error('Lost import acknowledgement');
  });
  // An acknowledged no-op is not proof that the original account/copy pair
  // was restored. The real persistence path must classify it as uncertain.
  jest.mocked(chromeStorage.setItems).mockResolvedValueOnce(undefined);
  await expect(wallet.importAccountFromPrivateKey(keys[0])).rejects.toThrow(
    'Imported account recovery repair was not acknowledged'
  );
  expect(walletPersistenceGate.blocked).toBe(true);
  expect(store.getState().vault.accounts.Imported[0]).toBeUndefined();
  expect(disk['state-vault-60'].accounts.Imported[0]).toBeDefined();
  expect(
    Object.keys(disk).filter((key) =>
      key.startsWith('state-imported-account-recovery-v1:')
    )
  ).toHaveLength(1);
  return structuredClone(disk);
};

it('denies secret exports and SDK signing after an actual uncertain import repair without changing retained data', async () => {
  manager.getSeed = jest.fn().mockResolvedValue('synthetic seed');
  manager.getPrivateKeyByAccountId = jest
    .fn()
    .mockResolvedValue('synthetic key');
  Object.assign(manager.ethereumTransaction, {
    signPersonalMessage: jest.fn(),
  });
  const retained = await failImportRepair();
  const writes = jest.mocked(chromeStorage.setItems).mock.calls.length;

  expect(wallet.getWalletSetupStatus()).toBe('recovery-required');
  await expect(wallet.getSeed('public password')).rejects.toThrow(
    'Wallet setup'
  );
  await expect(
    wallet.getPrivateKeyByAccountId(0, 'HDAccount', 'public password')
  ).rejects.toThrow('Wallet setup');
  expect(() => wallet.ethereumTransaction.signPersonalMessage({})).toThrow(
    'Wallet setup'
  );
  expect(manager.getSeed).not.toHaveBeenCalled();
  expect(manager.getPrivateKeyByAccountId).not.toHaveBeenCalled();
  expect(
    manager.ethereumTransaction.signPersonalMessage
  ).not.toHaveBeenCalled();
  expect(chromeStorage.setItems).toHaveBeenCalledTimes(writes);
  expect(disk).toEqual(retained);
});

it.each(['getSeed', 'getPrivateKeyByAccountId'])(
  'discards an in-flight %s result when an actual import repair becomes uncertain',
  async (method) => {
    const started = deferred<void>();
    const result = deferred<string>();
    manager[method] = jest.fn(() => {
      started.resolve();
      return result.promise;
    });
    const pending =
      method === 'getSeed'
        ? wallet.getSeed('public password')
        : wallet.getPrivateKeyByAccountId(0, 'HDAccount', 'public password');
    const rejected = expect(pending).rejects.toThrow('Wallet session changed');
    await started.promise;
    const retained = await failImportRepair();
    const writes = jest.mocked(chromeStorage.setItems).mock.calls.length;
    result.resolve('synthetic secret must not escape');
    await rejected;
    expect(wallet.resetRateLimit).not.toHaveBeenCalled();
    expect(chromeStorage.setItems).toHaveBeenCalledTimes(writes);
    expect(disk).toEqual(retained);
  }
);

it('rejects a previously admitted export queued behind authentication after uncertain repair', async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const held = wallet.authenticationMutex.runExclusive(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  manager.getSeed = jest.fn().mockResolvedValue('synthetic seed');
  const pending = wallet.getSeed('public password');
  const rejected = expect(pending).rejects.toThrow('Wallet session changed');
  const retained = await failImportRepair();
  release.resolve();
  await held;
  await rejected;
  expect(manager.getSeed).not.toHaveBeenCalled();
  expect(disk).toEqual(retained);
});

const invokeSdk = (method: string, sendResponse: (value: unknown) => void) => {
  Object.assign(chrome.runtime, {
    getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
    id: 'pali-extension',
  });
  handleMasterControllerResponses({ wallet } as any);
  const calls = jest.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  const listener = calls[calls.length - 1][0];
  const documentId = 'test-personal-sign-approval';
  // This fixture exercises the wallet setup gate after an admitted signature.
  // The actual dapp/popup enrollment is covered in the connection suite.
  const unbind =
    method === 'signPersonalMessage'
      ? bindPersonalSignApproval(
          documentId,
          {
            signal: new AbortController().signal,
            isCurrent: () => true,
            assertCurrent: () => undefined,
            checkDocument: async () => undefined,
            matches: () => true,
            bindSmartAccountSigner: () => undefined,
            retire: () => undefined,
            dispose: () => undefined,
          },
          async () => true
        )
      : undefined;
  expect(
    listener(
      {
        type: 'CONTROLLER_ACTION',
        data: {
          methods: ['wallet', 'ethereumTransaction', method],
          params: [],
        },
      },
      {
        documentId,
        id: 'pali-extension',
        url: 'chrome-extension://pali-extension/app.html',
      },
      (value) => {
        unbind?.();
        sendResponse(value);
      }
    )
  ).toBe(true);
};

it.each(['ethSign', 'signPersonalMessage', 'signTypedData'])(
  'does not send an in-flight %s signature to the popup after an actual uncertain import repair',
  async (method) => {
    const started = deferred<void>();
    const result = deferred<string>();
    const completed = deferred<void>();
    Object.assign(manager.ethereumTransaction, {
      [method]: jest.fn(() => {
        started.resolve();
        return result.promise;
      }),
    });
    const sendResponse = jest.fn(() => completed.resolve());
    jest.spyOn(console, 'error').mockImplementation();
    invokeSdk(method, sendResponse);
    await started.promise;
    const retained = await failImportRepair();
    result.resolve('synthetic signature must not escape');
    await completed.promise;
    expect(sendResponse).toHaveBeenCalledWith({
      error: 'Wallet setup is in progress. Signing is unavailable.',
      success: false,
    });
    expect(disk).toEqual(retained);
  }
);

it('keeps healthy message signing and an already acknowledged transaction result intact', async () => {
  const result = deferred<{ hash: string }>();
  const started = deferred<void>();
  const completed = deferred<void>();
  Object.assign(manager.ethereumTransaction, {
    signPersonalMessage: jest.fn().mockResolvedValue('synthetic signature'),
    sendFormattedTransaction: jest.fn(() => {
      started.resolve();
      return result.promise;
    }),
  });
  const healthy = deferred<void>();
  const healthyResponse = jest.fn(() => healthy.resolve());
  invokeSdk('signPersonalMessage', healthyResponse);
  await healthy.promise;
  expect(healthyResponse).toHaveBeenCalledWith('synthetic signature');

  const sendResponse = jest.fn(() => completed.resolve());
  invokeSdk('sendFormattedTransaction', sendResponse);
  await started.promise;
  const retained = await failImportRepair();
  const acknowledged = { hash: `0x${'a'.repeat(64)}` };
  result.resolve(acknowledged);
  await completed.promise;
  expect(sendResponse).toHaveBeenCalledWith(acknowledged);
  expect(disk).toEqual(retained);
});

it('discards an in-flight internal smart-account message signature after uncertain repair', async () => {
  const started = deferred<void>();
  const result = deferred<string>();
  Object.assign(manager.ethereumTransaction, {
    ethSign: jest.fn(() => {
      started.resolve();
      return result.promise;
    }),
  });
  jest.mocked(getController).mockReturnValue({ wallet } as any);
  const pending = wallet.signSmartAccountActionDigestInternal(
    [
      store.getState().vault.accounts.HDAccount[0].address,
      `0x${'b'.repeat(64)}`,
    ],
    { id: 0, type: KeyringAccountType.HDAccount }
  );
  const rejected = expect(pending).rejects.toThrow('Wallet setup');
  await started.promise;
  const retained = await failImportRepair();
  result.resolve('synthetic signature must not escape');
  await rejected;
  expect(disk).toEqual(retained);
});

it.each([false, true])(
  'removes an actual rolling-address import coherently (lost acknowledgement: %s)',
  async (loseAcknowledgement) => {
    const { BIP32Factory } = jest.requireActual('bip32');
    const secp = jest.requireActual('@bitcoinerlab/secp256k1');
    const { getNetworkConfig } = jest.requireActual(
      '@sidhujag/sysweb3-network'
    );
    const { convertExtendedKeyVersion } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'
    );
    const bitcoin = jest.requireActual('syscoinjs-lib').utils.bitcoinjs;
    const config = getNetworkConfig(0, 'Bitcoin');
    const node = BIP32Factory(secp)
      .fromSeed(Buffer.alloc(32, 9), config.networks.mainnet)
      .derivePath("m/84'/0'/0'");
    const secret = convertExtendedKeyVersion(
      node.toBase58(),
      config.types.zPubType.mainnet.zprv
    );
    const initial = store.getState().vault;
    store.dispatch(
      restoreVaultSnapshot({
        ...initial,
        isBitcoinBased: true,
        activeNetwork: {
          ...initial.activeNetwork,
          kind: INetworkType.Syscoin,
          slip44: 0,
          currency: 'Bitcoin',
        },
      } as any)
    );
    store.dispatch(setActiveSlip44(0));
    const imported = await wallet.importAccountFromPrivateKey(
      secret,
      'Rolling import'
    );
    const copyKey = Object.keys(disk).find((key) =>
      key.startsWith('state-imported-account-recovery-v1:')
    )!;
    const copy = structuredClone(disk[copyKey]);
    const advancedAddress = bitcoin.payments.p2wpkh({
      pubkey: node.derive(0).derive(7).publicKey,
      network: config.networks.mainnet,
    }).address;
    expect(advancedAddress).not.toBe(imported.address);
    store.dispatch(
      setAccountPropertyByIdAndType({
        id: imported.id,
        type: KeyringAccountType.Imported,
        property: 'address',
        value: advancedAddress,
      } as any)
    );
    store.dispatch(
      setActiveAccount({ id: 0, type: KeyringAccountType.HDAccount })
    );
    await persistCommittedWalletState(true);
    expect(disk[copyKey]).toEqual(copy);
    const retire = jest.fn();
    jest.mocked(getController).mockReturnValue({
      dapp: {
        captureAccountSessionRetirement: () => ({ grants: [], retire }),
      },
    } as any);
    if (loseAcknowledgement) {
      jest
        .mocked(chromeStorage.setItems)
        .mockImplementationOnce(async (items) => {
          Object.assign(disk, structuredClone(items));
          throw Error('Lost rolling-account removal acknowledgement');
        });
      await expect(
        wallet.removeAccount(imported.id, KeyringAccountType.Imported)
      ).rejects.toThrow('Lost rolling-account removal acknowledgement');
      expect(disk['state-vault-0'].accounts.Imported[imported.id].address).toBe(
        advancedAddress
      );
      expect(disk[copyKey]).toEqual(copy);
      expect(retire).not.toHaveBeenCalled();
      return;
    }
    await wallet.removeAccount(imported.id, KeyringAccountType.Imported);
    expect(
      disk['state-vault-0'].accounts.Imported[imported.id]
    ).toBeUndefined();
    expect(disk[copyKey]).toBeNull();
    expect(store.getState().vault.accounts.HDAccount[0]).toBeDefined();
    expect(retire).toHaveBeenCalledTimes(1);
  }
);
