jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {
    cleanup: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);

import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import http from 'http';
import https from 'https';
import { utils as sys } from 'syscoinjs-lib';

import { getController, notificationManager } from 'scripts/Background';
import SysAccountController from 'scripts/Background/controllers/account/syscoin';
import DAppController from 'scripts/Background/controllers/DAppController';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import TransactionsManager from 'scripts/Background/controllers/transactions';
import { clearFetchBackendAccountCache } from 'scripts/Background/controllers/utils/fetchBackendAccountWrapper';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountPropertyByIdAndType,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { chromeStorage } from 'utils/storageAPI';

// Public, disposable test fixtures. No seed/key is taken from a user or exported.
const PHRASE = 'test test test test test test test test test test test junk';
const TYPE = KeyringAccountType.Imported;
const network = {
  kind: INetworkType.Syscoin,
  slip44: 1,
  chainId: 5700,
  url: 'https://utxo-incarnation.synthetic.invalid',
  currency: 'tsys',
  label: 'Synthetic UTXO history',
};
const row = (digit: string) => ({
  txid: digit.repeat(64),
  confirmations: 1,
  blockHeight: 100,
  blockTime: 1700000000,
  fees: '1000',
  value: '100000',
  vin: [{ value: '101000', isOwn: true }],
  vout: [{ value: '100000', isOwn: false }],
});
const oldRow = row('a');
const currentRow = row('c');
const body = (transactions: any[]) => ({
  balance: '0',
  unconfirmedBalance: '0',
  txs: transactions.length,
  unconfirmedTxs: 0,
  transactions,
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let wallet: any;
let manager: any;
let wifs: string[];
let disk: Record<string, any>;
let transport: jest.SpyInstance;
let oldRead: ReturnType<typeof deferred>;
let original: any;
let policy: 'initial' | 'pending-old' | 'fail-new' | 'healthy-new';
const rows = () =>
  store.getState().vault.accountTransactions[TYPE]?.[0]?.syscoin?.[5700] || [];
const refresh = () =>
  wallet.updateUserTransactionsState({
    activeNetwork: network,
    isBitcoinBased: true,
    isPolling: true,
    forceRefresh: true,
  });
const advanceImportRefresh = async () => {
  await jest.advanceTimersByTimeAsync(10);
  // Let real getLatestUpdateForCurrentAccount and its fire-and-forget history settle.
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  const deny = () => {
    throw new Error(
      'External I/O is forbidden in this synthetic read-ownership probe'
    );
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(http, 'get').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(https, 'get').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  clearFetchBackendAccountCache();
  const hd = new sys.HDSigner(PHRASE, '', true);
  wifs = [1, 2, 3].map((index) =>
    hd.deriveKeypair(`m/84'/1'/7'/0/${index}`).toWIF()
  );
  const anchor = sys.bitcoinjs.payments.p2wpkh({
    pubkey: hd.deriveKeypair("m/84'/1'/0'/0/0").publicKey,
    network: sys.syscoinNetworks.testnet,
  }).address;
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts: any = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: anchor,
    xpub: 'synthetic-public-anchor',
    label: 'Anchor',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: network,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: true,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(1));
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
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault);
  manager.isUnlocked = () => true;
  manager.withSecureData = (operation: (password: string) => unknown) =>
    operation('public disposable fixture password');
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    networkRequestGeneration: 0,
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    getActiveKeyring: () => manager,
    resetAutoLockTimer: jest.fn(),
    cancellablePromises: new CancellablePromises(),
    transactionsManager: TransactionsManager(),
    updateAssetsFromCurrentAccount: jest.fn().mockResolvedValue(undefined),
    updateUserNativeBalance: jest.fn().mockResolvedValue(undefined),
  });
  wallet.transactionsManager.utils.clearCache();
  const dapp = DAppController(
    () => true,
    () => wallet.walletStateGeneration
  );
  jest.mocked(getController).mockReturnValue({ wallet, dapp } as any);
  oldRead = deferred();
  policy = 'initial';
  transport = jest
    .spyOn(sys, 'fetchBackendAccount')
    .mockImplementation(async (_url, account) => {
      if (policy === 'initial') return body([]);
      if (account === original.address) return oldRead.promise;
      if (policy === 'healthy-new') return body([currentRow]);
      throw new Error('Synthetic newer-account history failure');
    });
});

