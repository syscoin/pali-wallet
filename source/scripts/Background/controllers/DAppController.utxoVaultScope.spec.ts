/** @jest-environment jsdom */

interface IFixtureKeyring {
  fixtureUnlock: () => void;
  isUnlocked: () => boolean;
  lockWallet: jest.Mock;
  setSignerNetwork: jest.Mock;
  setStorage: jest.Mock;
  setVaultStateGetter: jest.Mock;
  transferSessionTo: jest.Mock;
}

let mockSdkInstances: IFixtureKeyring[] = [];
let mockDisk: Record<string, any> = {};
const mockClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn().mockImplementation(() => {
    let unlocked = false;
    const sdk: IFixtureKeyring = {
      setStorage: jest.fn(),
      setVaultStateGetter: jest.fn(),
      isUnlocked: () => unlocked,
      fixtureUnlock: () => {
        unlocked = true;
      },
      transferSessionTo: jest.fn((target: IFixtureKeyring) =>
        target.fixtureUnlock()
      ),
      lockWallet: jest.fn(async () => {
        unlocked = false;
      }),
      setSignerNetwork: jest.fn(async () => ({ success: true })),
    };
    mockSdkInstances.push(sdk);
    return sdk;
  }),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {
    cleanup: jest.fn(),
    notifyNetworkChange: jest.fn(),
    notifyAccountChange: jest.fn(),
  },
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(async (key) => mockClone(mockDisk[key] ?? null)),
    getItems: jest.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys
          .filter((key) => key in mockDisk)
          .map((key) => [key, mockClone(mockDisk[key])])
      )
    ),
    setItem: jest.fn(async (key, value) => {
      mockDisk[key] = mockClone(value);
    }),
    setItems: jest.fn(async (items) => {
      Object.assign(mockDisk, mockClone(items));
    }),
  },
}));

import { getController } from 'scripts/Background';
import { rehydrate as rehydrateDapps } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountPropertyByIdAndType,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import MainController from './MainController';
import { onMessage } from './message-handler';
import { clearProviderCache } from './message-handler/provider-cache';

const HOST = 'https://connected-vault.synthetic.invalid';
const TYPE = KeyringAccountType.Imported;
const network = (slip44: number): INetwork => ({
  kind: INetworkType.Syscoin,
  slip44,
  chainId: slip44,
  currency: slip44 === 0 ? 'btc' : 'sys',
  label: `Public fixture ${slip44}`,
  url: `https://fixture-${slip44}.invalid`,
});
const SOURCE = network(0);
const TARGET = network(57);
// Complete, disposable public metadata exercises the real Pali HD-vault guard.
// The SDK session/transport boundary alone is substituted: no secret, signer,
// live provider or actual SDK cryptography is needed for permission routing.
const HD: Record<number, { address: string; xpub: string }> = {
  0: {
    address: 'bc1qx3hrafnc89r3ng4r6qh44jym6fwu23ny6pm3dv',
    xpub: 'xpub6Bn4PxBLw5aXoPhiUGP2EdfeUt5ssMG61rb3ybo8NEC6cf2uoe1k9rEJGtfWo4y7mBsLyztLgFxikLUpvVSCcuLqRHw5sTrjReqwwDxm27g',
  },
  57: {
    address: 'sys1qn0zl6c8e90wetsdya584s2jgcvuw6kvxu4y45r',
    xpub: 'xpub6CV4FDAFqm8asgRrRFPgWaXymNoGBzuuXY3GXN4oSdY8JzspJGyWseqmPxZRRyXN5VYGCxHiu6KnkmjK7YLjw1cLxmDj3VuQNccsPbKCCrb',
  },
};
const ADDRESSES: Record<number, string> = {
  0: 'bc1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpyfl4f3',
  57: 'sys1qqgpqyqszqgpqyqszqgpqyqszqgpqyqszaag2a4',
};
const account = (slip44: number) => ({
  id: 0,
  label: `Imported ${slip44}`,
  address: ADDRESSES[slip44],
  xpub: ADDRESSES[slip44],
  xprv: '',
  isImported: true,
  isLedgerWallet: false,
  isTrezorWallet: false,
  slip44,
  balances: { syscoin: 0, ethereum: 0 },
  assets: { syscoin: [], ethereum: [] },
});
const hdAccount = (slip44: number) => ({
  ...account(slip44),
  ...HD[slip44],
  isImported: false,
  label: `HD ${slip44}`,
});
const groups = () =>
  Object.fromEntries(
    Object.values(KeyringAccountType).map((type) => [type, {}])
  );
