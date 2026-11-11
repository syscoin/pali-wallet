jest.unmock('syscoinjs-lib');
import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { SyscoinTransactionsCore } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js';
import { webcrypto } from 'crypto';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { getController } from '..';
import { UTXO_SIGNED_RECORD_PREFIX } from '../../../wallet/utxoSignedRecords';
import { submitReviewedUtxo } from '../../../wallet/utxoSubmission';
import { notificationManager } from 'scripts/Background/notification-manager';
import { addDApp, rehydrate as rehydrateDapps, removeDApp } from 'state/dapp';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountLabel,
  setAccountPropertyByIdAndType,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { utxoInputOutpoints } from 'utils/utxoAcknowledgedInputs';

import DAppController from './DAppController';
import MainController, { AccountRemovalContext } from './MainController';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
import type {
  UtxoDurableSubmission,
  UtxoRecordSession,
} from '../../../wallet/utxoSignedRecords';

jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const ANCHOR = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const HOST = 'https://account-removal.synthetic.invalid';
const network = {
  kind: INetworkType.Ethereum,
  chainId: 1,
  slip44: 60,
  url: 'https://account-removal-rpc.synthetic.invalid',
  label: 'Synthetic EVM',
  currency: 'eth',
};
const originalChrome = global.chrome;
let records: Record<string, any>;
let refuseNextVaultWrite: boolean;
let wallet: any;
let dapp: ReturnType<typeof DAppController>;
let targetType: KeyringAccountType;
let expected: AccountRemovalContext;

const targetSnapshot = (vault: any) => ({
  account: vault.accounts[targetType]?.[1] || null,
  assets: vault.accountAssets[targetType]?.[1] || null,
  transactions: vault.accountTransactions[targetType]?.[1] || null,
});

const holdNextVaultWrite = () => {
  const entered = deferred();
  const release = deferred();
  const set = chrome.storage.local.set as any;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback: any) => {
      if (items['state-vault-60'] && !held) {
        held = true;
        entered.resolve();
        void release.promise.then(() => set(items, callback));
      } else set(items, callback);
    });
  return { entered: entered.promise, release: release.resolve };
};

const grantAnchor = () =>
  dapp.requestPermissions(HOST, 0, KeyringAccountType.HDAccount, {
    address: ANCHOR,
    xpub: 'public-anchor',
    network,
  });

