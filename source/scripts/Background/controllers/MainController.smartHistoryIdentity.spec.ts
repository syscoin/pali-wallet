jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: {
    cleanup: jest.fn(),
    notifyAccountChange: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));

import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import http from 'http';
import https from 'https';

import { getController } from '..';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import TransactionsManager from './transactions';

const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
const ANCHOR = `0x${'33'.repeat(20)}`;
// This supported network skips unrelated full-block scanning; smart-account
// EntryPoint history still uses the ordinary real controller path.
const CHAIN_ID = 10;
const SMART = KeyringAccountType.SmartAccount;
const originalChrome = global.chrome;
let wallet: any;
let manager: KeyringManager;
let records: Record<string, any>;
let provider: any;
const filters: any[] = [];
const record = () => store.getState().vault.accounts[SMART][0] as any;
const create = (address: string) =>
  wallet.createSmartAccount({
    address,
    label:
      address === A ? 'Old public smart account' : 'New public smart account',
    metadata: { address, chainId: CHAIN_ID, isDeployed: true },
  });
const refresh = () =>
  wallet.updateUserTransactionsState({
    isBitcoinBased: false,
    activeNetwork: store.getState().vault.activeNetwork,
    isPolling: true,
    isRapidPolling: true,
    forceRefresh: true,
  });
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const deny = () => {
    throw new Error('History identity probe must remain offline');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(http, 'get').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(https, 'get').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  filters.length = 0;
  records = {};
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  global.chrome = {
    runtime: { id: 'synthetic-history-identity' },
    tabs: { query: jest.fn((_query, callback) => callback([])) },
    scripting: { executeScript: jest.fn(async () => []) },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, structuredClone(records[key])])
            )
          ),
        set: (items: any, callback: () => void) => {
          Object.assign(records, structuredClone(items));
          callback();
        },
      },
    },
  } as any;
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
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: {
        kind: INetworkType.Ethereum,
        slip44: 60,
        chainId: CHAIN_ID,
        url: 'https://history.synthetic.invalid',
        currency: 'eth',
        label: 'Synthetic',
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault as any);
  provider = {
    getBlockNumber: jest.fn(async () => 100),
    getLogs: jest.fn(async (filter: any) => {
      filters.push(filter);
      return [];
    }),
  };
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    assetUpdateRequestId: 0,
    getActiveKeyring: () => manager,
    resetAutoLockTimer: jest.fn(),
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    performPostAccountSwitchOperations: jest.fn(),
    refreshActiveAccountLightweight: jest.fn(),
    reconcileLocalPendingEvmSmartAccountTransactions: jest.fn(),
    cancellablePromises: new CancellablePromises(),
    transactionsManager: TransactionsManager(),
  });
  // The isolated controller uses a public-read transport fixture, never a signer.
  Object.defineProperty(wallet, 'ethereumTransaction', {
    value: { web3Provider: provider },
  });
  jest
    .mocked(getController)
    .mockReturnValue({ wallet, dapp: DAppController(() => true) } as any);
  await persistCommittedWalletState(true);
});

afterEach(async () => {
  wallet?.transactionsManager?.utils.clearCache();
  await manager.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

it('advances and durably saves an unchanged smart account scan cursor', async () => {
  await create(A);
  await refresh();
  expect(record().smartAccountUserOpScanByChainId).toEqual({ [CHAIN_ID]: 100 });
  await wallet.setAccount(0, KeyringAccountType.HDAccount, true);
  expect(
    (await loadSlip44State(60))?.accounts[SMART][0]
      .smartAccountUserOpScanByChainId
  ).toEqual({ [CHAIN_ID]: 100 });
  await wallet.setAccount(0, SMART);
  await refresh();
  expect(filters.at(-1).fromBlock).toBe(95);
});

it('starts a normal replacement identity at block zero without an old in-flight read', async () => {
  await create(A);
  await wallet.setAccount(0, KeyringAccountType.HDAccount);
  await wallet.removeAccount(0, SMART);
  await create(B);
  expect(record().smartAccountUserOpScanByChainId).toBeUndefined();
  await refresh();
  expect(filters.at(-1).fromBlock).toBe(0);
  expect(record().address).toBe(B);
});

it.each([A, B])(
  'does not stamp replacement %s or skip its initial scan after a canceled old read',
  async (replacementAddress) => {
    await create(A);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    provider.getLogs.mockImplementationOnce((filter: any) => {
      filters.push(filter);
      entered();
      return new Promise<any[]>((resolve) => {
        release = () => resolve([]);
      });
    });
    const old = refresh().catch((error: unknown) => error);
    await started;
    await wallet.setAccount(0, KeyringAccountType.HDAccount);
    expect(await old).toBe('Cancel by network changing');
    await wallet.removeAccount(0, SMART);
    const replacement = await create(replacementAddress);
    expect({ id: replacement.id, address: record().address }).toEqual({
      id: 0,
      address: replacementAddress,
    });
    expect(record().smartAccountUserOpScanByChainId).toBeUndefined();
    release();
    await flush();
    await flush();
    const lateCursor = record().smartAccountUserOpScanByChainId;
    await wallet.setAccount(0, KeyringAccountType.HDAccount, true);
    // Independent native-API adapter restoration, not a disk/worker restart.
    const restoredCursor = (await loadSlip44State(60))?.accounts[SMART][0]
      .smartAccountUserOpScanByChainId;
    await wallet.setAccount(0, SMART);
    await refresh();
    expect({
      lateCursor,
      restoredCursor,
      nextFromBlock: filters.at(-1).fromBlock,
    }).toEqual({
      lateCursor: undefined,
      restoredCursor: undefined,
      nextFromBlock: 0,
    });
  }
);