const snapshot = (net: INetwork) => ({
  ...store.getState().vault,
  activeNetwork: net,
  isBitcoinBased: true,
  activeAccount: { id: 0, type: TYPE },
  accounts: {
    ...groups(),
    HDAccount: { 0: hdAccount(net.slip44) },
    Imported: { 0: account(net.slip44) },
  },
  accountAssets: {
    ...groups(),
    HDAccount: { 0: { syscoin: [], ethereum: [] } },
    Imported: { 0: { syscoin: [], ethereum: [] } },
  },
  accountTransactions: {
    ...groups(),
    HDAccount: { 0: { syscoin: {}, ethereum: {} } },
    Imported: { 0: { syscoin: {}, ethereum: {} } },
  },
});

let dapp: ReturnType<typeof DAppController>;
let wallet: MainController;
const originalFetch = globalThis.fetch;
const providerRead = () =>
  onMessage(
    { type: 'METHOD_REQUEST', data: { method: 'wallet_getSysProviderState' } },
    { url: `${HOST}/page`, tab: { id: 1 } } as chrome.runtime.MessageSender
  );
const selection = () => {
  const { accounts, activeNetwork } = store.getState().vault;
  const selected = accounts[TYPE][0];
  return {
    address: selected.address,
    xpub: selected.xpub,
    network: activeNetwork,
  };
};
const approveCurrent = (extra: Partial<IDApp> = {}) =>
  dapp.connect(
    {
      host: HOST,
      accountId: 0,
      accountType: TYPE,
      chain: store.getState().vault.activeNetwork.kind,
      chainId: store.getState().vault.activeNetwork.chainId,
      date: Date.now(),
      ...extra,
    },
    selection()
  );
const installControllers = () => {
  wallet = new MainController();
  mockSdkInstances[mockSdkInstances.length - 1].fixtureUnlock();
  // Only post-switch external balance/fiat refreshes are omitted. The real
  // setActiveNetworkLogic, keyring switch, vault load, reconcile and commit run.
  jest.spyOn(wallet, 'setFiat').mockResolvedValue(undefined);
  jest
    .spyOn(wallet, 'getLatestUpdateForCurrentAccount')
    .mockResolvedValue(true);
  dapp = DAppController(
    () => wallet.isUnlocked(),
    () => wallet['walletStateGeneration']
  );
  jest.mocked(getController).mockReturnValue({ wallet, dapp } as any);
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  for (const name of ['log', 'warn', 'error', 'debug'] as const)
    jest.spyOn(console, name).mockImplementation();
  globalThis.fetch = jest.fn(async () => {
    throw new Error('Live transport forbidden');
  });
  mockSdkInstances = [];
  mockDisk = {};
  vaultCache.clearCache();
  clearProviderCache();
  store.dispatch(restoreVaultSnapshot(snapshot(SOURCE) as any));
  store.dispatch(setActiveSlip44(0));
  store.dispatch(rehydrateDapps({ dapps: {} }));
  vaultCache.prepareSlip44Vault(0, store.getState().vault);
  vaultCache.prepareSlip44Vault(57, snapshot(TARGET) as any);
  (chrome.runtime as any).id = 'synthetic-vault-transition';
  (chrome as any).tabs = {
    query: jest.fn((_query, callback) => callback([])),
    onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
  };
  (chrome as any).scripting = { executeScript: jest.fn(async () => []) };
  installControllers();
  await approveCurrent();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  clearProviderCache();
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

it('keeps a UTXO approval through a same-vault endpoint change', async () => {
  await wallet.setActiveNetwork({
    ...SOURCE,
    url: 'https://second-btc-fixture.invalid',
  });
  expect(mockSdkInstances[0].setSignerNetwork).toHaveBeenCalledTimes(1);
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [account(0).address],
    xpub: account(0).xpub,
  });
});

it('does not reuse Imported0 after a complete switch into another UTXO vault', async () => {
  await wallet.setActiveNetwork(TARGET);
  expect(store.getState().vaultGlobal.activeSlip44).toBe(57);
  expect(mockSdkInstances).toHaveLength(2);
  expect(mockSdkInstances[0].transferSessionTo).toHaveBeenCalledWith(
    mockSdkInstances[1]
  );
  expect(mockSdkInstances[0].isUnlocked()).toBe(false);
  expect(mockSdkInstances[1].setSignerNetwork).toHaveBeenCalledWith(TARGET);
  expect(store.getState().vault.accounts.HDAccount[0].xpub).toBe(HD[57].xpub);
  expect(mockDisk.state.vaultGlobal.activeSlip44).toBe(57);
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
  });
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(dapp.getAccount(HOST)).toBeNull();
});

it('reapproves the target vault durably and restores it in a fresh controller', async () => {
  await wallet.setActiveNetwork(TARGET);
  await approveCurrent();
  expect(mockDisk.state.dapp.dapps[HOST].utxoAccount).toEqual({
    slip44: 57,
    xpub: account(57).xpub,
  });
  store.dispatch(rehydrateDapps({ dapps: {} }));
  vaultCache.clearCache();
  await rehydrateStore(store);
  installControllers();
  expect(dapp.get(HOST)?.chainId).toBe(57);
  expect(dapp.isConnected(HOST)).toBe(true);
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [account(57).address],
    xpub: account(57).xpub,
  });
});