const configureTarget = async (
  kind: 'private import' | 'watch import' | 'HD',
  connected = false,
  liveSession = true
) => {
  targetType =
    kind === 'HD' ? KeyringAccountType.HDAccount : KeyringAccountType.Imported;
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: ANCHOR,
    xpub: 'public-anchor',
    label: 'Anchor',
    balances: { ethereum: '1', syscoin: '0' },
  };
  accounts[targetType][1] = {
    id: 1,
    address: TARGET,
    xpub: kind === 'HD' ? 'public-hd-one' : TARGET,
    xprv: kind === 'private import' ? 'synthetic-encrypted-record' : '',
    isImported: kind !== 'HD',
    label: `Saved ${kind}`,
    balances: { ethereum: '2', syscoin: '0' },
  };
  const accountAssets = groups();
  accountAssets[targetType][1] = {
    ethereum: [
      {
        id: 'synthetic-token',
        contractAddress: '0x3333333333333333333333333333333333333333',
        chainId: 1,
        tokenSymbol: 'SAVED',
        decimals: 18,
        balance: 3,
      },
    ],
    syscoin: [],
  };
  const accountTransactions = groups();
  accountTransactions[targetType][1] = {
    ethereum: { 1: [{ hash: `0x${'44'.repeat(32)}`, from: TARGET }] },
    syscoin: {},
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      accounts,
      accountAssets,
      accountTransactions,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: network,
      isBitcoinBased: false,
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(
    rehydrateDapps({
      dapps: connected
        ? {
            [HOST]: {
              host: HOST,
              accountId: 1,
              accountType: targetType,
              chain: INetworkType.Ethereum,
              chainId: 1,
              date: 1,
            },
          }
        : {},
    })
  );
  expected = {
    activeAccount: {
      id: 0,
      type: KeyringAccountType.HDAccount,
      address: ANCHOR,
    },
    address: TARGET,
    network,
    slip44: 60,
  };
  await persistCommittedWalletState(true);
  if (connected && liveSession)
    dapp.setup({ url: HOST, origin: HOST } as chrome.runtime.MessageSender);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  refuseNextVaultWrite = false;
  global.chrome = {
    runtime: { id: 'synthetic-removal' },
    tabs: { query: jest.fn((_query, callback) => callback([])) },
    scripting: { executeScript: jest.fn(async () => []) },
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
          if (items['state-vault-60'] && refuseNextVaultWrite) {
            refuseNextVaultWrite = false;
            (chrome.runtime as any).lastError = {
              message: 'Account storage unavailable',
            };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  wallet = Object.create(MainController.prototype);
  wallet.getActiveKeyring = () => ({
    getPrivateRecordProfileId: async () => `0x${'a'.repeat(64)}`,
  });
  Object.assign(wallet, {
    resetAutoLockTimer: jest.fn(),
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    isResettingWallet: false,
  });
  dapp = DAppController(
    () => true,
    () => wallet.walletStateGeneration
  );
  jest.mocked(getController).mockReturnValue({ wallet, dapp } as any);
});

afterEach(() => {
  if (wallet.saveTimeout) clearTimeout(wallet.saveTimeout);
  vaultCache.clearCache();
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

const prepareUtxoRemoval = async () => {
  await configureTarget('HD');
  const syscoin = {
    kind: INetworkType.Syscoin,
    chainId: 57,
    slip44: 57,
    url: 'https://first-blockbook.synthetic.invalid',
    currency: 'sys',
    label: 'First UTXO network',
  };
  const owner = {
    chainId: syscoin.chainId,
    slip44: syscoin.slip44,
    genesisHash: 'a'.repeat(64),
    account: {
      id: 1,
      type: KeyringAccountType.HDAccount,
      xpub: store.getState().vault.accounts.HDAccount[1].xpub,
    },
  };
  store.dispatch(setActiveSlip44(syscoin.slip44));
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeAccount: { id: 1, type: owner.account.type },
      activeNetwork: syscoin,
      isBitcoinBased: true,
    })
  );
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const restoreCrypto = () => {
    if (previousCrypto)
      Object.defineProperty(globalThis, 'crypto', previousCrypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
  };
  const secret = new Uint8Array(32).fill(42);
  const currentGeneration = wallet.walletSessionGeneration;
  const assertCurrent = () => {
    if (wallet.walletSessionGeneration !== currentGeneration)
      throw new Error('Signing session changed');
  };
  const guard = () => undefined;
  const keyring: UtxoRecordSession['keyring'] = {
    getPrivateRecordProfileId: () => privateRecordProfileId(secret, guard),
    encryptPrivateRecord: (args) =>
      encryptPrivateRecordBytes(secret, args, guard),
    decryptPrivateRecord: (args) =>
      decryptPrivateRecordBytes(secret, args, guard),
  };
  wallet.getActiveKeyring = () => keyring;
  const { bitcoinjs: bitcoin } = syscoinUtils;
  const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 3));
  const script = bitcoin.payments.p2wpkh({ pubkey: key.publicKey }).output!;
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 4), 0);
  previous.addOutput(script, BigInt(10_000));
  const signed = new bitcoin.Psbt()
    .addInput({
      hash: previous.getHash(),
      index: 0,
      witnessUtxo: { value: BigInt(10_000), script },
    })
    .addOutput({ script, value: BigInt(9_000) })
    .signInput(0, key)
    .finalizeAllInputs()
    .extractTransaction();
  const transaction: UtxoDurableSubmission = {
    owner,
    operation: 'wallet',
    url: `${syscoin.url}/api/v2/sendtx/`,
    rawTransaction: signed.toHex(),
    txid: signed.getId(),
    virtualSize: signed.virtualSize(),
    feeSatoshis: '1000',
    outpoints: utxoInputOutpoints(signed.ins),
  };
  const unavailable = () => {
    throw new Error('Already signed');
  };
  const sender = new SyscoinTransactionsCore(
    unavailable,
    unavailable,
    () =>
      ({
        activeAccountId: 1,
        activeAccountType: owner.account.type,
        accounts: { HDAccount: { 1: { ...owner.account, address: TARGET } } },
        activeNetwork: syscoin,
      } as never),
    {},
    () => assertCurrent,
    'session',
    assertCurrent
  );
  const fetch = jest.fn(async () => {
    const response = Response.json({ result: transaction.txid });
    Object.defineProperty(response, 'url', { value: transaction.url });
    return response;
  });
  const send = () =>
    submitReviewedUtxo({
      fetch,
      record: transaction,
      records: wallet.getRetainedUtxoRecords(),
      sender,
      session: { keyring, assertCurrent },
    });
  const switchToAnchor = () => {
    const anotherNetwork = {
      ...syscoin,
      chainId: 5700,
      url: 'https://another-blockbook.synthetic.invalid',
    };
    wallet.advanceWalletSession();
    store.dispatch(
      restoreVaultSnapshot({
        ...store.getState().vault,
        activeAccount: { id: 0, type: owner.account.type },
        activeNetwork: anotherNetwork,
      })
    );
    expected = { ...expected, network: anotherNetwork, slip44: syscoin.slip44 };
  };
  const remove = () => wallet.removeAccount(1, owner.account.type, expected);
  return {
    fetch,
    owner,
    remove,
    restoreCrypto,
    send,
    session: { keyring, assertCurrent: guard },
    switchToAnchor,
    transaction,
  };
};