afterEach(() => {
  wallet.transactionsManager.utils.clearCache();
  clearFetchBackendAccountCache();
  vaultCache.clearCache();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const importOriginalAndStartRead = async () => {
  original = await wallet.importAccountFromPrivateKey(wifs[0], 'Original A');
  expect(original.id).toBe(0);
  expect(original.xpub).toBe(original.address);
  await advanceImportRefresh();
  expect(wallet.transactionUpdateCommitId).toBeGreaterThan(0);
  // The real transport retains completed requests for 100ms; let that expire
  // before admitting the intentionally delayed fresh A read.
  await jest.advanceTimersByTimeAsync(110);
  policy = 'pending-old';
  const pending = refresh();
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  expect(transport).toHaveBeenLastCalledWith(
    network.url,
    original.address,
    expect.stringContaining('details=txsummary'),
    false
  );
  expect(transport).toHaveBeenCalledTimes(2);
  return { pending };
};

const replaceThroughNormalImports = async (newerSucceeds = false) => {
  policy = 'fail-new';
  const bridge = await wallet.importAccountFromPrivateKey(wifs[1], 'Bridge B');
  expect(bridge.id).toBe(1);
  await advanceImportRefresh();
  expect(store.getState().vault.activeAccount).toEqual({ id: 1, type: TYPE });
  await wallet.removeAccount(0, TYPE, {
    activeAccount: { id: bridge.id, type: TYPE, address: bridge.address },
    address: original.address,
    network: { kind: network.kind, chainId: network.chainId, url: network.url },
    slip44: network.slip44,
  });
  expect((await loadSlip44State(1)).accounts[TYPE]?.[0]).toBeUndefined();
  const replacement = await wallet.importAccountFromPrivateKey(
    wifs[2],
    'Replacement C'
  );
  expect(replacement.id).toBe(original.id);
  expect(replacement.address).not.toBe(original.address);
  expect(replacement.xpub).toBe(replacement.address);
  expect(store.getState().vault.activeAccount).toEqual({ id: 0, type: TYPE });
  expect((await loadSlip44State(1)).accounts[TYPE][0].address).toBe(
    replacement.address
  );
  if (newerSucceeds) policy = 'healthy-new';
  await advanceImportRefresh();
  expect(wallet.walletSessionGeneration).toBe(0);
  return replacement;
};

it('healthy unchanged WIF account accepts its completed UTXO history', async () => {
  const { pending } = await importOriginalAndStartRead();
  oldRead.resolve(body([oldRow]));
  await pending;
  expect(rows().map((tx: any) => tx.txid)).toEqual([oldRow.txid]);
});

it('healthy auto-selection to a different imported ID rejects the old UTXO completion', async () => {
  const { pending } = await importOriginalAndStartRead();
  policy = 'fail-new';
  await wallet.importAccountFromPrivateKey(wifs[1], 'Bridge B');
  await advanceImportRefresh();
  oldRead.resolve(body([oldRow]));
  await pending;
  expect(store.getState().vault.activeAccount).toEqual({ id: 1, type: TYPE });
  expect(rows()).toEqual([]);
});

it('a successful newer incarnation read retains C history against the older A completion', async () => {
  const { pending } = await importOriginalAndStartRead();
  await replaceThroughNormalImports(true);
  expect(rows().map((tx: any) => tx.txid)).toEqual([currentRow.txid]);
  oldRead.resolve(body([oldRow]));
  await pending;
  expect(rows().map((tx: any) => tx.txid)).toEqual([currentRow.txid]);
});

it('must not attach old A history to durably imported C at the reused ID after newer read failures', async () => {
  const { pending } = await importOriginalAndStartRead();
  const replacement = await replaceThroughNormalImports();
  expect(rows()).toEqual([]);
  oldRead.resolve(body([oldRow]));
  await pending;
  expect(store.getState().vault.accounts[TYPE][0].address).toBe(
    replacement.address
  );
  expect(rows().map((tx: any) => tx.txid)).toEqual([]);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).not.toHaveBeenLastCalledWith([oldRow]);
});

it('accepts an older successful read after a newer read fails in the same account', async () => {
  const { pending } = await importOriginalAndStartRead();
  // Expire the real transport deduplication window, without changing ownership.
  await jest.advanceTimersByTimeAsync(5100);
  transport.mockRejectedValueOnce(new Error('Newer summary unavailable'));
  transport.mockRejectedValueOnce(new Error('Newer fallback unavailable'));
  await expect(refresh()).rejects.toThrow('Newer fallback unavailable');
  oldRead.resolve(body([oldRow]));
  await pending;
  expect(rows().map((tx: any) => tx.txid)).toEqual([oldRow.txid]);
});

it('retains a current HD history read when receiving address rotates under the same xpub', async () => {
  manager.getDecryptedMnemonic = () => PHRASE;
  const account = await wallet.createAccount('Rotating HD account');
  await advanceImportRefresh();
  await jest.advanceTimersByTimeAsync(110);
  transport.mockImplementation(async () => oldRead.promise);
  const pending = refresh();
  const nextAddress = sys.bitcoinjs.payments.p2wpkh({
    pubkey: new sys.HDSigner(PHRASE, '', true).deriveKeypair("m/84'/1'/1'/0/1")
      .publicKey,
    network: sys.syscoinNetworks.testnet,
  }).address;
  jest.spyOn(manager, 'updateReceivingAddress').mockResolvedValue(nextAddress);
  await SysAccountController(() => manager).setAddress();
  const latest = store.getState().vault.accounts.HDAccount[account.id];
  expect(latest.address).not.toBe(account.address);
  expect(latest.xpub).toBe(account.xpub);
  oldRead.resolve(body([oldRow]));
  await pending;
  expect(
    store
      .getState()
      .vault.accountTransactions.HDAccount[account.id].syscoin[5700].map(
        (tx: any) => tx.txid
      )
  ).toEqual([oldRow.txid]);
});

it('normalizes EVM address casing without invalidating the same account read', async () => {
  const initial = store.getState().vault;
  const evmNetwork = {
    ...network,
    kind: INetworkType.Ethereum,
    slip44: 60,
    chainId: 1,
    currency: 'eth',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...initial,
      activeNetwork: evmNetwork,
      isBitcoinBased: false,
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  const account = await wallet.importAccountFromPrivateKey(
    `0x${'01'.padStart(64, '0')}`,
    'EVM case control'
  );
  expect(account.address).not.toBe(account.address.toLowerCase());
  const completed = deferred();
  wallet.transactionsManager.utils.updateTransactionsFromCurrentAccount =
    jest.fn(() => completed.promise);
  const pending = wallet.updateUserTransactionsState({
    activeNetwork: evmNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: account.id,
      type: TYPE,
      property: 'address',
      value: account.address.toLowerCase(),
    })
  );
  const tx = { hash: `0x${'d'.repeat(64)}`, blockNumber: 1, confirmations: 1 };
  wallet.reconcileLocalPendingEvmSmartAccountTransactions = jest
    .fn()
    .mockResolvedValue(undefined);
  completed.resolve([tx]);
  await pending;
  expect(
    store.getState().vault.accountTransactions[TYPE][account.id].ethereum[1]
  ).toEqual([tx]);
});