it('allows an HD receive address to rotate while its approved xpub stays stable', async () => {
  const hd = store.getState().vault.accounts.HDAccount[0];
  await dapp.connect(
    { ...dapp.get(HOST)!, accountType: KeyringAccountType.HDAccount },
    { address: hd.address, xpub: hd.xpub, network: SOURCE }
  );
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.HDAccount,
      property: 'address',
      value: ADDRESSES[0],
    })
  );
  clearProviderCache();
  expect(dapp.isConnected(HOST)).toBe(true);
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [ADDRESSES[0]],
    xpub: HD[0].xpub,
  });
});

it('refuses a replaced account reference even in the same UTXO slot and vault', async () => {
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: TYPE,
      property: 'xpub',
      value: HD[0].xpub,
    })
  );
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(dapp.getAccount(HOST)).toBeNull();
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
  });
});

it('does not let session synchronization authorize another UTXO reference', async () => {
  const previous = dapp.get(HOST);
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      accounts: {
        ...vault.accounts,
        Imported: {
          ...vault.accounts.Imported,
          1: {
            ...account(0),
            id: 1,
            address: HD[0].address,
            xpub: HD[0].address,
          },
        },
      },
    })
  );
  dapp.syncAccountSession(HOST, 1, TYPE);
  expect(dapp.get(HOST)).toBe(previous);
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [ADDRESSES[0]],
    xpub: ADDRESSES[0],
  });
});

it.each([
  ['missing', undefined],
  ['null', null],
  ['non-integer namespace', { slip44: 0.5, xpub: ADDRESSES[0] }],
  ['string namespace', { slip44: '0', xpub: ADDRESSES[0] }],
  ['wrong namespace', { slip44: 57, xpub: ADDRESSES[0] }],
  ['empty reference', { slip44: 0, xpub: '' }],
  ['non-string reference', { slip44: 0, xpub: 123 }],
  ['foreign reference', { slip44: 0, xpub: ADDRESSES[57] }],
])(
  'fails closed for a stored UTXO grant with %s binding',
  async (_name, binding) => {
    const previous = dapp.get(HOST)!;
    const restored = { ...previous, utxoAccount: binding } as IDApp;
    store.dispatch(rehydrateDapps({ dapps: { [HOST]: restored } }));
    expect(dapp.get(HOST)).toEqual(restored);
    expect(dapp.isConnected(HOST)).toBe(false);
    expect(dapp.getAccount(HOST)).toBeNull();
    await expect(providerRead()).resolves.toMatchObject({
      accounts: [],
      xpub: null,
    });
  }
);

it('mints only the validated identity instead of trusting caller-provided binding', async () => {
  await approveCurrent({ utxoAccount: { slip44: 57, xpub: ADDRESSES[57] } });
  expect(mockDisk.state.dapp.dapps[HOST].utxoAccount).toEqual({
    slip44: 0,
    xpub: ADDRESSES[0],
  });
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [ADDRESSES[0]],
    xpub: ADDRESSES[0],
  });
});

it('rejects a foreign selection context without publishing its forged binding', async () => {
  const previous = dapp.get(HOST);
  const diskBefore = mockClone(mockDisk.state.dapp);
  await expect(
    dapp.connect(
      { ...previous!, utxoAccount: { slip44: 57, xpub: ADDRESSES[57] } },
      { ...account(57), network: TARGET }
    )
  ).rejects.toThrow('Account context changed');
  expect(dapp.get(HOST)).toBe(previous);
  expect(mockDisk.state.dapp).toEqual(diskBefore);
});

it('revokes the scoped grant durably and keeps it revoked after restoration', async () => {
  await dapp.disconnect(HOST, true, { propagateErrors: true });
  expect(mockDisk.state.dapp.dapps[HOST]).toBeUndefined();
  store.dispatch(rehydrateDapps(mockClone(mockDisk.state.dapp)));
  installControllers();
  expect(dapp.get(HOST)).toBeUndefined();
  await expect(providerRead()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
  });
});

it('preserves ordinary EVM account permission across compatible chain changes', async () => {
  const address = `0x${'1'.repeat(40)}`;
  const evm = {
    ...SOURCE,
    kind: INetworkType.Ethereum,
    slip44: 60,
    chainId: 1,
  };
  const evmAccount = { ...account(0), address, xpub: HD[0].xpub, slip44: 60 };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: evm,
      isBitcoinBased: false,
      accounts: {
        ...groups(),
        HDAccount: { 0: evmAccount },
        Imported: { 0: evmAccount },
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  await approveCurrent();
  expect(dapp.get(HOST)).not.toHaveProperty('utxoAccount');
  await wallet.setActiveNetwork({ ...evm, chainId: 5700 });
  expect(dapp.isConnected(HOST)).toBe(true);
  expect(dapp.getAccount(HOST).address).toBe(address);
});