it('keeps an inactive UTXO sender while another network in its group has an unresolved exact send', async () => {
  const c = await prepareUtxoRemoval();
  try {
    await expect(c.send()).resolves.toEqual({ txid: c.transaction.txid });
    expect(c.fetch).toHaveBeenCalledTimes(1);
    c.switchToAnchor();
    await expect(c.remove()).rejects.toMatchObject({
      code: 'PENDING_TRANSFER',
    });
    expect(targetSnapshot(store.getState().vault).account).toBeDefined();

    const journal = wallet.getRetainedUtxoRecords();
    await journal.persist(c.session, {
      ...c.transaction,
      owner: { ...c.owner, slip44: 0 },
    });
    await journal.persist(c.session, {
      ...c.transaction,
      owner: {
        ...c.owner,
        chainId: 5700,
        account: { ...c.owner.account, xpub: 'other-account-identity' },
      },
    });
    await expect(
      journal.observeRetained(
        c.session,
        c.owner,
        c.transaction.txid,
        async () => ({
          txid: c.transaction.txid,
          hex: c.transaction.rawTransaction,
          confirmations: 1,
          blockHash: 'b'.repeat(64),
        })
      )
    ).resolves.toBe('confirmed');
    await expect(c.remove()).resolves.toBeUndefined();
    expect(targetSnapshot(await loadSlip44State(57)).account).toBeNull();
  } finally {
    c.restoreCrypto();
  }
});

it('waits for the prior account session’s held signed-record write before removal', async () => {
  const c = await prepareUtxoRemoval();
  const entered = deferred();
  const release = deferred();
  const set = chrome.storage.local.set;
  let held = false;
  jest.spyOn(chrome.storage.local, 'set').mockImplementation((items, done) => {
    if (
      !held &&
      Object.keys(items).some((key) =>
        key.startsWith(UTXO_SIGNED_RECORD_PREFIX)
      )
    ) {
      held = true;
      entered.resolve();
      void release.promise.then(() => set(items, done));
    } else set(items, done);
  });
  try {
    const sending = expect(c.send()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    await entered.promise;
    c.switchToAnchor();
    const profileRead = jest.spyOn(
      c.session.keyring,
      'getPrivateRecordProfileId'
    );
    const removing = c.remove().then(
      () => undefined,
      (error: unknown) => error
    );
    await Promise.resolve();
    const readsBeforeRelease = profileRead.mock.calls.length;
    release.resolve();
    const [, removalError] = await Promise.all([sending, removing]);
    expect(readsBeforeRelease).toBe(0);
    expect(removalError).toMatchObject({ code: 'PENDING_TRANSFER' });
    expect(c.fetch).not.toHaveBeenCalled();
    expect(targetSnapshot(store.getState().vault).account).toBeDefined();
  } finally {
    release.resolve();
    c.restoreCrypto();
  }
});

it.each(['private import', 'watch import', 'HD'] as const)(
  'removes an inactive %s and its history/assets durably while retaining the anchor',
  async (kind) => {
    await configureTarget(kind);
    await wallet.removeAccount(1, targetType, expected);
    const empty = { account: null, assets: null, transactions: null };
    expect(targetSnapshot(store.getState().vault)).toEqual(empty);
    expect(targetSnapshot(await vaultCache.getSlip44Vault(60))).toEqual(empty);
    expect(targetSnapshot(await loadSlip44State(60))).toEqual(empty);
    expect(store.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
    expect(store.getState().vault.accounts.HDAccount[0].address).toBe(ANCHOR);
  }
);

it.each(['private import', 'watch import', 'HD'] as const)(
  'retains an inactive %s after storage refuses removal, including the live cache',
  async (kind) => {
    await configureTarget(kind);
    const before = clone(targetSnapshot(store.getState().vault));
    refuseNextVaultWrite = true;
    await expect(
      wallet.removeAccount(1, targetType, expected)
    ).rejects.toMatchObject({
      message: 'Account storage unavailable',
    });
    const live = targetSnapshot(store.getState().vault);
    const cached = targetSnapshot(await vaultCache.getSlip44Vault(60));
    const cold = await loadSlip44State(60);
    store.dispatch(restoreVaultSnapshot(cold));
    expect({
      live,
      cached,
      restored: targetSnapshot(store.getState().vault),
    }).toEqual({
      live: before,
      cached: before,
      restored: before,
    });
    expect(store.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
  }
);

it('keeps the failed target available for the same explicit removal to be retried', async () => {
  await configureTarget('watch import');
  refuseNextVaultWrite = true;
  await expect(
    wallet.removeAccount(1, targetType, expected)
  ).rejects.toMatchObject({
    message: 'Account storage unavailable',
  });
  await expect(
    wallet.removeAccount(1, targetType, expected)
  ).resolves.toBeUndefined();
  expect(targetSnapshot(await loadSlip44State(60))).toEqual({
    account: null,
    assets: null,
    transactions: null,
  });
});

it('removes the connected target and its saved grant on a healthy durable removal', async () => {
  await configureTarget('watch import', true);
  expect(dapp.isConnected(HOST)).toBe(true);
  await wallet.removeAccount(1, targetType, expected);
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
    HOST,
    false
  );
  expect(targetSnapshot(await loadSlip44State(60))).toEqual({
    account: null,
    assets: null,
    transactions: null,
  });
});

it('does not retire an attached permission or session before account removal is durable', async () => {
  await configureTarget('watch import', true);
  const grant = clone(dapp.get(HOST));
  refuseNextVaultWrite = true;
  await expect(
    wallet.removeAccount(1, targetType, expected)
  ).rejects.toMatchObject({
    message: 'Account storage unavailable',
  });
  expect({
    liveGrant: dapp.get(HOST) || null,
    diskGrant: records.state.dapp.dapps[HOST] || null,
    connectedAddress: dapp.getAccount(HOST)?.address || null,
    disconnected: jest.mocked(notificationManager.notifyDappConnection).mock
      .calls,
  }).toEqual({
    liveGrant: grant,
    diskGrant: grant,
    connectedAddress: TARGET,
    disconnected: [],
  });
});

it.each([false, true])(
  'retires a reloaded session for the removed grant (initial session=%s)',
  async (liveSession) => {
    await configureTarget('watch import', true, liveSession);
    jest
      .mocked(chrome.tabs.query)
      .mockImplementation(
        (_query: any, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
          const tabs = [
            { id: 17, url: `${HOST}/reloaded` },
          ] as chrome.tabs.Tab[];
          callback?.(tabs);
          return Promise.resolve(tabs);
        }
      );
    const write = holdNextVaultWrite();
    const removing = wallet.removeAccount(1, targetType, expected);
    await write.entered;
    // A content-script setup on a reload recreates the runtime session while
    // the same persisted permission remains admitted by the pending write.
    dapp.setup({
      url: `${HOST}/reloaded`,
      origin: HOST,
    } as chrome.runtime.MessageSender);
    dapp.setHasWindow(HOST, true);
    expect(dapp.hasWindow(HOST)).toBe(true);
    expect(dapp.getAccount(HOST)?.address).toBe(TARGET);
    write.release();
    await removing;
    await new Promise(setImmediate);
    expect(dapp.get(HOST)).toBeUndefined();
    expect(records.state.dapp.dapps[HOST]).toBeUndefined();
    expect(dapp.hasWindow(HOST)).toBe(false);
    expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
      HOST,
      false
    );
    const events = jest
      .mocked(chrome.scripting.executeScript)
      .mock.calls.map(([options]: any) => JSON.parse(options.args[0]));
    expect(events).toEqual(
      expect.arrayContaining([
        {
          id: PaliEvents.accountsChanged,
          data: { method: PaliEvents.accountsChanged, params: [] },
        },
        {
          id: PaliSyscoinEvents.xpubChanged,
          data: { method: PaliSyscoinEvents.xpubChanged, params: null },
        },
      ])
    );
  }
);

it('never retires a genuinely newly approved grant or its refreshed session', async () => {
  await configureTarget('watch import', true);
  const earlier = dapp.captureAccountSessionRetirement(1, targetType);
  await wallet.removeAccount(1, targetType, expected);
  await grantAnchor();
  dapp.setup({
    url: `${HOST}/new-approval`,
    origin: HOST,
  } as chrome.runtime.MessageSender);
  dapp.setHasWindow(HOST, true);
  jest.mocked(notificationManager.notifyDappConnection).mockClear();
  earlier.retire();
  expect(dapp.getAccount(HOST)?.address).toBe(ANCHOR);
  expect(dapp.hasWindow(HOST)).toBe(true);
  expect(records.state.dapp.dapps[HOST]).toMatchObject({ accountId: 0 });
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
});

it('preserves a new permission grant for another account queued after removal started', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  const granting = grantAnchor().then(
    (result) => ({ result, error: null }),
    (error) => ({ result: null, error })
  );
  write.release();
  await removing;
  const outcome = await granting;
  expect(outcome.error).toBeNull();
  expect(outcome.result).toEqual(expect.any(Array));
  expect(dapp.getAccount(HOST)?.address).toBe(ANCHOR);
  expect(records.state.dapp.dapps[HOST]).toMatchObject({
    accountId: 0,
    accountType: KeyringAccountType.HDAccount,
  });
});

it('retires a grant restored after failed revoke without cancelling its queued replacement', async () => {
  await configureTarget('watch import', true);
  const previous = dapp.get(HOST);
  const set = chrome.storage.local.set as any;
  const refusedWrite = jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementationOnce((_items, callback: any) => {
      (chrome.runtime as any).lastError = {
        message: 'Permission storage unavailable',
      };
      callback();
      delete (chrome.runtime as any).lastError;
    })
    .mockImplementation(set);
  await expect(
    dapp.revoke(HOST, { allowAlreadyDisconnected: true })
  ).rejects.toMatchObject({ message: 'Permission storage unavailable' });
  expect(dapp.get(HOST)).toBe(previous);
  expect(dapp.getAccount(HOST)?.address).toBe(TARGET);
  refusedWrite.mockRestore();

  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  const granting = grantAnchor();
  write.release();
  await removing;
  await expect(granting).resolves.toEqual(expect.any(Array));
  expect(dapp.getAccount(HOST)?.address).toBe(ANCHOR);
  expect(records.state.dapp.dapps[HOST]).toMatchObject({
    accountId: 0,
    accountType: KeyringAccountType.HDAccount,
  });
  expect(targetSnapshot(await loadSlip44State(60))).toEqual({
    account: null,
    assets: null,
    transactions: null,
  });
});

it('preserves a newer unrelated label and its queued save while publishing only target removal', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  expect(targetSnapshot(store.getState().vault).account).not.toBeNull();
  store.dispatch(
    setAccountLabel({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      label: 'New anchor label',
    })
  );
  const saving = persistCommittedWalletState(true);
  write.release();
  await removing;
  await saving;
  expect(store.getState().vault.accounts.HDAccount[0].label).toBe(
    'New anchor label'
  );
  expect((await loadSlip44State(60)).accounts.HDAccount[0].label).toBe(
    'New anchor label'
  );
  expect(targetSnapshot(store.getState().vault).account).toBeNull();
});

it('repairs an accepted stale write without deleting a replacement target', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 1,
      type: targetType,
      property: 'xpub',
      value: 'replacement-public-identity',
    })
  );
  write.release();
  await rejected;
  expect(store.getState().vault.accounts[targetType][1].xpub).toBe(
    'replacement-public-identity'
  );
  expect((await loadSlip44State(60)).accounts[targetType][1].xpub).toBe(
    'replacement-public-identity'
  );
});

it('repairs the current source vault after a same-slot network change', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  const newerNetwork = {
    ...network,
    chainId: 5,
    url: 'https://new-source.synthetic.invalid',
  };
  store.dispatch(setNetworkChange({ activeNetwork: newerNetwork }));
  write.release();
  await rejected;
  expect(store.getState().vault.activeNetwork).toEqual(newerNetwork);
  const cold = await loadSlip44State(60);
  expect(cold.activeNetwork).toEqual(newerNetwork);
  expect(targetSnapshot(cold).account).not.toBeNull();
});

it('repairs the latest cached source slot without replacing the newly active vault', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  const newerSource = clone(store.getState().vault);
  newerSource.accounts.HDAccount[0].label = 'Latest cached source label';
  vaultCache.prepareSlip44Vault(60, newerSource);
  const otherVault = clone(newerSource);
  otherVault.activeNetwork = {
    ...network,
    kind: INetworkType.Syscoin,
    chainId: 57,
    slip44: 57,
  } as any;
  otherVault.accounts.HDAccount[0].label = 'Other active vault';
  store.dispatch(setActiveSlip44(57));
  store.dispatch(restoreVaultSnapshot(otherVault));
  write.release();
  await rejected;
  expect(store.getState().vault.accounts.HDAccount[0].label).toBe(
    'Other active vault'
  );
  expect(store.getState().vaultGlobal.activeSlip44).toBe(57);
  const cold = await loadSlip44State(60);
  expect(cold.accounts.HDAccount[0].label).toBe('Latest cached source label');
  expect(targetSnapshot(cold).account).not.toBeNull();
  expect(records.state.vaultGlobal.activeSlip44).toBe(57);
});

it('keeps a newer live grant and session after an in-flight grant-identity change', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow(
    'Account permissions changed'
  );
  await write.entered;
  store.dispatch(
    addDApp({
      ...dapp.get(HOST)!,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
    })
  );
  dapp.setup({ url: HOST, origin: HOST } as chrome.runtime.MessageSender);
  write.release();
  await rejected;
  expect(dapp.getAccount(HOST)?.address).toBe(ANCHOR);
  expect(records.state.dapp.dapps[HOST].accountId).toBe(0);
  expect(targetSnapshot(store.getState().vault).account).not.toBeNull();
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
});

it('does not carry a queued same-target grant across successful target removal', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  const granting = dapp.requestPermissions(HOST, 1, targetType, {
    address: TARGET,
    xpub: TARGET,
    network,
  });
  const rejected = expect(granting).rejects.toThrow(
    'Permission grant context changed'
  );
  write.release();
  await removing;
  await rejected;
  expect(dapp.isConnected(HOST)).toBe(false);
});

it.each(['replacement', 'equal-fields clone'])(
  'never lets a retired predecessor bypass a present %s grant',
  async (kind) => {
    await configureTarget('watch import', true);
    const previous = dapp.get(HOST)!;
    const write = holdNextVaultWrite();
    const removing = wallet.removeAccount(1, targetType, expected);
    await write.entered;
    const releaseGrant = deferred();
    const blockGrant = walletPersistenceMutex.runExclusive(
      () => releaseGrant.promise
    );
    const granting = grantAnchor();
    const rejected = expect(granting).rejects.toThrow(
      'Permission grant context changed'
    );
    write.release();
    await removing;
    const replacement =
      kind === 'equal-fields clone'
        ? { ...previous }
        : {
            ...previous,
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
            date: 2,
          };
    store.dispatch(addDApp(replacement));
    releaseGrant.resolve();
    await blockGrant;
    await rejected;
    expect(dapp.get(HOST)).toBe(replacement);
  }
);

it('does not reuse a captured retirement for a later pending grant', async () => {
  await configureTarget('watch import', true);
  const previous = dapp.get(HOST)!;
  const retirement = dapp.captureAccountSessionRetirement(1, targetType);
  await wallet.removeAccount(1, targetType, expected);
  retirement.retire();
  // Even reusing the identical old grant object must not revive a consumed
  // retirement for a later attempt. This is stronger than an equal-fields clone.
  store.dispatch(addDApp(previous));
  const release = deferred();
  const blocker = walletPersistenceMutex.runExclusive(() => release.promise);
  const later = grantAnchor();
  const rejected = expect(later).rejects.toThrow(
    'Permission grant context changed'
  );
  store.dispatch(removeDApp(HOST));
  retirement.retire();
  release.resolve();
  await blocker;
  await rejected;
  expect(dapp.isConnected(HOST)).toBe(false);
});

it('does not retire sessions or repair a source snapshot after wallet replacement', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  const granting = grantAnchor();
  const rejectedGrant = expect(granting).rejects.toThrow(
    'Permission grant context changed'
  );
  wallet.walletStateGeneration += 1;
  wallet.walletSessionGeneration += 1;
  const replacement = clone(store.getState().vault);
  replacement.accounts[targetType][1].xpub = 'new-wallet-public-identity';
  store.dispatch(restoreVaultSnapshot(replacement));
  vaultCache.clearCache();
  write.release();
  await rejected;
  await rejectedGrant;
  expect(store.getState().vault.accounts[targetType][1].xpub).toBe(
    'new-wallet-public-identity'
  );
  expect(vaultCache.isVaultCached(60)).toBe(false);
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
});

it('refuses a queued removal after its target was replaced before writer admission', async () => {
  await configureTarget('watch import');
  const release = deferred();
  const blocker = walletPersistenceMutex.runExclusive(() => release.promise);
  const writes = jest.spyOn(chrome.storage.local, 'set');
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 1,
      type: targetType,
      property: 'xpub',
      value: 'queued-replacement',
    })
  );
  release.resolve();
  await blocker;
  await rejected;
  expect(store.getState().vault.accounts[targetType][1].xpub).toBe(
    'queued-replacement'
  );
  expect(writes).not.toHaveBeenCalled();
});
